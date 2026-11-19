// QE_E2E Phase 3 gate, part 3: the live canonical story on :3100 + hosted api + live Stream.
// Venue (Lena) onboards via the slider → $1.00 order → QR. Ana (fresh) tops up in-app ($3, once) → pays → settled.
// Ana recommends → Ben opens the link, saves it, tops up in-app → pays a new $1.00 order picking "Ana" → Ana is rewarded.
// A projector context (1280×720, separate account) watches the venue dashboard live. Stops after Ana if her payment
// isn't settled within 60 s (Stream not active) so Ben's top-up isn't spent.
// Spend: 1 venue registration + 2 relayed pays (relayer gas) + 2 demo top-ups ($3 each, from the global cap).
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { API, BASE, EVID, ROOT, apiJson, audit, chromium, log, newPhone, onboard, sessionOf, settle, shot } from "./lib.mjs";

const AMOUNT_KEYS = ["1", "Decimal point", "0", "0"]; // $1.00
const RES = { startedAt: new Date().toISOString(), base: BASE, api: API, amount: "1.00", audits: [], timeline: [] };
const mark = (ev, extra = {}) => {
  const e = { ev, t: new Date().toISOString(), ...extra };
  RES.timeline.push(e);
  log(ev, JSON.stringify(extra));
};
const A = async (phone, file, state, notes = "") => {
  await shot(phone.page, file, state, notes);
  const a = await audit(phone.page, file);
  RES.audits.push({ ctx: phone.label, ...a, errs: phone.takeErrs() });
  if (a.banned.length || a.moneyBad.length || a.rawUnits.length) log("AUDIT", file, JSON.stringify({ b: a.banned, m: a.moneyBad, r: a.rawUnits }));
};
const timings = (page) => page.evaluate(() => window.__vouchTimings ?? []);
async function keyIn(page, keys) {
  for (const k of keys) await page.getByRole("button", { name: k.length === 1 ? new RegExp(`^${k}$`) : k }).click();
}
async function newOrder(venue, vaddr) {
  await venue.page.goto(`${BASE}/venue/${vaddr}/counter`);
  await settle(venue.page, 800);
  await keyIn(venue.page, AMOUNT_KEYS);
  await venue.page.getByRole("button", { name: /Show code/ }).click();
  return venue.page.locator("[data-qr-payload]").getAttribute("data-qr-payload", { timeout: 30_000 });
}
async function waitSettled(page, ms) {
  const h = await page.waitForFunction(() => {
    const t = window.__vouchTimings ?? [];
    return t.some((x) => x.step === "settled") ? t : null;
  }, null, { timeout: ms });
  return h.jsonValue();
}

// Fallback if the in-app demo top-up refuses (funder floor / cap): DEPLOYER CLI top-up (loads its own keys; never read here).
function cliTopup(addr) {
  const out = execFileSync("pnpm", ["--silent", "--filter", "@vouch/scripts", "topup", "--to", addr, "--target", "1.10", "--max-total", "2.50"], { cwd: ROOT, encoding: "utf8" });
  return /0x[0-9a-fA-F]{64}/.exec(out)?.[0] ?? out.slice(-300);
}
// Free Stream preflight (Phase 5): with --probe-venue <addr> (or QE_PROBE_VENUE), refuse to spend unless that
// already-mined venue has been ingested by Streams (GET /venues/<v>.onchain != null). Nothing is sent if it hasn't.
{
  const i = process.argv.indexOf("--probe-venue");
  const pv = (i > 0 ? process.argv[i + 1] : undefined) ?? process.env.QE_PROBE_VENUE;
  if (pv) {
    const r = await apiJson(`/venues/${pv}`);
    if (!r.json?.onchain) {
      log("PREFLIGHT: Stream has not ingested", pv, "→ STREAM_NOT_ACTIVE; nothing spent");
      process.exit(3);
    }
    log("PREFLIGHT: Stream ingested", pv, "→ OK to run");
  }
}
log("story base", BASE, "api", API, "out", EVID);
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  // ------------------------------------------------------------------ venue onboarding (slider → 20%)
  const venue = await newPhone(browser, "venue");
  await venue.page.goto(`${BASE}/venue`);
  await settle(venue.page);
  await onboard(venue.page, "Lena");
  await venue.page.waitForURL(/\/venue\/new/, { timeout: 60_000 });
  await settle(venue.page, 500);
  const vname = `QE Lena's café ${new Date().toISOString().slice(11, 16)}`;
  await venue.page.getByLabel(/Name customers will see/i).fill(vname);
  const slider = venue.page.getByRole("slider");
  await slider.focus();
  for (let i = 0; i < 5; i++) await slider.press("ArrowRight");
  RES.sliderValue = await slider.inputValue();
  await venue.page.getByLabel(/Minimum first order/i).fill("0.50");
  await A(venue, "l01-venue-onboarding-20pct", "venue onboarding, reward set to 20% with the slider, min $0.50", `slider=${RES.sliderValue}`);
  await venue.page.screenshot({ path: join(EVID, "screens", "l01b-venue-onboarding-full.png"), fullPage: true });
  const tReg = Date.now();
  await venue.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await venue.page.waitForTimeout(400);
  await A(venue, "l02-venue-onboarding-saving", "venue onboarding: saving");
  await venue.page.waitForURL(/\/venue\/0x[0-9a-fA-F]{40}$/, { timeout: 120_000 });
  const vaddr = venue.page.url().split("/").pop();
  RES.venue = vaddr;
  RES.venueName = vname;
  RES.venueRegisteredMs = Date.now() - tReg;
  RES.venueOwner = (await sessionOf(venue.page)).address;
  const vInfo = await apiJson(`/venues/${vaddr}`);
  RES.venueTerms = vInfo.json.terms;
  RES.venueOnchainAtDashboard = vInfo.json.onchain != null;
  mark("venue registered", { vaddr, ms: RES.venueRegisteredMs, onchain: RES.venueOnchainAtDashboard, rewardBps: vInfo.json.terms?.rewardBps });
  // Phase 5 self-probe: the venue registration doubles as the Stream probe. If Streams hasn't ingested it within
  // QE_STREAM_WAIT_S (default 90 s), stop BEFORE any top-up or payment (spend so far: this one registration).
  if (!RES.venueOnchainAtDashboard) {
    const waitS = Number(process.env.QE_STREAM_WAIT_S ?? 90);
    const tw = Date.now();
    let seen = false;
    while (Date.now() - tw < waitS * 1000) {
      if ((await apiJson(`/venues/${vaddr}`)).json?.onchain) { seen = true; break; }
      await new Promise((r) => setTimeout(r, 3000));
    }
    RES.streamProbeMs = seen ? Date.now() - tReg : null;
    mark(seen ? "STREAM_ACTIVE (venue ingested)" : "STREAM_NOT_ACTIVE (venue not ingested) → stopping before any top-up", { ms: Date.now() - tReg });
    if (!seen) throw new Error("STREAM_NOT_ACTIVE");
  }
  await settle(venue.page, 1500);
  await A(venue, "l03-venue-dashboard-empty", "new venue dashboard (live, empty)");

  // projector: a separate signed-in account watching the dashboard live (non-owner, public feed)
  const proj = await newPhone(browser, "projector", { viewport: { width: 1280, height: 720 } });
  await proj.page.goto(`${BASE}/`);
  await settle(proj.page);
  await onboard(proj.page, "Projector");
  await proj.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await proj.page.goto(`${BASE}/venue/${vaddr}`);
  await settle(proj.page, 2000);
  await shot(proj.page, "l04-projector-dashboard-empty-1280", "venue dashboard at 1280×720 before any payment (non-owner projector)");

  // ------------------------------------------------------------------ order 1 → Ana
  const qr1 = await newOrder(venue, vaddr);
  RES.qr1 = qr1;
  await venue.page.waitForTimeout(600);
  await A(venue, "l05-counter-qr-100", "counter QR for $1.00");
  const ana = await newPhone(browser, "ana");
  await ana.page.goto(qr1);
  await settle(ana.page);
  await A(ana, "l06-ana-pay-signed-out", "Ana opens the QR link (signed out)");
  await onboard(ana.page, "Ana");
  await ana.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  RES.ana = (await sessionOf(ana.page)).address;
  await ana.page.getByText(/Not enough money yet/).waitFor({ timeout: 60_000 });
  await A(ana, "l07-ana-pay-insufficient", "Ana: not enough money yet (real $0) → top-up offered");
  const tTop = Date.now();
  const topRes = ana.page.waitForResponse((r) => r.url().endsWith("/demo/topup") && r.request().method() === "POST", { timeout: 30_000 });
  await ana.page.getByRole("button", { name: /Top up \(testnet demo\)/ }).click();
  const topR = await topRes;
  const topJ = await topR.json();
  RES.anaTopup = { status: topR.status(), ...topJ };
  if (topR.status() !== 202) {
    RES.anaTopup.cliFallbackTx = cliTopup(RES.ana);
    mark("ana in-app top-up refused → CLI top-up", RES.anaTopup);
    await ana.page.reload();
  }
  const payBtn = ana.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ });
  await ana.page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Confirm with Face ID or fingerprint/.test(x.getAttribute("aria-label") || x.innerText));
    return b && !b.disabled;
  }, null, { timeout: 90_000 });
  RES.anaTopupMs = Date.now() - tTop;
  mark("ana topped up", { tx: topJ.txHash, ms: RES.anaTopupMs });
  await settle(ana.page, 800);
  await A(ana, "l08-ana-pay-confirm", "Ana: pay sheet after the in-app top-up (first visit, no recommendation)");

  // venue counter + projector watchers start before the tap
  const venuePaid1 = venue.page.getByText(/^Paid$|Payment received/).first().waitFor({ timeout: 180_000 }).then(() => Date.now()).catch(() => null);
  const projSaw1 = proj.page.waitForFunction(() => /Ana paid/.test(document.body.innerText), null, { timeout: 180_000 }).then(() => Date.now()).catch(() => null);
  const tTap1 = Date.now();
  await payBtn.click();
  await ana.page.waitForFunction(() => (window.__vouchTimings ?? []).some((x) => x.step === "pending"), null, { timeout: 60_000 });
  const tPending1 = Date.now();
  await A(ana, "l09-ana-pending", "Ana: pending ('Arriving'), relayed, waiting for Streams");
  let t1;
  try {
    t1 = await waitSettled(ana.page, 60_000);
  } catch {
    RES.streamActive = false;
    RES.ana1Timings = await timings(ana.page);
    mark("STREAM NOT ACTIVE: Ana's payment not settled within 60 s of the tap", { timings: RES.ana1Timings });
    await A(ana, "l09b-ana-still-pending-60s", "Ana: still pending 60 s after the tap (Stream not active)");
    throw new Error("STREAM_NOT_ACTIVE");
  }
  RES.streamActive = true;
  const tSettled1 = Date.now();
  RES.ana1 = { timings: t1, tapToPendingMs: tPending1 - tTap1, tapToSettledMs: tSettled1 - tTap1 };
  mark("ana settled", RES.ana1);
  await ana.page.waitForTimeout(1200);
  await A(ana, "l10-ana-settled", "Ana: paid (settled via Streams)");
  const vp1 = await venuePaid1;
  RES.ana1.venueSeesPaidMs = vp1 ? vp1 - tTap1 : null;
  await A(venue, "l11-counter-paid-ana", "counter flips to Paid (Ana)");
  const pj1 = await projSaw1;
  RES.ana1.projectorFeedMs = pj1 ? pj1 - tTap1 : null;
  mark("venue/projector saw Ana", { venueSeesPaidMs: RES.ana1.venueSeesPaidMs, projectorFeedMs: RES.ana1.projectorFeedMs });
  await proj.page.waitForTimeout(3500);
  await shot(proj.page, "l12-projector-after-ana-1280", "projector dashboard updated live after Ana's payment (no reload)");

  // ------------------------------------------------------------------ Ana recommends
  await ana.page.goto(`${BASE}/wallet`);
  await settle(ana.page, 2500);
  await A(ana, "l13-ana-wallet-after", "Ana's wallet after paying");
  await ana.page.goto(`${BASE}/recommend?venue=${vaddr}`);
  await settle(ana.page, 2000);
  await A(ana, "l14-ana-recommend", "Ana: recommend (unlocked after a purchase)");
  const introRes = ana.page.waitForResponse((r) => r.url().endsWith("/intros") && r.request().method() === "POST", { timeout: 60_000 });
  await ana.page.getByRole("button", { name: /Make my link/ }).click();
  const intro = await (await introRes).json();
  RES.introCode = intro.code;
  const link = `${BASE}/i/${intro.code}`;
  RES.introLink = link;
  mark("ana link", { link });
  await ana.page.waitForTimeout(1000);
  await A(ana, "l15-ana-recommend-link", "Ana: personal link ready to share");

  // ------------------------------------------------------------------ Ben opens the link, saves it, tops up
  const ben = await newPhone(browser, "ben");
  await ben.page.goto(link);
  await settle(ben.page, 2000);
  await A(ben, "l16-ben-link-signed-out", "Ben opens Ana's link (signed out)");
  await onboard(ben.page, "Ben");
  const saveBtn = ben.page.getByRole("button", { name: /Save .* recommendation/ });
  await saveBtn.waitFor({ timeout: 60_000 });
  await settle(ben.page, 800);
  await A(ben, "l17-ben-link-signed-in", "Ben: Ana thinks you'll love it, save offered");
  const tAcc = Date.now();
  await saveBtn.click();
  await ben.page.getByRole("button", { name: /^Done$/ }).waitFor({ timeout: 120_000 });
  RES.benAcceptMs = Date.now() - tAcc;
  RES.ben = (await sessionOf(ben.page)).address;
  mark("ben saved Ana's recommendation", { ms: RES.benAcceptMs });
  await A(ben, "l18-ben-link-saved", "Ben: recommendation saved");
  await ben.page.goto(`${BASE}/wallet`);
  await settle(ben.page, 2000);
  const tTopB = Date.now();
  const topResB = ben.page.waitForResponse((r) => r.url().endsWith("/demo/topup") && r.request().method() === "POST", { timeout: 30_000 });
  await ben.page.getByRole("button", { name: /Top up \(testnet demo\)/ }).click();
  const topRB = await topResB;
  RES.benTopup = { status: topRB.status(), ...(await topRB.json()) };
  if (topRB.status() !== 202) {
    RES.benTopup.cliFallbackTx = cliTopup(RES.ben);
    mark("ben in-app top-up refused → CLI top-up", RES.benTopup);
    await ben.page.reload();
  }
  await ben.page.waitForFunction(() => /\$\s*(3|1)\s*\.?\s*(00|10)/.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => {});
  RES.benTopupMs = Date.now() - tTopB;
  mark("ben topped up (wallet)", { tx: RES.benTopup.txHash, ms: RES.benTopupMs });
  await ben.page.waitForTimeout(1500);
  await A(ben, "l19-ben-wallet-topped-up", "Ben's wallet after the in-app demo top-up");

  // Ana watches her wallet for the reward
  await ana.page.goto(`${BASE}/wallet`);
  await settle(ana.page, 2000);
  const anaToast = ana.page.getByText(/just arrived/).first().waitFor({ timeout: 180_000 }).then(() => Date.now()).catch(() => null);

  // ------------------------------------------------------------------ order 2 → Ben (picks Ana)
  const qr2 = await newOrder(venue, vaddr);
  RES.qr2 = qr2;
  await ben.page.goto(qr2);
  const payB = ben.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ });
  await ben.page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Confirm with Face ID or fingerprint/.test(x.getAttribute("aria-label") || x.innerText));
    return b && !b.disabled;
  }, null, { timeout: 60_000 });
  await settle(ben.page, 1000);
  await A(ben, "l20-ben-pay-confirm", "Ben: pay sheet with money back + 'Who sent you here?'");
  const chip = ben.page.getByRole("radio", { name: /Ana/ });
  RES.whoSentYouChips = await ben.page.getByRole("radio").allInnerTexts().catch(() => []);
  if (await chip.count()) {
    await chip.first().click();
    await ben.page.waitForTimeout(2500);
    RES.pickedAna = true;
  }
  await A(ben, "l21-ben-picked-ana", "Ben: picked Ana in 'Who sent you here?'");
  const venuePaid2 = venue.page.getByText(/^Paid$|Payment received/).first().waitFor({ timeout: 180_000 }).then(() => Date.now()).catch(() => null);
  const projSaw2 = proj.page.waitForFunction(() => /Ben paid/.test(document.body.innerText), null, { timeout: 180_000 }).then(() => Date.now()).catch(() => null);
  await ben.page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Confirm with Face ID or fingerprint/.test(x.getAttribute("aria-label") || x.innerText));
    return b && !b.disabled;
  }, null, { timeout: 30_000 });
  const tTap2 = Date.now();
  await payB.click();
  await ben.page.waitForFunction(() => (window.__vouchTimings ?? []).some((x) => x.step === "pending"), null, { timeout: 60_000 });
  const tPending2 = Date.now();
  await A(ben, "l22-ben-pending", "Ben: pending (Arriving)");
  const t2 = await waitSettled(ben.page, 120_000);
  const tSettled2 = Date.now();
  RES.ben1 = { timings: t2, tapToPendingMs: tPending2 - tTap2, tapToSettledMs: tSettled2 - tTap2 };
  mark("ben settled", RES.ben1);
  await ben.page.waitForTimeout(2500);
  await A(ben, "l23-ben-settled", "Ben: paid, split receipt (Ana thanked)");
  await ben.page.screenshot({ path: join(EVID, "screens", "l23b-ben-settled-full.png"), fullPage: true });
  const vp2 = await venuePaid2;
  RES.ben1.venueSeesPaidMs = vp2 ? vp2 - tTap2 : null;
  await A(venue, "l24-counter-paid-ben", "counter flips to Paid (Ben)");
  const pj2 = await projSaw2;
  RES.ben1.projectorFeedMs = pj2 ? pj2 - tTap2 : null;
  const at = await anaToast;
  RES.ben1.anaRewardToastMs = at ? at - tTap2 : null;
  mark("venue/projector/Ana saw Ben", { venueSeesPaidMs: RES.ben1.venueSeesPaidMs, projectorFeedMs: RES.ben1.projectorFeedMs, anaToastMs: RES.ben1.anaRewardToastMs });
  await A(ana, "l25-ana-wallet-reward-toast", "Ana's wallet: reward arrived live (toast)");
  await proj.page.waitForTimeout(4000);
  await shot(proj.page, "l26-projector-money-graph-1280", "projector dashboard + money graph after Ben's payment (live, 1280×720)");
  const projAudit = await audit(proj.page, "l26-projector");
  RES.audits.push({ ctx: "projector", ...projAudit, errs: proj.takeErrs() });
  RES.projectorText = projAudit.text;

  // ------------------------------------------------------------------ after: owner dashboard, records
  await venue.page.goto(`${BASE}/venue/${vaddr}`);
  await settle(venue.page, 4000);
  await A(venue, "l27-venue-dashboard-after", "owner dashboard after both payments (390)");
  await venue.page.screenshot({ path: join(EVID, "screens", "l27b-venue-dashboard-after-full.png"), fullPage: true });
  RES.ownerDashText = (await audit(venue.page, "x")).text;
  await venue.page.setViewportSize({ width: 1280, height: 720 });
  await venue.page.waitForTimeout(2500);
  await shot(venue.page, "l28-venue-dashboard-owner-1280", "owner dashboard at 1280×720 (projector layout)");
  await venue.page.getByRole("tab", { name: /Everyone/ }).or(venue.page.getByRole("button", { name: /Everyone/ })).first().click().catch(() => {});
  await venue.page.waitForTimeout(2000);
  await shot(venue.page, "l29-money-graph-everyone-1280", "money graph 'Everyone' at 1280×720");
  await venue.page.setViewportSize({ width: 390, height: 844 });
  await ana.page.goto(`${BASE}/me`);
  await settle(ana.page, 2500);
  await A(ana, "l30-ana-record", "Ana's ambassador record");
  await ana.page.goto(`${BASE}/wallet`);
  await settle(ana.page, 2500);
  await A(ana, "l31-ana-wallet-final", "Ana's wallet with the reward in activity");
  await ben.page.goto(`${BASE}/wallet`);
  await settle(ben.page, 2500);
  await A(ben, "l32-ben-wallet-final", "Ben's wallet after paying");
  await ben.page.goto(`${BASE}/transparency?venue=${vaddr}`);
  await settle(ben.page, 2000);
  await shot(ben.page, "l33-transparency-venue", "transparency page for the story venue");
  // Reduced motion on a live settled receipt: reload Ben's receipt? (success is transient) → dashboard graph instead
  const rm = await newPhone(browser, "reduced", { reducedMotion: "reduce" });
  await rm.page.goto(`${BASE}/`);
  await settle(rm.page);
  await onboard(rm.page, "Remy");
  await rm.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await rm.page.goto(`${BASE}/venue/${vaddr}`);
  await settle(rm.page, 3000);
  RES.reducedMotionAnimations = await rm.page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  await A(rm, "l34-dashboard-live-reduced-motion", "live dashboard + money graph with prefers-reduced-motion");

  // ------------------------------------------------------------------ API cross-check of the two intents
  for (const [k, t] of [["ana1", RES.ana1.timings], ["ben1", RES.ben1.timings]]) {
    const intentId = t.find((x) => x.step === "pending")?.intentId;
    const r = await apiJson(`/payments/${intentId}`);
    RES[k].intent = r.json;
  }
  RES.ok = true;
} catch (e) {
  RES.ok = false;
  RES.error = String(e?.message ?? e);
  console.error(e);
} finally {
  RES.endedAt = new Date().toISOString();
  const f = join(EVID, `story-${RES.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(f, JSON.stringify(RES, null, 2));
  log("wrote", f);
  await browser.close();
}
