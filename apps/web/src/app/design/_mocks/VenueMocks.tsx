"use client";

import { useState } from "react";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_URL, VOUCH_ARC_TESTNET, parseUsdc } from "@vouch/shared";
import { MoneyGraph, QrCode, type QRFrameState } from "@/components/ui";
import { OrderEntryScreen, OrderQRScreen, applyOrderKey, parseOrderEntry } from "@/screens/venue/OrderScreens";
import { VenueDashboardScreen, type LiveStatus, type VenueDashboardProps, type VenuePaymentItem } from "@/screens/venue/VenueDashboardScreen";
import { VenueOnboardingScreen, exampleSplit, validateMinOrder } from "@/screens/venue/VenueOnboardingScreen";
import { TransparencyScreen } from "@/screens/public/TransparencyScreen";
import { CANONICAL_PAYMENT_ID, NET_20, NET_5, NET_60, VENUE_NAME, type SeedPayment, type SeedVenue } from "./venueFixtures";

const RATE = 1500;

function ago(m: number) {
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / (24 * 60))} d`;
}

export function toPaymentItem(p: SeedPayment, fresh = false): VenuePaymentItem {
  return {
    id: p.id,
    customerName: p.customer,
    amount: p.amount,
    venueAmount: p.venueAmount,
    cashback: p.cashback,
    thankedAmount: p.thanked.reduce((a, t) => a + t.amount, 0n),
    thankedCount: new Set(p.thanked.map((t) => t.name)).size,
    firstVisit: p.firstVisit,
    time: ago(p.minutesAgo),
    fresh,
  };
}

function dashboardProps(net: SeedVenue, over: Partial<VenueDashboardProps> = {}): VenueDashboardProps {
  const payments = [...net.payments].reverse().map((p, i) => toPaymentItem(p, i === 0));
  return {
    venueName: VENUE_NAME,
    status: "live",
    stats: { verifiedCustomers: net.stats.verifiedCustomers, rewardsPaid: net.stats.rewardsPaid, costPerVerified: net.stats.costPerVerified },
    typicalAdCost: "20.00",
    payments,
    graph: net.data,
    highlightPaymentId: CANONICAL_PAYMENT_ID,
    graphMode: "payment",
    onNewOrder: () => {},
    transparencyHref: "/design/screens/transparency",
    ...over,
  };
}

function DashboardDemo({ net, layout, status = "live", mode = "payment", empty, loading, stats, viewer }: { net: SeedVenue; layout: "phone" | "wide"; status?: LiveStatus; mode?: "payment" | "network"; empty?: boolean; loading?: boolean; stats?: VenueDashboardProps["stats"]; viewer?: "owner" | "visitor" }) {
  const [ad, setAd] = useState("20.00");
  const [graphMode, setGraphMode] = useState<"payment" | "network">(mode);
  const base = dashboardProps(net, { status, layout, typicalAdCost: ad, onTypicalAdCostChange: setAd, graphMode, onGraphModeChange: setGraphMode, loading });
  const props = empty ? { ...base, payments: [], graph: undefined, stats: { verifiedCustomers: 0, rewardsPaid: 0n, costPerVerified: null } } : stats ? { ...base, stats } : base;
  return viewer === "visitor" ? <VenueDashboardScreen {...props} viewer="visitor" onNewOrder={undefined} onTypicalAdCostChange={undefined} /> : <VenueDashboardScreen {...props} />;
}

function OnboardingDemo({ variant }: { variant: "default" | "error" | "confirming" }) {
  const [name, setName] = useState("Lena's café");
  const [bps, setBps] = useState(RATE);
  const [min, setMin] = useState(variant === "error" ? "0.25" : "5.00");
  return (
    <VenueOnboardingScreen
      venueName={name}
      onVenueNameChange={setName}
      rewardBps={bps}
      onRewardBpsChange={setBps}
      minOrder={min}
      onMinOrderChange={setMin}
      minOrderError={validateMinOrder(min)}
      status={variant === "error" ? "error" : variant === "confirming" ? "confirming" : "idle"}
      error={variant === "error" ? "Couldn't save your place. Nothing was charged. Try again." : undefined}
      onConfirm={() => {}}
    />
  );
}

function OrderEntryDemo({ initial }: { initial: string }) {
  const [entry, setEntry] = useState(initial);
  const [label, setLabel] = useState(initial === "12.00" ? "Table 4" : "");
  const { amount, error } = parseOrderEntry(entry);
  return (
    <OrderEntryScreen
      venueName={VENUE_NAME}
      entry={entry}
      amount={amount}
      error={error}
      onKey={(k) => setEntry((e) => applyOrderKey(e, k))}
      label={label}
      onLabelChange={setLabel}
      rewardMinOrder={parseUsdc("5.00")}
      firstTimeCashback={exampleSplit(amount, RATE).cashback}
      onShowCode={() => {}}
      onBack={() => {}}
    />
  );
}

const ORDER_QR_PAYLOAD = "https://vouch.example/pay?o=eyJ2IjoxLCJ2ZW51ZSI6IjB4MTExMSIsImlkIjoiMHg4ZjJjNDEiLCJhbXQiOiIxMjAwMDAwMCJ9.sig";

function OrderQR({ state, secondsLeft = 102 }: { state: QRFrameState; secondsLeft?: number }) {
  const ben = NET_5.payments.at(-1)!;
  return (
    <OrderQRScreen
      venueName={VENUE_NAME}
      amount={parseUsdc("12.00")}
      orderLabel="Table 4"
      qr={<QrCode value={ORDER_QR_PAYLOAD} size={268} />}
      secondsLeft={secondsLeft}
      totalSeconds={120}
      state={state}
      autoRefresh
      paid={{
        customerName: "Ben",
        venueAmount: ben.venueAmount,
        cashback: ben.cashback,
        thankedAmount: ben.thanked.reduce((a, t) => a + t.amount, 0n),
        thankedCount: ben.thanked.length,
      }}
      onCancel={() => {}}
      onNext={() => {}}
      onRefresh={() => {}}
    />
  );
}

function GraphScreen({ net, mode }: { net: SeedVenue; mode: "payment" | "network" }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-4 lg:p-8">
      <p className="text-body-sm text-ink-3">
        {net.people} people · {net.payments.length} payments · highlighted: Ben&apos;s $12.00
      </p>
      <div className="mt-3 flex flex-1 items-center justify-center rounded-xl bg-surface p-3 shadow-1 ring-1 ring-line lg:p-6">
        <MoneyGraph data={net.data} mode={mode} highlightPaymentId={CANONICAL_PAYMENT_ID} orientation="portrait" className="h-auto w-full max-w-[420px] lg:hidden" />
        <MoneyGraph data={net.data} mode={mode} highlightPaymentId={CANONICAL_PAYMENT_ID} orientation="landscape" className="hidden h-auto max-h-[calc(100dvh-8rem)] w-full lg:block" />
      </div>
    </div>
  );
}

/** Renders a venue/public screen mock by id, or null if the id isn't a venue one. */
export function VenueMock({ id }: { id: string }) {
  switch (id) {
    case "venue-onboarding":
      return <OnboardingDemo variant="default" />;
    case "venue-onboarding-error":
      return <OnboardingDemo variant="error" />;
    case "venue-onboarding-confirming":
      return <OnboardingDemo variant="confirming" />;
    case "order-entry":
      return <OrderEntryDemo initial="12.00" />;
    case "order-entry-empty":
      return <OrderEntryDemo initial="" />;
    case "order-entry-error":
      return <OrderEntryDemo initial="0.25" />;
    case "order-qr":
      return <OrderQR state="live" />;
    case "order-qr-low":
      return <OrderQR state="live" secondsLeft={14} />;
    case "order-qr-processing":
      return <OrderQR state="processing" />;
    case "order-qr-expired":
      return <OrderQR state="expired" secondsLeft={0} />;
    case "order-qr-refreshing":
      return <OrderQR state="refreshing" secondsLeft={0} />;
    case "order-qr-paid":
      return <OrderQR state="paid" />;
    case "venue-dashboard":
      return <DashboardDemo net={NET_20} layout="phone" />;
    case "venue-dashboard-network":
      return <DashboardDemo net={NET_20} layout="phone" mode="network" />;
    case "venue-dashboard-visitor":
      return <DashboardDemo net={NET_20} layout="phone" viewer="visitor" />;
    case "venue-dashboard-cost-tiny":
      // MSG-101: most first visits came without a recommendation, so the cost per new customer is under a cent.
      return <DashboardDemo net={NET_20} layout="phone" stats={{ verifiedCustomers: 3, rewardsPaid: parseUsdc("0.02"), costPerVerified: 6_666n }} />;
    case "venue-dashboard-reconnecting":
      return <DashboardDemo net={NET_20} layout="phone" status="reconnecting" />;
    case "venue-dashboard-offline":
      return <DashboardDemo net={NET_20} layout="phone" status="offline" />;
    case "venue-dashboard-loading":
      return <DashboardDemo net={NET_20} layout="phone" status="connecting" loading />;
    case "venue-dashboard-empty":
      return <DashboardDemo net={NET_5} layout="phone" empty />;
    case "venue-dashboard-desktop":
      return <DashboardDemo net={NET_20} layout="wide" />;
    case "venue-dashboard-desktop-network":
      return <DashboardDemo net={NET_60} layout="wide" mode="network" />;
    case "venue-dashboard-desktop-empty":
      return <DashboardDemo net={NET_5} layout="wide" empty />;
    case "money-graph-5":
      return <GraphScreen net={NET_5} mode="payment" />;
    case "money-graph-20":
      return <GraphScreen net={NET_20} mode="network" />;
    case "money-graph-60":
      return <GraphScreen net={NET_60} mode="network" />;
    case "transparency":
      return (
        <TransparencyScreen
          venueName={VENUE_NAME}
          rewardBps={RATE}
          termsVersion={1}
          termsSince="Nov 18, 2026"
          example={{
            customer: "Ben",
            total: parseUsdc("12.00"),
            referrers: [
              { name: "Ana", weightBps: 7000, introducer: "Marco" },
              { name: "Priya", weightBps: 3000, introducer: "Sofia" },
            ],
          }}
          contractAddress={VOUCH_ARC_TESTNET.address}
          deployTx={VOUCH_ARC_TESTNET.deployTx}
          deployBlock={VOUCH_ARC_TESTNET.deployBlock}
          tokenAddress={VOUCH_ARC_TESTNET.usdc}
          explorerUrl={ARC_TESTNET_EXPLORER_URL}
          network="Arc Testnet"
          chainId={ARC_TESTNET_CHAIN_ID}
        />
      );
    default:
      return null;
  }
}
