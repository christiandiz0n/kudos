/**
 * Demo top-up (D-811): disabled path, auth, once-per-address under concurrency, rolling daily cap, per-IP limit,
 * funder floor, re-claim after a failed send, budget exemption, and the dedicated TOPUP_PRIVATE_KEY funder.
 * FakeChain only (no RPC, no real keys).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARC_TESTNET_USDC_ADDRESS } from '@vouch/shared';
import type { TopupConfig } from '../config';
import { seedRelayerBudget } from '../services';
import { FakeChain } from './fake-chain';
import { P, acct, call, keyOf, makeApp, signIn, type TestApp } from './helpers';

const AMOUNT = 3_000_000n;
const topup = (over: Partial<TopupConfig> = {}): TopupConfig => ({
  enabled: true,
  amount: AMOUNT,
  dailyCap: 30_000_000n,
  perIpPerHour: 50,
  funderFloor: 5_000_000n,
  key: undefined,
  ...over,
});

const transfers = (chain: FakeChain) => chain.sent.filter((t) => t.fn === 'transfer');

/** Wait until the background completion handler has written the final status. */
async function settle(t: TestApp, token: string, want = 'confirmed') {
  for (let i = 0; i < 200; i++) {
    const g = await call(t.app, 'GET', '/demo/topup', token);
    if (g.body.topup?.status === want) return g;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`topup never reached ${want}`);
}

test('topup disabled (default config): GET says disabled, POST → 503 TOPUP_DISABLED (not retryable), nothing sent', async () => {
  const t = await makeApp({ cfg: { topup: topup({ enabled: false }) } });
  try {
    const tok = await signIn(t.app, P.ben);
    const g = await call(t.app, 'GET', '/demo/topup', tok);
    assert.equal(g.status, 200);
    assert.deepEqual({ enabled: g.body.enabled, eligible: g.body.eligible, reason: g.body.reason }, { enabled: false, eligible: false, reason: 'TOPUP_DISABLED' });
    assert.equal(g.body.amount.baseUnits, '3000000');
    const p = await call(t.app, 'POST', '/demo/topup', tok);
    assert.equal(p.status, 503);
    assert.equal(p.body.error.code, 'TOPUP_DISABLED');
    assert.equal(p.body.error.retryable, false);
    assert.equal(transfers(t.chain).length, 0);
  } finally {
    await t.close();
  }
});

test('topup disabled when no funder key is configured (no relayer, no TOPUP_PRIVATE_KEY)', async () => {
  const t = await makeApp({ relayer: false, cfg: { topup: topup() } });
  try {
    const tok = await signIn(t.app, P.ben);
    assert.equal((await call(t.app, 'GET', '/demo/topup', tok)).body.reason, 'TOPUP_DISABLED');
    assert.equal((await call(t.app, 'POST', '/demo/topup', tok)).body.error.code, 'TOPUP_DISABLED');
  } finally {
    await t.close();
  }
});

test('topup: auth required for POST; GET without a session reports UNAUTHENTICATED', async () => {
  const t = await makeApp({ cfg: { topup: topup() } });
  try {
    const p = await call(t.app, 'POST', '/demo/topup');
    assert.equal(p.status, 401);
    assert.equal(p.body.error.code, 'UNAUTHENTICATED');
    const g = await call(t.app, 'GET', '/demo/topup');
    assert.equal(g.status, 200);
    assert.deepEqual({ enabled: g.body.enabled, eligible: g.body.eligible, reason: g.body.reason }, { enabled: true, eligible: false, reason: 'UNAUTHENTICATED' });
    assert.equal(transfers(t.chain).length, 0);
  } finally {
    await t.close();
  }
});

test('topup happy path via the relayer queue: 202 pending, USDC transfer to the caller, SSE pending/confirmed, budget untouched', async () => {
  const t = await makeApp({ cfg: { topup: topup() } });
  try {
    const events: { channel: string; event: string; data: any }[] = [];
    const orig = t.deps.sse.publish.bind(t.deps.sse);
    t.deps.sse.publish = (channel, event, data) => {
      events.push({ channel, event, data });
      return orig(channel, event, data);
    };
    const tok = await signIn(t.app, P.ben);
    const before = await call(t.app, 'GET', '/demo/topup', tok);
    assert.equal(before.body.eligible, true);
    assert.equal(before.body.reason, undefined);
    assert.equal(before.body.dailyRemaining.baseUnits, '30000000');

    const p = await call(t.app, 'POST', '/demo/topup', tok);
    assert.equal(p.status, 202, JSON.stringify(p.body));
    assert.equal(p.body.status, 'pending');
    assert.deepEqual(p.body.amount, { baseUnits: '3000000', display: '3.00' });
    assert.match(p.body.txHash, /^0x[0-9a-f]{64}$/);
    assert.equal(typeof p.body.relayId, 'string');

    const [tx] = transfers(t.chain);
    assert.equal(tx?.to, ARC_TESTNET_USDC_ADDRESS, 'ERC-20 transfer on USDC');
    assert.equal(await t.chain.usdcBalance(P.ben.address), AMOUNT);

    const after = await settle(t, tok);
    assert.equal(after.body.eligible, false);
    assert.equal(after.body.reason, 'TOPUP_ALREADY_CLAIMED');
    assert.equal(after.body.topup.txHash, p.body.txHash);
    assert.equal(after.body.dailyRemaining.baseUnits, '27000000');

    const relay = await call(t.app, 'GET', `/relay/${p.body.relayId}`, tok);
    assert.equal(relay.body.kind, 'topup');
    assert.equal(relay.body.status, 'mined');

    const topupEvents = events.filter((e) => e.event === 'wallet.topup');
    assert.deepEqual(topupEvents.map((e) => e.data.status), ['pending', 'confirmed']);
    assert.ok(topupEvents.every((e) => e.channel === `user:${P.ben.address.toLowerCase()}`));

    // D-808 untouched: the top-up's gas is not in the relayer spend budget, now or after a restart re-seed.
    assert.equal(t.deps.relayer.budget.snapshot().daily.used, 0n);
    assert.equal(await seedRelayerBudget(t.deps), 0);

    const again = await call(t.app, 'POST', '/demo/topup', tok);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'TOPUP_ALREADY_CLAIMED');
    assert.equal(transfers(t.chain).length, 1);
  } finally {
    await t.close();
  }
});

test('topup once per address under concurrency: 8 simultaneous POSTs → one 202, seven 409, one transfer', async () => {
  const t = await makeApp({ cfg: { topup: topup() } });
  try {
    const tok = await signIn(t.app, P.ana);
    const rs = await Promise.all(Array.from({ length: 8 }, () => call(t.app, 'POST', '/demo/topup', tok)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409, 409, 409, 409, 409, 409, 409]);
    assert.ok(rs.filter((r) => r.status === 409).every((r) => r.body.error.code === 'TOPUP_ALREADY_CLAIMED'));
    assert.equal(transfers(t.chain).length, 1);
    assert.equal(await t.chain.usdcBalance(P.ana.address), AMOUNT);
  } finally {
    await t.close();
  }
});

test('topup global daily cap: cap = 2 top-ups; 4 concurrent wallets → 2 × 202, 2 × 429 TOPUP_DAILY_CAP_REACHED', async () => {
  const t = await makeApp({ cfg: { topup: topup({ dailyCap: 2n * AMOUNT }) } });
  try {
    const who = [P.lena, P.sam, P.ana, P.priya];
    const toks = await Promise.all(who.map((a) => signIn(t.app, a)));
    const rs = await Promise.all(toks.map((tok) => call(t.app, 'POST', '/demo/topup', tok)));
    assert.deepEqual(rs.map((r) => r.status).sort(), [202, 202, 429, 429]);
    const refused = rs.filter((r) => r.status === 429);
    assert.ok(refused.every((r) => r.body.error.code === 'TOPUP_DAILY_CAP_REACHED' && r.body.error.retryable === false));
    assert.equal(transfers(t.chain).length, 2);
    const g = await call(t.app, 'GET', '/demo/topup', await signIn(t.app, P.ben));
    assert.equal(g.body.reason, 'TOPUP_DAILY_CAP_REACHED');
    assert.equal(g.body.dailyRemaining.baseUnits, '0');
  } finally {
    await t.close();
  }
});

test('topup per-IP limit counts only granted top-ups (a 409 is refunded)', async () => {
  const t = await makeApp({ cfg: { topup: topup({ perIpPerHour: 2 }) } });
  try {
    const [a, b, c] = await Promise.all([signIn(t.app, P.lena), signIn(t.app, P.sam), signIn(t.app, P.ana)]);
    assert.equal((await call(t.app, 'POST', '/demo/topup', a)).status, 202);
    assert.equal((await call(t.app, 'POST', '/demo/topup', a)).status, 409, 'already claimed; does not use the IP quota');
    assert.equal((await call(t.app, 'POST', '/demo/topup', b)).status, 202);
    const r = await call(t.app, 'POST', '/demo/topup', c);
    assert.equal(r.status, 429);
    assert.equal(r.body.error.code, 'RATE_LIMITED');
    assert.equal(r.body.error.details.scope, 'topup_ip');
    assert.equal(transfers(t.chain).length, 2);
  } finally {
    await t.close();
  }
});

test('topup funder below floor → TOPUP_DISABLED and no claim is consumed; works again once refilled', async () => {
  const t = await makeApp({ cfg: { topup: topup() } });
  try {
    t.chain.relayerNative = 7_000_000n * 10n ** 12n; // $7 < $3 + $5 floor
    const tok = await signIn(t.app, P.priya);
    const g = await call(t.app, 'GET', '/demo/topup', tok);
    assert.deepEqual({ enabled: g.body.enabled, eligible: g.body.eligible, reason: g.body.reason }, { enabled: false, eligible: false, reason: 'TOPUP_DISABLED' });
    const p = await call(t.app, 'POST', '/demo/topup', tok);
    assert.equal(p.status, 503);
    assert.equal(p.body.error.code, 'TOPUP_DISABLED');
    assert.equal(transfers(t.chain).length, 0);
    t.chain.relayerNative = 10n ** 20n;
    assert.equal((await call(t.app, 'POST', '/demo/topup', tok)).status, 202);
  } finally {
    await t.close();
  }
});

test('topup: a send refused before broadcast marks the row failed; the address can claim again', async () => {
  const t = await makeApp({ cfg: { topup: topup() } });
  try {
    const tok = await signIn(t.app, P.eve);
    t.chain.forceRevert.set('transfer', { name: 'Error', reason: 'ERC20: transfer amount exceeds balance' });
    const p = await call(t.app, 'POST', '/demo/topup', tok);
    assert.ok(p.status >= 400, JSON.stringify(p.body));
    const g = await call(t.app, 'GET', '/demo/topup', tok);
    assert.equal(g.body.topup.status, 'failed');
    assert.equal(g.body.eligible, true);
    assert.equal(g.body.dailyRemaining.baseUnits, '30000000', 'failed rows do not count against the cap');
    assert.equal((await call(t.app, 'POST', '/demo/topup', tok)).status, 202);
    assert.equal(transfers(t.chain).length, 1);
  } finally {
    await t.close();
  }
});

test('topup is not gated by an exhausted relayer spend budget (own budget, D-808 untouched)', async () => {
  const t = await makeApp({
    cfg: {
      topup: topup(),
      budget: { globalHourly: 1n, globalDaily: 1n, perUserHourly: 1n, perUserDaily: 1n, perVenueHourly: 1n, perVenueDaily: 1n, minRelayerBalance: 0n },
    },
  });
  try {
    t.deps.relayer.budget.seed([{ id: 'spent', at: Date.now(), cost: 1n, user: '0xsomeone', venue: null }]);
    const tok = await signIn(t.app, P.sam);
    assert.equal((await call(t.app, 'POST', '/demo/topup', tok)).status, 202);
    assert.equal(t.deps.relayer.budget.snapshot().hourly.used, 1n);
  } finally {
    await t.close();
  }
});

test('TOPUP_PRIVATE_KEY: a dedicated funder sends through its own queue; the relayer key is never used', async () => {
  const funder = acct('topup-funder');
  const fchain = new FakeChain(funder.address);
  const t = await makeApp({ cfg: { topup: topup({ key: keyOf('topup-funder') }) }, topupChain: fchain });
  try {
    assert.equal(t.deps.topup.funder?.address, funder.address);
    assert.notEqual(t.deps.topup.funder, t.deps.relayer);
    const tok = await signIn(t.app, P.lena);
    const p = await call(t.app, 'POST', '/demo/topup', tok);
    assert.equal(p.status, 202, JSON.stringify(p.body));
    assert.equal(transfers(fchain).length, 1);
    assert.equal(t.chain.sent.length, 0, 'nothing on the relayer key');
    assert.equal(await fchain.usdcBalance(P.lena.address), AMOUNT);
  } finally {
    await t.close();
  }
});

test('TOPUP_PRIVATE_KEY equal to the relayer key reuses the relayer (no second sender on one key)', async () => {
  const t = await makeApp({ cfg: { topup: topup({ key: keyOf('relayer') }) } });
  try {
    assert.equal(t.deps.topup.funder, t.deps.relayer);
  } finally {
    await t.close();
  }
});
