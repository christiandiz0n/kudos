/**
 * JSON helpers: amounts and other uint values travel as decimal strings of base units (INTERFACES §5), never as JS
 * numbers. `toJson` turns every bigint into a string; the small validators below parse request bodies strictly.
 */
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';
import { formatUsdc } from '@vouch/shared';
import { ApiError } from './errors';

export type Jsonish = string | number | boolean | null | Jsonish[] | { [k: string]: Jsonish };

export function toJson(v: unknown): Jsonish {
  if (typeof v === 'bigint') return v.toString();
  if (v === undefined) return null;
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === 'object') {
    const out: Record<string, Jsonish> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = toJson(x);
    return out;
  }
  return String(v);
}

/** `{ baseUnits: "693000", display: "0.693" }` — the money shape every endpoint uses. */
export function money(baseUnits: bigint) {
  return { baseUnits: baseUnits.toString(), display: formatUsdc(baseUnits) };
}

const bad = (field: string, why: string) => new ApiError('BAD_REQUEST', { message: `${field}: ${why}`, details: { field } });

export function obj(body: unknown, field = 'body'): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad(field, 'expected an object');
  return body as Record<string, unknown>;
}

export function addr(v: unknown, field: string): Address {
  if (typeof v !== 'string' || !isAddress(v, { strict: false })) throw bad(field, 'expected an address');
  return getAddress(v);
}

export function optAddr(v: unknown, field: string): Address | undefined {
  return v === undefined || v === null || v === '' ? undefined : addr(v, field);
}

export function hex(v: unknown, field: string, bytes?: number): Hex {
  if (typeof v !== 'string' || !isHex(v, { strict: true })) throw bad(field, 'expected 0x-hex');
  if (bytes !== undefined && v.length !== 2 + bytes * 2) throw bad(field, `expected ${bytes} bytes`);
  return v.toLowerCase() as Hex;
}

export function sig(v: unknown, field = 'signature'): Hex {
  const h = hex(v, field);
  if (h.length < 132) throw bad(field, 'signature too short');
  return h;
}

export function uint(v: unknown, field: string): bigint {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v !== 'string' || !/^\d{1,78}$/.test(v)) throw bad(field, 'expected a decimal string of base units');
  return BigInt(v);
}

export function int(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(field, `expected an integer in [${min}, ${max}]`);
  return n;
}

export function str(v: unknown, field: string, max = 200, opts: { optional?: boolean; min?: number } = {}): string | undefined {
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw bad(field, 'required');
  }
  if (typeof v !== 'string') throw bad(field, 'expected a string');
  const s = v.trim();
  if (s.length < (opts.min ?? (opts.optional ? 0 : 1)) || s.length > max) throw bad(field, `length must be ≤ ${max}`);
  return s;
}

export function reqStr(v: unknown, field: string, max = 200): string {
  return str(v, field, max) as string;
}

export function oneOf<T extends string>(v: unknown, field: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw bad(field, `expected one of ${values.join(', ')}`);
  return v as T;
}

export const lc = (a: string) => a.toLowerCase();
export const sameAddr = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
