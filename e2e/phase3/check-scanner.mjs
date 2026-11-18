// In-app scanner with a fake camera that shows a real counter QR (Y4M clip). Proves camera → jsQR → route.
import { join } from "node:path";
import { BASE, SCRATCH, audit, chromium, log, newPhone, onboard, settle, shot } from "./lib.mjs";
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${join(SCRATCH, process.argv[2] ?? "qr.y4m")}`] });
try {
  const p = await newPhone(browser, "scanner");
  await p.page.goto(`${BASE}/`);
  await settle(p.page);
  await onboard(p.page, "Sam");
  await p.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
  await p.page.goto(`${BASE}/scan`);
  const t = Date.now();
  await shot(p.page, "e55-scan-with-qr-in-view", "in-app scanner, fake camera showing a real counter QR");
  await p.page.waitForURL(/\/pay\?v=0x[0-9a-fA-F]{40}&o=0x[0-9a-fA-F]{64}/, { timeout: 20_000 });
  log("scanner routed in", Date.now() - t, "ms to", p.page.url());
  await settle(p.page, 2500);
  await shot(p.page, "e56-scan-routed-to-pay", "scanner decoded the QR and opened the pay sheet");
  const a = await audit(p.page, "e56");
  log("text:", a.text.slice(0, 200));
} finally {
  await browser.close();
}
