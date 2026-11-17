/**
 * Phase 2 security-review fixes (SEC-2-02..13) and QE-2-01..08, end to end through the HTTP API (FakeChain, PGlite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Address, Hex } from 'viem';
import { ARC_TESTNET_USDC_ADDRESS } from '@vouch/shared';
import { buildApp } from '../app';
import { resolveTrustProxy } from '../http/security';
import { redactUrl, scrub } from '../http/redact';
import { FakeChain } from './fake-chain';
import { P, SESSION_SECRET, call, keyOf, makeApp, signIn, signTd, type TestApp } from './helpers';

async function venueFor(t: TestApp, lena: string): Promise<Address> {
  const prep = await call(t.app, 'POST', '/venues/prepare', lena, { name: 'Sec Café', rewardBps: 1500, minOrder: '1000000' });
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const sub = await call(t.app, 'POST', '/venues', lena, { venue: prep.body.venue, signature: await signTd(P.lena, prep.body.typedData) });
  assert.equal(sub.status, 202, JSON.stringify(sub.body));
  for (let i = 0; i < 50 && (await call(t.app, 'GET', `/relay/${sub.body.relayId}`, lena)).body.status !== 'mined'; i++) await new Promise((r) => setTimeout(r, 5));
  return prep.body.venue;
}

test('SEC-2-03/09: ?token= and cookies are refused on normal routes; ?token= works only on the SSE route', async () => {
  const t = await makeApp();
  try {
    const tok = await signIn(t.app, P.ana);
    assert.equal((await call(t.app, 'GET', '/auth/session', tok)).status, 200);
    assert.equal((await call(t.app, 'GET', `/auth/session?token=${encodeURIComponent(tok)}`)).status, 401);
    const cookie = await t.app.inject({ method: 'GET', url: '/me/wallet', headers: { cookie: `vouch_session=${encodeURIComponent(tok)}` } });
    assert.equal(cookie.statusCode, 401);
  } finally {
    await t.close();
  }
});

test('SEC-2-03/07: request logs never contain ?token= values or URLs inside error messages', async () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'vouch-api-'));
  const { app } = await buildApp(
    { databaseUrl: 'pglite://memory', streamsSpikeLog: path.join(dir, 's.ndjson') },
    { logger: { stream }, api: { chain: new FakeChain(P.relayer.address), cfg: { sessionSecret: SESSION_SECRET, relayerKey: keyOf('relayer') } } },
  );
  try {
    await app.inject({ method: 'GET', url: '/events/user/0x000000000000000000000000000000000000dEaD?token=v1.SECRETPAYLOAD.SECRETMAC' });
    await app.inject({ method: 'GET', url: '/me/wallet?token=v1.SECRETPAYLOAD.SECRETMAC&x=1' });
    const all = lines.join('');
    assert.ok(all.includes('incoming request'), 'request logging is on');
    assert.ok(!all.includes('SECRETPAYLOAD'), 'token never logged');
    assert.ok(all.includes('token=[redacted]'));
  } finally {
    await app.close();
  }
  assert.equal(redactUrl('/a?token=v1.x.y&b=2'), '/a?token=[redacted]&b=2');
  assert.equal(scrub('HTTP request failed. URL: https://abc.quiknode.pro/KEY123/ Details: x'), 'HTTP request failed. URL: <url> Details: x');
});

test('SEC-2-04: trustProxy trusts only the Railway range — client IP from XFF, spoofed leftmost entries ignored', async () => {
  assert.equal(resolveTrustProxy(undefined), '100.64.0.0/10');
  assert.equal(resolveTrustProxy('true'), '100.64.0.0/10', 'never blanket true');
  assert.equal(resolveTrustProxy('off'), false);
  const t = await makeApp({ cfg: { routeLimits: { auth: 2, spend: 20, write: 60, read: 300, sse: 20 } } });
  try {
    const hit = (xff: string, remoteAddress = '100.64.0.7') =>
      t.app.inject({ method: 'POST', url: '/auth/challenge', remoteAddress, headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, payload: JSON.stringify({ address: P.ana.address }) });
    assert.equal((await hit('203.0.113.9')).statusCode, 200);
    assert.equal((await hit('203.0.113.9', '100.64.0.12')).statusCode, 200, 'same client through another Railway hop = same bucket');
    assert.equal((await hit('203.0.113.9')).statusCode, 429);
    assert.equal((await hit('1.2.3.4, 203.0.113.9')).statusCode, 429, 'a spoofed leftmost XFF entry does not change the client');
    assert.equal((await hit('203.0.113.10')).statusCode, 200, 'another client has its own bucket');
    // A peer outside the trusted range: XFF ignored, the socket address is the client.
    assert.equal((await hit('203.0.113.77', '198.51.100.5')).statusCode, 200);
    assert.equal((await hit('203.0.113.78', '198.51.100.5')).statusCode, 200);
    assert.equal((await hit('203.0.113.79', '198.51.100.5')).statusCode, 429);
  } finally {
    await t.close();
  }
});

test('SEC-2-02/09: per-route-class limits — spend routes are tighter than reads', async () => {
  const t = await makeApp({ cfg: { routeLimits: { auth: 50, spend: 1, write: 60, read: 300, sse: 20 } } });
  try {
    const lena = await signIn(t.app, P.lena);
    const a = await call(t.app, 'POST', '/venues/prepare', lena, { name: 'A', rewardBps: 1500 });
    assert.equal(a.status, 200);
    const b = await call(t.app, 'POST', '/venues/prepare', lena, { name: 'B', rewardBps: 1500 });
    assert.equal(b.status, 429);
    assert.equal(b.body.error.code, 'RATE_LIMITED');
    assert.equal(b.body.error.details.scope, 'spend');
    for (let i = 0; i < 5; i++) assert.equal((await call(t.app, 'GET', '/relayer/status')).status, 200, 'reads still fine');
  } finally {
    await t.close();
  }
});

test('SEC-2-02: global spend budget exhausted → RELAYER_BUDGET_EXHAUSTED (503, retryable), nothing sent; /relayer/status shows remaining', async () => {
  // registerVenue reservation ≈ 216k gas × 25 gwei = 0.0054; a $0.006 hourly budget allows exactly one.
  const t = await makeApp({
    cfg: { budget: { globalHourly: 6_000n, globalDaily: 6_000n, perUserHourly: 10_000_000n, perUserDaily: 10_000_000n, perVenueHourly: 10_000_000n, perVenueDaily: 10_000_000n, minRelayerBalance: 0n } },
  });
  try {
    const lena = await signIn(t.app, P.lena);
    const venue = await venueFor(t, lena);
    const st = await call(t.app, 'GET', '/relayer/status');
    assert.equal(st.body.budget.hourly.limit.baseUnits, '6000');
    assert.equal(st.body.budget.hourly.used.baseUnits, '5000', 'settled to the actual fee (200k × 25 gwei)');
    assert.equal(st.body.signers, undefined, 'no per-secret disclosure (SEC-2-08)');
    const sent = t.chain.sent.length;
    const prep = await call(t.app, 'POST', `/venues/${venue}/actions`, lena, { kind: 'setSeedAmbassador', ambassador: P.sam.address, allowed: true });
    const sub = await call(t.app, 'POST', `/venues/${venue}/actions/${prep.body.actionId}`, lena, { signature: await signTd(P.lena, prep.body.typedData) });
    // setSeed reservation 76.8k × 25 gwei = 0.00192 > 0.001 remaining.
    assert.equal(sub.status, 503, JSON.stringify(sub.body));
    assert.equal(sub.body.error.code, 'RELAYER_BUDGET_EXHAUSTED');
    assert.equal(sub.body.error.retryable, true);
    assert.equal(t.chain.sent.length, sent);
  } finally {
    await t.close();
  }
});

test('SEC-2-02: per-user and per-venue quotas → SPEND_QUOTA_EXCEEDED (429)', async () => {
  const t = await makeApp({
    cfg: { budget: { globalHourly: 10n ** 9n, globalDaily: 10n ** 9n, perUserHourly: 6_000n, perUserDaily: 10n ** 9n, perVenueHourly: 10n ** 9n, perVenueDaily: 10n ** 9n, minRelayerBalance: 0n } },
  });
  try {
    const lena = await signIn(t.app, P.lena);
    const venue = await venueFor(t, lena);
    const prep = await call(t.app, 'POST', `/venues/${venue}/actions`, lena, { kind: 'setSeedAmbassador', ambassador: P.sam.address, allowed: true });
    const sub = await call(t.app, 'POST', `/venues/${venue}/actions/${prep.body.actionId}`, lena, { signature: await signTd(P.lena, prep.body.typedData) });
    assert.equal(sub.status, 429);
    assert.equal(sub.body.error.code, 'SPEND_QUOTA_EXCEEDED');
    assert.equal(sub.body.error.details.scope, 'user');
  } finally {
    await t.close();
  }
});

test('QE-2-01: double-tapped POST /payments → exactly one relay; the loser gets 409 and never rewrites the intent', async () => {
  const t = await makeApp();
  try {
    const lena = await signIn(t.app, P.lena);
    const ben = await signIn(t.app, P.ben);
    t.chain.setBalance(P.ben.address, 20_000_000n);
    const venue = await venueFor(t, lena);
    const o = await call(t.app, 'POST', `/venues/${venue}/orders`, lena, { amount: '2000000' });
    const q = await call(t.app, 'POST', '/payments/quote', ben, { venue, orderId: o.body.order.orderId });
    const signature = await signTd(P.ben, q.body.typedData);
    const [r1, r2] = await Promise.all([
      call(t.app, 'POST', '/payments', ben, { intentId: q.body.intentId, signature }),
      call(t.app, 'POST', '/payments', ben, { intentId: q.body.intentId, signature }),
    ]);
    const codes = [r1.status, r2.status].sort();
    assert.deepEqual(codes, [202, 409], JSON.stringify([r1.body, r2.body]));
    const loser = r1.status === 409 ? r1 : r2;
    assert.equal(loser.body.error.code, 'PAYMENT_ALREADY_USED');
    for (let i = 0; i < 50; i++) {
      const g = await call(t.app, 'GET', `/payments/${q.body.intentId}`, ben);
      if (g.body.relayStatus !== 'relaying') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const g = await call(t.app, 'GET', `/payments/${q.body.intentId}`, ben);
    assert.equal(g.body.relayStatus, 'relayed', 'the winner stays relayed');
    assert.equal(t.chain.sent.filter((x) => x.fn === 'pay').length, 1);
    // A later retry after mining is refused without touching the row either.
    const r3 = await call(t.app, 'POST', '/payments', ben, { intentId: q.body.intentId, signature });
    assert.equal(r3.status, 409);
    assert.equal((await call(t.app, 'GET', `/payments/${q.body.intentId}`, ben)).body.relayStatus, 'relayed');
  } finally {
    await t.close();
  }
});

test('SEC-2-12 / QE-2-09: a refused attempt (e.g. insufficient balance, budget) never marks the shared order failed', async () => {
  const t = await makeApp();
  try {
    const lena = await signIn(t.app, P.lena);
    const ben = await signIn(t.app, P.ben);
    const venue = await venueFor(t, lena);
    const o = await call(t.app, 'POST', `/venues/${venue}/orders`, lena, { amount: '2000000' });
    const q = await call(t.app, 'POST', '/payments/quote', ben, { venue, orderId: o.body.order.orderId });
    t.chain.gasOverride = 5_000_000n; // GAS_TOO_HIGH inside the relayer, after the claim
    t.chain.setBalance(P.ben.address, 20_000_000n);
    const p = await call(t.app, 'POST', '/payments', ben, { intentId: q.body.intentId, signature: await signTd(P.ben, q.body.typedData) });
    assert.equal(p.body.error.code, 'GAS_TOO_HIGH');
    const g = await call(t.app, 'GET', `/venues/${venue}/orders/${o.body.order.orderId}`);
    assert.equal(g.body.relayStatus, 'pending', 'order untouched');
  } finally {
    await t.close();
  }
});

test('SEC-2-05: logged-out opens are recorded but never weighted (canonical signed-in opens stay exact)', async () => {
  const t = await makeApp();
  try {
    const tok: Record<string, string> = {};
    for (const [n, a] of Object.entries({ lena: P.lena, sam: P.sam, ana: P.ana, priya: P.priya, ben: P.ben })) tok[n] = await signIn(t.app, a, n);
    const venue = await venueFor(t, tok.lena!);
    for (const n of ['ana', 'priya']) {
      t.chain.customers.set(`${venue.toLowerCase()}:${(P as Record<string, { address: Address }>)[n]!.address.toLowerCase()}`, { verified: true, rewarded: true, introCount: 0, introducer: P.sam.address, verifiedAt: 0n });
    }
    const link = async (n: 'ana' | 'priya', a: typeof P.ana, linkType: string) => {
      const prep = await call(t.app, 'POST', '/intros/prepare', tok[n], { venue, linkType });
      return (await call(t.app, 'POST', '/intros', tok[n], { intro: prep.body.typedData.message, signature: await signTd(a, prep.body.typedData) })).body.code as string;
    };
    const ca = await link('ana', P.ana, 'personal');
    const cp = await link('priya', P.priya, 'broadcast');
    // 10 anonymous opens of Priya's link (a referrer pumping their own link while logged out).
    for (let i = 0; i < 10; i++) {
      const r = await call(t.app, 'POST', `/intros/${cp}/opens`, undefined, {});
      assert.equal(r.body.countsForAttribution, false);
    }
    for (const code of [ca, cp]) {
      const prep = await call(t.app, 'POST', `/intros/${code}/accept/prepare`, tok.ben, {});
      await call(t.app, 'POST', `/intros/${code}/accept`, tok.ben, { acceptance: prep.body.acceptance, signature: await signTd(P.ben, prep.body.typedData) });
    }
    t.chain.setBalance(P.ben.address, 20_000_000n);
    const o = await call(t.app, 'POST', `/venues/${venue}/orders`, tok.lena, { amount: '12000000' });
    const q = await call(t.app, 'POST', '/payments/quote', tok.ben, { venue, orderId: o.body.order.orderId });
    assert.deepEqual(q.body.attribution.bps, [6_667, 3_333], 'link type only: anonymous opens ignored');
  } finally {
    await t.close();
  }
});

test('SEC-2-06: SSE caps (per client, unknown venue) refuse before streaming', async () => {
  const t = await makeApp({ cfg: { sse: { maxConnections: 10, maxPerIp: 1, maxPerChannel: 10, maxAgeMs: 60_000, heartbeatMs: 60_000, maxBufferedBytes: 1024 } } });
  try {
    const unknown = await t.app.inject({ method: 'GET', url: '/events/venue/0x000000000000000000000000000000000000dEaD' });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().error.code, 'UNKNOWN_VENUE');
    // Simulate one open connection from this client, then a second is refused.
    const fakeRes = new Writable({ write: (_c, _e, cb) => cb() }) as unknown as import('node:http').ServerResponse;
    Object.assign(fakeRes, { writeHead: () => fakeRes });
    const ip = t.deps.sse;
    const k = (await import('node:crypto')).createHash('sha256').update('vouch-ip:127.0.0.1').digest('hex').slice(0, 32);
    ip.attach('venue:x', fakeRes, { ip: k });
    const lena = await signIn(t.app, P.lena);
    const venue = await venueFor(t, lena);
    const r = await t.app.inject({ method: 'GET', url: `/events/venue/${venue}` });
    assert.equal(r.statusCode, 429);
    assert.equal(r.json().error.code, 'TOO_MANY_CONNECTIONS');
  } finally {
    await t.close();
  }
});

test('SEC-2-08/13: security headers, standard 404 body, CORS allows PATCH', async () => {
  const t = await makeApp();
  try {
    const h = await t.app.inject({ method: 'GET', url: '/health' });
    assert.equal(h.headers['x-content-type-options'], 'nosniff');
    assert.equal(h.headers['x-frame-options'], 'DENY');
    assert.equal(h.headers['referrer-policy'], 'no-referrer');
    assert.match(String(h.headers['content-security-policy']), /default-src 'none'/);
    assert.match(String(h.headers['strict-transport-security']), /max-age=/);
    const nf = await t.app.inject({ method: 'GET', url: '/nope' });
    assert.equal(nf.statusCode, 404);
    assert.equal(nf.json().error.code, 'NOT_FOUND');
    const pre = await t.app.inject({ method: 'OPTIONS', url: '/me', headers: { origin: 'http://localhost:3100', 'access-control-request-method': 'PATCH' } });
    assert.match(String(pre.headers['access-control-allow-methods']), /PATCH/);
    // No config disclosure (SEC-2-08).
    const noSecret = await makeApp({ cfg: { sessionSecret: undefined } });
    const r = await call(noSecret.app, 'POST', '/auth/challenge', undefined, { address: P.ana.address });
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(r.body).includes('SESSION_SECRET'));
    await noSecret.close();
  } finally {
    await t.close();
  }
});

test('QE-2-03/04/06/08 + SEC-2-11: payout guard, strict boolean, ORDER_EXPIRED at pay, 404s, min order, registered-only list', async () => {
  const t = await makeApp();
  try {
    const lena = await signIn(t.app, P.lena);
    for (const payout of [t.chain.vouch, ARC_TESTNET_USDC_ADDRESS]) {
      const r = await call(t.app, 'POST', '/venues/prepare', lena, { name: 'Bad', rewardBps: 1500, payout });
      assert.equal(r.body.error?.code, 'INVALID_PAYOUT', payout);
    }
    // A prepared (unsigned) venue is not listed.
    await call(t.app, 'POST', '/venues/prepare', lena, { name: 'Draft', rewardBps: 1500 });
    const venue = await venueFor(t, lena);
    const list = await call(t.app, 'GET', '/venues?limit=1');
    assert.equal(list.body.venues.length, 1);
    assert.equal(list.body.venues[0].venue, venue);
    assert.equal(list.body.nextOffset, null);
    assert.equal((await call(t.app, 'GET', '/venues?limit=500')).status, 400);
    const bad = await call(t.app, 'POST', `/venues/${venue}/actions`, lena, { kind: 'setSeedAmbassador', ambassador: P.sam.address, allowed: 'true' });
    assert.equal(bad.status, 400);
    const keys = await call(t.app, 'POST', `/venues/${venue}/actions`, lena, { kind: 'setKeys', payout: t.chain.vouch });
    assert.equal(keys.body.error.code, 'INVALID_PAYOUT');
    const unknown = '0x000000000000000000000000000000000000dEaD';
    assert.equal((await call(t.app, 'GET', `/venues/${unknown}/terms`)).status, 404);
    assert.equal((await call(t.app, 'GET', `/venues/${unknown}/stats`)).status, 404);
    assert.equal((await call(t.app, 'POST', `/venues/${venue}/orders`, lena, { amount: '100000' })).body.error.code, 'INVALID_AMOUNT', '$0.10 < $0.50 minimum');
    // ORDER_EXPIRED (not PAYMENT_EXPIRED) when the QR expired between quote and pay.
    const ben = await signIn(t.app, P.ben);
    t.chain.setBalance(P.ben.address, 20_000_000n);
    const o = await call(t.app, 'POST', `/venues/${venue}/orders`, lena, { amount: '1000000', ttlSeconds: 30 });
    const q = await call(t.app, 'POST', '/payments/quote', ben, { venue, orderId: o.body.order.orderId });
    t.chain.time += 120n;
    const p = await call(t.app, 'POST', '/payments', ben, { intentId: q.body.intentId, signature: await signTd(P.ben, q.body.typedData) });
    assert.equal(p.body.error.code, 'ORDER_EXPIRED');
    void ({} as Hex);
  } finally {
    await t.close();
  }
});
