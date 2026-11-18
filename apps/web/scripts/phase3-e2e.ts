/**
 * Phase 3 milestone A/B end-to-end on the shared dev server + hosted api (FRONTEND_INTEGRATION).
 *
 *   node --no-warnings apps/web/scripts/phase3-e2e.ts [--base http://localhost:3100] [--amount 1.00] [--fund 2.00]
 *        [--venue-state <dir>]     reuse a saved venue browser profile (skip venue onboarding)
 *        [--headed]
 *
 * Two browser contexts at 390×844, each with a CDP virtual WebAuthn authenticator (platform, UV, PRF), so the real
 * passkey code path runs (D-104). Venue: onboard → counter → QR. Customer: open the QR URL (what the phone camera
 * does) → onboard → fund via the CLI top-up (`pnpm --filter @vouch/scripts topup --to <addr>`, deployer key loaded by
 * that script; this script never reads .env) → confirm → pending → settled (Streams) → venue sees "paid".
 * Prints tx hash + timings and writes docs/evidence/phase-3/e2e-<ts>.json + screenshots.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const BASE = arg("base", "http://localhost:3100");
const AMOUNT = arg("amount", "0.50");
const FUND = arg("fund", "0.55");
/** app = the in-app "Top up (testnet demo)" button (POST /demo/topup, D-811) | cli = deployer CLI top-up. */
const FUND_MODE = arg("fund-mode", "app");
const HEADED = args.includes("--headed");
const OUT = join(ROOT, "docs/evidence/phase-3");
const SHOTS = join(OUT, "e2e");
mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

export async function withAuthenticator(ctx: BrowserContext, page: Page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  return { cdp, authenticatorId };
}

export async function newPhone(browser: Browser, label: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log(`${label} pageerror`, e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.includes("Download the React DevTools")) log(`${label} console.error`, t.slice(0, 300));
    if (t.startsWith("[vouch] timing")) log(`${label}`, t);
  });
  await withAuthenticator(ctx, page);
  return { ctx, page };
}

export async function onboard(page: Page, name: string) {
  await page.getByLabel(/first name/i).fill(name);
  await page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }).click();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const result: Record<string, unknown> = { base: BASE, amount: AMOUNT, startedAt: new Date().toISOString() };
  try {
    // ------------------------------------------------------------------ venue
    const venue = await newPhone(browser, "venue");
    await venue.page.goto(`${BASE}/venue`);
    await onboard(venue.page, "Lena");
    log("venue: account created");
    await venue.page.waitForURL(/\/venue\/new/, { timeout: 60_000 });
    const vname = `Lena's café ${new Date().toISOString().slice(11, 16)}`;
    await venue.page.getByLabel(/name/i).first().fill(vname);
    await venue.page.getByLabel(/Minimum first order/i).fill(arg("min", "0.50"));
    await shot(venue.page, "v1-onboarding");
    const tReg = Date.now();
    await venue.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    await venue.page.waitForURL(/\/venue\/0x[0-9a-fA-F]{40}$/, { timeout: 120_000 });
    const venueAddr = venue.page.url().split("/").pop()!;
    result.venue = venueAddr;
    result.venueRegisteredMs = Date.now() - tReg;
    log("venue: registered", venueAddr, `${result.venueRegisteredMs}ms`);
    await venue.page.waitForTimeout(1500);
    await shot(venue.page, "v2-dashboard-empty");

    await venue.page.goto(`${BASE}/venue/${venueAddr}/counter`);
    for (const k of AMOUNT.replace(/^0+(?=\d)/, "")) await venue.page.getByRole("button", { name: k === "." ? /decimal|point|\./i : new RegExp(`^${k}$`) }).first().click();
    await shot(venue.page, "v3-order-entry");
    await venue.page.getByRole("button", { name: /Show code/ }).click();
    const payload = await venue.page.locator("[data-qr-payload]").getAttribute("data-qr-payload", { timeout: 30_000 });
    result.qrPayload = payload;
    log("venue: QR", payload);
    await shot(venue.page, "v4-order-qr");

    // ------------------------------------------------------------------ customer
    const cust = await newPhone(browser, "customer");
    await cust.page.goto(payload!);
    await onboard(cust.page, "Ben");
    await cust.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
    const custAddr = await cust.page.evaluate(() => JSON.parse(localStorage.getItem("vouch.session.v1")!).address as string);
    result.customer = custAddr;
    log("customer: account", custAddr);
    await cust.page.waitForTimeout(2500);
    await shot(cust.page, "c1-pay-unfunded");

    if (FUND_MODE === "cli") {
      log(`customer: funding $${FUND} via CLI top-up`);
      const out = execFileSync("pnpm", ["--silent", "--filter", "@vouch/scripts", "topup", "--to", custAddr, "--target", FUND, "--max-total", "5"], { cwd: ROOT, encoding: "utf8" });
      result.fundTx = /0x[0-9a-fA-F]{64}/.exec(out)?.[0];
      log("customer: funded (cli)", result.fundTx);
      await cust.page.reload();
    } else {
      // The judge path: "Top up (testnet demo)" inside the pay sheet (POST /demo/topup, D-811).
      const tTop = Date.now();
      const topRes = cust.page.waitForResponse((r) => r.url().endsWith("/demo/topup") && r.request().method() === "POST", { timeout: 30_000 });
      await cust.page.getByRole("button", { name: /Top up \(testnet demo\)/ }).click();
      result.fundTx = ((await (await topRes).json()) as { txHash?: string }).txHash;
      await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
      result.topupMs = Date.now() - tTop;
      log("customer: funded (in-app demo top-up)", result.fundTx, `${result.topupMs}ms`);
    }
    await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
    await cust.page.waitForFunction(() => !document.querySelector("[aria-busy='true']"), null, { timeout: 30_000 }).catch(() => {});
    await shot(cust.page, "c2-pay-confirm");
    const tPay = Date.now();
    await cust.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    await cust.page.getByText(/Arriving|pending|Confirming/i).first().waitFor({ timeout: 60_000 }).catch(() => {});
    result.pendingMs = Date.now() - tPay;
    await shot(cust.page, "c3-pending");
    log("customer: pending", `${result.pendingMs}ms`);
    const timings = await cust.page.waitForFunction(
      () => {
        const t = (window as unknown as { __vouchTimings?: { step: string }[] }).__vouchTimings ?? [];
        return t.some((x) => x.step === "settled") ? t : null;
      },
      null,
      { timeout: 120_000 },
    );
    result.settledMs = Date.now() - tPay;
    result.timings = await timings.jsonValue();
    log("customer: settled", `${result.settledMs}ms`, JSON.stringify(result.timings));
    await cust.page.waitForTimeout(1500);
    await shot(cust.page, "c4-settled");

    // ------------------------------------------------------------------ venue sees it
    await venue.page.getByText(/Payment received|Paid/).first().waitFor({ timeout: 60_000 });
    result.venuePaidMs = Date.now() - tPay;
    log("venue: paid", `${result.venuePaidMs}ms`);
    await shot(venue.page, "v5-order-paid");
    await venue.page.goto(`${BASE}/venue/${venueAddr}`);
    await venue.page.waitForTimeout(4000);
    await shot(venue.page, "v6-dashboard-after");
    await cust.page.goto(`${BASE}/wallet`);
    await cust.page.waitForTimeout(4000);
    await shot(cust.page, "c5-wallet-after");

    if (!args.includes("--no-referral")) {
      // ---------------------------------------------------------------- C: Ben recommends → Cara accepts → Cara pays
      await cust.page.goto(`${BASE}/recommend?venue=${venueAddr}`);
      await cust.page.getByLabel(/note/i).fill("Best cortado around").catch(() => {});
      await shot(cust.page, "r1-recommend");
      const introRes = cust.page.waitForResponse((r) => r.url().endsWith("/intros") && r.request().method() === "POST", { timeout: 60_000 });
      await cust.page.getByRole("button", { name: /Make my link/ }).click();
      const { code } = (await (await introRes).json()) as { code: string };
      const link = `${BASE}/i/${code}`;
      result.introLink = link;
      log("ben: link", link);
      await cust.page.waitForTimeout(800);
      await shot(cust.page, "r2-recommend-link");

      const cara = await newPhone(browser, "cara");
      await cara.page.goto(link);
      await cara.page.waitForTimeout(1500);
      await shot(cara.page, "i1-intro-signed-out");
      await onboard(cara.page, "Cara");
      await cara.page.getByRole("button", { name: /Save .* recommendation/ }).waitFor({ timeout: 60_000 });
      await shot(cara.page, "i2-intro-landing");
      const tAcc = Date.now();
      await cara.page.getByRole("button", { name: /Save .* recommendation/ }).click();
      await cara.page.getByRole("button", { name: /^Done$/ }).waitFor({ timeout: 120_000 });
      result.acceptMs = Date.now() - tAcc;
      log("cara: accepted", `${result.acceptMs}ms`);
      await shot(cara.page, "i3-intro-accepted");
      const caraAddr = await cara.page.evaluate(() => JSON.parse(localStorage.getItem("vouch.session.v1")!).address as string);
      result.cara = caraAddr;
      const out2 = execFileSync("pnpm", ["--silent", "--filter", "@vouch/scripts", "topup", "--to", caraAddr, "--target", FUND, "--max-total", "5"], { cwd: ROOT, encoding: "utf8" });
      result.caraFundTx = /0x[0-9a-fA-F]{64}/.exec(out2)?.[0];
      log("cara: funded", result.caraFundTx);

      await venue.page.goto(`${BASE}/venue/${venueAddr}/counter`);
      for (const k of AMOUNT.replace(/^0+(?=\d)/, "")) await venue.page.getByRole("button", { name: k === "." ? /decimal|point|\./i : new RegExp(`^${k}$`) }).first().click();
      await venue.page.getByRole("button", { name: /Show code/ }).click();
      const payload2 = await venue.page.locator("[data-qr-payload]").getAttribute("data-qr-payload", { timeout: 30_000 });
      await cara.page.goto(payload2!);
      await cara.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
      await cara.page.waitForTimeout(2500);
      await shot(cara.page, "c6-pay-confirm-referred");
      const tPay2 = Date.now();
      await cara.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
      const t2 = await cara.page.waitForFunction(
        () => {
          const t = (window as unknown as { __vouchTimings?: { step: string }[] }).__vouchTimings ?? [];
          return t.some((x) => x.step === "settled") ? t : null;
        },
        null,
        { timeout: 120_000 },
      );
      result.referredSettledMs = Date.now() - tPay2;
      result.referredTimings = await t2.jsonValue();
      log("cara: settled", `${result.referredSettledMs}ms`, JSON.stringify(result.referredTimings));
      await cara.page.waitForTimeout(1500);
      await shot(cara.page, "c7-settled-referred");
      await venue.page.getByText(/Payment received|Paid/).first().waitFor({ timeout: 60_000 });
      await shot(venue.page, "v7-order-paid-referred");
      await venue.page.goto(`${BASE}/venue/${venueAddr}`);
      await venue.page.waitForTimeout(5000);
      await shot(venue.page, "v8-dashboard-referred");
      await venue.page.setViewportSize({ width: 1280, height: 720 });
      await venue.page.waitForTimeout(2500);
      await shot(venue.page, "v9-dashboard-projector-1280");
      await venue.page.setViewportSize({ width: 390, height: 844 });
      await cust.page.goto(`${BASE}/wallet`);
      await cust.page.waitForTimeout(4000);
      await shot(cust.page, "c8-ben-wallet-rewarded");
      await cust.page.goto(`${BASE}/me`);
      await cust.page.waitForTimeout(3000);
      await shot(cust.page, "c9-ben-record");
    }
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? e.message : String(e);
    console.error(e);
  } finally {
    const file = join(OUT, `e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify(result, null, 2));
    log("wrote", file);
    await browser.close();
    process.exit(result.ok ? 0 : 1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
