// QE_E2E Phase 5: VIDEO_SCRIPT prep step P4 as a reusable stage (see e2e/phase5/P4_README.md).
//
//   node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --build [--force]
//   node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --verify      (headless reopen check, no spend)
//   node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --present [--check-seconds 20]   (HEADED; human only)
//
// --build (headless): a fresh venue "Lena's Corner" (20%, min $0.50) owned by "Lena"; Priya (fresh, $3 from DEPLOYER)
//   pays $1.00 (verified); Priya recommends → Ana opens + saves the link, gets $3 from DEPLOYER, pays $2.00 picking Priya
//   (Priya rewarded, so Ana's introducer at the venue is Priya); Ana → Recommend → Make my link = Ben's link.
//   Everything needed to reopen the sessions is saved in e2e/phase5/.state/ (gitignored): p4.json, persistent browser
//   profiles, and the virtual-authenticator credentials (CDP WebAuthn.getCredentials → WebAuthn.addCredential).
//   The in-app demo top-up is never used (POST /demo/topup is blocked in every build context).
// --present (headed): reopens the saved owner + Ana sessions in three plain Chromium windows (no automation bar):
//   W1 owner dashboard 1440×900, W2 Ana's wallet 390×844, W3 Ben's link as a big QR + URL. Stays open until Ctrl+C.
//   If the saved stage is missing, broken, or already used (Ben paid), it says so and runs --build first.
// The personas' authenticators have no PRF, so the app stores the wallet in "gated" mode (non-extractable key in the
// profile's IndexedDB, unlocked by a passkey assertion): a re-imported credential unlocks it hours later.
// Never reads .env; the DEPLOYER top-up goes through the existing CLI (`pnpm --filter @vouch/scripts topup`).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, BASE, ROOT, apiJson, chromium, log, onboard, sessionOf, settle, sleep } from "../phase3/lib.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flagv = (f) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const req = createRequire(join(ROOT, "apps/web/package.json"));
const QR = req("qrcode");
const viem = req("viem");

const STATE_DIR = join(ROOT, "e2e/phase5/.state");
const STATE = join(STATE_DIR, "p4.json");
const PARTIAL = join(STATE_DIR, "p4.partial.json");
const EVID = join(ROOT, "docs/evidence/phase-5/prod/p4");
mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(EVID, { recursive: true });

const RPC = "https://rpc.testnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000";
const VOUCH = "0xF4B641dc628de05336aa983B07D5d181254ff08e";
const DEPLOYER = "0x5eD3054292e9fCE089aa082997962B08fFF81111";
const VENUE_NAME = "Lena's Corner";
const REWARD_PCT = 20;
const MIN_ORDER = "0.50";
const FUND_TARGET = "3.00";
const AUTH_OPTS = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: false };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
// Same full Chromium binary headless + headed. No "controlled by automated test software" bar: drop --enable-automation;
// --test-type then also suppresses the "unsupported command-line flag" bar Chromium puts on a persistent startup tab.
const LAUNCH = { channel: "chromium", ignoreDefaultArgs: ["--enable-automation"] };
const BAR_ARGS = ["--test-type"];

const pub = viem.createPublicClient({ transport: viem.http(RPC, { retryCount: 6, retryDelay: 1500 }) });
const erc20 = viem.parseAbi(["function balanceOf(address) view returns (uint256)"]);
const vouchAbi = viem.parseAbi(["function introducerOf(address venue, address customer) view returns (address)"]);
const usd = (b) => (Number(b) / 1e6).toFixed(6).replace(/0{1,4}$/, "");
const bal = (a) => pub.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [a] });

// ------------------------------------------------------------------ contexts
async function openPersona(dir, kind, { headless, creds, pos } = {}) {
  mkdirSync(dir, { recursive: true });
  const shape = kind === "phone" ? PHONE : DESK;
  const ctx = await chromium.launchPersistentContext(dir, {
    ...LAUNCH,
    headless,
    ...shape,
    permissions: ["camera"],
    args: [...BAR_ARGS, "--use-fake-ui-for-media-stream", ...(pos ? [`--window-position=${pos}`] : [])],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH_OPTS });
  for (const c of creds ?? []) await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: c });
  return { ctx, page, cdp, authenticatorId, exportCreds: async () => (await cdp.send("WebAuthn.getCredentials", { authenticatorId })).credentials };
}
const blockDemoTopup = (ctx) =>
  ctx.route("**/demo/topup", (r) => (r.request().method() === "POST" ? r.abort("blockedbyclient") : r.continue()));

async function keyIn(page, keys) {
  for (const k of keys) await page.getByRole("button", { name: k.length === 1 ? new RegExp(`^${k}$`) : k }).click();
}
const amountKeys = (a) => [...a].map((ch) => (ch === "." ? "Decimal point" : ch));
async function newOrder(owner, venue, amount) {
  await owner.page.goto(`${BASE}/venue/${venue}/counter`);
  await settle(owner.page, 800);
  await keyIn(owner.page, amountKeys(amount));
  await owner.page.getByRole("button", { name: /Show code/ }).click();
  return owner.page.locator("[data-qr-payload]").getAttribute("data-qr-payload", { timeout: 30_000 });
}
const confirmEnabled = (page, ms = 60_000) =>
  page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Confirm with Face ID or fingerprint/.test(x.getAttribute("aria-label") || x.innerText));
    return b && !b.disabled;
  }, null, { timeout: ms });
async function waitSettled(page, ms) {
  const h = await page.waitForFunction(() => {
    const t = window.__vouchTimings ?? [];
    return t.some((x) => x.step === "settled") ? t : null;
  }, null, { timeout: ms });
  return h.jsonValue();
}
async function feeOf(tx) {
  const r = await pub.getTransactionReceipt({ hash: tx });
  return { tx, status: r.status, block: Number(r.blockNumber), feeUsdc: Number(r.gasUsed * r.effectiveGasPrice) / 1e18 };
}
/** USDC transfers in a pay receipt, independent of the api (same method as e2e/phase3/verify-chain.mjs). */
async function transfersOf(tx) {
  const r = await pub.getTransactionReceipt({ hash: tx });
  const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const a = (t) => viem.getAddress(`0x${t.slice(26)}`);
  return r.logs.filter((l) => l.address.toLowerCase() === USDC && l.topics[0] === T).map((l) => ({ from: a(l.topics[1]), to: a(l.topics[2]), value: BigInt(l.data) }));
}
function deployerTopup(addr) {
  // The CLI tops UP TO the target (idempotent). Arc's public RPC rate-limits bursts (429 before anything is sent):
  // retry only when the output shows nothing was sent.
  let out;
  for (let i = 1; ; i++) {
    try {
      out = execFileSync("pnpm", ["--silent", "--filter", "@vouch/scripts", "topup", "--to", addr, "--target", FUND_TARGET, "--max-total", "3.10"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      break;
    } catch (e) {
      const so = String(e.stdout ?? "");
      if (/^sent /m.test(so) || i >= 4) throw new Error(`DEPLOYER top-up failed (attempt ${i}): ${so.slice(-300)} ${String(e.stderr ?? "").split("\n").find((l) => /Error|429|rate/i.test(l)) ?? ""}`);
      log(`DEPLOYER top-up attempt ${i} failed before sending (RPC rate limit?); retrying in 8 s`);
      execFileSync("sleep", ["8"]);
    }
  }
  const tx = /tx=(0x[0-9a-fA-F]{64})/.exec(out)?.[1] ?? null;
  const sent = /sent \S+\s+\$([\d.]+)/.exec(out)?.[1] ?? (/nothing to do/.test(out) ? "0" : null);
  return { tx, sent, tail: out.split("\n").filter((l) => /^(sent|plan total|deployer|nothing)/.test(l)).join(" | ") };
}

// ------------------------------------------------------------------ build
async function build({ force = false } = {}) {
  if (existsSync(PARTIAL)) {
    const old = JSON.parse(readFileSync(PARTIAL, "utf8"));
    const dest = join(STATE_DIR, `abandoned-${old.buildId}.json`);
    renameSync(PARTIAL, dest);
    console.log(`!! Found an UNFINISHED build ${old.buildId} (last step: ${old.steps.at(-1)?.step ?? "none"}). It is NOT reused.`);
    console.log(`   What it spent: ${JSON.stringify(old.spend)}. Kept for reference at ${dest.replace(ROOT + "/", "")}. Starting fresh.`);
  }
  if (existsSync(STATE) && !force) {
    const s = JSON.parse(readFileSync(STATE, "utf8"));
    console.log(`A complete stage already exists (${s.venue.name} ${s.venue.address}, built ${s.builtAt}).`);
    console.log("Nothing was spent. Use --present to open it, or --build --force to build a NEW one (spends about $6 from DEPLOYER).");
    process.exit(2);
  }
  const buildId = new Date().toISOString().replace(/[:.]/g, "-");
  const prof = join(STATE_DIR, "profiles", buildId);
  const S = { buildId, base: BASE, api: API, status: "building", startedAt: new Date().toISOString(), steps: [], spend: { deployerTransfers: [], relayerTxs: [], demoTopupCapUsed: "0.00" }, profiles: { owner: join(prof, "owner"), priya: join(prof, "priya"), ana: join(prof, "ana") } };
  const save = () => writeFileSync(PARTIAL, JSON.stringify(S, null, 2));
  const step = (name, extra = {}) => {
    S.steps.push({ step: name, at: new Date().toISOString(), ...extra });
    save();
    log("STEP", name, JSON.stringify(extra));
  };
  save();
  const deployerBefore = await bal(DEPLOYER);
  S.deployerBefore = usd(deployerBefore);
  const open = [];
  try {
    // ---- owner Lena registers "Lena's Corner" at 20%, min $0.50
    const owner = await openPersona(S.profiles.owner, "desk", { headless: true });
    open.push(owner);
    await blockDemoTopup(owner.ctx);
    await owner.page.goto(`${BASE}/venue`);
    await settle(owner.page);
    await onboard(owner.page, "Lena");
    await owner.page.waitForURL(/\/venue\/new/, { timeout: 60_000 });
    await settle(owner.page, 500);
    await owner.page.getByLabel(/Name customers will see/i).fill(VENUE_NAME);
    const slider = owner.page.getByRole("slider");
    await slider.focus();
    for (let i = 0; i < 40 && Number(await slider.inputValue()) < REWARD_PCT; i++) await slider.press("ArrowRight");
    for (let i = 0; i < 40 && Number(await slider.inputValue()) > REWARD_PCT; i++) await slider.press("ArrowLeft");
    await owner.page.getByLabel(/Minimum first order/i).fill(MIN_ORDER);
    const regRes = owner.page.waitForResponse((r) => /\/venues$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 60_000 });
    await owner.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    const reg = await (await regRes).json();
    await owner.page.waitForURL(/\/venue\/0x[0-9a-fA-F]{40}$/, { timeout: 120_000 });
    const venue = owner.page.url().split("/").pop();
    S.owner = { name: "Lena", address: (await sessionOf(owner.page)).address };
    S.spend.relayerTxs.push({ what: "venue registration", tx: reg.txHash });
    let vinfo;
    for (let i = 0; i < 30; i++) {
      vinfo = (await apiJson(`/venues/${venue}`)).json;
      if (vinfo.onchain) break;
      await sleep(3000);
    }
    if (!vinfo?.onchain) throw new Error("STREAM_NOT_ACTIVE: the venue registration was not ingested within 90 s (stopped before any top-up)");
    if (vinfo.terms?.rewardBps !== REWARD_PCT * 100 || vinfo.terms?.minOrder?.display !== MIN_ORDER) throw new Error(`venue terms wrong: ${JSON.stringify(vinfo.terms)}`);
    S.venue = { address: venue, name: vinfo.name, payout: vinfo.onchain.payout, terms: vinfo.terms, dashboardUrl: `${BASE}/venue/${venue}`, projectorUrl: `${BASE}/venue/${venue}` };
    step("venue registered", { venue, tx: reg.txHash, rewardBps: vinfo.terms.rewardBps });

    // ---- Priya: fresh account, funded from DEPLOYER, pays $1.00 (plain first purchase → verified)
    const priya = await openPersona(S.profiles.priya, "phone", { headless: true });
    open.push(priya);
    await blockDemoTopup(priya.ctx);
    await priya.page.goto(`${BASE}/`);
    await settle(priya.page);
    await onboard(priya.page, "Priya");
    await priya.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
    S.priya = { name: "Priya", address: (await sessionOf(priya.page)).address };
    step("priya account", S.priya);
    const fP = deployerTopup(S.priya.address);
    S.spend.deployerTransfers.push({ to: "Priya", ...fP });
    step("priya funded from DEPLOYER", fP);
    const qr1 = await newOrder(owner, venue, "1.00");
    await priya.page.goto(qr1);
    await confirmEnabled(priya.page, 90_000);
    await settle(priya.page, 800);
    await priya.page.screenshot({ path: join(EVID, "b01-priya-pay-confirm.png") });
    await priya.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    const tp = await waitSettled(priya.page, 90_000);
    S.priya.payTx = tp.find((x) => x.step === "pending")?.txHash;
    S.priya.payTimings = tp;
    S.spend.relayerTxs.push({ what: "Priya pay $1.00", tx: S.priya.payTx });
    step("priya paid $1.00 (settled)", { tx: S.priya.payTx });

    // ---- Priya recommends → link for Ana
    await priya.page.goto(`${BASE}/recommend?venue=${venue}`);
    await settle(priya.page, 2000);
    const introP = priya.page.waitForResponse((r) => r.url().endsWith("/intros") && r.request().method() === "POST", { timeout: 60_000 });
    await priya.page.getByRole("button", { name: /Make my link/ }).click();
    const iP = await (await introP).json();
    S.priya.link = `${BASE}/i/${iP.code}`;
    step("priya made a link", { link: S.priya.link });

    // ---- Ana: opens Priya's link, saves it, funded from DEPLOYER, pays $2.00 picking Priya
    const ana = await openPersona(S.profiles.ana, "phone", { headless: true });
    open.push(ana);
    await blockDemoTopup(ana.ctx);
    await ana.page.goto(S.priya.link);
    await settle(ana.page, 1500);
    await onboard(ana.page, "Ana");
    const saveBtn = ana.page.getByRole("button", { name: /Save .* recommendation/ });
    await saveBtn.waitFor({ timeout: 60_000 });
    const accRes = ana.page.waitForResponse((r) => /\/intros\/[^/]+\/accept$/.test(r.url()) && r.request().method() === "POST", { timeout: 60_000 });
    await saveBtn.click();
    const acc = await (await accRes).json();
    await ana.page.getByRole("button", { name: /^Done$/ }).waitFor({ timeout: 120_000 });
    S.ana = { name: "Ana", address: (await sessionOf(ana.page)).address, acceptTx: acc.txHash };
    S.spend.relayerTxs.push({ what: "Ana saves Priya's link", tx: acc.txHash });
    step("ana saved Priya's link", { address: S.ana.address, tx: acc.txHash });
    const fA = deployerTopup(S.ana.address);
    S.spend.deployerTransfers.push({ to: "Ana", ...fA });
    step("ana funded from DEPLOYER", fA);
    const qr2 = await newOrder(owner, venue, "2.00");
    await ana.page.goto(qr2);
    await confirmEnabled(ana.page, 90_000);
    await settle(ana.page, 1500); // names ("Priya") resolve after the quote; before that the chip reads "A friend"
    const chip = ana.page.getByRole("radio", { name: /Priya/ });
    S.ana.chips = await ana.page.getByRole("radio").allInnerTexts().catch(() => []);
    if (await chip.count()) {
      await chip.first().click();
      await ana.page.waitForTimeout(2500);
    }
    await confirmEnabled(ana.page, 30_000);
    S.ana.paySheetText = (await ana.page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 400);
    await ana.page.screenshot({ path: join(EVID, "b02-ana-pay-confirm-picked-priya.png") });
    await ana.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
    const ta = await waitSettled(ana.page, 90_000);
    S.ana.payTx = ta.find((x) => x.step === "pending")?.txHash;
    S.ana.payTimings = ta;
    S.spend.relayerTxs.push({ what: "Ana pay $2.00", tx: S.ana.payTx });
    await ana.page.waitForTimeout(2000);
    await ana.page.screenshot({ path: join(EVID, "b03-ana-paid.png") });
    step("ana paid $2.00 (settled)", { tx: S.ana.payTx });

    // ---- Ana → Recommend → Make my link (Ben's link)
    await ana.page.goto(`${BASE}/recommend?venue=${venue}`);
    await settle(ana.page, 2000);
    const introA = ana.page.waitForResponse((r) => r.url().endsWith("/intros") && r.request().method() === "POST", { timeout: 60_000 });
    await ana.page.getByRole("button", { name: /Make my link/ }).click();
    const iA = await (await introA).json();
    S.benLink = `${BASE}/i/${iA.code}`;
    S.benLinkCode = iA.code;
    await ana.page.waitForTimeout(1000);
    await ana.page.screenshot({ path: join(EVID, "b04-ana-link-for-ben.png") });
    step("ana made Ben's link", { benLink: S.benLink });

    // ---- verification (chain, independent of the api)
    S.verify = await verifyStage(S);
    step("verified", { ok: S.verify.ok });

    // ---- dashboard + wallet shots, then export credentials and close cleanly
    await owner.page.goto(S.venue.dashboardUrl);
    await settle(owner.page, 4000);
    const dashText = await owner.page.evaluate(() => document.body.innerText);
    S.verify.dashboardShowsPriya = /Priya/.test(dashText);
    S.verify.dashboardShowsAna = /Ana/.test(dashText);
    // Note: at ≥1024 px the dashboard shows "Take an order" only while empty; --present opens the counter as tab 2.
    await owner.page.screenshot({ path: join(EVID, "b05-owner-dashboard-1440.png") });
    await owner.page.screenshot({ path: join(EVID, "b05b-owner-dashboard-1440-full.png"), fullPage: true });
    await ana.page.goto(`${BASE}/wallet`);
    await settle(ana.page, 2500);
    await ana.page.screenshot({ path: join(EVID, "b06-ana-wallet-390.png") });
    for (const [k, p] of [["owner", owner], ["priya", priya], ["ana", ana]]) {
      const creds = await p.exportCreds();
      writeFileSync(join(STATE_DIR, `creds-${buildId}-${k}.json`), JSON.stringify(creds));
      S[k].credsFile = `creds-${buildId}-${k}.json`;
      S[k].credentialCount = creds.length;
    }
    if (!S.verify.ok || !S.verify.dashboardShowsPriya || !S.verify.dashboardShowsAna) throw new Error(`verification failed: ${JSON.stringify(S.verify)}`);
    S.status = "complete";
    S.builtAt = new Date().toISOString();
  } catch (e) {
    S.status = "failed";
    S.error = String(e?.message ?? e);
    console.error(e);
  } finally {
    for (const p of open) await p.ctx.close().catch(() => {});
    // spend summary (exact, from receipts and balances)
    for (const t of S.spend.relayerTxs) if (t.tx) Object.assign(t, await feeOf(t.tx).catch(() => ({ feeUsdc: null })));
    for (const t of S.spend.deployerTransfers) if (t.tx) Object.assign(t, { fee: (await feeOf(t.tx).catch(() => ({ feeUsdc: null }))).feeUsdc });
    const deployerAfter = await bal(DEPLOYER);
    S.deployerAfter = usd(deployerAfter);
    S.spend.deployerTotal = usd(deployerBefore - deployerAfter);
    S.spend.relayerGasTotal = S.spend.relayerTxs.reduce((a, t) => a + (t.feeUsdc ?? 0), 0).toFixed(6);
    save();
    console.log("\n== SPENT by this build ==");
    for (const t of S.spend.deployerTransfers) console.log(`DEPLOYER → ${t.to}: $${t.sent}  tx ${t.tx}  (gas ${t.fee ?? "?"} USDC)`);
    console.log(`DEPLOYER total: $${S.spend.deployerTotal} (balance $${S.deployerBefore} → $${S.deployerAfter}, incl. gas)`);
    for (const t of S.spend.relayerTxs) console.log(`relayer gas: ${t.what}  ${t.feeUsdc ?? "?"} USDC  tx ${t.tx}`);
    console.log(`relayer gas total: ${S.spend.relayerGasTotal} USDC · in-app demo top-up cap used: $0.00 (blocked)`);
    if (S.status === "complete") {
      if (existsSync(STATE)) renameSync(STATE, join(STATE_DIR, `p4-replaced-${buildId}.json`));
      renameSync(PARTIAL, STATE);
      writeFileSync(join(EVID, "p4-build.json"), JSON.stringify(redact(S), null, 2));
      console.log(`\nSTAGE READY → ${STATE.replace(ROOT + "/", "")}`);
      printStage(S);
    } else {
      const dest = join(STATE_DIR, `failed-${buildId}.json`);
      renameSync(PARTIAL, dest);
      writeFileSync(join(EVID, `p4-build-failed-${buildId}.json`), JSON.stringify(redact(S), null, 2));
      console.log(`\nBUILD FAILED (${S.error}). Nothing is reused; record kept at ${dest.replace(ROOT + "/", "")}.`);
      process.exitCode = 1;
    }
  }
  return S;
}
const redact = (S) => ({ ...S, profiles: undefined });

async function verifyStage(S) {
  const v = S.venue.address;
  const out = { checks: [] };
  const ck = (name, ok, detail) => out.checks.push({ name, ok, detail });
  // Priya's $1.00: plain first purchase → all to the venue payout
  const tp = await transfersOf(S.priya.payTx);
  const inP = tp.filter((t) => t.to === viem.getAddress(VOUCH)).reduce((a, t) => a + t.value, 0n);
  const outP = tp.filter((t) => t.from === viem.getAddress(VOUCH));
  ck("Priya pay exact: 1.00 in, 1.00 → venue payout", inP === 1_000_000n && outP.length === 1 && outP[0].to === viem.getAddress(S.venue.payout) && outP[0].value === 1_000_000n, outP.map((t) => `${t.to}:${usd(t.value)}`));
  // Ana's $2.00 at 20% with Priya as the only referrer: pool 0.40 → Ana 0.10, Priya 0.22, L2 0.08 returned → venue 1.68
  const ta = await transfersOf(S.ana.payTx);
  const inA = ta.filter((t) => t.to === viem.getAddress(VOUCH)).reduce((a, t) => a + t.value, 0n);
  const outA = ta.filter((t) => t.from === viem.getAddress(VOUCH));
  const by = (a) => outA.filter((t) => t.to === viem.getAddress(a)).reduce((x, t) => x + t.value, 0n);
  const sumA = outA.reduce((a, t) => a + t.value, 0n);
  ck("Ana pay exact: 2.00 in = Σ out", inA === 2_000_000n && sumA === 2_000_000n, `in ${usd(inA)} out ${usd(sumA)}`);
  ck("Ana pay split: Ana 0.10 · Priya 0.22 · venue 1.68", by(S.ana.address) === 100_000n && by(S.priya.address) === 220_000n && by(S.venue.payout) === 1_680_000n, outA.map((t) => `${t.to}:${usd(t.value)}`));
  // The chain for Ben: Ana's introducer at this venue must be Priya (L2), Priya's must be none.
  const introAna = await pub.readContract({ address: VOUCH, abi: vouchAbi, functionName: "introducerOf", args: [v, S.ana.address] });
  const introPriya = await pub.readContract({ address: VOUCH, abi: vouchAbi, functionName: "introducerOf", args: [v, S.priya.address] });
  ck("introducerOf(venue, Ana) == Priya", introAna.toLowerCase() === S.priya.address.toLowerCase(), introAna);
  ck("introducerOf(venue, Priya) == 0 (plain first purchase)", /^0x0{40}$/i.test(introPriya), introPriya);
  // Ben's link: Ana's personal link on this venue, current terms
  const bl = (await apiJson(`/intros/${S.benLinkCode}`)).json;
  ck("Ben's link: Ana · personal · active · this venue · 20%", bl.referrer?.address?.toLowerCase() === S.ana.address.toLowerCase() && bl.linkType === "personal" && bl.status === "active" && bl.venue?.venue?.toLowerCase() === v.toLowerCase() && bl.terms?.rewardBps === 2000, { referrer: bl.referrer?.displayName, linkType: bl.linkType, status: bl.status, termsVersion: bl.termsVersion, expiresAt: bl.expiresAt ? new Date(Number(bl.expiresAt) * 1000).toISOString() : null });
  // api agrees
  const st = (await apiJson(`/venues/${v}/stats`)).json;
  ck("api stats: 2 payments, 2 verified, gross 3.00", st.payments === 2 && st.verifiedCustomers === 2 && st.gross?.display === "3.00", { payments: st.payments, verified: st.verifiedCustomers, gross: st.gross?.display, rewardsPaid: st.rewardsPaid?.display });
  // Expected live numbers for Ben's $2.00 (fresh, first purchase, single intro from Ana → Ana 100% L1, Priya L2)
  const amount = 2_000_000n, pool = (amount * 2000n) / 10_000n, ben = (pool * 2500n) / 10_000n, l1 = (pool * 5500n) / 10_000n, l2 = pool - ben - l1;
  out.expectedBen = { pool: usd(pool), ben: usd(ben), ana: usd(l1), priya: usd(l2), venue: usd(amount - pool) };
  ck("expected Ben split = $0.40 → 0.10 / 0.22 / 0.08 / venue 1.60", out.expectedBen.pool === "0.40" && out.expectedBen.ben === "0.10" && out.expectedBen.ana === "0.22" && out.expectedBen.priya === "0.08" && out.expectedBen.venue === "1.60", out.expectedBen);
  out.ok = out.checks.every((c) => c.ok);
  for (const c of out.checks) log(c.ok ? "OK  " : "FAIL", c.name, typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail));
  return out;
}

function printStage(S) {
  console.log("\n================ P4 STAGE ================");
  console.log(`Venue        ${S.venue.name}  ${S.venue.address}  (20%, min $0.50)`);
  console.log(`Owner Lena   ${S.owner.address}`);
  console.log(`Priya        ${S.priya.address}`);
  console.log(`Ana          ${S.ana.address}   (her introducer here: Priya)`);
  console.log(`Ben's link   ${S.benLink}`);
  console.log(`Projector    ${S.venue.projectorUrl}   (any signed-in browser shows the live dashboard)`);
  console.log(`Ben pays $2.00 → pool $0.40 · Ben $0.10 back · Ana $0.22 · Priya $0.08 · venue $1.60`);
  console.log("==========================================\n");
}

// ------------------------------------------------------------------ present
async function checkPersona(p, who, S) {
  const problems = [];
  const w = await p.page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("vouch-wallet", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("wallets");
    r.onsuccess = () => {
      try {
        const g = r.result.transaction("wallets").objectStore("wallets").get("current");
        g.onsuccess = () => res(g.result ? { address: g.result.address, mode: g.result.mode, credentialId: g.result.credentialId } : null);
        g.onerror = () => res(null);
      } catch { res(null); }
    };
    r.onerror = () => res(null);
  }));
  if (!w) problems.push(`${who}: no wallet in the saved profile`);
  else if (w.address.toLowerCase() !== S[who].address.toLowerCase()) problems.push(`${who}: profile wallet ${w.address} != saved ${S[who].address}`);
  if (w?.credentialId) {
    const ok = await p.page.evaluate(async (id) => {
      const pad = id.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((id.length + 3) % 4);
      const raw = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
      try {
        const c = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: raw }], userVerification: "required", timeout: 15_000 } });
        return !!c;
      } catch (e) { return String(e?.name ?? e); }
    }, w.credentialId);
    if (ok !== true) problems.push(`${who}: Face ID (virtual passkey) failed: ${ok}`);
  }
  const s = await sessionOf(p.page);
  let session = "none";
  if (s?.token) {
    const r = await apiJson("/me/wallet", { token: s.token });
    session = r.status === 200 ? "valid" : `api ${r.status} (the app will sign in again with one passkey tap)`;
  }
  return { who, wallet: w, session, problems };
}

async function stageUsable(S) {
  if (!S) return "no saved stage";
  if (S.base !== BASE) return `the saved stage was built for ${S.base}`;
  const pays = (await apiJson(`/venues/${S.venue.address}/payments?limit=20`)).json;
  const n = pays.payments?.length ?? -1;
  if (n !== 2) return n > 2 ? `the stage was already used (${n} payments at ${S.venue.name}: Ben has paid)` : `venue payments = ${n}`;
  for (const k of ["owner", "ana"]) {
    if (!existsSync(join(STATE_DIR, S[k].credsFile ?? "x"))) return `missing saved credentials for ${k}`;
    if (!existsSync(S.profiles?.[k] ?? "/nonexistent")) return `missing saved profile for ${k}`;
  }
  return null;
}

async function benPage(browser, S) {
  const svg = await QR.toString(S.benLink, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  const ctx = await browser.newContext({ viewport: { width: 560, height: 760 } });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>Ben's link</title><style>
    body{margin:0;background:#fff;color:#111;font:16px -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}
    .qr{width:440px;height:440px}.qr svg{width:100%;height:100%}h1{font-size:22px;margin:0 0 12px}
    .url{margin-top:14px;font:600 18px ui-monospace,Menlo,monospace;word-break:break-all;text-align:center;padding:0 20px}
    .hint{margin-top:10px;color:#666;font-size:14px;text-align:center;padding:0 20px}</style></head><body>
    <h1>Ana's link for Ben · ${S.venue.name}</h1><div class="qr">${svg}</div><div class="url">${S.benLink}</div>
    <div class="hint">Scan with the iPhone camera → sign in as Ben → Save Ana's recommendation → Top up (testnet demo).</div></body></html>`);
  return { ctx, page };
}

/**
 * Headed A/B: the "Chrome is being controlled by automated test software" bar is browser chrome, so a page screenshot
 * can't show it (and macOS screencapture needs Screen Recording permission). In a same-size persistent window, any bar
 * costs the page height: compare window.innerHeight on the startup tab with Playwright's default args vs ours.
 */
async function automationBarProbe() {
  const measure = async (label, opts) => {
    const ctx = await chromium.launchPersistentContext(join(STATE_DIR, "probe", label), { channel: "chromium", headless: false, viewport: null, ...opts });
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    await p.setContent("<title>probe</title><body>probe</body>");
    await p.waitForTimeout(2500);
    const h = await p.evaluate(() => window.innerHeight);
    await ctx.close();
    return h;
  };
  const size = ["--window-size=800,700", "--window-position=40,40"];
  const defaultArgs = await measure("default", { args: size });
  const ours = await measure("ours", { ...LAUNCH, args: [...BAR_ARGS, ...size] });
  const noAutomationOnly = await measure("noauto", { ...LAUNCH, args: size });
  return { innerHeight: { playwrightDefault: defaultArgs, ours, withoutTestType: noAutomationOnly }, barHiddenInOurs: ours > defaultArgs && ours >= noAutomationOnly, barHeightPx: ours - defaultArgs };
}

/** Reopen the saved owner + Ana profiles with their re-added virtual passkeys, and check them. */
async function openStage(S, headless) {
    const creds = (k) => JSON.parse(readFileSync(join(STATE_DIR, S[k].credsFile), "utf8"));
    const owner = await openPersona(S.profiles.owner, "desk", { headless, creds: creds("owner"), pos: "0,0" });
    const ana = await openPersona(S.profiles.ana, "phone", { headless, creds: creds("ana"), pos: "1040,30" });
    // W1 tab 2: the counter keypad (the 1440 dashboard has no "Take an order" button once it has payments).
    const counter = await owner.ctx.newPage();
    const ccdp = await owner.ctx.newCDPSession(counter);
    await ccdp.send("WebAuthn.enable", { enableUI: false });
    const { authenticatorId: cid } = await ccdp.send("WebAuthn.addVirtualAuthenticator", { options: AUTH_OPTS });
    for (const c of creds("owner")) await ccdp.send("WebAuthn.addCredential", { authenticatorId: cid, credential: c });
    await counter.goto(`${BASE}/venue/${S.venue.address}/counter`);
    owner.counter = counter;
    await owner.page.goto(S.venue.dashboardUrl);
    await ana.page.goto(`${BASE}/wallet`);
    await Promise.all([settle(owner.page, 1500), settle(ana.page, 1500), settle(counter, 800)]);
    await owner.page.bringToFront();
    const checks = [await checkPersona(owner, "owner", S), await checkPersona(ana, "ana", S)];
    return { owner, ana, checks };
}

/** --verify: headless reopen of the saved stage (no windows, no build, no spend). Exit 0 = ready for --present. */
async function verifySaved() {
  const S = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;
  const why = await stageUsable(S);
  if (why) {
    console.log(`NOT READY: ${why}. (--present would rebuild; nothing was spent here.)`);
    process.exit(1);
  }
  const w = await openStage(S, true);
  const ownerText = await w.owner.page.evaluate(() => document.body.innerText);
  const anaText = await w.ana.page.evaluate(() => document.body.innerText);
  const counterText = await w.owner.counter.evaluate(() => document.body.innerText);
  const ui = { counterKeypad: /Show code/.test(counterText) && !/first name/i.test(counterText), ownerSeesFeed: /Priya/.test(ownerText) && /Ana/.test(ownerText), anaWallet: /\$\d/.test(anaText) && !/first name/i.test(anaText) };
  await w.owner.page.screenshot({ path: join(EVID, "verify-w1-owner-dashboard-1440.png") });
  await w.owner.counter.screenshot({ path: join(EVID, "verify-w1-tab2-counter-1440.png") });
  await w.ana.page.screenshot({ path: join(EVID, "verify-w2-ana-wallet-390.png") });
  const qb = await chromium.launch({ headless: true });
  const w3 = await benPage(qb, S);
  await w3.page.screenshot({ path: join(EVID, "verify-w3-ben-link-qr.png") });
  await qb.close();
  await w.owner.ctx.close();
  await w.ana.ctx.close();
  const sessions = w.checks.map((c) => ({ who: c.who, mode: c.wallet?.mode, session: c.session, problems: c.problems }));
  const ok = sessions.every((x) => !x.problems.length) && Object.values(ui).every(Boolean);
  writeFileSync(join(EVID, "verify-check.json"), JSON.stringify({ at: new Date().toISOString(), headless: true, venue: S.venue.address, benLink: S.benLink, sessions, ui, ok }, null, 2));
  printStage(S);
  console.log(`verify (headless): ${ok ? "READY" : "NOT READY"} ${JSON.stringify({ sessions, ui })}`);
  process.exitCode = ok ? 0 : 1;
}

async function present() {
  let S = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;
  let why = await stageUsable(S);
  if (why) {
    console.log(`!! Saved stage not usable: ${why}. Falling back to --build.`);
    S = await build({ force: true });
    if (S.status !== "complete") process.exit(1);
  }
  const checkSeconds = Number(flagv("check-seconds") ?? 0);
  const openAll = (S) => openStage(S, false);

  let w = await openAll(S);
  let problems = w.checks.flatMap((c) => c.problems);
  if (problems.length) {
    console.log(`!! Saved sessions don't work any more: ${problems.join("; ")}. Falling back to --build.`);
    await w.owner.ctx.close().catch(() => {});
    await w.ana.ctx.close().catch(() => {});
    S = await build({ force: true });
    if (S.status !== "complete") process.exit(1);
    w = await openAll(S);
    problems = w.checks.flatMap((c) => c.problems);
    if (problems.length) {
      console.log(`!! Still failing after a fresh build: ${problems.join("; ")}`);
      process.exitCode = 1;
    }
  }
  // W1 must show the owner's dashboard (with "Take an order"), W2 Ana's wallet (signed in as Ana)
  const ownerText = await w.owner.page.evaluate(() => document.body.innerText);
  const anaText = await w.ana.page.evaluate(() => document.body.innerText);
  const counterText = await w.owner.counter.evaluate(() => document.body.innerText);
  const ui = { counterKeypad: /Show code/.test(counterText) && !/first name/i.test(counterText), ownerSeesFeed: /Priya/.test(ownerText) && /Ana/.test(ownerText), anaWallet: /\$\d/.test(anaText) && !/first name/i.test(anaText) };
  const qrBrowser = await chromium.launch({ ...LAUNCH, headless: false, args: [...BAR_ARGS, "--window-position=520,120"] });
  const w3 = await benPage(qrBrowser, S);
  printStage(S);
  console.log(`Counter      ${BASE}/venue/${S.venue.address}/counter   (W1 tab 2)`);
  console.log("W1 owner window (1440×900): tab 1 dashboard + money graph, tab 2 counter (key 2.00 → Show code). W2 Ana's wallet (390×844). W3 Ben's link QR.");
  console.log(`checks: ${JSON.stringify({ sessions: w.checks.map((c) => ({ who: c.who, mode: c.wallet?.mode, session: c.session, problems: c.problems })), ui })}`);
  const closeAll = async () => {
    await w.owner.ctx.close().catch(() => {});
    await w.ana.ctx.close().catch(() => {});
    await qrBrowser.close().catch(() => {});
  };
  if (checkSeconds > 0) {
    await sleep(checkSeconds * 1000);
    await w.owner.page.screenshot({ path: join(EVID, "present-w1-owner-dashboard-1440.png") });
    await w.owner.counter.screenshot({ path: join(EVID, "present-w1-tab2-counter-1440.png") });
    await w.ana.page.screenshot({ path: join(EVID, "present-w2-ana-wallet-390.png") });
    await w3.page.screenshot({ path: join(EVID, "present-w3-ben-link-qr.png") });
    const bar = await automationBarProbe();
    console.log(`automation bar probe: ${JSON.stringify(bar)}`);
    writeFileSync(join(EVID, "present-check.json"), JSON.stringify({ at: new Date().toISOString(), venue: S.venue.address, benLink: S.benLink, sessions: w.checks.map((c) => ({ who: c.who, mode: c.wallet?.mode, session: c.session, problems: c.problems })), ui, automationBar: bar }, null, 2));
    await closeAll();
    console.log("check done; windows closed");
    return;
  }
  console.log("Windows are open. Press Ctrl+C here to close them.");
  process.on("SIGINT", async () => {
    await closeAll();
    process.exit(0);
  });
  await new Promise(() => {});
}

if (has("build")) await build({ force: has("force") });
else if (has("verify")) await verifySaved();
else if (has("present")) await present(); // HEADED by design: only the human runs it, at recording time
else {
  console.log("usage: node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app (--build [--force] | --verify | --present [--check-seconds N])");
  process.exit(1);
}
