import { createHash } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { DbHandle } from '../db/index';
import type * as schema from '../db/schema';
import { streamDeliveries } from '../db/schema';
import { evDeliveryKeys } from './schema';
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

/**
 * Raw dedupe key (SEC-2-10b, D-309): sha256 over stream id, batch range and the decoded body (JSON re-serialized from
 * the parsed body, which is deterministic for the same bytes; else the body text). The nonce/signature are NOT in the
 * key, so a replayed signed delivery and a QuickNode retry of an already-stored batch both map to the first row.
 */
export function deliveryKey(row: NewDelivery): string {
  const body = row.body !== null && row.body !== undefined ? JSON.stringify(row.body) : (row.bodyText ?? '');
  return createHash('sha256').update(`${row.streamId ?? ''}|${row.batchStart ?? ''}|${row.batchEnd ?? ''}|`).update(body).digest('hex');
}

/**
 * Insert a verified delivery, deduped on `deliveryKey`. Returns the existing row id with `duplicate: true` for a repeat
 * (its `repeats` counter is bumped). One transaction, so a key never exists without its row. `dedupe: false` inserts
 * unconditionally (tests / forensic copies).
 */
export async function insertDelivery(handle: DbHandle, row: NewDelivery, opts: { dedupe?: boolean } = {}): Promise<{ id: number; duplicate: boolean }> {
  const db = handle.db as Db;
  if (opts.dedupe === false) {
    const [r] = await db.insert(streamDeliveries).values(row).returning({ id: streamDeliveries.id });
    return { id: r!.id, duplicate: false };
  }
  const key = deliveryKey(row);
  return db.transaction(async (tx) => {
    const [seen] = await tx
      .update(evDeliveryKeys)
      .set({ repeats: sql`${evDeliveryKeys.repeats} + 1`, lastAt: new Date() })
      .where(eq(evDeliveryKeys.key, key))
      .returning({ id: evDeliveryKeys.deliveryId });
    if (seen) return { id: seen.id, duplicate: true };
    const [r] = await tx.insert(streamDeliveries).values(row).returning({ id: streamDeliveries.id });
    await tx.insert(evDeliveryKeys).values({ key, deliveryId: r!.id });
    return { id: r!.id, duplicate: false };
  });
}

export async function listDeliveries(handle: DbHandle, limit = 20): Promise<DeliveryRow[]> {
  const db = handle.db as Db;
  return db.select().from(streamDeliveries).orderBy(desc(streamDeliveries.id)).limit(limit);
}
