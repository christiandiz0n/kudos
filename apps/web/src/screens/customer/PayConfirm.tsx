"use client";

/**
 * Pay sheet (UI_DESIGN, Phase 3). Props-only: the caller fetches the quote and owns all state.
 *
 * PROP CONTRACT (PayConfirmProps)
 *   venueName, orderLabel         strings ("Lena's café", "Order A-1042 · Counter 1")
 *   amount, cashback              bigint base units (quote.amount / quote.cashback .baseUnits)
 *   split?                        SplitPart[] preview built from quote.rewards + quote.venueAmount (omit when no rewards)
 *   recommenders                  Array<string | {id, name}>: people with a live recommendation for this venue.
 *                                 `id` is what comes back in onWhoSentYouChange (e.g. their address).
 *   whoSentYou                    null (not answered) | an id | "other" (someone else) | "skip" (explicitly skipped)
 *                                 → send quote `whoSentYou` only for a recommender id.
 *   onWhoSentYouChange(value)     same domain as whoSentYou
 *   quoting?                      quote in flight: cashback + split show skeletons, confirm disabled
 *   paying?                       Face ID prompt / relay in flight: button spins, sheet not dismissible
 *   noReward?                     why cashback is 0: "repeat" (already rewarded here) | "belowMinimum" | "noRecommendation"
 *                                 "belowMinimum" is a WARNING (D-509): paying now uses up the one first-visit money back here.
 *   minOrder?                     bigint, for "belowMinimum" copy
 *   balance?                      bigint from the quote; if balance < amount the sheet shows "insufficient" by itself
 *   problem?                      PayProblem (see PayProblem.tsx for the API-code mapping) → swaps the sheet to that state
 *   onPay, onCancel, onRetry, onRescan, onTopUp, toppingUp?
 *   details?                      { networkFee, network, orderId } → only inside the collapsed Details drawer
 *
 * In the app: <PayConfirmSheet open onClose={…} {...props} />  (portal sheet, focus trap, Esc/drag to close).
 * Behind it (e.g. /pay opened from the phone's own camera, with nothing else on screen): <PayBackdrop venueName? />.
 */
import {
  AmountDisplay,
  Avatar,
  Button,
  ChoiceChips,
  DetailRow,
  Details,
  Icon,
  Sheet,
  SheetPanel,
  Skeleton,
  SplitBreakdown,
  type SplitPart,
} from "@/components/ui";
import { formatMoney } from "@/design/money";
import { PayProblemActions, PayProblemPanel, type PayProblem } from "./PayProblem";
import { ScanScreen } from "./ScanScreen";

export type Recommender = string | { id: string; name: string };
export type NoRewardReason = "repeat" | "belowMinimum" | "noRecommendation";

export interface PayConfirmProps {
  venueName: string;
  orderLabel: string;
  amount: bigint;
  cashback: bigint;
  /** Preview of the split (from /payments/quote). Omit for repeat purchases (no rewards). */
  split?: SplitPart[];
  /** People who recommended this venue to you (from accepted recommendations). */
  recommenders: Recommender[];
  whoSentYou: string | null;
  onWhoSentYouChange: (value: string | null) => void;
  quoting?: boolean;
  paying?: boolean;
  noReward?: NoRewardReason;
  minOrder?: bigint;
  balance?: bigint;
  problem?: PayProblem | null;
  toppingUp?: boolean;
  onPay?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onRescan?: () => void;
  onTopUp?: () => void;
  /** Technical facts, shown only inside the Details drawer. */
  details?: { networkFee: string; network: string; orderId: string };
}

/** The problem to show, if any. A balance below the amount is "insufficient" even without an explicit problem. */
export function activeProblem(p: Pick<PayConfirmProps, "problem" | "balance" | "amount">): PayProblem | null {
  if (p.problem) return p.problem;
  if (p.balance !== undefined && p.balance < p.amount) return "insufficient";
  return null;
}

function recId(r: Recommender) {
  return typeof r === "string" ? r : r.id;
}
function recName(r: Recommender) {
  return typeof r === "string" ? r : r.name;
}

/** D-509: a first purchase below the venue's minimum still counts as the first visit, so it uses up the money back. */
function BelowMinimumWarning({ venueName, amount, minOrder }: { venueName: string; amount: bigint; minOrder?: bigint }) {
  return (
    <div role="note" className="mt-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5 text-body-sm text-warning-ink">
      <Icon name="alert" size={18} className="mt-px shrink-0" />
      <div>
        <p className="font-semibold">No money back on this one</p>
        <p className="mt-0.5">
          {minOrder !== undefined ? `Orders from ${formatMoney(minOrder)} get money back on a first visit. ` : "This order is below the minimum for money back. "}
          If you pay {formatMoney(amount)} now, it counts as your first visit to {venueName}, so there&apos;s no money back here later.
        </p>
      </div>
    </div>
  );
}

function NoRewardNote({ reason, venueName }: { reason?: NoRewardReason; venueName: string }) {
  const text =
    reason === "repeat"
      ? `Welcome back. Your first-visit thank-you at ${venueName} has already been paid, so this one is a regular payment.`
      : reason === "noRecommendation"
        ? "No one recommended this place to you yet, so this is a regular payment."
        : "This one is a regular payment.";
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-body-sm text-ink-2">
      <Icon name="heart" size={18} className="mt-px shrink-0 text-ink-3" />
      <span>{text}</span>
    </p>
  );
}

/** Content of the pay sheet. */
export function PayConfirmContent(p: PayConfirmProps) {
  const problem = activeProblem(p);
  if (problem) {
    return (
      <div className="flex flex-col">
        <PayProblemPanel problem={problem} amount={p.amount} balance={p.balance} venueName={p.venueName} className="-mt-8 pt-0 pb-5" />
        {problem === "insufficient" ? (
          <p className="text-center text-body-sm text-ink-2">
            <span className="font-semibold text-ink">{p.venueName}</span> · <AmountDisplay value={p.amount} size="sm" />
          </p>
        ) : null}
      </div>
    );
  }

  const options = [
    ...p.recommenders.map((r) => ({ value: recId(r), label: recName(r), person: true })),
    { value: "other", label: "Someone else" },
    { value: "skip", label: "Skip", quiet: true },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <Avatar name={p.venueName} kind="venue" size="md" />
        <div className="min-w-0">
          <p className="text-caption text-ink-3">Paying</p>
          <p className="truncate text-body font-semibold text-ink">{p.venueName}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col items-start">
        <AmountDisplay value={p.amount} size="display" as="p" />
        <p className="mt-1 text-caption text-ink-3">{p.orderLabel}</p>
        {p.quoting ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : p.cashback > 0n ? (
          <div className="mt-3 flex w-full animate-vx-rise-in items-center gap-3 rounded-lg bg-accent-soft px-4 py-3">
            <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-accent-ink shadow-1">
              <Icon name="plus" size={20} />
            </span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-1 text-title-3 text-accent-ink">
                You&apos;ll get <AmountDisplay value={p.cashback} size="lg" className="text-accent-ink" /> back
              </span>
              <span className="block text-caption text-ink-2">First-visit money back, right after you pay</span>
            </span>
          </div>
        ) : p.noReward === "belowMinimum" ? (
          <BelowMinimumWarning venueName={p.venueName} amount={p.amount} minOrder={p.minOrder} />
        ) : (
          <NoRewardNote reason={p.noReward} venueName={p.venueName} />
        )}
      </div>

      {p.recommenders.length > 0 && p.cashback > 0n ? (
        <fieldset className="mt-5">
          <legend className="text-body-sm font-semibold text-ink">
            Who sent you here? <span className="font-normal text-ink-3">Optional</span>
          </legend>
          <ChoiceChips className="mt-2.5" label="Who sent you here?" value={p.whoSentYou} onChange={p.onWhoSentYouChange} options={options} />
        </fieldset>
      ) : null}

      {p.quoting ? (
        <div className="mt-5 space-y-2" aria-hidden>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : p.split && p.cashback > 0n ? (
        <section className="mt-5" aria-label="Where your money goes">
          <h3 className="mb-2 text-body-sm font-semibold text-ink">Where your {formatMoney(p.amount)} goes</h3>
          <SplitBreakdown variant="bar" total={p.amount} parts={p.split} />
        </section>
      ) : null}

      {p.details ? (
        <Details className="mt-5">
          <DetailRow label="Network fee" value={`${p.details.networkFee}, paid by Vouch`} />
          <DetailRow label="Settles on" value={p.details.network} />
          <DetailRow label="Order ID" value={p.details.orderId} mono />
        </Details>
      ) : null}
    </div>
  );
}

/** Thumb-zone actions: one primary. */
export function PayConfirmFooter(p: Pick<PayConfirmProps, "amount" | "venueName" | "paying" | "quoting" | "onPay" | "problem" | "balance" | "onRetry" | "onRescan" | "onTopUp" | "toppingUp" | "onCancel">) {
  const problem = activeProblem(p);
  if (problem) {
    return (
      <div className="flex flex-col gap-2">
        <PayProblemActions problem={problem} amount={p.amount} onRetry={p.onRetry} onRescan={p.onRescan} onTopUp={p.onTopUp} toppingUp={p.toppingUp} onDone={p.onCancel} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        block
        size="lg"
        leadingIcon="faceId"
        loading={p.paying}
        loadingLabel="Confirming…"
        disabled={p.quoting}
        onClick={p.onPay}
        aria-label={`Pay ${formatMoney(p.amount)} to ${p.venueName}. Confirm with Face ID or fingerprint`}
      >
        Confirm with Face ID or fingerprint
      </Button>
      <p className="text-center text-caption text-ink-3">
        You pay <span className="money font-semibold text-ink-2">{formatMoney(p.amount)}</span>. No fees.
      </p>
    </div>
  );
}

function sheetTitle(p: PayConfirmProps) {
  return activeProblem(p) ? undefined : "Confirm payment";
}

/** The real modal sheet for the app. Not dismissible while paying. */
export function PayConfirmSheet({ open, onClose, ...p }: PayConfirmProps & { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      dismissible={!p.paying}
      title={sheetTitle(p)}
      ariaLabel={sheetTitle(p) ? undefined : "Payment"}
      footer={<PayConfirmFooter {...p} onCancel={p.onCancel ?? onClose} />}
    >
      <PayConfirmContent {...p} />
    </Sheet>
  );
}

/**
 * What sits behind the pay sheet when nothing else does (MSG-100 #3: /pay opened from the phone's own camera).
 * Quiet, decorative, hidden from assistive tech: the venue (or a skeleton while it loads) and a blurred receipt.
 */
export function PayBackdrop({ venueName }: { venueName?: string }) {
  return (
    <div aria-hidden className="flex min-h-dvh flex-1 flex-col bg-canvas px-[var(--vx-gutter)] pt-8">
      <div className="flex items-center gap-3">
        {venueName ? <Avatar name={venueName} kind="venue" size="lg" /> : <Skeleton rounded="full" className="size-14" />}
        <div className="min-w-0 flex-1">
          {venueName ? <p className="truncate text-title-3 text-ink">{venueName}</p> : <Skeleton className="h-5 w-40" />}
          <p className="mt-1 text-caption text-ink-3">Paying with Vouch</p>
        </div>
      </div>
      <Skeleton className="mt-10 h-12 w-44" />
      <Skeleton rounded="full" className="mt-3 h-8 w-36" />
      <div className="mt-10 space-y-3">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

/** Static mock for /design: the sheet over the dimmed scanner. */
export function PayConfirmMock({ backdrop, ...p }: PayConfirmProps & { backdrop?: "scanner" | "pay" }) {
  return (
    <div className="relative h-full overflow-hidden">
      {backdrop === "pay" ? <PayBackdrop venueName={p.venueName} /> : <ScanScreen />}
      <div aria-hidden className="absolute inset-0 bg-scrim" />
      <div className="absolute inset-x-0 bottom-0 max-h-full overflow-y-auto">
        <SheetPanel title={sheetTitle(p)} onClose={p.paying ? undefined : p.onCancel} footer={<PayConfirmFooter {...p} />}>
          <PayConfirmContent {...p} />
        </SheetPanel>
      </div>
    </div>
  );
}
