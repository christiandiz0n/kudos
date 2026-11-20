// QE_E2E Phase 3 gate helpers (independent of apps/web/scripts/*; only the virtual-authenticator recipe is shared).
// Playwright is resolved from apps/web (pinned 1.56.1). Never reads .env.
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Parameters: CLI flags win over env vars, env vars over defaults.
//   --base <web origin> | QE_BASE   (default http://localhost:3100)
//   --api <api origin>  | QE_API    (default the hosted Railway api)
//   --out <dir>         | QE_OUT    (evidence dir, relative to the repo root; screenshots go to <dir>/screens)
//   --engine webkit     | QE_ENGINE (default chromium; webkit uses the iPhone 14 profile and has no WebAuthn)
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
export const BASE = (flag("base") ?? process.env.QE_BASE ?? "http://localhost:3100").replace(/\/$/, "");
export const API = (flag("api") ?? process.env.QE_API ?? "https://api-production-902bc54c.up.railway.app").replace(/\/$/, "");
export const ENGINE = flag("engine") ?? process.env.QE_ENGINE ?? "chromium";
export const WEBKIT = ENGINE === "webkit";
// WebKit was installed under node_modules only (PLAYWRIGHT_BROWSERS_PATH=0); the registry path is read at require time.
if (WEBKIT) process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
const require = createRequire(join(ROOT, "apps/web/package.json"));
const pw = require("playwright");
const OUT = flag("out") ?? process.env.QE_OUT;
export const EVID = OUT ? resolve(ROOT, OUT) : join(ROOT, "docs/evidence/phase-3/qe");
export const SHOTS = join(EVID, "screens");
/** The selected engine. Named `chromium` so the Phase 3 scripts run unchanged; chromium-only launch args are dropped on webkit. */
// A9 QE: headless is FORCED (the human asked that no browser window ever appears on screen).
export const chromium = WEBKIT ? { launch: (opts = {}) => pw.webkit.launch({ ...opts, args: [], headless: true }) } : { launch: (opts = {}) => pw.chromium.launch({ ...opts, headless: true }) };
export const devices = pw.devices;
export const SCRATCH = process.env.QE_SCRATCH ?? "/private/tmp/claude-501/-Users-christiandizon-Desktop-ubc-2026/ff1dc655-46d1-429e-949b-e606fb040c32/scratchpad/qe-a9";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(SCRATCH, { recursive: true });

const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ results sink (one NDJSON per run family)
export function sink(name) {
  const file = join(EVID, `${name}.ndjson`);
  writeFileSync(file, "");
  return (rec) => appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n");
}

// ------------------------------------------------------------------ screenshot index (merged across scripts)
const INDEX = join(SHOTS, "index.json");
export function addIndex(entry) {
  const cur = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : [];
  const next = cur.filter((e) => e.file !== entry.file);
  next.push(entry);
  next.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(INDEX, JSON.stringify(next, null, 2));
}
export async function shot(page, file, state, notes = "", { fullPage = false } = {}) {
  const f = `${file}.png`;
  await page.screenshot({ path: join(SHOTS, f), fullPage });
  const vp = page.viewportSize();
  addIndex({ file: f, route: page.url().replace(BASE, "") || "/", state, notes, viewport: `${vp.width}x${vp.height}` });
  log("shot", f);
}

// ------------------------------------------------------------------ phones
/** A phone-sized context with a CDP virtual WebAuthn authenticator (platform, UV, resident keys, PRF). */
export async function newPhone(browser, label, { reducedMotion = "no-preference", permissions = ["camera"], viewport = { width: 390, height: 844 } } = {}) {
  const phone = WEBKIT && viewport.width < 800;
  const ctx = phone
    ? await browser.newContext({ ...pw.devices["iPhone 14"], reducedMotion })
    : await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 800 ? 2 : 1, isMobile: !WEBKIT && viewport.width < 800, hasTouch: viewport.width < 800, ...(WEBKIT ? {} : { permissions }), reducedMotion });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push({ kind: "pageerror", text: e.message, url: page.url() }));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push({ kind: "console", text: m.text().slice(0, 400), url: page.url() });
  });
  // API requests that fail at the network layer (CORS refusals show up here as well as on the console).
  page.on("requestfailed", (r) => {
    // ERR_ABORTED / "cancelled" = the page navigated away mid-request (SSE streams, in-flight reads): not a failure.
    const why = r.failure()?.errorText ?? "";
    if (r.url().startsWith(API) && !/ERR_ABORTED|cancelled|Load request cancelled/i.test(why))
      errs.push({ kind: "requestfailed", text: `${r.method()} ${r.url().replace(API, "").replace(/token=[^&]+/, "token=<redacted>")} ${why}`, url: page.url() });
  });
  if (WEBKIT) return { label, ctx, page, cdp: null, authenticatorId: null, errs, takeErrs: () => errs.splice(0, errs.length) };
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  return { label, ctx, page, cdp, authenticatorId, errs, takeErrs: () => errs.splice(0, errs.length) };
}

export async function onboard(page, name) {
  await page.getByLabel(/first name/i).fill(name);
  await page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }).click();
}
export async function sessionOf(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("vouch.session.v1") ?? "null"));
}
/** Wait until the app has rendered past the route skeleton and spinners. */
export async function settle(page, extra = 800) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => !document.querySelector("[aria-busy='true']") && document.body.innerText.trim().length > 0, null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

// ------------------------------------------------------------------ the audit (copy, money, tap targets, primary count)
// Banned on primary screens (apps/web/src/design/COPY.md + D-605 + D-017(d) "never 'passkey'").
const BANNED = [
  ["USDC", /\busdc\b/i], ["token", /\btokens?\b/i], ["stablecoin", /\bstablecoins?\b/i], ["crypto", /\bcrypto\w*/i],
  ["gas", /\bgas\b/i], ["network fee", /\bnetwork fees?\b/i], ["wallet address", /\b(wallet|account) address/i],
  ["0x…", /\b0x[0-9a-f]{4,}/i], ["transaction", /\btransactions?\b/i], ["tx", /\btx\b/i], ["hash", /\bhash(es)?\b/i],
  ["sign/signature", /\b(?:counter)?sign(?:ed|ature|atures|ing|s)?\b(?![- ](?:in|up|out)\b)/i],
  ["seed/recovery phrase", /\b(seed|recovery) phrase/i], ["private key", /\bprivate keys?\b/i],
  ["blockchain", /\bblockchains?\b/i], ["on-chain", /\bon-?chain\b/i], ["smart contract", /\bsmart contracts?\b/i], ["web3", /\bweb3\b/i],
  ["referral", /\breferral/i], ["referrer", /\breferrers?\b/i], ["introducer", /\bintroducers?\b/i], ["L1/L2", /\bL[12]\b/],
  ["intro", /\bintros?\b/i], ["nonce", /\bnonces?\b/i], ["terms version", /\bterms version/i], ["bps", /\bbps\b/i],
  ["passkey", /\bpasskeys?\b/i], ["testnet", /\btestnet\b/i],
];
// "Top up (testnet demo)" is the one allowed testnet label (+ the demo-mode note, reviewed by hand).
const ALLOWED = [/Top up \(testnet demo\)/g, /testnet demo/gi];

export async function audit(page, screen, { primary = true } = {}) {
  const raw = await page.evaluate(() => {
    const vis = (el) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        if (e.hasAttribute("inert")) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const inDetails = (el) => !!el.closest("[data-copy-scope='details'], details");
    // Visible text, excluding the Details drawer.
    const texts = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const t = n.textContent.replace(/\s+/g, " ").trim();
      if (!t || !n.parentElement || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(n.parentElement.tagName)) continue;
      if (inDetails(n.parentElement) || !vis(n.parentElement)) continue;
      const sr = n.parentElement.closest(".sr-only");
      texts.push({ t, sr: !!sr });
    }
    // Accessible names (aria-label, alt, placeholder, title) outside Details.
    const attrs = [];
    for (const el of document.querySelectorAll("[aria-label],[alt],[placeholder],[title]")) {
      if (inDetails(el)) continue;
      for (const a of ["aria-label", "alt", "placeholder", "title"]) if (el.getAttribute(a)) attrs.push(`${a}=${el.getAttribute(a)}`);
    }
    // Interactive elements.
    const inter = [];
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [tabindex]:not([tabindex='-1'])")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === "string" ? el.className.split(/\s+/) : [];
      const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && !!el.closest("p, li, span");
      inter.push({
        tag: el.tagName.toLowerCase(), type: el.getAttribute("type"), name: (el.getAttribute("aria-label") || el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 60),
        w: Math.round(r.width), h: Math.round(r.height), // A9: the blue primary is `bg-primary` (with text-on-primary hover:bg-primary-hover active:bg-primary-pressed); `bg-ink` kept for main.
        primary: cls.includes("bg-primary") || cls.includes("bg-ink"), accent: cls.includes("bg-accent"), disabled: el.disabled || el.getAttribute("aria-disabled") === "true", inline, inDetails: inDetails(el),
      });
    }
    return { texts, attrs, inter, title: document.title };
  });
  const visible = raw.texts.map((x) => x.t).join(" | ");
  const scan = (s) => {
    let clean = s;
    for (const re of ALLOWED) clean = clean.replace(re, "");
    const hits = [];
    for (const [name, re] of BANNED) {
      const m = clean.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
      if (m) hits.push({ word: name, samples: [...new Set(m)].slice(0, 3), context: ctxOf(clean, re) });
    }
    return hits;
  };
  const banned = primary ? scan(visible) : [];
  const bannedA11y = primary ? scan(raw.attrs.join(" | ")) : [];
  // Money formatting: every $ amount on a primary screen has exactly 2 decimals; no raw base units (>= 6-digit integers) or hex.
  const moneyBad = primary ? [...visible.matchAll(/[+−-]?\$\s?[\d,]+(?:\.\d+)?/g)].map((m) => m[0]).filter((s) => !/\.\d{2}$/.test(s)) : [];
  const rawUnits = primary ? [...visible.matchAll(/(?<![\d.,$:])\d{6,}(?![\d.,])/g)].map((m) => m[0]) : [];
  const small = raw.inter.filter((e) => !e.inline && !e.inDetails && (e.h < 44 || e.w < 44));
  const smallPrimary = raw.inter.filter((e) => e.primary && (e.h < 44 || e.w < 44));
  const primaries = raw.inter.filter((e) => e.primary && !e.inDetails);
  return { screen, url: page.url().replace(BASE, ""), primaryCount: primaries.length, primaries: primaries.map((p) => `${p.name}${p.disabled ? " (disabled)" : ""}`), accents: raw.inter.filter((e) => e.accent).map((p) => p.name), banned, bannedA11y, moneyBad, rawUnits, smallTargets: small.map((e) => `${e.tag}:${e.name || e.type} ${e.w}x${e.h}`), smallPrimary: smallPrimary.map((e) => `${e.name} ${e.w}x${e.h}`), text: visible.slice(0, 1500) };
}
function ctxOf(s, re) {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(s);
  if (!m) return "";
  return s.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50);
}

/** First Tab stop: is there a visible focus indicator? */
export async function firstFocus(page) {
  // No clicks (a click on a sheet backdrop closes it). Blur, then Tab from the document start.
  await page.evaluate(() => { document.activeElement?.blur?.(); window.getSelection()?.removeAllRanges(); });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { ok: false, el: "body (nothing focusable)" };
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    // A ring may be drawn by the element or by its wrapper (TextField draws it on the wrapper, D-615).
    const visibleShadow = (bs) => !!bs && bs !== "none" && bs.split(/,(?![^(]*\))/).some((x) => !/rgba\(0, 0, 0, 0\)/.test(x) && /\b[1-9]\d*(\.\d+)?px/.test(x));
    const ring = visibleShadow(s.boxShadow) || (el.parentElement && visibleShadow(getComputedStyle(el.parentElement).boxShadow));
    return { ok: outline || !!ring, el: `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 40)}`, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, boxShadow: s.boxShadow?.slice(0, 80) };
  });
}

/** Running animations (for reduced-motion checks). */
export async function runningAnimations(page) {
  return page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === "running").map((a) => {
      const t = a.effect?.getTiming?.() ?? {};
      return `${a.animationName ?? a.constructor.name}:${t.duration}ms x${t.iterations}`;
    }),
  );
}

/** API error fulfiller for interception (CORS header for the dev origin). */
export const apiErr = (status, code, message, retryable = false, details) => (route) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true" }, body: JSON.stringify({ error: { code, message, retryable, ...(details ? { details } : {}) } }) });

export async function apiJson(path, { method = "GET", token, body } = {}) {
  const r = await fetch(`${API}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), origin: BASE }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json };
}
