"use client";

import { SPLIT_BPS, mulBps } from "@vouch/shared";
import { AmountDisplay, AppBar, Button, Card, Screen, Slider, SplitBreakdown, TextField } from "@/components/ui";
import { formatBps } from "@/design/money";

export interface VenueOnboardingScreenProps {
  venueName: string;
  rewardBps: number;
  onRewardBpsChange: (bps: number) => void;
  /** Example first-purchase amount for the live preview. */
  exampleOrder: bigint;
  minOrder: string;
  onMinOrderChange: (v: string) => void;
  saving?: boolean;
  onSave?: () => void;
}

/** Same arithmetic as the contract's split (pool, then 25/55/20), single referrer + introducer. */
export function exampleSplit(order: bigint, rewardBps: number) {
  const pool = mulBps(order, rewardBps);
  const cashback = mulBps(pool, SPLIT_BPS.CASHBACK);
  const l1 = mulBps(pool, SPLIT_BPS.L1);
  const l2 = mulBps(pool, SPLIT_BPS.L2);
  const venue = order - cashback - l1 - l2;
  return { pool, cashback, l1, l2, venue };
}

export function VenueOnboardingScreen(p: VenueOnboardingScreenProps) {
  const s = exampleSplit(p.exampleOrder, p.rewardBps);
  return (
    <Screen
      header={<AppBar title="Set your reward" large />}
      footer={
        <Button block size="lg" loading={p.saving} loadingLabel="Saving…" onClick={p.onSave}>
          Start at {formatBps(p.rewardBps)}
        </Button>
      }
    >
      <p className="-mt-1 text-body text-ink-2">
        You only pay when a recommendation brings in a new customer who buys. Nothing up front, no monthly fee.
      </p>

      <Card className="mt-5" padding="lg">
        <Slider
          label="Reward on a new customer's first purchase"
          value={p.rewardBps / 100}
          min={5}
          max={30}
          step={1}
          onChange={(v) => p.onRewardBpsChange(v * 100)}
          formatValue={(v) => `${v}%`}
          minLabel="5%"
          maxLabel="30%"
        />
      </Card>

      <p className="mt-6 mb-2 text-body-sm font-semibold text-ink-2">
        On a <AmountDisplay value={p.exampleOrder} size="sm" className="font-semibold text-ink-2" /> first purchase
      </p>
      <Card padding="lg">
        <SplitBreakdown
          variant="bar"
          total={p.exampleOrder}
          animate={false}
          parts={[
            { id: "venue", label: p.venueName, amount: s.venue, role: "venue" },
            { id: "c", label: "New customer", amount: s.cashback, role: "you" },
            { id: "l1", label: "Recommender", amount: s.l1, role: "referrer" },
            { id: "l2", label: "Their introducer", amount: s.l2, role: "introducer" },
          ]}
        />
        <dl className="mt-4 flex flex-col gap-2 text-body-sm">
          {[
            ["You keep", s.venue, false],
            ["Welcome back to the new customer", s.cashback, true],
            ["To whoever recommended you", s.l1, true],
            ["To whoever brought them in", s.l2, true],
          ].map(([label, amount, reward]) => (
            <div key={label as string} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-2">{label as string}</dt>
              <dd>
                <AmountDisplay value={amount as bigint} variant={reward ? "positive" : "plain"} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line pt-3 text-caption text-ink-3">
          Cost of this new customer: <AmountDisplay value={s.pool} size="sm" className="font-semibold text-ink-2" />. Repeat visits
          cost nothing.
        </p>
      </Card>

      <TextField
        className="mt-6"
        label="Minimum first order"
        prefix="$"
        inputMode="decimal"
        value={p.minOrder}
        onChange={(e) => p.onMinOrderChange(e.target.value)}
        hint="Rewards only apply above this amount."
      />
      <p className="mt-4 text-caption text-ink-3">
        Recommendations keep the reward they were made with. Changes apply to new ones only.
      </p>
    </Screen>
  );
}
