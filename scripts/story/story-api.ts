/**
 * Phase 2 exit-criteria driver: the canonical Vouch story on Arc Testnet THROUGH THE API (no direct contract calls).
 * The CLI plays the browsers: each persona signs in (EIP-191 challenge) and signs only what the API hands it
 * (RegisterVenue, SetSeedAmbassador, Intro, IntroAcceptance, USDC ReceiveWithAuthorization). The API's RELAYER sends
 * every tx; the API's VENUE_SIGNER / ATTRIBUTOR sign orders and baseline weights.
 *
 *   Lena (DEMO_LENA)    venue owner + payout          Sam (SPIKE_USER)  seed ambassador
 *   Ana  (DEMO_ANA)     $1 via Sam, then refers        Priya (DEMO_PRIYA) $1 via Ana, then refers
 *   Ben  (DEMO_BEN)     Ana personal link (3 opens) + Priya broadcast link (2 opens) → $12.00
 *   expected: baseline weights 7000/3000 → venue 10.20 · Ben 0.45 · Ana 0.693 · Priya 0.297 · Sam 0.252 · Ana 0.108
 *
 * Then it waits for the DB to show the payment SETTLED (GET /payments/:id → status "settled"), which only happens once
 * STREAMS_INFRA's ingestion has the PaymentSettled from the live Stream. A local API gets no webhook deliveries, so
 * there it reports "WAITING ON STREAMS" (exit 0 unless --require-settled).
 *
 * Spend per run: customer money only moves between our own wallets (Ana $1, Priya $1, Ben $12, mostly back to Lena);
 * relayer gas ≈ $0.05–0.06 for 10 txs. --fund-from-payout: Lena (payout wallet) tops up Ana/Priya/Ben shortfalls first.
 *
 * Run (repo root; the API must be up with RELAYER/ATTRIBUTOR/VENUE_SIGNER keys and SESSION_SECRET):
 *   pnpm --filter @vouch/scripts story:api -- --api http://localhost:4010 [--fund-from-payout] [--settle-timeout 60] [--require-settled]
 * Env (loaded from the root env file by the pnpm script; never printed): DEMO_LENA/DEMO_ANA/DEMO_PRIYA/DEMO_BEN/
 *   SPIKE_USER _PRIVATE_KEY, optional ARC_RPC_URL, STORY_API_URL.
 */
import { createPublicClient, createWalletClient, erc20Abi, http, parseEventLogs, type Address, type Hex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_USDC_ADDRESS,
  VOUCH_ARC_TESTNET,
  arcTestnet,
  erc20MinAbi,
  explorerTxUrl,
  formatNativeAsUsdc,
  formatUsdc,
  parseUsdc,
  vouchAbi,
} from '@vouch/shared';

const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt;
};
const API = arg('api', process.env.STORY_API_URL || 'http://localhost:4010').replace(/\/$/, '');
const FUND = args.includes('--fund-from-payout');
const SETTLE_TIMEOUT_S = Number(arg('settle-timeout', '60'));
const REQUIRE_SETTLED = args.includes('--require-settled');
/** Re-check an earlier run's $12 payment (signs in as Ben, sends nothing): --check-intent <id>. */
const CHECK_INTENT = arg('check-intent', '');

function key(name: string): PrivateKeyAccount {
  const v = process.env[`${name}_PRIVATE_KEY`];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    console.error(`missing/invalid env ${name}_PRIVATE_KEY`); // never echo the value
    process.exit(2);
  }
  return privateKeyToAccount(v as Hex);
}
const lena = key('DEMO_LENA');
const sam = key('SPIKE_USER');
const ana = key('DEMO_ANA');
const priya = key('DEMO_PRIYA');
const ben = key('DEMO_BEN');
const NAME = new Map<string, string>([
  [lena.address.toLowerCase(), 'Lena'],
  [sam.address.toLowerCase(), 'Sam'],
  [ana.address.toLowerCase(), 'Ana'],
  [priya.address.toLowerCase(), 'Priya'],
  [ben.address.toLowerCase(), 'Ben'],
]);
const who = (a: string | null | undefined) => (a ? (NAME.get(a.toLowerCase()) ?? a) : '—');

const rpcUrl = process.env.ARC_RPC_URL || ARC_TESTNET_RPC_URL;
const pub = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });

// ------------------------------------------------------------------------------------------------ http
type Json = any;
async function api(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, body: parsed };
}
async function ok(method: string, path: string, token: string | undefined, body: unknown, expect: number[] = [200, 201, 202]) {
  const r = await api(method, path, token, body);
  if (!expect.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function signTd(a: PrivateKeyAccount, td: Json): Promise<Hex> {
  const message: Record<string, unknown> = { ...td.message };
  for (const f of td.types[td.primaryType]) if (/^u?int\d*$/.test(f.type)) message[f.name] = BigInt(message[f.name] as string);
  return a.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message } as never);
}

async function signIn(a: PrivateKeyAccount): Promise<string> {
  const ch = await ok('POST', '/auth/challenge', undefined, { address: a.address });
  const signature = await a.signMessage({ message: ch.message });
  return (await ok('POST', '/auth/verify', undefined, { address: a.address, challengeId: ch.challengeId, signature, displayName: who(a.address) })).token;
}

const txs: { label: string; hash: Hex }[] = [];
async function waitRelay(token: string, relayId: string, label: string): Promise<Hex> {
  const t0 = Date.now();
  for (;;) {
    const r = await ok('GET', `/relay/${relayId}`, token, undefined, [200]);
    if (r.status === 'mined') {
      txs.push({ label, hash: r.txHash });
      console.log(`  ✓ ${label.padEnd(34)} ${explorerTxUrl(r.txHash)}`);
      return r.txHash;
    }
    if (r.status === 'failed' || r.status === 'reverted') throw new Error(`${label}: relay ${r.status} ${r.errorCode ?? ''} ${r.txHash ?? ''}`);
    if (Date.now() - t0 > 90_000) throw new Error(`${label}: relay not mined after 90 s (${r.status})`);
    await new Promise((res) => setTimeout(res, 700));
  }
}

// ------------------------------------------------------------------------------------------------ chain helpers (funding + verification only)
const balanceOf = (a: Address) => pub.readContract({ address: ARC_TESTNET_USDC_ADDRESS, abi: erc20MinAbi, functionName: 'balanceOf', args: [a] });

async function fundFromLena(to: PrivateKeyAccount, need: bigint) {
  const bal = await balanceOf(to.address);
  if (bal >= need) return;
  const amount = need - bal + parseUsdc('0.05');
  const lenaBal = await balanceOf(lena.address);
  if (lenaBal < amount + parseUsdc('0.10')) throw new Error(`Lena (payout) cannot fund ${who(to.address)} $${formatUsdc(amount)}: balance $${formatUsdc(lenaBal)}`);
  const est = await pub.estimateFeesPerGas();
  const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const w = createWalletClient({ account: lena, chain: arcTestnet, transport: http(rpcUrl) });
  const hash = await w.writeContract({ address: ARC_TESTNET_USDC_ADDRESS, abi: erc20Abi, functionName: 'transfer', args: [to.address, amount], maxFeePerGas, maxPriorityFeePerGas: est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`funding transfer reverted: ${hash}`);
  console.log(`  ✓ fund ${who(to.address)} +$${formatUsdc(amount)} from Lena (payout)  ${explorerTxUrl(hash)}`);
}

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

// ------------------------------------------------------------------------------------------------ story steps
type Tok = Record<'lena' | 'sam' | 'ana' | 'priya' | 'ben', string>;

async function link(tok: string, referrer: PrivateKeyAccount, venue: Address, linkType: 'personal' | 'broadcast') {
  const prep = await ok('POST', '/intros/prepare', tok, { venue, linkType });
  const signature = await signTd(referrer, prep.typedData);
  const c = await ok('POST', '/intros', tok, { intro: prep.typedData.message, signature });
  console.log(`  · ${who(referrer.address)} shares a ${linkType} link ${c.url}`);
  return c.code as string;
}

async function accept(tok: string, customer: PrivateKeyAccount, code: string, opens: number) {
  for (let i = 0; i < opens; i++) await ok('POST', `/intros/${code}/opens`, tok, {});
  const prep = await ok('POST', `/intros/${code}/accept/prepare`, tok, {});
  const signature = await signTd(customer, prep.typedData);
  const r = await ok('POST', `/intros/${code}/accept`, tok, { acceptance: prep.acceptance, signature });
  const landing = await ok('GET', `/intros/${code}`, undefined, undefined, [200]);
  return waitRelay(tok, r.relayId, `acceptIntro ${who(landing.referrer.address)}→${who(customer.address)} (${opens} opens)`);
}

async function purchase(t: Tok, venue: Address, customer: PrivateKeyAccount, cname: keyof Tok, dollars: string) {
  const o = await ok('POST', `/venues/${venue}/orders`, t.lena, { amount: parseUsdc(dollars).toString(), ttlSeconds: 600 });
  const q = await ok('POST', '/payments/quote', t[cname], { venue, orderId: o.order.orderId });
  const signature = await signTd(customer, q.typedData);
  const p = await ok('POST', '/payments', t[cname], { intentId: q.intentId, signature });
  const hash = await waitRelay(t[cname], p.relayId, `pay ${who(customer.address)} $${dollars}`);
  return { q, p, hash, orderId: o.order.orderId as Hex };
}

async function checkOnly() {
  const tok = await signIn(ben);
  const st = await ok('GET', `/payments/${CHECK_INTENT}`, tok, undefined, [200]);
  console.log(`payment ${CHECK_INTENT}: status ${st.status} · relay ${st.relayStatus} · tx ${st.txHash}`);
  if (st.status !== 'settled') {
    console.log('  … WAITING ON STREAMS (not in this API DB yet)');
    process.exit(REQUIRE_SETTLED ? 3 : 0);
  }
  console.log(`  settled (source ${st.settled.source}, block ${st.settled.blockNumber}): venue $${st.settled.venueAmount.display} · weightsMode ${st.settled.weightsMode}`);
  console.log(`  ${st.settled.lines.map((l: Json) => `${l.role}:${who(l.recipient)}:${l.amount.display}`).join(' · ')}`);
  const stats = await ok('GET', `/venues/${st.venue}/stats`, undefined, undefined, [200]);
  console.log(`  venue stats: verified ${stats.verifiedCustomers} · gross $${stats.gross.display} · rewards $${stats.rewardsPaid.display} · cost/verified $${stats.costPerVerifiedCustomer?.display ?? '—'} · edges ${stats.edges.length}`);
  const amb = await ok('GET', `/ambassadors/${ana.address}`, undefined, undefined, [200]);
  console.log(`  Ana ambassador: credited ${amb.customersCredited} · referrer $${amb.earned.referrer.display} · introducer $${amb.earned.introducer.display}`);
  const act = await ok('GET', '/me/activity', tok, undefined, [200]);
  console.log(`  Ben activity: ${act.items.map((i: Json) => `${i.kind}/${i.status}`).join(', ')}`);
}

async function main() {
  if (CHECK_INTENT) return checkOnly();
  console.log(`story:api → ${API}  (Vouch ${VOUCH_ARC_TESTNET.address} on Arc Testnet ${arcTestnet.id})`);
  const health = await ok('GET', '/health', undefined, undefined, [200]);
  const rs = await ok('GET', '/relayer/status', undefined, undefined, [200]);
  if (!rs.enabled) throw new Error('API relayer is disabled (relayer/signing keys not configured on that API)');
  console.log(`  api ok (db ${health.db.kind}); relayer ${rs.address} balance ${rs.balance} USDC; budget left $${rs.budget.hourly.remaining.display}/h · $${rs.budget.daily.remaining.display}/day`);
  const relayerStart = await pub.getBalance({ address: rs.address });

  console.log('\n[0] balances');
  const need: [PrivateKeyAccount, bigint][] = [
    [ana, parseUsdc('1.00')],
    [priya, parseUsdc('1.00')],
    [ben, parseUsdc('12.00')],
  ];
  for (const [a, n] of need) {
    if (FUND) await fundFromLena(a, n);
    const b = await balanceOf(a.address);
    console.log(`  ${who(a.address).padEnd(6)} $${formatUsdc(b)} (needs $${formatUsdc(n)})`);
    if (b < n) throw new Error(`${who(a.address)} is short; use --fund-from-payout or pnpm --filter @vouch/scripts topup (nothing sent)`);
  }

  console.log('\n[1] sign in (EIP-191 challenge → session)');
  const t: Tok = { lena: await signIn(lena), sam: await signIn(sam), ana: await signIn(ana), priya: await signIn(priya), ben: await signIn(ben) };
  console.log('  ✓ Lena, Sam, Ana, Priya, Ben signed in');

  console.log('\n[2] Lena registers her venue (owner-signed, relayed) and seeds Sam');
  const prep = await ok('POST', '/venues/prepare', t.lena, { name: `Lena's Café (story ${new Date().toISOString().slice(0, 16)})`, rewardBps: 1500, minOrder: parseUsdc('1.00').toString() });
  const venue = prep.venue as Address;
  console.log(`  venue ${venue}  owner nonce ${prep.typedData.message.nonce}`);
  const reg = await ok('POST', '/venues', t.lena, { venue, signature: await signTd(lena, prep.typedData) });
  await waitRelay(t.lena, reg.relayId, 'registerVenue (Lena-signed)');
  const seed = await ok('POST', `/venues/${venue}/actions`, t.lena, { kind: 'setSeedAmbassador', ambassador: sam.address, allowed: true });
  const seedSub = await ok('POST', `/venues/${venue}/actions/${seed.actionId}`, t.lena, { signature: await signTd(lena, seed.typedData) });
  await waitRelay(t.lena, seedSub.relayId, 'setSeedAmbassador Sam (Lena-signed)');

  console.log('\n[3] Ana joins via Sam');
  await accept(t.ana!, ana, await link(t.sam!, sam, venue, 'personal'), 1);
  const a1 = await purchase(t, venue, ana, 'ana', '1.00');
  check(a1.q.attribution?.referrers?.[0] === sam.address, 'Ana quote: 100% Sam');

  console.log('\n[4] Priya joins via Ana');
  await accept(t.priya!, priya, await link(t.ana!, ana, venue, 'personal'), 1);
  await purchase(t, venue, priya, 'priya', '1.00');

  console.log('\n[5] Ben: Ana personal (3 opens) + Priya broadcast (2 opens)');
  await accept(t.ben!, ben, await link(t.ana!, ana, venue, 'personal'), 3);
  await accept(t.ben!, ben, await link(t.priya!, priya, venue, 'broadcast'), 2);

  console.log('\n[6] Ben pays $12.00 (quote → one signature → relayed pay)');
  const before = await Promise.all([lena, ben, ana, priya, sam].map((a) => balanceOf(a.address)));
  const o = await ok('POST', `/venues/${venue}/orders`, t.lena, { amount: parseUsdc('12.00').toString(), ttlSeconds: 600 });
  console.log(`  QR: ${o.qrPayload}`);
  const q = await ok('POST', '/payments/quote', t.ben, { venue, orderId: o.order.orderId });
  console.log(`  quote: pay $${q.quote.amount.display}, you get $${q.quote.cashback.display} back; weights ${q.attribution.referrers.map(who).join('/')} ${q.attribution.bps.join('/')} (${q.attribution.method})`);
  for (const r of q.quote.rewards) console.log(`    ${r.role.padEnd(10)} ${who(r.recipient).padEnd(6)} $${r.amount.display}`);
  console.log(`    venue      Lena   $${q.quote.venueAmount.display}`);
  check(q.paymentAuth.submitter === rs.address, 'PaymentAuth.submitter = RELAYER (D-014)');
  check(JSON.stringify(q.attribution.bps) === '[7000,3000]', 'baseline weights Ana 7000 / Priya 3000');
  const l1 = q.quote.rewards.filter((r: Json) => r.role === 'referrer').map((r: Json) => r.amount.baseUnits);
  const l2 = q.quote.rewards.filter((r: Json) => r.role === 'introducer').map((r: Json) => `${who(r.recipient)}:${r.amount.baseUnits}`);
  check(q.quote.venueAmount.baseUnits === '10200000' && q.quote.cashback.baseUnits === '450000', 'quote venue 10.20 · cashback 0.45');
  check(JSON.stringify(l1) === '["693000","297000"]', 'quote L1 Ana 0.693 · Priya 0.297');
  check(JSON.stringify(l2) === '["Sam:252000","Ana:108000"]', 'quote L2 Sam 0.252 · Ana 0.108');
  const p = await ok('POST', '/payments', t.ben, { intentId: q.intentId, signature: await signTd(ben, q.typedData) });
  console.log(`  API: ${p.status} ${p.txHash}`);
  const payHash = await waitRelay(t.ben!, p.relayId, 'pay Ben $12.00 (canonical)');

  console.log('\n[7] on-chain verification (receipt logs + balances)');
  const r = await pub.getTransactionReceipt({ hash: payHash });
  check(r.from.toLowerCase() === String(rs.address).toLowerCase(), 'pay() sent by the API relayer');
  const logs = parseEventLogs({ abi: vouchAbi, logs: r.logs }).filter((l) => l.address.toLowerCase() === VOUCH_ARC_TESTNET.address.toLowerCase());
  const settled = logs.find((l) => l.eventName === 'PaymentSettled');
  const paid = logs.filter((l) => l.eventName === 'RewardPaid');
  if (settled?.eventName === 'PaymentSettled') {
    check(settled.args.venueAmount === 10_200_000n && settled.args.weightsMode === 1, 'PaymentSettled venueAmount 10,200,000 · weightsMode ATTRIBUTOR');
  } else check(false, 'PaymentSettled present');
  const got = paid.map((l) => (l.eventName === 'RewardPaid' ? `${['C', 'L1', 'L2'][l.args.role]}:${who(l.args.recipient)}:${l.args.amount}` : ''));
  check(JSON.stringify(got) === JSON.stringify(['C:Ben:450000', 'L1:Ana:693000', 'L1:Priya:297000', 'L2:Sam:252000', 'L2:Ana:108000']), `RewardPaid ${got.join(' ')}`);
  const after = await Promise.all([lena, ben, ana, priya, sam].map((a) => balanceOf(a.address)));
  const d = after.map((x, i) => x - before[i]!);
  check(d[0] === 10_200_000n && d[1] === -11_550_000n && d[2] === 801_000n && d[3] === 297_000n && d[4] === 252_000n, `balance deltas Lena ${d[0]} Ben ${d[1]} Ana ${d[2]} Priya ${d[3]} Sam ${d[4]}`);

  console.log(`\n[8] DB "settled" via Streams (GET /payments/${q.intentId}, up to ${SETTLE_TIMEOUT_S}s)`);
  const t0 = Date.now();
  let st: Json = null;
  for (;;) {
    st = await ok('GET', `/payments/${q.intentId}`, t.ben, undefined, [200]);
    if (st.status === 'settled' || Date.now() - t0 > SETTLE_TIMEOUT_S * 1000) break;
    await new Promise((res) => setTimeout(res, 1_000));
  }
  let settledOk = false;
  if (st.status === 'settled') {
    const lines = st.settled.lines.map((l: Json) => `${l.role}:${who(l.recipient)}:${l.amount.baseUnits}`);
    console.log(`  ✓ settled in DB after ${((Date.now() - t0) / 1000).toFixed(1)}s (source ${st.settled.source}, block ${st.settled.blockNumber})`);
    check(st.settled.venueAmount.baseUnits === '10200000', 'DB venueAmount 10,200,000');
    console.log(`    ${lines.join(' · ')}`);
    const stats = await ok('GET', `/venues/${venue}/stats`, undefined, undefined, [200]);
    console.log(`  venue stats: verified ${stats.verifiedCustomers}, rewards paid $${stats.rewardsPaid.display}, cost per verified customer $${stats.costPerVerifiedCustomer?.display ?? '—'}`);
    settledOk = true;
  } else {
    console.log(`  … WAITING ON STREAMS: relay status "${st.relayStatus}", not settled in this API's DB after ${SETTLE_TIMEOUT_S}s.`);
    console.log('    This API instance has not ingested the PaymentSettled (no live Stream delivering to it, or ingestion not deployed).');
    console.log('    The on-chain split above is final; re-check later with GET /payments/<intentId> on the Stream-fed API.');
  }

  const relayerEnd = await pub.getBalance({ address: rs.address });
  console.log('\n[9] transactions');
  for (const x of txs) console.log(`    ${x.label.padEnd(40)} ${x.hash}`);
  console.log(`    relayer gas this run: ${formatNativeAsUsdc(relayerStart - relayerEnd)} USDC (${txs.length} txs)`);
  console.log(`\nvenue ${venue} · pay intent ${q.intentId}`);
  if (failures) {
    console.error(`\nSTORY FAILED (${failures} check(s))`);
    process.exit(1);
  }
  if (!settledOk && REQUIRE_SETTLED) {
    console.error('\nSTORY ON-CHAIN OK, DB NOT SETTLED (--require-settled)');
    process.exit(3);
  }
  console.log(settledOk ? '\nSTORY OK (on-chain + settled in DB via Streams)' : '\nSTORY ON-CHAIN OK — DB settled: WAITING ON STREAMS');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
