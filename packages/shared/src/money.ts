import { BPS_DENOMINATOR } from './constants';
import { NATIVE_GAS_DECIMALS, USDC_DECIMALS } from './chains';

/**
 * Money helpers. All amounts are bigint base units. NEVER use floats for money.
 *  - USDC ERC-20 amounts: 6 decimals (1 USDC = 1_000_000n). D-102
 *  - Native gas amounts on Arc (gasPrice, fees, eth_getBalance): 18 decimals, same balance
 *    (balanceOf == floor(native / 1e12)). Only relayer gas accounting uses these. D-102
 */

export const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);
export const NATIVE_UNIT = 10n ** BigInt(NATIVE_GAS_DECIMALS);

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d*))?$/;

/** Parse a decimal string (e.g. "12", "12.5", "$1,234.56") into base units with `decimals`. Rejects excess precision. */
export function parseUnitsStrict(input: string, decimals: number): bigint {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = DECIMAL_RE.exec(cleaned);
  if (!m) throw new Error(`Invalid amount: "${input}"`);
  const neg = m[1] === '-';
  const whole = m[2] ?? '0';
  const frac = m[3] ?? '';
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places (max ${decimals}): "${input}"`);
  }
  const fracPadded = frac.padEnd(decimals, '0');
  const value = BigInt(whole) * 10n ** BigInt(decimals) + (fracPadded ? BigInt(fracPadded) : 0n);
  return neg ? -value : value;
}

/** Format base units as a decimal string with at least `minFraction` and at most `decimals` fraction digits. */
export function formatUnitsFixed(value: bigint, decimals: number, minFraction = 2): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  let frac = (abs % unit).toString().padStart(decimals, '0');
  while (frac.length > minFraction && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${neg ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`;
}

/** "12.00" | "$12" | "12.5" -> 12_000_000n */
export function parseUsdc(dollars: string): bigint {
  return parseUnitsStrict(dollars, USDC_DECIMALS);
}

/** 12_000_000n -> "12.00"; 693_000n -> "0.693" (keeps sub-cent precision, min 2 fraction digits). */
export function formatUsdc(baseUnits: bigint, opts: { minFraction?: number } = {}): string {
  return formatUnitsFixed(baseUnits, USDC_DECIMALS, opts.minFraction ?? 2);
}

/** 12_000_000n -> "$12.00" */
export function formatUsd(baseUnits: bigint): string {
  const s = formatUsdc(baseUnits);
  return s.startsWith('-') ? `-$${s.slice(1)}` : `$${s}`;
}

/** Native 18-dec gas amount -> USDC 6-dec base units, rounding UP (never under-report fees). */
export function nativeToUsdcBaseUnits(nativeAmount: bigint): bigint {
  const scale = 10n ** BigInt(NATIVE_GAS_DECIMALS - USDC_DECIMALS);
  return (nativeAmount + scale - 1n) / scale;
}

/** Native 18-dec gas amount -> full-precision decimal string in USDC (e.g. "0.000123456789"). */
export function formatNativeAsUsdc(nativeAmount: bigint): string {
  return formatUnitsFixed(nativeAmount, NATIVE_GAS_DECIMALS, 2);
}

/** floor(amount * bps / 10_000) */
export function mulBps(amount: bigint, bps: number | bigint): bigint {
  return (amount * BigInt(bps)) / BigInt(BPS_DENOMINATOR);
}
