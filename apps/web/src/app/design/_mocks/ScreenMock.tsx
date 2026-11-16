"use client";

import { useState } from "react";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_URL, ARC_TESTNET_USDC_ADDRESS, parseUsdc } from "@vouch/shared";
import { QrCode, type KeypadKey } from "@/components/ui";
import { STORY, STORY_GRAPH, STORY_SPLIT } from "@/design/fixtures";
import { AmbassadorScreen } from "@/screens/customer/AmbassadorScreen";
import { IntroLandingScreen } from "@/screens/customer/IntroLandingScreen";
import { PayConfirmMock } from "@/screens/customer/PayConfirm";
import { PaymentSuccessScreen } from "@/screens/customer/PaymentSuccessScreen";
import { RecommendScreen, type LinkKind } from "@/screens/customer/RecommendScreen";
import { ScanScreen } from "@/screens/customer/ScanScreen";
import { SignInScreen } from "@/screens/customer/SignInScreen";
import { WalletHomeScreen } from "@/screens/customer/WalletHomeScreen";
import { OrderEntryScreen, OrderQRScreen } from "@/screens/venue/OrderScreens";
import { VenueDashboardDesktop, VenueDashboardScreen, type VenueDashboardProps } from "@/screens/venue/VenueDashboardScreen";
import { VenueOnboardingScreen, exampleSplit } from "@/screens/venue/VenueOnboardingScreen";
import { TransparencyScreen } from "@/screens/public/TransparencyScreen";

const usd = parseUsdc;
const P = STORY.parts;

const DASHBOARD: VenueDashboardProps = {
  venueName: STORY.venue.name,
  verifiedCustomers: 23,
  costPerVerified: usd("1.80"),
  rewardsPaid: usd("41.40"),
  salesFromRecommendations: usd("276.00"),
  graph: STORY_GRAPH,
  feed: [
    { id: "1", who: "Ben", title: "Ben, first visit", meta: "Paid $12.00 · 5 people thanked · now", amount: P.venue, kind: "sale", fresh: true },
    { id: "2", who: "Ana", title: "Ana recommended Ben", meta: "Recommender · now", amount: P.ana, kind: "reward", fresh: true },
    { id: "3", who: "Priya", title: "Priya recommended Ben", meta: "Recommender · now", amount: P.priya, kind: "reward", fresh: true },
    { id: "4", who: "Marco", title: "Marco brought Ana in", meta: "Introducer · now", amount: P.marco, kind: "reward" },
    { id: "5", who: "Chloe", title: "Chloe, first visit", meta: "Paid $8.50 · 2 people thanked · 9:12", amount: usd("7.23"), kind: "sale" },
  ],
};

const ORDER_QR_PAYLOAD =
  "vouch:order?v=1&venue=0x1111111111111111111111111111111111111111&id=0x8f2c41&amt=12000000&exp=1800000000&sig=0x" + "ab".repeat(65);

function PayConfirmDemo() {
  const [who, setWho] = useState<string | null>("Ana");
  return (
    <PayConfirmMock
      venueName={STORY.venue.name}
      orderLabel="Order A-1042 · Counter 1"
      amount={STORY.total}
      cashback={P.cashback}
      split={STORY_SPLIT}
      recommenders={["Ana", "Priya"]}
      whoSentYou={who}
      onWhoSentYouChange={setWho}
      onCancel={() => {}}
      details={{ networkFee: "$0.01", network: `Arc Testnet (${ARC_TESTNET_CHAIN_ID})`, orderId: "0x8f2c41…a90e" }}
    />
  );
}

function RecommendDemo() {
  const [kind, setKind] = useState<LinkKind>("personal");
  const [note, setNote] = useState("Best cortado in the neighbourhood");
  return (
    <RecommendScreen
      yourName="Ana"
      venueName={STORY.venue.name}
      exampleEarn={{ order: STORY.total, earn: STORY.l1Total }}
      kind={kind}
      onKindChange={setKind}
      note={note}
      onNoteChange={setNote}
      linkPreview={kind === "personal" ? "vouch.app/r/ana-for-ben" : "vouch.app/r/lenas-cafe-ana"}
    />
  );
}

function VenueOnboardingDemo() {
  const [bps, setBps] = useState<number>(STORY.venue.rewardBps);
  const [min, setMin] = useState("5.00");
  return (
    <VenueOnboardingScreen
      venueName={STORY.venue.name}
      rewardBps={bps}
      onRewardBpsChange={setBps}
      exampleOrder={STORY.total}
      minOrder={min}
      onMinOrderChange={setMin}
    />
  );
}

function OrderEntryDemo() {
  const [entry, setEntry] = useState("12.00");
  let amount = 0n;
  let error: string | undefined;
  try {
    amount = entry ? parseUsdc(entry) : 0n;
    if (entry.split(".")[1]?.length > 2) error = "Use dollars and cents";
  } catch {
    error = "Use dollars and cents";
  }
  const onKey = (k: KeypadKey) =>
    setEntry((e) => (k === "back" ? e.slice(0, -1) : k === "." && e.includes(".") ? e : (e + k).replace(/^0(?=\d)/, "")));
  return (
    <OrderEntryScreen
      venueName={STORY.venue.name}
      entry={entry}
      amount={error ? 0n : amount}
      error={error}
      onKey={onKey}
      firstTimeCashback={exampleSplit(amount, STORY.venue.rewardBps).cashback}
    />
  );
}

export function ScreenMock({ id }: { id: string }) {
  switch (id) {
    case "sign-in":
      return <SignInScreen invite={{ referrerName: "Ana", venueName: STORY.venue.name }} />;
    case "intro":
      return (
        <IntroLandingScreen
          referrerName="Ana"
          venueName={STORY.venue.name}
          venueMeta="Café · 2 blocks away · open until 6"
          note="Best cortado in the neighbourhood. Ask Lena for the cardamom bun."
          example={{ order: STORY.total, cashback: P.cashback }}
        />
      );
    case "wallet":
      return (
        <WalletHomeScreen
          name="Ben"
          balance={usd("38.45")}
          earnedThisWeek={P.cashback}
          canRecommend={{ venueName: STORY.venue.name }}
          activity={[
            { id: "a", title: STORY.venue.name, meta: "Today, 9:41 · first visit", amount: -STORY.total, note: "+$0.45 back", kind: "payment" },
            { id: "b", title: "Welcome cashback", meta: `Today, 9:41 · ${STORY.venue.name}`, amount: P.cashback, kind: "cashback", avatarName: "Lena's café" },
            { id: "c", title: "Top up (testnet demo)", meta: "Yesterday · simulated", amount: usd("50.00"), kind: "topup", avatarName: "Top up" },
          ]}
        />
      );
    case "scan":
      return <ScanScreen />;
    case "pay-confirm":
      return <PayConfirmDemo />;
    case "success":
      return (
        <PaymentSuccessScreen
          venueName={STORY.venue.name}
          amount={STORY.total}
          cashback={P.cashback}
          split={STORY_SPLIT}
          thanked={["Ana", "Priya"]}
          onRecommend={() => {}}
        />
      );
    case "recommend":
      return <RecommendDemo />;
    case "ambassador":
      return (
        <AmbassadorScreen
          name="Ana"
          verifiedCustomers={14}
          venueCount={5}
          earned={usd("18.40")}
          recordId="0x0000…0000 (placeholder until deploy)"
          venues={[
            { name: STORY.venue.name, meta: "Café", customers: 6, earned: usd("4.86") },
            { name: "Northside Barbers", meta: "Barber", customers: 3, earned: usd("6.30") },
            { name: "Bloom Salon", meta: "Salon", customers: 2, earned: usd("5.10") },
            { name: "Kiln Bakery", meta: "Bakery", customers: 2, earned: usd("1.14") },
            { name: "Oak Street Books", meta: "Bookshop", customers: 1, earned: usd("1.00") },
          ]}
        />
      );
    case "venue-onboarding":
      return <VenueOnboardingDemo />;
    case "order-entry":
      return <OrderEntryDemo />;
    case "order-qr":
      return (
        <OrderQRScreen
          venueName={STORY.venue.name}
          amount={STORY.total}
          orderLabel="Order A-1042"
          qr={<QrCode value={ORDER_QR_PAYLOAD} size={260} />}
          secondsLeft={102}
          totalSeconds={120}
          state="live"
        />
      );
    case "venue-dashboard":
      return <VenueDashboardScreen {...DASHBOARD} />;
    case "venue-dashboard-desktop":
      return <VenueDashboardDesktop {...DASHBOARD} />;
    case "transparency":
      return (
        <TransparencyScreen
          venueName={STORY.venue.name}
          rewardBps={STORY.venue.rewardBps}
          termsVersion={1}
          termsSince="Nov 16, 2026"
          example={{
            total: STORY.total,
            parts: STORY_SPLIT.map((p) => (p.id === "you" ? { ...p, label: "Ben", reason: "welcome cashback (25%)" } : p.role === "referrer" ? { ...p, reason: `${p.reason} (55% × ${p.id === "ana" ? "70" : "30"}%)` } : p.role === "introducer" ? { ...p, reason: `${p.reason} (20% × ${p.id === "marco" ? "70" : "30"}%)` } : { ...p, reason: "sale − rewards" })),
          }}
          contractAddress="0x0000000000000000000000000000000000000000"
          tokenAddress={ARC_TESTNET_USDC_ADDRESS}
          explorerUrl={ARC_TESTNET_EXPLORER_URL}
          network={`Arc Testnet · chain ${ARC_TESTNET_CHAIN_ID}`}
        />
      );
    default:
      return <p className="p-6">Unknown screen: {id}</p>;
  }
}

