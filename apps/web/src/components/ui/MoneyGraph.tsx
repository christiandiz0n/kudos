import type { CSSProperties, ReactNode } from "react";
import { formatMoney } from "@/design/money";
import { initials } from "./Avatar";

/**
 * MONEY GRAPH v1 (UI_DESIGN venue, Phase 3; A9 blue venue). The signature visual: money leaving a customer's purchase, the big
 * neutral stream to the venue and the green streams up the recommendation chain (customer → recommender →
 * whoever brought them in). Props-only, deterministic layout, plain SVG + CSS (no d3, no physics).
 *
 *   <MoneyGraph data={{ venue, flows, names }} highlightPaymentId={latest} live orientation="landscape" />
 *
 * - Input is a flat list of flows, derivable 1:1 from `GET /venues/:venue/stats` `edges` (role 0 → "cashback",
 *   1 → 1, 2 → 2) plus one `"venue"` flow per payment from `payment.settled` (customer → venue, venueAmount).
 *   Helpers: `moneyFlowsFromEdges`, `venueFlowsFromPayments`.
 * - Layout: flow runs venue ← customers → recommenders → introducers (left→right in landscape, top→bottom in
 *   portrait). One column/row per tier; a person sits in the highest tier they were ever paid in.
 * - Cashback is NOT an edge (MSG-008/MSG-044): it is a "+$0.45 back" badge on the customer node.
 * - Scale: at most `maxPerTier` nodes per tier; the long tail collapses into one "N more" node per tier
 *   (highlighted people are always kept). Edge width = 2 + k·√(amount / largest edge) (D-603).
 * - Motion: when `live`, the highlighted payment assembles in payout order (customer pops, venue edge draws, cashback
 *   badge, recommenders, introducers; 140ms stagger), recipients ping on arrival, dashes run toward recipients for
 *   ~3s then settle. Re-keyed on `highlightPaymentId` / `replayKey`, so each new payment replays. Reduced motion:
 *   final frame, no movement.
 */

/* ------------------------------------------------------------------ types ---------------------------------------- */

/** "venue" = customer → venue remainder; "cashback" = welcome cashback (from === to === customer); 1 = recommender; 2 = introducer. */
export type MoneyFlowLevel = "venue" | "cashback" | 1 | 2;

export interface MoneyFlow {
  /** Groups the flows of one payment (orderId or txHash). */
  paymentId: string;
  /** Payer: the customer for venue / cashback / level 1; the level-1 recommender (`viaReferrer`) for level 2. */
  from: string;
  /** Recipient: the venue id for "venue"; the customer for "cashback". */
  to: string;
  level: MoneyFlowLevel;
  /** USDC base units. Zero-amount flows are ignored. */
  amount: bigint;
}

export interface MoneyGraphData {
  venue: { id: string; name: string };
  /** Oldest first. The last payment is the default highlight in `mode="payment"`. */
  flows: MoneyFlow[];
  /** Display names by person id (addresses are matched case-insensitively). Unnamed people show as "Guest N". */
  names?: Record<string, string>;
}

/** v0 single-payment shape (kept so existing fixtures keep type-checking). Prefer `data`. */
export interface MoneyGraphReferrer {
  name: string;
  amount: bigint;
  introducer?: { name: string; amount: bigint };
}
export interface MoneyGraphPayment {
  venue: { name: string; amount: bigint };
  customer: { name: string; cashback: bigint };
  referrers: MoneyGraphReferrer[];
  total: bigint;
}

export interface MoneyGraphProps extends Partial<MoneyGraphPayment> {
  data?: MoneyGraphData;
  /** `payment` draws one payment (the highlighted / latest). `network` draws every flow, aggregated per pair. */
  mode?: "payment" | "network";
  /** Payment to emphasise (green, animated). Default: the latest payment in `data.flows`. */
  highlightPaymentId?: string;
  /** Play the arrival choreography for the highlighted payment. Default true. Ignored under reduced motion. */
  live?: boolean;
  /** Change to replay the choreography for the same payment. */
  replayKey?: string | number;
  /** `landscape` 16:9 (projector, ≥1024px); `portrait` (phone card, ~360 wide). */
  orientation?: "landscape" | "portrait";
  /** Max nodes per tier before the tail collapses. Default 7 landscape / 4 portrait (landscape + `box`: from the height). */
  maxPerTier?: number;
  /** Landscape only: lay out at this pixel size (1 unit = 1px) instead of the fixed 1280x720 viewBox. See FitMoneyGraph. */
  box?: { w: number; h: number };
  className?: string;
  /** Overrides the generated accessible description. */
  title?: string;
  /** @deprecated v0: "projector" = landscape, "compact" = portrait. */
  size?: "projector" | "compact";
  /** @deprecated v0 alias of `live`. */
  animated?: boolean;
}

/* ------------------------------------------------------------------ adapters ------------------------------------- */

/** `GET /venues/:venue/stats` edges → flows. Amounts must already be bigint (`BigInt(e.amount.baseUnits)`). */
export function moneyFlowsFromEdges(edges: ReadonlyArray<{ orderId: string; from: string; to: string; role: 0 | 1 | 2; amount: bigint }>): MoneyFlow[] {
  return edges.map((e) => ({ paymentId: e.orderId, from: e.from, to: e.to, level: e.role === 0 ? "cashback" : e.role, amount: e.amount }));
}

/** `payment.settled` (or a payments list) → the customer → venue flow of each payment. */
export function venueFlowsFromPayments(venueId: string, payments: ReadonlyArray<{ orderId: string; customer: string; venueAmount: bigint }>): MoneyFlow[] {
  return payments.map((p) => ({ paymentId: p.orderId, from: p.customer, to: venueId, level: "venue" as const, amount: p.venueAmount }));
}

/** v0 single-payment props → v1 data (ids = names). */
export function moneyGraphFromPayment(p: MoneyGraphPayment, paymentId = "payment"): MoneyGraphData {
  const c = p.customer.name;
  const flows: MoneyFlow[] = [
    { paymentId, from: c, to: "venue", level: "venue", amount: p.venue.amount },
    { paymentId, from: c, to: c, level: "cashback", amount: p.customer.cashback },
  ];
  for (const r of p.referrers) flows.push({ paymentId, from: c, to: r.name, level: 1, amount: r.amount });
  for (const r of p.referrers) if (r.introducer) flows.push({ paymentId, from: r.name, to: r.introducer.name, level: 2, amount: r.introducer.amount });
  return { venue: { id: "venue", name: p.venue.name }, flows };
}

/* ------------------------------------------------------------------ layout --------------------------------------- */

type Tier = 0 | 1 | 2;
type Orientation = "landscape" | "portrait";

export interface GraphNode {
  id: string;
  name: string;
  tier: Tier;
  x: number;
  y: number;
  /** Money received as recommender / introducer (all shown flows). */
  received: bigint;
  /** Total of the payments this person made (all shown flows). */
  paid: bigint;
  cashback: bigint;
  /** In the highlighted payment: what they received / paid / got back. */
  hl: { on: boolean; received: bigint; paid: bigint; cashback: bigint; customer: boolean; arrival: number };
  /** Collapsed tail: how many people this node stands for. */
  count?: number;
}

export interface GraphEdge {
  key: string;
  from: string;
  to: string;
  level: "venue" | 1 | 2;
  amount: bigint;
  d: string;
  width: number;
  hl: boolean;
  /** Animation start (ms) for highlighted edges. */
  start: number;
}

export interface GraphLayout {
  W: number;
  H: number;
  R: number;
  font: number;
  twoLine: boolean;
  orientation: Orientation;
  mode: "payment" | "network";
  venue: { x: number; y: number; side: number; name: string; amount: bigint; hlAmount: bigint };
  nodes: GraphNode[];
  edges: GraphEdge[];
  hlId?: string;
  summary: string;
}

const DRAW_MS = 650;
const STAGGER = 140;
const T_VENUE = 250;
const T_L1 = 700;

const norm = (s: string) => s.toLowerCase();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function layoutMoneyGraph(
  data: MoneyGraphData,
  opts: { mode?: "payment" | "network"; highlightPaymentId?: string; orientation?: Orientation; maxPerTier?: number; box?: { w: number; h: number } } = {},
): GraphLayout {
  const mode = opts.mode ?? "payment";
  const orientation = opts.orientation ?? "landscape";
  // v2 (QE F1): with `box` the landscape graph is laid out at the container's real pixel size (1 unit = 1px), so type
  // sizes below are true pixels on the projector. The tier cap then follows the height: every row keeps a readable slot.
  const box = orientation === "landscape" && opts.box && opts.box.w > 200 && opts.box.h > 160 ? opts.box : null;
  const fitK = box ? Math.max(3, Math.floor((box.h - 56) / 74)) : null;
  const K = Math.max(2, opts.maxPerTier ?? fitK ?? (orientation === "landscape" ? 7 : 4));
  const venueId = norm(data.venue.id);
  const names = new Map(Object.entries(data.names ?? {}).map(([k, v]) => [norm(k), v]));

  // Payment ids (orderId hex from stats vs SSE) are matched case-insensitively.
  const all = data.flows.filter((f) => f.amount > 0n).map((f) => ({ ...f, paymentId: norm(f.paymentId) }));
  const payIds: string[] = [];
  for (const f of all) if (!payIds.includes(f.paymentId)) payIds.push(f.paymentId);
  const hlId = opts.highlightPaymentId ? norm(opts.highlightPaymentId) : payIds.at(-1);
  const flows = mode === "payment" ? all.filter((f) => f.paymentId === hlId) : all;

  // Payment → customer + total
  const payCustomer = new Map<string, string>();
  const payTotal = new Map<string, bigint>();
  for (const f of flows) {
    if (f.level !== 2 && !payCustomer.has(f.paymentId)) payCustomer.set(f.paymentId, norm(f.from));
    payTotal.set(f.paymentId, (payTotal.get(f.paymentId) ?? 0n) + f.amount);
  }

  // People
  type P = Omit<GraphNode, "x" | "y" | "tier"> & { inL1: boolean; inL2: boolean; order: number };
  const people = new Map<string, P>();
  let guest = 0;
  const person = (raw: string): P => {
    const id = norm(raw);
    let p = people.get(id);
    if (!p) {
      const name = names.get(id) ?? (/^0x[0-9a-f]{6,}$/.test(id) ? `Guest ${++guest}` : raw);
      p = { id, name, received: 0n, paid: 0n, cashback: 0n, hl: { on: false, received: 0n, paid: 0n, cashback: 0n, customer: false, arrival: 0 }, inL1: false, inL2: false, order: people.size };
      people.set(id, p);
    }
    return p;
  };
  let venueAmount = 0n;
  let venueHl = 0n;
  const hlRole = new Map<string, Tier>();
  for (const f of flows) {
    const isHl = f.paymentId === hlId;
    if (norm(f.from) !== venueId) {
      const p = person(f.from);
      if (isHl) p.hl.on = true;
    }
    if (f.level === "venue") {
      venueAmount += f.amount;
      if (isHl) venueHl += f.amount;
    } else if (f.level === "cashback") {
      const p = person(f.to);
      p.cashback += f.amount;
      if (isHl) p.hl.cashback += f.amount;
    } else {
      const p = person(f.to);
      p.received += f.amount;
      if (f.level === 1) p.inL1 = true;
      else p.inL2 = true;
      if (isHl) {
        p.hl.on = true;
        p.hl.received += f.amount;
        hlRole.set(p.id, Math.max(hlRole.get(p.id) ?? 0, f.level) as Tier);
      }
    }
  }
  for (const [pid, c] of payCustomer) {
    const p = people.get(c);
    if (!p) continue;
    p.paid += payTotal.get(pid) ?? 0n;
    if (pid === hlId) {
      p.hl.paid += payTotal.get(pid) ?? 0n;
      p.hl.customer = true;
      hlRole.set(p.id, 0);
    }
  }

  // Tiers + collapse the tail. People in the highlighted payment sit in the column of their role in it, so the
  // story always reads customer → recommender → introducer; everyone else sits in the highest tier they were paid in.
  const tierOf = (p: P): Tier => hlRole.get(p.id) ?? (p.inL2 ? 2 : p.inL1 ? 1 : 0);
  const weight = (p: P, t: Tier) => (t === 0 ? p.paid : p.received);
  const remap = new Map<string, string>();
  const tiers: Record<Tier, Array<GraphNode & { order: number }>> = { 0: [], 1: [], 2: [] };
  for (const t of [0, 1, 2] as Tier[]) {
    const list = [...people.values()].filter((p) => tierOf(p) === t);
    list.sort((a, b) => (weight(b, t) > weight(a, t) ? 1 : weight(b, t) < weight(a, t) ? -1 : a.order - b.order));
    let keep = list;
    let rest: P[] = [];
    if (list.length > K) {
      const forced = list.filter((p) => p.hl.on);
      const others = list.filter((p) => !p.hl.on);
      const room = Math.max(0, K - 1 - forced.length);
      keep = list.filter((p) => p.hl.on || others.indexOf(p) < room);
      rest = list.filter((p) => !keep.includes(p));
    }
    for (const p of keep) tiers[t].push({ ...p, tier: t, x: 0, y: 0 });
    if (rest.length) {
      const id = `more:${t}`;
      for (const p of rest) remap.set(p.id, id);
      tiers[t].push({
        id,
        name: `${rest.length} more`,
        tier: t,
        x: 0,
        y: 0,
        received: rest.reduce((a, p) => a + p.received, 0n),
        paid: rest.reduce((a, p) => a + p.paid, 0n),
        cashback: rest.reduce((a, p) => a + p.cashback, 0n),
        hl: { on: false, received: 0n, paid: 0n, cashback: 0n, customer: false, arrival: 0 },
        count: rest.length,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
  }
  const nodeId = (raw: string) => {
    const id = norm(raw);
    return id === venueId ? "venue" : (remap.get(id) ?? id);
  };

  // Aggregate edges (cashback is a badge, not an edge)
  type E = { from: string; to: string; level: "venue" | 1 | 2; amount: bigint; hl: boolean; first: number };
  const agg = new Map<string, E>();
  const hlAgg = new Map<string, E>();
  flows.forEach((f, i) => {
    if (f.level === "cashback") return;
    const from = nodeId(f.from);
    const to = f.level === "venue" ? "venue" : nodeId(f.to);
    if (from === to) return;
    const key = `${from}>${to}>${f.level}`;
    const add = (m: Map<string, E>, hl: boolean) => {
      const e = m.get(key) ?? { from, to, level: f.level as E["level"], amount: 0n, hl, first: i };
      e.amount += f.amount;
      m.set(key, e);
    };
    add(agg, false);
    if (f.paymentId === hlId) add(hlAgg, true);
  });

  // Order within tiers: follow the strongest outgoing edge into the next tier (fewer crossings)
  const idx = (t: Tier) => new Map(tiers[t].map((n, i) => [n.id, i]));
  const strongest = (id: string, level: 1 | 2, target: Map<string, number>) => {
    let best: E | undefined;
    for (const e of agg.values()) if (e.from === id && e.level === level && target.has(e.to) && (!best || e.amount > best.amount)) best = e;
    return best ? target.get(best.to)! : Number.MAX_SAFE_INTEGER - 1;
  };
  const sortTier = (t: Tier, level: 1 | 2 | null) => {
    const target = level ? idx((t + 1) as Tier) : null;
    const w = (n: GraphNode) => (t === 0 ? n.paid : n.received);
    tiers[t].sort((a, b) => {
      if (a.count !== undefined || b.count !== undefined) return (a.count !== undefined ? 1 : 0) - (b.count !== undefined ? 1 : 0);
      if (target && level) {
        const d = strongest(a.id, level, target) - strongest(b.id, level, target);
        if (d) return d;
      }
      return w(b) > w(a) ? 1 : w(b) < w(a) ? -1 : a.order - b.order;
    });
  };
  sortTier(2, null);
  sortTier(1, 2);
  sortTier(0, 1);

  // Geometry in (u = along the flow, v = across), mapped to (x, y) by orientation
  const present = ([0, 1, 2] as Tier[]).filter((t) => tiers[t].length);
  const L = orientation === "landscape";
  const across = box ? box.h : L ? 720 : 360;
  const padV = box ? Math.max(28, box.h * 0.07) : L ? 44 : 18;
  const maxCount = Math.max(1, ...present.map((t) => tiers[t].length));
  const slot = Math.min(L ? 300 : 170, (across - 2 * padV) / maxCount);
  const font = box ? clamp(slot * 0.16, 18, 26) : L ? clamp(slot * 0.2, 15, 24) : clamp(slot * 0.17, 14, 17);
  const R = box ? clamp(slot * 0.24, 20, 40) : L ? clamp(slot * 0.27, 14, 38) : clamp(slot * 0.25, 15, 26);
  const twoLine = !L || slot >= 2 * R + 2.5 * font + 12;
  const labelH = twoLine ? font * 2.35 : font * 1.25;
  const vSide = L ? clamp(R * 2.4, 56, 84) : 50;

  let W: number;
  let H: number;
  const cols = present.length + 1;
  const uPos: number[] = [];
  if (L) {
    W = box ? Math.round(box.w) : 1280;
    H = box ? Math.round(box.h) : 720;
    const edge = box ? Math.max(96, W * 0.085) : 0;
    const u0 = box ? edge : 120;
    const u1 = box ? W - edge : W - 110;
    for (let i = 0; i < cols; i++) uPos.push(cols === 1 ? W / 2 : u0 + (i * (u1 - u0)) / (cols - 1));
  } else {
    W = 360;
    const gap = 2 * R + labelH + 64;
    const u0 = vSide / 2 + 16;
    uPos.push(u0);
    for (let i = 1; i < cols; i++) uPos.push(i === 1 ? u0 + vSide / 2 + R + 56 : uPos[i - 1] + gap);
    H = Math.ceil((cols === 1 ? u0 + vSide / 2 : uPos[cols - 1] + R + labelH) + 18);
  }
  const at = (u: number, v: number) => (L ? { x: u, y: v } : { x: v, y: u });
  const venuePt = at(uPos[0], across / 2);
  const nodes: GraphNode[] = [];
  present.forEach((t, ci) => {
    const list = tiers[t];
    const n = list.length;
    const s = Math.min(L ? 300 : 170, (across - 2 * padV) / n);
    list.forEach((node, j) => {
      const p = at(uPos[ci + 1], across / 2 + (j - (n - 1) / 2) * s);
      nodes.push({ ...node, x: p.x, y: p.y });
    });
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Edges
  let maxAmt = 1n;
  for (const e of agg.values()) if (e.amount > maxAmt) maxAmt = e.amount;
  const maxW = Math.max(6, R * 0.9);
  const wOf = (a: bigint) => 2 + (maxW - 2) * Math.sqrt(Number((a * 1_000_000n) / maxAmt) / 1_000_000);
  const U = (p: { x: number; y: number }) => (L ? p.x : p.y);
  const V = (p: { x: number; y: number }) => (L ? p.y : p.x);
  const out = (id: string, forward: boolean) => {
    if (id === "venue") return vSide / 2 + 2;
    return forward && !L ? R + labelH + 4 : R + 2;
  };
  const pathFor = (e: E) => {
    const a = e.from === "venue" ? venuePt : byId.get(e.from);
    const b = e.to === "venue" ? venuePt : byId.get(e.to);
    if (!a || !b) return null;
    const ua = U(a);
    const ub = U(b);
    const dir = ub > ua ? 1 : ub < ua ? -1 : 0;
    if (dir === 0) {
      // Same tier (a recommender who was also recommended by a peer). Bulge into the gap BEFORE the column when it is
      // the last one, so the arc never leaves the card (MSG-107); otherwise into the gap after it. The bulge grows
      // with the distance between the two nodes but stays well inside the inter-column gap.
      const last = ua >= uPos[uPos.length - 1] - 1;
      const side = last ? -1 : 1;
      const gapU = uPos.length > 1 ? Math.abs(uPos[uPos.length - 1] - uPos[uPos.length - 2]) : 120;
      const c = clamp(Math.abs(V(b) - V(a)) * 0.45, 28, Math.min(90, gapU * 0.3));
      const s = { u: ua + side * (R + 2), v: V(a) };
      const t = { u: ub + side * (R + 2), v: V(b) };
      const [p0, p1, p2, p3] = [at(s.u, s.v), at(s.u + side * c, s.v), at(t.u + side * c, t.v), at(t.u, t.v)];
      return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
    }
    const su = ua + dir * out(e.from, dir > 0);
    const tu = ub - dir * out(e.to, dir < 0);
    const mid = (su + tu) / 2;
    const [p0, p1, p2, p3] = [at(su, V(a)), at(mid, V(a)), at(mid, V(b)), at(tu, V(b))];
    return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
  };

  // Choreography: venue first, then recommenders by position, then introducers
  const hlEdges = [...hlAgg.values()];
  const orderKey = (e: E) => {
    const n = e.to === "venue" ? undefined : byId.get(e.to);
    return n ? V(n) : 0;
  };
  const startOf = new Map<string, number>();
  const l1 = hlEdges.filter((e) => e.level === 1).sort((a, b) => orderKey(a) - orderKey(b));
  const l2 = hlEdges.filter((e) => e.level === 2).sort((a, b) => orderKey(a) - orderKey(b));
  hlEdges.filter((e) => e.level === "venue").forEach((e, i) => startOf.set(`${e.from}>${e.to}>${e.level}`, T_VENUE + i * STAGGER));
  l1.forEach((e, i) => startOf.set(`${e.from}>${e.to}>${e.level}`, T_L1 + i * STAGGER));
  const tL2 = T_L1 + Math.max(1, l1.length) * STAGGER + DRAW_MS - 150;
  l2.forEach((e, i) => startOf.set(`${e.from}>${e.to}>${e.level}`, tL2 + i * STAGGER));

  const edges: GraphEdge[] = [];
  for (const [key, e] of agg) {
    const d = pathFor(e);
    if (!d) continue;
    edges.push({ key, from: e.from, to: e.to, level: e.level, amount: e.amount, d, width: wOf(e.amount), hl: false, start: 0 });
  }
  for (const [key, e] of hlAgg) {
    const d = pathFor(e);
    if (!d) continue;
    const start = startOf.get(key) ?? 0;
    edges.push({ key: `hl:${key}`, from: e.from, to: e.to, level: e.level, amount: e.amount, d, width: wOf(e.amount), hl: true, start });
    const n = byId.get(e.to);
    if (n) n.hl.arrival = Math.max(n.hl.arrival, start + DRAW_MS);
  }
  edges.sort((a, b) => Number(a.hl) - Number(b.hl) || (a.level === "venue" ? -1 : 0) - (b.level === "venue" ? -1 : 0));

  // Accessible summary
  const hlCustomer = nodes.find((n) => n.hl.customer);
  let summary: string;
  if (hlCustomer && hlId) {
    const recips = nodes.filter((n) => n.hl.received > 0n).map((n) => `${n.name} got ${formatMoney(n.hl.received)}`);
    summary =
      `${hlCustomer.name} paid ${formatMoney(hlCustomer.hl.paid)}. ${data.venue.name} received ${formatMoney(venueHl)}.` +
      (hlCustomer.hl.cashback > 0n ? ` ${hlCustomer.name} got ${formatMoney(hlCustomer.hl.cashback)} back.` : "") +
      (recips.length ? ` ${recips.join(", ")} for sending them.` : "");
    if (mode === "network") summary = `${people.size} people, ${payIds.length} payments. Latest: ${summary}`;
  } else {
    summary = `${data.venue.name}. No payments yet.`;
  }

  return {
    W,
    H,
    R,
    font,
    twoLine,
    orientation,
    mode,
    venue: { x: venuePt.x, y: venuePt.y, side: vSide, name: data.venue.name, amount: venueAmount, hlAmount: venueHl },
    nodes,
    edges,
    hlId,
    summary,
  };
}

/* ------------------------------------------------------------------ render --------------------------------------- */

const CSS = `
.vx-mg-draw{stroke-dasharray:1 1;animation:vx-mg-draw ${DRAW_MS}ms cubic-bezier(.2,.8,.2,1) var(--t,0ms) both}
@keyframes vx-mg-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.vx-mg-run{stroke-dasharray:2 14;animation:vx-mg-run 3.2s linear var(--t,0ms) both}
@keyframes vx-mg-run{0%{stroke-dashoffset:0;opacity:0}8%{opacity:1}82%{opacity:1}100%{stroke-dashoffset:-224;opacity:0}}
.vx-mg-pop{transform-box:fill-box;transform-origin:center;animation:vx-mg-pop 420ms cubic-bezier(.34,1.56,.64,1) var(--t,0ms) both}
@keyframes vx-mg-pop{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}
.vx-mg-fade{animation:vx-mg-fade 320ms ease-out var(--t,0ms) both}
@keyframes vx-mg-fade{from{opacity:0}to{opacity:1}}
.vx-mg-ping{opacity:0;transform-box:fill-box;transform-origin:center;animation:vx-mg-ping 900ms ease-out var(--t,0ms) forwards}
@keyframes vx-mg-ping{from{opacity:.75;transform:scale(1)}to{opacity:0;transform:scale(1.9)}}
@media (prefers-reduced-motion:reduce){
.vx-mg-draw,.vx-mg-pop,.vx-mg-fade{animation:none!important;stroke-dashoffset:0;opacity:1;transform:none}
.vx-mg-run,.vx-mg-ping{display:none}
}`;

const delay = (ms: number) => ({ "--t": `${Math.round(ms)}ms` }) as CSSProperties;

export function MoneyGraph(props: MoneyGraphProps) {
  const { mode = "payment", highlightPaymentId, replayKey, maxPerTier, className, title, box } = props;
  const orientation: Orientation = props.orientation ?? (props.size === "compact" ? "portrait" : "landscape");
  const live = props.live ?? props.animated ?? true;
  const data: MoneyGraphData | null =
    props.data ??
    (props.venue && props.customer && props.referrers && props.total !== undefined
      ? moneyGraphFromPayment({ venue: props.venue, customer: props.customer, referrers: props.referrers, total: props.total })
      : null);
  if (!data) return null;

  const g = layoutMoneyGraph(data, { mode, highlightPaymentId, orientation, maxPerTier, box });
  const { R, font: f, twoLine, W, H } = g;
  const L = orientation === "landscape";
  const anim = live && !!g.hlId;
  const net = mode === "network";
  const halo = { paintOrder: "stroke", stroke: "var(--vx-surface)", strokeWidth: Math.max(4, f * 0.28), strokeLinejoin: "round" } as const;

  const edgeEl = (e: GraphEdge): ReactNode => {
    const venue = e.level === "venue";
    if (!e.hl) {
      return (
        <path
          key={e.key}
          d={e.d}
          fill="none"
          stroke={venue ? "var(--vx-primary-soft-2)" : "var(--vx-accent-4)"}
          strokeOpacity={net && g.hlId ? (venue ? 0.7 : 0.75) : 1}
          strokeWidth={e.width}
          strokeLinecap="round"
        />
      );
    }
    return (
      <g key={e.key}>
        <path
          d={e.d}
          fill="none"
          pathLength={1}
          stroke={venue ? "var(--vx-primary)" : "var(--vx-accent-2)"}
          strokeOpacity={venue ? 0.5 : 1}
          strokeWidth={e.width}
          strokeLinecap="round"
          className={anim ? "vx-mg-draw" : undefined}
          style={anim ? delay(e.start) : undefined}
        />
        {anim ? (
          <path
            d={e.d}
            fill="none"
            stroke={venue ? "var(--vx-primary-pressed)" : "var(--vx-surface)"}
            strokeOpacity={venue ? 0.7 : 0.9}
            strokeWidth={Math.max(2.5, e.width * 0.32)}
            strokeLinecap="round"
            className="vx-mg-run"
            style={delay(e.start + DRAW_MS - 100)}
          />
        ) : null}
      </g>
    );
  };

  const label = (n: GraphNode) => {
    const isCustomerView = n.tier === 0;
    const amount = n.count !== undefined ? (n.tier === 0 ? n.paid : n.received) : net ? (n.tier === 0 ? n.paid : n.received) : n.tier === 0 ? n.hl.paid : n.hl.received;
    const amountText = isCustomerView ? `paid ${formatMoney(amount)}` : `+${formatMoney(amount)}`;
    const dim = net && g.hlId && !n.hl.on;
    const nameFill = dim ? "var(--vx-ink-2)" : "var(--vx-ink)";
    const amtFill = isCustomerView ? "var(--vx-ink-2)" : "var(--vx-accent-ink)";
    const y0 = n.y + R + f * 1.05;
    const amtAnim = anim && n.hl.on && !isCustomerView && n.hl.arrival ? { className: "vx-mg-fade", style: delay(n.hl.arrival - 120) } : {};
    if (twoLine)
      return (
        <g fontSize={f} fontWeight={600} textAnchor="middle">
          <text x={n.x} y={y0} fill={nameFill} {...halo}>
            {n.name}
          </text>
          <text x={n.x} y={y0 + f * 1.15} fontSize={f * 0.9} fill={amtFill} style={{ fontVariantNumeric: "tabular-nums", ...amtAnim.style }} className={amtAnim.className} {...halo}>
            {amountText}
          </text>
        </g>
      );
    return (
      <text x={n.x} y={y0} fontSize={f} fontWeight={600} textAnchor="middle" {...halo}>
        <tspan fill={nameFill}>{n.name}</tspan>
        <tspan fill={amtFill} fontSize={f * 0.9} style={{ fontVariantNumeric: "tabular-nums" }}>
          {"  "}
          {isCustomerView ? formatMoney(amount) : `+${formatMoney(amount)}`}
        </tspan>
      </text>
    );
  };

  const nodeEl = (n: GraphNode) => {
    const cluster = n.count !== undefined;
    const pop = anim && n.hl.on ? (n.hl.customer ? 0 : n.hl.arrival - 260) : null;
    const recipient = n.hl.received > 0n;
    const badge = n.hl.customer && n.hl.cashback > 0n ? n.hl.cashback : !net && n.cashback > 0n ? n.cashback : 0n;
    const bf = Math.max(13, f * 0.74);
    const btxt = `+${formatMoney(badge)} back`;
    const bw = btxt.length * bf * 0.56 + 18;
    const bh = bf + 10;
    // Cashback badge (never a loop). Portrait: right of the node (edges leave up/down). Landscape, roomy: centred
    // above the node. Landscape, dense column: pinned to the node's upper-right (see below).
    // Portrait row with neighbours: no room to the right, so centre it above the node (over the venue stream's tail).
    const crowdedRow = !L && g.nodes.filter((m) => m.tier === n.tier).length > 1;
    const above = (L && twoLine) || crowdedRow;
    // Landscape, dense column (one-line labels): pin it to the node's upper-right like a tag, overlapping the
    // customer ring, so it reads as Ben's and never as a label on the edge to Ana (MSG-107). It stays above the
    // node's own label and below the label of the node above.
    const bx = above ? n.x - bw / 2 : !L ? n.x + R + 8 : n.x + R * 0.45;
    const by = above ? n.y - R - 10 - bh : !L ? n.y - bh / 2 : n.y - R - bh / 2 + 1;
    const dim = net && g.hlId && !n.hl.on;
    return (
      <g key={n.id} opacity={dim ? 0.92 : 1}>
        <g className={pop !== null ? "vx-mg-pop" : undefined} style={pop !== null ? delay(pop) : undefined}>
          {n.hl.customer ? <circle cx={n.x} cy={n.y} r={R + 6} fill="none" stroke="var(--vx-accent)" strokeWidth={3} /> : null}
          <circle
            cx={n.x}
            cy={n.y}
            r={R}
            fill={cluster ? "var(--vx-surface-2)" : "var(--vx-surface)"}
            stroke={recipient ? "var(--vx-accent)" : "var(--vx-line-strong)"}
            strokeWidth={recipient ? 2.5 : 1.5}
            strokeDasharray={cluster ? "4 4" : undefined}
          />
          <text x={n.x} y={n.y + f * 0.36} textAnchor="middle" fontSize={cluster ? f * 0.85 : f} fontWeight={600} fill="var(--vx-ink)">
            {cluster ? `+${n.count}` : initials(n.name)}
          </text>
          {label(n)}
        </g>
        {anim && recipient && n.hl.arrival ? (
          <circle cx={n.x} cy={n.y} r={R} fill="none" stroke="var(--vx-accent)" strokeWidth={3} className="vx-mg-ping" style={delay(n.hl.arrival - 60)} />
        ) : null}
        {badge > 0n ? (
          <g className={anim && n.hl.customer ? "vx-mg-pop" : undefined} style={anim && n.hl.customer ? delay(T_VENUE + 200) : undefined}>
            <rect x={bx} y={by} width={bw} height={bh} rx={bh / 2} fill="var(--vx-accent)" stroke="var(--vx-surface)" strokeWidth={2.5} />
            <text x={bx + bw / 2} y={by + bh / 2 + bf * 0.35} textAnchor="middle" fontSize={bf} fontWeight={600} fill="var(--vx-on-accent)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {btxt}
            </text>
          </g>
        ) : null}
      </g>
    );
  };

  const v = g.venue;
  const vAmount = net ? v.amount : v.hlAmount;
  const vLabelX = L ? v.x : v.x + v.side / 2 + 12;
  const vLabelY = L ? v.y + v.side / 2 + f * 1.15 : v.y - 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={title ?? g.summary}
      className={className}
      data-orientation={orientation}
      data-mode={mode}
      style={{ fontFamily: "var(--font-sans)", overflow: "visible" }}
    >
      <style>{CSS}</style>
      <g key={`${g.hlId ?? "none"}:${replayKey ?? ""}:${orientation}:${mode}`}>
        {g.edges.map(edgeEl)}
        <g>
          <rect x={v.x - v.side / 2} y={v.y - v.side / 2} width={v.side} height={v.side} rx={v.side * 0.28} fill="var(--vx-primary)" />
          <text x={v.x} y={v.y + f * 0.4} textAnchor="middle" fontSize={f * 1.1} fontWeight={600} fill="var(--vx-on-primary)">
            {initials(v.name)}
          </text>
          <g fontWeight={600} textAnchor={L ? "middle" : "start"}>
            <text x={vLabelX} y={vLabelY} fontSize={f} fill="var(--vx-ink)" {...halo}>
              {v.name}
            </text>
            {vAmount > 0n ? (
              <text x={vLabelX} y={vLabelY + f * 1.15} fontSize={f * 0.9} fill="var(--vx-primary-ink)" style={{ fontVariantNumeric: "tabular-nums" }} {...halo}>
                {formatMoney(vAmount)}
              </text>
            ) : null}
          </g>
        </g>
        {g.nodes.map(nodeEl)}
      </g>
    </svg>
  );
}
