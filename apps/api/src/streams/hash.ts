import { createHash } from 'node:crypto';
import { asc } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { DbHandle } from '../db/index';
import type * as appSchema from '../db/schema';
import {
  evAmbassadors,
  evCursor,
  evEvents,
  evIntros,
  evPayments,
  evRewards,
  evSeeds,
  evTerms,
  evVenues,
  evVenueStats,
  evVerified,
} from './schema';

/**
 * Determinism hash of the derived state (D-306). sha256 over every hashed table, rows sorted by primary key, each row
 * a canonical JSON (sorted keys, jsonb normalized). Excluded on purpose (they legitimately differ between live,
 * replay and backfill): provenance (`source`, `delivery_id`, `ingested_at`), `block_timestamp` (Streams presence
 * UNVERIFIED), ev_ingest_log, and the cursor's batch/rebuild counters and timestamps.
 */

type Db = PgliteDatabase<typeof appSchema>;

interface HashSpec {
  name: string;
  table: PgTable;
  order: PgColumn[];
  omit: string[];
}

const SPECS: HashSpec[] = [
  { name: 'ev_events', table: evEvents, order: [evEvents.blockNumber, evEvents.logIndex], omit: ['source', 'deliveryId', 'ingestedAt', 'blockTimestamp'] },
  { name: 'ev_cursor', table: evCursor, order: [evCursor.id], omit: ['lastBatchEnd', 'rebuilds', 'updatedAt'] },
  { name: 'ev_venues', table: evVenues, order: [evVenues.venue], omit: [] },
  { name: 'ev_terms', table: evTerms, order: [evTerms.venue, evTerms.termsVersion], omit: [] },
  { name: 'ev_seeds', table: evSeeds, order: [evSeeds.venue, evSeeds.ambassador], omit: [] },
  { name: 'ev_intros', table: evIntros, order: [evIntros.txHash, evIntros.logIndex], omit: ['blockTimestamp'] },
  { name: 'ev_verified', table: evVerified, order: [evVerified.venue, evVerified.customer], omit: ['blockTimestamp'] },
  { name: 'ev_payments', table: evPayments, order: [evPayments.venue, evPayments.orderId], omit: ['blockTimestamp'] },
  { name: 'ev_rewards', table: evRewards, order: [evRewards.txHash, evRewards.logIndex], omit: ['blockTimestamp'] },
  { name: 'ev_venue_stats', table: evVenueStats, order: [evVenueStats.venue], omit: [] },
  { name: 'ev_ambassadors', table: evAmbassadors, order: [evAmbassadors.address, evAmbassadors.venue], omit: [] },
];

function canonical(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
  }
  return v;
}

const JSONB_COLS = new Set(['args', 'topics']);

export interface DerivedHash {
  hash: string;
  tables: Record<string, { rows: number; hash: string }>;
}

export async function hashDerived(handle: DbHandle): Promise<DerivedHash> {
  const db = handle.db as Db;
  const all = createHash('sha256');
  const tables: DerivedHash['tables'] = {};
  for (const spec of SPECS) {
    const rows = (await db
      .select()
      .from(spec.table)
      .orderBy(...spec.order.map((c) => asc(c)))) as Record<string, unknown>[];
    const h = createHash('sha256');
    for (const r of rows) {
      const kept: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        if (spec.omit.includes(k)) continue;
        // postgres-js may hand jsonb back as a string; normalize before canonicalizing.
        kept[k] = JSONB_COLS.has(k) && typeof v === 'string' ? JSON.parse(v) : v;
      }
      const line = `${spec.name}\t${JSON.stringify(canonical(kept))}\n`;
      h.update(line);
      all.update(line);
    }
    tables[spec.name] = { rows: rows.length, hash: h.digest('hex') };
  }
  return { hash: all.digest('hex'), tables };
}
