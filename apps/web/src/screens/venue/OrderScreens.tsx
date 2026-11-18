"use client";

import type { ReactNode } from "react";
import { parseUsdc } from "@vouch/shared";
import { AmountDisplay, AppBar, Badge, Button, IconButton, Keypad, QRFrame, Screen, SuccessMark, TextField, type KeypadKey, type QRFrameState } from "@/components/ui";
import { cn } from "@/design/cn";
import { formatMoney } from "@/design/money";

/* ------------------------------------------------------------------ pure helpers (use them in the route) -------- */

/** API floor for any order (ORDER_MIN_USDC, D-808). */
export const ORDER_MIN = parseUsdc("0.50");
/** Largest order the counter accepts ($10,000; the contract allows more). */
export const ORDER_MAX = parseUsdc("10000");

/** Apply one keypad key to the keyed string: max 2 decimals, no leading zeros, max 5 whole digits. */
export function applyOrderKey(entry: string, key: KeypadKey): string {
  if (key === "back") return entry.slice(0, -1);
  if (key === ".") return entry.includes(".") ? entry : (entry || "0") + ".";
  const [whole, frac] = entry.split(".");
  if (frac !== undefined && frac.length >= 2) return entry;
  if (frac === undefined && whole.replace(/^0/, "").length >= 5) return entry;
  return (entry + key).replace(/^0(?=\d)/, "");
}

/** Keyed string → base units + error copy. Empty is not an error (the button is just disabled). */
export function parseOrderEntry(entry: string): { amount: bigint; error?: string } {
  if (!entry || entry === "." || /^0*\.?0*$/.test(entry)) return { amount: 0n };
  let amount: bigint;
  try {
    amount = parseUsdc(entry.endsWith(".") ? entry.slice(0, -1) : entry);
  } catch {
    return { amount: 0n, error: "Use dollars and cents" };
  }
  if (amount < ORDER_MIN) return { amount, error: `Orders start at ${formatMoney(ORDER_MIN)}` };
  if (amount > ORDER_MAX) return { amount, error: `Orders up to ${formatMoney(ORDER_MAX)}` };
  return { amount };
}

/* ------------------------------------------------------------------ order entry ---------------------------------- */

export interface OrderEntryScreenProps {
  venueName: string;
  /** Raw keyed string, e.g. "12.00" (use applyOrderKey). */
  entry: string;
  /** Base units (use parseOrderEntry). */
  amount: bigint;
  onKey: (k: KeypadKey) => void;
  /** Optional note shown on the code screen, e.g. "Table 4". */
  label: string;
  onLabelChange: (v: string) => void;
  /** Validation or API error (e.g. from parseOrderEntry, or "Couldn't create the code. Try again."). */
  error?: string;
  /** Welcome cashback a first-time customer would get at current terms (cashback = amount × rate × 25%). */
  firstTimeCashback?: bigint;
  /** Venue's minimum first order for rewards (terms.minOrder): below it, a hint says no reward. */
  rewardMinOrder?: bigint;
  creating?: boolean;
  onShowCode?: () => void;
  onBack?: () => void;
}

/** Staff key in the order at the counter. One action: Show code. */
export function OrderEntryScreen(p: OrderEntryScreenProps) {
  const ok = p.amount > 0n && !p.error;
  const belowReward = ok && p.rewardMinOrder !== undefined && p.amount < p.rewardMinOrder;
  return (
    <Screen
      header={<AppBar title={p.venueName} leading={p.onBack ? <IconButton icon="arrowLeft" label="Back to dashboard" onClick={p.onBack} /> : undefined} trailing={<Badge>Counter</Badge>} />}
      footer={
        <Button block size="lg" leadingIcon="qr" disabled={!ok} loading={p.creating} loadingLabel="Creating code…" onClick={p.onShowCode}>
          {ok ? `Show code for ${formatMoney(p.amount)}` : "Show code"}
        </Button>
      }
    >
      <div className="flex flex-col items-center pt-6 pb-4 text-center">
        <p className="text-body-sm font-medium text-ink-2">New order</p>
        <p
          aria-live="polite"
          aria-label={`Amount ${p.entry ? `$${p.entry}` : "$0"}`}
          className={cn("money mt-1 text-[4.25rem] leading-none font-semibold tracking-[-0.04em]", p.entry ? "text-ink" : "text-ink-3")}
        >
          <span className="text-[0.5em] align-[0.6em]">$</span>
          {p.entry || "0"}
        </p>
        <div className="mt-3 min-h-10 text-body-sm">
          {p.error ? (
            <p role="alert" className="text-danger-ink">
              {p.error}
            </p>
          ) : belowReward ? (
            <p className="text-ink-3">Below {formatMoney(p.rewardMinOrder!)}: no reward on this one</p>
          ) : ok && p.firstTimeCashback ? (
            <p className="text-ink-3">
              A first-time customer gets <AmountDisplay value={p.firstTimeCashback} size="sm" variant="positive" /> back
            </p>
          ) : (
            <p className="text-ink-3">Type the total, then show the code</p>
          )}
        </div>
      </div>
      <Keypad onKey={p.onKey} disabled={p.creating} />
      <TextField
        className="mt-4"
        label="Note (optional)"
        placeholder="e.g. Table 4, 2 cortados"
        maxLength={40}
        value={p.label}
        onChange={(e) => p.onLabelChange(e.target.value)}
      />
    </Screen>
  );
}

/* ------------------------------------------------------------------ order code ----------------------------------- */

export interface OrderPaidSummary {
  customerName?: string;
  venueAmount: bigint;
  cashback?: bigint;
  thankedAmount?: bigint;
  thankedCount?: number;
}

export interface OrderQRScreenProps {
  venueName: string;
  amount: bigint;
  /** e.g. "Table 4". Optional. */
  orderLabel?: string;
  /** <QrCode value={qrPayload}/> */
  qr: ReactNode;
  /** Caller ticks these (QRFrame is timer-free). */
  secondsLeft: number;
  totalSeconds: number;
  /** live → processing (payment.pending) → paid (payment.settled) · live → expired → refreshing → live. */
  state: QRFrameState;
  /** Expired codes are replaced automatically by the caller. */
  autoRefresh?: boolean;
  /** Shown once paid. */
  paid?: OrderPaidSummary;
  onRefresh?: () => void;
  onCancel?: () => void;
  onNext?: () => void;
}

function paidLine(a: OrderPaidSummary) {
  const who = a.customerName ?? "The customer";
  const parts = [`${formatMoney(a.venueAmount)} to you`];
  if (a.thankedCount && a.thankedAmount) parts.push(`${formatMoney(a.thankedAmount)} to ${a.thankedCount === 1 ? "1 person" : `${a.thankedCount} people`} who sent ${a.customerName ?? "them"}`);
  if (a.cashback) parts.push(`${formatMoney(a.cashback)} back to ${a.customerName ?? "them"}`);
  return `${who} paid. ${parts.join(", ")}.`;
}

/** The code the customer scans: big, high-contrast, with a draining expiry ring. Then "Paid ✓". */
export function OrderQRScreen(p: OrderQRScreenProps) {
  const isPaid = p.state === "paid";
  const badge =
    p.state === "paid" ? (
      <Badge tone="accent">Paid</Badge>
    ) : p.state === "expired" ? (
      <Badge tone="warning">Expired</Badge>
    ) : p.state === "processing" ? (
      <Badge>Paying…</Badge>
    ) : (
      <Badge dot>Waiting</Badge>
    );
  return (
    <Screen
      header={<AppBar title={p.venueName} trailing={badge} />}
      footer={
        isPaid ? (
          <Button block size="lg" leadingIcon="plus" onClick={p.onNext}>
            Next order
          </Button>
        ) : (
          <Button block size="lg" variant="secondary" disabled={p.state === "processing"} onClick={p.onCancel}>
            Cancel order
          </Button>
        )
      }
    >
      <div className="flex flex-col items-center pt-2 text-center">
        {isPaid ? (
          <div className="flex flex-col items-center pt-10">
            <SuccessMark size={104} label={`Paid ${formatMoney(p.amount)}`} />
            <p className="mt-6 text-body font-semibold text-accent-ink">Paid</p>
            <p className="money text-[3.5rem] leading-tight font-semibold tracking-[-0.03em] text-ink">{formatMoney(p.amount)}</p>
            {p.orderLabel ? <p className="text-body-sm text-ink-3">{p.orderLabel}</p> : null}
            <p role="status" className="mt-5 max-w-[30ch] text-body text-ink-2">
              {p.paid ? paidLine(p.paid) : "Payment received."}
            </p>
          </div>
        ) : (
          <>
            {p.orderLabel ? <p className="text-body-sm font-medium text-ink-2">{p.orderLabel}</p> : null}
            <p className="money text-[2.75rem] leading-tight font-semibold tracking-[-0.03em] text-ink">{formatMoney(p.amount)}</p>
            <p role="status" className="mt-1 mb-5 flex items-center gap-2 text-body-sm text-ink-2">
              {p.state === "live" ? <span aria-hidden className="size-2 animate-pulse rounded-full bg-accent" /> : null}
              {p.state === "processing"
                ? "Payment on its way"
                : p.state === "expired"
                  ? "This code expired"
                  : p.state === "refreshing"
                    ? "Getting a new code"
                    : "Waiting for payment · scan with Vouch"}
            </p>
            <QRFrame secondsLeft={p.secondsLeft} totalSeconds={p.totalSeconds} state={p.state} onRefresh={p.onRefresh} autoRefresh={p.autoRefresh} size={312}>
              {p.qr}
            </QRFrame>
          </>
        )}
      </div>
    </Screen>
  );
}
