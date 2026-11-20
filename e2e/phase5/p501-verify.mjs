// P5-01 prod verify: signed-in visitor opens Lena's café dashboard at projector sizes; Ben's $12.00 row must be visible.
import { BASE, chromium, log, newPhone, onboard, settle } from "../phase3/lib.mjs";
const V = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const OUT = "docs/evidence/phase-5/prod/p5-01";
const b = await chromium.launch();
try {
  for (const [w, h] of [[1280, 720], [1440, 900]]) {
    const c = await newPhone(b, `proj${w}`, { viewport: { width: w, height: h } });
    await c.page.goto(`${BASE}/`); await settle(c.page);
    await onboard(c.page, "Projector");
    await c.page.waitForTimeout(4000);
    await c.page.goto(`${BASE}/venue/${V}`); await settle(c.page, 3000);
    const row = c.page.getByText(/Ben paid \$12\.00/).first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    const vis = await row.isVisible().catch(() => false);
    const n = await c.page.locator('[aria-label="Payments, newest first"] li').count();
    log(`${w}x${h}`, "feed rows", n, "Ben $12.00 visible", vis);
    await c.page.screenshot({ path: `${OUT}/lena-dashboard-${w}x${h}.png` });
  }
} finally { await b.close(); }
