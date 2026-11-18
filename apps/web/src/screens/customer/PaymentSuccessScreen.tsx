/**
 * Payment success (UI_DESIGN, Phase 3). Props-only.
 *
 * PROP CONTRACT (PaymentSuccessScreenProps)
 *   venueName                 string
 *   amount, cashback          bigint base units (cashback 0n → no green chip; repeat visit copy)
 *   status?                   "pending" (POST /payments 202 / payment.pending) | "settled" (default; payment.settled via Streams)
 *                             pending → quiet ring + gray receipt + "Arriving"; settled → green pop + receipt floods green.
 *                             Call navigator.vibrate?.(12) when it flips to settled.
 *   split?                    SplitPart[] (role "you" with id "you" is highlighted). From the settled payment when
 *                             available, the quote's preview while pending.
 *   thanked?                  names of the recommenders this purchase paid ("Ana", "Priya")
 *   details?                  { receiptId, network, networkFee, explorerUrl? } → collapsed Details drawer only
 *   onDone, onRecommend?      onRecommend only when the person is now a verified customer here
 */
import { AmountDisplay, Button, DetailRow, Details, Screen, SplitBreakdown, SuccessMark, type SplitPart } from "@/components/ui";
import { cn } from "@/design/cn";
import { formatMoney } from "@/design/money";

export interface PaymentSuccessScreenProps {
  venueName: string;
  amount: bigint;
  cashback: bigint;
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

export function PaymentSuccessScreen({
  venueName,
  amount,
  cashback,
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
        <div className="flex flex-col gap-2">
          <Button block size="lg" onClick={onDone}>
            Done
          </Button>
          {onRecommend && !pending ? (
            <Button block variant="ghost" leadingIcon="heart" onClick={onRecommend}>
              Recommend {venueName}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col items-center pt-10 text-center" role="status" aria-live="polite">
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
          <p className="mt-3 text-body-sm text-ink-2">Thanks for coming back.</p>
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
        <SplitBreakdown
          className="mt-8"
          total={amount}
          parts={split}
          highlightId="you"
          pending={pending}
          title={pending ? "Where your money goes" : "Where your money went"}
        />
      ) : null}
      {details ? (
        <Details className="mt-6" summary="Receipt details">
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
