// QE A9 desktop probes (headless): (1) "I run a venue" reachable on sign-in; (2) QE-3-02 at desktop: the minimum
// field on /venue/new is not hidden under the sticky footer when focused (Tab), at 1440x900 and 1280x720.
import { join } from "node:path";
import { BASE, EVID, chromium, newPhone, onboard, settle } from "../phase3/lib.mjs";
const b = await chromium.launch();
try {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const tag = `${vp.width}x${vp.height}`;
    const a = await newPhone(b, "a", { viewport: vp, reducedMotion: "reduce" });
    await a.page.goto(`${BASE}/`); await settle(a.page, 1500);
    const link = a.page.getByRole("link", { name: /I run a venue/ });
    const before = await link.boundingBox().catch(() => null);
    const hitBefore = before ? await a.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim().slice(0, 30) ?? null, { x: before.x + before.width / 2, y: before.y + before.height / 2 }) : null;
    await link.scrollIntoViewIfNeeded().catch(() => {});
    const after = await link.boundingBox().catch(() => null);
    const hitAfter = after ? await a.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim().slice(0, 30) ?? null, { x: after.x + after.width / 2, y: after.y + after.height / 2 }) : null;
    await a.page.screenshot({ path: join(EVID, `probe-sign-in-venue-link-${tag}.png`) });
    console.log(tag, "I run a venue", JSON.stringify({ before, hitBefore, after, hitAfter, inViewAfter: !!after && after.y >= 0 && after.y + after.height <= vp.height }));
    await a.ctx.close();
    const c = await newPhone(b, "c", { viewport: vp, reducedMotion: "reduce" });
    await c.page.goto(`${BASE}/`); await settle(c.page); await onboard(c.page, "Vic");
    await c.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60000 });
    await c.page.goto(`${BASE}/venue/new`); await settle(c.page, 2000);
    const geom = () => c.page.evaluate(() => {
      const lab = [...document.querySelectorAll("label")].find((l) => /Minimum first order/i.test(l.textContent));
      const inp = lab && (document.getElementById(lab.htmlFor) || lab.parentElement.querySelector("input"));
      const footer = document.querySelector("[data-vx-footer]");
      const r = (e) => (e ? e.getBoundingClientRect() : null);
      const top = (x, y) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}:${(e.textContent || "").trim().slice(0, 30)}` : null; };
      const ir = r(inp), fr = r(footer);
      return { input: ir && { top: Math.round(ir.top), bottom: Math.round(ir.bottom) }, footerTop: fr && Math.round(fr.top), inputHit: ir ? top(ir.x + 20, ir.y + ir.height / 2) : null, focused: document.activeElement === inp };
    });
    const g0 = await geom();
    await c.page.getByLabel(/Minimum first order/i).focus();
    await c.page.waitForTimeout(800);
    const g1 = await geom();
    await c.page.screenshot({ path: join(EVID, `probe-venue-new-min-focused-${tag}.png`) });
    console.log(tag, "QE-3-02", JSON.stringify({ initial: g0, focused: g1, ok: g1.inputHit?.startsWith("input") && g1.input.bottom <= (g1.footerTop ?? 1e9) }));
    await c.ctx.close();
  }
} finally { await b.close(); }
