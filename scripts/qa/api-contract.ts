// @ts-nocheck — QA harness, intentionally loose (JSON in/out).
/**
 * QE_E2E Phase 2: API contract tests against INTERFACES §5 / D-801..D-806, run against a LIVE local api on Arc Testnet.
 * Written from INTERFACES.md + DECISIONS.md, not from the route tests. Uses ONLY throwaway QE wallets kept in the
 * state file (never the root env file): O = venue owner (no funds needed, the relayer pays), C = funded customer,
 * U = unfunded customer, X = bystander.
 *
 *   tsx scripts/qa/api-contract.ts setup     --state <file>                     # create the QE keys, print addresses
 *   tsx scripts/qa/api-contract.ts noauth    --api <base> --state <file>        # 401/400/404 matrix, public shapes (no gas)
 *   tsx scripts/qa/api-contract.ts main      --api <base> --state <file>        # register O's venue + error paths (gas: ~4 small txs)
 *   tsx scripts/qa/api-contract.ts guards    --api <base> --state <file>        # api started with RELAYER_MAX_GAS_PAY=100000 RELAYER_RATE_PER_USER_PER_MIN=2 (no gas)
 *   tsx scripts/qa/api-contract.ts settled   --api <base> --state <file>        # after streams:backfill into the api DB
 * Exit 1 on any failed check. Payout of O's venue = DEMO_LENA (public address), so customer cents return to the demo pool.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, getAddress, zeroAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ARC_MIN_MAX_FEE_PER_GAS, VOUCH_ARC_TESTNET, arcTestnet, vouchAbi } from '@vouch/shared';
import wallets from '../../packages/shared/src/wallets.public.json' with { type: 'json' };

const [cmd = 'help', ...argv] = process.argv.slice(2);
const opt = (n: string, d = '') => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const API = opt('api', 'http://127.0.0.1:4030').replace(/\/$/, '');
const STATE = opt('state', '');
if (!STATE) throw new Error('--state <file> required');
const RPC = 'https://rpc.testnet.arc.io';
const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
const USDC = '0x3600000000000000000000000000000000000000';
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const RELAYER = getAddress(wallets.RELAYER);
const LENA = getAddress(wallets.DEMO_LENA);

const st: any = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(st, null, 2));
const acct = (k: string) => privateKeyToAccount(st.keys[k]);

let fails = 0;
let passes = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ok   ${label}`);
  } else {
    fails++;
    console.log(`  FAIL ${label}${extra !== undefined ? `\n       ${JSON.stringify(extra).slice(0, 600)}` : ''}`);
  }
}
const note = (s: string) => console.log(`  note ${s}`);

async function api(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let j: any = text;
  try {
    j = JSON.parse(text);
  } catch {}
  return { status: res.status, body: j, ms: Date.now() - t0 };
}
/** status + D-806 error shape (+ optional code). */
function expectErr(label: string, r: any, status: number, code?: string) {
  const e = r.body?.error;
  const shape = !!e && typeof e.code === 'string' && typeof e.message === 'string' && typeof e.retryable === 'boolean';
  check(`${label} → ${status}${code ? ` ${code}` : ''}`, r.status === status && shape && (!code || e.code === code), { status: r.status, body: r.body });
}
function expectOk(label: string, r: any, status: number) {
  check(`${label} → ${status}`, r.status === status, { status: r.status, body: r.body });
  return r.body;
}
async function signTd(a: any, td: any): Promise<Hex> {
  const message: Record<string, unknown> = { ...td.message };
  for (const f of td.types[td.primaryType]) if (/^u?int\d*$/.test(f.type)) message[f.name] = BigInt(message[f.name] as string);
  return a.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message });
}
async function signIn(k: string, name?: string) {
  const a = acct(k);
  const ch = await api('POST', '/auth/challenge', undefined, { address: a.address });
  if (ch.status !== 200) throw new Error(`challenge ${k}: ${ch.status} ${JSON.stringify(ch.body)}`);
  const signature = await a.signMessage({ message: ch.body.message });
  const v = await api('POST', '/auth/verify', undefined, { address: a.address, challengeId: ch.body.challengeId, signature, displayName: name ?? `QE ${k}` });
  if (v.status !== 200) throw new Error(`verify ${k}: ${v.status} ${JSON.stringify(v.body)}`);
  return v.body.token as string;
}
const relayerNonce = () => pub.getTransactionCount({ address: RELAYER, blockTag: 'pending' });
const bal = (a: string) => pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [a] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitRelay(tok: string, relayId: string, label: string) {
  const t0 = Date.now();
  for (;;) {
    const r = await api('GET', `/relay/${relayId}`, tok);
    if (r.body?.status === 'mined') {
      console.log(`  tx   ${label} ${r.body.txHash}`);
      (st.txs ??= []).push({ label, hash: r.body.txHash });
      save();
      return r.body;
    }
    if (['failed', 'reverted'].includes(r.body?.status)) throw new Error(`${label}: ${JSON.stringify(r.body)}`);
    if (Date.now() - t0 > 90_000) throw new Error(`${label}: timeout ${JSON.stringify(r.body)}`);
    await sleep(700);
  }
}
async function newOrder(tokO: string, amount: string, ttlSeconds = 600) {
  const r = await api('POST', `/venues/${st.venue}/orders`, tokO, { amount, ttlSeconds });
  if (r.status !== 201) throw new Error(`order: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// ------------------------------------------------------------------------------------------------ setup
async function setup() {
  st.keys ??= { O: generatePrivateKey(), C: generatePrivateKey(), U: generatePrivateKey(), X: generatePrivateKey() };
  save();
  for (const k of Object.keys(st.keys)) console.log(`${k} ${acct(k).address} balance ${await bal(acct(k).address)}`);
}

// ------------------------------------------------------------------------------------------------ noauth
async function noauth() {
  console.log(`[noauth] ${API}`);
  const V = '0xf315D0B045697C4a7519d03af35a831008882005'; // v3 venue registered outside the API
  const OID = `0x${'11'.repeat(32)}`;
  const A = acct('X').address;
  const authed: [string, string, unknown?][] = [
    ['GET', '/auth/session'],
    ['POST', '/auth/logout', {}],
    ['PATCH', '/me', { displayName: 'x' }],
    ['POST', '/venues/prepare', { name: 'x', rewardBps: 1500, minOrder: '0' }],
    ['POST', '/venues', { venue: V, signature: `0x${'00'.repeat(65)}` }],
    ['PATCH', `/venues/${V}`, { name: 'x' }],
    ['POST', `/venues/${V}/actions`, { kind: 'updateTerms', rewardBps: 1 }],
    ['POST', `/venues/${V}/actions/abc`, { signature: `0x${'00'.repeat(65)}` }],
    ['GET', `/venues/${V}/actions/abc`],
    ['POST', `/venues/${V}/orders`, { amount: '1' }],
    ['GET', `/venues/${V}/orders`],
    ['POST', '/intros/prepare', { venue: V, linkType: 'personal' }],
    ['POST', '/intros', { intro: {}, signature: '0x' }],
    ['POST', '/intros/abcdef/accept/prepare', {}],
    ['POST', '/intros/abcdef/accept', {}],
    ['GET', '/me/links'],
    ['POST', '/payments/quote', { venue: V, orderId: OID }],
    ['POST', '/payments', { intentId: 'x', signature: '0x' }],
    ['GET', '/payments/abc'],
    ['GET', '/me/wallet'],
    ['GET', '/me/activity'],
    ['GET', '/relay/abc'],
    ['GET', `/events/user/${A}`],
  ];
  for (const [m, p, b] of authed) expectErr(`${m} ${p} without a token`, await api(m, p, undefined, b), 401, 'UNAUTHENTICATED');
  expectErr('GET /auth/session with a garbage bearer', await api('GET', '/auth/session', 'v1.AAAA.BBBB'), 401, 'UNAUTHENTICATED');

  // public reads
  const h = await api('GET', '/health');
  check('GET /health → 200 {ok, chainId 5042002}', h.status === 200 && h.body.ok === true && h.body.chainId === 5042002, h.body);
  const rs = await api('GET', '/relayer/status');
  check('GET /relayer/status → 200 {enabled, address = RELAYER, signers}', rs.status === 200 && rs.body.enabled === true && rs.body.address === RELAYER && !!rs.body.signers?.venueSigner, rs.body);
  expectOk('GET /venues', await api('GET', '/venues'), 200);
  expectErr('GET /venues/<not an address>', await api('GET', '/venues/0x123'), 400, 'BAD_REQUEST');
  expectErr('GET /venues/<unknown>', await api('GET', `/venues/${acct('X').address}`), 404, 'UNKNOWN_VENUE');
  const terms = await api('GET', `/venues/${acct('X').address}/terms`);
  check('GET /venues/<unknown>/terms → 200 empty history (no 404)', terms.status === 200 && terms.body.history.length === 0, terms.body);
  note(`GET /venues/<unknown>/terms answers ${terms.status} (INTERFACES §5 does not say; /venues/:venue answers 404)`);
  const stats = await api('GET', `/venues/${acct('X').address}/stats`);
  check('GET /venues/<unknown>/stats → 200 zeros', stats.status === 200 && stats.body.verifiedCustomers === 0 && stats.body.source === 'streams', stats.body);
  expectErr('GET /venues/:v/orders/<unknown>', await api('GET', `/venues/${V}/orders/${OID}`), 404, 'NOT_FOUND');
  expectErr('GET /venues/:v/orders/<bad id>', await api('GET', `/venues/${V}/orders/0x12`), 400, 'BAD_REQUEST');
  expectErr('GET /intros/<bad code>', await api('GET', '/intros/!!'), 404, 'NOT_FOUND');
  expectErr('POST /intros/<unknown>/opens', await api('POST', '/intros/abcdefgh/opens', undefined, {}), 404, 'NOT_FOUND');
  const amb = await api('GET', `/ambassadors/${acct('X').address}`);
  check('GET /ambassadors/<nobody> → 200 zeros, source streams', amb.status === 200 && amb.body.customersCredited === 0 && amb.body.source === 'streams', amb.body);
  expectErr('GET /ambassadors/<bad>', await api('GET', '/ambassadors/nope'), 400, 'BAD_REQUEST');
  // auth validation
  expectErr('POST /auth/challenge {address: bad}', await api('POST', '/auth/challenge', undefined, { address: 'nope' }), 400, 'BAD_REQUEST');
  expectErr('POST /auth/challenge (no body)', await api('POST', '/auth/challenge'), 400, 'BAD_REQUEST');
  expectErr('POST /auth/challenge (invalid JSON)', await api('POST', '/auth/challenge', undefined, '{"address":'), 400);
  const ch = await api('POST', '/auth/challenge', undefined, { address: acct('X').address });
  check('POST /auth/challenge → 200 {challengeId, message, expiresAt}', ch.status === 200 && !!ch.body.challengeId && typeof ch.body.message === 'string' && !!ch.body.expiresAt, ch.body);
  const wrong = await acct('U').signMessage({ message: ch.body.message });
  expectErr('POST /auth/verify signed by another key', await api('POST', '/auth/verify', undefined, { address: acct('X').address, challengeId: ch.body.challengeId, signature: wrong }), 400, 'INVALID_SIGNATURE');
  const good = await acct('X').signMessage({ message: ch.body.message });
  const v1 = await api('POST', '/auth/verify', undefined, { address: acct('X').address, challengeId: ch.body.challengeId, signature: good });
  check('POST /auth/verify → 200 {token, expiresAt, user}', v1.status === 200 && !!v1.body.token && !!v1.body.user?.address, v1.body);
  expectErr('POST /auth/verify replaying the same challenge', await api('POST', '/auth/verify', undefined, { address: acct('X').address, challengeId: ch.body.challengeId, signature: good }), 401, 'UNAUTHENTICATED');
  expectErr('POST /auth/verify unknown challenge', await api('POST', '/auth/verify', undefined, { address: acct('X').address, challengeId: 'nope', signature: good }), 401, 'UNAUTHENTICATED');
  const tok = v1.body.token;
  const s = await api('GET', '/auth/session', tok);
  check('GET /auth/session → 200 {address, roles}', s.status === 200 && s.body.address === acct('X').address && s.body.roles?.customer === true, s.body);
  // tampered token: flip the sub inside the payload, keep the MAC
  const [v, p, mac] = tok.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  claims.sub = acct('U').address;
  expectErr('GET /auth/session with a re-signed-less tampered payload', await api('GET', '/auth/session', `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`), 401, 'UNAUTHENTICATED');
  // ?token= accepted outside SSE?
  const q = await api('GET', `/auth/session?token=${encodeURIComponent(tok)}`);
  check('GET /auth/session?token=… (query token) is REJECTED outside SSE (D-802: "?token= (SSE only)")', q.status === 401, { status: q.status });
  const cookie = await api('GET', '/auth/session', undefined, undefined, { cookie: `vouch_session=${encodeURIComponent(tok)}` });
  note(`cookie vouch_session accepted on /auth/session: ${cookie.status}`);
  expectErr('GET /events/user/<someone else> with my token', await api('GET', `/events/user/${acct('U').address}`, tok), 403, 'FORBIDDEN');
  expectOk('PATCH /me {displayName}', await api('PATCH', '/me', tok, { displayName: 'QE X' }), 200);
  expectErr('PATCH /me {displayName: 61 chars}', await api('PATCH', '/me', tok, { displayName: 'x'.repeat(61) }), 400, 'BAD_REQUEST');
  expectOk('POST /auth/logout', await api('POST', '/auth/logout', tok, {}), 200);
  expectErr('GET /auth/session after logout', await api('GET', '/auth/session', tok), 401, 'UNAUTHENTICATED');
  // SSE venue channel is public
  const ctl = new AbortController();
  const sse = await fetch(`${API}/events/venue/${V}`, { signal: ctl.signal }).catch((e) => ({ status: -1, headers: new Headers(), e }));
  check('GET /events/venue/:v → 200 text/event-stream (public)', sse.status === 200 && /event-stream/.test(sse.headers.get('content-type') ?? ''), { status: sse.status, ct: sse.headers.get('content-type') });
  ctl.abort();
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  console.log(`[main] ${API}`);
  const O = acct('O'), C = acct('C'), U = acct('U'), X = acct('X');
  const tO = await signIn('O', 'QE Owner');
  const tC = await signIn('C', 'QE Cust');
  const tU = await signIn('U', 'QE Broke');
  const tX = await signIn('X', 'QE Bystander');
  console.log(`  O ${O.address} · C ${C.address} (bal ${await bal(C.address)}) · U ${U.address} · X ${X.address}`);

  // ---- venue registration (relayed)
  expectErr('POST /venues/prepare rewardBps 0', await api('POST', '/venues/prepare', tO, { name: 'QE', rewardBps: 0, minOrder: '0' }), 400, 'BAD_REQUEST');
  expectErr('POST /venues/prepare rewardBps 5001', await api('POST', '/venues/prepare', tO, { name: 'QE', rewardBps: 5001, minOrder: '0' }), 400, 'BAD_REQUEST');
  expectErr('POST /venues/prepare minOrder > $10,000', await api('POST', '/venues/prepare', tO, { name: 'QE', rewardBps: 100, minOrder: '10000000001' }), 400, 'INVALID_TERMS');
  expectErr('POST /venues/prepare payout = Vouch (contract refuses: InvalidPayout)', await api('POST', '/venues/prepare', tO, { name: 'QE', rewardBps: 100, minOrder: '0', payout: VOUCH_ARC_TESTNET.address }), 400, 'INVALID_PAYOUT');
  if (!st.venue) {
    const prep = await api('POST', '/venues/prepare', tO, { name: `QE venue ${new Date().toISOString().slice(0, 16)}`, rewardBps: 1000, minOrder: '0', payout: LENA });
    const pb = expectOk('POST /venues/prepare', prep, 200);
    check('  shape {venue, slug, typedData{domain,types,primaryType:RegisterVenue,message}}', !!pb.venue && !!pb.slug && pb.typedData?.primaryType === 'RegisterVenue' && typeof pb.typedData.message.nonce === 'string', pb);
    check('  typedData signer/attributor = our VENUE_SIGNER / ATTRIBUTOR (D-804)', pb.typedData.message.signer === getAddress(wallets.VENUE_SIGNER) && pb.typedData.message.attributor === getAddress(wallets.ATTRIBUTOR), pb.typedData.message);
    const badSig = await signTd(X, pb.typedData);
    expectErr('POST /venues signed by a non-owner', await api('POST', '/venues', tO, { venue: pb.venue, signature: badSig }), 400, 'INVALID_SIGNATURE');
    expectErr('POST /venues by another session', await api('POST', '/venues', tX, { venue: pb.venue, signature: badSig }), 404, 'NOT_FOUND');
    const sig = await signTd(O, pb.typedData);
    const reg = await api('POST', '/venues', tO, { venue: pb.venue, signature: sig });
    const rb = expectOk('POST /venues', reg, 202);
    check('  shape {venue, status:"pending", txHash, relayId}', rb.venue === pb.venue && rb.status === 'pending' && /^0x[0-9a-f]{64}$/.test(rb.txHash) && !!rb.relayId, rb);
    expectErr('POST /venues again while relaying/registered', await api('POST', '/venues', tO, { venue: pb.venue, signature: sig }), 409);
    await waitRelay(tO, rb.relayId, 'registerVenue (QE O)');
    st.venue = pb.venue;
    save();
  }
  const V = st.venue;
  const gv = await api('GET', `/venues/${V}`);
  check('GET /venues/:v (registered via API, local api has no Stream) → 200, managedByVouch', gv.status === 200 && gv.body.managedByVouch === true, gv.body);
  note(`GET /venues/:v status "${gv.body.status}", waitingOnStreams ${gv.body.waitingOnStreams}`);
  const sess = await api('GET', '/auth/session', tO);
  check('GET /auth/session for the owner → roles.venueOwner', sess.body?.roles?.venueOwner === true, sess.body);
  expectOk('PATCH /venues/:v by owner', await api('PATCH', `/venues/${V}`, tO, { description: 'QE test venue' }), 200);
  expectErr('PATCH /venues/:v by non-owner', await api('PATCH', `/venues/${V}`, tX, { name: 'pwned' }), 403, 'FORBIDDEN');

  // ---- orders
  expectErr('POST orders by non-owner', await api('POST', `/venues/${V}/orders`, tX, { amount: '10000' }), 403, 'FORBIDDEN');
  expectErr('POST orders amount 0', await api('POST', `/venues/${V}/orders`, tO, { amount: '0' }), 400, 'INVALID_AMOUNT');
  expectErr('POST orders amount > 1,000,000e6', await api('POST', `/venues/${V}/orders`, tO, { amount: '1000000000001' }), 400, 'INVALID_AMOUNT');
  expectErr('POST orders amount "1.5" (not base units)', await api('POST', `/venues/${V}/orders`, tO, { amount: '1.5' }), 400, 'BAD_REQUEST');
  expectErr('POST orders ttlSeconds 10 (< 30)', await api('POST', `/venues/${V}/orders`, tO, { amount: '10000', ttlSeconds: 10 }), 400, 'BAD_REQUEST');
  expectErr('POST orders for a venue we do not manage (v3 story venue, Lena-owned)', await api('POST', `/venues/0xf315D0B045697C4a7519d03af35a831008882005/orders`, tO, { amount: '10000' }), 403, 'FORBIDDEN');
  const o1 = await newOrder(tO, '10000');
  check('POST orders → 201 {order, signature, qrPayload, status:"pending"}', !!o1.order?.orderId && /^0x/.test(o1.signature) && /\/pay\?v=/.test(o1.qrPayload) && o1.status === 'pending', o1);
  const go = await api('GET', `/venues/${V}/orders/${o1.order.orderId}`);
  check('GET /venues/:v/orders/:id (public) → 200 status pending, settled null', go.status === 200 && go.body.status === 'pending' && go.body.settled === null, go.body);
  const lo = await api('GET', `/venues/${V}/orders`, tO);
  check('GET /venues/:v/orders (owner) → 200 list', lo.status === 200 && lo.body.orders.length >= 1, lo.body);
  expectErr('GET /venues/:v/orders (non-owner)', await api('GET', `/venues/${V}/orders`, tX), 403, 'FORBIDDEN');

  // ---- quotes: submitter never 0, relayed shape
  const q1 = await api('POST', '/payments/quote', tC, { venue: V, orderId: o1.order.orderId });
  const qb = expectOk('POST /payments/quote (relayed)', q1, 200);
  const keys = ['intentId', 'quote', 'attribution', 'weights', 'weightsSignature', 'paymentAuth', 'typedData', 'balance', 'canAfford', 'warnings'];
  check(`  shape has ${keys.join(', ')}`, keys.every((k) => k in qb), Object.keys(qb));
  check('  paymentAuth.submitter = RELAYER (never 0)', qb.paymentAuth.submitter === RELAYER, qb.paymentAuth);
  check('  typedData = USDC ReceiveWithAuthorization to Vouch, value = amount', qb.typedData.primaryType === 'ReceiveWithAuthorization' && qb.typedData.message.to === VOUCH_ARC_TESTNET.address && qb.typedData.message.value === '10000' && qb.typedData.domain.name === 'USDC', qb.typedData);
  check('  plain first purchase: weightsHash 0, quote venueAmount = amount', qb.paymentAuth.weightsHash === `0x${'0'.repeat(64)}` && qb.quote.venueAmount.baseUnits === '10000' && qb.quote.firstPurchase === true, qb.quote);
  check('  warnings include first_purchase_without_recommendation', qb.warnings.includes('first_purchase_without_recommendation'), qb.warnings);
  expectErr('POST /payments/quote unknown order', await api('POST', '/payments/quote', tC, { venue: V, orderId: `0x${'22'.repeat(32)}` }), 404, 'NOT_FOUND');
  expectErr('POST /payments/quote mode "bogus"', await api('POST', '/payments/quote', tC, { venue: V, orderId: o1.order.orderId, mode: 'bogus' }), 400, 'BAD_REQUEST');
  expectErr('GET /payments/:intentId of another user', await api('GET', `/payments/${qb.intentId}`, tX), 404, 'NOT_FOUND');
  expectErr('POST /payments intent of another user', await api('POST', '/payments', tX, { intentId: qb.intentId, signature: await signTd(X, qb.typedData) }), 404, 'NOT_FOUND');
  const n0 = await relayerNonce();
  expectErr('POST /payments signature by a different key', await api('POST', '/payments', tC, { intentId: qb.intentId, signature: await signTd(X, qb.typedData) }), 400, 'INVALID_SIGNATURE');
  check('  nothing sent (relayer nonce unchanged)', (await relayerNonce()) === n0);

  // ---- QE-C-11 relayed: insufficient balance (U has $0)
  const oU = await newOrder(tO, '50000');
  const qU = await api('POST', '/payments/quote', tU, { venue: V, orderId: oU.order.orderId });
  check('quote for an unfunded customer → 200, canAfford false, warning insufficient_balance', qU.status === 200 && qU.body.canAfford === false && qU.body.warnings.includes('insufficient_balance'), qU.body);
  const pU = await api('POST', '/payments', tU, { intentId: qU.body.intentId, signature: await signTd(U, qU.body.typedData) });
  expectErr('POST /payments with balance < amount (QE-C-11 relayed)', pU, 402, 'INSUFFICIENT_BALANCE');
  check('  details {balance, needed, shortfall}', pU.body?.error?.details?.needed === '50000' && pU.body.error.details.balance === '0', pU.body);
  check('  nothing sent (relayer nonce unchanged)', (await relayerNonce()) === n0);
  const gU = await api('GET', `/payments/${qU.body.intentId}`, tU);
  note(`intent after 402: relayStatus ${gU.body?.relayStatus}, status ${gU.body?.status} (can it be retried after a top-up? relayStatus must stay "quoted")`);
  check('  intent stays retryable after a 402 (relayStatus quoted)', gU.body?.relayStatus === 'quoted', gU.body);

  // ---- QE-C-11 self-submit: balance ≥ amount + 900k × maxFee
  const balC = await bal(C.address);
  const fees = await pub.estimateFeesPerGas();
  const maxFee = fees.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fees.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const feeUsdc = (900_000n * maxFee + 999_999_999_999n) / 1_000_000_000_000n;
  const between = balC - feeUsdc / 2n; // amount ≤ balance < amount + fee
  console.log(`  C balance ${balC}; 900k × ${maxFee} wei ≈ ${feeUsdc} base units; probe order amount ${between}`);
  const oB = await newOrder(tO, between.toString());
  const qBr = await api('POST', '/payments/quote', tC, { venue: V, orderId: oB.order.orderId });
  check('relayed quote for amount ≤ balance → canAfford true', qBr.status === 200 && qBr.body.canAfford === true, qBr.body);
  const qBs = await api('POST', '/payments/quote', tC, { venue: V, orderId: oB.order.orderId, mode: 'self-submit' });
  expectErr('self-submit quote with amount ≤ balance < amount + 900k×maxFee (QE-C-11)', qBs, 402, 'INSUFFICIENT_BALANCE');
  check('  details.selfSubmit true, needed = amount + ceil(900k × maxFee / 1e12) (±fee drift)', qBs.body?.error?.details?.selfSubmit === true && BigInt(qBs.body.error.details.needed) > between, qBs.body?.error?.details);

  // ---- QE-C-10: the customer settles the order with a self-submit auth first → relayer 409 terminal
  const oK = await newOrder(tO, '10000');
  st.orderK = oK.order.orderId;
  const qR = await api('POST', '/payments/quote', tC, { venue: V, orderId: oK.order.orderId });
  const qS = await api('POST', '/payments/quote', tC, { venue: V, orderId: oK.order.orderId, mode: 'self-submit' });
  check('self-submit quote → 200, paymentAuth.submitter = customer (never 0), selfSubmit.needed', qS.status === 200 && qS.body.paymentAuth.submitter === C.address && !!qS.body.selfSubmit?.needed, qS.body);
  expectErr('POST /payments with a self-submit intent (API never relays it)', await api('POST', '/payments', tC, { intentId: qS.body.intentId, signature: await signTd(C, qS.body.typedData) }), 400, 'BAD_REQUEST');
  const sS = await signTd(C, qS.body.typedData);
  const b = qS.body;
  const toB = (o: any) => ({ ...o, amount: BigInt(o.amount), expiresAt: BigInt(o.expiresAt) });
  const data = encodeFunctionData({
    abi: vouchAbi,
    functionName: 'pay',
    args: [
      toB(b.order),
      b.orderSignature,
      { ...b.weights, bps: b.weights.bps.map(Number) },
      b.weightsSignature,
      { ...b.paymentAuth, amount: BigInt(b.paymentAuth.amount), deadline: BigInt(b.paymentAuth.deadline) },
      sS,
    ],
  });
  const wC = createWalletClient({ account: C, chain: arcTestnet, transport: http(RPC) });
  const gas = await pub.estimateGas({ account: C, to: VOUCH_ARC_TESTNET.address, data });
  const fee2 = await pub.estimateFeesPerGas();
  const mf = fee2.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? fee2.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const selfHash = await wC.sendTransaction({ to: VOUCH_ARC_TESTNET.address, data, gas: (gas * 12n) / 10n, maxFeePerGas: mf, maxPriorityFeePerGas: fee2.maxPriorityFeePerGas > mf ? mf : fee2.maxPriorityFeePerGas });
  const selfRcpt = await pub.waitForTransactionReceipt({ hash: selfHash });
  console.log(`  tx   self-submit pay by C (QE-C-10 setup) ${selfHash} status ${selfRcpt.status} gas ${selfRcpt.gasUsed}`);
  (st.txs ??= []).push({ label: 'self-submit pay C $0.01 (QE-C-10)', hash: selfHash });
  check('  self-submit pay() from the customer EOA succeeded (submitter = customer)', selfRcpt.status === 'success' && selfRcpt.from.toLowerCase() === C.address.toLowerCase());
  const n1 = await relayerNonce();
  const pR = await api('POST', '/payments', tC, { intentId: qR.body.intentId, signature: await signTd(C, qR.body.typedData) });
  expectErr('POST /payments (relayed intent) after the order was settled by self-submit (QE-C-10)', pR, 409, 'ORDER_ALREADY_PAID');
  check('  terminal: retryable false, details.waitingOnStreams true (no Stream on this api)', pR.body?.error?.retryable === false && pR.body.error.details?.waitingOnStreams === true, pR.body);
  check('  nothing sent (relayer nonce unchanged)', (await relayerNonce()) === n1);
  expectErr('POST /payments same intent again', await api('POST', '/payments', tC, { intentId: qR.body.intentId, signature: await signTd(C, qR.body.typedData) }), 409, 'ORDER_ALREADY_PAID');
  const gR = await api('GET', `/payments/${qR.body.intentId}`, tC);
  check('GET /payments/:id → relayStatus already_settled, status pending (not settled until Streams), waitingOnStreams', gR.body?.relayStatus === 'already_settled' && gR.body.status === 'pending' && gR.body.waitingOnStreams === true, gR.body);
  expectErr('POST /payments/quote for the settled order', await api('POST', '/payments/quote', tC, { venue: V, orderId: oK.order.orderId }), 409, 'ORDER_ALREADY_PAID');
  st.intentR = qR.body.intentId;
  st.selfHash = selfHash;
  save();

  // ---- C is now verified at V: rewards / intros
  const ip = await api('POST', '/intros/prepare', tC, { venue: V, linkType: 'broadcast' });
  check('POST /intros/prepare by a verified customer → 200 {intro, typedData}', ip.status === 200 && ip.body.typedData?.primaryType === 'Intro', ip.body);
  expectErr('POST /intros/prepare by a non-verified user', await api('POST', '/intros/prepare', tX, { venue: V, linkType: 'personal' }), 403, 'REFERRER_NOT_ELIGIBLE');
  expectErr('POST /intros/prepare ttlDays 31', await api('POST', '/intros/prepare', tC, { venue: V, linkType: 'personal', ttlDays: 31 }), 400, 'BAD_REQUEST');
  if (ip.status === 200) {
    const isig = await signTd(C, ip.body.typedData);
    expectErr('POST /intros by someone else (referrer ≠ session)', await api('POST', '/intros', tX, { intro: ip.body.typedData.message, signature: isig }), 403, 'FORBIDDEN');
    const ic = await api('POST', '/intros', tC, { intro: ip.body.typedData.message, signature: isig });
    const icb = expectOk('POST /intros', ic, 201);
    check('  shape {code, url, introHash}', !!icb.code && /\/i\//.test(icb.url) && /^0x[0-9a-f]{64}$/.test(icb.introHash), icb);
    const dup = await api('POST', '/intros', tC, { intro: ip.body.typedData.message, signature: isig });
    note(`POST /intros with the same signed intro again → ${dup.status} (same code: ${dup.body?.code === icb.code})`);
    const gi = await api('GET', `/intros/${icb.code}`);
    check('GET /intros/:code → 200 status active, reissueBy null', gi.status === 200 && gi.body.status === 'active' && gi.body.reissueBy === null, gi.body);
    check('  terms.minOrder uses the {baseUnits, display} money shape', !!gi.body?.terms?.minOrder?.display, gi.body?.terms);
    expectErr('POST /intros/:code/accept/prepare by the referrer (self)', await api('POST', `/intros/${icb.code}/accept/prepare`, tC, {}), 400, 'SELF_REFERRAL');
    const ap = await api('POST', `/intros/${icb.code}/accept/prepare`, tX, {});
    check('POST /intros/:code/accept/prepare (bystander) → 200 {acceptance, typedData}', ap.status === 200 && ap.body.typedData?.primaryType === 'IntroAcceptance', ap.body);
    expectErr('POST /intros/:code/accept with a signature by another key', await api('POST', `/intros/${icb.code}/accept`, tX, { acceptance: ap.body.acceptance, signature: await signTd(U, ap.body.typedData) }), 400, 'INVALID_SIGNATURE');
    const own = await api('POST', `/intros/${icb.code}/opens`, tC, {});
    check('POST /intros/:code/opens by the referrer → not recorded (own_link)', own.body?.recorded === false && own.body.reason === 'own_link', own.body);
    const opens = [];
    for (let i = 0; i < 11; i++) opens.push((await api('POST', `/intros/${icb.code}/opens`, undefined, {})).body?.recorded);
    check('POST /intros/:code/opens anonymous: 10 recorded, then rate limited', opens.filter((x) => x === true).length === 10 && opens[10] === false, opens);
    const ml = await api('GET', '/me/links', tC);
    check('GET /me/links → my link with opens = 10 (anonymous opens count, referrer excluded)', ml.status === 200 && ml.body.links.find((l: any) => l.code === icb.code)?.opens === 10, ml.body);
  }

  // ---- owner actions: superseded / non-owner / wrong signer
  expectErr('POST /venues/:v/actions by non-owner', await api('POST', `/venues/${V}/actions`, tX, { kind: 'setSeedAmbassador', ambassador: X.address }), 403, 'FORBIDDEN');
  expectErr('POST /venues/:v/actions kind bogus', await api('POST', `/venues/${V}/actions`, tO, { kind: 'drain' }), 400, 'BAD_REQUEST');
  const a1 = await api('POST', `/venues/${V}/actions`, tO, { kind: 'updateTerms', rewardBps: 900, minOrder: '0' });
  check('POST /venues/:v/actions updateTerms → 200 {actionId, typedData}', a1.status === 200 && !!a1.body.actionId && a1.body.typedData.primaryType === 'UpdateTerms', a1.body);
  const a2 = await api('POST', `/venues/${V}/actions`, tO, { kind: 'setSeedAmbassador', ambassador: X.address, allowed: true });
  expectErr('POST /venues/:v/actions/:id (older, superseded by a newer prepare)', await api('POST', `/venues/${V}/actions/${a1.body.actionId}`, tO, { signature: await signTd(O, a1.body.typedData) }), 409, 'OWNER_NONCE_STALE');
  expectErr('POST /venues/:v/actions/:id signed by a non-owner key', await api('POST', `/venues/${V}/actions/${a2.body.actionId}`, tO, { signature: await signTd(X, a2.body.typedData) }), 400, 'INVALID_SIGNATURE');
  const ga = await api('GET', `/venues/${V}/actions/${a2.body.actionId}`, tO);
  check('GET /venues/:v/actions/:id → 200 status prepared', ga.status === 200 && ga.body.status === 'prepared', ga.body);
  expectErr('GET /venues/:v/actions/:id by non-owner', await api('GET', `/venues/${V}/actions/${a2.body.actionId}`, tX), 404, 'NOT_FOUND');
  const allowedStr = await api('POST', `/venues/${V}/actions`, tO, { kind: 'setSeedAmbassador', ambassador: X.address, allowed: 'false' });
  note(`setSeedAmbassador {allowed: "false"} (string) → message.allowed = ${allowedStr.body?.typedData?.message?.allowed}`);
  const allowedStr2 = await api('POST', `/venues/${V}/actions`, tO, { kind: 'setSeedAmbassador', ambassador: X.address, allowed: 'true' });
  check('setSeedAmbassador {allowed: "true"} (string) is rejected or parsed as true (not silently false)', allowedStr2.status === 400 || allowedStr2.body?.typedData?.message?.allowed === true, allowedStr2.body?.typedData?.message);

  // ---- expired order
  const oE = await newOrder(tO, '10000', 30);
  const qE = await api('POST', '/payments/quote', tC, { venue: V, orderId: oE.order.orderId });
  check('quote for a 30 s order (fresh) → 200, paymentAuth.deadline ≤ order.expiresAt + 1', qE.status === 200 && BigInt(qE.body.paymentAuth.deadline) <= BigInt(oE.order.expiresAt) + 1n, qE.body?.paymentAuth);
  console.log('  … waiting 36 s for the order to expire');
  await sleep(36_000);
  expectErr('POST /payments/quote after the order expired', await api('POST', '/payments/quote', tC, { venue: V, orderId: oE.order.orderId }), 410, 'ORDER_EXPIRED');
  const n2 = await relayerNonce();
  const pE = await api('POST', '/payments', tC, { intentId: qE.body.intentId, signature: await signTd(C, qE.body.typedData) });
  expectErr('POST /payments for a quote whose order expired', pE, 410);
  note(`expired pay code: ${pE.body?.error?.code} (D-806 lists ORDER_EXPIRED 410 for OrderExpired; the auth deadline fires first → PAYMENT_EXPIRED)`);
  check('  nothing sent (relayer nonce unchanged)', (await relayerNonce()) === n2);
  const gE = await api('GET', `/venues/${V}/orders/${oE.order.orderId}`);
  check('GET order after expiry → status expired', gE.body?.status === 'expired', gE.body);

  // ---- double submit race (one relayed pay, $0.01)
  const oD = await newOrder(tO, '10000');
  const qD = await api('POST', '/payments/quote', tC, { venue: V, orderId: oD.order.orderId });
  const sD = await signTd(C, qD.body.typedData);
  const [r1, r2] = await Promise.all([api('POST', '/payments', tC, { intentId: qD.body.intentId, signature: sD }), api('POST', '/payments', tC, { intentId: qD.body.intentId, signature: sD })]);
  const sts = [r1.status, r2.status].sort();
  console.log(`  double POST /payments same intent → ${r1.status} ${JSON.stringify(r1.body).slice(0, 160)} | ${r2.status} ${JSON.stringify(r2.body).slice(0, 160)}`);
  check('concurrent double POST /payments → exactly one 202 and one 409', sts[0] === 202 && sts[1] === 409, sts);
  const ok202 = [r1, r2].find((r) => r.status === 202);
  if (ok202) {
    check('  202 shape {intentId, status:"pending", txHash, relayId}', ok202.body.status === 'pending' && /^0x[0-9a-f]{64}$/.test(ok202.body.txHash) && !!ok202.body.relayId, ok202.body);
    await waitRelay(tC, ok202.body.relayId, 'relayed pay C $0.01 (double-submit probe)');
    await sleep(1500);
    const gD = await api('GET', `/payments/${qD.body.intentId}`, tC);
    check('  GET /payments/:id after mining → relayStatus relayed (not overwritten to already_settled by the losing duplicate)', gD.body?.relayStatus === 'relayed', gD.body);
    st.intentD = qD.body.intentId;
    const rr = await api('GET', `/relay/${ok202.body.relayId}`, tC);
    check('GET /relay/:id → {id, kind:"pay", status:"mined", txHash, gasUsed, blockNumber}', rr.body?.kind === 'pay' && rr.body.status === 'mined' && !!rr.body.gasUsed, rr.body);
    expectErr('GET /relay/:id by another user', await api('GET', `/relay/${ok202.body.relayId}`, tX), 404, 'NOT_FOUND');
  }
  const w = await api('GET', '/me/wallet', tC);
  check('GET /me/wallet → {address, balance{baseUnits,display}, rewardsEarned, pending[]}', w.status === 200 && !!w.body.balance?.baseUnits && Array.isArray(w.body.pending), w.body);
  const act = await api('GET', '/me/activity', tC);
  check('GET /me/activity → {address, items[], cursor}', act.status === 200 && Array.isArray(act.body.items) && 'cursor' in act.body, act.body);
  note(`C activity before streams: ${act.body.items.map((i: any) => `${i.kind}/${i.status}`).join(', ')}`);
  save();
}

// ------------------------------------------------------------------------------------------------ guards (api with RELAYER_MAX_GAS_PAY=100000 RELAYER_RATE_PER_USER_PER_MIN=2)
async function guards() {
  console.log(`[guards] ${API} (expects RELAYER_MAX_GAS_PAY=100000, RELAYER_RATE_PER_USER_PER_MIN=2)`);
  const C = acct('C');
  const tO = await signIn('O');
  const tC = await signIn('C');
  const n0 = await relayerNonce();
  const res: any[] = [];
  for (let i = 0; i < 3; i++) {
    const o = await newOrder(tO, '10000');
    const q = await api('POST', '/payments/quote', tC, { venue: st.venue, orderId: o.order.orderId });
    const sg = await signTd(C, q.body.typedData);
    let p;
    if (i === 0) {
      // QE-2-01 re-test: a concurrent duplicate must be refused BEFORE the relayer (no rate token, no 2nd job)
      const [a, b2] = await Promise.all([api('POST', '/payments', tC, { intentId: q.body.intentId, signature: sg }), api('POST', '/payments', tC, { intentId: q.body.intentId, signature: sg })]);
      const dup = a.status === 422 ? b2 : a;
      p = a.status === 422 ? a : b2;
      console.log(`  duplicate: ${dup.status} ${JSON.stringify(dup.body).slice(0, 160)}`);
      expectErr('QE-2-01 re-test: concurrent duplicate POST /payments refused at the intent claim', dup, 409, 'PAYMENT_ALREADY_USED');
    } else p = await api('POST', '/payments', tC, { intentId: q.body.intentId, signature: sg });
    res.push(p);
    console.log(`  attempt ${i + 1}: ${p.status} ${JSON.stringify(p.body).slice(0, 220)}`);
  }
  expectErr('max-gas guard: pay estimate × 1.2 > RELAYER_MAX_GAS_PAY', res[0], 422, 'GAS_TOO_HIGH');
  check('  details {kind: pay, gasLimit, cap: 100000}', res[0].body?.error?.details?.cap === '100000' && res[0].body.error.details.kind === 'pay', res[0].body);
  expectErr('max-gas guard again (2nd relay of this user this minute; the duplicate above used no token)', res[1], 422, 'GAS_TOO_HIGH');
  expectErr('per-user rate limit (3rd relay attempt in a minute, limit 2)', res[2], 429, 'RATE_LIMITED');
  check('  details.retryAfterMs > 0, retryable true', res[2].body?.error?.retryable === true && res[2].body.error.details?.retryAfterMs > 0, res[2].body);
  check('nothing sent by any guard (relayer nonce unchanged)', (await relayerNonce()) === n0);
  const rs = await api('GET', '/relayer/status');
  note(`relayer/status after guards: recentFailures ${rs.body.recentFailures}, queueDepth ${rs.body.queueDepth}`);
}

// ------------------------------------------------------------------------------------------------ settled (after streams:backfill)
async function settled() {
  console.log(`[settled] ${API}`);
  const tC = await signIn('C');
  const gR = await api('GET', `/payments/${st.intentR}`, tC);
  check('QE-C-10 intent: GET /payments/:id → status settled from Streams (split from events, not the quote)', gR.body?.status === 'settled' && gR.body.settled?.source === 'streams' && gR.body.settled.txHash === st.selfHash, gR.body);
  check('  settled.venueAmount 10000, no reward lines, relayStatus already_settled', gR.body?.settled?.venueAmount?.baseUnits === '10000' && gR.body.settled.lines.length === 0 && gR.body.relayStatus === 'already_settled', gR.body?.settled);
  const pR = await api('POST', '/payments/quote', tC, { venue: st.venue, orderId: st.orderK });
  expectErr('quote for the settled order (now ingested)', pR, 409, 'ORDER_ALREADY_PAID');
  check('  details.settled populated, waitingOnStreams false', !!pR.body?.error?.details?.settled && pR.body.error.details.waitingOnStreams === false, pR.body?.error?.details);
  if (st.intentD) {
    const gD = await api('GET', `/payments/${st.intentD}`, tC);
    check('relayed $0.01 intent → status settled', gD.body?.status === 'settled', gD.body);
  }
  const go = await api('GET', `/venues/${st.venue}/orders/${st.orderK}`);
  check('GET order (public) → status paid, paid true', go.body?.status === 'paid' && go.body.paid === true, go.body);
  const v = await api('GET', `/venues/${st.venue}`);
  check('GET /venues/:v → status registered from Streams, terms v1', v.body?.status === 'registered' && v.body.waitingOnStreams === false && v.body.terms?.termsVersion === 1, v.body);
  const s = await api('GET', `/venues/${st.venue}/stats`);
  check('GET /venues/:v/stats → verified 1, payments 2, gross 20000', s.body?.verifiedCustomers === 1 && s.body.payments === 2 && s.body.gross.baseUnits === '20000', s.body);
  const act = await api('GET', '/me/activity', tC);
  note(`C activity after streams: ${act.body.items.map((i: any) => `${i.kind}/${i.status}`).join(', ')}`);
}

const fn = { setup, noauth, main, guards, settled }[cmd];
if (!fn) {
  console.log('usage: api-contract.ts setup|noauth|main|guards|settled --api <base> --state <file>');
  process.exit(2);
}
await fn()
  .catch((e) => {
    fails++;
    console.log(`  FAIL (exception) ${e instanceof Error ? e.message : e}`);
  })
  .finally(() => {
    save();
    console.log(`\n${fails ? 'FAILED' : 'PASSED'}: ${passes} ok, ${fails} failed`);
    process.exitCode = fails ? 1 : 0;
  });
