// QE ui-v2: segmented control ("Latest"/"Everyone") selected-state colours, light + dark, preview vs --base. Headless, no spend.
import { BASE, chromium, newPhone, settle } from "../phase3/lib.mjs";
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const p = await newPhone(b, "seg"); await p.page.emulateMedia({ colorScheme: scheme });
  await p.page.goto(`${BASE}/design/screens/venue-dashboard`); await settle(p.page, 2500);
  const r = await p.page.evaluate(() => [...document.querySelectorAll("[role=tab],[role=radio]")].filter((e) => /Latest|Everyone/.test(e.textContent)).map((e) => { const s = getComputedStyle(e); return { t: e.textContent.trim(), sel: e.getAttribute("aria-selected") ?? e.getAttribute("aria-checked"), bg: s.backgroundColor, color: s.color, border: s.borderColor, bw: s.borderWidth, shadow: s.boxShadow.slice(0, 90), track: getComputedStyle(e.parentElement).backgroundColor }; }));
  console.log(BASE, scheme, JSON.stringify(r));
  await p.ctx.close();
}
await b.close();
