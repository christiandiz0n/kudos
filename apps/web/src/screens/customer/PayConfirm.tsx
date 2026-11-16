"use client";

import {
  AmountDisplay,
  Avatar,
  Button,
  ChoiceChips,
  DetailRow,
  Details,
  SheetPanel,
  SplitBreakdown,
  type SplitPart,
} from "@/components/ui";
import { formatMoney } from "@/design/money";
import { ScanScreen } from "./ScanScreen";

export interface PayConfirmProps {
  venueName: string;
  orderLabel: string;
  amount: bigint;
  cashback: bigint;
  /** Preview of the split (from /payments/quote). Omit for repeat purchases (no rewards). */
  split?: SplitPart[];
  /** People who recommended this venue to you (from accepted recommendations). */
  recommenders: string[];
  whoSentYou: string | null;
  onWhoSentYouChange: (value: string | null) => void;
  paying?: boolean;
  onPay?: () => void;
  onCancel?: () => void;
  /** Technical facts, shown only inside the Details drawer. */
  details?: { networkFee: string; network: string; orderId: string };
}

/** Content of the pay sheet. In the app: <Sheet open title=…><PayConfirmContent …/></Sheet>. */
export function PayConfirmContent(p: PayConfirmProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <Avatar name={p.venueName} kind="venue" size="md" />
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">{p.venueName}</p>
          <p className="text-caption text-ink-3">{p.orderLabel}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-start">
        <AmountDisplay value={p.amount} size="display" as="p" />
        {p.cashback > 0n ? (
          <p className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-body-sm font-medium text-accent-ink">
            You&apos;ll get <AmountDisplay value={p.cashback} size="sm" className="font-semibold text-accent-ink" /> back
          </p>
        ) : (
          <p className="mt-2 text-body-sm text-ink-3">Welcome back. Thanks for coming again.</p>
        )}
      </div>

      {p.split ? (
        <SplitBreakdown className="mt-5" variant="bar" total={p.amount} parts={p.split} />
      ) : null}

      {p.recommenders.length > 0 ? (
        <fieldset className="mt-6">
          <legend className="text-body-sm font-semibold text-ink">
            Who sent you here? <span className="font-normal text-ink-3">Optional</span>
          </legend>
          <ChoiceChips
            className="mt-2.5"
            label="Who sent you here?"
            value={p.whoSentYou}
            onChange={p.onWhoSentYouChange}
            options={[
              ...p.recommenders.map((r) => ({ value: r, label: r, person: true })),
              { value: "other", label: "Someone else" },
            ]}
          />
        </fieldset>
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

export function PayConfirmFooter({ amount, paying, onPay }: Pick<PayConfirmProps, "amount" | "paying" | "onPay">) {
  return (
    <div className="flex flex-col gap-2">
      <Button block size="lg" leadingIcon="key" loading={paying} loadingLabel="Paying…" onClick={onPay}>
        Pay {formatMoney(amount)}
      </Button>
      <p className="text-center text-caption text-ink-3">Confirm with Face ID or fingerprint</p>
    </div>
  );
}

/** Static mock for /design: the sheet over the dimmed scanner. */
export function PayConfirmMock(p: PayConfirmProps) {
  return (
    <div className="relative h-full overflow-hidden">
      <ScanScreen />
      <div aria-hidden className="absolute inset-0 bg-scrim" />
      <div className="absolute inset-x-0 bottom-0">
        <SheetPanel title="Confirm payment" onClose={p.onCancel} footer={<PayConfirmFooter amount={p.amount} paying={p.paying} onPay={p.onPay} />}>
          <PayConfirmContent {...p} />
        </SheetPanel>
      </div>
    </div>
  );
}
