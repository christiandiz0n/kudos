// QE_E2E ui-v2 probes (headless, no spend): F2 pending amount contrast, F4 "I run a venue" target at desktop,
// F3 selected chip fill, visitor-dashboard dark contrast sampled over time (normal motion).
//   QE_SCRATCH=<tmp> node e2e/ui-v2/qe-v2-probe.mjs --base https://vouch-ubc-blue.vercel.app --out docs/evidence/ui-v2/qe/v2
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, chromium, log, newPhone, settle } from "../phase3/lib.mjs";
mkdirSync(EVID, { recursive: true });
const R = { base: BASE, at: new Date().toISOString() };
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
const browser = await chromium.launch();
try {
  // F2: wallet mock, light, the pending money-out amount
  const p = await newPhone(browser, "f2"); await p.page.emulateMedia({ colorScheme: "light" });
  await p.page.goto(`${BASE}/design/screens/wallet`); await settle(p.page, 2500);
  R.f2 = (await contrast(p.page)).filter((x) => /^[−-]\$|^\+\$|Pending/.test(x.text));
  await p.page.screenshot({ path: join(EVID, "f2-wallet-mock-light-390.png"), fullPage: true });
  // F3: pay-confirm selected chip background vs primary button
  await p.page.goto(`${BASE}/design/screens/pay-confirm`); await settle(p.page, 2000);
  R.f3 = await p.page.evaluate(() => [...document.querySelectorAll("[role=radio],button")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ t: (e.getAttribute("aria-label") || e.innerText).trim().slice(0, 50), checked: e.getAttribute("aria-checked"), bg: getComputedStyle(e).backgroundColor, border: getComputedStyle(e).borderColor, shadow: getComputedStyle(e).boxShadow.slice(0, 60) })));
  await p.page.screenshot({ path: join(EVID, "f3-pay-confirm-light-390.png") });
  await p.ctx.close();
  // F4: "I run a venue" at desktop
  R.f4 = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const d = await newPhone(browser, "f4", { viewport: vp });
    await d.page.goto(`${BASE}/`); await settle(d.page, 1500);
    const l = d.page.getByRole("link", { name: /I run a venue/ });
    const b = await l.boundingBox();
    R.f4.push({ vp: `${vp.width}x${vp.height}`, box: b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)])), pass: !!b && b.height >= 44 && b.width >= 44 });
    if (vp.width === 1440) await d.page.screenshot({ path: join(EVID, "f4-sign-in-1440x900.png") });
    await d.ctx.close();
  }
  // Visitor dashboard mock, dark + light, normal motion, sampled over time
  R.visitor = [];
  for (const scheme of ["dark", "light"]) {
    const v = await newPhone(browser, "vis"); await v.page.emulateMedia({ colorScheme: scheme });
    await v.page.goto(`${BASE}/design/screens/venue-dashboard-visitor`, { waitUntil: "domcontentloaded" });
    for (const t of [300, 700, 1200, 2000, 3500, 6000]) {
      await v.page.waitForTimeout(t - (R.visitor.filter((x) => x.scheme === scheme).at(-1)?.t ?? 0));
      const c = await contrast(v.page);
      const anims = await v.page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => `${a.animationName ?? "?"}:${a.effect?.getTiming?.().iterations}`));
      R.visitor.push({ scheme, t, fails: c.filter((x) => !x.pass && !x.disabled).map((x) => [x.text, x.ratio, x.fg, x.bg, x.size]), running: anims });
      log("visitor", scheme, t, JSON.stringify(R.visitor.at(-1).fails), anims.length);
      if (t === 6000) await v.page.screenshot({ path: join(EVID, `visitor-dashboard-${scheme}-390-6s.png`), fullPage: true });
    }
    await v.ctx.close();
  }
} catch (e) { R.error = String(e?.stack ?? e); console.error(e); process.exitCode = 1; }
finally { writeFileSync(join(EVID, "qe-v2-probe.json"), JSON.stringify(R, null, 2)); await browser.close(); }
