// A9 addendum (desktop framing) screenshots, headless.
// node docs/evidence/ui-blue/shots-desktop.mjs --base <origin> --dir <out dir under docs/evidence/ui-blue> [--mobile]
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { BASE, ROOT, chromium, log, newPhone, onboard, settle } from "../../../e2e/phase3/lib.mjs";
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = join(ROOT, "docs/evidence/ui-blue", arg("dir") ?? "after-desktop");
mkdirSync(OUT, { recursive: true });
const MOBILE = argv.includes("--mobile");
const V = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const b = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const snap = async (page, name) => { await page.screenshot({ path: join(OUT, `${name}.png`) }); log("shot", name); };
try {
  const vp = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const pre = MOBILE ? "m-" : "";
  const c = await newPhone(b, "desk", { viewport: vp, reducedMotion: "reduce" });
  const p = c.page;
  await p.goto(`${BASE}/`); await settle(p, 1500);
  await snap(p, `${pre}sign-in`);
  await onboard(p, "Shots");
  await p.waitForURL(/\/wallet/, { timeout: 30_000 }).catch(() => {});
  await p.goto(`${BASE}/wallet`); await settle(p, 3000);
  await snap(p, `${pre}wallet`);
  if (!MOBILE) {
    await p.goto(`${BASE}/scan`); await settle(p, 2500);
    await snap(p, "scan");
  }
  for (const [id, name] of MOBILE ? [["pay-confirm", "pay-confirm"]] : [["pay-confirm", "pay-confirm"], ["success", "success"], ["recommend", "recommend"], ["order-entry", "counter"]]) {
    await p.goto(`${BASE}/design/screens/${id}`); await settle(p, 1500);
    await snap(p, `${pre}${name}`);
  }
  if (!MOBILE) {
    await p.goto(`${BASE}/transparency`); await settle(p, 2000);
    await snap(p, "transparency");
    for (const [w, h] of [[1440, 900], [1280, 720]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(`${BASE}/venue/${V}`); await settle(p, 4000);
      const row = p.getByText(/Ben paid \$12\.00/).filter({ visible: true }).first();
      const box = await row.boundingBox().catch(() => null);
      const docH = await p.evaluate(() => document.documentElement.scrollHeight);
      log(`${w}x${h}`, "Ben $12.00 visible without scrolling:", !!box && box.y >= 0 && box.y + box.height <= h, box && Math.round(box.y), "docH", docH);
      await snap(p, w === 1440 ? "lena-dashboard" : "lena-dashboard-1280x720");
    }
  }
} finally { await b.close(); }
