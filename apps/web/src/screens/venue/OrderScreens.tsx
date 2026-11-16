"use client";

import type { ReactNode } from "react";
import { AmountDisplay, AppBar, Badge, Button, Keypad, QRFrame, Screen, type KeypadKey, type QRFrameState } from "@/components/ui";
import { formatMoney } from "@/design/money";

export interface OrderEntryScreenProps {
  venueName: string;
  /** Amount in base units, parsed by the caller from the keyed string. */
  amount: bigint;
  /** Raw keyed string, e.g. "12.00". */
  entry: string;
  onKey: (k: KeypadKey) => void;
  /** Example welcome cashback for this amount at current terms (first-time customers). */
  firstTimeCashback?: bigint;
  error?: string;
  creating?: boolean;
  onShowCode?: () => void;
}

/** Staff keys in the order at the counter. */
export function OrderEntryScreen(p: OrderEntryScreenProps) {
  return (
    <Screen
      header={<AppBar title={p.venueName} trailing={<Badge>Counter</Badge>} />}
      footer={
        <Button block size="lg" disabled={p.amount === 0n} loading={p.creating} loadingLabel="Creating code…" onClick={p.onShowCode}>
          Show code
        </Button>
      }
    >
      <div className="flex flex-col items-center pt-8 pb-6 text-center">
        <p className="text-body-sm font-medium text-ink-2">New order</p>
        <p aria-live="polite" className="money mt-1 text-[4rem] leading-none font-semibold tracking-[-0.04em] text-ink">
          <span className="text-[0.5em] align-[0.6em]">$</span>
          {p.entry || "0"}
        </p>
        {p.error ? (
          <p className="mt-3 text-body-sm text-danger-ink">{p.error}</p>
        ) : p.firstTimeCashback && p.amount > 0n ? (
          <p className="mt-3 text-body-sm text-ink-3">
            A first-time customer gets <AmountDisplay value={p.firstTimeCashback} size="sm" variant="positive" /> back
          </p>
        ) : (
          <p className="mt-3 text-body-sm text-ink-3">Type the total, then show the code</p>
        )}
      </div>
      <Keypad onKey={p.onKey} />
    </Screen>
  );
}

export interface OrderQRScreenProps {
  venueName: string;
  amount: bigint;
  orderLabel: string;
  /** <QrCode value={qrPayload}/> */
  qr: ReactNode;
  secondsLeft: number;
  totalSeconds: number;
  state: QRFrameState;
  onRefresh?: () => void;
  onCancel?: () => void;
  onNext?: () => void;
}

/** The code the customer scans. Big, high-contrast, with a draining expiry ring. */
export function OrderQRScreen(p: OrderQRScreenProps) {
  return (
    <Screen
      header={<AppBar title={p.venueName} trailing={<Badge tone={p.state === "paid" ? "accent" : "neutral"} dot={p.state === "live"}>{p.state === "paid" ? "Paid" : p.state === "expired" ? "Expired" : "Waiting"}</Badge>} />}
      footer={
        p.state === "paid" ? (
          <Button block size="lg" onClick={p.onNext}>
            Next order
          </Button>
        ) : (
          <Button block size="lg" variant="secondary" onClick={p.onCancel}>
            Cancel order
          </Button>
        )
      }
    >
      <div className="flex flex-col items-center pt-4 text-center">
        <p className="text-body-sm font-medium text-ink-2">{p.orderLabel}</p>
        <p className="money text-title-1 text-ink">{formatMoney(p.amount)}</p>
        <p className="mt-1 mb-6 text-body-sm text-ink-3">
          {p.state === "paid" ? "Payment received. Rewards sent." : "Ask the customer to scan with Vouch"}
        </p>
        <QRFrame secondsLeft={p.secondsLeft} totalSeconds={p.totalSeconds} state={p.state} onRefresh={p.onRefresh} size={300}>
          {p.qr}
        </QRFrame>
      </div>
    </Screen>
  );
}
