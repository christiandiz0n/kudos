"use client";

import { SPLIT_BPS, mulBps, parseUsdc } from "@vouch/shared";
import { AmountDisplay, AppBar, Button, Card, Icon, Screen, Slider, TextField } from "@/components/ui";
import { formatBps, formatMoney } from "@/design/money";

/** Contract-identical arithmetic (pool, then floor 25/55/20; venue gets the remainder). Single recommender + introducer. */
export function exampleSplit(order: bigint, rewardBps: number) {
  const pool = mulBps(order, rewardBps);
  const cashback = mulBps(pool, SPLIT_BPS.CASHBACK);
  const l1 = mulBps(pool, SPLIT_BPS.L1);
  const l2 = mulBps(pool, SPLIT_BPS.L2);
  const venue = order - cashback - l1 - l2;
  return { pool, cashback, l1, l2, venue, thanks: l1 + l2 };
}

/** Lowest minimum order the venue can set (API ORDER_MIN_USDC). */
export const MIN_ORDER_FLOOR = parseUsdc("0.50");

/** "5.00" → error copy or undefined. Use it in the route before calling onConfirm. */
export function validateMinOrder(v: string): string | undefined {
  try {
    const amt = parseUsdc(v.trim().replace(/^\$/, "") || "0");
    if (amt < MIN_ORDER_FLOOR) return `Set at least ${formatMoney(MIN_ORDER_FLOOR)}`;
    if (amt > parseUsdc("10000")) return "Set at most $10,000.00";
    return undefined;
  } catch {
    return "Use dollars and cents, e.g. 5.00";
  }
}

export interface VenueOnboardingScreenProps {
  venueName: string;
  onVenueNameChange: (v: string) => void;
  nameError?: string;
  /** Basis points; the slider moves in whole percent (5–30%). */
  rewardBps: number;
  onRewardBpsChange: (bps: number) => void;
  /** Example first purchase for the live preview. Default $12.00. */
  exampleOrder?: bigint;
  /** As typed, e.g. "5.00". */
  minOrder: string;
  onMinOrderChange: (v: string) => void;
  /** Use validateMinOrder. */
  minOrderError?: string;
  /** idle → confirming (Face ID / fingerprint prompt) → saving (relayed, waiting for the record) · error. */
  status?: "idle" | "confirming" | "saving" | "error";
  /** Shown when status = "error" (D-806 message). */
  error?: string;
  onConfirm?: () => void;
}

export function VenueOnboardingScreen(p: VenueOnboardingScreenProps) {
  const order = p.exampleOrder ?? parseUsdc("12.00");
  const s = exampleSplit(order, p.rewardBps);
  const busy = p.status === "confirming" || p.status === "saving";
  const invalid = !p.venueName.trim() || !!p.nameError || !!p.minOrderError;
  const name = p.venueName.trim() || "Your place";
  return (
    <Screen
      header={<AppBar title="Set up your place" large />}
      footer={
        <div className="flex flex-col gap-2">
          <p className="text-center text-caption text-ink-3">
            Start at <span className="font-semibold text-ink-2">{formatBps(p.rewardBps)}</span> · change it any time
          </p>
          <Button
            block
            size="lg"
            leadingIcon="faceId"
            disabled={invalid}
            loading={busy}
            loadingLabel={p.status === "confirming" ? "Waiting for Face ID…" : `Setting up ${name}…`}
            onClick={p.onConfirm}
          >
            Confirm with Face ID or fingerprint
          </Button>
        </div>
      }
    >
      <p className="-mt-1 text-body text-ink-2">You only pay when a recommendation brings in a new customer who buys. Nothing up front, no monthly fee.</p>

      {p.status === "error" && p.error ? (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2.5 text-body-sm text-danger-ink">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <p>{p.error}</p>
        </div>
      ) : null}

      <TextField
        className="mt-5"
        label="Name customers will see"
        placeholder="e.g. Lena's café"
        autoComplete="organization"
        maxLength={48}
        value={p.venueName}
        error={p.nameError}
        onChange={(e) => p.onVenueNameChange(e.target.value)}
        disabled={busy}
      />

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
        <div aria-live="polite" className="mt-5 border-t border-line pt-4">
          <p className="text-body-sm text-ink-2">
            On a <AmountDisplay value={order} size="sm" className="font-semibold text-ink" /> first purchase:
          </p>
          <p className="mt-1 text-title-2 text-ink">
            <AmountDisplay value={s.pool} size="lg" variant="positive" /> <span className="text-body font-medium text-ink-2">in rewards</span>
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-body">
            <li className="flex items-baseline justify-between gap-3">
              <span className="text-ink-2">Back to the customer</span>
              <AmountDisplay value={s.cashback} variant="positive" />
            </li>
            <li className="flex items-baseline justify-between gap-3">
              <span className="text-ink-2">To the people who sent them</span>
              <AmountDisplay value={s.thanks} variant="positive" />
            </li>
            <li className="flex items-baseline justify-between gap-3 border-t border-dashed border-line pt-2">
              <span className="font-semibold text-ink">You keep</span>
              <AmountDisplay value={s.venue} className="font-semibold" />
            </li>
          </ul>
          {/* Lightweight split bar (D-017: few elements, big type): what you keep vs the reward slice. */}
          <div aria-hidden className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface-3">
            <span className="h-full bg-[var(--vx-line-strong)]" style={{ width: `${100 - p.rewardBps / 100}%` }} />
            <span className="h-full flex-1 bg-accent" />
          </div>
          <div aria-hidden className="mt-1.5 flex justify-between text-caption text-ink-3">
            <span>You keep {100 - p.rewardBps / 100}%</span>
            <span className="font-semibold text-accent-ink">Rewards {formatBps(p.rewardBps)}</span>
          </div>
          <p className="mt-3 text-caption text-ink-3">Repeat visits cost nothing.</p>
        </div>
      </Card>

      <TextField
        className="mt-5"
        label="Minimum first order for a reward"
        prefix="$"
        inputMode="decimal"
        value={p.minOrder}
        error={p.minOrderError}
        hint={`Smaller first orders don't earn rewards. At least ${formatMoney(MIN_ORDER_FLOOR)}.`}
        onChange={(e) => p.onMinOrderChange(e.target.value)}
        disabled={busy}
      />
      <p className="mt-4 text-caption text-ink-3">Recommendations keep the reward they were made with. Changes apply to new ones only.</p>
    </Screen>
  );
}
