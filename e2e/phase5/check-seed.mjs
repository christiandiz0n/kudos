// QE_E2E Phase 5: seeded venues + public ambassador records on the deployed app (read-only; sign-in only, no chain).
//   node e2e/phase5/check-seed.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/phase-5/prod
// For each seeded venue, as a signed-in visitor (not the owner) at 390×844 and 1280×720:
//   - stats on screen vs GET /venues/:v/stats (payments, verified customers, gross, rewards, cost per new customer)
//   - feed on screen vs GET /venues/:v/payments (every customer name + amount)
//   - money graph labels: persona names, no hex, no "Guest N" for named personas; "Everyone" view label legibility
// Then /a/<addr> for Ana, Priya, Ben (signed out) vs GET /ambassadors/:addr.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, BASE, EVID, apiJson, audit, chromium, log, newPhone, onboard, settle, shot } from "../phase3/lib.mjs";

const VENUES = [
  ["lena", "Lena's café", "0x9a40C2b1Da073Fea51A63B92f868A78969c56289"],
  ["kiln", "Kiln Bakery", "0xDbf2Ffc4fdD279c4D32e99b03B6C6abC2D1fA494"],
  ["pressed", "Pressed", "0x82891F492E93192F1b5cd3cEF48f6C0B56D56b4c"],
];
const PEOPLE = [
  ["ana", "Ana", "0x995bb0a8f8dC85b3A1DAEadd0E2f5Ece5bb4d26F"],
  ["priya", "Priya", "0xF0667B5fDC2aDA4082D51fbA8Eaab7BA32e80434"],
  ["ben", "Ben", "0x5d7195ffbF93303E8f1fb213433D658a89d3D794"],
];
const VIEWPORTS = [["390", { width: 390, height: 844 }], ["1280", { width: 1280, height: 720 }]];

// Cent rounding as the web does (half-up on base units), "$12.00".
const cents = (bu) => {
  const v = ((BigInt(bu) + 5000n) / 10000n);
  return `$${(v / 100n).toLocaleString("en-US")}.${String(v % 100n).padStart(2, "0")}`;
};

/** Graph labels + geometry: text content, rendered font px, pairwise overlaps of label boxes. */
async function graphInfo(page) {
  return page.evaluate(() => {
    const svg = document.querySelector("svg[data-mode]");
    if (!svg) return null;
    const r0 = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")].map((t) => {
      const r = t.getBoundingClientRect();
      return { t: (t.textContent || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height, px: parseFloat(getComputedStyle(t).fontSize) * (r0.width / (svg.viewBox?.baseVal?.width || r0.width)) };
    }).filter((x) => x.t);
    const overlaps = [];
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) overlaps.push(`${a.t} ∩ ${b.t} (${Math.round(ox)}×${Math.round(oy)})`);
    }
    return { mode: svg.dataset.mode, orientation: svg.dataset.orientation, box: { w: Math.round(r0.width), h: Math.round(r0.height) }, labels: texts.map((x) => x.t), minPx: Math.min(...texts.map((x) => x.h)), overlaps };
  });
}

const results = { base: BASE, api: API, at: new Date().toISOString(), venues: [], records: [] };
const problems = [];
const browser = await chromium.launch();
try {
  const api = {};
  for (const [, , v] of VENUES) {
    api[v] = { stats: (await apiJson(`/venues/${v}/stats`)).json, feed: (await apiJson(`/venues/${v}/payments`)).json, venue: (await apiJson(`/venues/${v}`)).json };
  }
  for (const [vpName, viewport] of VIEWPORTS) {
    const p = await newPhone(browser, `visitor-${vpName}`, { viewport });
    await p.page.goto(`${BASE}/`);
    await settle(p.page);
    await onboard(p.page, `Vic${vpName}`);
    await p.page.waitForFunction(() => !!localStorage.getItem("vouch.session.v1"), null, { timeout: 60_000 });
    p.takeErrs();
    for (const [key, name, v] of VENUES) {
      const { stats, feed } = api[v];
      await p.page.goto(`${BASE}/venue/${v}`);
      await settle(p.page, 4000);
      await p.page.waitForSelector("svg[data-mode]", { timeout: 15_000 }).catch(() => {});
      await p.page.waitForTimeout(2500); // let the graph animation finish before the shot
      const file = `p-${key}-dashboard-${vpName}`;
      await shot(p.page, file, `${name} dashboard, visitor, Latest view`, "seeded venue");
      await shot(p.page, `${file}-full`, `${name} dashboard, visitor (full page)`, "seeded venue", { fullPage: true });
      const a = await audit(p.page, file);
      const text = await p.page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
      const latest = await graphInfo(p.page);
      // Everyone view
      let network = null;
      const tog = p.page.getByRole("radio", { name: "Everyone" }).or(p.page.getByRole("button", { name: "Everyone" })).or(p.page.getByRole("tab", { name: "Everyone" }));
      if (await tog.count()) {
        await tog.first().click();
        await p.page.waitForTimeout(2500);
        network = await graphInfo(p.page);
        await shot(p.page, `p-${key}-everyone-${vpName}`, `${name} money graph, Everyone view`, "seeded venue");
        if (vpName === "1280") {
          const g = p.page.locator("svg[data-mode]");
          await g.screenshot({ path: join(EVID, "screens", `p-${key}-everyone-graph-1280.png`) }).catch(() => {});
        }
      } else problems.push({ where: file, what: "no Everyone toggle" });

      // Stats checks
      const expect = {
        venueName: name,
        payments: String(stats.payments),
        verified: String(stats.verifiedCustomers),
        gross: cents(stats.gross.baseUnits),
        rewardsPaid: cents(stats.rewardsPaid.baseUnits),
        costPerNew: cents(stats.costPerVerifiedCustomer.baseUnits),
      };
      const statHits = Object.fromEntries(Object.entries(expect).map(([k, s]) => [k, text.includes(s)]));
      // Feed checks: each payment's customer name and amount appear
      const feedRows = feed.payments.map((x) => ({ name: x.customer.displayName, amount: cents(x.amount.baseUnits), nameOnScreen: text.includes(x.customer.displayName ?? "∅"), amountOnScreen: text.includes(cents(x.amount.baseUnits)) }));
      // Graph checks
      const named = new Set();
      for (const e of stats.edges) { if (e.fromDisplayName) named.add(e.fromDisplayName); if (e.toDisplayName) named.add(e.toDisplayName); }
      const graphCheck = (g) => g && {
        hex: g.labels.filter((l) => /0x[0-9a-f]{4,}/i.test(l)),
        guest: g.labels.filter((l) => /\bGuest\b/.test(l)),
        namesShown: [...named].filter((n) => g.labels.some((l) => l.includes(n))),
        namesMissing: [...named].filter((n) => !g.labels.some((l) => l.includes(n))),
      };
      const rec = {
        vp: vpName, venue: name, address: v, url: `/venue/${v}`, expect, statHits, feedRows,
        latest, latestCheck: graphCheck(latest), network, networkCheck: graphCheck(network),
        audit: { primaryCount: a.primaryCount, primaries: a.primaries, banned: a.banned, bannedA11y: a.bannedA11y, moneyBad: a.moneyBad, rawUnits: a.rawUnits, smallTargets: a.smallTargets },
        guestInText: (text.match(/\bGuest \d+/g) ?? []), hexInText: (text.match(/0x[0-9a-fA-F]{4,}/g) ?? []),
        errs: p.takeErrs(),
      };
      results.venues.push(rec);
      for (const [k, ok] of Object.entries(statHits)) if (!ok) problems.push({ where: file, what: `stat ${k} "${expect[k]}" not on screen` });
      for (const r of feedRows) if (!r.nameOnScreen || !r.amountOnScreen) problems.push({ where: file, what: `feed row ${r.name} ${r.amount} not on screen (name ${r.nameOnScreen}, amount ${r.amountOnScreen})` });
      for (const [lab, c] of [["latest", rec.latestCheck], ["everyone", rec.networkCheck]]) {
        if (!c) { problems.push({ where: file, what: `${lab} graph not rendered` }); continue; }
        if (c.hex.length) problems.push({ where: file, what: `${lab} graph hex labels ${c.hex}` });
        if (c.guest.length) problems.push({ where: file, what: `${lab} graph Guest labels ${c.guest}` });
      }
      if (rec.networkCheck?.namesMissing.length) problems.push({ where: file, what: `Everyone graph missing names ${rec.networkCheck.namesMissing}` });
      if (vpName === "1280" && network) {
        if (network.minPx < 11) problems.push({ where: file, what: `Everyone label min height ${network.minPx.toFixed(1)}px at 1280` });
        if (network.overlaps.length) problems.push({ where: file, what: `Everyone labels overlap: ${network.overlaps.slice(0, 6).join("; ")}${network.overlaps.length > 6 ? ` (+${network.overlaps.length - 6})` : ""}` });
      }
      if (rec.guestInText.length || rec.hexInText.length) problems.push({ where: file, what: `page text Guest/hex: ${[...rec.guestInText, ...rec.hexInText].slice(0, 5)}` });
      if (a.banned.length || a.moneyBad.length || a.rawUnits.length) problems.push({ where: file, what: `audit banned=${a.banned.map((b) => b.word)} money=${a.moneyBad} raw=${a.rawUnits}` });
      if (rec.errs.length) problems.push({ where: file, what: `console/page errors: ${rec.errs.map((e) => e.text).slice(0, 3).join(" | ")}` });
      log(file, JSON.stringify(statHits), "feed ok", feedRows.filter((r) => r.nameOnScreen && r.amountOnScreen).length, "/", feedRows.length, "latest", latest?.labels.length, "everyone", network?.labels.length, network?.overlaps.length ?? "-", "overlaps");
    }
    await p.ctx.close();
  }

  // ---------------------------------------------------------------- public ambassador records (signed out)
  for (const [vpName, viewport] of VIEWPORTS) {
    const p = await newPhone(browser, `record-${vpName}`, { viewport });
    for (const [key, name, addr] of PEOPLE) {
      const amb = (await apiJson(`/ambassadors/${addr}`)).json;
      await p.page.goto(`${BASE}/a/${addr}`);
      await settle(p.page, 3500);
      const file = `p-record-${key}-${vpName}`;
      await shot(p.page, file, `${name}'s public record (visitor)`, "seeded persona");
      if (vpName === "390") await shot(p.page, `${file}-full`, `${name}'s public record (full page)`, "seeded persona", { fullPage: true });
      const a = await audit(p.page, file);
      const text = await p.page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
      const rec = { vp: vpName, person: name, address: addr, api: amb, nameOnScreen: text.includes(name), hexInText: text.match(/0x[0-9a-fA-F]{4,}/g) ?? [], guestInText: text.match(/\bGuest \d+/g) ?? [], audit: { primaryCount: a.primaryCount, banned: a.banned, moneyBad: a.moneyBad, rawUnits: a.rawUnits, smallTargets: a.smallTargets }, text: text.slice(0, 1200), errs: p.takeErrs() };
      results.records.push(rec);
      if (!rec.nameOnScreen) problems.push({ where: file, what: `name ${name} not on screen` });
      if (rec.hexInText.length || rec.guestInText.length) problems.push({ where: file, what: `hex/Guest in text ${[...rec.hexInText, ...rec.guestInText].slice(0, 4)}` });
      if (a.banned.length || a.moneyBad.length) problems.push({ where: file, what: `audit banned=${a.banned.map((b) => b.word)} money=${a.moneyBad}` });
      if (rec.errs.length) problems.push({ where: file, what: `errors: ${rec.errs.map((e) => e.text).slice(0, 3).join(" | ")}` });
      log(file, "name", rec.nameOnScreen, "|", text.slice(0, 200));
    }
    await p.ctx.close();
  }
} catch (e) {
  problems.push({ fatal: String(e?.stack ?? e) });
  console.error(e);
} finally {
  results.problems = problems;
  writeFileSync(join(EVID, "seed-results.json"), JSON.stringify(results, null, 2));
  log("problems", problems.length, JSON.stringify(problems, null, 1));
  await browser.close();
}
