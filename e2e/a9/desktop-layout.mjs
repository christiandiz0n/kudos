// QE A9 desktop layout check (headless): demo-path screens at 1440x900 (and 1280x720 for wide pages).
//   node e2e/a9/desktop-layout.mjs --base <origin> --out docs/evidence/ui-blue/qe/desktop-<tag>
// Per screen: horizontal overflow, content bounds (nothing within 32px of the viewport edge), centring of the customer
// column, fixed/sticky footers + dialogs inside the column, widest paragraph in ch (<= ~70ch), lib audit. No spend.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, SCRATCH, apiJson, audit, chromium, log, newPhone, onboard, sessionOf, settle } from "../phase3/lib.mjs";

mkdirSync(EVID, { recursive: true });
const LENA = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const VPS = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];

async function measure(page, kind) {
  return page.evaluate((kind) => {
    const W = innerWidth;
    const vis = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const skip = (el) => !!el.closest("vercel-live-feedback, [data-vercel-toolbar], nextjs-portal");
    let minX = Infinity, maxX = -Infinity;
    const leaves = [...document.body.querySelectorAll("p, h1, h2, h3, span, button, a, input, label, li, svg, img, output")].filter((e) => vis(e) && !skip(e));
    for (const e of leaves) { const r = e.getBoundingClientRect(); if (r.right < 0 || r.left > W) continue; minX = Math.min(minX, r.left); maxX = Math.max(maxX, r.right); }
    const fixed = [...document.body.querySelectorAll("*")].filter((e) => { const p = getComputedStyle(e).position; return (p === "fixed" || p === "sticky") && vis(e) && !skip(e) && e.getBoundingClientRect().width > 40; })
      .map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), role: e.getAttribute("role"), footer: e.hasAttribute("data-vx-footer"), x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), bg: getComputedStyle(e).backgroundColor }; });
    const dialogs = [...document.querySelectorAll("[role=dialog]")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; });
    const ch = (el) => { const s = getComputedStyle(el); const m = document.createElement("span"); m.textContent = "0".repeat(20); m.style.cssText = `position:absolute;visibility:hidden;font:${s.font};letter-spacing:${s.letterSpacing}`; document.body.appendChild(m); const w = m.getBoundingClientRect().width / 20; m.remove(); return w; };
    const paras = [...document.querySelectorAll("p")].filter((e) => vis(e) && !skip(e) && e.textContent.trim().length > 60).map((e) => ({ t: e.textContent.trim().slice(0, 40), ch: Math.round(e.getBoundingClientRect().width / ch(e)) }));
    const widestPara = paras.sort((a, b) => b.ch - a.ch)[0] ?? null;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    const contentW = Math.round(maxX - minX);
    const centreOff = Math.round((minX + maxX) / 2 - W / 2);
    const res = { kind, W, hScroll: document.documentElement.scrollWidth > W + 1, minX: Math.round(minX), maxX: Math.round(maxX), contentW, centreOff, edgeOk: minX >= 32 && maxX <= W - 32, fixed, dialogs, widestPara, bodyBg, htmlBg };
    if (kind === "column") {
      res.columnOk = contentW <= 520 && Math.abs(centreOff) <= 24;
      res.fixedInColumn = fixed.every((f) => f.w <= 540 && f.x >= minX - 40 && f.right <= maxX + 40);
      res.dialogsInColumn = dialogs.every((d) => d.w <= 540);
    } else {
      res.wideOk = contentW <= 1220 && (W <= 1280 || Math.abs(centreOff) <= 24);
    }
    res.paraOk = !widestPara || widestPara.ch <= 75;
    return res;
  }, kind);
}

// Real pay sheet + success (interception only: the quote is "funded", POST /payments is answered 202 and the intent is
// reported settled; nothing is relayed). Orders come from the QE errors venue (owner token saved by check-errors.mjs).
const EV = JSON.parse(readFileSync(join(SCRATCH, "errors-venue.json"), "utf8"));
async function liveOrder() {
  const r = await apiJson(`/venues/${EV.venue}/orders`, { method: "POST", token: EV.token, body: { amount: "500000", ttlSeconds: 600 } });
  if (r.status !== 201) throw new Error(`order ${r.status} ${JSON.stringify(r.json)}`);
  return `/pay?v=${r.json.order.venue}&o=${r.json.order.orderId}`;
}
const funded = async (route) => {
  const res = await route.fetch(); const j = await res.json();
  if (j.error) return route.fulfill({ response: res, json: j });
  j.balance = { baseUnits: "50000000", display: "50.00" }; j.canAfford = true; j.warnings = (j.warnings ?? []).filter((w) => w !== "insufficient_balance");
  await route.fulfill({ response: res, json: j });
};
async function livePay(p, tag) {
  const o = await liveOrder();
  await p.page.route("**/payments/quote", funded);
  await p.page.goto(`${BASE}${o}`);
  const btn = p.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ });
  await btn.waitFor({ timeout: 60_000 }); await p.page.waitForTimeout(1200);
  const out = [["pay-confirm-live", await measure(p.page, "column"), await audit(p.page, "pay-confirm-live")]];
  await p.page.screenshot({ path: join(EVID, `pay-confirm-live-${tag}.png`) });
  const me = (await sessionOf(p.page)).address; const fakeId = "00000000-0000-4000-8000-0000000000a9"; const oid = o.split("o=")[1];
  const H = { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true" };
  await p.page.route("**/payments", (route) => route.request().method() === "POST" ? route.fulfill({ status: 202, contentType: "application/json", headers: H, body: JSON.stringify({ intentId: fakeId, status: "pending", txHash: `0x${"a9".repeat(32)}`, relayId: "qe" }) }) : route.fallback());
  await p.page.route(`**/payments/${fakeId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: H, body: JSON.stringify({ intentId: fakeId, status: "settled", settled: { source: "streams", venue: EV.venue, customer: me, orderId: oid, amount: { baseUnits: "500000", display: "0.50" }, venueAmount: { baseUnits: "500000", display: "0.50" }, rewardPool: { baseUnits: "0", display: "0.00" }, firstPurchase: true, rewarded: false, weightsMode: 0, txHash: `0x${"a9".repeat(32)}`, blockNumber: "1", blockTime: Math.floor(Date.now() / 1000), lines: [] } }) }));
  await btn.click(); await p.page.waitForTimeout(6000);
  out.push(["success-live-forced", await measure(p.page, "column"), await audit(p.page, "success-live-forced")]);
  await p.page.screenshot({ path: join(EVID, `success-live-forced-${tag}.png`) });
  await p.page.unrouteAll({ behavior: "ignoreErrors" });
  return out;
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const R = { base: BASE, at: new Date().toISOString(), screens: [] };
try {
  for (const vp of VPS) {
    const tag = `${vp.width}x${vp.height}`;
    const anon = await newPhone(browser, "anon", { viewport: vp, reducedMotion: "reduce" });
    const cust = await newPhone(browser, "cust", { viewport: vp, reducedMotion: "reduce" });
    await cust.page.goto(`${BASE}/`); await settle(cust.page); await onboard(cust.page, "Desk");
    await cust.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
    await cust.page.waitForTimeout(1500);
    const list = [
      [anon, "/", "sign-in", "column"],
      [cust, "/wallet", "wallet-new", "column"],
      [cust, "/scan", "scan", "column"],
      [anon, "/design/screens/wallet", "wallet-mock", "column"],
      [anon, "/design/screens/pay-confirm", "pay-confirm-mock", "column"],
      [anon, "/design/screens/success", "success-mock", "column"],
      [anon, "/design/screens/recommend", "recommend-mock", "column"],
      [anon, "/design/screens/recommend-link", "recommend-link-mock", "column"],
      [anon, "/design/screens/order-entry", "venue-counter-mock", "column"],
      [anon, "/design/screens/order-qr", "venue-order-qr-mock", "column"],
      [cust, "/venue/new", "venue-new", "wide"],
      [cust, `/venue/${LENA}`, "projector-lena", "wide"],
      [anon, "/transparency", "transparency", "wide"],
    ];
    for (const [p, url, name, kind] of list) {
      p.takeErrs();
      await p.page.goto(`${BASE}${url}`); await settle(p.page, 2500);
      const m = await measure(p.page, kind);
      const a = await audit(p.page, name, { primary: name !== "transparency" });
      const errs = p.takeErrs().filter((e) => !/Failed to load resource/.test(e.text));
      await p.page.screenshot({ path: join(EVID, `${name}-${tag}.png`) });
      const rec = { name, url, vp: tag, ...m, primaryCount: a.primaryCount, banned: a.banned.map((b) => b.word), moneyBad: a.moneyBad, smallTargets: a.smallTargets, errs };
      R.screens.push(rec);
      log(tag, name, JSON.stringify({ hScroll: m.hScroll, edgeOk: m.edgeOk, minX: m.minX, maxX: m.maxX, centreOff: m.centreOff, columnOk: m.columnOk, wideOk: m.wideOk, fixedInColumn: m.fixedInColumn, para: m.widestPara?.ch, P: a.primaryCount, small: a.smallTargets.length, errs: errs.length }));
    }
    try {
      for (const [name, m, a] of await livePay(cust, tag)) {
        R.screens.push({ name, vp: tag, ...m, primaryCount: a.primaryCount, banned: a.banned.map((b) => b.word), moneyBad: a.moneyBad, smallTargets: a.smallTargets });
        log(tag, name, JSON.stringify({ hScroll: m.hScroll, edgeOk: m.edgeOk, minX: m.minX, maxX: m.maxX, centreOff: m.centreOff, columnOk: m.columnOk, fixedInColumn: m.fixedInColumn, dialogs: m.dialogs, para: m.widestPara?.ch, P: a.primaryCount }));
      }
    } catch (e) { R.screens.push({ name: "live-pay", vp: tag, error: String(e?.message ?? e) }); log("live-pay error", String(e?.message ?? e)); }
    await anon.ctx.close(); await cust.ctx.close();
  }
} catch (e) {
  R.error = String(e?.stack ?? e); console.error(e);
} finally {
  writeFileSync(join(EVID, "desktop-layout.json"), JSON.stringify(R, null, 2));
  await browser.close();
}
