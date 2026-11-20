"use client";

/**
 * /venue/<venue> — the owner's live dashboard: stats (/venues/:venue/stats), payment history (GET /venues/:venue/payments
 * when deployed, else the owner's GET /venues/:venue/orders settled rows), live `payment.settled` from the venue SSE,
 * and the money graph (stats.edges + one venue flow per payment). Cost per new customer vs a typical ad (local only).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { venueFlowsFromPayments, type MoneyFlow } from "@/components/ui";
import { VenueDashboardScreen } from "@/screens/venue/VenueDashboardScreen";
import { ApiError, api, money, type Settled, type VenueStats } from "@/lib/api";
import { FLAGS } from "@/lib/config";
import { rememberName, resolveNames } from "@/lib/names";
import { flowsFromEdges, paymentItem, recordFromFeed, recordFromSettled, type PaymentRecord } from "@/lib/views";
import { isVenueOwner, rememberVenue } from "@/lib/venueStore";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useToasts } from "@/hooks/useToasts";
import { formatMoney } from "@/design/money";
import { AccountGate, type AccountCtx } from "../../_components/AccountGate";

const AD_KEY = "vouch.typicalAdCost";

function useAdCost(): [string, (v: string) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(AD_KEY) ?? "20.00";
    } catch {
      return "20.00";
    }
  });
  return [
    v,
    (x: string) => {
      setV(x);
      try {
        localStorage.setItem(AD_KEY, x);
      } catch {
        /* ignore */
      }
    },
  ];
}

async function loadHistory(venue: string, owner: boolean): Promise<PaymentRecord[]> {
  if (FLAGS.venuePayments !== "off") {
    try {
      const r = await api.venuePayments(venue, 50);
      for (const p of r.payments) {
        rememberName(p.customer.address, p.customer.displayName);
        for (const x of p.rewards) rememberName(x.recipient.address, x.recipient.displayName);
      }
      return r.payments.map(recordFromFeed);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404 && e.code === "NOT_FOUND")) throw e;
    }
  }
  if (!owner) return [];
  // Fallback until the feed endpoint is deployed: this owner's orders that settled (newest 50).
  const { orders } = await api.ownerOrders(venue);
  return orders.filter((o) => o.settled).map((o) => recordFromSettled(o.settled as Settled));
}

function DashboardFlow({ venue, address }: { venue: string } & AccountCtx) {
  const router = useRouter();
  const toasts = useToasts();
  const [venueName, setVenueName] = useState("Your place");
  const [stats, setStats] = useState<VenueStats | null>(null);
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<"payment" | "network">("payment");
  const [adCost, setAdCost] = useAdCost();
  // QE-3-05: only the owner's session can take orders here (the api refuses others at POST /orders anyway).
  // null until known, so "Take an order" never flashes for a visitor.
  const [owner, setOwner] = useState<boolean | null>(null);

  const refreshStats = useCallback(async () => {
    const s = await api.venueStats(venue);
    setStats(s);
    for (const e of s.edges) {
      rememberName(e.from, e.fromDisplayName);
      rememberName(e.to, e.toDisplayName);
    }
    return s;
  }, [venue]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await api.venue(venue);
        if (!alive) return;
        setVenueName(v.name ?? "Your place");
        const owner = await isVenueOwner(venue, v.owner, address);
        if (!alive) return;
        setOwner(owner);
        if (owner) rememberVenue(address, venue);
        const [s, hist] = await Promise.all([refreshStats(), loadHistory(venue, owner).catch(() => [])]);
        if (!alive) return;
        setRecords(hist);
        const n = await resolveNames([...s.edges.flatMap((e) => [e.from, e.to]), ...hist.map((h) => h.customer)]);
        if (alive) setNames(n);
      } catch {
        if (alive) toasts.push({ tone: "warning", key: "dash", title: "We can't reach Kudos right now.", description: "Your numbers are safe. We'll keep trying." });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [venue, address, refreshStats, toasts]);

  const { status } = useLiveEvents({ kind: "venue", id: venue }, (ev, data) => {
    if (ev !== "payment.settled") return;
    const r = recordFromSettled(data as unknown as Settled);
    setRecords((xs) => [r, ...xs.filter((x) => x.orderId !== r.orderId)]);
    setFresh(r.orderId);
    void refreshStats().catch(() => {});
    void resolveNames([r.customer, ...r.flows.flatMap((f) => [f.from, f.to])]).then((n) => setNames((m) => ({ ...m, ...n })));
    if (r.flows.some((f) => f.level === 1)) toasts.push({ tone: "success", title: "A recommendation paid off", description: `${formatMoney(r.amount)} first visit`, ms: 4000 });
  });

  // Money graph: reward flows (stats edges, plus live payments not yet in stats) + one venue flow per payment.
  const graph = useMemo(() => {
    const edgeFlows = stats ? flowsFromEdges(stats.edges) : [];
    const seen = new Set(edgeFlows.map((f) => f.paymentId));
    const liveFlows = records.filter((r) => !seen.has(r.orderId)).flatMap((r) => r.flows);
    const venueFlows = venueFlowsFromPayments(venue, records.map((r) => ({ orderId: r.orderId, customer: r.customer, venueAmount: r.venueAmount })));
    const oldestFirst = [...records].reverse().map((r) => r.orderId);
    const rank = new Map(oldestFirst.map((id, i) => [id, i]));
    const all: MoneyFlow[] = [...edgeFlows, ...liveFlows, ...venueFlows];
    const order = (f: MoneyFlow) => rank.get(f.paymentId.toLowerCase()) ?? -1;
    all.sort((a, b) => order(a) - order(b));
    if (!all.length) return undefined;
    return { venue: { id: venue, name: venueName }, flows: all, names };
  }, [stats, records, venue, venueName, names]);

  const firstSales = records.filter((r) => r.firstVisit && r.flows.length).reduce((a, r) => a + r.amount, 0n);

  return (
    <VenueDashboardScreen
      venueName={venueName}
      status={status}
      stats={{
        verifiedCustomers: stats?.verifiedCustomers ?? 0,
        rewardsPaid: stats ? money(stats.rewardsPaid) : 0n,
        // No reward paid yet → no meaningful cost per customer (avoids a "$0.00 vs ad" comparison).
        costPerVerified: stats?.costPerVerifiedCustomer && money(stats.rewardsPaid) > 0n ? money(stats.costPerVerifiedCustomer) : null,
        salesFromRecommendations: firstSales > 0n ? firstSales : undefined,
      }}
      typicalAdCost={adCost}
      onTypicalAdCostChange={owner ? setAdCost : undefined}
      payments={records.map((r) => paymentItem(r, names, r.orderId === fresh))}
      graph={graph}
      highlightPaymentId={fresh ?? records[0]?.orderId}
      graphMode={graphMode}
      onGraphModeChange={setGraphMode}
      loading={loading}
      onNewOrder={owner ? () => router.push(`/venue/${venue}/counter`) : undefined}
      transparencyHref={`/transparency?venue=${venue}`}
      viewer={owner ? "owner" : "visitor"}
    />
  );
}

export function Dashboard() {
  const { venue } = useParams<{ venue: string }>();
  return <AccountGate>{(ctx) => <DashboardFlow venue={venue} {...ctx} />}</AccountGate>;
}

