/**
 * Venue feed `GET /venues/:venue/payments` (D-811) and money-graph edges on `/venues/:venue/stats`: Streams-derived
 * rows only (ev_payments / ev_rewards in PGlite), newest first, keyset paging, limits, display names, unknown venue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, keccak256, toHex, zeroAddress, type Address } from 'viem';
import { evPayments, evRewards } from '../streams/schema';
import { P, acct, call, makeApp, signIn, type TestApp } from './helpers';

const VENUE = getAddress('0x00000000000000000000000000000000000c0ffe');
const OTHER = getAddress('0x0000000000000000000000000000000000000bad');
const stranger = acct('stranger').address;

const h = (s: string) => keccak256(toHex(s));

/** One settled payment at (block, logIndex) with cashback + L1 (+ optional L2) lines, like the canonical split. */
async function putPayment(t: TestApp, o: { n: number; block: number; logIndex: number; customer: Address; l1: Address; l2?: Address; time?: number | null; returnedL2?: boolean }) {
  const db = t.deps.handle.db as any;
  const orderId = h(`order:${o.n}`);
  const txHash = h(`tx:${o.n}`);
  const time = o.time === undefined ? 1_800_000_000 + o.block : o.time;
  await db.insert(evPayments).values({
    venue: VENUE,
    orderId,
    customer: o.customer,
    amount: '12000000',
    venueAmount: '10200000',
    rewardPool: '1800000',
    firstPurchase: true,
    rewarded: true,
    weightsMode: 1,
    txHash,
    logIndex: o.logIndex,
    blockNumber: o.block,
    blockTimestamp: time,
  });
  const line = (i: number, role: number, recipient: Address, amount: string, returned = false) => ({
    txHash,
    logIndex: o.logIndex + 1 + i,
    orderId,
    venue: VENUE,
    customer: o.customer,
    recipient,
    role,
    amount,
    viaReferrer: role === 2 ? o.l1 : zeroAddress,
    returned,
    returnReason: returned ? 0 : null,
    blockNumber: o.block,
    blockTimestamp: time,
  });
  const lines = [line(0, 0, o.customer, '450000'), line(1, 1, o.l1, '990000')];
  if (o.l2) lines.push(line(2, 2, o.l2, '360000', o.returnedL2 ?? false));
  await db.insert(evRewards).values(lines);
  return { orderId, txHash };
}

async function setup() {
  const t = await makeApp();
  // A venue the chain knows (the feed accepts Streams-known or chain-known venues, like /stats).
  t.chain.venues.set(VENUE.toLowerCase(), {
    owner: P.lena.address,
    termsVersion: 1,
    registeredAt: 1n,
    payout: P.lena.address,
    signer: P.venueSigner.address,
    attributor: P.attributor.address,
    terms: [{ version: 1, rewardBps: 1500, effectiveAt: 1n, minOrder: 0n }],
  });
  await signIn(t.app, P.ben, 'Ben');
  await signIn(t.app, P.ana, 'Ana');
  const rows = [
    await putPayment(t, { n: 1, block: 100, logIndex: 5, customer: P.ben.address, l1: P.ana.address, l2: P.priya.address }),
    await putPayment(t, { n: 2, block: 101, logIndex: 3, customer: stranger, l1: P.ben.address }),
    await putPayment(t, { n: 3, block: 102, logIndex: 1, customer: P.sam.address, l1: P.ana.address, l2: P.ben.address, returnedL2: true }),
    await putPayment(t, { n: 4, block: 102, logIndex: 9, customer: P.priya.address, l1: P.ana.address, time: null }),
    await putPayment(t, { n: 5, block: 103, logIndex: 2, customer: P.eve.address, l1: P.ben.address }),
  ];
  return { t, rows };
}

test('feed: newest first by (block, logIndex), full shape, display names joined, money as {baseUnits, display}', async () => {
  const { t, rows } = await setup();
  try {
    const r = await call(t.app, 'GET', `/venues/${VENUE}/payments`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.venue, VENUE);
    assert.equal(r.body.source, 'streams');
    assert.equal(r.body.nextBefore, null);
    const ps = r.body.payments;
    assert.deepEqual(
      ps.map((p: any) => p.orderId),
      [rows[4]!.orderId, rows[3]!.orderId, rows[2]!.orderId, rows[1]!.orderId, rows[0]!.orderId],
    );

    const first = ps.at(-1); // the canonical-like payment with an L2
    assert.deepEqual(Object.keys(first).sort(), [
      'amount', 'blockNumber', 'cashback', 'customer', 'firstPurchase', 'orderId', 'rewarded', 'rewards', 'rewardsReturned', 'settledAt', 'txHash', 'venueReceived',
    ]);
    assert.equal(first.txHash, rows[0]!.txHash);
    assert.equal(first.blockNumber, '100');
    assert.equal(first.settledAt, new Date((1_800_000_000 + 100) * 1000).toISOString());
    assert.deepEqual(first.customer, { address: P.ben.address, displayName: 'Ben' });
    assert.deepEqual(first.amount, { baseUnits: '12000000', display: '12.00' });
    assert.deepEqual(first.venueReceived, { baseUnits: '10200000', display: '10.20' });
    assert.deepEqual(first.cashback, { baseUnits: '450000', display: '0.45' });
    assert.deepEqual(first.rewards, [
      { recipient: { address: P.ana.address, displayName: 'Ana' }, level: 1, amount: { baseUnits: '990000', display: '0.99' } },
      { recipient: { address: P.priya.address, displayName: null }, level: 2, amount: { baseUnits: '360000', display: '0.36' } },
    ]);
    assert.equal(first.firstPurchase, true);

    // Unknown customer → displayName null; null block time → settledAt null; returned L2 lines are not rewards.
    assert.deepEqual(ps[3].customer, { address: stranger, displayName: null });
    assert.equal(ps[1].settledAt, null);
    assert.deepEqual(ps[2].rewards.map((x: any) => x.level), [1]);
    assert.equal(ps[2].rewardsReturned.baseUnits, '360000');
  } finally {
    await t.close();
  }
});

test('feed: limit + keyset paging via nextBefore (same-block ties by logIndex); block-number cursor', async () => {
  const { t, rows } = await setup();
  try {
    const seen: string[] = [];
    let url = `/venues/${VENUE}/payments?limit=2`;
    const cursors: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await call(t.app, 'GET', url);
      assert.equal(r.status, 200);
      assert.ok(r.body.payments.length <= 2);
      seen.push(...r.body.payments.map((p: any) => p.orderId));
      cursors.push(r.body.nextBefore);
      if (!r.body.nextBefore) break;
      url = `/venues/${VENUE}/payments?limit=2&before=${r.body.nextBefore}`;
    }
    assert.deepEqual(seen, [rows[4]!.orderId, rows[3]!.orderId, rows[2]!.orderId, rows[1]!.orderId, rows[0]!.orderId]);
    assert.deepEqual(cursors, ['102-9', '101-3', null]);

    const byBlock = await call(t.app, 'GET', `/venues/${VENUE}/payments?before=102`);
    assert.deepEqual(byBlock.body.payments.map((p: any) => p.orderId), [rows[1]!.orderId, rows[0]!.orderId]);

    const one = await call(t.app, 'GET', `/venues/${VENUE}/payments?limit=1`);
    assert.equal(one.body.payments.length, 1);
    assert.equal(one.body.nextBefore, '103-2');
  } finally {
    await t.close();
  }
});

test('feed: bad limit/before → 400; unknown venue → 404 UNKNOWN_VENUE; known venue with no payments → empty', async () => {
  const { t } = await setup();
  try {
    for (const q of ['limit=0', 'limit=51', 'limit=abc', 'before=abc', 'before=1-2-3', 'before=-5']) {
      const r = await call(t.app, 'GET', `/venues/${VENUE}/payments?${q}`);
      assert.equal(r.status, 400, q);
      assert.equal(r.body.error.code, 'BAD_REQUEST', q);
    }
    const max = await call(t.app, 'GET', `/venues/${VENUE}/payments?limit=50`);
    assert.equal(max.status, 200);
    const u = await call(t.app, 'GET', `/venues/${OTHER}/payments`);
    assert.equal(u.status, 404);
    assert.equal(u.body.error.code, 'UNKNOWN_VENUE');
    assert.equal((await call(t.app, 'GET', '/venues/not-an-address/payments')).status, 400);

    t.chain.venues.set(OTHER.toLowerCase(), { ...t.chain.venues.get(VENUE.toLowerCase())! });
    const empty = await call(t.app, 'GET', `/venues/${OTHER}/payments`);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.payments, []);
    assert.equal(empty.body.nextBefore, null);
  } finally {
    await t.close();
  }
});

test('stats edges carry from/to/role/level/amount plus display names when known (existing fields unchanged)', async () => {
  const { t } = await setup();
  try {
    const r = await call(t.app, 'GET', `/venues/${VENUE}/stats`);
    assert.equal(r.status, 200);
    const e = r.body.edges.find((x: any) => x.role === 1 && x.to === P.ana.address && x.from === P.ben.address);
    assert.ok(e, JSON.stringify(r.body.edges));
    for (const k of ['orderId', 'from', 'to', 'role', 'amount', 'txHash']) assert.ok(k in e, k);
    assert.equal(e.level, 1);
    assert.deepEqual(e.amount, { baseUnits: '990000', display: '0.99' });
    assert.equal(e.fromDisplayName, 'Ben');
    assert.equal(e.toDisplayName, 'Ana');
    const l2 = r.body.edges.find((x: any) => x.role === 2);
    assert.equal(l2.from, P.ana.address, 'L2 edges come from the referrer');
    assert.equal(l2.toDisplayName, null);
    assert.ok(!r.body.edges.some((x: any) => x.role === 2 && x.to === P.ben.address), 'returned lines are not edges');
  } finally {
    await t.close();
  }
});
