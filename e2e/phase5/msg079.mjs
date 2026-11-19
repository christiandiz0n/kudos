// QE_E2E Phase 5: re-test QE-2-03/04/06/09 (MSG-079) against the hosted api. No chain spend:
//   - QE-2-03/04 are prepare-only calls (refused before anything is stored or signed; the one control prepare is never signed).
//   - QE-2-06/09 use a fresh UNFUNDED customer, so the api can never broadcast a pay; the app signs, the api refuses.
// Needs the owner session of the venue that check-errors.mjs registered (<scratch>/errors-venue.json).
//   node e2e/phase5/msg079.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/phase-5/prod
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, BASE, EVID, SCRATCH, apiJson, chromium, log, newPhone, onboard, sessionOf, settle, shot, sleep } from "../phase3/lib.mjs";

const VOUCH = "0xF4B641dc628de05336aa983B07D5d181254ff08e";
const USDC = "0x3600000000000000000000000000000000000000";
const ZERO = "0x0000000000000000000000000000000000000000";
const V = JSON.parse(readFileSync(join(SCRATCH, "errors-venue.json"), "utf8"));
const R = { base: BASE, api: API, venue: V.venue, at: new Date().toISOString(), checks: [] };
const check = (id, name, ok, detail) => {
  R.checks.push({ id, name, ok, detail });
  log(ok ? "PASS" : "FAIL", id, name, JSON.stringify(detail).slice(0, 300));
};
const code = (r) => r.json?.error?.code;

const browser = await chromium.launch();
try {
  // A fresh customer session (sign-in only).
  const c = await newPhone(browser, "msg079-cust");
  await c.page.goto(`${BASE}/`);
  await settle(c.page);
  await onboard(c.page, "Theo");
  await c.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  const cs = await sessionOf(c.page);
  R.customer = cs.address;

  // ---------------------------------------------------------------- QE-2-03: bad payout refused before signing
  for (const [label, payout] of [["zero", ZERO], ["Vouch", VOUCH], ["USDC", USDC]]) {
    const r = await apiJson("/venues/prepare", { method: "POST", token: cs.token, body: { name: `QE payout ${label}`, rewardBps: 1000, minOrder: "0", payout } });
    check("QE-2-03", `/venues/prepare payout=${label} → 400 INVALID_PAYOUT`, r.status === 400 && code(r) === "INVALID_PAYOUT", { status: r.status, code: code(r) });
  }
  for (const [label, payout] of [["Vouch", VOUCH], ["USDC", USDC], ["zero", ZERO]]) {
    const r = await apiJson(`/venues/${V.venue}/actions`, { method: "POST", token: V.token, body: { kind: "setKeys", payout } });
    check("QE-2-03", `setKeys prepare payout=${label} → 400 INVALID_PAYOUT`, r.status === 400 && code(r) === "INVALID_PAYOUT", { status: r.status, code: code(r) });
  }

  // ---------------------------------------------------------------- QE-2-04: allowed must be a JSON boolean
  for (const allowed of ["true", "false", 1, 0, null]) {
    const r = await apiJson(`/venues/${V.venue}/actions`, { method: "POST", token: V.token, body: { kind: "setSeedAmbassador", ambassador: cs.address, allowed } });
    check("QE-2-04", `setSeedAmbassador allowed=${JSON.stringify(allowed)} → 400`, r.status === 400, { status: r.status, code: code(r), details: r.json?.error?.details });
  }
  {
    // Control: a real boolean prepares (typed data allowed:true). Never signed or submitted.
    const r = await apiJson(`/venues/${V.venue}/actions`, { method: "POST", token: V.token, body: { kind: "setSeedAmbassador", ambassador: cs.address, allowed: true } });
    const msg = r.json?.typedData?.message;
    check("QE-2-04", "control allowed=true → 200, typed message allowed === true", r.status === 200 && msg?.allowed === true, { status: r.status, allowed: msg?.allowed });
  }

  // ---------------------------------------------------------------- orders (DB only)
  const mk = async (ttl) => {
    const r = await apiJson(`/venues/${V.venue}/orders`, { method: "POST", token: V.token, body: { amount: "500000", ttlSeconds: ttl } });
    if (r.status !== 201) throw new Error(`order ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.order;
  };
  const payResponses = [];
  c.page.on("response", async (res) => {
    if (res.url() === `${API}/payments` && res.request().method() === "POST") {
      let j = null;
      try { j = await res.json(); } catch {}
      payResponses.push({ status: res.status(), code: j?.error?.code, at: Date.now() });
    }
  });
  const funded = async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    if (!j.error) {
      j.balance = { baseUnits: "50000000", display: "50.00" };
      j.canAfford = true;
      j.warnings = (j.warnings ?? []).filter((w) => w !== "insufficient_balance");
    }
    await route.fulfill({ response: res, json: j });
  };

  // ---------------------------------------------------------------- QE-2-09: a refused attempt doesn't mark the order failed
  {
    const o = await mk(600);
    await c.page.route("**/payments/quote", funded); // the UI thinks it can afford; the api checks the real ($0) balance
    await c.page.goto(`${BASE}/pay?v=${o.venue}&o=${o.orderId}`);
    const btn = c.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ });
    await btn.waitFor({ timeout: 30_000 });
    await c.page.waitForTimeout(800);
    await btn.click();
    await c.page.waitForTimeout(4000);
    await shot(c.page, "m09-refused-insufficient", "QE-2-09: refused POST /payments (real $0 balance)");
    const first = payResponses.at(-1);
    const st = await apiJson(`/venues/${o.venue}/orders/${o.orderId}`);
    check("QE-2-09", "refused POST /payments (unfunded) → 402, nothing sent", first?.status === 402, first);
    check("QE-2-09", "order stays payable after the refusal (status pending, relayStatus pending, no tx)", st.json.status === "pending" && st.json.relayStatus === "pending" && !st.json.txHash, { status: st.json.status, relayStatus: st.json.relayStatus, txHash: st.json.txHash });
    // A fresh quote on the same order still works (the order is not 'failed').
    const q = await apiJson("/payments/quote", { method: "POST", token: cs.token, body: { venue: o.venue, orderId: o.orderId } });
    check("QE-2-09", "a new quote on the same order still succeeds", q.status === 200 && !!q.json.intentId, { status: q.status, code: code(q) });
    await c.page.unroute("**/payments/quote");
  }

  // ---------------------------------------------------------------- QE-2-06: an expired QR at pay time → ORDER_EXPIRED
  {
    const o = await mk(30);
    const expiresAtMs = Number(o.expiresAt) * 1000;
    await c.page.route("**/payments/quote", funded);
    // Hold the signed POST /payments until the order has expired (chain time), then let it through.
    await c.page.route(`${API}/payments`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const wait = expiresAtMs + 6000 - Date.now();
      log("holding POST /payments", wait, "ms");
      if (wait > 0) await sleep(wait);
      await route.continue();
    });
    await c.page.goto(`${BASE}/pay?v=${o.venue}&o=${o.orderId}`);
    const btn = c.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ });
    await btn.waitFor({ timeout: 20_000 });
    await c.page.waitForTimeout(500);
    const n0 = payResponses.length;
    await btn.click();
    for (let i = 0; i < 60 && payResponses.length === n0; i++) await sleep(1000);
    await c.page.waitForTimeout(2000);
    await shot(c.page, "m06-pay-after-expiry", "QE-2-06: pay sent after the QR expired");
    const r = payResponses.at(-1);
    check("QE-2-06", "POST /payments after the order expired → 410 ORDER_EXPIRED", r?.status === 410 && r?.code === "ORDER_EXPIRED", r);
    const q = await apiJson("/payments/quote", { method: "POST", token: cs.token, body: { venue: o.venue, orderId: o.orderId } });
    check("QE-2-06", "quote after expiry → 410 ORDER_EXPIRED (same code)", q.status === 410 && code(q) === "ORDER_EXPIRED", { status: q.status, code: code(q) });
    const st = await apiJson(`/venues/${o.venue}/orders/${o.orderId}`);
    check("QE-2-06", "public order status reads expired", st.json.status === "expired", { status: st.json.status, relayStatus: st.json.relayStatus });
    R.ui06 = (await c.page.evaluate(() => document.body.innerText.replace(/\s+/g, " "))).slice(0, 400);
  }
} catch (e) {
  R.fatal = String(e?.stack ?? e);
  console.error(e);
} finally {
  R.pass = R.checks.filter((x) => x.ok).length;
  R.fail = R.checks.filter((x) => !x.ok).length;
  writeFileSync(join(EVID, "msg079-results.json"), JSON.stringify(R, null, 2));
  log("PASS", R.pass, "FAIL", R.fail);
  await browser.close();
}
