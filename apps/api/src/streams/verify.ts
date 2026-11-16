import { createHmac, randomBytes } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { buildApp } from '../app';
import { createDb, type DbHandle } from '../db/index';
import type * as appSchema from '../db/schema';
import { streamDeliveries } from '../db/schema';
import { insertDelivery } from './deliveries';
import { buildEnvelopes, loadFilter, type FilterMain, type RawLog } from './backfill';
import type { DerivedHash } from './hash';
import { createStreams, type Streams } from './index';

/**
 * Determinism harness (D-306): the same chain data through three independent paths must give the same derived hash.
 *   backfill: chain logs → frozen filter → envelope(s) → ingestEnvelope (one batch per range)
 *   live:     the same logs in QuickNode-like N-block batches → HMAC-signed POST /webhooks/streams (the real route,
 *             raw row + ingest), with every batch re-delivered once and an overlapping batch (retry/overlap no-ops)
 *   replay:   wipe derived → re-ingest every stream_deliveries row in id order
 *   rebuild:  wipe derived (keep ev_events) → re-apply ev_events in order
 * Used by the node:test suite (fixtures) and `pnpm streams:verify` (live RPC or a hosted DB).
 */

type Db = PgliteDatabase<typeof appSchema>;

export function qnSign(secret: string, nonce: string, timestamp: string, body: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(nonce + timestamp + body, 'utf8')).digest('hex');
}

export function signedHeaders(secret: string, body: string, extra: Record<string, string> = {}): Record<string, string> {
  const nonce = randomBytes(8).toString('hex');
  const ts = String(Math.floor(Date.now() / 1000));
  return { 'content-type': 'application/json', 'x-qn-nonce': nonce, 'x-qn-timestamp': ts, 'x-qn-signature': qnSign(secret, nonce, ts, body), ...extra };
}

export async function memoryStreams(): Promise<{ handle: DbHandle; streams: Streams }> {
  const handle = createDb('pglite://memory');
  await handle.migrate();
  return { handle, streams: createStreams(handle) };
}

export async function backfillHash(logs: RawLog[], from: number, to: number, filter: FilterMain = loadFilter()): Promise<DerivedHash> {
  const { handle, streams } = await memoryStreams();
  try {
    for (const env of buildEnvelopes(logs, from, to, { filter })) await streams.ingestEnvelope(env);
    return await streams.hash();
  } finally {
    await handle.close();
  }
}

export interface LiveOpts {
  batchSize?: number;
  /** Re-deliver every batch once (QuickNode retry) and add one overlapping batch. Default true. */
  noise?: boolean;
  filter?: FilterMain;
}

/** Simulated live Stream through the real webhook route on an in-memory api. Caller closes `app`. */
export async function liveViaWebhook(logs: RawLog[], from: number, to: number, o: LiveOpts = {}) {
  const secret = `verify-${randomBytes(12).toString('hex')}`;
  const { app, db, streams } = await buildApp({ databaseUrl: 'pglite://memory', streamsSpikeLog: null, streamsWebhookSecret: secret }, { logger: false });
  const filter = o.filter ?? loadFilter();
  const envs = buildEnvelopes(logs, from, to, { filter, batchSize: o.batchSize ?? 5, streamId: 'verify-live' }) as Array<{ batchStart: number; batchEnd: number }>;
  const posts: Array<{ body: unknown }> = [];
  for (const e of envs) {
    posts.push({ body: e });
    if (o.noise ?? true) posts.push({ body: e }); // QuickNode retry of the same batch
  }
  if ((o.noise ?? true) && envs.length >= 2) {
    // An overlapping batch spanning the first two batches (e.g. a stream restarted from an earlier block).
    const a = envs[0]!;
    const b = envs[1]!;
    const over = buildEnvelopes(logs, a.batchStart, b.batchEnd, { filter, streamId: 'verify-live' });
    for (const env of over) posts.push({ body: env });
  }
  const statuses: number[] = [];
  for (const p of posts) {
    const body = JSON.stringify(p.body);
    const env = p.body as { batchStart: number; batchEnd: number };
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/streams',
      headers: signedHeaders(secret, body, { 'stream-id': 'verify-live', 'batch-start-range': String(env.batchStart), 'batch-end-range': String(env.batchEnd) }),
      payload: body,
    });
    statuses.push(res.statusCode);
  }
  return { app, db, streams, deliveries: posts.length, statuses };
}

/** Copy verified deliveries (id order) from `source` into a fresh memory DB and replay them; returns the hash. */
export async function replayHashFrom(source: DbHandle): Promise<{ hash: DerivedHash; deliveries: number }> {
  const rows = await (source.db as Db)
    .select()
    .from(streamDeliveries)
    .where(eq(streamDeliveries.verified, true))
    .orderBy(asc(streamDeliveries.id));
  const { handle, streams } = await memoryStreams();
  try {
    for (const r of rows) {
      const { id: _id, ...rest } = r;
      await insertDelivery(handle, rest);
    }
    await streams.ingestPending({ emit: false, source: 'replay' });
    return { hash: await streams.hash(), deliveries: rows.length };
  } finally {
    await handle.close();
  }
}

export interface DeterminismReport {
  backfill: DerivedHash;
  live: DerivedHash;
  replay: DerivedHash;
  replayInPlace: DerivedHash;
  rebuild: DerivedHash;
  deliveries: number;
  statuses: number[];
  equal: boolean;
}

export async function runDeterminism(logs: RawLog[], from: number, to: number, o: LiveOpts = {}): Promise<DeterminismReport> {
  const filter = o.filter ?? loadFilter();
  const backfill = await backfillHash(logs, from, to, filter);
  const live = await liveViaWebhook(logs, from, to, { ...o, filter });
  try {
    const liveHash = await live.streams.hash();
    const replay = (await replayHashFrom(live.db)).hash;
    // Literal "wipe derived → rebuild from the raw table" on the live DB itself.
    await live.streams.wipeAll();
    await live.streams.ingestPending({ emit: false, source: 'replay' });
    const replayInPlace = await live.streams.hash();
    await live.streams.rebuild();
    const rebuild = await live.streams.hash();
    const all = [backfill, liveHash, replay, replayInPlace, rebuild].map((h) => h.hash);
    return {
      backfill,
      live: liveHash,
      replay,
      replayInPlace,
      rebuild,
      deliveries: live.deliveries,
      statuses: live.statuses,
      equal: all.every((h) => h === all[0]),
    };
  } finally {
    await live.app.close();
  }
}

/** Highest batch end among stored verified deliveries (the chain range a hosted DB should match), or null. */
export async function maxDeliveredBatchEnd(handle: DbHandle): Promise<number | null> {
  const [r] = await (handle.db as Db)
    .select({ m: sql<string | null>`max(${streamDeliveries.batchEnd})::text` })
    .from(streamDeliveries)
    .where(eq(streamDeliveries.verified, true));
  return r?.m ? Number(r.m) : null;
}
