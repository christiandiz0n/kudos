// QE_E2E ui-v2 (independent): dark/light contrast after animations settle, CLS, visible "Vouch", rendered selectors,
// reduced motion on every mock, green audit. HEADLESS (lib.mjs forces it). No spend: fresh sign-ins only; nothing
// relayed, no top-up pressed, venue onboarding "Confirm" never pressed.
//   QE_SCRATCH=<tmp> node e2e/ui-v2/qe-v2.mjs --base https://vouch-ubc-blue.vercel.app --out docs/evidence/ui-v2/qe/v2
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, chromium, log, newPhone, onboard, runningAnimations, settle } from "../phase3/lib.mjs";

mkdirSync(EVID, { recursive: true });
const LENA = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const R = { base: BASE, at: new Date().toISOString(), contrast: [], cls: [], vouch: [], selectors: [], motion: [], green: [] };
const save = () => writeFileSync(join(EVID, "qe-v2.json"), JSON.stringify(R, null, 2));

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

/** Wait for every finite animation to finish (normal motion), max 6s. */
async function animationsDone(page) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => { const t = a.effect?.getTiming?.(); return t && t.iterations !== Infinity; }).map((a) => a.finished.catch(() => {}))),
    new Promise((r) => setTimeout(r, 6000)),
  ]));
  await page.waitForTimeout(300);
}
const vouchScan = (page) => page.evaluate(() => {
  const hits = [];
  const body = document.body.innerText;
  for (const m of body.matchAll(/[^\n]{0,40}vouch[^\n]{0,40}/gi)) if (!/https?:\/\/|vercel\.app|\.app\b/i.test(m[0])) hits.push({ where: "text", s: m[0].trim() });
  for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder]")) for (const a of ["aria-label", "alt", "title", "placeholder"]) { const v = el.getAttribute(a); if (v && /vouch/i.test(v) && !/https?:\/\//.test(v)) hits.push({ where: a, s: v.slice(0, 80) }); }
  return { title: document.title, hits };
});
const greenScan = (page) => page.evaluate(() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgb = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data]; };
  const isGreen = ([r, g, b, a]) => a > 40 && g > r + 25 && g > b + 5;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none") continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const fg = own && isGreen(rgb(s.color)); const bg = isGreen(rgb(s.backgroundColor)) && r.width > 6;
    const st = el instanceof SVGElement && (isGreen(rgb(s.stroke || "none")) || isGreen(rgb(s.fill || "none")));
    if (fg || bg || st) out.push({ kind: fg ? "text" : bg ? "bg" : "svg", tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60) });
  }
  return out.slice(0, 40);
});
async function signedIn(browser, label, opts = {}) {
  const p = await newPhone(browser, label, opts);
  await p.page.goto(`${BASE}/`); await settle(p.page);
  await onboard(p.page, label.replace(/[^A-Za-z]/g, "").slice(0, 12) || "Qe");
  await p.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await p.page.waitForTimeout(1500);
  return p;
}
const MOCKS = ["sign-in", "sign-in-error", "wallet", "wallet-empty", "wallet-loading", "wallet-offline", "wallet-toast", "scan", "scan-manual", "scan-denied",
  "pay-confirm", "pay-quoting", "pay-repeat", "pay-insufficient", "pay-expired", "pay-unavailable", "pay-failed", "pay-cancelled", "pay-offline", "pay-invalid-link", "pay-below-minimum", "pay-no-recommendation",
  "success-pending", "success", "success-first-visit", "success-repeat", "intro", "intro-accepted", "intro-expired", "intro-already-customer",
  "recommend", "recommend-link", "recommend-locked", "ambassador", "venue-onboarding", "venue-onboarding-error", "order-entry", "order-entry-error",
  "order-qr", "order-qr-low", "order-qr-expired", "order-qr-paid", "venue-dashboard", "venue-dashboard-network", "venue-dashboard-visitor", "venue-dashboard-empty", "venue-dashboard-offline", "transparency"];

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  // ---------------------------------------------------------------- 1. contrast, light + dark, NORMAL motion, after animations finish
  for (const scheme of ["light", "dark"]) {
    const p = await newPhone(browser, `c-${scheme}`);
    await p.page.emulateMedia({ colorScheme: scheme });
    for (const id of ["__live_signin", ...MOCKS]) {
      const url = id === "__live_signin" ? "/" : `/design/screens/${id}`;
      await p.page.goto(`${BASE}${url}`); await settle(p.page, 1200);
      const early = id === "venue-dashboard-visitor" ? (await contrast(p.page)).filter((x) => !x.pass && !x.disabled) : undefined;
      await animationsDone(p.page);
      const c = await contrast(p.page);
      const fails = c.filter((x) => !x.pass && !x.disabled);
      const prim = c.filter((x) => x.bucket === "primary button text");
      const v = await vouchScan(p.page);
      R.contrast.push({ scheme, id, url, n: c.length, fails, failsAt1200ms: early, primaryMin: prim.length ? Math.min(...prim.map((x) => x.ratio)) : null, primary: prim.slice(0, 2), errs: p.takeErrs() });
      R.vouch.push({ scheme, url, ...v });
      if (scheme === "light") R.green.push({ url, green: await greenScan(p.page) });
      if (["venue-dashboard-visitor", "pay-confirm", "wallet", "success"].includes(id) || fails.length) await p.page.screenshot({ path: join(EVID, `contrast-${id}-${scheme}.png`) });
      log("contrast", scheme, id, `fails=${fails.length}`, early ? `early=${early.length}` : "", v.hits.length ? `VOUCH=${JSON.stringify(v.hits)}` : "");
    }
    await p.ctx.close(); save();
  }
  // ---------------------------------------------------------------- 2. reduced motion on every mock (390)
  {
    const p = await newPhone(browser, "rm", { reducedMotion: "reduce" });
    for (const id of MOCKS) {
      await p.page.goto(`${BASE}/design/screens/${id}`); await settle(p.page, 600);
      const a1 = await runningAnimations(p.page); await p.page.waitForTimeout(700); const a2 = await runningAnimations(p.page);
      R.motion.push({ id, runningAt600ms: a1, runningAt1300ms: a2 });
      if (a1.length || a2.length) log("motion RUNNING", id, a1, a2);
    }
    await p.ctx.close(); save();
  }
  // ---------------------------------------------------------------- 3. CLS (normal motion): sign-in, wallet (signed in), Lena dashboard 390 + 1440
  const clsInit = () => { window.__cls = 0; window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push({ v: Math.round(e.value * 10000) / 10000, t: Math.round(e.startTime), src: (e.sources || []).map((s) => s.node ? `${s.node.nodeName}.${(s.node.className?.baseVal ?? s.node.className ?? "").toString().slice(0, 40)}` : "?").slice(0, 3) }); } }).observe({ type: "layout-shift", buffered: true }); };
  const cls = async (p, name, url, wait = 5000) => {
    await p.page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" }); await p.page.waitForTimeout(wait);
    const r = await p.page.evaluate(() => ({ cls: Math.round(window.__cls * 10000) / 10000, shifts: window.__shifts }));
    R.cls.push({ name, url, vp: p.page.viewportSize(), ...r, pass: r.cls < 0.1 });
    log("CLS", name, r.cls, JSON.stringify(r.shifts).slice(0, 300));
  };
  {
    const anon = await newPhone(browser, "cls-anon"); await anon.ctx.addInitScript(clsInit);
    await cls(anon, "sign-in-390", "/"); await anon.ctx.close();
    const cu = await signedIn(browser, "Clsy"); await cu.ctx.addInitScript(clsInit);
    await cls(cu, "wallet-390", "/wallet"); await cls(cu, "lena-dashboard-390", `/venue/${LENA}`, 7000);
    await cu.ctx.close();
    const big = await signedIn(browser, "Clsbig", { viewport: { width: 1440, height: 900 } }); await big.ctx.addInitScript(clsInit);
    await cls(big, "sign-in-1440", "/"); await cls(big, "wallet-1440", "/wallet"); await cls(big, "lena-dashboard-1440", `/venue/${LENA}`, 7000);
    await big.ctx.close(); save();
  }
  // ---------------------------------------------------------------- 4. rendered selectors the e2e / P4 scripts rely on
  const sel = async (page, where, name, loc) => {
    const n = await loc.count().catch(() => 0); const vis = n ? await loc.first().isVisible().catch(() => false) : false;
    const box = vis ? await loc.first().boundingBox() : null;
    R.selectors.push({ where, name, count: n, visible: vis, h: box ? Math.round(box.height) : null, y: box ? Math.round(box.y) : null });
    log("selector", where, name, n, vis, box ? Math.round(box.height) : "");
  };
  {
    const a = await newPhone(browser, "sel-anon");
    await a.page.goto(`${BASE}/`); await settle(a.page, 1200);
    await sel(a.page, "/", "Continue with Face ID or fingerprint", a.page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }));
    await sel(a.page, "/", "I already have an account", a.page.getByRole("button", { name: /I already have an account/ }));
    await sel(a.page, "/", "I run a venue (link)", a.page.getByRole("link", { name: /I run a venue/ }));
    await sel(a.page, "/", "first name (label)", a.page.getByLabel(/first name/i));
    await a.page.screenshot({ path: join(EVID, "sel-sign-in-390.png") });
    for (const [id, name, loc] of [
      ["pay-confirm", "Confirm with Face ID or fingerprint", (pg) => pg.getByRole("button", { name: /Confirm with Face ID or fingerprint/ })],
      ["intro", "Save <name>'s recommendation", (pg) => pg.getByRole("button", { name: /Save .* recommendation/ })],
      ["order-entry", "Show code", (pg) => pg.getByRole("button", { name: /Show code/ })],
      ["recommend", "Make my link", (pg) => pg.getByRole("button", { name: /Make my link/ })],
      ["venue-onboarding", "Name customers will see", (pg) => pg.getByLabel(/Name customers will see/i)],
      ["venue-onboarding", "Minimum first order", (pg) => pg.getByLabel(/Minimum first order/i)],
      ["venue-dashboard", "Latest (tab)", (pg) => pg.getByRole("tab", { name: /Latest/ })],
      ["venue-dashboard", "Everyone (tab)", (pg) => pg.getByRole("tab", { name: /Everyone/ })],
      ["venue-dashboard", "Everyone (button)", (pg) => pg.getByRole("button", { name: /Everyone/ })],
      ["venue-dashboard", "Everyone (radio)", (pg) => pg.getByRole("radio", { name: /Everyone/ })],
      ["wallet", "Top up (testnet demo)", (pg) => pg.getByRole("button", { name: /Top up \(testnet demo\)/ })],
    ]) { await a.page.goto(`${BASE}/design/screens/${id}`); await settle(a.page, 1000); await sel(a.page, `/design/screens/${id}`, name, loc(a.page)); }
    await a.ctx.close();
    const cu = await signedIn(browser, "Selly");
    await cu.page.goto(`${BASE}/wallet`); await settle(cu.page, 3000);
    await sel(cu.page, "/wallet (live)", "Top up (testnet demo)", cu.page.getByRole("button", { name: /Top up \(testnet demo\)/ }));
    await cu.page.goto(`${BASE}/venue/${LENA}`); await settle(cu.page, 4000);
    await sel(cu.page, "/venue/LENA (live)", "Latest (tab)", cu.page.getByRole("tab", { name: /Latest/ }));
    await sel(cu.page, "/venue/LENA (live)", "Everyone (tab)", cu.page.getByRole("tab", { name: /Everyone/ }));
    await sel(cu.page, "/venue/LENA (live)", "Everyone (button)", cu.page.getByRole("button", { name: /Everyone/ }));
    await sel(cu.page, "/venue/LENA (live)", "Ben paid $12.00", cu.page.getByText(/Ben paid \$12\.00/));
    await cu.page.goto(`${BASE}/venue/new`); await settle(cu.page, 3000);
    await sel(cu.page, "/venue/new (live)", "Name customers will see", cu.page.getByLabel(/Name customers will see/i));
    await sel(cu.page, "/venue/new (live)", "Confirm with Face ID or fingerprint (NOT pressed)", cu.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }));
    for (const u of ["/wallet", `/venue/${LENA}`, "/venue/new", "/scan", "/me", `/recommend?venue=${LENA}`, "/transparency"]) {
      await cu.page.goto(`${BASE}${u}`); await settle(cu.page, 2000);
      R.vouch.push({ scheme: "light", url: u, live: true, ...(await vouchScan(cu.page)) });
      R.green.push({ url: u, live: true, green: await greenScan(cu.page) });
    }
    await cu.ctx.close(); save();
  }
} catch (e) { R.error = String(e?.stack ?? e); console.error(e); process.exitCode = 1; }
finally { save(); await browser.close(); }
