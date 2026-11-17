import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { VOUCH_ARC_TESTNET, VOUCH_EVENT_TOPICS } from '@vouch/shared';
import { createDb } from '../db/index';
import { webhookRoutes } from '../routes/webhooks';
import { buildEnvelopes, chunkRange, loadFilter, type RawLog } from './backfill';
import { decodeDelivery } from './decode';
import { insertDelivery, listDeliveries } from './deliveries';
import { createStreams } from './index';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { evIngestLog } from './schema';
import type { IngestedEvent } from './types';
import { liveViaWebhook, memoryStreams, runDeterminism, signedHeaders } from './verify';

/**
 * Phase 2 ingestion tests on REAL Vouch v3 chain data (fixtures fetched read-only from https://rpc.testnet.arc.io):
 *   fixtures/v3-logs.json   all 48 Vouch v3 logs in [72605845, 72611516]
 *   fixtures/v3-blocks.json every log (USDC, EIP-7708 system emitter, other contracts) of blocks 72606074/72606174/72606075
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const V3 = JSON.parse(readFileSync(path.join(here, 'fixtures/v3-logs.json'), 'utf8')) as { fromBlock: number; toBlock: number; logs: RawLog[] };
const BLOCKS = JSON.parse(readFileSync(path.join(here, 'fixtures/v3-blocks.json'), 'utf8')) as { blocks: Record<string, RawLog[]> };
const FROM = V3.fromBlock;
const TO = V3.toBlock;
const filter = loadFilter();

const RELAYED_PAY = '0x95cbda97e7a015b6c105f07cf364b3cc258cc6769cd13a10ce8ae0697280673e';
const SELF_PAY = '0xfca0e1aeb40f9aa4e8564a60d0ac56817297956b2560d9db9bdc8823aa18c7be';
const SYSTEM = '0xfffffffffffffffffffffffffffffffffffffffe';
const CANONICAL = { amount: 12_000_000n, venue: 10_200_000n, cashback: 450_000n, l1: [693_000n, 297_000n], l2: [252_000n, 108_000n] };

const envelopes = (batchSize?: number) => buildEnvelopes(V3.logs, FROM, TO, { filter, batchSize });

describe('decode + filter on real blocks', () => {
  test('frozen production filter: 72606074 → 7 Vouch events of the relayed pay, 72606174 → 7 of the self-submit pay, 72606075 → null', () => {
    const run = (b: number) => filter({ data: [BLOCKS.blocks[String(b)]], metadata: { batch_start_range: b, batch_end_range: b, stream_id: 's', network: 'arc-testnet', dataset: 'logs' } }) as {
      events: Array<{ event: string; transactionHash: string; logIndex: number; address: string }>;
    } | null;
    const expect = (b: number, tx: string, idx: number[]) => {
      const out = run(b);
      assert.ok(out);
      assert.deepEqual(
        out.events.map((e) => [e.event, e.logIndex]),
        [['CustomerVerified', idx[0]], ['PaymentSettled', idx[1]], ...idx.slice(2).map((i) => ['RewardPaid', i])],
      );
      assert.ok(out.events.every((e) => e.transactionHash === tx && e.address === VOUCH_ARC_TESTNET.address.toLowerCase()));
    };
    expect(72606074, RELAYED_PAY, [74, 90, 91, 92, 93, 94, 95]);
    expect(72606174, SELF_PAY, [53, 69, 70, 71, 72, 73, 74]);
    assert.equal(run(72606075), null);
  });

  test('infra/streams/stream-vouch-prod.json: start block, address and test-filter expectations match the frozen filter', () => {
    const cfg = JSON.parse(readFileSync(path.join(here, '../../../../infra/streams/stream-vouch-prod.json'), 'utf8')) as {
      start_range: number;
      watched_address: string;
      test_filter_expectations: Record<string, { tx: string; events: Array<[string, number]> } | null>;
    };
    assert.equal(cfg.start_range, VOUCH_ARC_TESTNET.deployBlock);
    assert.equal(cfg.watched_address, VOUCH_ARC_TESTNET.address);
    for (const [blk, want] of Object.entries(cfg.test_filter_expectations)) {
      const logs = BLOCKS.blocks[blk] ?? V3.logs.filter((l) => Number.parseInt(String(l.blockNumber), 16) === Number(blk));
      const out = filter({ data: [logs], metadata: { batch_start_range: Number(blk), batch_end_range: Number(blk) } }) as { events: Array<{ event: string; logIndex: number; transactionHash: string }> } | null;
      if (want === null) assert.equal(out, null, blk);
      else {
        assert.deepEqual(out?.events.map((e) => [e.event, e.logIndex]), want.events, blk);
        assert.ok(out!.events.every((e) => e.transactionHash === want.tx), blk);
      }
    }
  });

  test('unfiltered raw block: USDC, EIP-7708 system-emitter and foreign logs are ignored; only Vouch logs decode', () => {
    const raw = BLOCKS.blocks['72606074']!;
    const sys = raw.filter((l) => String(l.address).toLowerCase() === SYSTEM).length;
    assert.ok(sys > 0);
    const d = decodeDelivery({ data: [raw] });
    assert.equal(d.logs, raw.length);
    assert.equal(d.events.length, 7);
    assert.equal(d.ignored.address, raw.length - 7);
    // A system-emitter log that copies a Vouch topic0 is still ignored (address check first).
    const forged = { ...raw.find((l) => String(l.address).toLowerCase() === SYSTEM)!, topics: [VOUCH_EVENT_TOPICS.PaymentSettled] };
    assert.equal(decodeDelivery({ events: [forged] }).events.length, 0);
  });

  test('unknown topic0 / EIP712DomainChanged / removed logs from the Vouch address are ignored', () => {
    const base = V3.logs[0]!;
    const unknown = { ...base, topics: ['0x' + '12'.repeat(32)], logIndex: '0x63' };
    const domain = { ...base, topics: [VOUCH_EVENT_TOPICS.EIP712DomainChanged], data: '0x', logIndex: '0x64' };
    const removed = { ...base, removed: true };
    const d = decodeDelivery({ v: 1, events: [unknown, domain, removed] });
    assert.equal(d.events.length, 0);
    assert.deepEqual(d.ignored, { address: 0, topic: 2, removed: 1, invalid: 0 });
  });

  test('chunkRange never exceeds the 10,000-block eth_getLogs limit', () => {
    const r = chunkRange(72605845, 72625845);
    assert.ok(r.every(([a, b]) => b - a <= 9_999));
    assert.equal(r[0]![0], 72605845);
    assert.equal(r.at(-1)![1], 72625845);
    assert.throws(() => chunkRange(1, 2, 10_001));
  });
});

describe('derived state from real v3 data', () => {
  let s: Awaited<ReturnType<typeof memoryStreams>>;
  before(async () => {
    s = await memoryStreams();
    for (const env of envelopes(5)) await s.streams.ingestEnvelope(env);
  });
  after(async () => s.handle.close());

  for (const [label, tx] of [
    ['relayed', RELAYED_PAY],
    ['self-submit', SELF_PAY],
  ] as const) {
    test(`canonical split rows (${label} pay ${tx.slice(0, 10)}): 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108`, async () => {
      const p = await s.streams.getPaymentByTx(tx);
      assert.ok(p);
      assert.equal(p.amount, CANONICAL.amount);
      assert.equal(p.venueAmount, CANONICAL.venue);
      assert.equal(p.firstPurchase, true);
      assert.equal(p.rewarded, true);
      assert.deepEqual(
        p.lines.map((l) => [l.role, l.amount, l.returned]),
        [
          [0, CANONICAL.cashback, false],
          [1, CANONICAL.l1[0], false],
          [1, CANONICAL.l1[1], false],
          [2, CANONICAL.l2[0], false],
          [2, CANONICAL.l2[1], false],
        ],
      );
      assert.equal(p.venueAmount + p.lines.filter((l) => !l.returned).reduce((a, l) => a + l.amount, 0n), p.amount);
      assert.equal(p.rewardPool, 1_800_000n);
      const same = await s.streams.getPayment(p.venue, p.orderId);
      assert.equal(same?.txHash, tx);
      assert.ok(await s.streams.isVerified(p.venue, p.customer));
      // L2 edges are drawn from the L1 (viaReferrer).
      const stats = await s.streams.getVenueStats(p.venue);
      const l2 = stats.edges.filter((e) => e.txHash === tx && e.role === 2);
      assert.equal(l2.length, 2);
      assert.ok(l2.every((e) => p.lines.some((l) => l.role === 1 && l.recipient === e.from)));
    });
  }

  test('venue stats + ambassador record are consistent with the lines', async () => {
    const p = (await s.streams.getPaymentByTx(RELAYED_PAY))!;
    const st = await s.streams.getVenueStats(p.venue);
    assert.equal(st.cashbackPaid + st.l1Paid + st.l2Paid, st.rewardsPaid);
    assert.equal(st.venueReceived + st.rewardsPaid, st.gross);
    assert.ok(st.verifiedCustomers >= 1 && st.payments >= st.rewardedPurchases);
    const ana = p.lines.find((l) => l.role === 1 && l.amount === 693_000n)!.recipient;
    const rec = await s.streams.getAmbassador(ana);
    assert.ok(rec.customersCredited >= 1);
    assert.ok(rec.venues.includes(p.venue));
    assert.ok(rec.l1Earned >= 693_000n);
    const venue = await s.streams.getVenue(p.venue);
    assert.ok(venue && venue.terms.length >= 1 && venue.terms[0]!.termsVersion === 1);
    const intros = await s.streams.listIntrosAccepted({ venue: p.venue, customer: p.customer });
    assert.ok(intros.length >= 2);
    const c = await s.streams.cursor();
    assert.equal(c.events, 48);
    assert.equal(c.lastBlock, 72606174n);
    assert.equal(c.lastLogIndex, 74);
  });
});

describe('idempotency, ordering, overlap', () => {
  test('re-delivery of the same batch is a no-op (0 new, all duplicates, same hash)', async () => {
    const { handle, streams } = await memoryStreams();
    try {
      const [env] = envelopes();
      const first = await streams.ingestEnvelope(env);
      const h1 = await streams.hash();
      const again = await streams.ingestEnvelope(env);
      assert.equal(first.newEvents, 48);
      assert.equal(again.newEvents, 0);
      assert.equal(again.duplicates, 48);
      assert.equal((await streams.hash()).hash, h1.hash);
    } finally {
      await handle.close();
    }
  });

  test('overlapping batches and reverse-order delivery converge to the in-order hash', async () => {
    const ref = await memoryStreams();
    const rev = await memoryStreams();
    const ovl = await memoryStreams();
    try {
      const batches = envelopes(5);
      assert.ok(batches.length > 10);
      for (const e of batches) await ref.streams.ingestEnvelope(e);
      let rebuilt = false;
      for (const e of [...batches].reverse()) rebuilt = (await rev.streams.ingestEnvelope(e)).rebuilt || rebuilt;
      assert.ok(rebuilt, 'an out-of-order batch must trigger a rebuild');
      // Overlap: 50-block windows advancing by 25 blocks.
      for (let s = FROM; s <= TO; s += 25) for (const e of buildEnvelopes(V3.logs, s, Math.min(s + 49, TO), { filter })) await ovl.streams.ingestEnvelope(e);
      const [a, b, c] = await Promise.all([ref.streams.hash(), rev.streams.hash(), ovl.streams.hash()]);
      assert.equal(b.hash, a.hash);
      assert.equal(c.hash, a.hash);
      assert.equal(a.tables.ev_events!.rows, 48);
    } finally {
      await Promise.all([ref.handle.close(), rev.handle.close(), ovl.handle.close()]);
    }
  });

  test('events are applied in (block, logIndex) order even when shuffled inside one body', async () => {
    const { handle, streams } = await memoryStreams();
    const ref = await memoryStreams();
    try {
      const [env] = envelopes() as Array<{ events: unknown[] }>;
      const shuffled = { ...env, events: [...env!.events].reverse() };
      await streams.ingestEnvelope(shuffled);
      await ref.streams.ingestEnvelope(env);
      assert.equal((await streams.hash()).hash, (await ref.streams.hash()).hash);
    } finally {
      await Promise.all([handle.close(), ref.handle.close()]);
    }
  });
});

describe('webhook → ingest → bus', () => {
  test('live webhook path: deliveries stored + ingested; duplicates/overlap emit nothing; listener errors are contained', async () => {
    const live = await liveViaWebhook(V3.logs, FROM, TO, { noise: false });
    try {
      assert.ok(live.statuses.every((c) => c === 200));
      assert.equal((await live.streams.cursor()).events, 48);
      // Re-deliver every stored body (QuickNode retries / a restarted stream): no new events, no bus traffic.
      const seen: IngestedEvent[] = [];
      live.streams.bus.subscribe((e) => seen.push(e));
      const stored = await listDeliveries(live.db, 500);
      assert.equal(stored.length, live.deliveries);
      for (const [i, d] of stored.entries()) {
        const r = await live.streams.ingestDelivery(10_000 + i, d.body);
        assert.equal(r.newEvents, 0);
      }
      assert.equal(seen.length, 0);
      assert.equal((await live.streams.cursor()).events, 48);
    } finally {
      await live.app.close();
    }
  });

  test('bus publishes exactly one payment.settled per new PaymentSettled, after commit, with the split lines', async () => {
    const { handle, streams } = await memoryStreams();
    try {
      const seen: IngestedEvent[] = [];
      streams.bus.subscribe((e) => seen.push(e));
      streams.bus.subscribe(() => {
        throw new Error('listener boom');
      });
      const batches = envelopes(5);
      for (const [i, e] of batches.entries()) await streams.ingestDelivery(1000 + i, e);
      for (const [i, e] of batches.entries()) await streams.ingestDelivery(2000 + i, e); // re-deliveries
      const settled = seen.filter((e): e is Extract<IngestedEvent, { type: 'payment.settled' }> => e.type === 'payment.settled');
      assert.equal(settled.length, 6);
      const relayed = settled.find((e) => e.payment.txHash === RELAYED_PAY)!;
      assert.equal(relayed.payment.lines.length, 5);
      assert.equal(relayed.payment.venueAmount, CANONICAL.venue);
      assert.equal(seen.filter((e) => e.type === 'venue.registered').length, 2);
      assert.equal(seen.filter((e) => e.type === 'intro.accepted').length, 8);
      assert.equal(seen.filter((e) => e.type === 'customer.verified').length, 6);
    } finally {
      await handle.close();
    }
  });

  test('ingest failure after a durable raw row still answers 200; the delivery is retried from stream_deliveries', async () => {
    const handle = createDb('pglite://memory');
    await handle.migrate();
    const streams = createStreams(handle);
    const app = Fastify({ logger: false });
    let fail = true;
    const secret = 'test-secret-ingest-failure-0123456789';
    await app.register(webhookRoutes, {
      logFile: null,
      secret,
      store: (row) => insertDelivery(handle, row),
      ingest: async (id, body) => {
        if (fail) {
          // Simulate an ingest bug: record the failure like the real ingester does, then throw.
          await (handle.db as unknown as PgliteDatabase).insert(evIngestLog).values({ deliveryId: id, status: 'failed', error: 'boom' });
          throw new Error('ingest boom');
        }
        return streams.ingestDelivery(id, body);
      },
    });
    try {
      const [env] = envelopes();
      const body = JSON.stringify(env);
      const res = await app.inject({ method: 'POST', url: '/webhooks/streams', headers: signedHeaders(secret, body), payload: body });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().ingested, false);
      assert.equal((await listDeliveries(handle)).length, 1);
      fail = false;
      // A delivery row whose ingest never ran (crash between insert and ingest) is also picked up.
      await insertDelivery(handle, { verified: true, bytes: body.length, headers: {}, body: env });
      const done = await streams.ingestPending();
      assert.equal(done.length, 2);
      assert.equal((await streams.cursor()).events, 48);
      assert.equal((await streams.ingestPending()).length, 0);
    } finally {
      await app.close();
      await handle.close();
    }
  });
});

describe('SEC-2-10c: bounded retry of failed deliveries', () => {
  test('retryFailed: background by default, ≤ RETRY_MAX_ATTEMPTS attempts, backoff respected; ingestPending still catches the rest', async () => {
    const { RETRY_MAX_ATTEMPTS, retryBackoffMs } = await import('./index');
    const { handle, streams } = await memoryStreams();
    try {
      const db = handle.db as unknown as PgliteDatabase;
      const [env] = envelopes();
      const { id } = await insertDelivery(handle, { verified: true, bytes: 1, headers: {}, body: env });
      const t0 = Date.now();
      await db.insert(evIngestLog).values({ deliveryId: id, status: 'failed', error: 'boom', attempts: 1, at: new Date(t0) });
      // Not due yet (backoff 10 s after attempt 1).
      assert.equal((await streams.retryFailed({ wait: true, now: t0 + 1_000 })).length, 0);
      // Default call returns immediately (background) with [].
      assert.deepEqual(await streams.retryFailed({ now: t0 + 1_000 }), []);
      // Capped: at RETRY_MAX_ATTEMPTS it is never retried by retryFailed …
      await db.update(evIngestLog).set({ attempts: RETRY_MAX_ATTEMPTS });
      assert.equal((await streams.retryFailed({ wait: true, now: t0 + 86_400_000 })).length, 0);
      // … but due + under the cap → retried and succeeds.
      await db.update(evIngestLog).set({ attempts: 2 });
      assert.equal((await streams.retryFailed({ wait: true, now: t0 + retryBackoffMs(2) })).length, 1);
      assert.equal((await streams.cursor()).events, 48);
      assert.equal(retryBackoffMs(1), 10_000);
      assert.equal(retryBackoffMs(20), 600_000);
    } finally {
      await handle.close();
    }
  });
});

describe('determinism: chain backfill == live webhook == replay == rebuild', () => {
  test('hash equality on the real v3 range with retries and an overlapping batch', async () => {
    const r = await runDeterminism(V3.logs, FROM, TO, { batchSize: 5 });
    assert.ok(r.statuses.every((c) => c === 200));
    assert.ok(r.deliveries > 2 * envelopes(5).length); // every batch twice + the overlapping batch
    assert.equal(r.live.hash, r.backfill.hash);
    assert.equal(r.replay.hash, r.backfill.hash);
    assert.equal(r.replayInPlace.hash, r.backfill.hash);
    assert.equal(r.rebuild.hash, r.backfill.hash);
    assert.equal(r.backfill.tables.ev_payments!.rows, 6);
    assert.equal(r.backfill.tables.ev_rewards!.rows, 22);
    assert.equal(r.backfill.tables.ev_intros!.rows, 8);
    assert.ok(r.equal);
  });
});
