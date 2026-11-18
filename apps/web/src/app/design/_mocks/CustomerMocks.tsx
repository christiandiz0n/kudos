"use client";

/**
 * Customer screen mocks for /design (UI-customer, Phase 3). Canonical story props only; each state the
 * app can reach has its own id (see meta.customer.ts). Returns null for ids it doesn't own.
 */
import { useState, type ReactNode } from "react";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_EXPLORER_URL, parseUsdc } from "@vouch/shared";
import { Toast, ToastViewport } from "@/components/ui";
import { STORY, STORY_SPLIT } from "@/design/fixtures";
import { AmbassadorScreen } from "@/screens/customer/AmbassadorScreen";
import { IntroLandingScreen, type IntroLandingState } from "@/screens/customer/IntroLandingScreen";
import { PayConfirmMock, type PayConfirmProps } from "@/screens/customer/PayConfirm";
import type { PayProblem } from "@/screens/customer/PayProblem";
import { PaymentSuccessScreen } from "@/screens/customer/PaymentSuccessScreen";
import { RecommendScreen, type LinkKind, type RecommendScreenProps } from "@/screens/customer/RecommendScreen";
import { ScanScreen, type CameraState } from "@/screens/customer/ScanScreen";
import { SignInScreen } from "@/screens/customer/SignInScreen";
import { WalletHomeScreen, type ActivityItem, type WalletHomeScreenProps } from "@/screens/customer/WalletHomeScreen";

const usd = parseUsdc;
const P = STORY.parts;
const VENUE = STORY.venue.name;

const ACTIVITY: ActivityItem[] = [
  { id: "p0", title: "Kiln Bakery", meta: "Just now · sending", amount: -usd("4.50"), kind: "payment", status: "pending" },
  { id: "p1", title: VENUE, meta: "Today, 9:41 · first visit", amount: -STORY.total, note: "+$0.45 back", kind: "payment" },
  { id: "r2", title: "Ana brought Chloe in", meta: "Today, 8:15 · Kiln Bakery", amount: usd("0.21"), kind: "reward", avatarName: "Chloe" },
  { id: "r1", title: "Chloe came on your recommendation", meta: "Yesterday · Kiln Bakery", amount: usd("0.62"), kind: "reward", avatarName: "Chloe" },
  { id: "t1", title: "Top up (testnet demo)", meta: "Yesterday · simulated", amount: usd("50.00"), kind: "topup" },
];

const WALLET: WalletHomeScreenProps = {
  name: "Ben",
  balance: usd("34.57"),
  earnedThisWeek: P.cashback + usd("0.62") + usd("0.21"),
  canRecommend: { venueName: VENUE },
  activity: ACTIVITY,
};

const PAY_BASE: Omit<PayConfirmProps, "whoSentYou" | "onWhoSentYouChange"> = {
  venueName: VENUE,
  orderLabel: "Order A-1042 · Counter 1",
  amount: STORY.total,
  cashback: P.cashback,
  split: STORY_SPLIT,
  recommenders: ["Ana", "Priya"],
  balance: usd("46.57"),
  onCancel: () => {},
  details: { networkFee: "$0.01", network: `Arc Testnet (${ARC_TESTNET_CHAIN_ID})`, orderId: "0x8f2c41…a90e" },
};

function PayDemo(over: Partial<PayConfirmProps> & { backdrop?: "scanner" | "pay" }) {
  const [who, setWho] = useState<string | null>("Ana");
  return <PayConfirmMock {...PAY_BASE} whoSentYou={who} onWhoSentYouChange={setWho} {...over} />;
}

function payProblem(problem: PayProblem): ReactNode {
  return <PayDemo problem={problem} />;
}

function SignInDemo({ error }: { error?: "cancelled" }) {
  const [name, setName] = useState("Ben");
  return <SignInScreen invite={{ referrerName: "Ana", venueName: VENUE }} name={name} onNameChange={setName} error={error} />;
}

function ScanDemo({ cameraState, manualOpen, error }: { cameraState?: CameraState; manualOpen?: boolean; error?: string }) {
  const [value, setValue] = useState(manualOpen ? "vouch.app/o/lena-a1042" : "");
  return (
    <ScanScreen
      cameraState={cameraState}
      manualOpen={manualOpen}
      manual={{ value, onChange: setValue, onSubmit: () => {}, error }}
    />
  );
}

function RecommendDemo(over: Partial<RecommendScreenProps>) {
  const [kind, setKind] = useState<LinkKind>("personal");
  const [note, setNote] = useState("Best cortado in the neighbourhood");
  return (
    <RecommendScreen
      yourName="Ana"
      venueName={VENUE}
      exampleEarn={{ order: STORY.total, earn: STORY.l1Total }}
      kind={kind}
      onKindChange={setKind}
      note={note}
      onNoteChange={setNote}
      {...over}
    />
  );
}

const RECEIPT_DETAILS = {
  receiptId: "0x2de2…8214",
  network: `Arc Testnet (${ARC_TESTNET_CHAIN_ID})`,
  networkFee: "$0.01",
  explorerUrl: ARC_TESTNET_EXPLORER_URL,
};

function intro(state?: IntroLandingState) {
  return (
    <IntroLandingScreen
      referrerName="Ana"
      venueName={VENUE}
      venueMeta="Café · 2 blocks away · open until 6"
      note="Best cortado in the neighbourhood. Ask Lena for the cardamom bun."
      example={{ order: STORY.total, cashback: P.cashback }}
      lockedSince="Nov 18"
      state={state}
    />
  );
}

export function CustomerMock({ id }: { id: string }): ReactNode {
  switch (id) {
    case "sign-in":
      return <SignInDemo />;
    case "sign-in-error":
      return <SignInDemo error="cancelled" />;

    case "wallet":
      return <WalletHomeScreen {...WALLET} />;
    case "wallet-loading":
      return <WalletHomeScreen {...WALLET} loading />;
    case "wallet-empty":
      return <WalletHomeScreen name="Ben" balance={0n} activity={[]} />;
    case "wallet-offline":
      return <WalletHomeScreen {...WALLET} offline />;
    case "wallet-toast":
      return (
        <>
          <WalletHomeScreen {...WALLET} />
          <ToastViewport>
            <Toast tone="success" title="Chloe came on your recommendation" description="+$0.62 just arrived" onDismiss={() => {}} />
          </ToastViewport>
        </>
      );

    case "scan":
      return <ScanDemo />;
    case "scan-manual":
      return <ScanDemo manualOpen />;
    case "scan-denied":
      return <ScanDemo cameraState="denied" />;

    case "pay-confirm":
      return <PayDemo />;
    case "pay-quoting":
      return <PayDemo quoting />;
    case "pay-repeat":
      return <PayDemo cashback={0n} split={undefined} noReward="repeat" />;
    case "pay-insufficient":
      return <PayDemo balance={usd("3.20")} />;
    case "pay-expired":
      return payProblem("expired");
    case "pay-unavailable":
      return payProblem("unavailable");
    case "pay-failed":
      return payProblem("failed");
    case "pay-cancelled":
      return payProblem("cancelled");
    case "pay-offline":
      return payProblem("offline");
    case "pay-invalid-link":
      return payProblem("invalidLink");
    case "pay-below-minimum":
      return <PayDemo amount={usd("3.00")} cashback={0n} split={undefined} noReward="belowMinimum" minOrder={usd("5.00")} />;
    case "pay-no-recommendation":
      return <PayDemo cashback={0n} split={undefined} recommenders={[]} noReward="noRecommendation" />;
    case "pay-backdrop":
      return <PayDemo backdrop="pay" />;

    case "success-pending":
    case "success":
      return (
        <PaymentSuccessScreen
          status={id === "success" ? "settled" : "pending"}
          venueName={VENUE}
          amount={STORY.total}
          cashback={P.cashback}
          split={STORY_SPLIT}
          thanked={["Ana", "Priya"]}
          details={RECEIPT_DETAILS}
          onRecommend={() => {}}
        />
      );

    case "success-first-visit":
    case "success-below-minimum":
    case "success-repeat":
      return (
        <PaymentSuccessScreen
          venueName={VENUE}
          amount={id === "success-below-minimum" ? usd("3.00") : STORY.total}
          cashback={0n}
          noReward={id === "success-first-visit" ? "noRecommendation" : id === "success-below-minimum" ? "belowMinimum" : "repeat"}
          minOrder={usd("5.00")}
          details={RECEIPT_DETAILS}
          onRecommend={id === "success-repeat" ? undefined : () => {}}
        />
      );

    case "intro":
      return intro();
    case "intro-accepted":
      return intro("accepted");
    case "intro-expired":
      return intro("expired");
    case "intro-already-customer":
      return intro("alreadyCustomer");

    case "recommend":
      return <RecommendDemo />;
    case "recommend-link":
      return <RecommendDemo link={{ url: "https://vouch.app/r/ana-for-ben-7Kq2", display: "vouch.app/r/ana-for-ben-7Kq2" }} canShare />;
    case "recommend-locked":
      return <RecommendDemo yourName="Ben" locked />;

    case "ambassador":
      return (
        <AmbassadorScreen
          name="Ana"
          verifiedCustomers={14}
          venueCount={5}
          earned={usd("18.40")}
          recordId="0x0000…0000 (placeholder until deploy)"
          onShare={() => {}}
          onBack={() => {}}
          venues={[
            { name: VENUE, meta: "Café", customers: 6, earned: usd("4.86") },
            { name: "Northside Barbers", meta: "Barber", customers: 3, earned: usd("6.30") },
            { name: "Bloom Salon", meta: "Salon", customers: 2, earned: usd("5.10") },
            { name: "Kiln Bakery", meta: "Bakery", customers: 2, earned: usd("1.14") },
            { name: "Oak Street Books", meta: "Bookshop", customers: 1, earned: usd("1.00") },
          ]}
        />
      );
    default:
      return null;
  }
}
