/**
 * Add-to-home-screen icons (FRONTEND_INTEGRATION, Phase 3 fix pass). Renders one SVG mark with Playwright into:
 *   public/icons/icon-192.png, icon-512.png   (purpose "any": rounded square)
 *   public/icons/maskable-512.png             (purpose "maskable": full bleed, mark inside the 80% safe zone)
 *   src/app/apple-icon.png (180)              (iOS; Next adds <link rel="apple-touch-icon"> from the file convention)
 * Colors are the design tokens: accent #17694f (background), canvas #f6f4ef (mark). Deterministic; no network.
 *
 *   node --no-warnings apps/web/scripts/phase3-icons.ts
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACCENT = "#17694f"; // --vx-accent
const CANVAS = "#f6f4ef"; // --vx-canvas

/** A "V" drawn as one stroke (no font dependency), on a 100×100 grid. `scale` < 1 shrinks it for the maskable safe zone. */
function svg({ rounded, scale }: { rounded: boolean; scale: number }) {
  const t = (50 * (1 - scale)).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="${ACCENT}"/>
  <g transform="translate(${t} ${t}) scale(${scale})">
    <path d="M27 31 L50 72 L73 31" fill="none" stroke="${CANVAS}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const targets = [
  { file: "public/icons/icon-192.png", size: 192, rounded: true, scale: 1, transparent: true },
  { file: "public/icons/icon-512.png", size: 512, rounded: true, scale: 1, transparent: true },
  { file: "public/icons/maskable-512.png", size: 512, rounded: false, scale: 0.8, transparent: false },
  { file: "src/app/apple-icon.png", size: 180, rounded: false, scale: 0.9, transparent: false },
];

const browser = await chromium.launch();
try {
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t)}</body></html>`);
    const out = join(WEB, t.file);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: t.transparent });
    await page.close();
    console.log("wrote", t.file);
  }
} finally {
  await browser.close();
}
