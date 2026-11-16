import type { ReactNode } from "react";
import { cn } from "@/design/cn";
import { formatMoney, type MoneyPrecision } from "@/design/money";
import { AmountDisplay } from "./AmountDisplay";
import { Avatar } from "./Avatar";

export type SplitRole = "venue" | "you" | "referrer" | "introducer";

export interface SplitPart {
  id: string;
  /** Who receives it, in plain words: "Lena's café", "You", "Ana". */
  label: string;
  /** Why, in plain words: "recommended Lena's", "welcome back", "brought Ana in". */
  reason?: string;
  /** USDC base units. Parts must sum to `total`. */
  amount: bigint;
  role: SplitRole;
}

export interface SplitBreakdownProps {
  total: bigint;
  parts: SplitPart[];
  /**
   * `receipt` (default): the signature card: perforated receipt, split bar with a magnifying "loupe"
   * on the reward slice, then one line per recipient.
   * `bar`: just the bar + loupe (compact, e.g. inside the pay sheet).
   * `lines`: just the recipient lines.
   */
  variant?: "receipt" | "bar" | "lines";
  title?: ReactNode;
  /** Highlights one row (usually "you"). */
  highlightId?: string;
  precision?: MoneyPrecision;
  /** Bars grow in on mount (disabled under reduced motion by tokens.css). */
  animate?: boolean;
  className?: string;
}

/** One hue, stepped lighter: first reward recipient is full accent. */
const REWARD_FILLS = ["bg-accent", "bg-accent-2", "bg-accent-3", "bg-accent-4"];
function fillFor(i: number) {
  return REWARD_FILLS[Math.min(i, REWARD_FILLS.length - 1)];
}

function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 100_000n) / whole) / 1000; // 3dp percent, no float money math
}

/**
 * "Who gets what" for one payment. The Vouch signature motif: a receipt whose total splits into the
 * venue's share and a reward slice, which a loupe magnifies into the people who made the sale happen.
 */
export function SplitBreakdown({
  total,
  parts,
  variant = "receipt",
  title,
  highlightId,
  precision = "cents",
  animate = true,
  className,
}: SplitBreakdownProps) {
  const venueParts = parts.filter((p) => p.role === "venue");
  const rewardParts = parts.filter((p) => p.role !== "venue");
  const venueAmount = venueParts.reduce((a, p) => a + p.amount, 0n);
  const pool = rewardParts.reduce((a, p) => a + p.amount, 0n);
  const venuePct = pct(venueAmount, total);
  const rewardIndex = new Map(rewardParts.map((p, i) => [p.id, i]));

  const summary = `${formatMoney(total)} total. ${parts.map((p) => `${p.label}: ${formatMoney(p.amount, { precision })}`).join(". ")}.`;

  const bar = (
    <div aria-hidden className="select-none">
      <div className="mb-1.5 flex items-baseline justify-between text-caption text-ink-3">
        <span>{venueParts[0]?.label ?? "Venue"}</span>
        <span className="money font-medium text-accent-ink">{formatMoney(pool)} in rewards</span>
      </div>
      {/* Whole sale */}
      <div className={cn("flex h-2.5 overflow-hidden rounded-full bg-surface-3", animate && "vx-grow-x")}>
        <span className="h-full bg-line-strong" style={{ width: `${venuePct}%` }} />
        <span className="h-full flex-1 bg-accent" />
      </div>
      {/* Loupe: the reward slice, magnified to full width */}
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="block h-5 w-full">
        <polygon points={`${venuePct},0 100,0 100,20 0,20`} fill="var(--vx-accent-soft)" />
        <line x1={venuePct} y1={0} x2={0} y2={20} stroke="var(--vx-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={100} y1={0} x2={100} y2={20} stroke="var(--vx-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex h-7 gap-[3px] overflow-hidden rounded-sm bg-accent-soft p-[3px]">
        {rewardParts.map((p, i) => (
          <span
            key={p.id}
            className={cn("h-full rounded-[5px]", fillFor(i), animate && "vx-grow-x")}
            style={{ width: `${pct(p.amount, pool)}%`, animationDelay: animate ? `${200 + i * 70}ms` : undefined }}
          />
        ))}
      </div>
    </div>
  );

  const lines = (
    <ul className="flex flex-col">
      {parts.map((p) => {
        const isVenue = p.role === "venue";
        const isYou = p.role === "you";
        const ri = rewardIndex.get(p.id) ?? 0;
        const highlighted = highlightId === p.id;
        return (
          <li
            key={p.id}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-md py-2",
              highlighted && "-mx-2 bg-accent-soft px-2",
            )}
          >
            <span aria-hidden className={cn("h-6 w-1 shrink-0 rounded-full", isVenue ? "bg-line-strong" : fillFor(ri))} />
            <Avatar name={p.label} size="sm" kind={isVenue ? "venue" : isYou ? "you" : "person"} />
            <span className="min-w-0 shrink">
              <span className="block truncate text-body-sm font-semibold text-ink">{p.label}</span>
              {p.reason ? <span className="block truncate text-caption text-ink-3">{p.reason}</span> : null}
            </span>
            <span aria-hidden className="mx-1 h-px min-w-3 flex-1 self-end mb-3 border-b border-dotted border-line-strong/70" />
            <AmountDisplay value={p.amount} precision={precision} size="md" variant={isVenue ? "plain" : "positive"} />
          </li>
        );
      })}
    </ul>
  );

  if (variant === "bar") {
    return (
      <div className={className} role="img" aria-label={summary}>
        {bar}
      </div>
    );
  }
  if (variant === "lines") {
    return (
      <div className={className}>
        <span className="sr-only">{summary}</span>
        {lines}
      </div>
    );
  }

  return (
    <figure className={cn("relative", className)}>
      <div className="perforated-top perforated-bottom rounded-sm bg-surface px-4 pt-6 pb-6 shadow-1">
        <figcaption className="mb-4 flex items-baseline justify-between gap-3">
          <span className="text-body-sm font-medium text-ink-2">{title ?? "Where your money goes"}</span>
          <AmountDisplay value={total} size="lg" />
        </figcaption>
        {bar}
        <div className="mt-4 border-t border-dashed border-line pt-2">{lines}</div>
        <div className="mt-2 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-body-sm font-semibold text-ink">Total</span>
          <AmountDisplay value={total} size="md" />
        </div>
      </div>
    </figure>
  );
}
