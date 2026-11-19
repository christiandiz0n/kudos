/**
 * Demo seed plan (pure data + pure logic, no I/O). `demo-seed.ts` executes it against the hosted api.
 *
 * Three venues, ten neighbourhood personas plus the three owners. The canonical story (AGENTS/README.md, D-606 names):
 *   Lena's café 15%: Marco and Sofia are seed ambassadors. Ana joins via Marco, Priya via Sofia.
 *   Ben opens Ana's personal link 3× and Priya's group-chat (broadcast) link 2× → baseline 7000/3000 →
 *   Ben pays $12.00 → venue 10.20 · Ben 0.45 · Ana 0.693 · Priya 0.297 · Marco 0.252 (via Ana) · Sofia 0.108 (via Priya).
 * Around it: public links reused by several customers, customers with two referrers, L2 chains across payments,
 * one repeat purchase (no reward), one below-minimum first purchase (verified, no reward), owners shopping at
 * each other's venues. Every rule below mirrors the contract (D-505, D-508, D-509) so `validatePlan` catches a
 * plan the chain would refuse before anything is sent.
 */

export const USDC = 1_000_000n;
/** "$2.40" → 2_400_000n (exact, no floats). */
export function usd(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`bad dollar amount ${s}`);
  return BigInt(m[1]!) * USDC + BigInt((m[2] ?? '').padEnd(6, '0'));
}
export function fmt(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % USDC).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / USDC}.${frac.length < 2 ? frac.padEnd(2, '0') : frac}`;
}

export type PersonaKey =
  | 'lena' | 'tomas' | 'maya' // venue owners (payout = owner)
  | 'marco' | 'sofia' | 'ana' | 'priya' | 'ben' | 'chloe' | 'diego' | 'hana' | 'omar' | 'yuki';
export type VenueKey = 'cafe' | 'kiln' | 'pressed';
export type LinkType = 'personal' | 'broadcast';

export interface Persona {
  key: PersonaKey;
  displayName: string;
  blurb: string;
}
export interface VenuePlan {
  key: VenueKey;
  name: string;
  description: string;
  owner: PersonaKey;
  rewardBps: number;
  minOrder: bigint;
}

export type Step =
  | { kind: 'register'; id: string; venue: VenueKey }
  | { kind: 'seed'; id: string; venue: VenueKey; who: PersonaKey }
  | { kind: 'accept'; id: string; venue: VenueKey; customer: PersonaKey; referrer: PersonaKey; linkType: LinkType; link: string; opens: number }
  | {
      kind: 'pay';
      id: string;
      venue: VenueKey;
      customer: PersonaKey;
      amount: bigint;
      label: string;
      /** what the chain must do with it (validated by `validatePlan`, re-checked against the quote) */
      expect: 'rewarded' | 'repeat' | 'below_min';
      canonical?: boolean;
    };

export const PERSONAS: Persona[] = [
  { key: 'lena', displayName: 'Lena', blurb: "owns Lena's café" },
  { key: 'tomas', displayName: 'Tomás', blurb: 'owns Kiln Bakery' },
  { key: 'maya', displayName: 'Maya', blurb: 'owns Pressed' },
  { key: 'marco', displayName: 'Marco', blurb: "café regular, seed ambassador at Lena's" },
  { key: 'sofia', displayName: 'Sofia', blurb: "runs the book club, seed ambassador at Lena's" },
  { key: 'ana', displayName: 'Ana', blurb: 'brought Ben in (canonical)' },
  { key: 'priya', displayName: 'Priya', blurb: "Ben's coworker, group-chat link (canonical)" },
  { key: 'ben', displayName: 'Ben', blurb: 'pays $12.00 (canonical)' },
  { key: 'chloe', displayName: 'Chloe', blurb: "Ben's flatmate" },
  { key: 'diego', displayName: 'Diego', blurb: 'runs the Saturday run club, seed ambassador at Pressed' },
  { key: 'hana', displayName: 'Hana', blurb: 'neighbourhood board, seed ambassador at Kiln' },
  { key: 'omar', displayName: 'Omar', blurb: 'Kiln regular' },
  { key: 'yuki', displayName: 'Yuki', blurb: "Omar's neighbour" },
];

export const VENUES: VenuePlan[] = [
  { key: 'cafe', name: "Lena's café", description: 'Neighbourhood coffee, pastries and a long table by the window.', owner: 'lena', rewardBps: 1500, minOrder: usd('1.00') },
  { key: 'kiln', name: 'Kiln Bakery', description: 'Wood-fired sourdough and morning buns, out of the oven at 7.', owner: 'tomas', rewardBps: 1200, minOrder: usd('3.00') },
  { key: 'pressed', name: 'Pressed', description: 'Cold-pressed juice, smoothies and acai bowls.', owner: 'maya', rewardBps: 2000, minOrder: usd('1.00') },
];

/** Personal link id = one per (venue, referrer, customer); broadcast = one per (venue, referrer), shared. */
const personal = (v: VenueKey, r: PersonaKey, c: PersonaKey) => `${v}:${r}>${c}:personal`;
const broadcast = (v: VenueKey, r: PersonaKey) => `${v}:${r}:broadcast`;
function acc(v: VenueKey, c: PersonaKey, r: PersonaKey, linkType: LinkType, opens: number): Step {
  const link = linkType === 'personal' ? personal(v, r, c) : broadcast(v, r);
  return { kind: 'accept', id: `accept:${v}:${r}>${c}`, venue: v, customer: c, referrer: r, linkType, link, opens };
}
function pay(v: VenueKey, c: PersonaKey, amount: string, label: string, expect: 'rewarded' | 'repeat' | 'below_min', n = 1, canonical = false): Step {
  return { kind: 'pay', id: `pay:${v}:${c}:${n}`, venue: v, customer: c, amount: usd(amount), label, expect, ...(canonical ? { canonical } : {}) };
}

/**
 * Execution order matters twice: the chain rules (referrers must be verified or seeds before they share) and cash
 * flow (owners' revenue funds later customers, so the DEPLOYER only covers the peak; D-812).
 */
export const STEPS: Step[] = [
  // ---------------- Lena's café (15%, min $1.00): the canonical story first
  { kind: 'register', id: 'register:cafe', venue: 'cafe' },
  { kind: 'seed', id: 'seed:cafe:marco', venue: 'cafe', who: 'marco' },
  { kind: 'seed', id: 'seed:cafe:sofia', venue: 'cafe', who: 'sofia' },
  acc('cafe', 'ana', 'marco', 'personal', 1),
  pay('cafe', 'ana', '2.80', 'Flat white + almond croissant', 'rewarded'),
  acc('cafe', 'priya', 'sofia', 'personal', 1),
  pay('cafe', 'priya', '2.40', 'Chai latte', 'rewarded'),
  acc('cafe', 'ben', 'ana', 'personal', 3),
  acc('cafe', 'ben', 'priya', 'broadcast', 2),
  pay('cafe', 'ben', '12.00', 'Lunch: soup, sandwich, cortado', 'rewarded', 1, true),
  pay('cafe', 'ben', '2.20', 'Espresso to go', 'repeat', 2),
  acc('cafe', 'chloe', 'ben', 'personal', 2),
  pay('cafe', 'chloe', '3.10', 'Oat cappuccino', 'rewarded'),
  acc('cafe', 'diego', 'priya', 'broadcast', 1),
  acc('cafe', 'diego', 'ana', 'personal', 0),
  pay('cafe', 'diego', '3.60', 'Iced latte + banana bread', 'rewarded'),

  // ---------------- Kiln Bakery (12%, min $3.00)
  { kind: 'register', id: 'register:kiln', venue: 'kiln' },
  { kind: 'seed', id: 'seed:kiln:hana', venue: 'kiln', who: 'hana' },
  acc('kiln', 'omar', 'hana', 'broadcast', 1),
  pay('kiln', 'omar', '4.80', 'Sourdough loaf + morning bun', 'rewarded'),
  acc('kiln', 'yuki', 'hana', 'broadcast', 0),
  acc('kiln', 'yuki', 'omar', 'personal', 2),
  pay('kiln', 'yuki', '3.60', 'Seeded rye', 'rewarded'),
  acc('kiln', 'priya', 'omar', 'personal', 1),
  pay('kiln', 'priya', '2.40', 'Cinnamon bun (under the $3 minimum)', 'below_min'),
  acc('kiln', 'lena', 'yuki', 'personal', 1),
  pay('kiln', 'lena', '3.20', 'Baguettes for the café', 'rewarded'),
  acc('kiln', 'sofia', 'lena', 'personal', 1),
  pay('kiln', 'sofia', '3.10', 'Focaccia slab', 'rewarded'),

  // ---------------- Pressed (20%, min $1.00)
  { kind: 'register', id: 'register:pressed', venue: 'pressed' },
  { kind: 'seed', id: 'seed:pressed:diego', venue: 'pressed', who: 'diego' },
  acc('pressed', 'chloe', 'diego', 'personal', 2),
  pay('pressed', 'chloe', '4.50', 'Green juice + acai bowl', 'rewarded'),
  acc('pressed', 'ben', 'diego', 'broadcast', 0),
  acc('pressed', 'ben', 'chloe', 'personal', 1),
  pay('pressed', 'ben', '3.80', 'Mango smoothie', 'rewarded'),
  acc('pressed', 'ana', 'ben', 'personal', 1),
  pay('pressed', 'ana', '3.40', 'Beet + ginger shot pack', 'rewarded'),
  acc('pressed', 'tomas', 'ana', 'personal', 1),
  pay('pressed', 'tomas', '2.90', 'Carrot-orange juice', 'rewarded'),

  // ---------------- back at the café: Maya (Pressed's owner) via Chloe → L2 to Ben
  acc('cafe', 'maya', 'chloe', 'personal', 1),
  pay('cafe', 'maya', '1.90', 'Drip coffee', 'rewarded'),
];

export const LIMITS = {
  minOrderApi: usd('0.50'), // ORDER_MIN_USDC (D-808)
  maxPayment: usd('12.00'),
  maxVolume: usd('60.00'),
  maxReferrers: 5, // MAX_LIVE_INTROS / MAX_REFERRERS
};

export const venueOf = (k: VenueKey) => VENUES.find((v) => v.key === k)!;
export const personaOf = (k: PersonaKey) => PERSONAS.find((p) => p.key === k)!;
export const paySteps = (steps: Step[] = STEPS) => steps.filter((s): s is Extract<Step, { kind: 'pay' }> => s.kind === 'pay');

// ------------------------------------------------------------------------------------------- baseline weights (D-805)
/** Baseline score without recency decay (all intros in one run are minutes apart): personal 2 / broadcast 1 × (1 + 0.25 × opens). */
export function score(linkType: LinkType, opens: number): number {
  return (linkType === 'personal' ? 2 : 1) * (1 + 0.25 * Math.min(opens, 8));
}
/** Largest-remainder bps (ties → lower index), each ≥ 1, Σ = 10,000; the 8,000 cap is water-filled when > 1 referrer. */
export function baselineBps(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [10_000];
  let w = scores.map((s) => s / scores.reduce((a, b) => a + b, 0));
  const cap = 0.8;
  for (let iter = 0; iter < n; iter++) {
    const over = w.map((x) => x > cap);
    if (!over.some(Boolean)) break;
    const excess = w.reduce((a, x) => a + (x > cap ? x - cap : 0), 0);
    const freeSum = w.reduce((a, x, i) => a + (over[i] ? 0 : x), 0);
    w = w.map((x, i) => (over[i] ? cap : x + (excess * x) / freeSum));
  }
  const raw = w.map((x) => x * 10_000);
  const bps = raw.map((x) => Math.max(1, Math.floor(x)));
  let rem = 10_000 - bps.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; rem > 0; k = (k + 1) % n, rem--) bps[order[k]!.i]! += 1;
  return bps;
}

// ------------------------------------------------------------------------------------------- split math (D-503/D-504/D-508)
export interface SplitLine {
  role: 'cashback' | 'referrer' | 'introducer';
  recipient: PersonaKey;
  amount: bigint;
}
export interface Split {
  venueAmount: bigint;
  pool: bigint;
  lines: SplitLine[];
  returned: bigint;
}
/** Per-referrer slices, floored; L2 → that referrer's introducer, or back to the venue if none / it is the customer. */
export function computeSplit(
  amount: bigint,
  rewardBps: number,
  customer: PersonaKey,
  referrers: { who: PersonaKey; bps: number; introducer: PersonaKey | null }[],
): Split {
  const lines: SplitLine[] = [];
  let cashback = 0n;
  let pool = 0n;
  let returned = 0n;
  const l1: SplitLine[] = [];
  const l2: SplitLine[] = [];
  for (const r of referrers) {
    const slice = (amount * BigInt(r.bps) * BigInt(rewardBps)) / 100_000_000n;
    pool += slice;
    cashback += (slice * 2500n) / 10_000n;
    l1.push({ role: 'referrer', recipient: r.who, amount: (slice * 5500n) / 10_000n });
    const l2amt = (slice * 2000n) / 10_000n;
    if (r.introducer && r.introducer !== customer) l2.push({ role: 'introducer', recipient: r.introducer, amount: l2amt });
    else returned += l2amt;
  }
  if (referrers.length) lines.push({ role: 'cashback', recipient: customer, amount: cashback }, ...l1, ...l2);
  const paid = lines.reduce((a, l) => a + l.amount, 0n);
  return { venueAmount: amount - paid, pool, lines, returned };
}

// ------------------------------------------------------------------------------------------- plan simulation
export interface SimPayment {
  step: Extract<Step, { kind: 'pay' }>;
  firstPurchase: boolean;
  rewarded: boolean;
  referrers: { who: PersonaKey; bps: number; introducer: PersonaKey | null }[];
  split: Split;
}
export interface SimResult {
  errors: string[];
  payments: SimPayment[];
  volume: bigint;
  /** introducer per (venue, customer), the D-008 rule */
  introducers: Record<string, PersonaKey | null>;
}

/** Replays the plan with the contract's rules; returns every violation (empty = the chain should accept it all). */
export function simulatePlan(steps: Step[] = STEPS, venues: VenuePlan[] = VENUES): SimResult {
  const errors: string[] = [];
  const registered = new Set<VenueKey>();
  const seeds = new Map<VenueKey, Set<PersonaKey>>();
  const verified = new Map<VenueKey, Set<PersonaKey>>();
  const live = new Map<string, { referrer: PersonaKey; linkType: LinkType; opens: number }[]>();
  const personalUsed = new Set<string>();
  const broadcastUsed = new Set<string>();
  const introducers: Record<string, PersonaKey | null> = {};
  const ids = new Set<string>();
  const payments: SimPayment[] = [];
  let volume = 0n;
  const V = (k: VenueKey) => venues.find((v) => v.key === k);
  const set = <T>(m: Map<VenueKey, Set<T>>, k: VenueKey) => m.get(k) ?? m.set(k, new Set<T>()).get(k)!;

  for (const s of steps) {
    if (ids.has(s.id)) errors.push(`${s.id}: duplicate step id`);
    ids.add(s.id);
    const venue = V(s.venue);
    if (!venue) {
      errors.push(`${s.id}: unknown venue ${s.venue}`);
      continue;
    }
    if (s.kind === 'register') {
      if (registered.has(s.venue)) errors.push(`${s.id}: venue registered twice`);
      registered.add(s.venue);
      continue;
    }
    if (!registered.has(s.venue)) errors.push(`${s.id}: venue ${s.venue} not registered yet`);
    const ver = set(verified, s.venue);
    if (s.kind === 'seed') {
      set(seeds, s.venue).add(s.who);
      continue;
    }
    const key = `${s.venue}:${s.customer}`;
    if (s.kind === 'accept') {
      if (s.customer === s.referrer) errors.push(`${s.id}: self-referral`);
      if (!set(seeds, s.venue).has(s.referrer) && !ver.has(s.referrer)) errors.push(`${s.id}: ${s.referrer} is neither a seed nor verified at ${s.venue}`);
      if (ver.has(s.customer)) errors.push(`${s.id}: ${s.customer} is already verified at ${s.venue} (can't accept intros)`);
      if (s.linkType === 'personal') {
        if (personalUsed.has(s.link)) errors.push(`${s.id}: personal link ${s.link} used twice`);
        personalUsed.add(s.link);
      } else {
        const k = `${s.link}|${s.customer}`;
        if (broadcastUsed.has(k)) errors.push(`${s.id}: broadcast link accepted twice by ${s.customer}`);
        broadcastUsed.add(k);
      }
      const slots = live.get(key) ?? [];
      if (slots.some((x) => x.referrer === s.referrer)) errors.push(`${s.id}: second intro from ${s.referrer} would replace the first`);
      slots.push({ referrer: s.referrer, linkType: s.linkType, opens: s.opens });
      if (slots.length > LIMITS.maxReferrers) errors.push(`${s.id}: more than ${LIMITS.maxReferrers} live intros`);
      live.set(key, slots);
      continue;
    }
    // pay
    volume += s.amount;
    if (s.amount < LIMITS.minOrderApi) errors.push(`${s.id}: $${fmt(s.amount)} is below the api's $0.50 order floor`);
    if (s.amount > LIMITS.maxPayment) errors.push(`${s.id}: $${fmt(s.amount)} is above $${fmt(LIMITS.maxPayment)}`);
    const first = !ver.has(s.customer);
    const slots = first ? (live.get(key) ?? []) : [];
    const eligible = s.amount >= venue.minOrder ? slots : [];
    const rewarded = first && eligible.length > 0;
    const got: SimPayment['step']['expect'] = !first ? 'repeat' : rewarded ? 'rewarded' : 'below_min';
    if (got !== s.expect) errors.push(`${s.id}: expected ${s.expect}, the rules give ${got}`);
    if (first && slots.length === 0) errors.push(`${s.id}: first purchase without any intro (plain; not in the story)`);
    const bps = baselineBps(eligible.map((x) => score(x.linkType, x.opens)));
    const referrers = eligible.map((x, i) => ({ who: x.referrer, bps: bps[i]!, introducer: introducers[`${s.venue}:${x.referrer}`] ?? null }));
    if (first) {
      ver.add(s.customer);
      // D-008: introducer = the top-weight L1 of the first rewarded purchase (ties → lower index); none otherwise
      let top: PersonaKey | null = null;
      let best = -1;
      referrers.forEach((r) => {
        if (r.bps > best) (best = r.bps), (top = r.who);
      });
      introducers[key] = rewarded ? top : null;
      live.delete(key);
    }
    payments.push({ step: s, firstPurchase: first, rewarded, referrers, split: computeSplit(s.amount, rewarded ? venue.rewardBps : 0, s.customer, rewarded ? referrers : []) });
  }
  if (volume > LIMITS.maxVolume) errors.push(`payment volume $${fmt(volume)} exceeds $${fmt(LIMITS.maxVolume)}`);
  return { errors, payments, volume, introducers };
}

// ------------------------------------------------------------------------------------------- funding (D-812)
export interface Donor {
  key: PersonaKey;
  balance: bigint;
  /** what the donor still has to spend itself (its own remaining planned payments) */
  reserved: bigint;
}
export interface FundingPlan {
  /** transfers from seed-owned wallets with surplus (venue revenue), in donor order */
  fromDonors: { from: PersonaKey; amount: bigint }[];
  /** the rest, from DEPLOYER via the topup CLI */
  fromDeployer: bigint;
}
/** Remaining spend of a persona from `fromIndex` on (its own planned payments). */
export function remainingSpend(who: PersonaKey, fromIndex: number, steps: Step[] = STEPS): bigint {
  return steps.slice(fromIndex).reduce((a, s) => (s.kind === 'pay' && s.customer === who ? a + s.amount : a), 0n);
}
/**
 * Cover `need` (≥ 0) for a payer: first from donors' surplus (balance − reserved − gas buffer, only chunks ≥ $0.10),
 * then the deployer. Pure and deterministic.
 */
export function planFunding(need: bigint, donors: Donor[], gasBuffer = usd('0.05')): FundingPlan {
  const fromDonors: FundingPlan['fromDonors'] = [];
  let left = need;
  for (const d of donors) {
    if (left <= 0n) break;
    const surplus = d.balance - d.reserved - gasBuffer;
    if (surplus < usd('0.10')) continue;
    const take = surplus < left ? surplus : left;
    fromDonors.push({ from: d.key, amount: take });
    left -= take;
  }
  return { fromDonors, fromDeployer: left > 0n ? left : 0n };
}
