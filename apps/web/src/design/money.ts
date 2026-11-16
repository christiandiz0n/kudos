import { USDC_UNIT, formatUsd } from "@vouch/shared";

/**
 * Display helpers for money on primary screens. Amounts are ALWAYS bigint USDC base units (6 dp).
 * Formatting goes through @vouch/shared `formatUsd`; this file only adds cent rounding and grouping.
 * No floats anywhere.
 */
export type MoneyPrecision = "cents" | "exact";

const CENT = USDC_UNIT / 100n; // 10_000n base units

/** Round half-up (away from zero) to whole cents. 693_000n -> 690_000n, 297_000n -> 300_000n. */
export function roundToCents(value: bigint): bigint {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const rounded = ((abs + CENT / 2n) / CENT) * CENT;
  return neg ? -rounded : rounded;
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface MoneyParts {
  sign: "" | "+" | "−";
  symbol: "$";
  whole: string; // grouped, e.g. "1,234"
  fraction: string; // without the dot, e.g. "00" or "693"
}

/**
 * Split an amount into display parts. `showPlus` adds "+" to positive values (money in).
 * Negative values use a true minus sign (U+2212), which aligns with tabular digits.
 */
export function moneyParts(
  value: bigint,
  opts: { precision?: MoneyPrecision; showPlus?: boolean } = {},
): MoneyParts {
  const v = opts.precision === "exact" ? value : roundToCents(value);
  const neg = v < 0n;
  const s = formatUsd(neg ? -v : v).slice(1); // "12.00" | "0.693"
  const [whole, fraction = ""] = s.split(".");
  return {
    sign: neg ? "−" : opts.showPlus && v > 0n ? "+" : "",
    symbol: "$",
    whole: group(whole),
    fraction,
  };
}

/** "$12.00", "+$0.45", "−$12.00", "$1,234.50". */
export function formatMoney(value: bigint, opts: { precision?: MoneyPrecision; showPlus?: boolean } = {}): string {
  const p = moneyParts(value, opts);
  return `${p.sign}${p.symbol}${p.whole}${p.fraction ? `.${p.fraction}` : ""}`;
}

/** Basis points -> "15%" / "12.5%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}
