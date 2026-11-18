// Definitive Stream probe (cursor-independent): register a fresh venue through the app (~$0.0045 relayer gas),
// then watch GET /venues/<v>.onchain (filled only from Streams venue.registered) for up to 90 s.
import { API, BASE, apiJson, chromium, log, newPhone, onboard, settle } from "./lib.mjs";
const b = await chromium.launch();
try {
  const v = await newPhone(b, "probe");
  await v.page.goto(`${BASE}/venue`);
  await settle(v.page);
  await onboard(v.page, "Probe");
  await v.page.waitForURL(/\/venue\/new/, { timeout: 60_000 });
  await v.page.getByLabel(/Name customers will see/i).fill(`QE stream probe ${new Date().toISOString().slice(11, 16)}`);
  const t = Date.now();
  await v.page.getByRole("button", { name: /Confirm with Face ID or fingerprint/ }).click();
  await v.page.waitForURL(/\/venue\/0x[0-9a-fA-F]{40}$/, { timeout: 120_000 });
  const venue = v.page.url().split("/").pop();
  log("registered", venue, `${Date.now() - t} ms to dashboard`);
  for (let i = 0; i < 18; i++) {
    const r = await apiJson(`/venues/${venue}`);
    if (r.json.onchain) { log("STREAM_ACTIVE: onchain after", Date.now() - t, "ms"); process.exitCode = 0; break; }
    if (i === 17) { log("STREAM_NOT_ACTIVE: no venue.registered within", Date.now() - t, "ms of the tap"); process.exitCode = 3; }
    await new Promise((r) => setTimeout(r, 5000));
  }
} finally { await b.close(); }
