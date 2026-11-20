// QE A9: rendered size of the money-graph labels on Lena's projector (1280x720) + node diameters. Headless.
//   node e2e/a9/graph-size.mjs --base <origin>
import { BASE, chromium, log, newPhone, onboard, settle } from "../phase3/lib.mjs";
const V = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const b = await chromium.launch();
try {
  const c = await newPhone(b, "g", { viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  await c.page.goto(`${BASE}/`); await settle(c.page); await onboard(c.page, "Graph");
  await c.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60000 });
  await c.page.goto(`${BASE}/venue/${V}`); await settle(c.page, 4000);
  const r = await c.page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].filter((s) => s.getBoundingClientRect().width > 300 && s.getBoundingClientRect().height > 0).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!svg) return { svg: null };
    const sr = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")].map((t) => ({ t: t.textContent.trim().slice(0, 20), h: Math.round(t.getBoundingClientRect().height * 10) / 10 })).filter((x) => x.t);
    const circles = [...svg.querySelectorAll("circle")].map((c) => Math.round(c.getBoundingClientRect().width)).filter((w) => w > 10);
    // also HTML labels overlaid on the graph (if any)
    const card = svg.closest("section, article, div");
    const html = [...(card?.querySelectorAll("span,p,div") ?? [])].filter((e) => e.children.length === 0 && e.textContent.trim() && !svg.contains(e)).map((e) => ({ t: e.textContent.trim().slice(0, 20), px: parseFloat(getComputedStyle(e).fontSize) }));
    return { svg: { w: Math.round(sr.width), h: Math.round(sr.height), x: Math.round(sr.x), y: Math.round(sr.y) }, textHeights: texts.slice(0, 14), minTextH: Math.min(...texts.map((x) => x.h)), circles: [...new Set(circles)].slice(0, 6), html: html.slice(0, 12) };
  });
  log(BASE, JSON.stringify(r));
} finally { await b.close(); }
