/**
 * Endpoint contract tests (in-memory PGlite + FakeChain). The first test runs the whole canonical story through the
 * HTTP API exactly as the frontend / story:api CLI would: register venue → seed → intros (+ opens) → quotes → pays,
 * and checks the $12 quote is 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 with baseline weights 7000/3000.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrivateKeyAccount } from 'viem/accounts';
import { zeroAddress, type Address, type Hex } from 'viem';
import { createStubStreamsPort, type SettledPayment } from '../ports/streams';
import { P, call, makeApp, signIn, signTd, type TestApp } from './helpers';

interface Story {
  t: TestApp;
  tok: Record<string, string>;
  venue: Address;
}

async function waitRelay(t: TestApp, token: string, relayId: string) {
  for (let i = 0; i < 50; i++) {
    const r = await call(t.app, 'GET', `/relay/${relayId}`, token);
    if (['mined', 'reverted', 'failed'].includes(r.body.status)) return r.body;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error('relay did not finish');
}

async function register(t: TestApp, token: string, owner: PrivateKeyAccount, extra: Record<string, unknown> = {}) {
  const prep = await call(t.app, 'POST', '/venues/prepare', token, { name: "Lena's Café", rewardBps: 1500, minOrder: '1000000', ...extra });
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const signature = await signTd(owner, prep.body.typedData);
  const sub = await call(t.app, 'POST', '/venues', token, { venue: prep.body.venue, signature });
  assert.equal(sub.status, 202, JSON.stringify(sub.body));
  assert.equal(sub.body.status, 'pending');
  assert.match(sub.body.txHash, /^0x[0-9a-f]{64}$/);
  const done = await waitRelay(t, token, sub.body.relayId);
  assert.equal(done.status, 'mined');
  return prep.body.venue as Address;
}

async function ownerAction(t: TestApp, token: string, owner: PrivateKeyAccount, venue: Address, body: Record<string, unknown>) {
  const prep = await call(t.app, 'POST', `/venues/${venue}/actions`, token, body);
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const signature = await signTd(owner, prep.body.typedData);
  const sub = await call(t.app, 'POST', `/venues/${venue}/actions/${prep.body.actionId}`, token, { signature });
  assert.equal(sub.status, 202, JSON.stringify(sub.body));
  assert.equal((await waitRelay(t, token, sub.body.relayId)).status, 'mined');
  return prep.body;
}

async function makeLink(s: Story, referrer: PrivateKeyAccount, name: string, linkType: 'personal' | 'broadcast') {
  const prep = await call(s.t.app, 'POST', '/intros/prepare', s.tok[name], { venue: s.venue, linkType });
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const signature = await signTd(referrer, prep.body.typedData);
  const c = await call(s.t.app, 'POST', '/intros', s.tok[name], { intro: prep.body.typedData.message, signature });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.match(c.body.url, /\/i\/[0-9A-Za-z]+$/);
  return c.body.code as string;
}

async function accept(s: Story, code: string, customer: PrivateKeyAccount, name: string, opens = 1) {
  for (let i = 0; i < opens; i++) assert.equal((await call(s.t.app, 'POST', `/intros/${code}/opens`, s.tok[name], {})).status, 201);
  const prep = await call(s.t.app, 'POST', `/intros/${code}/accept/prepare`, s.tok[name], {});
  assert.equal(prep.status, 200, JSON.stringify(prep.body));
  const signature = await signTd(customer, prep.body.typedData);
  const a = await call(s.t.app, 'POST', `/intros/${code}/accept`, s.tok[name], { acceptance: prep.body.acceptance, signature });
  assert.equal(a.status, 202, JSON.stringify(a.body));
  assert.equal((await waitRelay(s.t, s.tok[name]!, a.body.relayId)).status, 'mined');
}

async function order(s: Story, amount: string) {
  const o = await call(s.t.app, 'POST', `/venues/${s.venue}/orders`, s.tok.lena, { amount });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  return o.body.order.orderId as Hex;
}

async function quote(s: Story, name: string, orderId: Hex, extra: Record<string, unknown> = {}) {
  const q = await call(s.t.app, 'POST', '/payments/quote', s.tok[name], { venue: s.venue, orderId, ...extra });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  return q.body;
}

async function pay(s: Story, customer: PrivateKeyAccount, name: string, q: any) {
  const signature = await signTd(customer, q.typedData);
  const p = await call(s.t.app, 'POST', '/payments', s.tok[name], { intentId: q.intentId, signature });
  assert.equal(p.status, 202, JSON.stringify(p.body));
  assert.equal(p.body.status, 'pending');
  assert.equal((await waitRelay(s.t, s.tok[name]!, p.body.relayId)).status, 'mined');
  return p.body;
}

async function setup(opts: Parameters<typeof makeApp>[0] = {}): Promise<Story> {
  const t = await makeApp(opts);
  const tok: Record<string, string> = {};
  for (const [name, a] of Object.entries({ lena: P.lena, sam: P.sam, ana: P.ana, priya: P.priya, ben: P.ben })) tok[name] = await signIn(t.app, a, name);
  for (const a of [P.ana, P.priya, P.ben]) t.chain.setBalance(a.address, 20_000_000n);
  const venue = await register(t, tok.lena!, P.lena);
  await ownerAction(t, tok.lena!, P.lena, venue, { kind: 'setSeedAmbassador', ambassador: P.sam.address, allowed: true });
  return { t, tok, venue };
}

test('canonical story through the API: register → seed → intros → quotes → pays (exact $12 split)', async () => {
  const s = await setup();
  try {
    // Ana joins via Sam (seed).
    await accept(s, await makeLink(s, P.sam, 'sam', 'personal'), P.ana, 'ana');
    let o = await order(s, '1000000');
    let q = await quote(s, 'ana', o);
    assert.deepEqual(q.attribution.referrers, [P.sam.address]);
    assert.deepEqual(q.attribution.bps, [10_000]);
    assert.equal(q.paymentAuth.submitter, P.relayer.address, 'submitter = RELAYER (D-014), never 0');
    await pay(s, P.ana, 'ana', q);
    // Priya joins via Ana.
    await accept(s, await makeLink(s, P.ana, 'ana', 'personal'), P.priya, 'priya');
    o = await order(s, '1000000');
    await pay(s, P.priya, 'priya', await quote(s, 'priya', o));
    // Ben: Ana personal (3 opens) + Priya broadcast (2 opens) → baseline 3.5 : 1.5 = 7000 / 3000.
    await accept(s, await makeLink(s, P.ana, 'ana', 'personal'), P.ben, 'ben', 3);
    await accept(s, await makeLink(s, P.priya, 'priya', 'broadcast'), P.ben, 'ben', 2);
    o = await order(s, '12000000');
    q = await quote(s, 'ben', o);
    assert.deepEqual(q.attribution.referrers, [P.ana.address, P.priya.address]);
    assert.deepEqual(q.attribution.bps, [7_000, 3_000]);
    assert.equal(q.quote.weightsMode, 1);
    assert.equal(q.quote.venueAmount.baseUnits, '10200000');
    assert.equal(q.quote.cashback.baseUnits, '450000');
    const l1 = q.quote.rewards.filter((r: any) => r.role === 'referrer');
    const l2 = q.quote.rewards.filter((r: any) => r.role === 'introducer');
    assert.deepEqual(l1.map((r: any) => [r.recipient, r.amount.baseUnits]), [[P.ana.address, '693000'], [P.priya.address, '297000']]);
    assert.deepEqual(l2.map((r: any) => [r.recipient, r.amount.baseUnits]), [[P.sam.address, '252000'], [P.ana.address, '108000']]);
    assert.equal(q.typedData.primaryType, 'ReceiveWithAuthorization');
    assert.equal(q.typedData.domain.name, 'USDC');
    assert.equal(q.typedData.message.to, s.t.chain.vouch);
    const before = await s.t.chain.usdcBalance(P.ana.address);
    await pay(s, P.ben, 'ben', q);
    assert.equal((await s.t.chain.usdcBalance(P.ana.address)) - before, 693_000n + 108_000n, 'Ana L1 + L2-via-Priya');
    // Relay view says relayed; "settled" stays false until Streams has it.
    const g = await call(s.t.app, 'GET', `/venues/${s.venue}/orders/${o}`);
    assert.equal(g.status, 200);
    assert.equal(g.body.relayStatus, 'relayed');
    assert.equal(g.body.paid, false);
    assert.equal(g.body.waitingOnStreams, true);
    const pi = await call(s.t.app, 'GET', `/payments/${q.intentId}`, s.tok.ben);
    assert.equal(pi.body.status, 'pending');
    assert.equal(pi.body.relayStatus, 'relayed');
    // Every tx was sent by the relayer, with strictly increasing nonces.
    assert.deepEqual(s.t.chain.sent.map((x) => x.nonce), s.t.chain.sent.map((_, i) => i));
    assert.ok(s.t.chain.sent.every((x) => x.maxFeePerGas >= 20_000_000_000n));
  } finally {
    await s.t.close();
  }
});

test('QE-C-10: pay after the order was settled by another auth → terminal 409, split read from Streams (not the quote)', async () => {
  const streams = createStubStreamsPort();
  const s = await setup({ streams });
  try {
    const o = await order(s, '2000000');
    const q = await quote(s, 'ben', o);
    // Ben self-submits a different auth first (modelled directly on the fake chain).
    const sp = await s.t.chain.settle(s.venue, P.ben.address, o, 2_000_000n);
    const sentBefore = s.t.chain.sent.length;
    const signature = await signTd(P.ben, q.typedData);
    let p = await call(s.t.app, 'POST', '/payments', s.tok.ben, { intentId: q.intentId, signature });
    assert.equal(p.status, 409);
    assert.equal(p.body.error.code, 'ORDER_ALREADY_PAID');
    assert.equal(p.body.error.details.waitingOnStreams, true);
    assert.equal(s.t.chain.sent.length, sentBefore, 'nothing sent: terminal, no retry, no gas');
    // Once Streams has the PaymentSettled, the API reports THAT split.
    const settled: SettledPayment = {
      venue: s.venue,
      customer: P.ben.address,
      orderId: o,
      amount: 2_000_000n,
      venueAmount: sp.venueAmount,
      rewardPool: sp.rewardPool,
      firstPurchase: true,
      rewarded: false,
      weightsMode: 0,
      txHash: `0x${'ab'.repeat(32)}`,
      logIndex: 3,
      blockNumber: 77n,
      blockTime: null,
      lines: [],
    };
    streams.putPayment(settled);
    const g = await call(s.t.app, 'GET', `/payments/${q.intentId}`, s.tok.ben);
    assert.equal(g.body.relayStatus, 'already_settled');
    assert.equal(g.body.status, 'settled');
    assert.equal(g.body.settled.txHash, settled.txHash);
    assert.equal(g.body.settled.source, 'streams');
    // A second attempt with the same intent is refused too.
    p = await call(s.t.app, 'POST', '/payments', s.tok.ben, { intentId: q.intentId, signature });
    assert.equal(p.body.error.code, 'ORDER_ALREADY_PAID');
  } finally {
    await s.t.close();
  }
});

test('QE-C-11: relayed pay refuses balance < amount before sending; self-submit quote needs amount + fee', async () => {
  const s = await setup();
  try {
    const o = await order(s, '5000000');
    s.t.chain.setBalance(P.ben.address, 4_999_999n);
    const q = await quote(s, 'ben', o);
    assert.equal(q.canAfford, false);
    assert.ok(q.warnings.includes('insufficient_balance'));
    const sent = s.t.chain.sent.length;
    const p = await call(s.t.app, 'POST', '/payments', s.tok.ben, { intentId: q.intentId, signature: await signTd(P.ben, q.typedData) });
    assert.equal(p.status, 402);
    assert.equal(p.body.error.code, 'INSUFFICIENT_BALANCE');
    assert.equal(p.body.error.details.shortfall, '1');
    assert.equal(s.t.chain.sent.length, sent);

    // Self-submit: balance == amount is NOT enough (gas is paid from the same USDC balance).
    s.t.chain.setBalance(P.ben.address, 5_000_000n);
    const qs = await call(s.t.app, 'POST', '/payments/quote', s.tok.ben, { venue: s.venue, orderId: o, mode: 'self-submit' });
    assert.equal(qs.status, 402);
    assert.equal(qs.body.error.details.selfSubmit, true);
    // 900k gas × 25 gwei = 0.0225 USDC → needs 5.0225
    s.t.chain.setBalance(P.ben.address, 5_022_500n);
    const ok = await call(s.t.app, 'POST', '/payments/quote', s.tok.ben, { venue: s.venue, orderId: o, mode: 'self-submit' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.paymentAuth.submitter, P.ben.address, 'self-submit names the customer, never 0');
    // The API never relays a self-submit intent.
    const r = await call(s.t.app, 'POST', '/payments', s.tok.ben, { intentId: ok.body.intentId, signature: await signTd(P.ben, ok.body.typedData) });
    assert.equal(r.status, 400);
  } finally {
    await s.t.close();
  }
});

test('orders: expired order → ORDER_EXPIRED; only the venue owner can create; bad signature on pay → 400 before relay', async () => {
  const s = await setup();
  try {
    const eve = await signIn(s.t.app, P.eve);
    const forbidden = await call(s.t.app, 'POST', `/venues/${s.venue}/orders`, eve, { amount: '1000000' });
    assert.equal(forbidden.status, 403);
    assert.equal((await call(s.t.app, 'POST', `/venues/${s.venue}/orders`, s.tok.lena, { amount: '0' })).body.error.code, 'INVALID_AMOUNT');
    const o = await order(s, '1000000');
    const q = await quote(s, 'ben', o);
    const bad = await call(s.t.app, 'POST', '/payments', s.tok.ben, { intentId: q.intentId, signature: await signTd(P.eve, q.typedData) });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_SIGNATURE');
    // Another user cannot submit Ben's intent.
    const other = await call(s.t.app, 'POST', '/payments', eve, { intentId: q.intentId, signature: await signTd(P.eve, q.typedData) });
    assert.equal(other.status, 404);
    s.t.chain.time += 3_600n;
    const exp = await call(s.t.app, 'POST', '/payments/quote', s.tok.ben, { venue: s.venue, orderId: o });
    assert.equal(exp.status, 410);
    assert.equal(exp.body.error.code, 'ORDER_EXPIRED');
    assert.match(exp.body.error.message, /expired/);
  } finally {
    await s.t.close();
  }
});

test('owner actions: only the current nonces(owner); stale signature → OWNER_NONCE_STALE (nothing relayed)', async () => {
  const s = await setup();
  try {
    const prep = await call(s.t.app, 'POST', `/venues/${s.venue}/actions`, s.tok.lena, { kind: 'updateTerms', rewardBps: 1000, minOrder: '0' });
    assert.equal(prep.status, 200);
    assert.equal(prep.body.typedData.message.nonce, (await s.t.chain.nonces(P.lena.address)).toString());
    const signature = await signTd(P.lena, prep.body.typedData);
    // A direct owner action bumps the nonce in between (D-515).
    s.t.chain.ownerNonces.set(P.lena.address.toLowerCase(), (await s.t.chain.nonces(P.lena.address)) + 1n);
    const sent = s.t.chain.sent.length;
    const sub = await call(s.t.app, 'POST', `/venues/${s.venue}/actions/${prep.body.actionId}`, s.tok.lena, { signature });
    assert.equal(sub.status, 409);
    assert.equal(sub.body.error.code, 'OWNER_NONCE_STALE');
    assert.equal(s.t.chain.sent.length, sent);
    // Non-owner cannot prepare.
    assert.equal((await call(s.t.app, 'POST', `/venues/${s.venue}/actions`, s.tok.ben, { kind: 'updateTerms', rewardBps: 1000 })).status, 403);
    // Fresh prepare + sign works and creates terms v2; old links then report reissueBy, then needs_reissue after 72 h.
    const code = await makeLink(s, P.sam, 'sam', 'broadcast');
    await ownerAction(s.t, s.tok.lena!, P.lena, s.venue, { kind: 'updateTerms', rewardBps: 1000, minOrder: '0' });
    let link = await call(s.t.app, 'GET', `/intros/${code}`);
    assert.equal(link.body.status, 'active');
    assert.ok(link.body.reissueBy);
    s.t.chain.time += 73n * 3600n;
    link = await call(s.t.app, 'GET', `/intros/${code}`);
    assert.equal(link.body.status, 'needs_reissue');
    const acc = await call(s.t.app, 'POST', `/intros/${code}/accept/prepare`, s.tok.ben, {});
    assert.equal(acc.body.error.code, 'LINK_NEEDS_REISSUE');
    const mine = await call(s.t.app, 'GET', '/me/links', s.tok.sam);
    assert.equal(mine.body.links[0].status, 'needs_reissue');
  } finally {
    await s.t.close();
  }
});

test('intros: self-referral, non-eligible referrer, used personal link, verified customer', async () => {
  const s = await setup();
  try {
    assert.equal((await call(s.t.app, 'POST', '/intros/prepare', s.tok.ben, { venue: s.venue, linkType: 'personal' })).body.error.code, 'REFERRER_NOT_ELIGIBLE');
    const code = await makeLink(s, P.sam, 'sam', 'personal');
    assert.equal((await call(s.t.app, 'POST', `/intros/${code}/accept/prepare`, s.tok.sam, {})).body.error.code, 'SELF_REFERRAL');
    // The referrer's own open is not counted.
    assert.equal((await call(s.t.app, 'POST', `/intros/${code}/opens`, s.tok.sam, {})).body.recorded, false);
    await accept(s, code, P.ana, 'ana');
    assert.equal((await call(s.t.app, 'POST', `/intros/${code}/accept/prepare`, s.tok.ben, {})).body.error.code, 'INTRO_ALREADY_USED');
    const landing = await call(s.t.app, 'GET', `/intros/${code}`);
    assert.equal(landing.status, 200);
    assert.equal(landing.body.referrer.displayName, 'sam');
    assert.equal(landing.body.linkType, 'personal');
    // After Ana's first purchase she is verified: new intros to her are refused.
    const o = await order(s, '1000000');
    await pay(s, P.ana, 'ana', await quote(s, 'ana', o));
    const code2 = await makeLink(s, P.sam, 'sam', 'broadcast');
    assert.equal((await call(s.t.app, 'POST', `/intros/${code2}/accept/prepare`, s.tok.ana, {})).body.error.code, 'ALREADY_REWARDED');
  } finally {
    await s.t.close();
  }
});

test('relayer down (no RELAYER key): quote and pay answer RELAYER_DOWN 503; nothing pretends to be settled', async () => {
  const t = await makeApp({ relayer: false });
  try {
    const lena = await signIn(t.app, P.lena);
    const prep = await call(t.app, 'POST', '/venues/prepare', lena, { name: 'X', rewardBps: 1500 });
    const sub = await call(t.app, 'POST', '/venues', lena, { venue: prep.body.venue, signature: await signTd(P.lena, prep.body.typedData) });
    assert.equal(sub.status, 503);
    assert.equal(sub.body.error.code, 'RELAYER_DOWN');
    assert.equal(sub.body.error.retryable, true);
    assert.doesNotMatch(sub.body.error.message, /gas|usdc|nonce|hash/i);
    const st = await call(t.app, 'GET', '/relayer/status');
    assert.equal(st.body.enabled, false);
  } finally {
    await t.close();
  }
});

test('reads: wallet balance from chain; activity/ambassador/stats from StreamsPort', async () => {
  const streams = createStubStreamsPort();
  const s = await setup({ streams });
  try {
    const w = await call(s.t.app, 'GET', '/me/wallet', s.tok.ben);
    assert.equal(w.status, 200);
    assert.equal(w.body.balance.baseUnits, '20000000');
    assert.equal(w.body.balance.display, '20.00');
    const orderId = `0x${'11'.repeat(32)}` as Hex;
    const line = (role: 0 | 1 | 2, recipient: Address, amount: bigint, via: Address = zeroAddress) => ({
      orderId,
      venue: s.venue,
      customer: P.ben.address,
      role,
      recipient,
      amount,
      viaReferrer: via,
      returned: false,
      returnReason: null,
      txHash: `0x${'cd'.repeat(32)}` as Hex,
      logIndex: 1,
      blockNumber: 99n,
      blockTime: null,
    });
    streams.putPayment({
      venue: s.venue,
      customer: P.ben.address,
      orderId,
      amount: 12_000_000n,
      venueAmount: 10_200_000n,
      rewardPool: 1_800_000n,
      firstPurchase: true,
      rewarded: true,
      weightsMode: 1,
      txHash: `0x${'cd'.repeat(32)}`,
      logIndex: 0,
      blockNumber: 99n,
      blockTime: null,
      lines: [line(0, P.ben.address, 450_000n), line(1, P.ana.address, 693_000n, P.ana.address), line(1, P.priya.address, 297_000n, P.priya.address), line(2, P.sam.address, 252_000n, P.ana.address), line(2, P.ana.address, 108_000n, P.priya.address)],
    });
    const act = await call(s.t.app, 'GET', '/me/activity', s.tok.ana);
    assert.equal(act.status, 200);
    assert.deepEqual(act.body.items.filter((i: any) => i.kind === 'reward').map((i: any) => i.reward.amount.baseUnits).sort(), ['108000', '693000']);
    const amb = await call(s.t.app, 'GET', `/ambassadors/${P.ana.address}`);
    assert.equal(amb.body.customersCredited, 1);
    assert.equal(amb.body.earned.total.baseUnits, '801000');
    assert.equal(amb.body.displayName, 'ana');
    const stats = await call(s.t.app, 'GET', `/venues/${s.venue}/stats`);
    assert.equal(stats.body.verifiedCustomers, 1);
    assert.equal(stats.body.rewardsPaid.baseUnits, '1800000');
    assert.equal(stats.body.costPerVerifiedCustomer.baseUnits, '1800000');
    const g = await call(s.t.app, 'GET', `/venues/${s.venue}/orders/${orderId}`);
    assert.equal(g.status, 404, 'orders not created through the API are unknown');
  } finally {
    await s.t.close();
  }
});

test('rate limits: per-user relay limit → RATE_LIMITED 429 (retryable), nothing sent', async () => {
  const s = await setup({ cfg: { limits: { perUserPerMinute: 2, globalPerMinute: 100, maxQueue: 50 } } });
  try {
    // setup() already used Lena's 2 relays (register + seed): the third is refused.
    const prep = await call(s.t.app, 'POST', `/venues/${s.venue}/actions`, s.tok.lena, { kind: 'setSeedAmbassador', ambassador: P.priya.address });
    const sent = s.t.chain.sent.length;
    const sub = await call(s.t.app, 'POST', `/venues/${s.venue}/actions/${prep.body.actionId}`, s.tok.lena, { signature: await signTd(P.lena, prep.body.typedData) });
    assert.equal(sub.status, 429);
    assert.equal(sub.body.error.code, 'RATE_LIMITED');
    assert.equal(sub.body.error.retryable, true);
    assert.equal(s.t.chain.sent.length, sent);
  } finally {
    await s.t.close();
  }
});
