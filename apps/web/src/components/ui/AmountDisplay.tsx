import { cn } from "@/design/cn";
import { moneyParts, type MoneyPrecision } from "@/design/money";

export type AmountSize = "sm" | "md" | "lg" | "xl" | "display";
/**
 * - `plain`    $12.00 in ink.
 * - `positive` +$0.45 in green: money coming to someone. The only place green text appears.
 * - `signed`   +/− shown; positive green, negative ink (spending is not an error, so never red).
 * - `muted`    secondary ink.
 */
export type AmountVariant = "plain" | "positive" | "signed" | "muted";

const sizeClass: Record<AmountSize, string> = {
  sm: "text-body-sm font-medium",
  md: "text-body font-semibold",
  lg: "text-title-2",
  xl: "text-title-1",
  display: "text-display",
};

export interface AmountDisplayProps {
  /** USDC base units (6 dp) as bigint. Never a float. */
  value: bigint;
  size?: AmountSize;
  variant?: AmountVariant;
  /** "cents" (default) rounds half-up to $0.01 for primary screens; "exact" keeps sub-cent ($0.693). */
  precision?: MoneyPrecision;
  /** At lg+ sizes, render "$" and the cents smaller (receipt-style). Default true for display/xl. */
  splitCents?: boolean;
  className?: string;
  as?: "span" | "p" | "div" | "dd" | "data";
}

/** Dollars from integer base units, always tabular. */
export function AmountDisplay({
  value,
  size = "md",
  variant = "plain",
  precision = "cents",
  splitCents,
  className,
  as: Tag = "span",
}: AmountDisplayProps) {
  const showPlus = variant === "positive" || variant === "signed";
  const p = moneyParts(variant === "positive" && value < 0n ? -value : value, { precision, showPlus });
  const tone =
    variant === "muted"
      ? "text-ink-2"
      : variant === "positive" || (variant === "signed" && value > 0n)
        ? "text-accent-ink"
        : "text-ink";
  const small = splitCents ?? (size === "display" || size === "xl");
  const text = `${p.sign}${p.symbol}${p.whole}${p.fraction ? `.${p.fraction}` : ""}`;

  return (
    <Tag className={cn("money inline-flex items-baseline whitespace-nowrap", sizeClass[size], tone, className)}>
      {small ? (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden className="inline-flex items-baseline">
            {p.sign ? <span className="mr-[0.04em]">{p.sign}</span> : null}
            <span className="mr-[0.03em] self-start pt-[0.12em] text-[0.55em] font-semibold">{p.symbol}</span>
            <span>{p.whole}</span>
            {p.fraction ? <span className="text-[0.55em] font-semibold">.{p.fraction}</span> : null}
          </span>
        </>
      ) : (
        text
      )}
    </Tag>
  );
}
