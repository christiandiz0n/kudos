/**
 * Payment success (UI_DESIGN, Phase 3). Props-only.
 *
 * PROP CONTRACT (PaymentSuccessScreenProps)
 *   venueName                 string
 *   amount, cashback          bigint base units (cashback 0n → no green chip; copy picked by noReward)
 *   noReward?                 why cashback is 0, same values as PayConfirm (QE-3-03 / MSG-100 #1):
 *                             "repeat" → "Thanks for coming back." · "noRecommendation" → first-visit thanks + how money back works
 *                             · "belowMinimum" → first-visit thanks + why there was none (needs minOrder) · undefined → neutral
 *                             "Thanks for coming in." (never assumes a repeat visit)
 *   minOrder?                 bigint, for the "belowMinimum" line
 *   status?                   "pending" (POST /payments 202 / payment.pending) | "settled" (default; payment.settled via Streams)
 *                             pending → quiet ring + gray receipt + "Arriving"; settled → green pop + receipt floods green.
 *                             Call navigator.vibrate?.(12) when it flips to settled.
 *   split?                    SplitPart[] (role "you" with id "you" is highlighted). From the settled payment when
 *                             available, the quote's preview while pending.
 *   thanked?                  names of the recommenders this purchase paid ("Ana", "Priya")
 *   details?                  { receiptId, network, networkFee, explorerUrl? } → collapsed Details drawer only
 *   onDone, onRecommend?      onRecommend only when the person is now a verified customer here
 */
import { AmountDisplay, Button, DetailRow, Details, Icon, Screen, SplitBreakdown, SuccessMark, type SplitPart } from "@/components/ui";
import { cn } from "@/design/cn";
import { formatMoney } from "@/design/money";
import type { NoRewardReason } from "./PayConfirm";

export interface PaymentSuccessScreenProps {
  venueName: string;
  amount: bigint;
  cashback: bigint;
  /** Why cashback is 0 (from the quote). Default: neutral thanks. */
  noReward?: NoRewardReason;
  minOrder?: bigint;
  status?: "pending" | "settled";
  split?: SplitPart[];
  /** Names of the people your purchase thanked ("Ana and Priya"). */
  thanked?: string[];
  details?: { receiptId: string; network: string; networkFee: string; explorerUrl?: string };
  onDone?: () => void;
  onRecommend?: () => void;
}

export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The line under the amount when there's no money back (QE-3-03). */
export function noRewardThanks(reason: NoRewardReason | undefined, venueName: string, minOrder?: bigint): { title: string; body?: string } {
  switch (reason) {
    case "repeat":
      return { title: "Thanks for coming back." };
    case "noRecommendation":
      return { title: `Thanks for coming in.`, body: "When a friend recommends a place to you, your first visit there gets money back." };
    case "belowMinimum":
      return {
        title: `Thanks for coming in.`,
        body: minOrder !== undefined ? `First visits from ${formatMoney(minOrder)} get money back at ${venueName}. This one was under that.` : `This order was under ${venueName}'s minimum for money back.`,
      };
    default:
      return { title: "Thanks for coming in." };
  }
}

export function PaymentSuccessScreen({
  venueName,
  amount,
  cashback,
  noReward,
  minOrder,
  status = "settled",
  split,
  thanked = [],
  details,
  onDone,
  onRecommend,
}: PaymentSuccessScreenProps) {
  const pending = status === "pending";
  return (
    <Screen
      footer={
        onRecommend && !pending ? (
          <div className="flex flex-col gap-2">
            <Button block size="lg" leadingIcon="heart" onClick={onRecommend}>
              Recommend {venueName}
            </Button>
            <Button block variant="ghost" onClick={onDone}>
              Done
            </Button>
          </div>
        ) : (
          <Button block size="lg" onClick={onDone}>
            Done
          </Button>
        )
      }
    >
      <div className="flex flex-col items-center pt-8 text-center" role="status" aria-live="polite">
        <SuccessMark pending={pending} label={pending ? `Paying ${formatMoney(amount)} at ${venueName}` : `Paid ${formatMoney(amount)} at ${venueName}`} />
        <p className="mt-6 text-body text-ink-2">{pending ? `Paying ${venueName}…` : `Paid at ${venueName}`}</p>
        <AmountDisplay value={amount} size="display" as="p" />
        {cashback > 0n ? (
          <p
            className={cn(
              "mt-3 inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-body font-medium transition-colors duration-[var(--vx-dur-slow)]",
              pending ? "bg-surface-2 text-ink-2" : "animate-vx-rise-in bg-accent-soft text-accent-ink",
            )}
          >
            <AmountDisplay value={cashback} variant={pending ? "muted" : "positive"} size="md" />
            {pending ? " back, on its way" : " back to you"}
          </p>
        ) : (
          (() => {
            const t = noRewardThanks(noReward, venueName, minOrder);
            return (
              <>
                <p className="mt-3 text-body text-ink-2">{t.title}</p>
                {t.body ? <p className="mt-1 max-w-[30ch] text-body-sm text-ink-3">{t.body}</p> : null}
              </>
            );
          })()
        )}
        {thanked.length ? (
          <p className="mt-4 max-w-[30ch] text-body text-ink-2">
            {pending ? (
              <>Thanking {joinNames(thanked)} for sending you…</>
            ) : (
              <>
                <span className="font-semibold text-ink">{joinNames(thanked)}</span> {thanked.length > 1 ? "were" : "was"} just thanked
                for sending you.
              </>
            )}
          </p>
        ) : null}
        {pending ? <p className="mt-2 text-caption text-ink-3">This takes a few seconds.</p> : null}
      </div>
      {split ? (
        <section
          aria-label={pending ? "Where your money goes" : "Where your money went"}
          aria-busy={pending || undefined}
          className="mt-7 animate-vx-rise-in rounded-lg bg-surface px-3 py-4 shadow-1 ring-1 ring-line/60"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-body-sm font-semibold text-ink">
              {pending ? "Where your money goes" : "Where your money went"}
              {pending ? (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-caption font-medium text-ink-2">
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
                  Arriving
                </span>
              ) : null}
            </h2>
            <AmountDisplay value={amount} size="md" />
          </div>
          <SplitBreakdown variant="bar" total={amount} parts={split} pending={pending} />
          <details className="group mt-3 border-t border-line pt-1">
            <summary className="focus-ring -mx-1 flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md px-1 text-body-sm font-medium text-primary-ink [&::-webkit-details-marker]:hidden">
              See who got what
              <Icon name="chevronDown" size={18} className="transition-transform duration-[var(--vx-dur-fast)] group-open:rotate-180" />
            </summary>
            <SplitBreakdown variant="lines" total={amount} parts={split} highlightId="you" pending={pending} className="pt-1" />
          </details>
        </section>
      ) : null}
      {details ? (
        <Details className="mt-4" summary="Receipt details">
          <DetailRow label="Receipt ID" value={details.receiptId} mono />
          <DetailRow label="Settles on" value={details.network} />
          <DetailRow label="Network fee" value={`${details.networkFee}, paid by Vouch`} />
          {details.explorerUrl ? (
            <DetailRow
              label="Public record"
              value={
                <a href={details.explorerUrl} target="_blank" rel="noreferrer" className="focus-ring -my-3 inline-flex min-h-11 items-center rounded-xs font-semibold text-ink underline underline-offset-4">
                  View on explorer
                </a>
              }
            />
          ) : null}
        </Details>
      ) : null}
    </Screen>
  );
}
