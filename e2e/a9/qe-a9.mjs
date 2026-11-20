// QE_E2E A9 gate (blue re-skin): independent checks + before/after screenshots. HEADLESS ONLY (lib.mjs forces it).
//   node e2e/a9/qe-a9.mjs --base <origin> --out docs/evidence/ui-blue/qe/<dir> --mode shots|checks [--tag after]
// shots : demo-path screens to <out>/<file>.png (identical filenames for before/after).
// checks: WCAG contrast (light + dark scheme), focus rings, reduced motion, Lena projector $12.00 row visibility,
//         and the lib audit (banned words / money / tap targets / primary count) on every screen. Writes <out>/a9-checks.json.
// Spend: none (fresh accounts sign in only; nothing relayed; no top-up).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, audit, chromium, firstFocus, log, newPhone, onboard, runningAnimations, settle } from "../phase3/lib.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = arg("mode") ?? "checks";
const OUT = EVID; // --out dir (lib resolves it against the repo root)
mkdirSync(OUT, { recursive: true });
const LENA = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1280, height: 720 };
const BIG = { width: 1440, height: 900 };

// ------------------------------------------------------------------ contrast probe (runs in the page)
async function contrast(page) {
  return page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    const bgOf = (el) => {
      const stack = []; let img = false;
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== "none" && !/url\(/.test(s.backgroundImage)) img = true;
        const c = rgba(s.backgroundColor);
        if (c[3] > 0) { stack.push(c); if (c[3] >= 0.999) break; }
      }
      let acc = [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc);
      return { bg: acc, img };
    };
    const vis = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const opac = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
    const bucket = (el) => {
      const btn = el.closest("button, a[href], [role=button], [role=radio], [role=tab]");
      const bc = btn && typeof btn.className === "string" ? btn.className.split(/\s+/) : [];
      const c = typeof el.className === "string" ? el.className : "";
      if (bc.includes("bg-primary")) return "primary button text";
      if (btn && /text-primary-ink/.test(btn.className)) return "blue text button/link";
      if (el.closest("a[href]")) return "link";
      if (/text-primary-ink|text-primary\b/.test(c)) return "blue text";
      if (/text-accent/.test(c)) return "green text";
      if (/text-ink-3/.test(c)) return "secondary text (ink-3)";
      if (/text-ink-2/.test(c)) return "secondary text (ink-2)";
      if (/text-on-primary/.test(c)) return "text on primary fill";
      return "body text";
    };
    const rows = [];
    const seen = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent.trim() || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      seen.add(el);
      if (!vis(el) || el.closest(".sr-only")) continue;
      const s = getComputedStyle(el);
      const fg = rgba(s.color);
      const { bg, img } = bgOf(el);
      const o = opac(el);
      const fgc = over([fg[0], fg[1], fg[2], fg[3] * o], bg);
      const size = parseFloat(s.fontSize), weight = Number(s.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const btn = el.closest("button");
      const disabled = !!(btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true"));
      const r = ratio(fgc, bg);
      rows.push({ text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 40), bucket: bucket(el), fg: hex(fgc), bg: hex(bg), ratio: Math.round(r * 100) / 100, size, weight, large, need: large ? 3 : 4.5, pass: r >= (large ? 3 : 4.5), disabled, gradientBehind: img });
    }
    return rows;
  });
}
// focus ring: Tab through the first n stops; ring colour vs the background around the element (3:1, WCAG 1.4.11)
async function focusRings(page, n = 4) {
  await page.evaluate(() => document.activeElement?.blur?.());
  const out = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(200);
    out.push(await page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      const el = document.activeElement;
      if (!el || el === document.body) return { el: "body" };
      let ringEl = el, s = getComputedStyle(el);
      let color = null, how = null;
      if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) { color = s.outlineColor; how = `outline ${s.outlineWidth} offset ${s.outlineOffset}`; }
      const sh = (x) => x && x !== "none" ? x.split(/,(?![^(]*\))/).map((p) => p.trim()).filter((p) => !/rgba\(0, 0, 0, 0\)/.test(p)) : [];
      if (!color) for (const cand of [el, el.parentElement]) { const parts = sh(getComputedStyle(cand).boxShadow); const solid = parts.map((p) => ({ p, c: rgba((p.match(/(rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i) || [])[0] || "transparent") })).sort((a, b) => b.c[3] - a.c[3])[0]; if (solid && solid.c[3] > 0) { color = solid.p.match(/(rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i)[0]; how = `box-shadow on ${cand === el ? "element" : "wrapper"}: ${solid.p.slice(0, 60)}`; ringEl = cand; break; } }
      // background just outside the ring: the parent's effective bg
      let bg = [255, 255, 255, 1];
      for (let e = ringEl.parentElement; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] >= 0.999) { bg = c; break; } }
      const fill = rgba(getComputedStyle(el).backgroundColor);
      const rc = color ? rgba(color) : null;
      return { el: `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40)}`, how, ring: rc ? hex(rc) : null, around: hex(bg), ratioVsAround: rc ? Math.round(ratio(rc, bg) * 100) / 100 : null, ownFill: fill[3] > 0 ? hex(fill) : null, ratioVsOwnFill: rc && fill[3] > 0.99 ? Math.round(ratio(rc, fill) * 100) / 100 : null };
    }));
  }
  return out;
}

// ------------------------------------------------------------------ helpers
async function signedIn(browser, label, opts = {}) {
  const p = await newPhone(browser, label, opts);
  await p.page.goto(`${BASE}/`); await settle(p.page);
  await onboard(p.page, label.replace(/[^A-Za-z]/g, "").slice(0, 12) || "Qe");
  await p.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await p.page.waitForTimeout(1500);
  return p;
}
async function lenaRow(page, vp) {
  const row = page.getByText(/Ben paid \$12\.00/).filter({ visible: true }).first();
  const count = await page.getByText(/Ben paid \$12\.00/).count();
  const visible = await row.isVisible().catch(() => false);
  const box = visible ? await row.boundingBox() : null;
  const hit = box ? await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) : null; }, { x: box.x + Math.min(20, box.width / 2), y: box.y + box.height / 2 }) : null;
  const scrollY = await page.evaluate(() => scrollY);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const inView = !!box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width;
  return { vp: `${vp.width}x${vp.height}`, domMatches: count, visible, box: box && Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])), inViewWithoutScroll: inView && scrollY === 0, hitTest: hit, hitIsRow: !!hit && /Ben paid|\$12\.00|Ben/.test(hit), scrollY, docH, pass: inView && scrollY === 0 && !!hit && /Ben|\$12\.00/.test(hit) };
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const R = { base: BASE, mode: MODE, at: new Date().toISOString(), pages: [] };
try {
  if (MODE === "shots") {
    const snap = async (p, f) => { await p.page.screenshot({ path: join(OUT, `${f}.png`) }); log("shot", f); };
    const anon = await newPhone(browser, "anon", { reducedMotion: "reduce" });
    await anon.page.goto(`${BASE}/`); await settle(anon.page, 1500); await snap(anon, "01-sign-in-390");
    const cust = await signedIn(browser, "Quinn", { reducedMotion: "reduce" });
    await cust.page.goto(`${BASE}/wallet`); await settle(cust.page, 3000); await snap(cust, "02-wallet-home-new-390");
    await cust.page.goto(`${BASE}/scan`); await settle(cust.page, 2500); await snap(cust, "04-scan-390");
    for (const [id, f] of [["wallet", "03-wallet-home-mock-390"], ["pay-confirm", "05-pay-confirm-mock-390"], ["success-pending", "06-success-pending-mock-390"], ["success", "07-success-mock-390"], ["recommend", "08-recommend-mock-390"], ["recommend-link", "09-recommend-link-mock-390"], ["order-entry", "10-venue-counter-mock-390"], ["order-qr", "11-venue-order-qr-mock-390"]]) {
      await anon.page.goto(`${BASE}/design/screens/${id}`); await settle(anon.page, 1500); await snap(anon, f);
    }
    await anon.page.goto(`${BASE}/transparency`); await settle(anon.page, 2000); await snap(anon, "14-transparency-390");
    for (const [vp, f] of [[WIDE, "12-projector-lena-1280x720"], [BIG, "13-projector-lena-1440x900"]]) {
      const pj = await signedIn(browser, `Proj${vp.width}`, { viewport: vp, reducedMotion: "reduce" });
      await pj.page.goto(`${BASE}/venue/${LENA}`); await settle(pj.page, 4500); await snap(pj, f);
      await pj.ctx.close();
    }
    const w = await newPhone(browser, "wide", { viewport: WIDE, reducedMotion: "reduce" });
    await w.page.goto(`${BASE}/transparency`); await settle(w.page, 2000); await snap(w, "15-transparency-1280x720");
    await w.page.goto(`${BASE}/design/screens/order-qr`); await settle(w.page, 1500); await snap(w, "16-venue-order-qr-mock-1280x720");
  } else {
    // ---------------------------------------------------------------- per-screen audit + contrast (light), and dark scheme contrast
    const check = async (p, name, url, { wait = 2000, primary = true, rings = true } = {}) => {
      if (url) { await p.page.goto(`${BASE}${url}`); await settle(p.page, wait); }
      const a = await audit(p.page, name, { primary });
      const c = await contrast(p.page);
      const fr = rings ? await focusRings(p.page, 3) : [];
      const fails = c.filter((x) => !x.pass && !x.disabled);
      const byBucket = {};
      for (const x of c) { const b = byBucket[x.bucket] ??= { n: 0, min: 99, minRow: null }; b.n++; if (!x.disabled && x.ratio < b.min) { b.min = x.ratio; b.minRow = x; } }
      const rec = { name, url: p.page.url().replace(BASE, ""), scheme: p.scheme ?? "light", primaryCount: a.primaryCount, primaries: a.primaries, banned: a.banned, bannedA11y: a.bannedA11y, moneyBad: a.moneyBad, rawUnits: a.rawUnits, smallTargets: a.smallTargets, contrastByBucket: byBucket, contrastFails: fails, focusRings: fr, errs: p.takeErrs() };
      R.pages.push(rec);
      log(name, rec.scheme, `primary=${a.primaryCount}`, a.banned.length ? `BANNED=${a.banned.map((b) => b.word)}` : "", a.moneyBad.length ? `MONEY=${a.moneyBad}` : "", a.smallTargets.length ? `SMALL=${a.smallTargets.length}` : "", `contrastFails=${fails.length}`, rec.errs.length ? `ERRS=${rec.errs.length}` : "");
      return rec;
    };
    const MOCKS = ["sign-in", "sign-in-error", "wallet", "wallet-empty", "scan", "scan-denied", "pay-confirm", "pay-insufficient", "pay-failed", "pay-invalid-link", "success-pending", "success", "success-first-visit", "intro", "recommend", "recommend-link", "recommend-locked", "ambassador", "venue-onboarding", "order-entry", "order-qr", "order-qr-low", "order-qr-paid", "venue-dashboard", "venue-dashboard-visitor"];
    for (const scheme of ["light", "dark"]) {
      const anon = await newPhone(browser, `anon-${scheme}`);
      if (scheme === "dark") await anon.page.emulateMedia({ colorScheme: "dark" });
      anon.scheme = scheme;
      await check(anon, "live-sign-in", "/");
      await check(anon, "live-transparency", "/transparency", { primary: false });
      for (const id of scheme === "light" ? MOCKS : ["sign-in", "wallet", "pay-confirm", "success", "recommend-link", "order-qr", "venue-dashboard"]) await check(anon, `mock-${id}`, `/design/screens/${id}`, { wait: 1200 });
      await anon.ctx.close();
    }
    const cust = await signedIn(browser, "Quinn");
    await check(cust, "live-wallet-new", "/wallet", { wait: 3000 });
    await check(cust, "live-scan", "/scan", { wait: 2500 });
    await check(cust, "live-recommend-locked", `/recommend?venue=${LENA}`, { wait: 3000 });
    await check(cust, "live-me", "/me", { wait: 2500 });
    await check(cust, "live-venue-new", "/venue/new", { wait: 2500 });
    // ---------------------------------------------------------------- Lena's projector: $12.00 row visible without scrolling
    R.projector = [];
    for (const vp of [WIDE, BIG]) {
      const pj = await signedIn(browser, `Proj${vp.width}`, { viewport: vp });
      await pj.page.goto(`${BASE}/venue/${LENA}`); await settle(pj.page, 5000);
      const r = await lenaRow(pj.page, vp);
      await pj.page.screenshot({ path: join(OUT, `projector-lena-${r.vp}.png`) });
      R.projector.push(r);
      log("projector", JSON.stringify(r));
      pj.scheme = "light";
      await check(pj, `live-lena-dashboard-${r.vp}`, null);
      await pj.ctx.close();
    }
    // ---------------------------------------------------------------- reduced motion
    R.motion = [];
    for (const rm of ["reduce", "no-preference"]) {
      const p = await signedIn(browser, `Motion${rm === "reduce" ? "R" : "N"}`, { reducedMotion: rm, viewport: WIDE });
      for (const url of [`/venue/${LENA}`, "/wallet", "/design/screens/success", "/design/screens/order-qr", "/design/screens/success-pending", "/transparency", "/"]) {
        await p.page.goto(`${BASE}${url}`); await settle(p.page, 1500);
        const a1 = await runningAnimations(p.page);
        await p.page.waitForTimeout(1500);
        const a2 = await runningAnimations(p.page);
        R.motion.push({ reducedMotion: rm, url, runningAt1_5s: a1, runningAt3s: a2 });
        log("motion", rm, url, a1.length, a2.length);
      }
      await p.ctx.close();
    }
  }
} catch (e) {
  R.error = String(e?.stack ?? e);
  console.error(e);
} finally {
  if (MODE !== "shots") writeFileSync(join(OUT, "a9-checks.json"), JSON.stringify(R, null, 2));
  await browser.close();
}
