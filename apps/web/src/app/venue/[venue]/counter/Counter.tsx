"use client";

/**
 * /venue/<venue>/counter — staff key in the total → POST /venues/:venue/orders → QR with a draining ring.
 * The QR encodes `<this origin>/pay?v=…&o=…` so a phone's native camera opens the pay sheet directly. The code
 * auto-renews a few seconds before expiry (up to MAX_AUTO_RENEW times); "paid" comes from the venue SSE
 * (`payment.settled`, Streams) with order polling as the fallback.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, EmptyState, QrCode, Screen, buttonClasses } from "@/components/ui";
import { OrderEntryScreen, OrderQRScreen, applyOrderKey, parseOrderEntry, type OrderPaidSummary } from "@/screens/venue/OrderScreens";
import { exampleSplit } from "@/screens/venue/VenueOnboardingScreen";
import { api, friendlyError, money, type Settled } from "@/lib/api";
import { resolveNames, nameOr } from "@/lib/names";
import { webOrigin } from "@/lib/config";
import { isVenueOwner } from "@/lib/venueStore";
import { useCountdown } from "@/hooks/useCountdown";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { AccountGate, type AccountCtx } from "../../../_components/AccountGate";
import { RouteLoading } from "../../../_components/RouteLoading";

const TTL_SECONDS = 120;
const RENEW_AT_SECONDS = 4;
const MAX_AUTO_RENEW = 5;

interface LiveOrder {
  orderId: string;
  amount: bigint;
  deadlineMs: number;
  qr: string;
  label: string;
}

function CounterFlow({ venue }: { venue: string }) {
  const router = useRouter();
  const [venueName, setVenueName] = useState("Counter");
  const [rewardBps, setRewardBps] = useState<number | null>(null);
  const [entry, setEntry] = useState("");
  const [label, setLabel] = useState("");
  const [minOrder, setMinOrder] = useState<bigint | undefined>();
  const [processing, setProcessing] = useState(false);
  const [summary, setSummary] = useState<OrderPaidSummary | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [order, setOrder] = useState<LiveOrder | null>(null);
  const [paid, setPaid] = useState(false);
  const issued = useRef(new Set<string>());
  const renewals = useRef(0);
  const [autoOn, setAutoOn] = useState(true);
  const secondsLeft = useCountdown(order?.deadlineMs ?? null);

  const parsed = parseOrderEntry(entry);
  const amount = parsed.amount;

  useEffect(() => {
    api
      .venue(venue)
      .then((v) => {
        if (v.name) setVenueName(v.name);
        if (v.terms) {
          setRewardBps(v.terms.rewardBps);
          setMinOrder(money(v.terms.minOrder));
        }
      })
      .catch(() => {});
  }, [venue]);

  const create = useCallback(
    async (amt: bigint, auto = false) => {
      setCreating(true);
      try {
        const res = await api.createOrder(venue, { amount: amt.toString(), ttlSeconds: TTL_SECONDS, ...(label.trim() ? { label: label.trim() } : {}) });
        const orderId = res.order.orderId.toLowerCase();
        issued.current.add(orderId);
        setOrder({
          orderId,
          amount: money(res.amount),
          deadlineMs: Number(res.order.expiresAt) * 1000,
          qr: `${webOrigin()}/pay?v=${res.order.venue}&o=${res.order.orderId}`,
          label: label.trim() || `Order ${orderId.slice(2, 6).toUpperCase()}`,
        });
        if (!auto) renewals.current = 0;
        setAutoOn(renewals.current < MAX_AUTO_RENEW);
      } catch (e) {
        if (auto) {
          renewals.current = MAX_AUTO_RENEW;
          setAutoOn(false);
        }
        else setError(friendlyError(e));
      } finally {
        setCreating(false);
      }
    },
    [venue, label],
  );

  // Auto-renew shortly before expiry so the counter never shows a dead code mid-queue.
  useEffect(() => {
    if (!order || paid || creating || processing) return;
    if (secondsLeft > 0 && secondsLeft <= RENEW_AT_SECONDS && renewals.current < MAX_AUTO_RENEW) {
      renewals.current++;
      void create(order.amount, true);
    }
  }, [secondsLeft, order, paid, creating, processing, create]);

  const markPaid = useCallback(() => {
    setPaid((was) => {
      if (!was) navigator.vibrate?.(30);
      return true;
    });
  }, []);

  const summarize = useCallback(async (s: Settled) => {
    const names = await resolveNames([s.customer]);
    const thanked = s.lines.filter((l) => !l.returned && l.role !== "cashback" && money(l.amount) > 0n);
    setSummary({
      customerName: nameOr(names, s.customer, "Customer"),
      venueAmount: money(s.venueAmount),
      cashback: s.lines.filter((l) => l.role === "cashback" && !l.returned).reduce((a, l) => a + money(l.amount), 0n),
      thankedAmount: thanked.reduce((a, l) => a + money(l.amount), 0n),
      thankedCount: new Set(thanked.map((l) => l.recipient.toLowerCase())).size,
    });
  }, []);

  useLiveEvents({ kind: "venue", id: venue }, (ev, data) => {
    const mine = issued.current.has(String(data.orderId).toLowerCase());
    if (ev === "payment.pending" && mine) setProcessing(true);
    if (ev === "payment.failed" && mine) setProcessing(false);
    if (ev === "payment.settled" && mine) {
      markPaid();
      void summarize(data as unknown as Settled);
    }
  });

  // Polling fallback (every issued code, newest first; the API answers "paid" only from Streams).
  useEffect(() => {
    if (!order || paid) return;
    const iv = setInterval(async () => {
      for (const id of [...issued.current].reverse().slice(0, 3)) {
        try {
          const o = await api.order(venue, id);
          if (o.paid || o.status === "paid") {
            if (o.settled) void summarize(o.settled);
            return markPaid();
          }
          if (o.status === "relayed" || o.relayStatus === "pending") setProcessing(true);
        } catch {
          /* ignore */
        }
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [order, paid, venue, markPaid, summarize]);

  function reset() {
    setOrder(null);
    setPaid(false);
    setProcessing(false);
    setSummary(undefined);
    setEntry("");
    setLabel("");
    issued.current.clear();
  }

  if (order) {
    const state = paid ? "paid" : processing ? "processing" : creating ? "refreshing" : secondsLeft === 0 ? "expired" : "live";
    return (
      <OrderQRScreen
        venueName={venueName}
        amount={order.amount}
        orderLabel={order.label}
        qr={
          <div data-qr-payload={order.qr}>
            <QrCode value={order.qr} size={260} label={`Payment code for ${order.label}`} />
          </div>
        }
        secondsLeft={secondsLeft}
        totalSeconds={TTL_SECONDS}
        state={state}
        autoRefresh={autoOn}
        paid={summary}
        onRefresh={() => {
          renewals.current = 0;
          void create(order.amount);
        }}
        onCancel={reset}
        onNext={reset}
      />
    );
  }

  return (
    <OrderEntryScreen
      venueName={venueName}
      amount={amount}
      entry={entry}
      onKey={(k) => {
        setError(undefined);
        setEntry((e) => applyOrderKey(e, k));
      }}
      label={label}
      onLabelChange={setLabel}
      firstTimeCashback={rewardBps && amount > 0n ? exampleSplit(amount, rewardBps).cashback : undefined}
      rewardMinOrder={minOrder}
      error={error ?? parsed.error}
      creating={creating}
      onShowCode={() => void create(amount)}
      onBack={() => router.push(`/venue/${venue}`)}
    />
  );
}

/** QE-3-05: someone else's counter. Read-only: their dashboard, or your own place. */
function NotYourCounter({ venue }: { venue: string }) {
  const router = useRouter();
  return (
    <Screen
      footer={
        <div className="flex flex-col gap-2">
          <Button block size="lg" onClick={() => router.push("/venue")}>
            Go to your place
          </Button>
          <Link href={`/venue/${venue}`} className={buttonClasses({ variant: "ghost", block: true })}>
            See this place&apos;s dashboard
          </Link>
        </div>
      }
    >
      <div data-counter-state="not-owner">
        <EmptyState
          className="pt-24"
          role="status"
          icon="store"
          tone="neutral"
          title="Only the owner can take orders here"
          body="This counter belongs to another place. Orders can be taken from the account that set it up."
        />
      </div>
    </Screen>
  );
}

function OwnerOnly({ venue, address }: { venue: string } & AccountCtx) {
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .venue(venue)
      .then((v) => v.owner)
      .catch(() => null)
      .then((o) => isVenueOwner(venue, o, address))
      .then((x) => alive && setOwner(x));
    return () => {
      alive = false;
    };
  }, [venue, address]);
  if (owner === null) return <RouteLoading />;
  return owner ? <CounterFlow venue={venue} /> : <NotYourCounter venue={venue} />;
}

export function Counter() {
  const { venue } = useParams<{ venue: string }>();
  return <AccountGate>{(ctx) => <OwnerOnly venue={venue} {...ctx} />}</AccountGate>;
}
