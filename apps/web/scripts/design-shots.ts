/**
 * Captures /design for human approval + runs the design acceptance checks (UI_DESIGN, Phase 1).
 *
 *   pnpm --filter web exec next dev -p 3200      # in another terminal (never 3000/3100)
 *   pnpm --filter web design:shots               # = node --no-warnings scripts/design-shots.ts
 *
 * Writes PNGs + checks.json to docs/evidence/phase-1/design/. Env: DESIGN_BASE_URL (default http://localhost:3200).
 * Phase 3 (shared dev server on :3100, D-019):
 *   DESIGN_BASE_URL=http://localhost:3100 DESIGN_WHO=Customer DESIGN_OUT=docs/evidence/phase-3/design/customer pnpm --filter web design:shots
 *   DESIGN_WHO   comma list of Customer|Venue|Public: only those screens (+ their dark samples); skips the /design overview.
 *   DESIGN_OUT   output dir relative to the repo root.
 * The screen list is read from src/app/design/_mocks/meta*.ts (no more hand-kept copy).
 * Checks: no console/page errors, no banned words on primary-screen mocks (outside the Details drawer),
 * reduced motion stops the flow animation, keyboard focus is visible.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../..", process.env.DESIGN_OUT ?? "docs/evidence/phase-1/design");
const BASE = process.env.DESIGN_BASE_URL ?? "http://localhost:3200";
const WHO = process.env.DESIGN_WHO ? new Set(process.env.DESIGN_WHO.split(",").map((w) => w.trim())) : null;

// Parsed from src/app/design/_mocks/meta*.ts (plain node can't resolve the app's extensionless imports).
const MOCKS = resolve(here, "../src/app/design/_mocks");
const ALL_SCREENS: Array<{ id: string; who: string; technical?: boolean; desktop?: boolean }> = [];
for (const f of readdirSync(MOCKS).filter((n) => /^meta(\.[\w-]+)?\.ts$/.test(n)).sort()) {
  for (const m of readFileSync(join(MOCKS, f), "utf8").matchAll(/\{\s*id:\s*"([^"]+)"[^}]*\}/g)) {
    // meta.venue.ts writes `who: V` (const V = "Venue").
    const w = /who:\s*(?:"(\w+)"|(V)\b)/.exec(m[0]);
    const who = w?.[1] ?? (w?.[2] ? "Venue" : "?");
    ALL_SCREENS.push({ id: m[1], who, technical: /technical:\s*true/.test(m[0]), desktop: /desktop:\s*true/.test(m[0]) });
  }
}
const SCREENS = ALL_SCREENS.filter((s) => !WHO || WHO.has(s.who));
const DARK = ["wallet", "pay-confirm", "success", "venue-dashboard", "scan-denied", "intro", "recommend-link", "pay-expired"];

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

  // 1) /design sections at 390px (full runs only)
  if (!WHO) {
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
  const smallTargets: Record<string, string[]> = {};
  const focusByScreen: Record<string, string> = {};
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
      if (WHO) {
        // Tap targets < 44px (info; inline text links are exempt under WCAG 2.5.8) + first Tab stop shows a ring.
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('button, a[href], input, summary, [role="radio"]')]
            .filter((e) => !e.closest("p, li > span"))
            .map((e) => ({ e, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44))
            .map(({ e, r }) => `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 28)}" ${Math.round(r.width)}x${Math.round(r.height)}`),
        );
        if (small.length) smallTargets[s.id] = small;
        await page.keyboard.press("Tab");
        focusByScreen[s.id] = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return "no focusable";
          const cs = getComputedStyle(el);
          // A TextField's ring is drawn by its wrapper (focus-within 2px inset ring), not the bare input (QE-3-07).
          // Checked by declaration: in this loop's reused page :focus-within doesn't always resolve in time
          // (the ring itself is verified in docs/evidence/phase-3/fixes/ui/after-qe-3-07-textfield-focus.png).
          const wrapRing = el.tagName === "INPUT" && /focus-within:shadow-\[inset_0_0_0_2px/.test(el.parentElement?.className ?? "");
          // Range sliders draw their ring on ::-webkit-slider-thumb, which getComputedStyle can't see (390-focus-slider.png).
          const rangeThumb = el.classList.contains("vx-range");
          const ok = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== "none" || wrapRing || rangeThumb;
          return `${ok ? "visible" : "NOT VISIBLE"}: ${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 28)}"`;
        });
      }
    }
    await ctx.close();
  }
  results.bannedWords = banned;
  if (WHO) {
    results.smallTapTargets = smallTargets;
    results.focusFirstTab = focusByScreen;
  }

  // 3) Dark theme samples
  {
    const ctx = await mobile(browser, { dark: true });
    const page = await ctx.newPage();
    for (const id of DARK.filter((d) => SCREENS.some((s) => s.id === d))) {
      watch(page, `dark-${id}`);
      await ready(page, `/design/screens/${id}`);
      await fullHeight(page, async () => {
        await page.screenshot({ path: save(`dark-${id}.png`) });
      });
    }
    await ctx.close();
  }

  // 4) Desktop: projector dashboard + money graph + design overview (full runs only)
  if (!WHO) {
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
      await ready(page, WHO && !WHO.has("Venue") ? "/design/screens/success" : "/design/screens/venue-dashboard");
      const r = await page.evaluate(() => {
        const flow = document.querySelector(".vx-flow, .vx-draw");
        const pop = document.querySelector(".animate-vx-rise-in, .animate-vx-pop");
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
  console.log(JSON.stringify({ shots: shots.length, bannedWords: banned, consoleErrors: errors.length, reducedMotion: results.reducedMotion, focusVisible: results.focusVisible, smallTapTargets: results.smallTapTargets, focusFirstTab: results.focusFirstTab }, null, 2));
  if (errors.length || Object.keys(banned).length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
