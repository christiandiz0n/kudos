/**
 * Customer error / blocked states for paying (UI_DESIGN, Phase 3). Props-only.
 *
 * PROP CONTRACT
 *   <PayProblemPanel problem amount balance? venueName? onRetry? onRescan? onTopUp? toppingUp? onDone? />
 *   PayProblem (map from API error codes, D-806):
 *     "expired"      ← ORDER_EXPIRED (410)             → "Scan a new code"
 *     "alreadyPaid"  ← ORDER_ALREADY_PAID (409)        → "Scan a new code"
 *     "insufficient" ← quote.canAfford === false / INSUFFICIENT_BALANCE (402) → "Top up (testnet demo)"
 *     "unavailable"  ← RELAYER_DOWN (503), RELAYER_BUSY, RATE_LIMITED, other retryable → "Try again"
 *     "failed"       ← payment.failed / non-retryable errors → "Try again" + "Scan a new code"
 *     "cancelled"    ← the Face ID / fingerprint prompt was dismissed (NotAllowedError) → "Try again"
 *     "offline"      ← navigator.onLine === false / fetch TypeError → "Try again"
 *     "invalidLink"  ← the /pay link itself is malformed (missing or garbled venue / order), so nothing could be
 *                      looked up → "Scan a new code". Never "Try again": retrying the same link can't work (QE-3-01).
 *   Every message reassures that nothing was charged, except "alreadyPaid" (someone else paid) and
 *   "insufficient" (nothing was attempted). Added (backwards-compatible) in the Phase 3 fix pass: "invalidLink".
 */
import { Button, EmptyState, type EmptyStateTone, type IconName } from "@/components/ui";
import { formatMoney } from "@/design/money";

export type PayProblem = "expired" | "alreadyPaid" | "insufficient" | "unavailable" | "failed" | "cancelled" | "offline" | "invalidLink";

export interface PayProblemPanelProps {
  problem: PayProblem;
  /** Order amount (base units). */
  amount: bigint;
  /** Current balance (base units). Used by "insufficient". */
  balance?: bigint;
  venueName?: string;
  onRetry?: () => void;
  onRescan?: () => void;
  onTopUp?: () => void;
  toppingUp?: boolean;
  /** Closes the sheet / goes home. */
  onDone?: () => void;
  className?: string;
}

interface ProblemCopy {
  icon: IconName;
  tone: EmptyStateTone;
  title: string;
  body: string;
}

export function payProblemCopy(p: Pick<PayProblemPanelProps, "problem" | "amount" | "balance" | "venueName">): ProblemCopy {
  switch (p.problem) {
    case "expired":
      return {
        icon: "clock",
        tone: "warning",
        title: "This code has expired",
        body: "Codes only last a couple of minutes, so nobody pays for an old order. Nothing was charged. Ask for a new code and scan again.",
      };
    case "alreadyPaid":
      return {
        icon: "receipt",
        tone: "neutral",
        title: "This order is already paid",
        body: "Someone has already paid with this code. If you still need to pay, ask for a new one.",
      };
    case "insufficient": {
      const short = p.balance !== undefined && p.balance < p.amount ? p.amount - p.balance : undefined;
      return {
        icon: "plus",
        tone: "neutral",
        title: "Not enough money yet",
        body:
          p.balance !== undefined && short !== undefined
            ? `Your balance is ${formatMoney(p.balance)}. Add at least ${formatMoney(short)} to pay ${formatMoney(p.amount)}.`
            : `Add money to pay ${formatMoney(p.amount)}.`,
      };
    }
    case "unavailable":
      return {
        icon: "pause",
        tone: "warning",
        title: "Payments are paused for a moment",
        body: "Our payment service is taking a short break. Nothing was charged. Try again in a minute.",
      };
    case "failed":
      return {
        icon: "alert",
        tone: "danger",
        title: "Payment didn't go through",
        body: "Nothing was charged. Try again, or ask for a new code.",
      };
    case "cancelled":
      return {
        icon: "faceId",
        tone: "neutral",
        title: "Payment not confirmed",
        body: "Face ID or fingerprint was cancelled, so nothing was charged. Try again when you're ready.",
      };
    case "offline":
      return {
        icon: "wifiOff",
        tone: "neutral",
        title: "You're offline",
        body: "Connect to Wi-Fi or mobile data to pay. Nothing was charged.",
      };
    case "invalidLink":
      return {
        icon: "link",
        tone: "neutral",
        title: "This link doesn't look right",
        body: "Part of it may be missing or mistyped, so we can't find the order. Nothing was charged. Scan the code at the counter again, or ask for a new one.",
      };
  }
}

/** The way forward for each problem: one primary + at most one quiet secondary. */
export function PayProblemActions({ problem, onRetry, onRescan, onTopUp, toppingUp, onDone }: PayProblemPanelProps) {
  switch (problem) {
    case "expired":
    case "alreadyPaid":
    case "invalidLink":
      return (
        <>
          <Button block size="lg" leadingIcon="scan" onClick={onRescan}>
            Scan a new code
          </Button>
          <Button block variant="ghost" onClick={onDone}>
            Close
          </Button>
        </>
      );
    case "insufficient":
      return (
        <>
          <Button block size="lg" leadingIcon="plus" loading={toppingUp} loadingLabel="Adding money…" onClick={onTopUp}>
            Top up (testnet demo)
          </Button>
          <p className="text-center text-caption text-ink-3">Adds simulated money for this demo. No card needed.</p>
        </>
      );
    case "failed":
      return (
        <>
          <Button block size="lg" leadingIcon="refresh" onClick={onRetry}>
            Try again
          </Button>
          <Button block variant="ghost" onClick={onRescan}>
            Scan a new code
          </Button>
        </>
      );
    case "unavailable":
    case "cancelled":
    case "offline":
      return (
        <>
          <Button block size="lg" leadingIcon={problem === "cancelled" ? "faceId" : "refresh"} onClick={onRetry}>
            Try again
          </Button>
          <Button block variant="ghost" onClick={onDone}>
            Close
          </Button>
        </>
      );
  }
}

/** Panel for inside the pay sheet or a full screen. Actions render separately (thumb zone). */
export function PayProblemPanel(p: PayProblemPanelProps) {
  const c = payProblemCopy(p);
  return (
    <EmptyState
      role={p.problem === "insufficient" ? "status" : "alert"}
      icon={c.icon}
      tone={c.tone}
      title={c.title}
      body={c.body}
      className={p.className ?? "py-6"}
    />
  );
}
