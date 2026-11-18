// QE_E2E Phase 3 gate, part 2b: offline (isolated, with a control), reduced-motion pending/settled (forced), camera denied.
// Reuses the venue registered by check-errors.mjs (owner session from the scratch dir; orders only, no chain).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, SCRATCH, apiErr, apiJson, audit, chromium, firstFocus, log, newPhone, onboard, runningAnimations, sessionOf, settle, shot } from "./lib.mjs";

const V = JSON.parse(readFileSync(join(SCRATCH, "errors-venue.json"), "utf8"));
const results = [];
const rec = async (phone, file, state, expect, notes = "") => {
  await settle(phone.page, 600);
  await shot(phone.page, file, state, notes);
  const a = await audit(phone.page, file);
  const focus = await firstFocus(phone.page);
  const r = { ctx: phone.label, state, expect, expectFound: expect ? new RegExp(expect, "i").test(a.text) : null, ...a, focus, errs: phone.takeErrs() };
  results.push(r);
  log(file, r.expectFound === false ? `EXPECTED TEXT MISSING: ${expect}` : "ok", "|", a.text.slice(0, 160));
  return r;
};
const funded = async (route) => {
  try { await fundedInner(route); } catch (e) { log("funded route:", e.message); }
};
const fundedInner = async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  if (j.error) return route.fulfill({ response: res, json: j });
  j.balance = { baseUnits: "50000000", display: "50.00" };
  j.canAfford = true;
  j.warnings = (j.warnings ?? []).filter((w) => w !== "insufficient_balance");
  await route.fulfill({ response: res, json: j });
};
const mk = async () => {
  const r = await apiJson(`/venues/${V.venue}/orders`, { method: "POST", token: V.token, body: { amount: "500000", ttlSeconds: 600 } });
  if (r.status !== 201) throw new Error(`order ${r.status} ${JSON.stringify(r.json)}`);
  return `/pay?v=${r.json.order.venue}&o=${r.json.order.orderId}`;
};
async function signedIn(phone, path, name) {
  await phone.page.goto(`${BASE}${path}`);
  await settle(phone.page);
  await onboard(phone.page, name);
  await phone.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await phone.page.waitForTimeout(1500);
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  const o = await mk();
  const Q = "**/payments/quote";

  // ---- control: Face ID works, relay forced to fail (proves the signing path works in this context)
  const c = await newPhone(browser, "offline-cust");
  await signedIn(c, o, "Olly");
  await c.page.route(Q, funded);
  await c.page.goto(`${BASE}${o}`);
  await c.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
  await c.page.waitForTimeout(800);
  await c.page.route("**/payments", (route) => (route.request().method() === "POST" ? apiErr(502, "TX_FAILED", "x")(route) : route.fallback()));
  await c.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await c.page.waitForTimeout(3000);
  await rec(c, "e60-control-relay-failed", "control: signature OK, relay forced 502", "didn't go through");
  await c.page.unroute("**/payments");

  // ---- offline at confirm
  await c.page.goto(`${BASE}${o}`);
  await c.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
  await c.page.waitForTimeout(800);
  await c.ctx.setOffline(true);
  const online = await c.page.evaluate(() => navigator.onLine);
  await c.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await c.page.waitForTimeout(4000);
  const off = await rec(c, "e61-pay-offline-at-confirm", "offline at confirm (context offline; navigator.onLine=" + online + ")", "offline");
  off.navigatorOnLine = online;
  // ---- offline at load (the quote fails)
  await c.ctx.setOffline(false);
  // ---- reduced motion: pending → settled (forced, nothing relayed)
  const rm = await newPhone(browser, "reduced", { reducedMotion: "reduce" });
  await signedIn(rm, o, "Rae");
  await rm.page.route(Q, funded);
  await rm.page.goto(`${BASE}${o}`);
  await rm.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
  await rm.page.waitForTimeout(800);
  const me = (await sessionOf(rm.page)).address;
  const fakeId = "00000000-0000-4000-8000-00000000005e";
  const oid = o.split("o=")[1];
  let settledNow = false;
  const H = { "access-control-allow-origin": BASE };
  await rm.page.route("**/payments", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 202, contentType: "application/json", headers: H, body: JSON.stringify({ intentId: fakeId, status: "pending", txHash: `0x${"5e".repeat(32)}`, relayId: "qe" }) })
    : route.fallback());
  await rm.page.route(`**/payments/${fakeId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify(settledNow
    ? { intentId: fakeId, status: "settled", settled: { source: "streams", venue: V.venue, customer: me, orderId: oid, amount: { baseUnits: "500000", display: "0.50" }, venueAmount: { baseUnits: "500000", display: "0.50" }, rewardPool: { baseUnits: "0", display: "0.00" }, firstPurchase: true, rewarded: false, weightsMode: 0, txHash: `0x${"5e".repeat(32)}`, blockNumber: "1", blockTime: Math.floor(Date.now() / 1000), lines: [] } }
    : { intentId: fakeId, status: "pending", settled: null }) }));
  await rm.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await rm.page.waitForTimeout(1500);
  const p = await rec(rm, "e40-success-pending-reduced-motion", "pending under prefers-reduced-motion (forced 202; nothing relayed)", "");
  p.animations = await runningAnimations(rm.page);
  settledNow = true;
  await rm.page.waitForTimeout(5000);
  const s = await rec(rm, "e41-success-settled-reduced-motion", "settled under prefers-reduced-motion (forced GET /payments/:id)", "");
  s.animations = await runningAnimations(rm.page);
  log("anims", p.animations, s.animations);

  // ---- camera denied (separate browser without the fake-UI flag; no permission granted)
  const b2 = await chromium.launch();
  try {
    const den = await newPhone(b2, "camera-denied", { permissions: [] });
    await den.page.goto(`${BASE}/scan`);
    await den.page.waitForTimeout(4000);
    const r = await rec(den, "e50-scan-camera-denied", "camera permission not granted (headless default)", "Camera is off");
    if (!r.expectFound) {
      await den.page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      await den.page.goto(`${BASE}/scan`);
      await den.page.waitForTimeout(3000);
      await rec(den, "e51-scan-camera-denied-forced", "camera denied (forced NotAllowedError)", "Camera is off");
    }
    await den.page.getByRole("button", { name: /Type|short link|code/i }).first().click().catch(() => {});
    await den.page.waitForTimeout(800);
    await rec(den, "e52-scan-type-code", "camera denied → type the code", "");
  } finally {
    await b2.close();
  }
} catch (e) {
  results.push({ fatal: String(e?.stack ?? e) });
  console.error(e);
} finally {
  writeFileSync(join(EVID, "errors2-results.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
