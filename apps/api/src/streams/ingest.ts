import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { DbHandle } from '../db/index';
import type * as appSchema from '../db/schema';
import { compareEvents, type DecodedBatch, type DecodedEvent } from './decode';
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
 * Idempotent, ordered ingestion of decoded Vouch events into the ev_* tables (D-306).
 *
 *  1. One transaction per batch, serialized in-process (mutex) and across processes (pg_advisory_xact_lock).
 *  2. INSERT … ON CONFLICT (tx_hash, log_index) DO NOTHING into ev_events → only NEW events continue.
 *     Re-deliveries, QuickNode retries and overlapping batches are therefore no-ops.
 *  3. If every new event sorts after the cursor (block, logIndex), apply them incrementally in (block, logIndex) order.
 *     If any new event sorts BEFORE the cursor (late/out-of-order batch, a replay of an earlier failed delivery, a
 *     backfill under live data), the derived tables are wiped and rebuilt from ev_events in order. Either way the
 *     derived state is a pure function of the SET of events, so live, replay and backfill hash identically.
 *  4. Venue stats and ambassador rows are recomputed by SQL aggregate for every touched key, in the same transaction.
 *  5. The cursor is the max (block, logIndex) in ev_events plus counters.
 */

type Db = PgliteDatabase<typeof appSchema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

export const CURSOR_ID = 'vouch';
const LOCK_KEY = 7_305_002; // arbitrary, constant: "streams ingest"

export type IngestSource = 'stream' | 'replay' | 'backfill';

export interface IngestOptions {
  source: IngestSource;
  deliveryId?: number | null;
}

export interface IngestOutcome {
  logs: number;
  newEvents: DecodedEvent[];
  duplicates: number;
  ignored: number;
  rebuilt: boolean;
  cursor: { lastBlock: number | null; lastLogIndex: number | null; events: number };
}

let chain: Promise<unknown> = Promise.resolve();
/** In-process serialization of ingest transactions (PGlite has one connection; ordering must be total). */
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

const asDb = (handle: DbHandle) => handle.db as Db;

const s = (v: string | number | boolean | undefined) => String(v);
const n = (v: string | number | boolean | undefined) => Number(v);
const b = (v: string | number | boolean | undefined) => v === true || v === 'true';

type Touched = { venues: Set<string>; ambassadors: Map<string, { address: string; venue: string }> };

async function applyEvent(q: Q, ev: DecodedEvent, touched: Touched): Promise<void> {
  const a = ev.args;
  const venue = s(a.venue);
  touched.venues.add(venue);
  switch (ev.event) {
    case 'VenueRegistered':
      await q
        .insert(evVenues)
        .values({
          venue,
          owner: s(a.owner),
          salt: s(a.salt),
          payout: s(a.payout),
          signer: s(a.signer),
          attributor: s(a.attributor),
          metadataUri: s(a.metadataURI),
          registeredTx: ev.txHash,
          registeredBlock: ev.blockNumber,
        })
        .onConflictDoNothing();
      return;
    case 'TermsUpdated': {
      const version = n(a.termsVersion);
      await q
        .insert(evTerms)
        .values({ venue, termsVersion: version, rewardBps: n(a.rewardBps), minOrder: s(a.minOrder), effectiveAt: n(a.effectiveAt), txHash: ev.txHash, blockNumber: ev.blockNumber })
        .onConflictDoNothing();
      await q
        .update(evVenues)
        .set({ termsVersion: version, rewardBps: n(a.rewardBps), minOrder: s(a.minOrder) })
        .where(and(eq(evVenues.venue, venue), sql`(${evVenues.termsVersion} is null or ${evVenues.termsVersion} < ${version})`));
      return;
    }
    case 'VenueKeysUpdated':
      await q.update(evVenues).set({ payout: s(a.payout), signer: s(a.signer), attributor: s(a.attributor), keysTx: ev.txHash }).where(eq(evVenues.venue, venue));
      return;
    case 'SeedAmbassadorSet':
      await q
        .insert(evSeeds)
        .values({ venue, ambassador: s(a.ambassador), allowed: b(a.allowed), txHash: ev.txHash, blockNumber: ev.blockNumber })
        .onConflictDoUpdate({ target: [evSeeds.venue, evSeeds.ambassador], set: { allowed: b(a.allowed), txHash: ev.txHash, blockNumber: ev.blockNumber } });
      return;
    case 'IntroAccepted':
      await q
        .insert(evIntros)
        .values({
          txHash: ev.txHash,
          logIndex: ev.logIndex,
          venue,
          referrer: s(a.referrer),
          customer: s(a.customer),
          introHash: s(a.introHash),
          termsVersion: n(a.termsVersion),
          linkType: n(a.linkType),
          expiresAt: n(a.expiresAt),
          blockNumber: ev.blockNumber,
          blockTimestamp: ev.blockTimestamp,
        })
        .onConflictDoNothing();
      return;
    case 'IntroDropped':
      await q
        .update(evIntros)
        .set({ live: false, droppedReason: n(a.reason), droppedTx: ev.txHash })
        .where(
          and(
            eq(evIntros.venue, venue),
            eq(evIntros.customer, s(a.customer)),
            eq(evIntros.referrer, s(a.referrer)),
            eq(evIntros.introHash, s(a.introHash)),
            eq(evIntros.live, true),
          ),
        );
      return;
    case 'CustomerVerified':
      await q
        .insert(evVerified)
        .values({
          venue,
          customer: s(a.customer),
          introducer: s(a.introducer),
          orderId: s(a.orderId),
          txHash: ev.txHash,
          logIndex: ev.logIndex,
          blockNumber: ev.blockNumber,
          blockTimestamp: ev.blockTimestamp,
        })
        .onConflictDoNothing();
      return;
    case 'PaymentSettled':
      await q
        .insert(evPayments)
        .values({
          venue,
          orderId: s(a.orderId),
          customer: s(a.customer),
          amount: s(a.amount),
          venueAmount: s(a.venueAmount),
          rewardPool: s(a.rewardPool),
          firstPurchase: b(a.firstPurchase),
          rewarded: b(a.rewarded),
          weightsMode: n(a.weightsMode),
          txHash: ev.txHash,
          logIndex: ev.logIndex,
          blockNumber: ev.blockNumber,
          blockTimestamp: ev.blockTimestamp,
        })
        .onConflictDoNothing();
      return;
    case 'RewardPaid':
    case 'RewardReturned': {
      const returned = ev.event === 'RewardReturned';
      const recipient = s(returned ? a.intendedRecipient : a.recipient);
      await q
        .insert(evRewards)
        .values({
          txHash: ev.txHash,
          logIndex: ev.logIndex,
          orderId: s(a.orderId),
          venue,
          customer: s(a.customer),
          recipient,
          role: n(a.role),
          amount: s(a.amount),
          viaReferrer: s(a.viaReferrer),
          returned,
          returnReason: returned ? n(a.reason) : null,
          blockNumber: ev.blockNumber,
          blockTimestamp: ev.blockTimestamp,
        })
        .onConflictDoNothing();
      touched.ambassadors.set(`${recipient}:${venue}`, { address: recipient, venue });
      return;
    }
  }
}

type SqlFrag = ReturnType<typeof sql>;
/** Exact uint256 sum as a decimal string (numeric → text, so both drivers return the same type). */
const sumText = (col: SqlFrag, where?: SqlFrag) =>
  where ? sql<string>`coalesce(sum(${col}) filter (where ${where}), 0)::text` : sql<string>`coalesce(sum(${col}), 0)::text`;

async function recomputeVenue(q: Q, venue: string): Promise<void> {
  const [v] = await q.select({ c: sql<number>`count(*)::int` }).from(evVerified).where(eq(evVerified.venue, venue));
  const [p] = await q
    .select({
      payments: sql<number>`count(*)::int`,
      rewarded: sql<number>`(count(*) filter (where ${evPayments.rewarded}))::int`,
      gross: sumText(sql`${evPayments.amount}`),
      venueReceived: sumText(sql`${evPayments.venueAmount}`),
    })
    .from(evPayments)
    .where(eq(evPayments.venue, venue));
  const [r] = await q
    .select({
      paid: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned}`),
      returned: sumText(sql`${evRewards.amount}`, sql`${evRewards.returned}`),
      cashback: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned} and ${evRewards.role} = 0`),
      l1: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned} and ${evRewards.role} = 1`),
      l2: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned} and ${evRewards.role} = 2`),
    })
    .from(evRewards)
    .where(eq(evRewards.venue, venue));
  const row = {
    venue,
    verifiedCustomers: v?.c ?? 0,
    payments: p?.payments ?? 0,
    rewardedPayments: p?.rewarded ?? 0,
    gross: p?.gross ?? '0',
    venueReceived: p?.venueReceived ?? '0',
    rewardsPaid: r?.paid ?? '0',
    rewardsReturned: r?.returned ?? '0',
    cashbackPaid: r?.cashback ?? '0',
    l1Paid: r?.l1 ?? '0',
    l2Paid: r?.l2 ?? '0',
  };
  const { venue: _k, ...set } = row;
  await q.insert(evVenueStats).values(row).onConflictDoUpdate({ target: evVenueStats.venue, set });
}

const ZERO = '0x0000000000000000000000000000000000000000';

async function recomputeAmbassador(q: Q, address: string, venue: string): Promise<void> {
  const where = and(eq(evRewards.recipient, address), eq(evRewards.venue, venue));
  const [r] = await q
    .select({
      credited: sql<number>`(count(distinct ${evRewards.orderId}) filter (where ${evRewards.role} = 1 and (not ${evRewards.returned} or ${evRewards.returnReason} = 2)))::int`,
      paidLines: sql<number>`(count(*) filter (where not ${evRewards.returned}))::int`,
      l1: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned} and ${evRewards.role} = 1`),
      l2: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned} and ${evRewards.role} = 2`),
      cashback: sumText(sql`${evRewards.amount}`, sql`not ${evRewards.returned} and ${evRewards.role} = 0`),
    })
    .from(evRewards)
    .where(where);
  const key = and(eq(evAmbassadors.address, address), eq(evAmbassadors.venue, venue));
  if (address === ZERO || !r || (r.credited === 0 && r.paidLines === 0)) {
    await q.delete(evAmbassadors).where(key);
    return;
  }
  const set = { customersCredited: r.credited, l1Earned: r.l1, l2Earned: r.l2, cashbackEarned: r.cashback };
  await q.insert(evAmbassadors).values({ address, venue, ...set }).onConflictDoUpdate({ target: [evAmbassadors.address, evAmbassadors.venue], set });
}

/** Tables rebuilt from ev_events (everything except ev_events, ev_cursor and ev_ingest_log). */
export const DERIVED_TABLES = [evVenues, evTerms, evSeeds, evIntros, evVerified, evPayments, evRewards, evVenueStats, evAmbassadors] as const;

async function wipeDerivedTables(q: Q): Promise<void> {
  for (const t of DERIVED_TABLES) await q.delete(t);
}

function rowToEvent(r: typeof evEvents.$inferSelect): DecodedEvent {
  return {
    txHash: r.txHash,
    logIndex: r.logIndex,
    blockNumber: r.blockNumber,
    blockHash: r.blockHash,
    txIndex: r.txIndex,
    address: r.address,
    event: r.event as DecodedEvent['event'],
    topic0: r.topic0,
    args: (typeof r.args === 'string' ? JSON.parse(r.args) : r.args) as DecodedEvent['args'],
    topics: (typeof r.topics === 'string' ? JSON.parse(r.topics) : r.topics) as string[],
    data: r.data,
    blockTimestamp: r.blockTimestamp,
  };
}

async function applyInOrder(q: Q, events: DecodedEvent[]): Promise<void> {
  const touched: Touched = { venues: new Set(), ambassadors: new Map() };
  for (const ev of events) await applyEvent(q, ev, touched);
  for (const v of [...touched.venues].sort()) await recomputeVenue(q, v);
  for (const k of [...touched.ambassadors.keys()].sort()) {
    const t = touched.ambassadors.get(k)!;
    await recomputeAmbassador(q, t.address, t.venue);
  }
}

async function rebuildFromEvents(q: Q): Promise<void> {
  await wipeDerivedTables(q);
  const rows = await q.select().from(evEvents).orderBy(asc(evEvents.blockNumber), asc(evEvents.logIndex));
  await applyInOrder(q, rows.map(rowToEvent));
}

async function refreshCursor(q: Q, batchEnd: number | null, rebuilt: boolean): Promise<IngestOutcome['cursor']> {
  const [last] = await q
    .select({ block: evEvents.blockNumber, logIndex: evEvents.logIndex })
    .from(evEvents)
    .orderBy(sql`${evEvents.blockNumber} desc`, sql`${evEvents.logIndex} desc`)
    .limit(1);
  const [c] = await q.select({ c: count() }).from(evEvents);
  const [prev] = await q.select().from(evCursor).where(eq(evCursor.id, CURSOR_ID));
  const lastBatchEnd = Math.max(prev?.lastBatchEnd ?? 0, batchEnd ?? 0, last?.block ?? 0) || null;
  const row = {
    lastBlock: last?.block ?? null,
    lastLogIndex: last?.logIndex ?? null,
    events: Number(c?.c ?? 0),
    lastBatchEnd,
    rebuilds: (prev?.rebuilds ?? 0) + (rebuilt ? 1 : 0),
    updatedAt: new Date(),
  };
  await q.insert(evCursor).values({ id: CURSOR_ID, ...row }).onConflictDoUpdate({ target: evCursor.id, set: row });
  return { lastBlock: row.lastBlock, lastLogIndex: row.lastLogIndex, events: row.events };
}

/**
 * Ingest one decoded batch inside an existing transaction (the caller holds the lock). Used by `ingestBatch` and by
 * `ingestDelivery`, which also writes its ev_ingest_log row in the same transaction.
 */
export async function ingestInTx(tx: Tx, batch: DecodedBatch, opts: IngestOptions): Promise<IngestOutcome> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
  const [cur] = await tx.select().from(evCursor).where(eq(evCursor.id, CURSOR_ID));
  const inserted: DecodedEvent[] = [];
  const CHUNK = 200;
  for (let i = 0; i < batch.events.length; i += CHUNK) {
    const slice = batch.events.slice(i, i + CHUNK);
    const got = await tx
      .insert(evEvents)
      .values(
        slice.map((e) => ({
          txHash: e.txHash,
          logIndex: e.logIndex,
          blockNumber: e.blockNumber,
          blockHash: e.blockHash,
          txIndex: e.txIndex,
          address: e.address,
          event: e.event,
          topic0: e.topic0,
          args: e.args,
          topics: e.topics,
          data: e.data,
          blockTimestamp: e.blockTimestamp,
          source: opts.source,
          deliveryId: opts.deliveryId ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ txHash: evEvents.txHash, logIndex: evEvents.logIndex });
    const isNew = new Set(got.map((g) => `${g.txHash}:${g.logIndex}`));
    for (const e of slice) if (isNew.has(`${e.txHash}:${e.logIndex}`)) inserted.push(e);
  }
  inserted.sort(compareEvents);

  let rebuilt = false;
  if (inserted.length > 0) {
    const first = inserted[0]!;
    const behind =
      cur?.lastBlock !== null &&
      cur?.lastBlock !== undefined &&
      compareEvents(first, { blockNumber: cur.lastBlock, logIndex: cur.lastLogIndex ?? -1 }) < 0;
    if (behind) {
      await rebuildFromEvents(tx);
      rebuilt = true;
    } else {
      await applyInOrder(tx, inserted);
    }
  }
  const cursor = await refreshCursor(tx, batch.batchEnd, rebuilt);
  const ignored = batch.ignored.address + batch.ignored.topic + batch.ignored.removed + batch.ignored.invalid;
  return { logs: batch.logs, newEvents: inserted, duplicates: batch.events.length - inserted.length, ignored, rebuilt, cursor };
}

/** Ingest a decoded batch in its own transaction. */
export function ingestBatch(handle: DbHandle, batch: DecodedBatch, opts: IngestOptions): Promise<IngestOutcome> {
  return serialized(() => asDb(handle).transaction((tx) => ingestInTx(tx, batch, opts)));
}

/** Wipe ONLY the derived tables and re-apply ev_events in order (no re-decode). */
export function rebuildDerived(handle: DbHandle): Promise<IngestOutcome['cursor']> {
  return serialized(() =>
    asDb(handle).transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
      await rebuildFromEvents(tx);
      return refreshCursor(tx, null, true);
    }),
  );
}
