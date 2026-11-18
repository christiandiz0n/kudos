// QE_E2E Phase 3 gate, part 1: static/route checks. No chain spend (fresh accounts only sign in; nothing relayed).
//   node e2e/phase3/check-static.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, audit, chromium, firstFocus, log, newPhone, onboard, runningAnimations, settle, shot, sink } from "./lib.mjs";

// Existing live data (FRONTEND_INTEGRATION's 18:20 run; public reads only).
const V0 = "0xC6CF2be7Ef591D0DB16206796eeb003e891E319c";
const BEN = "0xf5Ac8A0fc0B33c2368F0BF7A59Bb81e1fCcf13bc";
const INTRO = "/i/vG6xcBExH";
const PAID_ORDER = `/pay?v=${V0}&o=0xf45b15cb831f6cbe20faf873e0faf5d287ba36668b75a5f2bbec42e8b9abd6f1`;

const out = sink("static");
const results = [];

async function visit(phone, path, file, state, { primary = true, wait = 1500, notes = "", full = false } = {}) {
  phone.takeErrs();
  const resp = await phone.page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await settle(phone.page, wait);
  await shot(phone.page, file, state, notes);
  if (full) await shot(phone.page, `${file}-full`, `${state} (full page)`, notes, { fullPage: true });
  const a = await audit(phone.page, file, { primary });
  const focus = await firstFocus(phone.page);
  if (!phone.page.url().startsWith(`${BASE}${path.split("?")[0]}`)) focus.navigatedAway = phone.page.url();
  const errs = phone.takeErrs();
  const rec = { ctx: phone.label, path, http: resp?.status(), ...a, focus, errs };
  results.push(rec);
  out(rec);
  log(file, `primary=${a.primaryCount}`, a.banned.length ? `BANNED=${a.banned.map((b) => b.word)}` : "", a.moneyBad.length ? `MONEY=${a.moneyBad}` : "", errs.length ? `ERRS=${errs.length}` : "", focus.ok ? "" : `FOCUS=${focus.el}`);
  return rec;
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  // ------------------------------------------------------------------ signed out
  const anon = await newPhone(browser, "anon");
  await visit(anon, "/", "s01-landing-signed-out", "landing / onboarding (signed out)");
  await visit(anon, "/transparency", "s02-transparency", "public transparency (default example)", { primary: false, full: true });
  await visit(anon, `/transparency?venue=${V0}`, "s03-transparency-venue", "transparency for a live venue", { primary: false, full: true });
  await visit(anon, INTRO, "s04-intro-signed-out", "friend's link opened signed out", { wait: 2500 });
  await visit(anon, `/a/${BEN}`, "s05-record-public", "public ambassador record (visitor)", { wait: 2500 });
  await visit(anon, "/scan", "s06-scan-signed-out", "scanner, signed out");
  await visit(anon, "/venue", "s07-venue-signed-out", "venue app entry, signed out");
  await visit(anon, `/venue/${V0}`, "s08-venue-dashboard-signed-out", "venue dashboard URL, signed out", { wait: 3000 });
  await visit(anon, "/wallet", "s09-wallet-signed-out", "wallet URL, signed out");
  await visit(anon, "/me", "s10-me-signed-out", "own record URL, signed out");
  await visit(anon, "/i/NOPE0000", "s11-intro-unknown", "unknown friend's link", { wait: 2500 });
  await visit(anon, "/does-not-exist", "s12-404", "unknown route (404)");

  // ------------------------------------------------------------------ fresh customer (signs in only)
  const cust = await newPhone(browser, "customer");
  await cust.page.goto(`${BASE}/`);
  await settle(cust.page);
  await onboard(cust.page, "Quinn");
  await cust.page.waitForURL(/\/wallet/, { timeout: 60_000 }).catch(() => {});
  await visit(cust, "/wallet", "s20-wallet-new", "wallet home, new account ($0)", { wait: 3000 });
  await visit(cust, "/me", "s21-me-empty", "own record, nothing yet", { wait: 2500 });
  await visit(cust, "/scan", "s22-scan-camera", "in-app scanner (fake camera)", { wait: 2500 });
  await visit(cust, `/recommend?venue=${V0}`, "s23-recommend-locked", "recommend before buying (locked)", { wait: 3000 });
  await visit(cust, INTRO, "s24-intro-signed-in", "friend's link, signed in (save offered)", { wait: 3000 });
  await visit(cust, PAID_ORDER, "s25-pay-already-paid", "order already paid (real paid order)", { wait: 4000 });
  await visit(cust, `/pay?v=${V0}`, "s26-pay-malformed-missing-o", "malformed pay link (no order)", { wait: 2500 });
  await visit(cust, "/pay?v=0x123&o=nope", "s27-pay-malformed-garbage", "malformed pay link (garbage)", { wait: 2500 });
  await visit(cust, `/venue/${V0}`, "s28-venue-dashboard-nonowner", "dashboard of a live venue (non-owner)", { wait: 4000, full: true });
  await visit(cust, `/venue/${V0}/counter`, "s29-counter-nonowner", "counter of someone else's venue", { wait: 3000 });
  await visit(cust, "/venue", "s30-venue-entry-signed-in", "venue entry, signed in, no venue", { wait: 3000 });
  await visit(cust, "/transparency", "s31-transparency-signed-in", "transparency (signed in)", { primary: false });
  // QE-3-02: the minimum field on venue onboarding must not sit under the footer (or its caption)
  await cust.page.goto(`${BASE}/venue/new`);
  await settle(cust.page, 1500);
  const geom = async () => cust.page.evaluate(() => {
    const lab = [...document.querySelectorAll("label")].find((l) => /Minimum first order/i.test(l.textContent));
    const inp = lab && (document.getElementById(lab.htmlFor) || lab.parentElement.querySelector("input"));
    const footer = document.querySelector("[data-vx-footer]");
    const r = (e) => (e ? e.getBoundingClientRect().toJSON() : null);
    const fr = r(footer);
    const top = (x, y) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}:${(e.textContent || "").trim().slice(0, 30)}` : null; };
    const lr = r(lab), ir = r(inp);
    return { label: lr, input: ir, footer: fr, footerBg: footer ? getComputedStyle(footer).backgroundColor : null,
      labelHit: lr ? top(lr.x + 10, lr.y + lr.height / 2) : null, inputHit: ir ? top(ir.x + 20, ir.y + ir.height / 2) : null, vh: innerHeight };
  });
  const g0 = await geom();
  await shot(cust.page, "s32-venue-onboarding-initial", "venue onboarding at 390×844 (initial scroll)");
  await cust.page.getByLabel(/Minimum first order/i).focus();
  await cust.page.waitForTimeout(800);
  const g1 = await geom();
  await shot(cust.page, "s33-venue-onboarding-focus-min", "venue onboarding, minimum field focused (scroll-padding)");
  results.push({ screen: "QE-3-02 geometry", initial: g0, focused: g1 });
  log("QE-3-02 focused", JSON.stringify({ labelHit: g1.labelHit, inputHit: g1.inputHit, inputBottom: g1.input?.bottom, footerTop: g1.footer?.top }));

  // QE-3-07: one focus ring on a text field
  await anon.page.goto(`${BASE}/`);
  await settle(anon.page, 800);
  await anon.page.keyboard.press("Tab");
  await anon.page.waitForTimeout(300);
  const ring = await anon.page.evaluate(() => { const el = document.activeElement; const s = getComputedStyle(el); const p = getComputedStyle(el.parentElement); return { tag: el.tagName, inputOutline: `${s.outlineStyle} ${s.outlineWidth}`, inputShadow: s.boxShadow, wrapperShadow: p.boxShadow, wrapperOutline: `${p.outlineStyle} ${p.outlineWidth}` }; });
  await shot(anon.page, "s01b-landing-focus-first-tab", "first Tab stop on landing: name field focus ring");
  results.push({ screen: "QE-3-07 focus ring", ring });
  log("QE-3-07", JSON.stringify(ring));


  // ------------------------------------------------------------------ reduced motion: graph + transparency
  const rm = await newPhone(browser, "reduced", { reducedMotion: "reduce" });
  await rm.page.goto(`${BASE}/`);
  await settle(rm.page);
  await onboard(rm.page, "Remy");
  await rm.page.waitForURL(/\/wallet/, { timeout: 60_000 }).catch(() => {});
  const r1 = await visit(rm, `/venue/${V0}`, "s40-dashboard-reduced-motion", "dashboard + money graph, prefers-reduced-motion", { wait: 4000 });
  r1.animations = await runningAnimations(rm.page);
  const r2 = await visit(rm, "/transparency", "s41-transparency-reduced-motion", "transparency, prefers-reduced-motion", { primary: false });
  r2.animations = await runningAnimations(rm.page);
  const nm = await newPhone(browser, "motion");
  await nm.page.goto(`${BASE}/`);
  await settle(nm.page);
  await onboard(nm.page, "Mo");
  await nm.page.waitForURL(/\/wallet/, { timeout: 60_000 }).catch(() => {});
  await nm.page.goto(`${BASE}/venue/${V0}`);
  await settle(nm.page, 300);
  const motionAnims = await runningAnimations(nm.page);
  results.push({ screen: "motion-baseline", animations: motionAnims });
  log("anims reduced", r1.animations.length, "vs normal", motionAnims.length);

  // ------------------------------------------------------------------ projector 1280×720 (non-owner, live data)
  const wide = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const wp = await wide.newPage();
  const werr = [];
  wp.on("pageerror", (e) => werr.push(e.message));
  // the dashboard needs an account: reuse the customer's storage? (device account is per context) → show signed-out view
  await wp.goto(`${BASE}/transparency?venue=${V0}`);
  await settle(wp, 2000);
  await shot(wp, "s50-transparency-1280", "transparency at 1280×720", "desktop");
  results.push({ screen: "s50-transparency-1280", errs: werr });
} finally {
  writeFileSync(join(EVID, "static-results.json"), JSON.stringify(results, null, 2));
  log("wrote", results.length, "records");
  await browser.close();
}
