import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { Address, Hex } from 'viem';
import type { DbHandle } from '../db/index';
import type * as appSchema from '../db/schema';
import { streamDeliveries } from '../db/schema';
import { createBus, type Bus } from './bus';
import { decodeDelivery, DEFAULT_ADDRESSES, type DecodedEvent } from './decode';
import { hashDerived, type DerivedHash } from './hash';
import { ingestBatch, ingestInTx, rebuildDerived, serialized, DERIVED_TABLES, type IngestOutcome, type IngestSource } from './ingest';
import { createQueries, toIntro } from './queries';
import { evCursor, evEvents, evIngestLog, evIntros } from './schema';
import type { IngestedEvent, StreamsPort } from './types';

/**
 * STREAMS_INFRA Phase 2 entry point (D-306). `createStreams(db)` gives BACKEND_RELAYER the StreamsPort (queries + bus,
 * MSG-062/063) and the webhook its ingest hook.
 *
 * Webhook semantics (D-306): the raw `stream_deliveries` row commits first (D-305, unchanged); `ingestDelivery` runs
 * right after it in its own transaction. If ingestion fails, the webhook STILL answers 200 (the raw row is durable),
 * the failure is recorded in `ev_ingest_log`, and the delivery is retried from the raw table by `retryFailed()`
 * (a bounded background pass after the next delivery: ≤ 5 attempts with backoff, never awaited by the webhook) and
 * `ingestPending()` (boot, `streams:replay`). QuickNode is never asked to retry for an
 * ingest bug: its retries cannot fix a deterministic failure and would auto-pause the Stream.
 */

type Db = PgliteDatabase<typeof appSchema>;

export interface IngestResult {
  deliveryId: number | null;
  logs: number;
  newEvents: number;
  duplicates: number;
  ignored: number;
  rebuilt: boolean;
  cursor: IngestOutcome['cursor'];
}

export interface IngestCallOpts {
  /** Publish new events on the bus (default true for live deliveries; replay/backfill pass false). */
  emit?: boolean;
  source?: IngestSource;
}

export interface Streams extends StreamsPort {
  bus: Bus;
  /** Webhook hook: decode + ingest one stored delivery. Throws on failure (after recording it in ev_ingest_log). */
  ingestDelivery(deliveryId: number, body: unknown, opts?: IngestCallOpts): Promise<IngestResult>;
  /** Ingest an envelope that has no stream_deliveries row (chain backfill). */
  ingestEnvelope(body: unknown, opts?: IngestCallOpts): Promise<IngestResult>;
  /** Re-ingest every verified delivery without an 'ok' ev_ingest_log row, oldest first (boot, replay). */
  ingestPending(opts?: IngestCallOpts): Promise<IngestResult[]>;
  /**
   * Bounded retry of FAILED deliveries (SEC-2-10c, D-309). Default: schedules one background pass and resolves
   * immediately with [] (the webhook never waits on it). A pass takes at most RETRY_BATCH deliveries whose attempts <
   * RETRY_MAX_ATTEMPTS and whose backoff (10 s × 2^(attempts−1), max 10 min) has elapsed; only one pass runs at a time.
   * `{ wait: true }` runs the pass inline and returns its results (tests, CLI). Beyond the cap a delivery stays 'failed'
   * and is only retried by ingestPending() (boot, `streams:replay`).
   */
  retryFailed(opts?: { wait?: boolean; now?: number }): Promise<IngestResult[]>;
  /** Wipe derived tables and re-apply ev_events (no re-decode). */
  rebuild(): Promise<IngestOutcome['cursor']>;
  /** Wipe ev_events, the cursor, the ingest log and all derived tables. */
  wipeAll(): Promise<void>;
  hash(): Promise<DerivedHash>;
}

export interface CreateStreamsOpts {
  /** Watched Vouch addresses (lowercase or checksummed). Default: [VOUCH_ARC_TESTNET.address]. */
  addresses?: readonly string[];
  log?: { warn(obj: unknown, msg: string): void; error(obj: unknown, msg: string): void };
}

/** SEC-2-10c bounds for the background retry of failed deliveries. */
export const RETRY_MAX_ATTEMPTS = 5;
export const RETRY_BATCH = 5;
export const retryBackoffMs = (attempts: number) => Math.min(10_000 * 2 ** Math.max(0, attempts - 1), 600_000);

const toResult = (deliveryId: number | null, o: IngestOutcome): IngestResult => ({
  deliveryId,
  logs: o.logs,
  newEvents: o.newEvents.length,
  duplicates: o.duplicates,
  ignored: o.ignored,
  rebuilt: o.rebuilt,
  cursor: o.cursor,
});

export function createStreams(handle: DbHandle, opts: CreateStreamsOpts = {}): Streams {
  const addresses = opts.addresses ?? DEFAULT_ADDRESSES;
  const db = () => handle.db as Db;
  const bus = createBus((err, e) => opts.log?.error({ err: (err as Error)?.message, type: e.type }, 'streams bus listener threw'));
  const queries = createQueries(handle);
  let retrying: Promise<unknown> | null = null;

  async function publishNew(events: DecodedEvent[]): Promise<void> {
    if (bus.size() === 0) return;
    for (const ev of events) {
      const a = ev.args;
      const txHash = ev.txHash as Hex;
      let out: IngestedEvent | null = null;
      switch (ev.event) {
        case 'PaymentSettled': {
          const payment = await queries.getPayment(a.venue as Address, a.orderId as Hex);
          if (payment) out = { type: 'payment.settled', payment };
          break;
        }
        case 'IntroAccepted': {
          const [row] = await db().select().from(evIntros).where(and(eq(evIntros.txHash, ev.txHash), eq(evIntros.logIndex, ev.logIndex)));
          if (row) out = { type: 'intro.accepted', intro: toIntro(row) };
          break;
        }
        case 'IntroDropped':
          out = {
            type: 'intro.dropped',
            venue: a.venue as Address,
            customer: a.customer as Address,
            referrer: a.referrer as Address,
            introHash: a.introHash as Hex,
            reason: Number(a.reason),
            txHash,
            logIndex: ev.logIndex,
          };
          break;
        case 'CustomerVerified':
          out = {
            type: 'customer.verified',
            venue: a.venue as Address,
            customer: a.customer as Address,
            introducer: a.introducer as Address,
            orderId: a.orderId as Hex,
            txHash,
            logIndex: ev.logIndex,
          };
          break;
        case 'VenueRegistered':
          out = { type: 'venue.registered', venue: a.venue as Address, owner: a.owner as Address, txHash };
          break;
        case 'TermsUpdated':
          out = {
            type: 'terms.updated',
            venue: a.venue as Address,
            terms: { termsVersion: Number(a.termsVersion), rewardBps: Number(a.rewardBps), minOrder: BigInt(String(a.minOrder)), effectiveAt: BigInt(String(a.effectiveAt)) },
            txHash,
          };
          break;
        case 'VenueKeysUpdated':
          out = { type: 'venue.keys', venue: a.venue as Address, payout: a.payout as Address, signer: a.signer as Address, attributor: a.attributor as Address, txHash };
          break;
        case 'SeedAmbassadorSet':
          out = { type: 'seed.set', venue: a.venue as Address, ambassador: a.ambassador as Address, allowed: a.allowed === true, txHash };
          break;
        case 'RewardPaid':
        case 'RewardReturned':
          break; // carried inside payment.settled
      }
      if (out) bus.publish(out);
    }
  }

  async function ingestDelivery(deliveryId: number, body: unknown, o: IngestCallOpts = {}): Promise<IngestResult> {
    try {
      const batch = decodeDelivery(body, addresses);
      const outcome = await serialized(() =>
        db().transaction(async (tx) => {
          const res = await ingestInTx(tx, batch, { source: o.source ?? 'stream', deliveryId });
          const row = { status: 'ok', logs: res.logs, newEvents: res.newEvents.length, duplicates: res.duplicates, ignored: res.ignored, error: null, at: new Date() };
          await tx
            .insert(evIngestLog)
            .values({ deliveryId, ...row })
            .onConflictDoUpdate({ target: evIngestLog.deliveryId, set: { ...row, attempts: sql`${evIngestLog.attempts} + 1` } });
          return res;
        }),
      );
      if (o.emit ?? true) await publishNew(outcome.newEvents).catch((err) => opts.log?.error({ err: (err as Error).message }, 'streams bus publish failed'));
      return toResult(deliveryId, outcome);
    } catch (err) {
      const error = String((err as Error)?.message ?? err).slice(0, 2000);
      await db()
        .insert(evIngestLog)
        .values({ deliveryId, status: 'failed', error })
        .onConflictDoUpdate({ target: evIngestLog.deliveryId, set: { status: 'failed', error, at: new Date(), attempts: sql`${evIngestLog.attempts} + 1` } })
        .catch(() => undefined);
      throw err;
    }
  }

  async function pending(onlyFailed: boolean) {
    return db()
      .select({ id: streamDeliveries.id, body: streamDeliveries.body, attempts: evIngestLog.attempts, at: evIngestLog.at })
      .from(streamDeliveries)
      .leftJoin(evIngestLog, eq(evIngestLog.deliveryId, streamDeliveries.id))
      .where(
        and(
          eq(streamDeliveries.verified, true),
          onlyFailed ? eq(evIngestLog.status, 'failed') : or(isNull(evIngestLog.status), ne(evIngestLog.status, 'ok')),
        ),
      )
      .orderBy(asc(streamDeliveries.id));
  }

  async function drain(rows: { id: number; body: unknown }[], o: IngestCallOpts): Promise<IngestResult[]> {
    const out: IngestResult[] = [];
    for (const r of rows) {
      try {
        out.push(await ingestDelivery(r.id, r.body, o));
      } catch (err) {
        opts.log?.warn({ deliveryId: r.id, err: (err as Error).message }, 'streams ingest retry failed');
      }
    }
    return out;
  }

  return {
    ...queries,
    bus,
    ingestDelivery,
    async ingestEnvelope(body, o = {}) {
      const outcome = await ingestBatch(handle, decodeDelivery(body, addresses), { source: o.source ?? 'backfill' });
      if (o.emit) await publishNew(outcome.newEvents);
      return toResult(null, outcome);
    },
    async ingestPending(o = {}) {
      return drain(await pending(false), o);
    },
    async retryFailed(o = {}) {
      const pass = async () => {
        const now = o.now ?? Date.now();
        const due = (await pending(true))
          .filter((r) => (r.attempts ?? 0) < RETRY_MAX_ATTEMPTS && r.at !== null && now - r.at.getTime() >= retryBackoffMs(r.attempts ?? 1))
          .slice(0, RETRY_BATCH);
        return drain(due, {});
      };
      if (o.wait) return pass();
      if (!retrying) {
        retrying = pass()
          .catch((err) => {
            opts.log?.warn({ err: (err as Error).message }, 'streams retryFailed pass failed');
            return [];
          })
          .finally(() => {
            retrying = null;
          });
      }
      return [];
    },
    rebuild: () => rebuildDerived(handle),
    async wipeAll() {
      await serialized(() =>
        db().transaction(async (tx) => {
          for (const t of DERIVED_TABLES) await tx.delete(t);
          await tx.delete(evEvents);
          await tx.delete(evCursor);
          await tx.delete(evIngestLog);
        }),
      );
    },
    hash: () => hashDerived(handle),
  };
}

export type { IngestedEvent, StreamsPort } from './types';
export { decodeDelivery } from './decode';
