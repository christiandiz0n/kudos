import { parseUsdc } from "@vouch/shared";
import type { MoneyFlow, MoneyGraphData } from "@/components/ui";

/**
 * Deterministic seeded venue networks for /design (UI_DESIGN venue, Phase 3). Same arithmetic as the contract
 * (D-503/D-504): per-referrer slice = floor(amount × w × rate / 10⁸), then floor 25/55/20, L2 to the referrer's
 * introducer (returned to the venue when there is none or it is the payer), venue gets the remainder.
 * The LAST payment of every network is the canonical one: Ben pays $12.00, Ana 70% / Priya 30%, Marco and Sofia
 * introduced them, so the highlight always tells the demo story.
 */

export const VENUE_ID = "venue";
export const VENUE_NAME = "Lena's café";
export const CANONICAL_PAYMENT_ID = "pay-ben";
const RATE_BPS = 1500n;

export interface SeedPayment {
  id: string;
  customer: string;
  amount: bigint;
  venueAmount: bigint;
  cashback: bigint;
  /** Recommenders (level 1) and introducers (level 2) paid by this payment. */
  thanked: Array<{ name: string; amount: bigint; level: 1 | 2; via?: string }>;
  firstVisit: boolean;
  minutesAgo: number;
}

export interface SeedVenue {
  data: MoneyGraphData;
  payments: SeedPayment[];
  people: number;
  stats: { verifiedCustomers: number; rewardsPaid: bigint; gross: bigint; salesFromRecommendations: bigint; costPerVerified: bigint | null };
}

const NAMES = [
  "Chloe", "Omar", "Jun", "Maya", "Leo", "Zara", "Noah", "Ines", "Kofi", "Hana", "Ravi", "Elena", "Theo", "Amara", "Luca",
  "Nadia", "Sam", "Yuki", "Felix", "Aisha", "Hugo", "Lina", "Mateo", "Iris", "Dev", "Clara", "Tomas", "Mei", "Arjun",
  "Rosa", "Kai", "Lea", "Diego", "Nora", "Femi", "Ada", "Jonah", "Selin", "Pablo", "Wren", "Idris", "Mila", "Oskar",
  "Tara", "Emil", "Lucia", "Bao", "Freya", "Malik", "June", "Ezra", "Anya", "Rafael", "Esme", "Kian", "Paloma", "Viktor",
  "Saoirse", "Tariq", "Ivy",
];
const AMOUNTS = ["4.50", "6.75", "8.50", "9.25", "12.00", "14.50", "18.00", "22.40"].map(parseUsdc);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function split(amount: bigint, refs: Array<{ name: string; bps: bigint }>, introducerOf: Map<string, string>, customer: string) {
  let cashback = 0n;
  const thanked: SeedPayment["thanked"] = [];
  for (const r of refs) {
    const slice = (amount * r.bps * RATE_BPS) / 100_000_000n;
    cashback += (slice * 2500n) / 10_000n;
    thanked.push({ name: r.name, amount: (slice * 5500n) / 10_000n, level: 1 });
  }
  for (const r of refs) {
    const slice = (amount * r.bps * RATE_BPS) / 100_000_000n;
    const intro = introducerOf.get(r.name);
    if (intro && intro !== customer) thanked.push({ name: intro, amount: (slice * 2000n) / 10_000n, level: 2, via: r.name });
  }
  const venueAmount = amount - cashback - thanked.reduce((a, t) => a + t.amount, 0n);
  return { cashback, thanked, venueAmount };
}

/**
 * A venue network with `people` people (venue not counted). people ≤ 5 returns the single canonical payment.
 */
export function seedVenue(people: number, seed = 11): SeedVenue {
  const rand = rng(seed);
  const introducerOf = new Map<string, string>([
    ["Ana", "Marco"],
    ["Priya", "Sofia"],
  ]);
  const verified: string[] = ["Ana", "Priya"];
  const pays: SeedPayment[] = [];
  const total = Math.max(5, people);

  if (total > 5) {
    // Ana and Priya's own first visits (Marco and Sofia are seed ambassadors).
    for (const [c, r] of [["Ana", "Marco"], ["Priya", "Sofia"]] as const) {
      const amount = parseUsdc("9.25");
      const s = split(amount, [{ name: r, bps: 10_000n }], new Map(), c);
      pays.push({ id: `pay-${c.toLowerCase()}`, customer: c, amount, ...s, firstVisit: true, minutesAgo: 0 });
    }
    const newcomers = NAMES.slice(0, total - 5);
    for (const c of newcomers) {
      // Preferential pick: earlier (busier) people are likelier to recommend.
      const pool = verified;
      const pick = () => pool[Math.floor(Math.pow(rand(), 1.6) * pool.length)];
      const a = pick();
      let b = rand() < 0.4 ? pick() : undefined;
      if (b === a) b = undefined;
      const refs = b ? [{ name: a, bps: 7_000n }, { name: b, bps: 3_000n }] : [{ name: a, bps: 10_000n }];
      const amount = AMOUNTS[Math.floor(rand() * AMOUNTS.length)];
      const s = split(amount, refs, introducerOf, c);
      pays.push({ id: `pay-${c.toLowerCase()}`, customer: c, amount, ...s, firstVisit: true, minutesAgo: 0 });
      introducerOf.set(c, a);
      verified.push(c);
      // Some come back: repeat visits are plain payments, no reward.
      if (rand() < 0.3) {
        const again = AMOUNTS[Math.floor(rand() * 4)];
        pays.push({ id: `pay-${c.toLowerCase()}-2`, customer: c, amount: again, venueAmount: again, cashback: 0n, thanked: [], firstVisit: false, minutesAgo: 0 });
      }
    }
  }

  // The canonical payment, always last: Ben $12.00, Ana 70% / Priya 30%.
  {
    const amount = parseUsdc("12.00");
    const s = split(amount, [{ name: "Ana", bps: 7_000n }, { name: "Priya", bps: 3_000n }], introducerOf, "Ben");
    pays.push({ id: CANONICAL_PAYMENT_ID, customer: "Ben", amount, ...s, firstVisit: true, minutesAgo: 0 });
  }
  // Timestamps: newest = now, then spread back over the "week".
  const n = pays.length;
  pays.forEach((p, i) => (p.minutesAgo = Math.round(((n - 1 - i) / Math.max(1, n - 1)) * (total > 20 ? 7 * 24 * 60 : total > 5 ? 3 * 60 : 0))));

  const flows: MoneyFlow[] = [];
  for (const p of pays) {
    flows.push({ paymentId: p.id, from: p.customer, to: VENUE_ID, level: "venue", amount: p.venueAmount });
    if (p.cashback) flows.push({ paymentId: p.id, from: p.customer, to: p.customer, level: "cashback", amount: p.cashback });
    for (const t of p.thanked) {
      // level 2 flows run from the recommender (viaReferrer) to their introducer
      flows.push({ paymentId: p.id, from: t.level === 1 ? p.customer : (t.via ?? p.customer), to: t.name, level: t.level, amount: t.amount });
    }
  }

  const firstVisits = pays.filter((p) => p.firstVisit);
  const rewardsPaid = pays.reduce((a, p) => a + p.cashback + p.thanked.reduce((b, t) => b + t.amount, 0n), 0n);
  const verifiedCustomers = firstVisits.length;
  const peopleSet = new Set<string>();
  for (const f of flows) {
    if (f.from !== VENUE_ID) peopleSet.add(f.from);
    if (f.to !== VENUE_ID) peopleSet.add(f.to);
  }
  return {
    data: { venue: { id: VENUE_ID, name: VENUE_NAME }, flows },
    payments: pays,
    people: peopleSet.size,
    stats: {
      verifiedCustomers,
      rewardsPaid,
      gross: pays.reduce((a, p) => a + p.amount, 0n),
      salesFromRecommendations: firstVisits.reduce((a, p) => a + p.amount, 0n),
      costPerVerified: verifiedCustomers ? rewardsPaid / BigInt(verifiedCustomers) : null,
    },
  };
}

export const NET_5 = seedVenue(5);
export const NET_20 = seedVenue(20);
export const NET_60 = seedVenue(60);
