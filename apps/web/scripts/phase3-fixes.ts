/**
 * Phase 3 gate fix pass (FRONTEND_INTEGRATION): verifies QE-3-01/03/05/08 + manifest at 390×844 on the shared dev
 * server, against the hosted api. Writes docs/evidence/phase-3/fixes/fe/*.png + results.json.
 *
 *   node --no-warnings apps/web/scripts/phase3-fixes.ts [--base http://localhost:3100] [--order-venue-file <json>]
 *
 * Spend: nothing on chain. Sign-ins are free; the one real order (QE-3-03) is created with the owner session in
 * --order-venue-file ({venue, token}; default: QE's errors-venue.json) and is DB-only. POST /payments and
 * GET /payments/:id are intercepted, so no payment is relayed and no top-up is used. Ownership for the "owner still
 * sees Take an order" control is forced by rewriting GET /venues/:venue's owner (read-only view, no api write).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const API = "https://api-production-902bc54c.up.railway.app";
const EVID = join(ROOT, "docs/evidence/phase-3");
const OUT = join(EVID, "fixes/fe");
mkdirSync(OUT, { recursive: true });
const latestE2e = readdirSync(EVID).filter((f) => /^e2e-.*\.json$/.test(f)).sort().pop()!;
const E2E = JSON.parse(readFileSync(join(EVID, latestE2e), "utf8")) as { venue: string };
const ORDER_VENUE = JSON.parse(
  readFileSync(arg("order-venue-file", "/private/tmp/claude-501/-Users-christiandizon-Desktop-ubc-2026/ae4cd97a-99ad-4771-bb22-b82f35ada2d7/scratchpad/qe3/errors-venue.json"), "utf8"),
) as { venue: string; token: string };

type Check = { id: string; item: string; pass: boolean; detail: string; shot?: string };
const checks: Check[] = [];
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const H = { "access-control-allow-origin": BASE };

async function newPhone(browser: Browser, label: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`${label}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push(`${label} console: ${m.text().slice(0, 200)}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  });
  return { ctx, page, errs };
}
async function shot(page: Page, file: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${file}.png`) });
  return `${file}.png`;
}
function check(id: string, item: string, pass: boolean, detail: string, shotFile?: string) {
  checks.push({ id, item, pass, detail, shot: shotFile });
  log(pass ? "PASS" : "FAIL", id, item, "|", detail);
}
/** Visible ink-primary buttons/links (same rule as QE's audit: class bg-ink). */
const primaries = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, a")]
      .filter((e) => /\bbg-ink\b/.test(e.className.toString()) && (e as HTMLElement).offsetParent !== null)
      .map((e) => (e.textContent ?? "").trim()),
  );
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);
async function signIn(page: Page, name: string) {
  await page.goto(`${BASE}/`);
  await page.getByLabel(/first name/i).fill(name);
  await page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }).click();
  await page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await page.waitForURL(/\/wallet/, { timeout: 30_000 }).catch(() => {});
  return (await page.evaluate(() => JSON.parse(localStorage.getItem("vouch.session.v1")!).address)) as string;
}

async function main() {
  const browser = await chromium.launch();
  try {
    // ------------------------------------------------------------------ QE-3-01 malformed links (signed out)
    const anon = await newPhone(browser, "anon");
    const bad: [string, string][] = [
      ["f01-pay-missing-order", `/pay?v=${E2E.venue}`],
      ["f02-pay-garbage", `/pay?v=0x123&o=nope`],
      ["f03-pay-truncated-order", `/pay?v=${E2E.venue}&o=0x${"ab".repeat(20)}`],
    ];
    for (const [file, path] of bad) {
      await anon.page.goto(`${BASE}${path}`);
      await anon.page.getByText("This link doesn't look right").waitFor({ timeout: 20_000 }).catch(() => {});
      const text = await bodyText(anon.page);
      const prim = await primaries(anon.page);
      const s = await shot(anon.page, file);
      check("QE-3-01", `${path} → invalid-link state`, /This link doesn't look right/.test(text) && !/Try again|didn't go through/.test(text) && prim.length === 1 && /Scan a new code/.test(prim[0]!) && (await anon.page.locator("[data-pay-state=invalid-link]").count()) === 1, `primaries=${JSON.stringify(prim)}`, s);
    }
    await anon.page.getByRole("button", { name: "Scan a new code" }).click();
    await anon.page.waitForURL(/\/scan/, { timeout: 10_000 }).catch(() => {});
    check("QE-3-01", "Scan a new code → /scan (no loop)", /\/scan$/.test(new URL(anon.page.url()).pathname), anon.page.url().replace(BASE, ""));

    // ------------------------------------------------------------------ QE-3-08 not-found
    const r404 = await anon.page.goto(`${BASE}/does-not-exist`);
    await anon.page.getByText("We can't find that page").waitFor({ timeout: 15_000 }).catch(() => {});
    await anon.page.keyboard.press("Tab");
    const focus = await anon.page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const cs = a ? getComputedStyle(a) : null;
      return { tag: a?.tagName, text: a?.textContent?.trim(), outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : "", shadow: cs?.boxShadow ?? "" };
    });
    const s404 = await shot(anon.page, "f10-not-found");
    const prim404 = await primaries(anon.page);
    check("QE-3-08", "/does-not-exist → styled 404 with a way home", r404?.status() === 404 && /We can't find that page/.test(await bodyText(anon.page)) && prim404.length === 1, `status=${r404?.status()} primaries=${JSON.stringify(prim404)} firstTab=${JSON.stringify(focus)}`, s404);
    await anon.page.getByRole("link", { name: "Go to Vouch" }).click();
    await anon.page.waitForURL((u) => u.pathname === "/", { timeout: 10_000 }).catch(() => {});
    check("QE-3-08", "Go to Vouch → /", new URL(anon.page.url()).pathname === "/", anon.page.url().replace(BASE, ""));

    // ------------------------------------------------------------------ manifest
    const man = await anon.page.request.get(`${BASE}/manifest.webmanifest`);
    const mj = await man.json();
    const iconsOk = await Promise.all((mj.icons as { src: string }[]).map(async (i) => (await anon.page.request.get(`${BASE}${i.src}`)).status() === 200));
    await anon.page.goto(`${BASE}/`);
    const links = await anon.page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href"),
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
      theme: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")),
    }));
    check("manifest", "manifest + icons served and linked", man.status() === 200 && mj.name === "Vouch" && mj.theme_color === "#f6f4ef" && iconsOk.every(Boolean) && !!links.manifest && !!links.apple, JSON.stringify({ name: mj.name, theme: mj.theme_color, display: mj.display, icons: mj.icons.length, links }));

    // ------------------------------------------------------------------ signed-in customer (non-owner)
    const fay = await newPhone(browser, "fay");
    const me = await signIn(fay.page, "Fay");
    log("Fay", me);

    // QE-3-01 (signed in): well-formed link to an order the api doesn't know → 404 → invalid link (not "failed").
    await fay.page.goto(`${BASE}/pay?v=${E2E.venue}&o=0x${"0".repeat(63)}1`);
    await fay.page.getByText("This link doesn't look right").waitFor({ timeout: 30_000 }).catch(() => {});
    {
      const text = await bodyText(fay.page);
      const s = await shot(fay.page, "f04-pay-unknown-order-signed-in");
      check("QE-3-01", "unknown order (api 404) → invalid-link state", /This link doesn't look right/.test(text) && !/Try again|didn't go through/.test(text), text.slice(0, 120).replace(/\n/g, " · "), s);
    }

    // QE-3-05: someone else's dashboard + counter.
    await fay.page.goto(`${BASE}/venue/${E2E.venue}`);
    await fay.page.waitForTimeout(6000);
    {
      const text = await bodyText(fay.page);
      const takeBtn = await fay.page.getByRole("button", { name: /Take an order/ }).count();
      const s = await shot(fay.page, "f20-dashboard-non-owner");
      check("QE-3-05", "non-owner dashboard: no 'Take an order'", takeBtn === 0 && text.length > 50, `takeOrderButtons=${takeBtn}`, s);
    }
    await fay.page.goto(`${BASE}/venue/${E2E.venue}/counter`);
    await fay.page.getByText("Only the owner can take orders here").waitFor({ timeout: 20_000 }).catch(() => {});
    {
      const text = await bodyText(fay.page);
      const keypad = await fay.page.getByRole("button", { name: /Show code/ }).count();
      const prim = await primaries(fay.page);
      const s = await shot(fay.page, "f21-counter-non-owner");
      check("QE-3-05", "non-owner counter: read-only, no keypad", /Only the owner can take orders here/.test(text) && keypad === 0 && prim.length === 1, `primaries=${JSON.stringify(prim)}`, s);
    }
    // Control: the owner still gets it (ownership forced on the read only).
    const forceOwner = async (route: Route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (j && typeof j === "object" && "owner" in j) j.owner = me;
      await route.fulfill({ response: res, json: j });
    };
    await fay.page.route(`${API}/venues/${E2E.venue}`, forceOwner);
    await fay.page.goto(`${BASE}/venue/${E2E.venue}`);
    await fay.page.getByRole("button", { name: /Take an order/ }).first().waitFor({ timeout: 20_000 }).catch(() => {});
    {
      const n = await fay.page.getByRole("button", { name: /Take an order/ }).count();
      const s = await shot(fay.page, "f22-dashboard-owner-control");
      check("QE-3-05", "control: owner dashboard still shows 'Take an order'", n >= 1, `takeOrderButtons=${n} (owner forced via GET /venues/:venue)`, s);
    }
    await fay.page.goto(`${BASE}/venue/${E2E.venue}/counter`);
    await fay.page.getByRole("button", { name: /Show code/ }).waitFor({ timeout: 20_000 }).catch(() => {});
    {
      const n = await fay.page.getByRole("button", { name: /Show code/ }).count();
      const s = await shot(fay.page, "f23-counter-owner-control");
      check("QE-3-05", "control: owner counter shows order entry", n === 1, `showCode=${n}`, s);
    }
    await fay.page.unroute(`${API}/venues/${E2E.venue}`);

    // ------------------------------------------------------------------ QE-3-03: first purchase, no recommendation
    const mk = await fetch(`${API}/venues/${ORDER_VENUE.venue}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ORDER_VENUE.token}`, origin: BASE },
      body: JSON.stringify({ amount: "500000", ttlSeconds: 600 }),
    });
    if (mk.status !== 201) {
      check("QE-3-03", "create a real order (DB only)", false, `POST /orders → ${mk.status} ${(await mk.text()).slice(0, 200)}`);
    } else {
      const { order } = (await mk.json()) as { order: { venue: string; orderId: string } };
      const payPath = `/pay?v=${order.venue}&o=${order.orderId}`;
      // Funded view of the REAL quote (a fresh account: first purchase, no recommendation).
      let realWarnings: string[] = [];
      await fay.page.route("**/payments/quote", async (route) => {
        const res = await route.fetch();
        const j = await res.json();
        if (!j.error) {
          realWarnings = j.warnings;
          j.balance = { baseUnits: "50000000", display: "50.00" };
          j.canAfford = true;
          j.warnings = j.warnings.filter((w: string) => w !== "insufficient_balance");
        }
        await route.fulfill({ response: res, json: j });
      });
      const fakeId = "00000000-0000-4000-8000-0000000fe303";
      const fakeTx = `0x${"fe".repeat(32)}`;
      let settledNow = false;
      await fay.page.route(`${API}/payments`, (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 202, contentType: "application/json", headers: H, body: JSON.stringify({ intentId: fakeId, status: "pending", txHash: fakeTx, relayId: "fe-fixes" }) })
          : route.fallback(),
      );
      await fay.page.route(`${API}/payments/${fakeId}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: H,
          body: JSON.stringify(
            settledNow
              ? { intentId: fakeId, status: "settled", settled: { source: "streams", venue: order.venue, customer: me, orderId: order.orderId, amount: { baseUnits: "500000", display: "0.50" }, venueAmount: { baseUnits: "500000", display: "0.50" }, rewardPool: { baseUnits: "0", display: "0.00" }, firstPurchase: true, rewarded: false, weightsMode: 0, txHash: fakeTx, blockNumber: "1", blockTime: Math.floor(Date.now() / 1000), lines: [] } }
              : { intentId: fakeId, status: "pending", settled: null },
          ),
        }),
      );
      await fay.page.goto(`${BASE}${payPath}`);
      await fay.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).waitFor({ timeout: 60_000 });
      await fay.page.waitForTimeout(800);
      const sheet = await bodyText(fay.page);
      const sSheet = await shot(fay.page, "f30-pay-sheet-first-visit-no-recommendation");
      check("QE-3-03", "pay sheet: first visit without recommendation copy", /No one recommended this place/i.test(sheet), `realQuoteWarnings=${JSON.stringify(realWarnings)}`, sSheet);
      await fay.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
      const firstVisit = (t: string) => /Thanks for coming in\./.test(t) && /When a friend recommends a place to you/.test(t) && !/Thanks for coming back/.test(t);
      // (not /^Paying / alone: the pay sheet's backdrop says "Paying with Vouch")
      await fay.page.getByText(/^Paying .*…$/).waitFor({ timeout: 30_000 });
      const pend = await bodyText(fay.page);
      const sPend = await shot(fay.page, "f31-success-pending-first-visit");
      check("QE-3-03", "success (pending): first-visit copy, not 'Thanks for coming back'", firstVisit(pend), pend.slice(0, 160).replace(/\n+/g, " · "), sPend);
      settledNow = true;
      await fay.page.getByText(/^Paid at /).waitFor({ timeout: 20_000 }).catch(() => {});
      const text = await bodyText(fay.page);
      const sSet = await shot(fay.page, "f32-success-settled-first-visit");
      check("QE-3-03", "success (settled): first-visit copy, not 'Thanks for coming back'", /Paid at /.test(text) && firstVisit(text), text.slice(0, 160).replace(/\n+/g, " · "), sSet);
    }

    const errs = [...anon.errs, ...fay.errs];
    check("console", "no page errors / app console errors", errs.length === 0, errs.join(" | ").slice(0, 400) || "none");
  } finally {
    await browser.close();
  }
  const out = { at: new Date().toISOString(), base: BASE, api: API, venue: E2E.venue, checks, pass: checks.every((c) => c.pass) };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(out, null, 2));
  log(out.pass ? "ALL PASS" : "SOME FAILED", `${checks.filter((c) => c.pass).length}/${checks.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
