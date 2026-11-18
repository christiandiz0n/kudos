"use client";

/**
 * /pay?v=<venue>&o=<orderId> — what a scanned counter QR opens (in-app scanner or the phone's native camera).
 * order (public) → quote → ONE signature (USDC ReceiveWithAuthorization, Face ID / fingerprint) → POST /payments →
 * "pending" (relay response, optimistic) → "settled" ONLY from Streams (user SSE `payment.settled`, polling fallback).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAddress, type Address, type Hex } from "viem";
import { explorerTxUrl } from "@vouch/shared";
import { Screen } from "@/components/ui";
import { PayConfirmSheet, type NoRewardReason } from "@/screens/customer/PayConfirm";
import type { PayProblem } from "@/screens/customer/PayProblem";
import { PaymentSuccessScreen } from "@/screens/customer/PaymentSuccessScreen";
import { ApiError, api, money, type QuoteRes, type Settled } from "@/lib/api";
import { getSigner, WalletError } from "@/lib/wallet";
import { assertSafePaymentTypedData, signTypedDataJson } from "@/lib/sign";
import { resolveNames } from "@/lib/names";
import { addressesIn, cashbackOf, splitFromQuote, splitFromSettled, thankedFrom, rememberVenueName } from "@/lib/views";
import { recordTiming } from "@/lib/timings";
import { demoTopup } from "@/lib/topup";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useToasts } from "@/hooks/useToasts";
import type { AccountCtx } from "../_components/AccountGate";

const RETRYABLE = new Set(["RELAYER_DOWN", "RELAYER_BUSY", "RELAYER_UNDERFUNDED", "RELAYER_BUDGET_EXHAUSTED", "SPEND_QUOTA_EXCEEDED", "RATE_LIMITED", "TOO_MANY_CONNECTIONS"]);

export function problemFor(e: unknown): PayProblem {
  if (e instanceof WalletError) return e.code === "CANCELLED" ? "cancelled" : "failed";
  if (e instanceof ApiError) {
    if (e.code === "NETWORK") return typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "unavailable";
    if (e.code === "ORDER_EXPIRED") return "expired";
    if (e.code === "ORDER_ALREADY_PAID") return "alreadyPaid";
    if (e.code === "INSUFFICIENT_BALANCE") return "insufficient";
    if (RETRYABLE.has(e.code) || e.retryable) return "unavailable";
  }
  return "failed";
}

type Phase =
  | { kind: "confirm" }
  | { kind: "paying" }
  | { kind: "pending"; intentId: string; txHash: Hex; t0: number }
  | { kind: "settled"; intentId: string; settled: Settled };

const isOrderId = (s: string | null): s is Hex => !!s && /^0x[0-9a-fA-F]{64}$/.test(s);

export function PayFlow({ address }: AccountCtx) {
  const router = useRouter();
  const params = useSearchParams();
  const toasts = useToasts();
  const venueParam = params.get("v");
  const orderParam = params.get("o");
  const venue = (venueParam && isAddress(venueParam) ? venueParam : null) as Address | null;
  const orderId = isOrderId(orderParam) ? (orderParam.toLowerCase() as Hex) : null;
  const badLink = !venue || !orderId;

  const [venueName, setVenueName] = useState("");
  const [minOrder, setMinOrder] = useState<bigint | undefined>();
  const [amount, setAmount] = useState<bigint>(0n);
  const [quote, setQuote] = useState<QuoteRes | null>(null);
  const [quoting, setQuoting] = useState(true);
  const [names, setNames] = useState<Record<string, string>>({});
  const [whoSentYou, setWhoSentYou] = useState<string | null>(null);
  const [problem, setProblem] = useState<PayProblem | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "confirm" });
  const [toppingUp, setToppingUp] = useState(false);
  const relayer = useRef<Address | null>(null);
  const quoteSeq = useRef(0);

  // ---------------------------------------------------------------- order + venue + relayer
  useEffect(() => {
    if (!venue || !orderId) return;
    let alive = true;
    api.relayerStatus().then((r) => (relayer.current = r.address)).catch(() => {});
    api
      .venue(venue)
      .then((v) => {
        if (!alive) return;
        if (v.name) {
          setVenueName(v.name);
          rememberVenueName(venue, v.name);
        }
        if (v.terms?.minOrder) setMinOrder(money(v.terms.minOrder));
      })
      .catch(() => alive && setVenueName("This place"));
    api
      .order(venue, orderId)
      .then((o) => {
        if (!alive) return;
        setAmount(money(o.amount));
        if (o.venueName) setVenueName(o.venueName);
        if (o.status === "paid" || o.paid) setProblem("alreadyPaid");
        else if (o.status === "expired") setProblem("expired");
      })
      .catch((e) => alive && setProblem(problemFor(e)));
    return () => {
      alive = false;
    };
  }, [venue, orderId]);

  // ---------------------------------------------------------------- quote (again when "who sent you" changes)
  const runQuote = useCallback(
    async (who: string | null) => {
      if (!venue || !orderId) return;
      const seq = ++quoteSeq.current;
      setQuoting(true);
      try {
        const q = await api.quote({ venue, orderId, whoSentYou: who && isAddress(who) ? (who as Address) : null });
        if (seq !== quoteSeq.current) return;
        setQuote(q);
        setAmount(money(q.quote.amount));
        const addrs = [...(q.attribution?.scores.map((s) => s.referrer) ?? []), ...q.quote.rewards.flatMap((r) => ("recipient" in r && r.recipient ? [r.recipient] : [])), ...q.quote.rewards.flatMap((r) => (r.role === "introducer" ? [r.via] : []))];
        resolveNames(addrs).then((n) => seq === quoteSeq.current && setNames(n));
        setProblem(null);
      } catch (e) {
        if (seq === quoteSeq.current) setProblem(problemFor(e));
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    },
    [venue, orderId],
  );
  useEffect(() => {
    const t = setTimeout(() => void runQuote(null), 0);
    return () => clearTimeout(t);
  }, [runQuote]);

  function onWho(v: string | null) {
    setWhoSentYou(v);
    // Only an actual recommender changes the split; "other"/"skip" keep the baseline quote.
    if (v === null || isAddress(v)) void runQuote(v);
  }

  // ---------------------------------------------------------------- pay
  async function pay() {
    if (!quote || !venue || !orderId) return;
    setPhase({ kind: "paying" });
    const t0 = performance.now();
    try {
      if (!relayer.current) relayer.current = (await api.relayerStatus()).address;
      assertSafePaymentTypedData({ td: quote.typedData, paymentAuth: quote.paymentAuth, me: address, relayer: relayer.current, expectedVenue: venue, expectedOrderId: orderId });
      const signer = await getSigner({ fresh: true });
      const tSigned = performance.now();
      const signature = await signTypedDataJson(signer, quote.typedData);
      const res = await api.pay({ intentId: quote.intentId, signature });
      const t202 = performance.now();
      recordTiming({ orderId, intentId: res.intentId, txHash: res.txHash, step: "pending", faceIdMs: Math.round(tSigned - t0), relayMs: Math.round(t202 - tSigned) });
      settledOnce.current = false;
      setPhase({ kind: "pending", intentId: res.intentId, txHash: res.txHash, t0: t202 });
    } catch (e) {
      if (e instanceof ApiError && e.code === "ORDER_ALREADY_PAID" && (e.details?.settled as Settled | null)?.customer?.toLowerCase() === address.toLowerCase()) {
        setPhase({ kind: "settled", intentId: quote.intentId, settled: e.details!.settled as Settled });
        return;
      }
      setPhase({ kind: "confirm" });
      setProblem(problemFor(e));
      if (!(e instanceof ApiError) && !(e instanceof WalletError)) console.error(e);
    }
  }

  // ---------------------------------------------------------------- settle: SSE first, polling fallback
  const settledOnce = useRef(false);
  const settle = useCallback(
    (s: Settled, via: "sse" | "poll") => {
      if (phase.kind !== "pending" || settledOnce.current) return;
      settledOnce.current = true;
      recordTiming({ orderId: s.orderId, intentId: phase.intentId, txHash: s.txHash, step: "settled", via, settleMs: Math.round(performance.now() - phase.t0) });
      navigator.vibrate?.(12);
      setPhase({ kind: "settled", intentId: phase.intentId, settled: s });
      resolveNames(addressesIn(s)).then(setNames);
    },
    [phase],
  );

  const { connected } = useLiveEvents({ kind: "user", id: address }, (name, data) => {
    if (phase.kind !== "pending") return;
    if (name === "payment.settled" && String(data.orderId).toLowerCase() === orderId) settle(data as unknown as Settled, "sse");
    if (name === "payment.failed" && data.intentId === phase.intentId) {
      setPhase({ kind: "confirm" });
      setProblem(data.status === "already_settled" ? "alreadyPaid" : "failed");
    }
  });

  useEffect(() => {
    if (phase.kind !== "pending") return;
    let alive = true;
    const iv = setInterval(
      async () => {
        try {
          const st = await api.intent(phase.intentId);
          if (!alive) return;
          if (st.status === "settled" && st.settled) settle(st.settled, "poll");
          else if (st.status === "failed") {
            setPhase({ kind: "confirm" });
            setProblem(st.relayStatus === "already_settled" ? "alreadyPaid" : "failed");
          }
        } catch {
          /* keep waiting */
        }
      },
      connected ? 3000 : 1500,
    );
    const slow = setTimeout(() => toasts.push({ tone: "neutral", key: "slow", title: "Still confirming", description: "It's taking longer than usual. You can close this; your activity will update.", ms: 8000 }), 45_000);
    return () => {
      alive = false;
      clearInterval(iv);
      clearTimeout(slow);
    };
  }, [phase, connected, settle, toasts]);

  async function topUp() {
    setToppingUp(true);
    try {
      await demoTopup();
      await runQuote(whoSentYou && isAddress(whoSentYou) ? whoSentYou : null);
    } catch (e) {
      toasts.push({ tone: "warning", title: e instanceof Error ? e.message : "Top-up didn't work. Try again." });
    } finally {
      setToppingUp(false);
    }
  }

  // ---------------------------------------------------------------- render
  if (phase.kind === "pending" || phase.kind === "settled") {
    const settled = phase.kind === "settled" ? phase.settled : null;
    const txHash = settled?.txHash ?? (phase.kind === "pending" ? phase.txHash : undefined);
    return (
      <PaymentSuccessScreen
        venueName={venueName}
        amount={settled ? money(settled.amount) : amount}
        cashback={settled ? cashbackOf(settled) : quote ? money(quote.quote.cashback) : 0n}
        status={settled ? "settled" : "pending"}
        split={settled ? (settled.rewarded ? splitFromSettled(settled, venueName, address, names) : undefined) : quote?.quote.rewarded ? splitFromQuote(quote, venueName, names) : undefined}
        thanked={settled ? thankedFrom(settled.lines, names) : quote ? thankedFrom(quote.quote.rewards.map((r) => ({ role: r.role, recipient: r.recipient })), names) : []}
        details={txHash ? { receiptId: `${txHash.slice(0, 6)}…${txHash.slice(-4)}`, network: "Arc Testnet", networkFee: "Under $0.01, paid by Vouch", explorerUrl: explorerTxUrl(txHash) } : undefined}
        onDone={() => router.push("/wallet")}
        onRecommend={settled && settled.firstPurchase ? () => router.push(`/recommend?venue=${venue}`) : undefined}
      />
    );
  }

  const noReward: NoRewardReason | undefined = !quote || quote.quote.rewarded
    ? undefined
    : quote.attribution === null || !quote.quote.firstPurchase
      ? "repeat"
      : quote.warnings.includes("first_purchase_without_recommendation")
        ? "noRecommendation"
        : "belowMinimum";
  const recommenders = (quote?.attribution?.scores ?? []).filter((s) => s.eligible).map((s) => ({ id: s.referrer, name: names[s.referrer.toLowerCase()] ?? "A friend" }));

  return (
    <>
      <Screen>
        <div />
      </Screen>
      <PayConfirmSheet
        open
        onClose={() => router.push("/wallet")}
        venueName={venueName}
        orderLabel={orderId ? `Order ${orderId.slice(2, 6).toUpperCase()}` : "Order"}
        amount={amount}
        cashback={quote ? money(quote.quote.cashback) : 0n}
        split={quote?.quote.rewarded ? splitFromQuote(quote, venueName, names) : undefined}
        recommenders={recommenders}
        whoSentYou={whoSentYou}
        onWhoSentYouChange={onWho}
        quoting={badLink ? false : quoting}
        paying={phase.kind === "paying"}
        noReward={noReward}
        minOrder={minOrder}
        balance={quote ? money(quote.balance) : undefined}
        problem={badLink ? "failed" : problem}
        toppingUp={toppingUp}
        onPay={pay}
        onCancel={() => router.push("/wallet")}
        onRetry={() => {
          setProblem(null);
          void runQuote(whoSentYou && isAddress(whoSentYou) ? whoSentYou : null);
        }}
        onRescan={() => router.push("/scan")}
        onTopUp={topUp}
        details={orderId ? { networkFee: "Under $0.01", network: "Arc Testnet", orderId: `${orderId.slice(0, 6)}…${orderId.slice(-4)}` } : undefined}
      />
    </>
  );
}
