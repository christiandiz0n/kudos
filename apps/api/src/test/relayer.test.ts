/**
 * Relayer unit tests against a scripted chain (no RPC): nonce gaps and external advances, "nonce too low" resync,
 * replacement with fee bump on receipt timeout, transport retries, OrderAlreadySettled terminal (QE-C-10), job
 * pre-flight refusal (QE-C-11), max-gas and fee-cap guards, relayer balance, rate limits, queue depth, serialization.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex, type Address, type Hex } from 'viem';
import type { Fees, ReceiptLite, RelayChain, SimResult, TxRequest } from '../chain/client';
import { DEFAULT_MAX_GAS } from '../config';
import { ApiError } from '../http/errors';
import { NonceManager, Relayer, type RelayJob, type RelayRow } from '../relayer/relayer';
import { RateLimiter } from '../relayer/rate-limit';
import { assertCanPayRelayed, assertCanSelfSubmit, selfSubmitNeed } from '../relayer/preflight';

const RELAYER = '0x3eAFdcE9B632C036146960A03Db720dc84568daD' as Address;

class MockChain implements RelayChain {
  relayer: Address | null = RELAYER;
  pending = 0;
  latest = 0;
  sims: (SimResult | Error)[] = [];
  est = 400_000n;
  feeQuote: Fees = { maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n };
  balance = 10n ** 20n;
  sent: TxRequest[] = [];
  /** Errors to throw on the next sends (in order). */
  sendErrors: Error[] = [];
  /** Hashes that never get a receipt (dropped / stuck). */
  stuck = new Set<number>();
  /** Polls before a receipt appears. */
  polls = 0;
  private seen = new Map<Hex, number>();
  receipts = new Map<Hex, ReceiptLite>();
  events: string[] = [];
  onSimulate?: () => void;
  receiptStatus: 'success' | 'reverted' = 'success';

  async pendingNonce() {
    return this.pending;
  }
  async latestNonce() {
    return this.latest;
  }
  async fees() {
    return this.feeQuote;
  }
  async simulate(): Promise<SimResult> {
    this.events.push('simulate');
    this.onSimulate?.();
    const s = this.sims.shift();
    if (s instanceof Error) throw s;
    return s ?? { ok: true };
  }
  async estimateGas() {
    return this.est;
  }
  async send(tx: TxRequest): Promise<Hex> {
    this.events.push(`send:${tx.nonce}`);
    const e = this.sendErrors.shift();
    if (e) throw e;
    this.sent.push(tx);
    const hash = keccak256(toHex(`h${this.sent.length}`));
    if (!this.stuck.has(this.sent.length)) {
      this.seen.set(hash, 0);
    }
    if (tx.nonce >= this.pending) this.pending = tx.nonce + 1;
    return hash;
  }
  async receipt(hash: Hex): Promise<ReceiptLite | null> {
    const n = this.seen.get(hash);
    if (n === undefined) return null;
    if (n < this.polls) {
      this.seen.set(hash, n + 1);
      return null;
    }
    const tx = this.sent[[...this.seen.keys()].indexOf(hash)] ?? this.sent.at(-1)!;
    this.latest = Math.max(this.latest, tx.nonce + 1);
    const r: ReceiptLite = { status: this.receiptStatus, blockNumber: 1n, gasUsed: 300_000n, effectiveGasPrice: tx.maxFeePerGas, from: RELAYER };
    this.receipts.set(hash, r);
    return r;
  }
  async relayerBalance() {
    return this.balance;
  }
}

function mk(chain: MockChain, over: Partial<ConstructorParameters<typeof Relayer>[1]> = {}) {
  const rows = new Map<string, RelayRow>();
  const r = new Relayer(chain, {
    maxGas: DEFAULT_MAX_GAS,
    maxFeePerGasCap: 200_000_000_000n,
    receiptTimeoutMs: 5,
    maxSendAttempts: 4,
    limits: { perUserPerMinute: 100, globalPerMinute: 1000, maxQueue: 50 },
    pollMs: 1,
    sleep: async () => {},
    store: {
      insert: async (row) => void rows.set(row.id, { ...row }),
      update: async (id, p) => void rows.set(id, { ...rows.get(id)!, ...p }),
    },
    ...over,
  });
  return { r, rows };
}

const job = (over: Partial<RelayJob> = {}): RelayJob => ({ kind: 'pay', data: '0x1234', user: '0xben', ref: 'intent:1', ...over });

async function expectApiError(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof ApiError && e.code === code);
}

test('happy path: simulate → estimate (×1.2) → send at chain pending nonce → mined', async () => {
  const c = new MockChain();
  c.pending = 7;
  const { r, rows } = mk(c);
  const h = await r.submit(job());
  const out = await h.done;
  assert.equal(out.status, 'mined');
  assert.equal(c.sent[0]!.nonce, 7);
  assert.equal(c.sent[0]!.gas, 480_000n);
  assert.ok(c.sent[0]!.maxFeePerGas >= 20_000_000_000n);
  assert.equal(rows.get(h.id)!.status, 'mined');
  assert.equal(r.nonces.peek(), 8);
});

test('fees below the Arc floor are clamped up to 20 gwei', async () => {
  const c = new MockChain();
  c.feeQuote = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 5_000_000_000n };
  const { r } = mk(c);
  await (await r.submit(job())).done;
  assert.equal(c.sent[0]!.maxFeePerGas, 20_000_000_000n);
  assert.ok(c.sent[0]!.maxPriorityFeePerGas <= c.sent[0]!.maxFeePerGas);
});

test('QE-C-10: OrderAlreadySettled on simulation is terminal — no send, no retry, mapped to ORDER_ALREADY_PAID', async () => {
  const c = new MockChain();
  c.sims = [{ ok: false, revert: { name: 'OrderAlreadySettled' } }];
  const { r, rows } = mk(c);
  await expectApiError(r.submit(job()), 'ORDER_ALREADY_PAID');
  assert.equal(c.sent.length, 0);
  assert.equal(c.events.filter((e) => e === 'simulate').length, 1, 'simulated once, never retried');
  assert.equal([...rows.values()][0]!.status, 'failed');
  assert.equal([...rows.values()][0]!.errorCode, 'ORDER_ALREADY_PAID');
});

test('other reverts map to friendly codes (expired order, USDC balance string) and are terminal', async () => {
  const c = new MockChain();
  c.sims = [{ ok: false, revert: { name: 'OrderExpired' } }, { ok: false, revert: { name: 'Error', reason: 'ERC20: transfer amount exceeds balance' } }, { ok: false, revert: { name: 'CustomerAlreadyVerified' } }];
  const { r } = mk(c);
  await expectApiError(r.submit(job()), 'ORDER_EXPIRED');
  await expectApiError(r.submit(job()), 'INSUFFICIENT_BALANCE');
  await expectApiError(r.submit(job({ kind: 'acceptIntro' })), 'ALREADY_REWARDED');
  assert.equal(c.sent.length, 0);
});

test('QE-C-11: job pre-flight (balance) runs inside the lock and refuses before estimating/sending', async () => {
  const c = new MockChain();
  const { r } = mk(c);
  const chain = { usdcBalance: async () => 11_999_999n };
  await expectApiError(r.submit(job({ preflight: () => assertCanPayRelayed(chain, RELAYER, 12_000_000n).then(() => {}) })), 'INSUFFICIENT_BALANCE');
  assert.equal(c.sent.length, 0);
});

test('max-gas guard: estimate × 1.2 above the per-kind cap is refused (GAS_TOO_HIGH), nothing sent', async () => {
  const c = new MockChain();
  c.est = 1_000_001n; // × 1.2 > 1.2M pay cap
  const { r } = mk(c);
  await expectApiError(r.submit(job()), 'GAS_TOO_HIGH');
  c.est = 170_000n; // acceptIntro cap 350k → 204k ok
  await (await r.submit(job({ kind: 'acceptIntro' }))).done;
  c.est = 300_000n; // 360k > 350k
  await expectApiError(r.submit(job({ kind: 'acceptIntro' })), 'GAS_TOO_HIGH');
  assert.equal(c.sent.length, 1);
});

test('fee cap: a fee quote above RELAYER_MAX_FEE is refused; relayer balance too low → RELAYER_UNDERFUNDED', async () => {
  const c = new MockChain();
  c.feeQuote = { maxFeePerGas: 500_000_000_000n, maxPriorityFeePerGas: 1n };
  const { r } = mk(c);
  await expectApiError(r.submit(job()), 'GAS_TOO_HIGH');
  c.feeQuote = { maxFeePerGas: 40_000_000_000n, maxPriorityFeePerGas: 1n };
  c.balance = 1_000n;
  await expectApiError(r.submit(job()), 'RELAYER_UNDERFUNDED');
  assert.equal(c.sent.length, 0);
});

test('nonce gap: a dropped tx leaves chain pending behind local → the next job reuses (fills) the lower nonce', async () => {
  const c = new MockChain();
  const { r } = mk(c);
  await (await r.submit(job())).done; // nonce 0
  assert.equal(r.nonces.peek(), 1);
  // Simulate local having advanced past a tx the node dropped: local 3, chain pending 1.
  (r.nonces as unknown as { local: number }).local = 3;
  await (await r.submit(job())).done;
  assert.equal(c.sent.at(-1)!.nonce, 1, 'gap filled at the chain pending nonce');
  assert.equal(r.nonces.gapsRecovered, 1);
});

test('external advance: the key was used elsewhere (chain pending ahead) → adopt the chain nonce', async () => {
  const c = new MockChain();
  const { r } = mk(c);
  await (await r.submit(job())).done;
  c.pending = 5;
  c.latest = 5;
  await (await r.submit(job())).done;
  assert.equal(c.sent.at(-1)!.nonce, 5);
  assert.equal(r.nonces.externalAdvances, 1);
});

test('"nonce too low" on send → resync from chain and resend', async () => {
  const c = new MockChain();
  const { r } = mk(c);
  c.sendErrors = [new Error('nonce too low: next nonce 4, tx nonce 0')];
  const origPending = c.pendingNonce.bind(c);
  let calls = 0;
  c.pendingNonce = async () => (++calls === 1 ? 0 : 4);
  const out = await (await r.submit(job())).done;
  assert.equal(out.status, 'mined');
  assert.deepEqual(c.events.filter((e) => e.startsWith('send')), ['send:0', 'send:4']);
  c.pendingNonce = origPending;
});

test('retry with fee bump: no receipt before the timeout → replacement at the SAME nonce with fees ×1.25', async () => {
  const c = new MockChain();
  c.stuck.add(1); // first broadcast never mines
  const { r, rows } = mk(c);
  const h = await r.submit(job());
  const out = await h.done;
  assert.equal(out.status, 'mined');
  assert.equal(c.sent.length, 2);
  assert.equal(c.sent[0]!.nonce, c.sent[1]!.nonce);
  assert.equal(c.sent[1]!.maxFeePerGas, (c.sent[0]!.maxFeePerGas * 125n) / 100n);
  assert.ok(c.sent[1]!.maxPriorityFeePerGas > c.sent[0]!.maxPriorityFeePerGas);
  assert.equal(rows.get(h.id)!.hashes.length, 2);
  assert.equal(h.hash, rows.get(h.id)!.hashes[0], 'submit resolves with the first broadcast hash');
});

test('gives up after maxSendAttempts without a receipt (TX_FAILED) and the next job recovers the nonce', async () => {
  const c = new MockChain();
  for (let i = 1; i <= 4; i++) c.stuck.add(i);
  const { r } = mk(c);
  const h = await r.submit(job());
  const out = await h.done;
  assert.equal(out.status, 'failed');
  assert.equal(out.status === 'failed' && out.error.code, 'TX_FAILED');
  assert.equal(c.sent.length, 4);
  // The node dropped them all: pending is back at 0 → the next job reuses nonce 0.
  c.pending = 0;
  await (await r.submit(job())).done;
  assert.equal(c.sent.at(-1)!.nonce, 0);
});

test('transport errors: simulate retried with backoff; persistent outage → RELAYER_DOWN', async () => {
  const c = new MockChain();
  c.sims = [new Error('fetch failed'), { ok: true }];
  const { r } = mk(c);
  assert.equal((await (await r.submit(job())).done).status, 'mined');
  c.sims = [1, 2, 3, 4, 5].map(() => new Error('ECONNREFUSED'));
  await expectApiError(r.submit(job()), 'RELAYER_DOWN');
});

test('underpriced replacement → bump and resend', async () => {
  const c = new MockChain();
  c.sendErrors = [new Error('replacement transaction underpriced')];
  const { r } = mk(c);
  assert.equal((await (await r.submit(job())).done).status, 'mined');
  assert.equal(c.sent.length, 1);
  assert.ok(c.sent[0]!.maxFeePerGas > c.feeQuote.maxFeePerGas);
});

test('no relayer key → RELAYER_DOWN; queue depth limit → RELAYER_BUSY', async () => {
  const c = new MockChain();
  c.relayer = null;
  await expectApiError(mk(c).r.submit(job()), 'RELAYER_DOWN');
  const c2 = new MockChain();
  c2.polls = 3;
  const { r } = mk(c2, { limits: { perUserPerMinute: 100, globalPerMinute: 100, maxQueue: 1 }, receiptTimeoutMs: 100 });
  const first = r.submit(job());
  await expectApiError(r.submit(job()), 'RELAYER_BUSY');
  await (await first).done;
});

test('rate limits: per-user then global; a refused global hit is refunded to the user', async () => {
  const c = new MockChain();
  const { r } = mk(c, { limits: { perUserPerMinute: 2, globalPerMinute: 3, maxQueue: 50 } });
  await (await r.submit(job({ user: '0xa' }))).done;
  await (await r.submit(job({ user: '0xa' }))).done;
  await expectApiError(r.submit(job({ user: '0xa' })), 'RATE_LIMITED');
  await (await r.submit(job({ user: '0xb' }))).done;
  await expectApiError(r.submit(job({ user: '0xc' })), 'RELAYER_BUSY');
  assert.equal(c.sent.length, 3);
});

test('serialized: the second job is simulated only after the first one is mined', async () => {
  const c = new MockChain();
  c.polls = 2;
  const { r } = mk(c, { receiptTimeoutMs: 100 });
  const a = r.submit(job({ ref: 'a' }));
  const b = r.submit(job({ ref: 'b' }));
  await (await a).done;
  await (await b).done;
  const ev = c.events.filter((e) => e === 'simulate' || e.startsWith('send'));
  assert.deepEqual(ev, ['simulate', 'send:0', 'simulate', 'send:1']);
});

test('NonceManager: first use adopts the chain; commit advances', async () => {
  const n = new NonceManager();
  const c = new MockChain();
  c.pending = 9;
  assert.equal(await n.next(c), 9);
  n.commit(9);
  assert.equal(n.peek(), 10);
});

test('RateLimiter: sliding window and retryAfter', () => {
  let t = 0;
  const l = new RateLimiter(2, 1_000, () => t);
  assert.ok(l.take('k'));
  assert.ok(l.take('k'));
  assert.ok(!l.take('k'));
  assert.equal(l.retryAfterMs('k'), 1_000);
  t = 1_000;
  assert.ok(l.take('k'));
});

test('preflight: self-submit needs amount + gasLimit × maxFeePerGas (rounded up to 6-dec)', async () => {
  assert.equal(selfSubmitNeed(12_000_000n, 700_000n, 25_000_000_000n), 12_017_500n);
  assert.equal(selfSubmitNeed(1n, 1n, 1n), 2n, '1 wei of fee rounds up to 1 base unit');
  await assert.rejects(assertCanSelfSubmit({ usdcBalance: async () => 12_017_499n }, RELAYER, 12_000_000n, 700_000n, 25_000_000_000n), (e: unknown) => e instanceof ApiError && e.code === 'INSUFFICIENT_BALANCE');
  const ok = await assertCanSelfSubmit({ usdcBalance: async () => 12_017_500n }, RELAYER, 12_000_000n, 700_000n, 25_000_000_000n);
  assert.equal(ok.needed, 12_017_500n);
});

// ------------------------------------------------------------------------------------------------ D-808 (SEC-2-02/12)
const BIG = 10n ** 12n;
const budget = (over: Partial<import('../config').SpendBudgetConfig> = {}) => ({
  globalHourly: BIG,
  globalDaily: BIG,
  perUserHourly: BIG,
  perUserDaily: BIG,
  perVenueHourly: BIG,
  perVenueDaily: BIG,
  minRelayerBalance: 0n,
  ...over,
});
// MockChain: est 400k → gasLimit 480k; maxFee 40 gwei → reservation 0.0192 USDC; actual 300k × 40 gwei = 0.012.

test('budget: global hourly exhausted → RELAYER_BUDGET_EXHAUSTED before any send', async () => {
  const c = new MockChain();
  const { r, rows } = mk(c, { budget: budget({ globalHourly: 10_000n }) });
  await expectApiError(r.submit(job()), 'RELAYER_BUDGET_EXHAUSTED');
  assert.equal(c.sent.length, 0);
  assert.equal([...rows.values()][0]!.feeUsdc, null, 'nothing charged when nothing was sent');
});

test('budget: reservations settle to the actual fee (reverted txs count too)', async () => {
  const c = new MockChain();
  const { r, rows } = mk(c, { budget: budget({ globalHourly: 32_000n }) });
  const h1 = await r.submit(job());
  await h1.done;
  assert.equal(rows.get(h1.id)!.feeUsdc, 12_000n);
  c.receiptStatus = 'reverted';
  const out = await (await r.submit(job())).done;
  assert.equal(out.status, 'reverted');
  assert.equal(r.budget.snapshot().hourly.used, 24_000n, 'the reverted tx is charged its real fee');
  await expectApiError(r.submit(job()), 'RELAYER_BUDGET_EXHAUSTED');
  assert.equal(c.sent.length, 2);
});

test('budget: per-venue and per-user quotas → SPEND_QUOTA_EXCEEDED; another venue/user is unaffected', async () => {
  const c = new MockChain();
  const { r } = mk(c, { budget: budget({ perVenueHourly: 20_000n, perUserHourly: 25_000n }) });
  await (await r.submit(job({ user: '0xa', venue: '0xv1' }))).done;
  await assert.rejects(r.submit(job({ user: '0xb', venue: '0xv1' })), (e: unknown) => e instanceof ApiError && e.code === 'SPEND_QUOTA_EXCEEDED' && e.details?.scope === 'venue');
  await assert.rejects(r.submit(job({ user: '0xa', venue: '0xv2' })), (e: unknown) => e instanceof ApiError && e.code === 'SPEND_QUOTA_EXCEEDED' && e.details?.scope === 'user');
  await (await r.submit(job({ user: '0xb', venue: '0xv2' }))).done;
  assert.equal(c.sent.length, 2);
});

test('budget: seeded spend survives a restart', async () => {
  const { r } = mk(new MockChain(), { budget: budget({ globalDaily: 50_000n }) });
  r.budget.seed([{ id: 'old', at: Date.now() - 3_600_000 * 5, cost: 45_000n, user: '0xa', venue: null }]);
  await expectApiError(r.submit(job()), 'RELAYER_BUDGET_EXHAUSTED');
});

test('pay lane: pay jumps ahead of queued non-pay jobs, and payReserve slots are pay-only', async () => {
  const c = new MockChain();
  c.est = 170_000n;
  c.polls = 2;
  const { r } = mk(c, { receiptTimeoutMs: 100, limits: { perUserPerMinute: 100, globalPerMinute: 100, maxQueue: 3, payReserve: 1 } });
  const a = r.submit(job({ kind: 'acceptIntro', ref: 'a' }));
  const b = r.submit(job({ kind: 'acceptIntro', ref: 'b' }));
  await expectApiError(r.submit(job({ kind: 'acceptIntro', ref: 'x' })), 'RELAYER_BUSY');
  const p = r.submit(job({ kind: 'pay', ref: 'p' }));
  const ha = await a;
  const hp = await p;
  const hb = await b;
  await Promise.all([ha.done, hp.done, hb.done]);
  // a was already running; the pay went next, before the earlier-queued b.
  const nth = (i: number) => keccak256(toHex(`h${i}`));
  assert.deepEqual([ha.hash, hp.hash, hb.hash], [nth(1), nth(2), nth(3)]);
});

test('per-kind quota: a user exceeding the acceptIntro quota → SPEND_QUOTA_EXCEEDED (scope kind)', async () => {
  const c = new MockChain();
  c.est = 170_000n;
  const { r } = mk(c, { limits: { perUserPerMinute: 100, globalPerMinute: 100, maxQueue: 50, kindQuota: { acceptIntro: { max: 1, windowMs: 3_600_000 } } } });
  await (await r.submit(job({ kind: 'acceptIntro' }))).done;
  await assert.rejects(r.submit(job({ kind: 'acceptIntro' })), (e: unknown) => e instanceof ApiError && e.code === 'SPEND_QUOTA_EXCEEDED' && e.details?.scope === 'kind');
  await (await r.submit(job({ kind: 'pay' }))).done;
});

test('balance floor: relayer below RELAYER_MIN_BALANCE → RELAYER_UNDERFUNDED + one ALERT log', async () => {
  const c = new MockChain();
  c.balance = 10n ** 18n; // $1.00
  const logs: string[] = [];
  const { r } = mk(c, { budget: budget({ minRelayerBalance: 2_000_000n }), log: (m) => void logs.push(m) });
  await expectApiError(r.submit(job()), 'RELAYER_UNDERFUNDED');
  await expectApiError(r.submit(job()), 'RELAYER_UNDERFUNDED');
  assert.equal(logs.filter((l) => l.startsWith('ALERT')).length, 1);
  assert.equal(c.sent.length, 0);
});

test('replacement re-simulation: state moved on (OrderAlreadySettled) → no bumped replacement is paid for', async () => {
  const c = new MockChain();
  c.stuck.add(1);
  c.sims = [{ ok: true }, { ok: false, revert: { name: 'OrderAlreadySettled' } }];
  const { r } = mk(c, { budget: budget() });
  const h = await r.submit(job());
  const out = await h.done;
  assert.equal(out.status, 'failed');
  assert.equal(out.status === 'failed' && out.error.code, 'ORDER_ALREADY_PAID');
  assert.equal(c.sent.length, 1, 'no replacement sent');
  assert.equal(r.budget.snapshot().hourly.used, 19_200n, 'the broadcast tx keeps its reservation (it may still mine)');
});

test('logs never carry the RPC URL (SEC-2-07)', async () => {
  const c = new MockChain();
  c.sendErrors = [new Error('HTTP request failed. URL: https://example.quiknode.pro/SECRETKEY/ Status: 500')];
  const logs: string[] = [];
  const { r } = mk(c, { log: (m, x) => void logs.push(`${m} ${JSON.stringify(x)}`) });
  await (await r.submit(job())).done;
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => !l.includes('SECRETKEY') && !l.includes('quiknode')), logs.join('\n'));
});
