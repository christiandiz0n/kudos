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
   * `receipt` (default): the signature card: perforated receipt, split bar with a magnifier on the
   * reward slice, then one line per recipient.
   * `bar`: the bar + magnifier + a 3-column legend (compact, e.g. inside the pay sheet).
   * `lines`: just the recipient lines.
   */
  variant?: "receipt" | "bar" | "lines";
  title?: ReactNode;
  /** Highlights one row (usually "you"). */
  highlightId?: string;
  precision?: MoneyPrecision;
  /** Bars grow in on mount (disabled under reduced motion by tokens.css). */
  animate?: boolean;
  /**
   * The payment went through but hasn't settled yet (Phase 3: settlement arrives a few seconds later).
   * The receipt renders in gray with an "Arriving" tag; flipping to false floods it green.
   */
  pending?: boolean;
  className?: string;
}

/**
 * One fill per GROUP (you / recommenders / who brought them in), not per person: the magnifier stays
 * readable on a projector (D-017: lightweight, big type, few elements). One hue, stepped lighter.
 */
const GROUP_FILLS = ["bg-accent", "bg-accent-2", "bg-accent-3"];
const GROUP_ORDER: SplitRole[] = ["you", "referrer", "introducer"];

function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 100_000n) / whole) / 1000; // 3dp percent, no float money math
}

function joinShort(names: string[]): string {
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]} + ${names.length - 1}`;
}

interface Group {
  role: Exclude<SplitRole, "venue">;
  label: string;
  amount: bigint;
  fill: string;
}

function groupsOf(rewardParts: SplitPart[]): Group[] {
  const out: Group[] = [];
  for (const role of GROUP_ORDER) {
    const members = rewardParts.filter((p) => p.role === role);
    if (!members.length) continue;
    out.push({
      role: role as Group["role"],
      label: joinShort(members.map((m) => m.label)),
      amount: members.reduce((a, m) => a + m.amount, 0n),
      fill: GROUP_FILLS[Math.min(out.length, GROUP_FILLS.length - 1)],
    });
  }
  return out;
}

/**
 * "Who gets what" for one payment. The Vouch signature motif: a receipt whose total splits into the
 * venue's share and a reward slice, which a magnifier enlarges into the (groups of) people who made the
 * sale happen. Lines below name every person.
 */
export function SplitBreakdown({
  total,
  parts,
  variant = "receipt",
  title,
  highlightId,
  precision = "cents",
  animate = true,
  pending = false,
  className,
}: SplitBreakdownProps) {
  const venueParts = parts.filter((p) => p.role === "venue");
  const rewardParts = parts.filter((p) => p.role !== "venue");
  const venueAmount = venueParts.reduce((a, p) => a + p.amount, 0n);
  const pool = rewardParts.reduce((a, p) => a + p.amount, 0n);
  const venuePct = pct(venueAmount, total);
  const groups = groupsOf(rewardParts);
  const fillByRole = new Map(groups.map((g) => [g.role, g.fill]));
  const people = rewardParts.length;

  const summary = `${formatMoney(total)} total. ${parts.map((p) => `${p.label}: ${formatMoney(p.amount, { precision })}`).join(". ")}.`;

  const bar = (
    <div aria-hidden className={cn("select-none transition-[filter] duration-[var(--vx-dur-slow)]", pending && "grayscale")}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-body-sm">
        <span className="min-w-0 truncate text-ink-2">
          {venueParts[0]?.label ?? "Venue"} <span className="money font-semibold text-ink">{formatMoney(venueAmount)}</span>
        </span>
        {pool > 0n ? (
          <span className="shrink-0 font-semibold text-accent-ink">
            <span className="money">{formatMoney(pool)}</span> to {people} {people === 1 ? "person" : "people"}
          </span>
        ) : null}
      </div>
      {/* Whole sale: venue share + reward slice */}
      <div className={cn("flex h-3 overflow-hidden rounded-full bg-surface-3", animate && "vx-grow-x")}>
        <span className="h-full bg-line-strong" style={{ width: `${venuePct}%` }} />
        {pool > 0n ? <span className="h-full flex-1 bg-accent" /> : null}
      </div>
      {pool > 0n ? (
        <>
          {/* Magnifier: one soft wedge from the reward slice to full width. No hairlines, no fine detail. */}
          <svg viewBox="0 0 100 16" preserveAspectRatio="none" className="block h-4 w-full">
            <polygon points={`${Math.max(venuePct - 0.5, 0)},0 100,0 100,16 0,16`} fill="var(--vx-accent-soft)" />
          </svg>
          <div className="flex h-8 gap-1 rounded-md bg-accent-soft p-1">
            {groups.map((g, i) => (
              <span
                key={g.role}
                className={cn("h-full min-w-2 rounded-[6px]", g.fill, animate && "vx-grow-x")}
                style={{ width: `${pct(g.amount, pool)}%`, animationDelay: animate ? `${200 + i * 90}ms` : undefined }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );

  const legend =
    pool > 0n ? (
      <ul aria-hidden className={cn("mt-3 grid gap-2", groups.length >= 3 ? "grid-cols-3" : groups.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {groups.map((g) => (
          <li key={g.role} className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className={cn("size-2.5 shrink-0 rounded-full", pending ? "bg-line-strong" : g.fill)} />
              <span className="truncate text-body-sm font-semibold text-ink">{g.label}</span>
            </span>
            <span className={cn("money block pl-4 text-body font-semibold", pending ? "text-ink-2" : "text-accent-ink")}>
              +{formatMoney(g.amount)}
            </span>
          </li>
        ))}
      </ul>
    ) : null;

  const lines = (
    <ul className="flex flex-col">
      {parts.map((p) => {
        const isVenue = p.role === "venue";
        const isYou = p.role === "you";
        const highlighted = highlightId === p.id;
        return (
          <li
            key={p.id}
            className={cn("flex min-h-12 items-center gap-3 rounded-md py-2", highlighted && (pending ? "-mx-2 bg-surface-2 px-2" : "-mx-2 bg-accent-soft px-2"))}
          >
            <span
              aria-hidden
              className={cn(
                "h-6 w-1 shrink-0 rounded-full transition-colors duration-[var(--vx-dur-slow)]",
                isVenue || pending ? "bg-line-strong" : fillByRole.get(p.role as Group["role"]),
              )}
            />
            <Avatar name={p.label} size="sm" kind={isVenue ? "venue" : isYou ? "you" : "person"} />
            <span className="min-w-0 shrink">
              <span className="block truncate text-body-sm font-semibold text-ink">{p.label}</span>
              {p.reason ? <span className="block truncate text-caption text-ink-3">{p.reason}</span> : null}
            </span>
            <span aria-hidden className="mx-1 mb-3 h-px min-w-3 flex-1 self-end border-b border-dotted border-line-strong/70" />
            <AmountDisplay value={p.amount} precision={precision} size="md" variant={isVenue ? "plain" : pending ? "muted" : "positive"} />
          </li>
        );
      })}
    </ul>
  );

  if (variant === "bar") {
    return (
      <div className={className} role="img" aria-label={summary}>
        {bar}
        {legend}
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
    <figure className={cn("relative", className)} aria-busy={pending || undefined}>
      <div className="perforated-top perforated-bottom rounded-sm bg-surface px-4 pt-6 pb-6 shadow-1">
        <figcaption className="mb-4 flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-2 text-body-sm font-medium text-ink-2">
            {title ?? "Where your money goes"}
            {pending ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-caption font-medium text-ink-2">
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
                Arriving
              </span>
            ) : null}
          </span>
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
