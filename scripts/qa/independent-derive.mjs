#!/usr/bin/env node
/**
 * QE_E2E Phase 2: independent re-derivation of Vouch v3 state from raw chain logs.
 *
 * It does NOT use apps/api (no decode/ingest/queries code) or the frozen Streams filter. Event signatures are typed
 * in from INTERFACES §4 and their topic0s are checked against the table there. Logs come from plain JSON-RPC
 * eth_getLogs. The model follows the INTERFACES §4 "Rebuilding every view from logs" table.
 *
 *   node scripts/qa/independent-derive.mjs [--from N] [--to N|head] [--rpc URL]
 *        [--hosted <api base>]      compare GET /venues/:v, /venues/:v/terms, /venues/:v/stats, /ambassadors/:a
 *        [--onchain]                compare with eth_call getVenueStats / getAmbassadorStats at block --to
 *        [--tx <hash>]...           receipt check: Vouch events vs USDC Transfer logs vs canonical split
 *        [--pglite <dir>]           compare ev_payments / ev_rewards rows for each --tx (stop the api first)
 *        [--json <file>]            write the model
 * Exit 1 on any mismatch. Read-only: never sends a transaction.
 */
import { decodeEventLog, encodeFunctionData, decodeFunctionResult, getAddress, keccak256, parseAbi, toHex } from 'viem';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
const has = (n) => argv.includes(`--${n}`);

const VOUCH = '0xF4B641dc628de05336aa983B07D5d181254ff08e';
const USDC = '0x3600000000000000000000000000000000000000';
const DEPLOY = 72605845;
const RPC = opt('rpc', 'https://rpc.testnet.arc.io');
const ZERO = '0x0000000000000000000000000000000000000000';

// ---- INTERFACES §4, typed in by hand
const SIGS = [
  'event VenueRegistered(address indexed venue, address indexed owner, bytes32 salt, address payout, address signer, address attributor, string metadataURI)',
  'event TermsUpdated(address indexed venue, uint32 indexed termsVersion, uint16 rewardBps, uint256 minOrder, uint64 effectiveAt)',
  'event VenueKeysUpdated(address indexed venue, address payout, address signer, address attributor)',
  'event SeedAmbassadorSet(address indexed venue, address indexed ambassador, bool allowed)',
  'event IntroAccepted(address indexed venue, address indexed referrer, address indexed customer, bytes32 introHash, uint32 termsVersion, uint8 linkType, uint64 expiresAt)',
  'event IntroDropped(address indexed venue, address indexed customer, address indexed referrer, bytes32 introHash, uint8 reason)',
  'event CustomerVerified(address indexed venue, address indexed customer, address indexed introducer, bytes32 orderId)',
  'event PaymentSettled(address indexed venue, address indexed customer, bytes32 indexed orderId, uint256 amount, uint256 venueAmount, uint256 rewardPool, bool firstPurchase, bool rewarded, uint8 weightsMode)',
  'event RewardPaid(bytes32 indexed orderId, address indexed recipient, address indexed venue, address customer, uint8 role, uint256 amount, address viaReferrer)',
  'event RewardReturned(bytes32 indexed orderId, address indexed intendedRecipient, address indexed venue, address customer, uint8 role, uint256 amount, address viaReferrer, uint8 reason)',
];
const TOPIC0_DOC = {
  VenueRegistered: '0xf0f4291fd5fccc2af9a998b6cf8aba2121c99823a21bcfac7a4821537f004d77',
  TermsUpdated: '0x86d80d9334324698e8c0763e1f6a4179b0ae6af2e64a9724746ce284ec78bb8b',
  VenueKeysUpdated: '0xc518545d9074ed155beb97a3caed0bbecc0d2cdcdee6d6d2d16a079883ab2ee2',
  SeedAmbassadorSet: '0x213904416ef720404e57b83f59ff9f8b5029132b1581c57443cf044b11a835b2',
  IntroAccepted: '0xe75b5b5d835a46c918feb6cac867d2b1c6ed4d45a112ebaf7067bb9c1fcf37fc',
  IntroDropped: '0x71760f14b6c295e573eb0712240020bcabda6d58907c0f3897ecf55f9ec193ea',
  CustomerVerified: '0xca816bf56b298971c59e72dcd003c06b351b66ffedb5ec84017d6195ec0152c8',
  PaymentSettled: '0x35f580066b94268579e33474e66ad0347864c26fe8683e577efb5072c80e7432',
  RewardPaid: '0xd28b9898dcd3318ef486fd51dbeba03ddb126bdb888b82d4ac7504213412b36a',
  RewardReturned: '0x1cba477ed7240b8110e7fecc9c7f6fd041255365455d9c76f2b2febb4cfb7a15',
};
const ABI = parseAbi(SIGS);
const TRANSFER = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const VIEWS = parseAbi([
  'function getVenueStats(address venue) view returns ((uint64 verifiedCustomers, uint64 rewardedCustomers, uint128 grossVolume, uint128 rewardsPaid, uint128 rewardsReturned))',
  'function getAmbassadorStats(address ambassador) view returns ((uint64 customersCredited, uint32 venues, uint128 l1Earned, uint128 l2Earned))',
]);

let failures = 0;
const out = [];
const log = (s) => {
  out.push(s);
  console.log(s);
};
function eq(label, got, want) {
  const g = typeof got === 'string' ? got : JSON.stringify(got, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const w = typeof want === 'string' ? want : JSON.stringify(want, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (g === w) log(`  ok   ${label}`);
  else {
    failures++;
    log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`);
  }
}

// ---- JSON-RPC (plain fetch, retries on the public RPC's -32005 burst limit)
async function rpc(method, params) {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json().catch(() => null);
    if (j && !j.error) return j.result;
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    if (i === 5) throw new Error(`${method} failed: ${JSON.stringify(j?.error ?? res.status)}`);
  }
}
const hexN = (n) => `0x${n.toString(16)}`;

// ---- 1. topic0 check
log('[topic0] keccak256(signature) vs INTERFACES §4');
for (const s of SIGS) {
  const name = s.match(/event (\w+)\(/)[1];
  const canon = `${name}(${s
    .slice(s.indexOf('(') + 1, -1)
    .split(',')
    .map((p) => p.trim().split(' ')[0])
    .join(',')})`;
  eq(`${name}`, keccak256(toHex(canon)), TOPIC0_DOC[name]);
}

// ---- 2. logs
const from = Number(opt('from', DEPLOY));
const toArg = opt('to', 'head');
const to = toArg === 'head' ? Number(BigInt(await rpc('eth_blockNumber', []))) : Number(toArg);
const raw = [];
for (let a = from; a <= to; a += 10_000) {
  const b = Math.min(to, a + 9_999);
  const got = await rpc('eth_getLogs', [{ address: VOUCH, fromBlock: hexN(a), toBlock: hexN(b) }]);
  raw.push(...got);
  await new Promise((r) => setTimeout(r, 1200));
}
const known = new Set(Object.values(TOPIC0_DOC));
const evs = raw
  .filter((l) => l.address.toLowerCase() === VOUCH.toLowerCase() && known.has(l.topics[0]) && !l.removed)
  .map((l) => {
    const d = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics, strict: true });
    return { name: d.eventName, args: d.args, block: Number(BigInt(l.blockNumber)), logIndex: Number(BigInt(l.logIndex)), tx: l.transactionHash.toLowerCase() };
  })
  .sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
log(`\n[logs] Vouch ${VOUCH} blocks ${from}..${to}: ${raw.length} raw logs, ${evs.length} decoded`);
const counts = {};
for (const e of evs) counts[e.name] = (counts[e.name] ?? 0) + 1;
log(`  ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);

// ---- 3. model (INTERFACES §4 rebuild table)
const venues = new Map();
const vs = (v) => {
  if (!venues.has(v))
    venues.set(v, { venue: v, owner: null, payout: null, signer: null, attributor: null, metadataURI: null, terms: [], seeds: new Set(), registeredTx: null, stats: { verifiedCustomers: 0, rewardedPurchases: 0, payments: 0, gross: 0n, rewardsPaid: 0n, rewardsReturned: 0n, venueReceived: 0n, cashback: 0n, referrer: 0n, introducer: 0n }, edges: [] });
  return venues.get(v);
};
const amb = new Map();
const as = (a) => {
  if (!amb.has(a)) amb.set(a, { credited: new Set(), venues: new Set(), l1: 0n, l2: 0n, cashback: 0n, lines: [] });
  return amb.get(a);
};
const payments = new Map(); // tx → { settled, lines }
for (const e of evs) {
  const a = e.args;
  if (e.name === 'VenueRegistered') Object.assign(vs(a.venue), { owner: a.owner, payout: a.payout, signer: a.signer, attributor: a.attributor, metadataURI: a.metadataURI, registeredTx: e.tx });
  else if (e.name === 'VenueKeysUpdated') Object.assign(vs(a.venue), { payout: a.payout, signer: a.signer, attributor: a.attributor });
  else if (e.name === 'TermsUpdated') vs(a.venue).terms.push({ termsVersion: Number(a.termsVersion), rewardBps: Number(a.rewardBps), minOrder: a.minOrder.toString(), effectiveAt: a.effectiveAt.toString() });
  else if (e.name === 'SeedAmbassadorSet') (a.allowed ? vs(a.venue).seeds.add(a.ambassador) : vs(a.venue).seeds.delete(a.ambassador));
  else if (e.name === 'CustomerVerified') vs(a.venue).stats.verifiedCustomers++;
  else if (e.name === 'PaymentSettled') {
    const s = vs(a.venue).stats;
    s.payments++;
    if (a.rewarded) s.rewardedPurchases++;
    s.gross += a.amount;
    s.venueReceived += a.venueAmount;
    payments.set(e.tx, { settled: { ...a, logIndex: e.logIndex, block: e.block }, lines: [] });
  } else if (e.name === 'RewardPaid' || e.name === 'RewardReturned') {
    const ret = e.name === 'RewardReturned';
    const recipient = ret ? a.intendedRecipient : a.recipient;
    const v = vs(a.venue);
    const role = Number(a.role);
    if (ret) v.stats.rewardsReturned += a.amount;
    else {
      v.stats.rewardsPaid += a.amount;
      v.stats[['cashback', 'referrer', 'introducer'][role]] += a.amount;
      v.edges.push({ orderId: a.orderId, from: role === 2 ? a.viaReferrer : a.customer, to: recipient, role, amount: a.amount.toString(), txHash: e.tx });
    }
    payments.get(e.tx)?.lines.push({ role, recipient, amount: a.amount, viaReferrer: a.viaReferrer, returned: ret, reason: ret ? Number(a.reason) : null, logIndex: e.logIndex });
    if (recipient !== ZERO) {
      const r = as(recipient);
      if (!ret) {
        if (role === 0) r.cashback += a.amount;
        if (role === 1) r.l1 += a.amount;
        if (role === 2) r.l2 += a.amount;
      }
      if (role === 1 && (!ret || Number(a.reason) === 2)) {
        r.credited.add(`${a.venue}:${a.orderId}`);
        r.venues.add(a.venue);
      }
      r.lines.push({ txHash: e.tx, role, amount: a.amount.toString(), returned: ret, block: e.block, logIndex: e.logIndex });
    }
  }
}
log(`  venues: ${[...venues.keys()].join(', ')}`);

// ---- 4. invariants (INTERFACES §4)
log('\n[invariants] venueAmount + Σ RewardPaid == amount; rewardPool − (Σ paid + Σ returned) ∈ [0, 2 × referrers]');
for (const [tx, p] of payments) {
  const paid = p.lines.filter((l) => !l.returned).reduce((s, l) => s + l.amount, 0n);
  const returned = p.lines.filter((l) => l.returned).reduce((s, l) => s + l.amount, 0n);
  const refs = p.lines.filter((l) => l.role === 1).length;
  eq(`${tx.slice(0, 10)} conservation`, (p.settled.venueAmount + paid).toString(), p.settled.amount.toString());
  const dust = p.settled.rewardPool - paid - returned;
  eq(`${tx.slice(0, 10)} dust ${dust} ≤ ${2 * refs}`, dust >= 0n && dust <= BigInt(2 * Math.max(refs, 0)), true);
}

// ---- 5. receipt checks
const CANON = { amount: 12_000_000n, venue: 10_200_000n, cashback: 450_000n, l1: [693_000n, 297_000n], l2: [252_000n, 108_000n] };
for (const tx of all('tx').map((t) => t.toLowerCase())) {
  log(`\n[receipt] ${tx}`);
  const r = await rpc('eth_getTransactionReceipt', [tx]);
  eq('status', r.status, '0x1');
  const vouchLogs = r.logs.filter((l) => l.address.toLowerCase() === VOUCH.toLowerCase()).map((l) => ({ ...decodeEventLog({ abi: ABI, data: l.data, topics: l.topics, strict: true }), logIndex: Number(BigInt(l.logIndex)) }));
  const transfers = r.logs
    .filter((l) => l.address.toLowerCase() === USDC.toLowerCase() && l.topics[0] === keccak256(toHex('Transfer(address,address,uint256)')))
    .map((l) => decodeEventLog({ abi: TRANSFER, data: l.data, topics: l.topics }).args);
  const ps = vouchLogs.find((l) => l.eventName === 'PaymentSettled').args;
  const rp = vouchLogs.filter((l) => l.eventName === 'RewardPaid').map((l) => l.args);
  const order = vouchLogs.map((l) => `${l.eventName}@${l.logIndex}`).join(' ');
  log(`  vouch events: ${order}`);
  eq('event order: CustomerVerified, PaymentSettled, RewardPaid cashback → L1 → L2', vouchLogs.map((l) => (l.eventName === 'RewardPaid' ? `RP${l.args.role}` : l.eventName)).join(','), 'CustomerVerified,PaymentSettled,RP0,RP1,RP1,RP2,RP2');
  eq('PaymentSettled amount / venueAmount / rewardPool', [ps.amount, ps.venueAmount, ps.rewardPool], [CANON.amount, CANON.venue, 1_800_000n]);
  eq('weightsMode ATTRIBUTOR, firstPurchase, rewarded', [ps.weightsMode, ps.firstPurchase, ps.rewarded], [1, true, true]);
  eq('RewardPaid amounts (cashback, L1, L1, L2, L2)', rp.map((x) => x.amount), [CANON.cashback, ...CANON.l1, ...CANON.l2]);
  // USDC money movement: customer → Vouch amount; Vouch → recipients exactly the RewardPaid amounts (>0) and the venue payout venueAmount.
  const fromVouch = transfers.filter((t) => t.from.toLowerCase() === VOUCH.toLowerCase()).map((t) => ({ to: t.to, value: t.value }));
  const intoVouch = transfers.filter((t) => t.to.toLowerCase() === VOUCH.toLowerCase());
  eq('USDC customer → Vouch = amount', intoVouch.map((t) => [t.from, t.value]), [[ps.customer, ps.amount]]);
  const want = [...rp.filter((x) => x.amount > 0n).map((x) => [x.recipient, x.amount])];
  const venuePayout = venues.get(ps.venue)?.payout;
  const got = fromVouch.map((t) => [t.to, t.value]);
  eq('USDC Vouch → reward recipients (RewardPaid order)', got.filter(([to, v]) => !(to === venuePayout && v === ps.venueAmount)), want);
  eq('USDC Vouch → venue payout = venueAmount', got.filter(([to, v]) => to === venuePayout && v === ps.venueAmount).length, 1);
  eq('Σ USDC out of Vouch = amount', fromVouch.reduce((s, t) => s + t.value, 0n), ps.amount);
  const recipients = rp.map((x) => `${['C', 'L1', 'L2'][x.role]}:${x.recipient}:${x.viaReferrer}`);
  log(`  recipients: ${recipients.join(' | ')}`);
  eq('cashback → customer, L2 viaReferrer = the matching L1', [rp[0].recipient === ps.customer, rp[3].viaReferrer === rp[1].recipient, rp[4].viaReferrer === rp[2].recipient], [true, true, true]);

  const dir = opt('pglite', '');
  if (dir) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(dir);
    const pr = (await db.query(`select venue, customer, order_id, amount::text, venue_amount::text, reward_pool::text, first_purchase, rewarded, weights_mode, log_index from ev_payments where tx_hash = $1`, [tx])).rows;
    const rr = (await db.query(`select role, recipient, amount::text, via_referrer, returned, log_index from ev_rewards where tx_hash = $1 order by log_index`, [tx])).rows;
    await db.close();
    eq('ev_payments row', pr.map((x) => [x.venue, x.customer, x.order_id, x.amount, x.venue_amount, x.reward_pool, x.first_purchase, x.rewarded, x.weights_mode]), [[ps.venue, ps.customer, ps.orderId, ps.amount.toString(), ps.venueAmount.toString(), ps.rewardPool.toString(), ps.firstPurchase, ps.rewarded, ps.weightsMode]]);
    eq('ev_rewards rows', rr.map((x) => [x.role, x.recipient, x.amount, x.via_referrer, x.returned, x.log_index]), vouchLogs.filter((l) => l.eventName === 'RewardPaid').map((l) => [l.args.role, l.args.recipient, l.args.amount.toString(), l.args.viaReferrer, false, l.logIndex]));
  }
}

// ---- 6. on-chain views at block `to`
if (has('onchain')) {
  log(`\n[onchain] eth_call getVenueStats / getAmbassadorStats at block ${to}`);
  const call = async (fn, arg) => decodeFunctionResult({ abi: VIEWS, functionName: fn, data: await rpc('eth_call', [{ to: VOUCH, data: encodeFunctionData({ abi: VIEWS, functionName: fn, args: [arg] }) }, hexN(to)]) });
  for (const [v, m] of venues) {
    const s = await call('getVenueStats', v);
    eq(`venue ${v} (verified, rewarded, gross, paid, returned)`, [s.verifiedCustomers, s.rewardedCustomers, s.grossVolume, s.rewardsPaid, s.rewardsReturned], [BigInt(m.stats.verifiedCustomers), BigInt(m.stats.rewardedPurchases), m.stats.gross, m.stats.rewardsPaid, m.stats.rewardsReturned]);
  }
  for (const [a, m] of amb) {
    const s = await call('getAmbassadorStats', a);
    eq(`ambassador ${a} (credited, venues, l1, l2)`, [s.customersCredited, s.venues, s.l1Earned, s.l2Earned], [BigInt(m.credited.size), m.venues.size, m.l1, m.l2]);
  }
}

// ---- 7. hosted api reads
const hosted = opt('hosted', '');
if (hosted) {
  const H = hosted.replace(/\/$/, '');
  const get = async (p) => {
    const r = await fetch(`${H}${p}`);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  log(`\n[hosted] ${H} vs the model (blocks ${from}..${to})`);
  const health = await get('/health');
  log(`  /health ${health.status} db=${health.body?.db?.kind}`);
  for (const [v, m] of venues) {
    const g = await get(`/venues/${v}`);
    eq(`GET /venues/${v} → 200`, g.status, 200);
    const on = g.body?.onchain;
    eq(`  config (owner, payout, signer, attributor, metadataURI, registeredTx)`, on ? [on.owner, on.payout, on.signer, on.attributor, on.metadataURI, on.registeredTx] : null, [m.owner, m.payout, m.signer, m.attributor, m.metadataURI, m.registeredTx]);
    eq(`  terms history`, on?.terms, m.terms);
    eq(`  seeds`, on?.seeds?.slice().sort(), [...m.seeds].sort());
    const t = await get(`/venues/${v}/terms`);
    eq(`  /terms history`, t.body?.history?.map((x) => ({ termsVersion: x.termsVersion, rewardBps: x.rewardBps, minOrder: x.minOrder.baseUnits, effectiveAt: String(x.effectiveAt) })), m.terms);
    const s = (await get(`/venues/${v}/stats`)).body;
    const ms = m.stats;
    eq(`  stats counts (verified, rewardedPurchases, payments)`, [s.verifiedCustomers, s.rewardedPurchases, s.payments], [ms.verifiedCustomers, ms.rewardedPurchases, ms.payments]);
    eq(`  stats money (gross, rewardsPaid, rewardsReturned, venueReceived)`, [s.gross.baseUnits, s.rewardsPaid.baseUnits, s.rewardsReturned.baseUnits, s.venueReceived?.baseUnits], [ms.gross, ms.rewardsPaid, ms.rewardsReturned, ms.venueReceived].map(String));
    eq(`  stats byRole`, [s.byRole?.cashback.baseUnits, s.byRole?.referrer.baseUnits, s.byRole?.introducer.baseUnits], [ms.cashback, ms.referrer, ms.introducer].map(String));
    const cpvc = ms.verifiedCustomers > 0 ? (ms.rewardsPaid / BigInt(ms.verifiedCustomers)).toString() : null;
    eq(`  costPerVerifiedCustomer`, s.costPerVerifiedCustomer?.baseUnits ?? null, cpvc);
    const key = (e) => `${e.txHash}|${e.orderId}|${e.role}|${e.from}|${e.to}|${e.amount}`;
    eq(`  edges (${m.edges.length})`, s.edges.map((e) => key({ ...e, txHash: e.txHash.toLowerCase(), amount: e.amount.baseUnits })).sort(), m.edges.map(key).sort());
  }
  for (const [a, m] of amb) {
    const r = (await get(`/ambassadors/${a}`)).body;
    eq(`GET /ambassadors/${a} (credited, venues, referrer, introducer, cashback)`, [r.customersCredited, r.venues.map((x) => x.venue).sort(), r.earned.referrer.baseUnits, r.earned.introducer.baseUnits, r.earned.cashback.baseUnits], [m.credited.size, [...m.venues].sort(), m.l1.toString(), m.l2.toString(), m.cashback.toString()]);
    const recentWant = m.lines.sort((x, y) => y.block - x.block || y.logIndex - x.logIndex).slice(0, 50).map((l) => `${l.txHash}|${l.role}|${l.amount}|${l.returned}`);
    eq(`  recent lines (${recentWant.length})`, r.recent.map((l) => `${l.txHash.toLowerCase()}|${l.roleId}|${l.amount.baseUnits}|${l.returned}`), recentWant);
  }
}

const jsonOut = opt('json', '');
if (jsonOut) {
  const ser = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Set ? [...v] : v)));
  writeFileSync(jsonOut, JSON.stringify({ from, to, events: evs.length, venues: ser([...venues.values()]), ambassadors: ser(Object.fromEntries(amb)) }, null, 2));
}
log(failures ? `\nMISMATCH: ${failures} check(s) failed` : '\nOK: all independent checks passed');
process.exitCode = failures ? 1 : 0;
