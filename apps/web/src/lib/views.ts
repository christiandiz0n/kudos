/**
 * Adapters: API JSON → props-only screen inputs (bigint money, names instead of addresses, no jargon).
 */
import { formatMoney } from "@/design/money";
import { moneyFlowsFromEdges, type MoneyFlow, type SplitPart } from "@/components/ui";
import type { NoRewardReason } from "@/screens/customer/PayConfirm";
import type { ActivityItem } from "@/screens/customer/WalletHomeScreen";
import type { VenuePaymentItem } from "@/screens/venue/VenueDashboardScreen";
import { api, money, type ActivityItemJson, type MoneyEdge, type QuoteRes, type Settled, type VenuePayment } from "./api";
import { nameOr } from "./names";

// ------------------------------------------------------------------------------------------------ venue names
const venueNames = new Map<string, string>();
const venueInflight = new Map<string, Promise<string>>();
export function rememberVenueName(v: string, name: string | null | undefined) {
  if (name) venueNames.set(v.toLowerCase(), name);
}
export function cachedVenueName(v: string): string | null {
  return venueNames.get(v.toLowerCase()) ?? null;
}
export async function venueName(v: string): Promise<string> {
  const k = v.toLowerCase();
  const hit = venueNames.get(k);
  if (hit) return hit;
  if (!venueInflight.has(k)) {
    venueInflight.set(
      k,
      api
        .venue(v)
        .then((x) => x.name || "A local place")
        .catch(() => "A local place")
        .then((n) => {
          venueNames.set(k, n);
          venueInflight.delete(k);
          return n;
        }),
    );
  }
  return venueInflight.get(k)!;
}

// ------------------------------------------------------------------------------------------------ time
export function relTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "Just now";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ------------------------------------------------------------------------------------------------ split parts
/** Pay-sheet preview from the quote (who gets what, by name). */
export function splitFromQuote(q: QuoteRes, venue: string, names: Record<string, string>): SplitPart[] {
  const parts: SplitPart[] = [{ id: "venue", label: venue, amount: money(q.quote.venueAmount), role: "venue" }];
  for (const r of q.quote.rewards) {
    if (r.role === "cashback") parts.push({ id: "you", label: "You", amount: money(r.amount), role: "you", reason: "First-visit money back" });
    else if (r.role === "referrer")
      parts.push({ id: `l1-${r.recipient}`, label: nameOr(names, r.recipient), amount: money(r.amount), role: "referrer", reason: "Recommended you" });
    else if (!r.returnsToVenue && r.recipient)
      parts.push({ id: `l2-${r.recipient}-${r.via}`, label: nameOr(names, r.recipient), amount: money(r.amount), role: "introducer", reason: `Brought ${nameOr(names, r.via)} in` });
  }
  return parts.filter((p) => p.role === "venue" || p.amount > 0n);
}

/** Receipt from the settled payment (Streams truth). */
export function splitFromSettled(s: Settled, venue: string, me: string | null, names: Record<string, string>): SplitPart[] {
  const parts: SplitPart[] = [{ id: "venue", label: venue, amount: money(s.venueAmount), role: "venue" }];
  for (const l of s.lines) {
    if (l.returned || money(l.amount) === 0n) continue;
    if (l.role === "cashback")
      parts.push({ id: me && l.recipient.toLowerCase() === me.toLowerCase() ? "you" : `c-${l.recipient}`, label: me && l.recipient.toLowerCase() === me.toLowerCase() ? "You" : nameOr(names, l.recipient), amount: money(l.amount), role: "you", reason: "First-visit money back" });
    else if (l.role === "referrer") parts.push({ id: `l1-${l.recipient}`, label: nameOr(names, l.recipient), amount: money(l.amount), role: "referrer", reason: "Recommended you" });
    else parts.push({ id: `l2-${l.recipient}-${l.viaReferrer}`, label: nameOr(names, l.recipient), amount: money(l.amount), role: "introducer", reason: `Brought ${nameOr(names, l.viaReferrer)} in` });
  }
  return parts;
}

export function cashbackOf(s: Settled): bigint {
  return s.lines.filter((l) => l.role === "cashback" && !l.returned).reduce((a, l) => a + money(l.amount), 0n);
}

/** Recommenders this purchase thanked (L1 names, in order, no duplicates). */
export function thankedFrom(lines: { role: string; recipient: string | null; returned?: boolean }[], names: Record<string, string>): string[] {
  const out: string[] = [];
  for (const l of lines) if (l.role === "referrer" && l.recipient && !l.returned) out.push(nameOr(names, l.recipient));
  return [...new Set(out)];
}

/**
 * Why a payment carries no money back (QE-3-03, MSG-100 #1), for the pay sheet AND the success screen, so a first
 * visit without a recommendation never reads as "Thanks for coming back".
 *   repeat           → already a verified customer here (attribution is null / firstPurchase false)
 *   noRecommendation → first visit, nobody recommended this place (quote warning first_purchase_without_recommendation)
 *   belowMinimum     → first visit with recommendations, but none eligible (below the venue's minimum order, D-509)
 * Without quote warnings (a settled payment only), the minimum decides between the last two.
 */
export function noRewardReason(p: {
  rewarded: boolean;
  firstPurchase: boolean;
  /** QuoteRes.attribution: null means the customer is already verified here (the API skips attribution). */
  attribution?: QuoteRes["attribution"];
  warnings?: string[];
  amount?: bigint;
  minOrder?: bigint;
}): NoRewardReason | undefined {
  if (p.rewarded) return undefined;
  if (!p.firstPurchase || p.attribution === null) return "repeat";
  if (p.warnings?.includes("first_purchase_without_recommendation")) return "noRecommendation";
  if (p.warnings?.includes("no_eligible_recommendation")) return "belowMinimum";
  if (p.minOrder !== undefined && p.amount !== undefined && p.amount < p.minOrder) return "belowMinimum";
  return "noRecommendation";
}

/** Addresses we'd like names for, from a settled payment. */
export function addressesIn(s: Settled): string[] {
  return [s.customer, ...s.lines.flatMap((l) => [l.recipient, l.viaReferrer])].filter((a) => a && !/^0x0+$/.test(a));
}

// ------------------------------------------------------------------------------------------------ wallet activity
export function activityItems(items: ActivityItemJson[], me: string, names: Record<string, string>, venues: Record<string, string>): ActivityItem[] {
  const vn = (v: string) => venues[v.toLowerCase()] ?? "A local place";
  const out: ActivityItem[] = [];
  for (const it of items) {
    if (it.kind === "payment" && it.status === "pending") {
      out.push({ id: `p-${it.intentId}`, title: vn(it.venue), meta: "Just now", amount: -money(it.amount), kind: "payment", status: "pending", avatarName: vn(it.venue) });
    } else if (it.kind === "payment") {
      const p = it.payment;
      if (p.customer.toLowerCase() !== me.toLowerCase()) continue;
      const back = p.lines.filter((l) => l.role === "cashback" && !l.returned && l.recipient.toLowerCase() === me.toLowerCase()).reduce((a, l) => a + money(l.amount), 0n);
      const thanked = thankedFrom(p.lines, names);
      out.push({
        id: `s-${p.txHash}-${p.orderId}`,
        title: vn(p.venue),
        meta: thanked.length ? `${relTime(it.blockTime)} · thanked ${thanked.join(" and ")}` : relTime(it.blockTime),
        amount: -money(p.amount),
        note: back > 0n ? `${formatMoney(back, { showPlus: true })} back` : undefined,
        kind: "payment",
        avatarName: vn(p.venue),
      });
    } else if (it.kind === "reward") {
      const r = it.reward;
      if (r.returned || money(r.amount) === 0n) continue;
      const customer = nameOr(names, r.customer, "A friend");
      const title = r.role === "introducer" ? `${nameOr(names, r.viaReferrer)} brought ${customer} in` : `${customer} came on your recommendation`;
      out.push({ id: `r-${r.txHash}-${r.recipient}-${r.roleId}-${r.viaReferrer}`, title, meta: `${vn(r.venue)} · ${relTime(it.blockTime)}`, amount: money(r.amount), kind: "reward", avatarName: customer });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ venue feed + graph
/** Short clock for feed rows: "now", "2 min", "9:41". */
export function shortTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "now";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export interface PaymentRecord {
  orderId: string;
  customer: string;
  amount: bigint;
  venueAmount: bigint;
  cashback: bigint;
  firstVisit: boolean;
  time: number | null;
  /** Reward flows of this payment (level 1/2 + cashback), for the money graph. */
  flows: MoneyFlow[];
}

/** One settled payment (SSE `payment.settled` or GET /payments, /orders) → record + graph flows. */
export function recordFromSettled(s: Settled): PaymentRecord {
  const flows: MoneyFlow[] = [];
  for (const l of s.lines) {
    if (l.returned) continue;
    if (l.role === "cashback") flows.push({ paymentId: s.orderId, from: s.customer, to: s.customer, level: "cashback", amount: money(l.amount) });
    else if (l.role === "referrer") flows.push({ paymentId: s.orderId, from: s.customer, to: l.recipient, level: 1, amount: money(l.amount) });
    else flows.push({ paymentId: s.orderId, from: l.viaReferrer, to: l.recipient, level: 2, amount: money(l.amount) });
  }
  return { orderId: s.orderId.toLowerCase(), customer: s.customer, amount: money(s.amount), venueAmount: money(s.venueAmount), cashback: cashbackOf(s), firstVisit: s.firstPurchase, time: s.blockTime, flows };
}

/** GET /venues/:venue/payments row (D-811) → record. L2 rows carry no `via`, so the graph uses stats edges for them. */
export function recordFromFeed(p: VenuePayment): PaymentRecord {
  return {
    orderId: p.orderId.toLowerCase(),
    customer: p.customer.address,
    amount: money(p.amount),
    venueAmount: money(p.venueReceived),
    cashback: money(p.cashback),
    firstVisit: p.firstPurchase,
    time: p.settledAt ? Math.floor(Date.parse(p.settledAt) / 1000) : null,
    flows: [],
  };
}

export function paymentItem(r: PaymentRecord, names: Record<string, string>, fresh = false): VenuePaymentItem {
  const thanked = r.flows.filter((f) => f.level === 1 || f.level === 2);
  return {
    id: r.orderId,
    customerName: nameOr(names, r.customer, "A customer"),
    amount: r.amount,
    venueAmount: r.venueAmount,
    cashback: r.cashback,
    thankedAmount: thanked.reduce((a, f) => a + f.amount, 0n),
    thankedCount: new Set(thanked.map((f) => f.to.toLowerCase())).size,
    firstVisit: r.firstVisit,
    time: shortTime(r.time),
    fresh,
  };
}

/** stats.edges → flows (bigint), via UI-venue's adapter. */
export function flowsFromEdges(edges: MoneyEdge[]): MoneyFlow[] {
  return moneyFlowsFromEdges(edges.map((e) => ({ orderId: e.orderId.toLowerCase(), from: e.from, to: e.to, role: e.role, amount: money(e.amount) })));
}
