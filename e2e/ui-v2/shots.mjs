// UI v2 before/after screenshots of the demo path, light AND dark. HEADLESS ONLY (lib.mjs forces it).
//   QE_SCRATCH=<tmp> node e2e/ui-v2/shots.mjs --base http://localhost:3100 --out docs/evidence/ui-v2/<before|after>
// Phone 390x844 and desktop 1440x900 for every screen; the venue dashboard also at 1280x720 (projector).
// Spend: none. One fresh account per viewport signs in (virtual authenticator); nothing is paid, topped up or registered.
// Stateful screens (confirm, success, order QR) use the /design/screens/<id> mocks; the dashboard reads Lena's seeded data.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, chromium, log, newPhone, onboard, settle } from "../phase3/lib.mjs";

const OUT = EVID;
mkdirSync(OUT, { recursive: true });
const LENA = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const VIEWPORTS = { "390": { width: 390, height: 844 }, "1440": { width: 1440, height: 900 }, "1280": { width: 1280, height: 720 } };

// [file, path, needs sign-in, viewports]
const SCREENS = [
  ["01-sign-in", "/", false, ["390", "1440"]],
  ["02-wallet-new", "/wallet", true, ["390", "1440"]],
  ["03-wallet-activity", "/design/screens/wallet", false, ["390", "1440"]],
  ["04-scan", "/design/screens/scan", false, ["390"]],
  ["05-pay-confirm", "/design/screens/pay-confirm", false, ["390", "1440"]],
  ["06-success-pending", "/design/screens/success-pending", false, ["390"]],
  ["07-success", "/design/screens/success", false, ["390", "1440"]],
  ["08-recommend", "/design/screens/recommend", false, ["390", "1440"]],
  ["09-recommend-link", "/design/screens/recommend-link", false, ["390"]],
  ["10-counter", "/design/screens/order-entry", false, ["390", "1440"]],
  ["11-order-qr", "/design/screens/order-qr", false, ["390", "1440"]],
  ["12-order-paid", "/design/screens/order-qr-paid", false, ["390"]],
  ["13-dashboard-lena", `/venue/${LENA}`, true, ["390", "1280", "1440"]],
  ["14-transparency", "/transparency", false, ["390", "1440"]],
];

const browser = await chromium.launch();
try {
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const list = SCREENS.filter((s) => s[3].includes(vpName));
    if (!list.length) continue;
    const anon = await newPhone(browser, `anon${vpName}`, { viewport: vp, reducedMotion: "reduce" });
    let signed = null;
    if (list.some((s) => s[2])) {
      signed = await newPhone(browser, `Shots${vpName}`, { viewport: vp, reducedMotion: "reduce" });
      await signed.page.goto(`${BASE}/`); await settle(signed.page, 1200);
      await onboard(signed.page, `Quinn`);
      await signed.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
      await signed.page.waitForTimeout(1500);
    }
    for (const [file, path, needs] of list) {
      const p = needs ? signed : anon;
      for (const scheme of ["light", "dark"]) {
        await p.page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await p.page.goto(`${BASE}${path}`); await settle(p.page, path.startsWith("/venue") ? 4500 : 1800);
        const f = `${file}-${vpName}-${scheme}.png`;
        await p.page.screenshot({ path: join(OUT, f) });
        log("shot", f);
      }
    }
    await anon.ctx.close();
    if (signed) await signed.ctx.close();
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
