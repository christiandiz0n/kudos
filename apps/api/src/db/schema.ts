import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Phase 0: a single trivial table proving migrations run on both PGlite (local/tests) and Postgres
 * (deploy). BACKEND_RELAYER owns the real schema (Phase 2).
 */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Phase 1.5 (D-305): raw ingest of every HMAC-VERIFIED QuickNode Streams delivery, written before the 200 is sent.
 * Rejected requests (401/503/400) never get a row. This is the hosted, inspectable record; Phase 2 derives
 * decoded/idempotent tables from it (or from a replay). Not deduplicated: QuickNode retries may appear twice.
 */
export const streamDeliveries = pgTable(
  'stream_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    verified: boolean('verified').notNull(),
    /** `stream-id` header, else the envelope's `streamId`. */
    streamId: text('stream_id'),
    /** `batch-start-range`/`batch-end-range` headers (authoritative, QE-15), else the body's batch range. */
    batchStart: bigint('batch_start', { mode: 'number' }),
    batchEnd: bigint('batch_end', { mode: 'number' }),
    /** Logs found in the body (`summary.logCount`). */
    eventCount: integer('event_count').notNull().default(0),
    /** Request bytes as received (before gunzip). */
    bytes: integer('bytes').notNull(),
    gzip: boolean('gzip').notNull().default(false),
    /** Allow-listed non-secret headers: content-*, user-agent, x-qn-nonce, x-qn-timestamp, stream-*, batch-*. Never x-qn-signature. */
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    /** Parsed digest (shape, eventNames, txHashes, topic0s, blockRange, batch). */
    summary: jsonb('summary'),
    /** Decoded JSON body; null when the body is not JSON (then `body_text` holds it). */
    body: jsonb('body'),
    bodyText: text('body_text'),
  },
  (t) => [index('stream_deliveries_received_at_idx').on(t.receivedAt), index('stream_deliveries_stream_batch_idx').on(t.streamId, t.batchStart)],
);
