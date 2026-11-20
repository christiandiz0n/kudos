// Headless check that a deployed preview serves the ui-v2 build and a fresh account can sign in (no spend).
//   QE_SCRATCH=<tmp> node e2e/ui-v2/verify-preview.mjs --base https://vouch-ubc-blue.vercel.app --out docs/evidence/ui-v2/preview
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE, EVID, chromium, log, newPhone, onboard, settle } from "../phase3/lib.mjs";

mkdirSync(EVID, { recursive: true });
const browser = await chromium.launch();
const R = { base: BASE, at: new Date().toISOString() };
try {
  const p = await newPhone(browser, "PreviewV2", { reducedMotion: "reduce" });
  await p.page.goto(`${BASE}/`); await settle(p.page, 1500);
  const venueLink = p.page.getByRole("link", { name: /I run a venue/ });
  const box = await venueLink.boundingBox();
  R.venueLink = { visible: await venueLink.isVisible(), height: box?.height ?? null, inHeader: !!box && box.y < 120 };
  R.primaryBg = await p.page.getByRole("button", { name: /Continue with Face ID or fingerprint/ }).evaluate((el) => getComputedStyle(el).backgroundColor);
  await p.page.screenshot({ path: join(EVID, "preview-sign-in-390.png") });
  await onboard(p.page, "Quinn");
  await p.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await p.page.waitForURL(/\/wallet/, { timeout: 30_000 }).catch(() => {});
  await settle(p.page, 2500);
  R.signedIn = true;
  R.url = p.page.url().replace(BASE, "");
  R.wallet = /Your balance/.test(await p.page.innerText("body"));
  R.errors = p.takeErrs();
  await p.page.screenshot({ path: join(EVID, "preview-wallet-390.png") });
  log(JSON.stringify(R));
} catch (e) {
  R.error = String(e?.stack ?? e);
  console.error(e);
  process.exitCode = 1;
} finally {
  writeFileSync(join(EVID, "verify-preview.json"), JSON.stringify(R, null, 2));
  await browser.close();
}
