// Quick headless look at one or more mock/public routes: node e2e/ui-v2/quick.mjs <outdir> <WxH> <path>... (light + dark).
import { createRequire } from "node:module";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pw = createRequire(join(ROOT, "apps/web/package.json"))("playwright");
const [out, size, ...paths] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const BASE = process.env.QE_BASE ?? "http://localhost:3100";
mkdirSync(out, { recursive: true });
const b = await pw.chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: width < 800 ? 2 : 1, reducedMotion: "reduce" });
const page = await ctx.newPage();
for (const p of paths) for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto(BASE + p); await page.waitForTimeout(1500);
  const f = join(out, `${p.replace(/[^a-z0-9]+/gi, "_")}-${width}-${scheme}.png`);
  await page.screenshot({ path: f }); console.log(f);
}
await b.close();
