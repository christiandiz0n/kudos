/**
 * Phase 3 evidence: every real route/state at 390×844 on the shared dev server (FRONTEND_INTEGRATION).
 *
 *   node --no-warnings apps/web/scripts/phase3-e2e.ts     # first: the live happy path (writes e2e-*.json + e2e/*.png)
 *   node --no-warnings apps/web/scripts/phase3-shots.ts [--base http://localhost:3100] [--e2e <e2e-*.json>]
 *
 * Writes docs/evidence/phase-3/screens/*.png (+ index.json). The happy-path states (pending/settled/paid/dashboard/
 * referral) are copied from the latest e2e run; this script adds the rest, using the hosted api for real data and
 * Playwright request interception ONLY to force error states that can't be produced on demand (relayer down, budget
 * exhausted, payment failed, already rewarded, outdated link). Spend: one venue registration (relayer gas ≈ $0.01);
 * no customer money moves.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page, type Route } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const BASE = arg("base", "http://localhost:3100");
const EVID = join(ROOT, "docs/evidence/phase-3");
const OUT = join(EVID, "screens");
mkdirSync(OUT, { recursive: true });
const latestE2e = readdirSync(EVID).filter((f) => /^e2e-.*\.json$/.test(f)).sort().pop();
const E2E = JSON.parse(readFileSync(arg("e2e", latestE2e ? join(EVID, latestE2e) : ""), "utf8")) as {
  ok: boolean;
  venue: string;
  customer: string;
  introLink?: string;
  qrPayload: string;
};

// Same helpers as phase3-e2e.ts (duplicated: tsc in this app doesn't allow .ts import specifiers).
async function newPhone(browser: Browser, label: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && console.log(`${label} console.error`, m.text().slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  return { ctx, page, cdp, authenticatorId };
}
async function onboard(page: Page, name: string) {
  await page.getByLabel(/first name/i).fill(name);
  await page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }).click();
}

const index: { file: string; route: string; state: string }[] = [];
const errors: string[] = [];
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function shot(page: Page, file: string, state: string, settle = 1200) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: join(OUT, `${file}.png`) });
  index.push({ file: `${file}.png`, route: page.url().replace(BASE, ""), state });
  log("shot", file);
}

const apiErr = (status: number, code: string, message: string, retryable = false) => (route: Route) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify({ error: { code, message, retryable } }) });

async function main() {
  if (!E2E?.venue) throw new Error("run phase3-e2e.ts first (no e2e-*.json with a venue)");
  const browser: Browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    // ------------------------------------------------------------------ signed out / public
    const anon = await newPhone(browser, "anon");
    anon.page.on("pageerror", (e) => errors.push(`anon: ${e.message}`));
    await anon.page.goto(`${BASE}/`);
    await shot(anon.page, "01-landing-onboarding", "signed out: onboarding + 'I run a venue'");
    await anon.page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }).click();
    await shot(anon.page, "02-landing-name-required", "name validation", 500);
    await anon.page.goto(`${BASE}/transparency`);
    await shot(anon.page, "03-transparency", "public transparency page (default example)");
    await anon.page.goto(`${BASE}/transparency?venue=${E2E.venue}`);
    await shot(anon.page, "04-transparency-venue", "transparency for a live venue");
    await anon.page.screenshot({ path: join(OUT, "04b-transparency-venue-full.png"), fullPage: true });
    if (E2E.introLink) {
      await anon.page.goto(E2E.introLink);
      await shot(anon.page, "05-intro-signed-out", "friend's link opened signed out (invite chip)", 2000);
    }
    await anon.page.goto(`${BASE}/i/NOPE0000`);
    await shot(anon.page, "06-intro-bad-link", "unknown link", 2000);
    await anon.page.goto(`${BASE}/a/${E2E.customer}`);
    await shot(anon.page, "07-record-public", "public ambassador record", 2500);
    await anon.page.goto(`${BASE}/scan`);
    await shot(anon.page, "08-scan-camera", "scanner (fake camera)", 2000);
    await anon.page.getByRole("button", { name: /Type the code instead/ }).click().catch(() => {});
    await shot(anon.page, "09-scan-manual", "paste a code", 600);

    // ------------------------------------------------------------------ fresh venue (no data yet)
    const venue = await newPhone(browser, "venue");
    await venue.page.goto(`${BASE}/venue`);
    await shot(venue.page, "10-venue-signin", "venue app entry (signed out)");
    await onboard(venue.page, "Lena");
    await venue.page.waitForURL(/\/venue\/new/, { timeout: 60_000 });
    await venue.page.getByLabel(/name/i).first().fill(`Shots café ${new Date().toISOString().slice(11, 16)}`);
    await shot(venue.page, "11-venue-onboarding", "set up your place");
    await venue.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    await shot(venue.page, "12-venue-onboarding-saving", "saving (relayed, waiting for the record)", 300);
    await venue.page.waitForURL(/\/venue\/0x[0-9a-fA-F]{40}$/, { timeout: 120_000 });
    const shotsVenue = venue.page.url().split("/").pop()!;
    await shot(venue.page, "13-venue-dashboard-empty", "new venue dashboard (empty state)", 2500);
    await venue.page.goto(`${BASE}/venue/${shotsVenue}/counter`);
    await shot(venue.page, "14-counter-entry-empty", "order entry");
    await venue.page.getByRole("button", { name: "Decimal point" }).click();
    await venue.page.getByRole("button", { name: /^4$/ }).click();
    await shot(venue.page, "15-counter-below-min", "below $0.50 minimum", 300);
    await venue.page.getByRole("button", { name: "Delete" }).click();
    await venue.page.getByRole("button", { name: "Delete" }).click();
    for (const k of ["1", "2", "Decimal point", "0", "0"]) await venue.page.getByRole("button", { name: k.length === 1 ? new RegExp(`^${k}$`) : k }).click();
    await shot(venue.page, "16-counter-entry-12", "order entry $12.00 with first-time cashback hint", 300);
    await venue.page.getByRole("button", { name: /Show code/ }).click();
    const payload = await venue.page.locator("[data-qr-payload]").getAttribute("data-qr-payload", { timeout: 30_000 });
    await shot(venue.page, "17-counter-qr-live", "QR live with draining ring");

    // An order that expires in 30 s (for the customer's "expired" state), created with the owner's session.
    const expired = await venue.page.evaluate(
      async ({ v }) => {
        const s = JSON.parse(localStorage.getItem("vouch.session.v1")!);
        const r = await fetch(`${(window as unknown as { __VOUCH_API__?: string }).__VOUCH_API__ ?? "https://api-production-902bc54c.up.railway.app"}/venues/${v}/orders`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
          body: JSON.stringify({ amount: "1000000", ttlSeconds: 30 }),
        });
        const j = await r.json();
        return `/pay?v=${j.order.venue}&o=${j.order.orderId}`;
      },
      { v: shotsVenue },
    );
    const expiredAt = Date.now() + 31_000;

    // ------------------------------------------------------------------ fresh customer (unfunded)
    const cust = await newPhone(browser, "customer");
    cust.page.on("pageerror", (e) => errors.push(`customer: ${e.message}`));
    await cust.page.goto(payload!);
    await shot(cust.page, "20-pay-signed-out", "QR opened by the phone camera, not signed in");
    await onboard(cust.page, "Dev");
    await cust.page.getByText(/Not enough money yet/).waitFor({ timeout: 60_000 });
    await shot(cust.page, "21-pay-insufficient", "insufficient balance (top-up offered)");
    await cust.page.goto(`${BASE}/wallet`);
    await shot(cust.page, "22-wallet-empty", "wallet, new account", 3000);
    await cust.page.getByRole("button", { name: /Top up \(testnet demo\)/ }).click();
    await shot(cust.page, "23-wallet-topup", "demo top-up (POST /demo/topup; toast 'not live yet' if the endpoint 404s)", 6000);
    await cust.page.goto(`${BASE}/recommend?venue=${E2E.venue}`);
    await shot(cust.page, "24-recommend-locked", "recommend before a first purchase (locked)", 3000);
    await cust.page.goto(`${BASE}/me`);
    await shot(cust.page, "25-record-empty", "own record, nothing yet", 3000);

    // Error states, forced by interception of the hosted api (UI only; nothing is sent on chain).
    const quoteUrl = "**/payments/quote";
    for (const [file, status, code, msg, state] of [
      ["26-pay-relayer-down", 503, "RELAYER_DOWN", "Payments are paused for a moment.", "relayer down (503 RELAYER_DOWN)"],
      ["27-pay-budget-exhausted", 503, "RELAYER_BUDGET_EXHAUSTED", "Demo limit reached.", "relayer budget exhausted"],
      ["28-pay-already-paid", 409, "ORDER_ALREADY_PAID", "Already paid.", "order already paid"],
    ] as const) {
      await cust.page.route(quoteUrl, apiErr(status, code, msg, status === 503));
      await cust.page.goto(payload!);
      await shot(cust.page, file, state, 3000);
      await cust.page.unroute(quoteUrl);
    }
    // Funded-looking quote (real quote, balance raised in the response) → pay fails with TX_FAILED.
    await cust.page.route(quoteUrl, async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      j.balance = { baseUnits: "50000000", display: "50.00" };
      j.canAfford = true;
      j.warnings = (j.warnings as string[]).filter((w) => w !== "insufficient_balance");
      await route.fulfill({ response: res, json: j });
    });
    await cust.page.goto(payload!);
    await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
    await shot(cust.page, "29-pay-confirm-first-visit", "pay sheet, first visit, no recommendation", 2500);
    await cust.page.route("**/payments", apiErr(502, "TX_FAILED", "That didn't go through.", false));
    await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    await cust.page.getByText(/didn't go through/).first().waitFor({ timeout: 20_000 }).catch(() => errors.push("pay-failed state not shown"));
    await shot(cust.page, "30-pay-failed", "payment failed (nothing charged)", 800);
    // Face ID dismissed → "cancelled".
    await cust.page.unroute("**/payments");
    await cust.page.getByRole("button", { name: /Try again/ }).click();
    await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 30_000 });
    await cust.cdp.send("WebAuthn.setUserVerified", { authenticatorId: cust.authenticatorId, isUserVerified: false });
    await cust.page.waitForTimeout(1500);
    await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    await cust.page.getByText(/not confirmed|cancelled/i).first().waitFor({ timeout: 20_000 }).catch(() => errors.push("cancelled state not shown"));
    await shot(cust.page, "30b-pay-faceid-cancelled", "Face ID / fingerprint dismissed", 800);
    await cust.cdp.send("WebAuthn.setUserVerified", { authenticatorId: cust.authenticatorId, isUserVerified: true });
    await cust.page.unroute(quoteUrl);

    const wait = expiredAt - Date.now();
    if (wait > 0) await cust.page.waitForTimeout(wait);
    await cust.page.goto(`${BASE}${expired}`);
    await shot(cust.page, "31-pay-expired", "expired code", 3000);
    await cust.page.goto(`${BASE}/pay?v=0x123&o=nope`);
    await shot(cust.page, "32-pay-bad-link", "malformed pay link", 1500);

    if (E2E.introLink) {
      const code = E2E.introLink.split("/").pop()!;
      await cust.page.goto(E2E.introLink);
      await shot(cust.page, "33-intro-landing", "friend's link, signed in (ready)", 2500);
      await cust.page.route(`**/intros/${code}/accept/prepare`, apiErr(409, "ALREADY_REWARDED", "Already a customer."));
      await cust.page.getByRole("button", { name: /Save .* recommendation/ }).click();
      await shot(cust.page, "34-intro-already-customer", "already rewarded at this venue", 1500);
      await cust.page.unroute(`**/intros/${code}/accept/prepare`);
      await cust.page.route(`**/intros/${code}`, async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const res = await route.fetch();
        const j = await res.json();
        j.status = "needs_reissue";
        await route.fulfill({ response: res, json: j });
      });
      await cust.page.goto(E2E.introLink);
      await shot(cust.page, "35-intro-needs-new-link", "outdated link (terms changed, D-516)", 2500);
      await cust.page.unroute(`**/intros/${code}`);
    }
    // Locked account: session gone, account still on the device → Face ID unlock screen.
    await cust.page.evaluate(() => localStorage.removeItem("vouch.session.v1"));
    await cust.page.goto(`${BASE}/wallet`);
    await shot(cust.page, "36-unlock", "welcome back (unlock with Face ID)", 1500);

    // ------------------------------------------------------------------ venue: paid-by-nobody QR states + projector
    await venue.page.goto(`${BASE}/venue/${E2E.venue}`);
    await shot(venue.page, "40-venue-dashboard-other", "dashboard of the e2e venue as a non-owner account", 4000);
    const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const wp = await wide.newPage();
    await wp.goto(`${BASE}/transparency`);
    await wp.screenshot({ path: join(OUT, "41-transparency-desktop.png") });
    index.push({ file: "41-transparency-desktop.png", route: "/transparency", state: "desktop 1440" });
    await wide.close();

    // ------------------------------------------------------------------ happy path from the live e2e run
    const e2eDir = join(EVID, "e2e");
    for (const f of readdirSync(e2eDir).filter((x) => x.endsWith(".png")).sort()) {
      copyFileSync(join(e2eDir, f), join(OUT, `e2e-${f}`));
      index.push({ file: `e2e-${f}`, route: "(live e2e)", state: f.replace(/\.png$/, "") });
    }
  } finally {
    writeFileSync(join(OUT, "index.json"), JSON.stringify({ base: BASE, e2e: latestE2e, at: new Date().toISOString(), shots: index, pageErrors: errors }, null, 2));
    log(`wrote ${index.length} entries to ${OUT}; page errors: ${errors.length}`);
    await browser.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
