/**
 * Phase 3 gate fix pass (UI_DESIGN): before/after shots of the fixed /design screens at a real phone viewport.
 *
 *   FIX_PHASE=before|after node --no-warnings scripts/design-shots-fixes.ts
 *
 * Unlike design-shots.ts this does NOT grow the viewport to the page height: 390×844 is what a phone shows, so
 * sticky-footer overlaps (QE-3-02) stay visible. Writes docs/evidence/phase-3/fixes/ui/<phase>-<name>.png.
 * Env: DESIGN_BASE_URL (default http://localhost:3100, the shared dev server), FIX_ONLY (comma list of names).
 * Shots whose /design id doesn't exist yet are skipped (new states exist only "after").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../docs/evidence/phase-3/fixes/ui");
const BASE = process.env.DESIGN_BASE_URL ?? "http://localhost:3100";
const PHASE = process.env.FIX_PHASE ?? "after";
const ONLY = process.env.FIX_ONLY ? new Set(process.env.FIX_ONLY.split(",")) : null;

type Shot = { name: string; id: string; desktop?: boolean; dark?: boolean; act?: (p: Page) => Promise<void> };

const scrollBottom = async (p: Page) => {
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await p.waitForTimeout(250);
};
const scrollTo = (sel: string) => async (p: Page) => {
  await p.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 360);
  }, sel);
  await p.waitForTimeout(250);
};
const focusFirstInput = async (p: Page) => {
  await p.locator("input").first().focus();
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  await p.waitForTimeout(150);
};
const tapMinOrder = async (p: Page) => {
  // A tap on the field: the browser scrolls it into view; it must land above the sticky Confirm button.
  await p.getByLabel("Minimum first order for a reward").focus();
  await p.waitForTimeout(300);
};

const SHOTS: Shot[] = [
  // QE-3-02 / MSG-115
  { name: "qe-3-02-venue-onboarding", id: "venue-onboarding" },
  { name: "qe-3-02-venue-onboarding-mid-scroll", id: "venue-onboarding", act: scrollTo("[data-min-order]") },
  { name: "qe-3-02-venue-onboarding-bottom", id: "venue-onboarding", act: scrollBottom },
  { name: "qe-3-02-venue-onboarding-focus-min", id: "venue-onboarding", act: tapMinOrder },
  { name: "qe-3-02-venue-onboarding-error-bottom", id: "venue-onboarding-error", act: scrollBottom },
  // QE-3-01
  { name: "qe-3-01-pay-failed", id: "pay-failed" },
  { name: "qe-3-01-pay-invalid-link", id: "pay-invalid-link" },
  { name: "qe-3-01-pay-invalid-link-dark", id: "pay-invalid-link", dark: true },
  // MSG-096
  { name: "msg-096-wallet", id: "wallet" },
  // MSG-107 (money graph badge + same-column arcs)
  { name: "msg-107-money-graph-60", id: "money-graph-60", desktop: true },
  { name: "msg-107-dashboard-projector-network", id: "venue-dashboard-desktop-network", desktop: true },
  { name: "msg-107-money-graph-60-390", id: "money-graph-60" },
  // MSG-101 + QE-3-04
  { name: "msg-101-dashboard-cost-tiny", id: "venue-dashboard-cost-tiny" },
  { name: "qe-3-04-dashboard-kpi", id: "venue-dashboard", act: scrollTo("[data-kpi]") },
  // MSG-119 (optional ask): visitor view of someone else's dashboard
  { name: "msg-119-dashboard-visitor", id: "venue-dashboard-visitor" },
  { name: "msg-119-dashboard-visitor-feed", id: "venue-dashboard-visitor", act: scrollBottom },
  // QE-3-03 / MSG-100 #1
  { name: "qe-3-03-success-first-visit", id: "success-first-visit" },
  { name: "qe-3-03-success-below-minimum", id: "success-below-minimum" },
  { name: "qe-3-03-success-repeat", id: "success-repeat" },
  // MSG-100 #2 / #3
  { name: "msg-100-pay-below-minimum", id: "pay-below-minimum" },
  { name: "msg-100-pay-first-no-rec", id: "pay-no-recommendation" },
  { name: "msg-100-pay-backdrop", id: "pay-backdrop" },
  // QE-3-06 / QE-3-07
  { name: "qe-3-06-toast", id: "wallet-toast" },
  { name: "qe-3-07-textfield-focus", id: "sign-in", act: focusFirstInput },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const log: Array<Record<string, unknown>> = [];
  for (const s of SHOTS.filter((x) => !ONLY || ONLY.has(x.name))) {
    const ctx = await browser.newContext({
      viewport: s.desktop ? { width: 1280, height: 720 } : { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: s.dark ? "dark" : "light",
      reducedMotion: "reduce",
      hasTouch: !s.desktop,
      isMobile: !s.desktop,
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/design/screens/${s.id}`, { waitUntil: "networkidle" });
    const exists = await page.locator(`[data-screen="${s.id}"]`).count();
    if (!exists) {
      log.push({ name: s.name, id: s.id, skipped: "id not in /design yet" });
      await ctx.close();
      continue;
    }
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.waitForTimeout(300);
    if (s.act) await s.act(page);
    const file = `${PHASE}-${s.name}.png`;
    await page.screenshot({ path: join(OUT, file) });
    log.push({ name: s.name, id: s.id, file, errors });
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT, `${PHASE}-shots.json`), JSON.stringify({ base: BASE, at: new Date().toISOString(), shots: log }, null, 2));
  console.log(JSON.stringify(log, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
