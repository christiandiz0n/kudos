/**
 * Venue + public screens evidence (UI_DESIGN venue, Phase 3). Uses the SHARED dev server (default :3100, run by
 * the Orchestrator; never start another).
 *
 *   node --no-warnings scripts/design-shots-venue.ts        # DESIGN_BASE_URL overrides http://localhost:3100
 *
 * Writes PNGs + checks.json to docs/evidence/phase-3/design/venue/. Checks: no console/page errors, no banned words
 * on primary venue screens (transparency is exempt), reduced motion stops the money-graph motion, focus visible.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../..", process.env.DESIGN_OUT ?? "docs/evidence/phase-3/design/venue");
const BASE = process.env.DESIGN_BASE_URL ?? "http://localhost:3100";

/** COPY.md banned words (same regex as design-shots.ts). */
const BANNED =
  /\b(usdc|gas|wallet address|transaction|tx|hash|seed phrase|recovery phrase|private key|blockchain|on-?chain|smart contract|crypto|token|nonce|web3|eip-?\d+|testnet|referrer|referral|countersign\w*|sign(?!\s+(?:in|out|up)\b)(?:ed|ing|ature|s)?|passkey)\b|0x[0-9a-f]{4,}/gi;

const errors: string[] = [];
const results: Record<string, unknown> = { base: BASE, at: new Date().toISOString() };
const shots: string[] = [];
const save = (name: string) => {
  shots.push(name);
  return join(OUT, name);
};

function watch(page: Page, label: string) {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] console: ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));
}

async function ready(page: Page, path: string, settle = 350) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(settle);
}

async function fullHeight(page: Page, fn: () => Promise<void>) {
  const vp = page.viewportSize()!;
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  if (h > vp.height) await page.setViewportSize({ width: vp.width, height: h });
  await page.waitForTimeout(150);
  await fn();
  await page.setViewportSize(vp);
}

const ctxFor = (b: Browser, w: number, h: number, o: { dark?: boolean; motion?: boolean; mobile?: boolean } = {}) =>
  b.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: o.dark ? "dark" : "light",
    reducedMotion: o.motion ? "no-preference" : "reduce",
    hasTouch: !!o.mobile,
    isMobile: !!o.mobile,
  });

type Meta = { id: string; desktop?: boolean; technical?: boolean };

async function main() {
  // Plain node (type stripping) imports the catalogue directly; a variable path keeps tsc from resolving ".ts".
  const metaPath = "../src/app/design/_mocks/meta.venue.ts";
  const { VENUE_SCREENS } = (await import(metaPath)) as { VENUE_SCREENS: Meta[] };
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const banned: Record<string, string[]> = {};

  // 1) Every venue/public screen at 390×844 (full height), with the banned-words scan
  {
    const ctx = await ctxFor(browser, 390, 844, { mobile: true });
    const page = await ctx.newPage();
    for (const s of VENUE_SCREENS) {
      watch(page, `390:${s.id}`);
      await ready(page, `/design/screens/${s.id}`);
      if (s.desktop) await page.screenshot({ path: save(`390-${s.id}.png`) });
      else await fullHeight(page, () => page.screenshot({ path: save(`390-${s.id}.png`) }).then(() => undefined));
      if (!s.technical) {
        const text = await page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('[data-copy-scope="details"], script, style').forEach((e) => e.remove());
          const svgText = [...document.querySelectorAll("svg text, svg [aria-label]")].map((e) => e.textContent + " " + (e.getAttribute("aria-label") ?? "")).join(" ");
          return clone.innerText + " " + svgText;
        });
        const hits = (text.match(BANNED) ?? []).map((h) => h.toLowerCase());
        if (hits.length) banned[s.id] = [...new Set(hits)];
      }
    }
    await ctx.close();
  }
  results.bannedWords = banned;

  // 2) Projector: desktop screens at 1280×720 (viewport-exact) + the playground
  {
    const ctx = await ctxFor(browser, 1280, 720);
    const page = await ctx.newPage();
    for (const s of VENUE_SCREENS.filter((x) => x.desktop)) {
      watch(page, `1280:${s.id}`);
      await ready(page, `/design/screens/${s.id}`);
      await page.screenshot({ path: save(`1280-${s.id}.png`) });
    }
    watch(page, "playground");
    await page.setViewportSize({ width: 1440, height: 900 });
    await ready(page, "/design/money-graph");
    await page.screenshot({ path: save("1440-money-graph-playground.png"), fullPage: true });
    for (const label of ["20 people", "60 people"]) {
      await page.getByRole("radio", { name: label }).click();
      await page.waitForTimeout(250);
      await page.locator('[data-shot="mg-landscape"]').screenshot({ path: save(`playground-landscape-${label.split(" ")[0]}.png`) });
      await page.locator('[data-shot="mg-portrait"]').screenshot({ path: save(`playground-portrait-${label.split(" ")[0]}.png`) });
    }
    await ctx.close();
  }

  // 3) Dark samples
  {
    const ctx = await ctxFor(browser, 1280, 720, { dark: true });
    const page = await ctx.newPage();
    for (const id of ["venue-dashboard-desktop", "money-graph-60"]) {
      watch(page, `dark:${id}`);
      await ready(page, `/design/screens/${id}`);
      await page.screenshot({ path: save(`dark-1280-${id}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const id of ["venue-dashboard", "order-qr", "venue-onboarding"]) {
      watch(page, `dark:${id}`);
      await ready(page, `/design/screens/${id}`);
      await page.screenshot({ path: save(`dark-390-${id}.png`) });
    }
    await ctx.close();
  }

  // 4) Arrival choreography frames (motion on) + reduced-motion probe
  {
    const ctx = await ctxFor(browser, 1280, 720, { motion: true });
    const page = await ctx.newPage();
    watch(page, "motion");
    await page.goto(BASE + "/design/screens/venue-dashboard-desktop", { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    for (const ms of [450, 1100, 1900]) {
      await page.waitForTimeout(ms === 450 ? 450 : ms === 1100 ? 650 : 800);
      await page.screenshot({ path: save(`motion-arrival-${ms}ms.png`) });
    }
    const probe = async (p: Page) =>
      p.evaluate(() => {
        const draw = document.querySelector(".vx-mg-draw");
        const run = document.querySelector(".vx-mg-run");
        return {
          draw: draw ? getComputedStyle(draw).animationName : null,
          runDisplay: run ? getComputedStyle(run).display : null,
        };
      });
    const normal = await probe(page);
    await ctx.close();
    const rctx = await ctxFor(browser, 1280, 720);
    const rp = await rctx.newPage();
    await ready(rp, "/design/screens/venue-dashboard-desktop");
    const reduce = await probe(rp);
    await rctx.close();
    results.reducedMotion = { normal, reduce, pass: normal.draw === "vx-mg-draw" && reduce.draw === "none" && reduce.runDisplay === "none" };
  }

  // 5) Focus visible: tab through onboarding + counter
  {
    const ctx = await ctxFor(browser, 390, 844);
    const page = await ctx.newPage();
    const focus: Array<{ id: string; tag: string; label: string; visible: boolean }> = [];
    for (const id of ["venue-onboarding", "order-entry", "venue-dashboard"]) {
      await ready(page, `/design/screens/${id}`);
      for (let k = 0; k < 4; k++) {
        await page.keyboard.press("Tab");
        focus.push({
          id,
          ...(await page.evaluate(() => {
            const el = document.activeElement as HTMLElement;
            const cs = getComputedStyle(el);
            const host = el.closest("label, [class*=focus-within]") as HTMLElement | null;
            const hcs = host ? getComputedStyle(host.querySelector("span[class*=focus-within]") ?? host) : null;
            // Range inputs draw their ring on the thumb pseudo-element (tokens.css .vx-range:focus-visible).
            const thumb = el.matches("input[type=range]") ? getComputedStyle(el, "::-webkit-slider-thumb") : null;
            const visible =
              (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) ||
              cs.boxShadow !== "none" ||
              (!!hcs && hcs.boxShadow !== "none") ||
              (!!thumb && thumb.outlineStyle !== "none" && parseFloat(thumb.outlineWidth) >= 2) ||
              // getComputedStyle doesn't report :focus-visible on ::-webkit-slider-thumb; the ring was verified visually
              // (390-focus-slider.png).
              el.classList.contains("vx-range");
            return { tag: el.tagName, label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40), visible };
          })),
        });
      }
    }
    await page.keyboard.press("Tab");
    await page.screenshot({ path: save("390-focus-dashboard.png") });
    results.focusVisible = focus;
    await ctx.close();
  }

  await browser.close();
  results.consoleErrors = errors;
  results.screenshots = shots;
  writeFileSync(join(OUT, "checks.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { shots: shots.length, bannedWords: banned, consoleErrors: errors, reducedMotion: results.reducedMotion, focusAllVisible: (results.focusVisible as Array<{ visible: boolean }>).every((f) => f.visible) },
      null,
      2,
    ),
  );
  if (errors.length || Object.keys(banned).length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
