import { AmountDisplay, Button, Screen, SplitBreakdown, SuccessMark, type SplitPart } from "@/components/ui";
import { formatMoney } from "@/design/money";

export interface PaymentSuccessScreenProps {
  venueName: string;
  amount: bigint;
  cashback: bigint;
  split?: SplitPart[];
  /** Names of the people your purchase thanked ("Ana and Priya"). */
  thanked?: string[];
  onDone?: () => void;
  onRecommend?: () => void;
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function PaymentSuccessScreen({ venueName, amount, cashback, split, thanked = [], onDone, onRecommend }: PaymentSuccessScreenProps) {
  return (
    <Screen
      footer={
        <div className="flex flex-col gap-2">
          <Button block size="lg" onClick={onDone}>
            Done
          </Button>
          {onRecommend ? (
            <Button block variant="ghost" leadingIcon="heart" onClick={onRecommend}>
              Recommend {venueName}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col items-center pt-10 text-center" role="status">
        <SuccessMark label={`Paid ${formatMoney(amount)} at ${venueName}`} />
        <p className="mt-6 text-body text-ink-2">Paid at {venueName}</p>
        <AmountDisplay value={amount} size="display" as="p" />
        {cashback > 0n ? (
          <p className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-4 text-body font-medium text-accent-ink">
            <AmountDisplay value={cashback} variant="positive" size="md" /> back to you
          </p>
        ) : null}
        {thanked.length ? (
          <p className="mt-4 max-w-[30ch] text-body-sm text-ink-2">
            {joinNames(thanked)} {thanked.length > 1 ? "were" : "was"} just thanked for sending you.
          </p>
        ) : null}
      </div>
      {split ? (
        <SplitBreakdown className="mt-8" total={amount} parts={split} highlightId="you" title="Where your money went" />
      ) : null}
    </Screen>
  );
}
