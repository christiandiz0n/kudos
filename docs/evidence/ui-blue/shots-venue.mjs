// UI_DESIGN (venue/theme) A9 before/after screenshots.
// node docs/evidence/ui-blue/shots-venue.mjs --base https://vouch-ubc.vercel.app --dir before
// node docs/evidence/ui-blue/shots-venue.mjs --base http://localhost:3100 --dir after   [--only live|mocks]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, ROOT, audit, chromium, log, newPhone, onboard, settle } from "../../../e2e/phase3/lib.mjs";
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = join(ROOT, "docs/evidence/ui-blue", arg("dir") ?? "after");
const ONLY = arg("only");
const V = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const PHONE = { width: 390, height: 844 }, WIDE = { width: 1280, height: 720 }, BIG = { width: 1440, height: 900 };
const MOCKS = ["venue-onboarding", "order-entry", "order-qr", "order-qr-low", "order-qr-paid", "venue-dashboard", "venue-dashboard-empty", "transparency"];
const WIDE_MOCKS = ["venue-dashboard-desktop", "venue-dashboard-desktop-empty", "money-graph-5"];
const b = await chromium.launch();
const AUD = [];
const snap = async (page, name, { technical = false } = {}) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) }); log("shot", name);
  const a = await audit(page, name, { primary: !technical });
  AUD.push({ name, banned: a.banned, bannedA11y: a.bannedA11y, moneyBad: a.moneyBad, smallTargets: a.smallTargets });
};
try {
  if (ONLY !== "live") {
    for (const vp of [PHONE, WIDE]) {
      const c = await newPhone(b, "mocks", { viewport: vp, reducedMotion: "reduce" });
      const tag = `${vp.width}x${vp.height}`;
      const list = vp === WIDE ? [...MOCKS, ...WIDE_MOCKS] : MOCKS;
      for (const id of list) {
        await c.page.goto(`${BASE}/design/screens/${id}`); await settle(c.page, 1200);
        await snap(c.page, `mock-${id}-${tag}`, { technical: id === "transparency" });
      }
      for (const [r, n] of [["/transparency", "transparency"], ["/design", "design-system"]]) {
        await c.page.goto(`${BASE}${r}`); await settle(c.page, 1500);
        await snap(c.page, `${n}-${tag}`, { technical: true });
      }
      await c.ctx.close();
    }
  }
  if (ONLY !== "mocks") {
    for (const vp of [PHONE, WIDE, BIG]) {
      const tag = `${vp.width}x${vp.height}`;
      const c = await newPhone(b, `proj${vp.width}`, { viewport: vp, reducedMotion: "reduce" });
      await c.page.goto(`${BASE}/`); await settle(c.page);
      await onboard(c.page, "Shots");
      await c.page.waitForTimeout(4000);
      await c.page.goto(`${BASE}/venue/${V}`); await settle(c.page, 4000);
      const row = c.page.getByText(/Ben paid \$12\.00/).filter({ visible: true }).first();
      const box = await row.boundingBox().catch(() => null);
      const inView = !!box && box.y >= 0 && box.y + box.height <= vp.height;
      const n = await c.page.locator('[aria-label="Payments, newest first"] li').filter({ visible: true }).count();
      const docH = await c.page.evaluate(() => document.documentElement.scrollHeight);
      log(tag, "rows", n, "Ben $12.00 in first viewport (no scroll):", inView, box && Math.round(box.y), "docH", docH);
      await snap(c.page, `live-lena-dashboard-${tag}`);
      await c.page.goto(`${BASE}/venue/new`); await settle(c.page, 1500);
      await snap(c.page, `live-venue-new-${tag}`);
      await c.ctx.close();
    }
  }
} finally {
  await b.close();
  writeFileSync(join(OUT, `audit-venue${ONLY ? "-" + ONLY : ""}.json`), JSON.stringify(AUD, null, 2));
}
