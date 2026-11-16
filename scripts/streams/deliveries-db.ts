/**
 * Reads apps/api's `stream_deliveries` table (D-305) for `streams:deliveries --db`.
 *
 *   postgres:// | postgresql://  → postgres-js (e.g. Railway's DATABASE_PUBLIC_URL via `railway run`)
 *   pglite://<path>              → on-disk PGlite (path relative to the repo root, like the api). Stop the api first:
 *                                  PGlite is single-process.
 *
 * Read-only: one SELECT. The connection string is never printed (see redactDbUrl).
 */
import path from 'node:path';
import { REPO_ROOT } from './lib';

export interface DeliveryDbRow {
  id: number | string;
  received_at: Date | string;
  verified: boolean;
  stream_id: string | null;
  batch_start: number | string | null;
  batch_end: number | string | null;
  event_count: number;
  bytes: number;
  gzip: boolean;
  headers: Record<string, string> | string | null;
  summary: unknown;
  body: unknown;
  body_text: string | null;
}

/** NDJSON-record shape consumed by show-deliveries.ts (subset of what the api writes). */
export interface DeliveryRec {
  rowId?: number;
  receivedAt?: string;
  verified?: boolean;
  status?: number;
  reason?: string;
  headers?: Record<string, string>;
  bytes?: number;
  gzip?: boolean;
  timestamp?: { unit: string; skewSec: number | null } | null;
  body?: string;
  summary?: {
    logCount: number;
    blockRange: { from: number; to: number } | null;
    txHashes: string[];
    topic0s: string[];
    eventNames: string[];
    batch: { start: number | null; end: number | null } | null;
    shape: string;
  } | null;
}

/** jsonb may come back as a string from some driver setups; accept both. */
const asJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

export function rowToRec(r: DeliveryDbRow): DeliveryRec {
  const headers = (asJson(r.headers) ?? {}) as Record<string, string>;
  // The row's batch columns already apply the header-first rule; mirror them into the headers the viewer prints.
  if (r.stream_id && !headers['stream-id']) headers['stream-id'] = r.stream_id;
  if (r.batch_start !== null && !headers['batch-start-range']) headers['batch-start-range'] = String(num(r.batch_start));
  if (r.batch_end !== null && !headers['batch-end-range']) headers['batch-end-range'] = String(num(r.batch_end));
  const body = asJson(r.body);
  return {
    rowId: Number(r.id),
    receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : new Date(r.received_at).toISOString(),
    verified: r.verified,
    status: 200,
    headers,
    bytes: r.bytes,
    gzip: r.gzip,
    body: body === null || body === undefined ? (r.body_text ?? undefined) : JSON.stringify(body),
    summary: (asJson(r.summary) as DeliveryRec['summary']) ?? null,
  };
}

/** `postgres://user:pass@host:port/db` → `postgres://host:port/db` (never print credentials). */
export function redactDbUrl(url: string): string {
  if (url.startsWith('pglite://')) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<unparseable database url>';
  }
}

const SELECT = (verifiedOnly: boolean) =>
  `select id, received_at, verified, stream_id, batch_start, batch_end, event_count, bytes, gzip, headers, summary, body, body_text
     from stream_deliveries ${verifiedOnly ? 'where verified = true' : ''} order by id desc limit $1`;
const COUNT = 'select count(*)::int as n from stream_deliveries';

export async function readDbDeliveries(
  url: string,
  opts: { last: number; verifiedOnly: boolean },
): Promise<{ total: number; recs: DeliveryRec[] }> {
  let rows: DeliveryDbRow[];
  let total: number;
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
    try {
      total = (await sql.unsafe<{ n: number }[]>(COUNT))[0]!.n;
      rows = await sql.unsafe<DeliveryDbRow[]>(SELECT(opts.verifiedOnly), [opts.last]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  } else if (url.startsWith('pglite://')) {
    const target = url.replace(/^pglite:\/\//, '');
    if (!target || target === 'memory') throw new Error('pglite://memory has no data outside the api process; use an on-disk path');
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(path.resolve(REPO_ROOT, target));
    try {
      total = (await db.query<{ n: number }>(COUNT)).rows[0]!.n;
      rows = (await db.query<DeliveryDbRow>(SELECT(opts.verifiedOnly), [opts.last])).rows;
    } finally {
      await db.close();
    }
  } else {
    throw new Error(`unsupported database url ${redactDbUrl(url)} (expected postgres:// or pglite://<path>)`);
  }
  // Oldest first, like the NDJSON file.
  return { total, recs: rows.reverse().map(rowToRec) };
}
