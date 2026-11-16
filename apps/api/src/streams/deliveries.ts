import { desc } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { DbHandle } from '../db/index';
import type * as schema from '../db/schema';
import { streamDeliveries } from '../db/schema';
import type { DeliverySummary } from '../routes/webhooks';

/**
 * Raw ingest of verified QuickNode Streams deliveries (D-305). The webhook route calls `insertDelivery` only after
 * the HMAC verdict is 200, and acknowledges QuickNode only once the row is committed (an insert failure → 500, so
 * QuickNode retries instead of the delivery being lost).
 */

export type NewDelivery = typeof streamDeliveries.$inferInsert;
export type DeliveryRow = typeof streamDeliveries.$inferSelect;

/** Header names kept in `stream_deliveries.headers`. Exact names plus the QuickNode `stream-*` / `batch-*` metadata. */
const KEEP_HEADERS = new Set(['content-type', 'content-encoding', 'content-length', 'user-agent', 'x-qn-nonce', 'x-qn-timestamp']);
const KEEP_PREFIX = /^(stream|batch)-/;

/**
 * Allow-list of non-secret delivery headers. `x-qn-signature` is left out on purpose (it is a MAC, not the token,
 * but nothing downstream needs it), as are auth/cookie/forwarding headers.
 */
export function pickHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = k.toLowerCase();
    if (v === undefined || !(KEEP_HEADERS.has(name) || KEEP_PREFIX.test(name))) continue;
    out[name] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

const int = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

export interface VerifiedDelivery {
  headers: Record<string, string | string[] | undefined>;
  bytes: number;
  gzip: boolean;
  /** Decoded (gunzipped) body text. */
  bodyText: string;
  /** Parsed JSON, or undefined when the body is not JSON. */
  json: unknown;
  summary: DeliverySummary | null;
}

export function buildDeliveryRow(d: VerifiedDelivery): NewDelivery {
  const h = pickHeaders(d.headers);
  const env = d.json && typeof d.json === 'object' && !Array.isArray(d.json) ? (d.json as Record<string, unknown>) : {};
  const bodyStreamId = typeof env.streamId === 'string' ? env.streamId : null;
  return {
    verified: true,
    streamId: h['stream-id'] ?? bodyStreamId,
    // QE-15: the batch-* headers are authoritative; the body's range is a fallback (a lower bound for batchSource "logs").
    batchStart: int(h['batch-start-range']) ?? d.summary?.batch?.start ?? null,
    batchEnd: int(h['batch-end-range']) ?? d.summary?.batch?.end ?? null,
    eventCount: d.summary?.logCount ?? 0,
    bytes: d.bytes,
    gzip: d.gzip,
    headers: h,
    summary: d.summary,
    body: d.json === undefined ? null : d.json,
    bodyText: d.json === undefined ? d.bodyText : null,
  };
}

/**
 * `DbHandle.db` is a union of the PGlite and postgres-js drizzle instances. Both expose the same pg-core query builder,
 * but TS cannot call methods on the union, so we view it through one of them (runtime behaviour is identical).
 */
type Db = PgliteDatabase<typeof schema>;

export async function insertDelivery(handle: DbHandle, row: NewDelivery): Promise<{ id: number }> {
  const db = handle.db as Db;
  const [r] = await db.insert(streamDeliveries).values(row).returning({ id: streamDeliveries.id });
  return r!;
}

export async function listDeliveries(handle: DbHandle, limit = 20): Promise<DeliveryRow[]> {
  const db = handle.db as Db;
  return db.select().from(streamDeliveries).orderBy(desc(streamDeliveries.id)).limit(limit);
}
