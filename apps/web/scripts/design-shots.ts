/**
 * Captures /design for human approval + runs the design acceptance checks (UI_DESIGN, Phase 1).
 *
 *   pnpm --filter web exec next dev -p 3200      # in another terminal (never 3000/3100)
 *   pnpm --filter web design:shots               # = node --no-warnings scripts/design-shots.ts
 *
 * Writes PNGs + checks.json to docs/evidence/phase-1/design/. Env: DESIGN_BASE_URL (default http://localhost:3200).
 * Checks: no console/page errors, no banned words on primary-screen mocks (outside the Details drawer),
 * reduced motion stops the flow animation, keyboard focus is visible.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../docs/evidence/phase-1/design");
const BASE = process.env.DESIGN_BASE_URL ?? "http://localhost:3200";

// Keep in sync with src/app/design/_mocks/meta.ts (not imported: this runs under plain node).
const SCREENS: Array<{ id: string; technical?: boolean; desktop?: boolean }> = [
  { id: "sign-in" },
  { id: "intro" },
  { id: "wallet" },
  { id: "scan" },
  { id: "pay-confirm" },
  { id: "success" },
  { id: "recommend" },
  { id: "ambassador" },
  { id: "venue-onboarding" },
  { id: "order-entry" },
  { id: "order-qr" },
  { id: "venue-dashboard" },
  { id: "transparency", technical: true },
  { id: "venue-dashboard-desktop", desktop: true },
];

/** Banned on primary screens (COPY.md). "Top up (testnet demo)" is the one allowed testnet label. */
const BANNED =
  /\b(usdc|gas|wallet address|transaction|tx|hash|seed phrase|recovery phrase|private key|blockchain|on-?chain|smart contract|crypto|token|nonce|web3|eip-?\d+|testnet|referrer|referral|countersign\w*|sign(?!\s+(?:in|out|up)\b)(?:ed|ing|ature|s)?)\b|0x[0-9a-f]{4,}/gi;

const errors: string[] = [];
const results: Record<string, unknown> = { base: BASE, at: new Date().toISOString() };

function watch(page: Page, label: string) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
}

async function ready(page: Page, path: string) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  // Hide the Next dev-tools badge so it doesn't sit on top of the mocks.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(300);
}

/** Grow the viewport to the content height so sticky footers land at the bottom, not mid-image. */
async function fullHeight(page: Page, fn: () => Promise<void>) {
  const vp = page.viewportSize()!;
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  if (h > vp.height) await page.setViewportSize({ width: vp.width, height: h });
  await page.waitForTimeout(150);
  await fn();
  await page.setViewportSize(vp);
}

async function mobile(browser: Awaited<ReturnType<typeof chromium.launch>>, opts: { dark?: boolean; motion?: boolean } = {}) {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: opts.dark ? "dark" : "light",
    // Reduced motion → animations land on their final frame instantly (deterministic shots).
    reducedMotion: opts.motion ? "no-preference" : "reduce",
    hasTouch: true,
    isMobile: true,
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const shots: string[] = [];
  const save = (name: string) => {
    shots.push(name);
    return join(OUT, name);
  };

  // 1) /design sections at 390px
  {
    const ctx = await mobile(browser);
    const page = await ctx.newPage();
    watch(page, "design@390");
    await ready(page, "/design");
    const ids = await page.$$eval("[data-shot]", (els) => els.map((e) => e.getAttribute("data-shot")!));
    let i = 0;
    for (const id of ids) {
      i++;
      if (id === "screens" || id === "dark") continue; // captured per screen below (avoids 20k-px images)
      await page.locator(`[data-shot="${id}"]`).screenshot({ path: save(`390-${String(i).padStart(2, "0")}-${id}.png`) });
    }
    // Keyboard focus visibility: tab into the page and inspect the focused element.
    const focus: Array<{ tag: string; text: string; visible: boolean }> = [];
    await page.keyboard.press("Tab");
    for (let k = 0; k < 6; k++) {
      await page.keyboard.press("Tab");
      focus.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const cs = getComputedStyle(el);
          const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== "none";
          return { tag: el.tagName, text: (el.textContent ?? "").trim().slice(0, 40), visible };
        }),
      );
    }
    results.focusVisible = focus;
    // Focus the first Button in the components section and capture it.
    const btn = page.locator('[data-shot="components"] button').first();
    await btn.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await btn.screenshot({ path: save("390-focus-ring-button.png") });
    await ctx.close();
  }

  // 2) Each screen at 390×844 (light), full page + banned words check
  const banned: Record<string, string[]> = {};
  {
    const ctx = await mobile(browser);
    const page = await ctx.newPage();
    let n = 0;
    for (const s of SCREENS.filter((x) => !x.desktop)) {
      n++;
      watch(page, s.id);
      await ready(page, `/design/screens/${s.id}`);
      await fullHeight(page, async () => {
        await page.screenshot({ path: save(`screen-${String(n).padStart(2, "0")}-${s.id}.png`) });
      });
      if (!s.technical) {
        const text = await page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('[data-copy-scope="details"], script, style, svg title').forEach((e) => e.remove());
          return clone.innerText;
        });
        const hits = (text.replace(/Top up \(testnet demo\)/g, "").match(BANNED) ?? []).map((h) => h.toLowerCase());
        if (hits.length) banned[s.id] = [...new Set(hits)];
      }
    }
    await ctx.close();
  }
  results.bannedWords = banned;

  // 3) Dark theme samples
  {
    const ctx = await mobile(browser, { dark: true });
    const page = await ctx.newPage();
    for (const id of ["wallet", "pay-confirm", "success", "venue-dashboard"]) {
      watch(page, `dark-${id}`);
      await ready(page, `/design/screens/${id}`);
      await fullHeight(page, async () => {
        await page.screenshot({ path: save(`dark-${id}.png`) });
      });
    }
    await ctx.close();
  }

  // 4) Desktop: projector dashboard + money graph + design overview
  {
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    watch(page, "desktop");
    await ready(page, "/design/screens/venue-dashboard-desktop");
    await page.screenshot({ path: save("desktop-venue-dashboard.png"), fullPage: true });
    await ready(page, "/design");
    await page.locator('[data-shot="direction"]').screenshot({ path: save("desktop-01-direction.png") });
    await page.locator('[data-shot-desktop="money-graph-projector"]').screenshot({ path: save("desktop-money-graph.png") });
    await page.locator('[data-shot="money-graph"]').screenshot({ path: save("desktop-money-graph-section.png") });
    await page.locator('[data-shot="screens"]').screenshot({ path: save("desktop-screens-overview.png") });
    await ctx.close();
  }

  // 5) Reduced motion honored: flow animation runs normally and stops under reduce
  {
    const probe = async (reduce: boolean) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduce ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      await ready(page, "/design/screens/venue-dashboard");
      const r = await page.evaluate(() => {
        const flow = document.querySelector(".vx-flow");
        const pop = document.querySelector(".animate-vx-rise-in");
        return {
          flowAnimation: flow ? getComputedStyle(flow).animationName : null,
          riseDuration: pop ? getComputedStyle(pop).animationDuration : null,
        };
      });
      await ctx.close();
      return r;
    };
    results.reducedMotion = { normal: await probe(false), reduce: await probe(true) };
  }

  await browser.close();
  results.consoleErrors = errors;
  results.screenshots = shots;
  writeFileSync(join(OUT, "checks.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({ shots: shots.length, bannedWords: banned, consoleErrors: errors.length, reducedMotion: results.reducedMotion, focusVisible: results.focusVisible }, null, 2));
  if (errors.length || Object.keys(banned).length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
