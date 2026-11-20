// Kudos rename check (headless, no spend): visible text on the demo-path screens must say "Kudos" and never "Vouch".
//   node e2e/kudos/name-check.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/kudos
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE, EVID, chromium, log, newPhone, onboard, settle } from "../phase3/lib.mjs";
const LENA = "0x9a40C2b1Da073Fea51A63B92f868A78969c56289";
const CORNER = "0x18235a7735DE0D4dC077E52fE8dBf0fFedc15581";
const b = await chromium.launch();
const rows = [];
const check = async (page, label) => {
  await settle(page);
  const title = await page.title();
  const text = await page.evaluate(() => document.body.innerText);
  const vouch = [...(title + "\n" + text).matchAll(/[^\n]{0,40}\bVouch\b[^\n]{0,40}/g)].map((m) => m[0]).filter((s) => !/vouch-ubc\.vercel\.app/.test(s));
  const kudos = /\bKudos\b/.test(title + text);
  rows.push({ label, url: page.url(), title, kudos, vouch });
  await page.screenshot({ path: join(EVID, `${label}.png`) });
  log(label, JSON.stringify({ title, kudos, vouch }));
};
try {
  const out = await newPhone(b, "signedout");
  for (const [l, p] of [["signin", "/"], ["transparency", "/transparency"], ["notfound", "/nope-404"]]) { await out.page.goto(BASE + p); await check(out.page, l); }
  const m = await out.page.goto(BASE + "/manifest.webmanifest"); rows.push({ label: "manifest", body: (await m.text()).slice(0, 200) });
  const c = await newPhone(b, "kudos");
  await c.page.goto(BASE + "/"); await settle(c.page); await onboard(c.page, "Kudos check");
  for (const [l, p] of [["wallet", "/wallet"], ["scan", "/scan"], ["me", "/me"], ["venue-new", "/venue"], [`projector-lena-cafe`, `/venue/${LENA}`], ["projector-lenas-corner", `/venue/${CORNER}`]]) { await c.page.goto(BASE + p); await check(c.page, l); }
} finally { await b.close(); }
writeFileSync(join(EVID, "name-check.json"), JSON.stringify(rows, null, 2));
const bad = rows.filter((r) => r.vouch?.length);
console.log(bad.length ? `FAIL: stray Vouch on ${bad.map((r) => r.label).join(", ")}` : `PASS: no visible "Vouch" on ${rows.length - 1} screens`);
