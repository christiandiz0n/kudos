// QE_E2E Phase 3 gate, part 2: error states. Real where cheap (insufficient, expired, already paid, malformed,
// Face ID cancelled, camera denied, offline); API-response interception otherwise (relayer down / budget exhausted,
// payment failed, already rewarded, top-up refusals). Spend: one venue registration (relayer gas ≈ $0.01). No customer
// money moves and no top-up is claimed (POST /demo/topup is always intercepted here).
//   node e2e/phase3/check-errors.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, BASE, EVID, SCRATCH, apiErr, apiJson, audit, chromium, firstFocus, log, newPhone, onboard, runningAnimations, sessionOf, settle, shot, sink } from "./lib.mjs";

const V0 = "0xC6CF2be7Ef591D0DB16206796eeb003e891E319c";
const INTRO_CODE = "vG6xcBExH";
const out = sink("errors");
const results = [];
const rec = async (phone, file, state, expect, notes = "") => {
  await settle(phone.page, 600);
  await shot(phone.page, file, state, notes);
  const a = await audit(phone.page, file);
  const focus = await firstFocus(phone.page);
  const text = a.text;
  const hit = expect ? new RegExp(expect, "i").test(text) : null;
  const r = { ctx: phone.label, state, expect, expectFound: hit, ...a, focus, errs: phone.takeErrs() };
  results.push(r);
  out(r);
  log(file, hit === false ? `EXPECTED TEXT MISSING: ${expect}` : "ok", `primary=${a.primaryCount}`, a.banned.length ? `BANNED=${a.banned.map((b) => b.word)}` : "");
  return r;
};

const funded = (extra = (j) => j) => async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  if (j.error) return route.fulfill({ response: res, json: j });
  j.balance = { baseUnits: "50000000", display: "50.00" };
  j.canAfford = true;
  j.warnings = (j.warnings ?? []).filter((w) => w !== "insufficient_balance");
  await route.fulfill({ response: res, json: extra(j) });
};

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const state = {};
try {
  // ------------------------------------------------------------------ venue (registers on chain: ~ $0.01 relayer gas)
  const venue = await newPhone(browser, "venue");
  await venue.page.goto(`${BASE}/venue`);
  await settle(venue.page);
  await onboard(venue.page, "Vera");
  await venue.page.waitForURL(/\/venue\/new/, { timeout: 60_000 });
  await venue.page.getByLabel(/Name customers will see/i).fill(`QE errors café ${new Date().toISOString().slice(11, 16)}`);
  const tReg = Date.now();
  await venue.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await venue.page.waitForURL(/\/venue\/0x[0-9a-fA-F]{40}$/, { timeout: 120_000 });
  state.venue = venue.page.url().split("/").pop();
  state.venueRegMs = Date.now() - tReg;
  const vs = await sessionOf(venue.page);
  state.venueOwner = vs.address;
  writeFileSync(join(SCRATCH, "errors-venue.json"), JSON.stringify({ venue: state.venue, owner: vs.address, token: vs.token }));
  log("venue", state.venue, `${state.venueRegMs}ms`);
  await rec(venue, "e01-venue-dashboard-new", "new venue dashboard (empty state)", "", `registration → dashboard ${state.venueRegMs} ms`);

  // counter screens
  await venue.page.goto(`${BASE}/venue/${state.venue}/counter`);
  await rec(venue, "e02-counter-empty", "order entry (empty)", "");
  await venue.page.getByRole("button", { name: "Decimal point" }).click();
  await venue.page.getByRole("button", { name: /^4$/ }).click();
  await rec(venue, "e03-counter-below-min", "order entry below $0.50 minimum", "0\\.50");
  await venue.page.getByRole("button", { name: "Delete" }).click();
  await venue.page.getByRole("button", { name: /^5$/ }).click();
  await rec(venue, "e04-counter-050", "order entry $0.50", "");
  await venue.page.getByRole("button", { name: /Show code/ }).click();
  const qr = await venue.page.locator("[data-qr-payload]").getAttribute("data-qr-payload", { timeout: 30_000 });
  state.qr = qr;
  await rec(venue, "e05-counter-qr", "QR shown (live countdown)", "");

  // extra orders via the owner's session (no chain)
  const mk = async (ttl) => {
    const r = await apiJson(`/venues/${state.venue}/orders`, { method: "POST", token: vs.token, body: { amount: "500000", ttlSeconds: ttl } });
    if (r.status !== 201) throw new Error(`order ${r.status} ${JSON.stringify(r.json)}`);
    return `/pay?v=${r.json.order.venue}&o=${r.json.order.orderId}`;
  };
  const shortOrder = await mk(30);
  const shortAt = Date.now() + 32_000;
  const o1 = await mk(600);
  state.orders = { shortOrder, o1 };

  // ------------------------------------------------------------------ fresh unfunded customer
  const cust = await newPhone(browser, "customer");
  await cust.page.goto(`${BASE}${o1}`);
  await settle(cust.page);
  await rec(cust, "e10-pay-signed-out", "scanned code opened signed out (onboarding with venue context)", "");
  await onboard(cust.page, "Eve");
  await cust.page.getByText(/Not enough money yet/).waitFor({ timeout: 60_000 }).catch(() => {});
  const ins = await rec(cust, "e11-pay-insufficient", "insufficient balance (real, $0) with top-up CTA", "Not enough money yet");
  ins.topupCta = await cust.page.getByRole("button", { name: /Top up \(testnet demo\)/ }).count();
  state.customer = (await sessionOf(cust.page)).address;

  const Q = "**/payments/quote";
  for (const [file, status, code, msg, expect] of [
    ["e12-pay-relayer-down", 503, "RELAYER_DOWN", "Payments are paused for a moment.", "paused"],
    ["e13-pay-budget-exhausted", 503, "RELAYER_BUDGET_EXHAUSTED", "Demo limit reached.", "paused"],
    ["e14-pay-expired-forced", 410, "ORDER_EXPIRED", "This code has expired.", "expired"],
  ]) {
    await cust.page.route(Q, apiErr(status, code, msg, status === 503));
    await cust.page.goto(`${BASE}${o1}`);
    await cust.page.waitForTimeout(2500);
    await rec(cust, file, `${code} (forced via interception)`, expect);
    await cust.page.unroute(Q);
  }
  // Retry from the paused state recovers once the api answers again.
  await cust.page.route(Q, apiErr(503, "RELAYER_DOWN", "Payments are paused for a moment.", true));
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.waitForTimeout(2500);
  await cust.page.unroute(Q);
  await cust.page.route(Q, funded());
  await cust.page.getByRole("button", { name: /Try again/ }).click().catch(() => {});
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 }).catch(() => {});
  await rec(cust, "e15-pay-confirm-after-retry", "pay sheet after 'Try again' (balance faked via interception)", "Confirm with Face ID");

  // Payment failed: POST /payments → 502 TX_FAILED
  await cust.page.route("**/payments", apiErr(502, "TX_FAILED", "That didn't go through.", false));
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await cust.page.getByText(/didn't go through/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
  await rec(cust, "e16-pay-failed", "payment failed at relay (forced 502 TX_FAILED)", "Nothing was charged");
  await cust.page.unroute("**/payments");

  // Payment failed after relay: 202 then GET /payments/:id → failed
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
  await cust.page.waitForTimeout(800);
  await cust.page.route("**/payments", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 202, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify({ intentId: "00000000-0000-4000-8000-0000000000fa", status: "pending", txHash: `0x${"fa".repeat(32)}`, relayId: "qe" }) })
    : route.fallback());
  await cust.page.route("**/payments/00000000-0000-4000-8000-0000000000fa", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify({ intentId: "00000000-0000-4000-8000-0000000000fa", status: "failed", relayStatus: "reverted", settled: null }) }));
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await cust.page.getByText(/didn't go through/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
  await rec(cust, "e17-pay-failed-after-relay", "relayed, then reverted (forced GET /payments/:id failed)", "Nothing was charged");
  await cust.page.unroute("**/payments");
  await cust.page.unroute("**/payments/00000000-0000-4000-8000-0000000000fa");

  // Insufficient at relay time (402) → insufficient state
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
  await cust.page.route("**/payments", (route) => route.request().method() === "POST" ? apiErr(402, "INSUFFICIENT_BALANCE", "Not enough money.")(route) : route.fallback());
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await cust.page.waitForTimeout(2500);
  await rec(cust, "e18-pay-insufficient-at-relay", "402 INSUFFICIENT_BALANCE at POST /payments (forced)", "Not enough money");
  await cust.page.unroute("**/payments");

  // Face ID cancelled (real: the virtual authenticator refuses user verification)
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
  await cust.page.waitForTimeout(800);
  await cust.cdp.send("WebAuthn.setUserVerified", { authenticatorId: cust.authenticatorId, isUserVerified: false });
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await cust.page.getByText(/not confirmed|cancelled/i).first().waitFor({ timeout: 20_000 }).catch(() => {});
  await rec(cust, "e19-pay-faceid-cancelled", "Face ID / fingerprint refused (virtual authenticator UV=false)", "cancelled");
  await cust.cdp.send("WebAuthn.setUserVerified", { authenticatorId: cust.authenticatorId, isUserVerified: true });

  // Offline at confirm (real: context offline → fetch fails, navigator.onLine=false)
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
  await cust.page.waitForTimeout(800);
  await cust.ctx.setOffline(true);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await cust.page.waitForTimeout(3000);
  await rec(cust, "e20-pay-offline", "offline at confirm (context offline)", "offline");
  await cust.ctx.setOffline(false);

  // Already rewarded here → plain payment ("Welcome back… regular payment")
  await cust.page.unroute(Q);
  await cust.page.route(Q, funded((j) => {
    j.quote.firstPurchase = false;
    j.quote.rewarded = false;
    j.quote.cashback = { baseUnits: "0", display: "0.00" };
    j.quote.rewards = [];
    j.quote.venueAmount = j.quote.amount;
    j.attribution = null;
    return j;
  }));
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
  await rec(cust, "e21-pay-repeat-visit", "already rewarded at this venue → plain payment (forced quote)", "Welcome back");
  await cust.page.unroute(Q);

  // Real first visit, no recommendation (funded-looking)
  await cust.page.route(Q, funded());
  await cust.page.goto(`${BASE}${o1}`);
  await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
  await rec(cust, "e22-pay-first-visit-no-rec", "first visit, no recommendation (balance faked)", "");
  await cust.page.unroute(Q);

  // Real expired order
  const wait = shortAt - Date.now();
  if (wait > 0) await cust.page.waitForTimeout(wait);
  await cust.page.goto(`${BASE}${shortOrder}`);
  await cust.page.waitForTimeout(3000);
  await rec(cust, "e23-pay-expired-real", "expired code (real, ttl 30 s)", "expired");
  await cust.page.getByRole("button", { name: /Scan a new code/ }).click().catch(() => {});
  await cust.page.waitForTimeout(1500);
  results.push({ state: "expired → Scan a new code navigates to", url: cust.page.url() });

  // Malformed link: what does "Try again" do?
  await cust.page.goto(`${BASE}/pay?v=0x123&o=nope`);
  await cust.page.waitForTimeout(2000);
  await rec(cust, "e24-pay-malformed", "malformed pay link", "");
  await cust.page.getByRole("button", { name: /Try again/ }).click().catch(() => {});
  await cust.page.waitForTimeout(2000);
  await rec(cust, "e25-pay-malformed-after-try-again", "malformed pay link after pressing 'Try again'", "");

  // Top-up refusals (POST /demo/topup intercepted; nothing claimed)
  for (const [file, status, code, msg] of [
    ["e26-topup-already-claimed", 409, "TOPUP_ALREADY_CLAIMED", "You've already used your demo top-up."],
    ["e27-topup-daily-cap", 429, "TOPUP_DAILY_CAP_REACHED", "Demo top-ups are used up for today."],
    ["e28-topup-disabled", 503, "TOPUP_DISABLED", "Demo top-ups are off."],
  ]) {
    await cust.page.route("**/demo/topup", (route) => route.request().method() === "POST" ? apiErr(status, code, msg)(route) : route.fallback());
    await cust.page.goto(`${BASE}/wallet`);
    await settle(cust.page, 1500);
    await cust.page.getByRole("button", { name: /Top up \(testnet demo\)/ }).click().catch((e) => log("no topup button", e.message));
    await cust.page.waitForTimeout(1200);
    await rec(cust, file, `wallet top-up refused: ${code} (forced)`, "");
    await cust.page.unroute("**/demo/topup");
  }

  // Non-owner tries to take an order at someone else's venue
  await cust.page.goto(`${BASE}/venue/${V0}/counter`);
  await settle(cust.page, 1500);
  await cust.page.getByRole("button", { name: /^1$/ }).click().catch(() => {});
  await cust.page.getByRole("button", { name: /Show code/ }).click().catch(() => {});
  await cust.page.waitForTimeout(3000);
  await rec(cust, "e29-counter-nonowner-show-code", "non-owner presses Show code on another venue's counter", "");

  // Friend's link: already a customer (forced ALREADY_REWARDED)
  await cust.page.goto(`${BASE}/i/${INTRO_CODE}`);
  await settle(cust.page, 2000);
  await cust.page.route(`**/intros/${INTRO_CODE}/accept/prepare`, apiErr(409, "ALREADY_REWARDED", "Already a customer."));
  await cust.page.getByRole("button", { name: /Save .* recommendation/ }).click().catch(() => {});
  await cust.page.waitForTimeout(2000);
  await rec(cust, "e30-intro-already-customer", "friend's link when already a customer here (forced 409)", "");
  await cust.page.unroute(`**/intros/${INTRO_CODE}/accept/prepare`);

  // Session gone, device account present → unlock
  await cust.page.evaluate(() => localStorage.removeItem("vouch.session.v1"));
  await cust.page.goto(`${BASE}/wallet`);
  await rec(cust, "e31-unlock", "welcome back (unlock with Face ID)", "");

  // ------------------------------------------------------------------ reduced motion: pending → settled (forced)
  const rm = await newPhone(browser, "reduced", { reducedMotion: "reduce" });
  await rm.page.goto(`${BASE}${o1}`);
  await settle(rm.page);
  await onboard(rm.page, "Rae");
  await rm.page.route(Q, funded());
  await rm.page.goto(`${BASE}${o1}`);
  await rm.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
  const fakeId = "00000000-0000-4000-8000-00000000005e";
  let settledNow = false;
  const oid = o1.split("o=")[1];
  await rm.page.route("**/payments", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 202, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify({ intentId: fakeId, status: "pending", txHash: `0x${"5e".repeat(32)}`, relayId: "qe" }) })
    : route.fallback());
  await rm.page.route(`**/payments/${fakeId}`, (route) => {
    const rsa = (await_) => await_;
    const body = settledNow
      ? { intentId: fakeId, status: "settled", settled: { source: "streams", venue: state.venue, customer: "0x0000000000000000000000000000000000000001", orderId: oid, amount: { baseUnits: "500000", display: "0.50" }, venueAmount: { baseUnits: "500000", display: "0.50" }, rewardPool: { baseUnits: "0", display: "0.00" }, firstPurchase: true, rewarded: false, weightsMode: 0, txHash: `0x${"5e".repeat(32)}`, blockNumber: "1", blockTime: Math.floor(Date.now() / 1000), lines: [] } }
      : { intentId: fakeId, status: "pending", settled: null };
    void rsa;
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify(body) });
  });
  await rm.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await rm.page.waitForTimeout(1500);
  const pend = await rec(rm, "e40-success-pending-reduced-motion", "pending ('Arriving') under prefers-reduced-motion (forced 202)", "");
  pend.animations = await runningAnimations(rm.page);
  settledNow = true;
  await rm.page.waitForTimeout(4500);
  const setl = await rec(rm, "e41-success-settled-reduced-motion", "settled under prefers-reduced-motion (forced GET /payments/:id)", "Paid");
  setl.animations = await runningAnimations(rm.page);
  log("reduced-motion animations pending", pend.animations, "settled", setl.animations);

  // ------------------------------------------------------------------ camera denied (separate browser, no fake UI, no permission)
  const b2 = await chromium.launch();
  try {
    const den = await newPhone(b2, "camera-denied", { permissions: [] });
    await den.page.goto(`${BASE}/scan`);
    await den.page.waitForTimeout(3500);
    const r = await rec(den, "e50-scan-camera-denied", "camera permission denied (real headless prompt dismissal)", "Camera is off");
    if (!r.expectFound) {
      // Fallback: force NotAllowedError from getUserMedia.
      await den.page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      await den.page.goto(`${BASE}/scan`);
      await den.page.waitForTimeout(3000);
      await rec(den, "e51-scan-camera-denied-forced", "camera denied (forced NotAllowedError)", "Camera is off");
    }
  } finally {
    await b2.close();
  }
} catch (e) {
  results.push({ fatal: String(e?.stack ?? e) });
  console.error(e);
} finally {
  writeFileSync(join(EVID, "errors-results.json"), JSON.stringify({ state, results }, null, 2));
  log("wrote", results.length);
  await browser.close();
}
