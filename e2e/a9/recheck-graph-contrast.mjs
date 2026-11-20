// QE A9: re-probe the money-graph label colours after the draw animation has finished (rules out a mid-fade reading).
import { BASE, chromium, newPhone, settle } from "../phase3/lib.mjs";
const b = await chromium.launch();
try {
  for (const rm of ["no-preference", "reduce"]) {
    const c = await newPhone(b, "g", { reducedMotion: rm });
    await c.page.goto(`${BASE}/design/screens/venue-dashboard`); await settle(c.page, 6000);
    const r = await c.page.evaluate(() => [...document.querySelectorAll("svg text, svg tspan")].filter((t) => /Priya|\+\$0\.69|^PR$/.test(t.textContent.trim())).map((t) => { let o = 1; for (let e = t; e && e.tagName !== "BODY"; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return { t: t.textContent.trim(), fill: getComputedStyle(t).fill, opacity: Math.round(o * 100) / 100 }; }));
    console.log(rm, JSON.stringify(r));
    await c.ctx.close();
  }
} finally { await b.close(); }
