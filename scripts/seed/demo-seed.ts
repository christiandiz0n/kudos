/**
 * Phase 5 demo seed: three live venues on the HOSTED api, driven exactly like the web app does it.
 * Each persona signs in (EIP-191 challenge, displayName) and signs only what the api hands it; the api's RELAYER
 * sends every tx. The plan (venues, personas, steps, expected splits) lives in `plan.ts` and is validated first.
 *
 *   pnpm --filter @vouch/scripts seed:demo -- [--api <url>] [--web-url <url>] [--max-deployer 16.00]
 *                                              [--settle-timeout 120] [--dry-run] [--summary-only]
 *
 * Idempotent + resumable (D-813): persona keys are generated once into scripts/seed/.state/keys.json (gitignored,
 * mode 0600) and progress goes to .state/state-<api host>.json after every step. Each step re-checks the chain first
 * (isSeedAmbassador, getLiveIntros, getCustomer, isOrderSettled), so a re-run sends nothing once everything is done.
 * Funding (D-812): payers are topped up just in time with the exact shortfall, first from seed-owned wallets'
 * surplus (venue revenue), then from DEPLOYER via the existing `topup` CLI (never /demo/topup).
 * Retries (D-814): transport errors, 429, 502/503/504 and `retryable` api errors back off and retry (an api
 * redeploy is ~1 min of 502/503); ambiguous POST outcomes are reconciled against the chain.
 * Never prints private keys or session tokens; never reads the root env file (the pnpm script loads it for
 * DEPLOYER_PRIVATE_KEY, used only by the topup child process).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, parseEventLogs, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_USDC_ADDRESS,
  LINK_TYPE,
  VOUCH_ARC_TESTNET,
  arcTestnet,
  explorerTxUrl,
  formatNativeAsUsdc,
  nativeToUsdcBaseUnits,
  vouchAbi,
} from '@vouch/shared';
import { PERSONAS, STEPS, VENUES, fmt, paySteps, personaOf, planFunding, simulatePlan, usd, venueOf, type PersonaKey, type Step, type VenueKey } from './plan';

// ------------------------------------------------------------------------------------------------ args
const argv = process.argv.slice(2).filter((a) => a !== '--');
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
};
const API = arg('api', process.env.SEED_API_URL || 'https://api-production-902bc54c.up.railway.app').replace(/\/$/, '');
const WEB_URL = arg('web-url', process.env.SEED_WEB_URL || 'https://vouch-ubc.vercel.app').replace(/\/$/, '');
const MAX_DEPLOYER = usd(arg('max-deployer', '16.00'));
const SETTLE_TIMEOUT_S = Number(arg('settle-timeout', '120'));
const DRY = argv.includes('--dry-run');
const SUMMARY_ONLY = argv.includes('--summary-only');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const STATE_DIR = path.join(HERE, '.state');
const KEYS_FILE = path.join(STATE_DIR, 'keys.json');
const STATE_FILE = path.join(STATE_DIR, `state-${new URL(API).host.replace(/[^a-z0-9.-]/gi, '_')}.json`);
const OUT_DIR = path.join(REPO, 'docs/evidence/phase-5/seed');

const rpcUrl = process.env.ARC_RPC_URL || ARC_TESTNET_RPC_URL;
const pub = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { retryCount: 5, retryDelay: 800 }) });
const VOUCH = VOUCH_ARC_TESTNET.address as Address;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(...a);
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ------------------------------------------------------------------------------------------------ state (gitignored)
type Json = any;
interface TxRec { label: string; hash: Hex; kind: string; feeNative?: string }
interface PayRec { orderId?: Hex; intentId?: string; relayId?: string; txHash?: Hex; done?: boolean; settled?: Json; quote?: Json; recovered?: boolean }
interface State {
  version: 1;
  api: string;
  venues: Partial<Record<VenueKey, { address: Address; slug?: string; relayId?: string; txHash?: Hex }>>;
  links: Record<string, { code: string; url: string; introHash?: Hex }>;
  opens: Record<string, number>;
  relays: Record<string, { relayId: string; txHash?: Hex }>;
  done: Record<string, { at: string; txHash?: Hex; note?: string }>;
  pays: Record<string, PayRec>;
  txs: TxRec[];
  funding: { to: PersonaKey; from: string; amount: string; hash?: Hex; feeNative?: string }[];
  canonical?: Json;
  tokens: Partial<Record<PersonaKey, { token: string; expiresAt: string }>>;
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

function loadKeys(): Record<PersonaKey, PrivateKeyAccount> {
  const raw: Record<string, Hex> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')).keys : {};
  let added = false;
  for (const p of PERSONAS) {
    if (!raw[p.key]) {
      raw[p.key] = generatePrivateKey();
      added = true;
    }
  }
  if (added) writeAtomic(KEYS_FILE, JSON.stringify({ version: 1, note: 'demo seed persona keys (testnet only, never commit)', keys: raw }, null, 2));
  const out = {} as Record<PersonaKey, PrivateKeyAccount>;
  for (const p of PERSONAS) out[p.key] = privateKeyToAccount(raw[p.key]!);
  return out;
}
const ACC = loadKeys();
const NAME = new Map<string, string>(PERSONAS.map((p) => [ACC[p.key].address.toLowerCase(), p.displayName]));
const who = (a?: string | null) => (a ? (NAME.get(a.toLowerCase()) ?? a) : '—');

const state: State = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { version: 1, api: API, venues: {}, links: {}, opens: {}, relays: {}, done: {}, pays: {}, txs: [], funding: [], tokens: {} };
const save = () => writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));

// ------------------------------------------------------------------------------------------------ http with retries
class ApiErr extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Json, msg: string) {
    super(msg);
  }
}
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const RETRY_BUDGET_MS = 30 * 60_000;
let lastSpend = 0;
const SPEND_GAP_MS = 3_200; // ≤ ~19 spend-class calls/min from this IP (D-809: 20/min)
const SPEND = [/^POST \/venues\/prepare$/, /^POST \/venues$/, /^POST \/venues\/[^/]+\/actions\/[^/]+$/, /^POST \/intros\/[^/]+\/accept$/, /^POST \/payments$/];

async function http1(method: string, p: string, token?: string, body?: unknown): Promise<{ status: number; body: Json; retryAfter?: number }> {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not json (e.g. an edge 502 page) */
  }
  const ra = Number(res.headers.get('retry-after'));
  return { status: res.status, body: parsed, ...(Number.isFinite(ra) && ra > 0 ? { retryAfter: ra } : {}) };
}

/** One api call; retries transient failures with backoff; throws ApiErr for anything else outside `expect`. */
async function call(method: string, p: string, token?: string, body?: unknown, expect: number[] = [200, 201, 202]): Promise<Json> {
  const t0 = Date.now();
  let delay = 2_000;
  const spend = SPEND.some((re) => re.test(`${method} ${p}`));
  for (let attempt = 1; ; attempt++) {
    if (spend) {
      const wait = lastSpend + SPEND_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastSpend = Date.now();
    }
    let r: Awaited<ReturnType<typeof http1>> | null = null;
    let why = '';
    try {
      r = await http1(method, p, token, body);
    } catch (e) {
      why = `transport: ${(e as Error).message.split('\n')[0]}`;
    }
    if (r && expect.includes(r.status)) return r.body;
    const code: string = r?.body?.error?.code ?? '';
    const retryable = !r || RETRY_STATUS.has(r.status) || (r.body?.error?.retryable === true && r.status >= 429);
    if (!retryable) throw new ApiErr(r!.status, code, r!.body, `${method} ${p} → ${r!.status} ${JSON.stringify(r!.body?.error ?? r!.body).slice(0, 300)}`);
    if (Date.now() - t0 > RETRY_BUDGET_MS) throw new Error(`${method} ${p}: still failing after ${RETRY_BUDGET_MS / 60_000} min (${why || r?.status + ' ' + code})`);
    const ms = Math.min(60_000, Math.max(delay, (r?.retryAfter ?? 0) * 1000));
    log(`    … ${method} ${p} ${why || `${r!.status} ${code || ''}`.trim()}; retry #${attempt} in ${(ms / 1000).toFixed(0)}s`);
    await sleep(ms);
    delay = Math.min(60_000, delay * 2);
  }
}

// ------------------------------------------------------------------------------------------------ auth + signing
async function signIn(k: PersonaKey): Promise<string> {
  const a = ACC[k];
  const ch = await call('POST', '/auth/challenge', undefined, { address: a.address });
  const signature = await a.signMessage({ message: ch.message });
  const r = await call('POST', '/auth/verify', undefined, { address: a.address, challengeId: ch.challengeId, signature, displayName: personaOf(k).displayName });
  state.tokens[k] = { token: r.token, expiresAt: r.expiresAt };
  save();
  return r.token;
}
async function tok(k: PersonaKey): Promise<string> {
  const t = state.tokens[k];
  if (t && Date.parse(t.expiresAt) - Date.now() > 3_600_000) return t.token;
  return signIn(k);
}
/** Authenticated call as persona `k`; a 401 (session gone, e.g. a fresh api db) signs in again once. */
async function as(k: PersonaKey, method: string, p: string, body?: unknown, expect?: number[]): Promise<Json> {
  try {
    return await call(method, p, await tok(k), body, expect);
  } catch (e) {
    if (e instanceof ApiErr && e.status === 401) {
      delete state.tokens[k];
      return call(method, p, await signIn(k), body, expect);
    }
    throw e;
  }
}
async function signTd(k: PersonaKey, td: Json): Promise<Hex> {
  const message: Record<string, unknown> = { ...td.message };
  for (const f of td.types[td.primaryType]) if (/^u?int\d*$/.test(f.type)) message[f.name] = BigInt(message[f.name] as string);
  return ACC[k].signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message } as never);
}

// ------------------------------------------------------------------------------------------------ chain reads (truth for idempotency)
const vread = <T>(functionName: string, args: unknown[]) => pub.readContract({ address: VOUCH, abi: vouchAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
const balanceOf = (a: Address) => pub.readContract({ address: ARC_TESTNET_USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const venueOwner = async (v: Address) => (await vread<{ owner: Address }>('getVenue', [v])).owner;
const isSeed = (v: Address, a: Address) => vread<boolean>('isSeedAmbassador', [v, a]);
const customerOf = (v: Address, a: Address) => vread<{ verified: boolean; rewarded: boolean; introducer: Address }>('getCustomer', [v, a]);
const liveIntros = (v: Address, a: Address) => vread<readonly { referrer: Address; linkType: number }[]>('getLiveIntros', [v, a]);
const orderSettled = (v: Address, id: Hex) => vread<boolean>('isOrderSettled', [v, id]);
const addrOf = (k: VenueKey) => {
  const a = state.venues[k]?.address;
  if (!a) throw new Error(`venue ${k} not registered yet`);
  return a;
};

async function recordTx(label: string, kind: string, hash: Hex) {
  if (state.txs.some((t) => t.hash === hash)) return;
  let feeNative: string | undefined;
  try {
    const r = await pub.getTransactionReceipt({ hash });
    feeNative = (r.gasUsed * r.effectiveGasPrice).toString();
  } catch {
    /* receipt later in summary */
  }
  state.txs.push({ label, hash, kind, ...(feeNative ? { feeNative } : {}) });
  save();
  log(`  ✓ ${label.padEnd(44)} ${explorerTxUrl(hash)}`);
}

class RelayFailed extends Error {}
async function waitRelay(k: PersonaKey, relayId: string): Promise<Hex> {
  const t0 = Date.now();
  for (;;) {
    const r = await as(k, 'GET', `/relay/${relayId}`, undefined, [200]);
    if (r.status === 'mined') return r.txHash;
    if (r.status === 'failed' || r.status === 'reverted') throw new RelayFailed(`relay ${relayId} ${r.status} ${r.errorCode ?? ''} ${r.txHash ?? ''}`);
    if (Date.now() - t0 > 240_000) throw new Error(`relay ${relayId} not mined after 240 s (${r.status})`);
    await sleep(900);
  }
}

// ------------------------------------------------------------------------------------------------ funding (D-812)
const OWNERS = VENUES.map((v) => v.owner);
const deployerSpent = () => state.funding.filter((f) => f.from === 'DEPLOYER').reduce((a, f) => a + BigInt(f.amount), 0n);

async function ownerTransfer(from: PersonaKey, to: PersonaKey, amount: bigint) {
  const est = await pub.estimateFeesPerGas();
  const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const w = createWalletClient({ account: ACC[from], chain: arcTestnet, transport: http(rpcUrl) });
  const hash = await w.writeContract({
    address: ARC_TESTNET_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [ACC[to].address, amount],
    maxFeePerGas,
    maxPriorityFeePerGas: est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas,
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success') throw new Error(`funding transfer reverted ${hash}`);
  state.funding.push({ to, from, amount: amount.toString(), hash, feeNative: (r.gasUsed * r.effectiveGasPrice).toString() });
  save();
  log(`  ✓ fund ${personaOf(to).displayName} +$${fmt(amount)} from ${personaOf(from).displayName}'s revenue  ${explorerTxUrl(hash)}`);
}

function deployerTopup(to: PersonaKey, target: bigint, send: bigint) {
  if (deployerSpent() + send > MAX_DEPLOYER) throw new Error(`DEPLOYER cap: $${fmt(deployerSpent())} used + $${fmt(send)} > --max-deployer $${fmt(MAX_DEPLOYER)} (stopping; nothing sent for this step)`);
  const r = spawnSync('pnpm', ['--silent', '--filter', '@vouch/scripts', 'topup', '--', '--to', ACC[to].address, '--target', fmt(target), '--max-total', fmt(send + usd('0.05'))], {
    cwd: REPO,
    encoding: 'utf8',
    env: process.env,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const hash = /tx \S+\s+(0x[0-9a-fA-F]{64})\s+status=success/.exec(out)?.[1] as Hex | undefined;
  if (r.status !== 0 || (!hash && !/nothing to do/.test(out))) {
    throw new Error(`topup CLI failed (exit ${r.status}):\n${out.split('\n').filter((l) => /ERROR|ABORT|deployer/.test(l)).join('\n')}`);
  }
  if (hash) {
    state.funding.push({ to, from: 'DEPLOYER', amount: send.toString(), hash });
    save();
    log(`  ✓ fund ${personaOf(to).displayName} +$${fmt(send)} from DEPLOYER (topup CLI)  ${explorerTxUrl(hash)}`);
  }
}

/** Make sure `k` can pay `amount` right now: exact shortfall, donors' surplus first, then the deployer. */
async function ensureFunds(k: PersonaKey, amount: bigint) {
  const bal = await balanceOf(ACC[k].address);
  if (bal >= amount) return;
  const need = amount - bal;
  const donors = await Promise.all(
    OWNERS.filter((o) => o !== k).map(async (o) => ({ key: o, balance: await balanceOf(ACC[o].address), reserved: 0n })),
  );
  const plan = planFunding(need, donors);
  for (const t of plan.fromDonors) await ownerTransfer(t.from, k, t.amount);
  if (plan.fromDeployer > 0n) deployerTopup(k, amount, plan.fromDeployer);
  const after = await balanceOf(ACC[k].address);
  if (after < amount) throw new Error(`${personaOf(k).displayName} still short after funding ($${fmt(after)} < $${fmt(amount)})`);
}

// ------------------------------------------------------------------------------------------------ steps
async function stepRegister(s: Extract<Step, { kind: 'register' }>): Promise<Hex | undefined> {
  const v = venueOf(s.venue);
  const owner = v.owner;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const cur = state.venues[s.venue];
    if (cur?.address) {
      if (same(await venueOwner(cur.address), ACC[owner].address)) {
        if (!cur.txHash) {
          const meta = await call('GET', `/venues/${cur.address}`, undefined, undefined, [200, 404]).catch(() => null);
          if (meta?.txHash) cur.txHash = meta.txHash;
        }
        return cur.txHash;
      }
      if (cur.relayId) {
        try {
          const h = await waitRelay(owner, cur.relayId);
          cur.txHash = h;
          save();
          await sleep(1500);
          continue;
        } catch (e) {
          log(`    registration relay did not land (${(e as Error).message}); preparing again`);
        }
      }
      delete state.venues[s.venue];
      save();
    }
    const prep = await as(owner, 'POST', '/venues/prepare', { name: v.name, description: v.description, rewardBps: v.rewardBps, minOrder: v.minOrder.toString() });
    state.venues[s.venue] = { address: getAddress(prep.venue), slug: prep.slug };
    save();
    log(`  venue ${v.name} → ${prep.venue} (slug ${prep.slug})`);
    try {
      const r = await as(owner, 'POST', '/venues', { venue: prep.venue, signature: await signTd(owner, prep.typedData) });
      state.venues[s.venue]!.relayId = r.relayId;
      save();
      const h = await waitRelay(owner, r.relayId);
      state.venues[s.venue]!.txHash = h;
      save();
      await recordTx(`registerVenue ${v.name}`, 'registerVenue', h);
      return h;
    } catch (e) {
      if (e instanceof ApiErr && ['VENUE_EXISTS', 'OWNER_ACTION_PENDING'].includes(e.code)) {
        await sleep(4000);
        continue;
      }
      if (e instanceof ApiErr && ['OWNER_NONCE_STALE', 'SIGNATURE_EXPIRED'].includes(e.code)) {
        delete state.venues[s.venue];
        continue;
      }
      if (e instanceof RelayFailed) continue;
      throw e;
    }
  }
  throw new Error(`${s.id}: gave up after 4 attempts`);
}

async function stepSeed(s: Extract<Step, { kind: 'seed' }>): Promise<Hex | undefined> {
  const venue = addrOf(s.venue);
  const owner = venueOf(s.venue).owner;
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (await isSeed(venue, ACC[s.who].address)) return state.relays[s.id]?.txHash;
    const prev = state.relays[s.id];
    if (prev && !prev.txHash) {
      try {
        prev.txHash = await waitRelay(owner, prev.relayId);
        save();
        await recordTx(`setSeedAmbassador ${personaOf(s.who).displayName} @ ${venueOf(s.venue).name}`, 'setSeedAmbassador', prev.txHash);
        continue;
      } catch {
        delete state.relays[s.id];
      }
    }
    try {
      const a = await as(owner, 'POST', `/venues/${venue}/actions`, { kind: 'setSeedAmbassador', ambassador: ACC[s.who].address, allowed: true });
      const r = await as(owner, 'POST', `/venues/${venue}/actions/${a.actionId}`, { signature: await signTd(owner, a.typedData) });
      state.relays[s.id] = { relayId: r.relayId };
      save();
      const h = await waitRelay(owner, r.relayId);
      state.relays[s.id]!.txHash = h;
      save();
      await recordTx(`setSeedAmbassador ${personaOf(s.who).displayName} @ ${venueOf(s.venue).name}`, 'setSeedAmbassador', h);
    } catch (e) {
      if (e instanceof ApiErr && ['OWNER_ACTION_PENDING', 'OWNER_NONCE_STALE', 'SIGNATURE_EXPIRED'].includes(e.code)) {
        await sleep(4000);
        continue;
      }
      if (e instanceof RelayFailed) continue;
      throw e;
    }
  }
  if (await isSeed(venue, ACC[s.who].address)) return state.relays[s.id]?.txHash;
  throw new Error(`${s.id}: gave up`);
}

async function ensureLink(s: Extract<Step, { kind: 'accept' }>, venue: Address): Promise<string> {
  const cur = state.links[s.link];
  if (cur) {
    const l = await call('GET', `/intros/${cur.code}`, undefined, undefined, [200, 404]);
    if (l?.status === 'active') return cur.code;
    log(`    link ${s.link} is ${l?.status ?? 'gone'}; issuing a new one`);
    delete state.links[s.link];
  }
  const prep = await as(s.referrer, 'POST', '/intros/prepare', { venue, linkType: s.linkType });
  const c = await as(s.referrer, 'POST', '/intros', { intro: prep.typedData.message, signature: await signTd(s.referrer, prep.typedData) }, [200, 201]);
  state.links[s.link] = { code: c.code, url: c.url, introHash: c.introHash };
  save();
  log(`  · ${personaOf(s.referrer).displayName} shares a ${s.linkType} link (${s.link})`);
  return c.code;
}

async function stepAccept(s: Extract<Step, { kind: 'accept' }>): Promise<Hex | undefined | 'skip'> {
  const venue = addrOf(s.venue);
  const c = ACC[s.customer].address;
  const label = `acceptIntro ${personaOf(s.referrer).displayName}→${personaOf(s.customer).displayName} @ ${venueOf(s.venue).name} (${s.linkType}, ${s.opens} opens)`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    if ((await liveIntros(venue, c)).some((li) => same(li.referrer, ACC[s.referrer].address))) return state.relays[s.id]?.txHash;
    if ((await customerOf(venue, c)).verified) return 'skip';
    const prev = state.relays[s.id];
    if (prev && !prev.txHash) {
      try {
        prev.txHash = await waitRelay(s.customer, prev.relayId);
        save();
        await recordTx(label, 'acceptIntro', prev.txHash);
        await sleep(1200);
        continue;
      } catch {
        delete state.relays[s.id];
      }
    }
    const code = await ensureLink(s, venue);
    const ok = `${s.id}@${code}`;
    for (let i = state.opens[ok] ?? 0; i < s.opens; i++) {
      await as(s.customer, 'POST', `/intros/${code}/opens`, {});
      state.opens[ok] = i + 1;
      save();
    }
    try {
      const prep = await as(s.customer, 'POST', `/intros/${code}/accept/prepare`, {});
      const r = await as(s.customer, 'POST', `/intros/${code}/accept`, { acceptance: prep.acceptance, signature: await signTd(s.customer, prep.typedData) });
      state.relays[s.id] = { relayId: r.relayId };
      save();
      const h = await waitRelay(s.customer, r.relayId);
      state.relays[s.id]!.txHash = h;
      save();
      await recordTx(label, 'acceptIntro', h);
      return h;
    } catch (e) {
      if (e instanceof ApiErr && ['INTRO_EXPIRED', 'LINK_NEEDS_REISSUE'].includes(e.code)) {
        delete state.links[s.link];
        continue;
      }
      if (e instanceof ApiErr && ['INTRO_ALREADY_USED', 'ALREADY_REWARDED', 'SIGNATURE_EXPIRED'].includes(e.code)) {
        await sleep(2000);
        continue; // re-check the chain
      }
      if (e instanceof RelayFailed) continue;
      throw e;
    }
  }
  throw new Error(`${s.id}: gave up`);
}

const simulated = simulatePlan();
const expectedOf = (id: string) => simulated.payments.find((p) => p.step.id === id)!;

function checkQuote(s: Extract<Step, { kind: 'pay' }>, q: Json) {
  const exp = expectedOf(s.id);
  const firstPurchase = !!q.quote.firstPurchase;
  const rewarded = !!q.quote.rewarded;
  const problems: string[] = [];
  if (firstPurchase !== exp.firstPurchase) problems.push(`firstPurchase ${firstPurchase} (expected ${exp.firstPurchase})`);
  if (rewarded !== exp.rewarded) problems.push(`rewarded ${rewarded} (expected ${exp.rewarded})`);
  // quote.rewards also lists the cashback line and L2 shares returned to the venue (no recipient): compare paid L1/L2 only
  const paidLine = (r: Json) => r.role !== 'cashback' && r.recipient && !/^0x0{40}$/i.test(r.recipient);
  const gotLines = (q.quote.rewards as Json[]).filter(paidLine).map((r) => `${r.role}:${who(r.recipient)}:${r.amount.baseUnits}`);
  const expLines = exp.split.lines.filter((l) => l.role !== 'cashback').map((l) => `${l.role}:${personaOf(l.recipient).displayName}:${l.amount}`);
  const exact = JSON.stringify(gotLines) === JSON.stringify(expLines) && q.quote.venueAmount.baseUnits === exp.split.venueAmount.toString() && BigInt(q.quote.cashback.baseUnits) === (exp.split.lines.find((l) => l.role === 'cashback')?.amount ?? 0n);
  if (s.canonical) {
    if (JSON.stringify(q.attribution?.bps) !== '[7000,3000]' || !same(q.attribution?.referrers?.[0], ACC.ana.address) || !same(q.attribution?.referrers?.[1], ACC.priya.address))
      problems.push(`canonical weights ${JSON.stringify(q.attribution?.bps)} ${(q.attribution?.referrers ?? []).map(who).join('/')} (expected Ana/Priya 7000/3000)`);
    if (!exact) problems.push(`canonical quote ${q.quote.venueAmount.baseUnits} ${gotLines.join(' ')} ≠ ${exp.split.venueAmount} ${expLines.join(' ')}`);
    if (q.paymentAuth.submitter && !same(q.paymentAuth.submitter, rsAddress)) problems.push('PaymentAuth.submitter is not the relayer');
  }
  return { problems, exact, gotLines, expLines };
}

let rsAddress: Address = '0x0000000000000000000000000000000000000000';

async function stepPay(s: Extract<Step, { kind: 'pay' }>): Promise<Hex | undefined> {
  const venue = addrOf(s.venue);
  const owner = venueOf(s.venue).owner;
  const c = ACC[s.customer].address;
  const name = personaOf(s.customer).displayName;
  const label = `pay ${name} $${fmt(s.amount)} @ ${venueOf(s.venue).name}${s.canonical ? ' (CANONICAL)' : s.expect === 'repeat' ? ' (repeat)' : s.expect === 'below_min' ? ' (below minimum)' : ''}`;
  const rec: PayRec = (state.pays[s.id] ??= {});
  for (let attempt = 1; attempt <= 5; attempt++) {
    // 1) reconcile a previous attempt against the chain
    if (rec.orderId) {
      if (await orderSettled(venue, rec.orderId)) {
        if (!rec.txHash && rec.intentId) rec.txHash = (await as(s.customer, 'GET', `/payments/${rec.intentId}`, undefined, [200])).txHash ?? undefined;
        save();
        if (rec.txHash) await recordTx(label, 'pay', rec.txHash);
        return rec.txHash;
      }
      if (rec.relayId) {
        try {
          rec.txHash = await waitRelay(s.customer, rec.relayId);
          save();
          continue; // settled check above
        } catch {
          /* failed: new order below */
        }
      }
      delete rec.orderId;
      delete rec.intentId;
      delete rec.relayId;
      delete rec.txHash;
      save();
    }
    // 2) a first purchase that already happened without a record (lost state): never pay twice
    if (s.expect !== 'repeat' && (await customerOf(venue, c)).verified) {
      rec.recovered = true;
      save();
      log(`  ! ${s.id}: ${name} is already verified at ${venueOf(s.venue).name}; recorded as done (no tx hash)`);
      return undefined;
    }
    // 3) funds, order, quote, sign, pay
    await ensureFunds(s.customer, s.amount);
    const o = await as(owner, 'POST', `/venues/${venue}/orders`, { amount: s.amount.toString(), ttlSeconds: 600, label: s.label });
    rec.orderId = o.order.orderId;
    save();
    const q = await as(s.customer, 'POST', '/payments/quote', { venue, orderId: rec.orderId });
    const chk = checkQuote(s, q);
    rec.quote = { bps: q.attribution?.bps ?? [], referrers: (q.attribution?.referrers ?? []).map(who), venueAmount: q.quote.venueAmount.baseUnits, cashback: q.quote.cashback.baseUnits, rewards: chk.gotLines, warnings: q.warnings, matchesPlan: chk.exact };
    save();
    if (chk.problems.length) {
      if (s.canonical) throw new Error(`CANONICAL QUOTE MISMATCH, not paying: ${chk.problems.join('; ')}`);
      log(`    ! quote differs from the plan: ${chk.problems.join('; ')}`);
    } else if (!chk.exact) log(`    · quote ${chk.gotLines.join(' ')} (plan ${chk.expLines.join(' ')}; recency decay)`);
    log(`    quote: $${q.quote.amount.display} · back $${q.quote.cashback.display} · ${q.attribution ? `${(q.attribution.referrers ?? []).map(who).join('/') || 'no referrer'} ${(q.attribution.bps ?? []).join('/')}` : 'repeat (no attribution)'}${q.warnings?.length ? ` · ${q.warnings.join(',')}` : ''}`);
    rec.intentId = q.intentId;
    save();
    try {
      const p = await as(s.customer, 'POST', '/payments', { intentId: q.intentId, signature: await signTd(s.customer, q.typedData) });
      rec.relayId = p.relayId;
      rec.txHash = p.txHash;
      save();
      rec.txHash = await waitRelay(s.customer, p.relayId);
      save();
      await recordTx(label, 'pay', rec.txHash);
      return rec.txHash;
    } catch (e) {
      if (e instanceof ApiErr && ['PAYMENT_ALREADY_USED', 'ORDER_ALREADY_PAID'].includes(e.code)) {
        const st = await as(s.customer, 'GET', `/payments/${q.intentId}`, undefined, [200]);
        if (st.txHash) rec.txHash = st.txHash;
        save();
        await sleep(2000);
        continue;
      }
      if (e instanceof ApiErr && ['INSUFFICIENT_BALANCE', 'ORDER_EXPIRED', 'PAYMENT_EXPIRED'].includes(e.code)) continue;
      if (e instanceof RelayFailed) continue;
      throw e;
    }
  }
  throw new Error(`${s.id}: gave up`);
}

async function waitSettled(s: Extract<Step, { kind: 'pay' }>, timeoutS: number): Promise<boolean> {
  const rec = state.pays[s.id];
  if (!rec?.intentId || rec.recovered) return false;
  if (rec.settled) return true;
  const t0 = Date.now();
  for (;;) {
    const st = await as(s.customer, 'GET', `/payments/${rec.intentId}`, undefined, [200]);
    if (st.status === 'settled') {
      rec.settled = {
        afterSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
        blockNumber: st.settled.blockNumber,
        venueAmount: st.settled.venueAmount.baseUnits,
        weightsMode: st.settled.weightsMode,
        lines: st.settled.lines.map((l: Json) => `${l.role}:${who(l.recipient)}:${l.amount.baseUnits}`),
      };
      save();
      return true;
    }
    if (Date.now() - t0 > timeoutS * 1000) return false;
    await sleep(1000);
  }
}

// ------------------------------------------------------------------------------------------------ canonical on-chain check
async function verifyCanonical(hash: Hex) {
  const r = await pub.getTransactionReceipt({ hash });
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: r.logs }).filter((l) => same(l.address, ARC_TESTNET_USDC_ADDRESS));
  const vouchLogs = parseEventLogs({ abi: vouchAbi, logs: r.logs }).filter((l) => same(l.address, VOUCH));
  const settled = vouchLogs.find((l) => l.eventName === 'PaymentSettled') as Json;
  const paid = vouchLogs.filter((l) => l.eventName === 'RewardPaid') as Json[];
  const lena = VENUES.find((v) => v.key === 'cafe')!.owner;
  const T = transfers.map((t) => ({ from: same(t.args.from, VOUCH) ? 'Vouch' : who(t.args.from), to: same(t.args.to, VOUCH) ? 'Vouch' : who(t.args.to), value: t.args.value.toString() }));
  const expectedOut = [
    [personaOf(lena).displayName, '10200000'],
    ['Ben', '450000'],
    ['Ana', '693000'],
    ['Priya', '297000'],
    ['Marco', '252000'],
    ['Sofia', '108000'],
  ];
  const out = T.filter((t) => t.from === 'Vouch');
  const inn = T.filter((t) => t.to === 'Vouch');
  const outSorted = (xs: { to: string; value: string }[]) => xs.map((x) => `${x.to}:${x.value}`).sort();
  const checks = {
    sentByRelayer: same(r.from, rsAddress),
    status: r.status,
    pullBenToVouch12: inn.length === 1 && inn[0]!.from === 'Ben' && inn[0]!.value === '12000000',
    transfersOutExact: JSON.stringify(outSorted(out)) === JSON.stringify(expectedOut.map(([a, b]) => `${a}:${b}`).sort()),
    sumOutEqualsAmount: out.reduce((a, t) => a + BigInt(t.value), 0n) === 12_000_000n,
    paymentSettledVenueAmount: settled?.args?.venueAmount?.toString() === '10200000',
    weightsModeAttributor: settled?.args?.weightsMode === 1,
    rewardPaid: paid.map((l) => `${['C', 'L1', 'L2'][l.args.role]}:${who(l.args.recipient)}:${l.args.amount}`),
  };
  const ok = checks.sentByRelayer && checks.status === 'success' && checks.pullBenToVouch12 && checks.transfersOutExact && checks.sumOutEqualsAmount && checks.paymentSettledVenueAmount && checks.weightsModeAttributor;
  state.canonical = { txHash: hash, blockNumber: r.blockNumber.toString(), ok, transfers: T, checks };
  save();
  log(`  ${ok ? '✓' : '✗'} canonical on-chain split (USDC Transfer logs): ${out.map((t) => `${t.to} ${fmt(BigInt(t.value))}`).join(' · ')}`);
  if (!ok) throw new Error(`CANONICAL SPLIT CHECK FAILED: ${JSON.stringify(checks)}`);
}

// ------------------------------------------------------------------------------------------------ summary
async function summary() {
  log('\n[summary] hosted reads (settled via Streams)');
  const venues = [];
  for (const v of VENUES) {
    const a = state.venues[v.key]?.address;
    if (!a) continue;
    const want = paySteps().filter((p) => p.venue === v.key && state.done[p.id]).length;
    let stats: Json = null;
    let feed: Json = null;
    const t0 = Date.now();
    for (;;) {
      stats = await call('GET', `/venues/${a}/stats`, undefined, undefined, [200, 404]);
      feed = await call('GET', `/venues/${a}/payments?limit=50`, undefined, undefined, [200, 404]);
      if ((feed?.payments?.length ?? 0) >= want || Date.now() - t0 > SETTLE_TIMEOUT_S * 1000) break;
      await sleep(2000);
    }
    const meta = await call('GET', `/venues/${a}`, undefined, undefined, [200, 404]);
    const ours = new Set(paySteps().map((p) => state.pays[p.id]?.txHash?.toLowerCase()).filter(Boolean));
    venues.push({
      key: v.key,
      name: v.name,
      address: a,
      owner: { name: personaOf(v.owner).displayName, address: ACC[v.owner].address },
      rewardBps: v.rewardBps,
      minOrder: fmt(v.minOrder),
      dashboardUrl: `${WEB_URL}/venue/${a}`,
      registerTx: state.venues[v.key]?.txHash ?? meta?.txHash ?? null,
      seeds: (meta?.onchain?.seeds ?? []).map(who),
      stats: stats
        ? {
            verifiedCustomers: stats.verifiedCustomers,
            rewardedPurchases: stats.rewardedPurchases,
            payments: stats.payments,
            gross: stats.gross?.display,
            rewardsPaid: stats.rewardsPaid?.display,
            rewardsReturned: stats.rewardsReturned?.display,
            venueReceived: stats.venueReceived?.display,
            byRole: stats.byRole ? Object.fromEntries(Object.entries(stats.byRole).map(([k, m]) => [k, (m as Json).display])) : null,
            costPerVerifiedCustomer: stats.costPerVerifiedCustomer?.display ?? null,
            edges: stats.edges?.length ?? 0,
            edgesSample: (stats.edges ?? []).slice(0, 40).map((e: Json) => `L${e.level} ${e.fromDisplayName ?? who(e.from)}→${e.toDisplayName ?? who(e.to)} ${e.amount.display}`),
          }
        : null,
      feed: {
        count: feed?.payments?.length ?? 0,
        seedPaymentsSettled: (feed?.payments ?? []).filter((p: Json) => ours.has(p.txHash?.toLowerCase())).length,
        seedPaymentsPlanned: want,
        items: (feed?.payments ?? []).map((p: Json) => ({
          customer: p.customer?.displayName ?? who(p.customer?.address),
          amount: p.amount?.display,
          venueReceived: p.venueReceived?.display,
          cashback: p.cashback?.display,
          rewards: (p.rewards ?? []).map((r: Json) => `L${r.level} ${r.recipient?.displayName ?? who(r.recipient?.address)} ${r.amount?.display}`),
          rewardsReturned: p.rewardsReturned?.display,
          firstPurchase: p.firstPurchase,
          rewarded: p.rewarded,
          settledAt: p.settledAt,
          txHash: p.txHash,
        })),
      },
    });
    log(`  ${v.name.padEnd(12)} verified ${stats?.verifiedCustomers ?? '?'} · payments ${stats?.payments ?? '?'} · gross $${stats?.gross?.display ?? '?'} · rewards $${stats?.rewardsPaid?.display ?? '?'} · edges ${stats?.edges?.length ?? 0} · feed ${feed?.payments?.length ?? 0}/${want}`);
  }
  // spend
  for (const t of state.txs) {
    if (!t.feeNative) {
      try {
        const r = await pub.getTransactionReceipt({ hash: t.hash });
        t.feeNative = (r.gasUsed * r.effectiveGasPrice).toString();
      } catch {
        /* leave unknown */
      }
    }
  }
  save();
  const relayerGasNative = state.txs.reduce((a, t) => a + BigInt(t.feeNative ?? '0'), 0n);
  const volume = paySteps().filter((p) => state.done[p.id] && !state.pays[p.id]?.recovered).reduce((a, p) => a + p.amount, 0n);
  const fromDeployer = deployerSpent();
  const recycled = state.funding.filter((f) => f.from !== 'DEPLOYER').reduce((a, f) => a + BigInt(f.amount), 0n);
  const recycleGas = state.funding.reduce((a, f) => a + BigInt(f.feeNative ?? '0'), 0n);
  const personas = await Promise.all(
    PERSONAS.map(async (p) => ({ key: p.key, name: p.displayName, address: ACC[p.key].address, role: p.blurb, balance: fmt(await balanceOf(ACC[p.key].address)) })),
  );
  const payments = paySteps().map((p) => {
    const r = state.pays[p.id] ?? {};
    return {
      id: p.id,
      venue: venueOf(p.venue).name,
      customer: personaOf(p.customer).displayName,
      amount: fmt(p.amount),
      label: p.label,
      expect: p.expect,
      canonical: !!p.canonical,
      txHash: r.txHash ?? null,
      quote: r.quote ?? null,
      settled: r.settled ?? null,
      done: !!state.done[p.id],
    };
  });
  const out = {
    generatedAt: new Date().toISOString(),
    api: API,
    webUrl: WEB_URL,
    chain: { id: arcTestnet.id, vouch: VOUCH, usdc: ARC_TESTNET_USDC_ADDRESS },
    complete: STEPS.every((s) => state.done[s.id]),
    venues,
    personas,
    canonical: state.canonical ?? null,
    payments,
    transactions: state.txs.map((t) => ({ label: t.label, kind: t.kind, hash: t.hash, fee: t.feeNative ? formatNativeAsUsdc(BigInt(t.feeNative)) : null })),
    funding: state.funding.map((f) => ({ to: personaOf(f.to).displayName, from: f.from === 'DEPLOYER' ? 'DEPLOYER (topup CLI)' : personaOf(f.from as PersonaKey).displayName, amount: fmt(BigInt(f.amount)), hash: f.hash ?? null })),
    spend: {
      paymentVolume: fmt(volume),
      fundedFromDeployer: fmt(fromDeployer),
      recycledFromVenueRevenue: fmt(recycled),
      relayerGas: formatNativeAsUsdc(relayerGasNative),
      relayerGasUsdcBaseUnits: nativeToUsdcBaseUnits(relayerGasNative).toString(),
      relayedTxs: state.txs.length,
      fundingTransferGas: formatNativeAsUsdc(recycleGas),
    },
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'seed-summary.json'), JSON.stringify(out, null, 2) + '\n');
  writeFileSync(path.join(OUT_DIR, 'seed-summary.md'), renderMd(out));
  log(`  wrote docs/evidence/phase-5/seed/seed-summary.{json,md}`);
  log(`  spend: volume $${out.spend.paymentVolume} · deployer $${out.spend.fundedFromDeployer} · recycled $${out.spend.recycledFromVenueRevenue} · relayer gas $${out.spend.relayerGas} (${out.spend.relayedTxs} txs)`);
  return out;
}

function renderMd(o: Json): string {
  const L: string[] = [];
  L.push(`# Demo seed summary`, '', `_Generated ${o.generatedAt} by \`pnpm --filter @vouch/scripts seed:demo\` against ${o.api}. Complete: **${o.complete ? 'yes' : 'NO'}**._`, '');
  L.push(`Vouch \`${o.chain.vouch}\` on Arc Testnet (${o.chain.id}). Dashboards: replace \`<WEB_URL>\` with the deployed web origin if it is still a placeholder.`, '');
  L.push('## Venues', '', '| Venue | Rate | Min order | Owner | Address | Dashboard | Verified | Payments | Gross | Rewards paid | Cost / new customer | Edges |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const v of o.venues) {
    const s = v.stats ?? {};
    L.push(`| ${v.name} | ${v.rewardBps / 100}% | $${v.minOrder} | ${v.owner.name} | \`${v.address}\` | ${v.dashboardUrl} | ${s.verifiedCustomers ?? '?'} | ${s.payments ?? '?'} | $${s.gross ?? '?'} | $${s.rewardsPaid ?? '?'} | ${s.costPerVerifiedCustomer ? `$${s.costPerVerifiedCustomer}` : '—'} | ${s.edges ?? 0} |`);
  }
  L.push('', '## Personas', '', '| Name | Address | Role | Balance now |', '|---|---|---|---|');
  for (const p of o.personas) L.push(`| ${p.name} | \`${p.address}\` | ${p.role} | $${p.balance} |`);
  const c = o.canonical;
  L.push('', "## Canonical payment (Ben, $12.00 at Lena's café)", '');
  if (c) {
    L.push(`Tx \`${c.txHash}\` (block ${c.blockNumber}), checked from the receipt's USDC \`Transfer\` logs: **${c.ok ? 'EXACT' : 'MISMATCH'}**.`, '', '| From | To | Amount |', '|---|---|---|');
    for (const t of c.transfers) L.push(`| ${t.from} | ${t.to} | ${fmt(BigInt(t.value))} |`);
    L.push('', `RewardPaid: ${c.checks.rewardPaid.join(' · ')}. PaymentSettled venueAmount 10.20, weightsMode ${c.checks.weightsModeAttributor ? '1 (ATTRIBUTOR)' : '?'}; sent by the relayer: ${c.checks.sentByRelayer}.`);
  } else L.push('not run yet');
  L.push('', '## Payments', '', '| Venue | Customer | Amount | What | Kind | Weights | Settled (Streams) | Tx |', '|---|---|---|---|---|---|---|---|');
  for (const p of o.payments) {
    const w = p.quote?.referrers?.length ? `${p.quote.referrers.join('/')} ${p.quote.bps.join('/')}` : '—';
    L.push(`| ${p.venue} | ${p.customer} | $${p.amount} | ${p.label} | ${p.canonical ? '**canonical**' : p.expect} | ${w} | ${p.settled ? `yes (${p.settled.afterSeconds}s)` : p.done ? 'pending' : '—'} | ${p.txHash ? `\`${p.txHash}\`` : '—'} |`);
  }
  L.push('', '## Spend', '', `- Payment volume: $${o.spend.paymentVolume} (stays in demo wallets: venue revenue + rewards)`, `- Funded from DEPLOYER (topup CLI): $${o.spend.fundedFromDeployer}`, `- Recycled from seed venue revenue: $${o.spend.recycledFromVenueRevenue} (transfer gas $${o.spend.fundingTransferGas})`, `- Relayer gas: $${o.spend.relayerGas} for ${o.spend.relayedTxs} relayed txs`, '');
  L.push('## Funding transfers', '', '| To | From | Amount | Tx |', '|---|---|---|---|');
  for (const f of o.funding) L.push(`| ${f.to} | ${f.from} | $${f.amount} | ${f.hash ? `\`${f.hash}\`` : '—'} |`);
  L.push('', '## Relayed transactions', '', '| What | Tx | Gas |', '|---|---|---|');
  for (const t of o.transactions) L.push(`| ${t.label} | \`${t.hash}\` | ${t.fee ?? '?'} |`);
  for (const v of o.venues) {
    L.push('', `## ${v.name}: hosted feed (\`/venues/${v.address}/payments\`)`, '');
    for (const p of v.feed.items) L.push(`- ${p.customer} paid $${p.amount} → venue $${p.venueReceived}${p.cashback && p.cashback !== '0.00' ? `, back $${p.cashback}` : ''}${p.rewards.length ? `; ${p.rewards.join(', ')}` : ''}${p.rewardsReturned && p.rewardsReturned !== '0.00' ? `; returned $${p.rewardsReturned}` : ''}${p.firstPurchase ? '' : ' (repeat)'}`);
    L.push('', `Edges (\`/stats\`): ${(v.stats?.edgesSample ?? []).join(' · ')}`);
  }
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const sim = simulatePlan();
  if (sim.errors.length) throw new Error(`plan is invalid:\n  ${sim.errors.join('\n  ')}`);
  log(`seed:demo → ${API}  (Vouch ${VOUCH}; ${STEPS.length} steps, ${paySteps().length} payments, volume $${fmt(sim.volume)})`);
  log(`  state ${path.relative(REPO, STATE_FILE)} · ${Object.keys(state.done).length}/${STEPS.length} steps done`);
  if (DRY) {
    for (const p of sim.payments) log(`  ${p.step.id.padEnd(22)} $${fmt(p.step.amount).padStart(6)} ${p.step.expect.padEnd(9)} ${p.split.lines.map((l) => `${l.role[0]}:${l.recipient}:${fmt(l.amount)}`).join(' ')}`);
    for (const p of PERSONAS) log(`  ${p.displayName.padEnd(7)} ${ACC[p.key].address}`);
    return;
  }
  const rs = await call('GET', '/relayer/status', undefined, undefined, [200]);
  if (!rs.enabled) throw new Error('hosted relayer is disabled');
  rsAddress = getAddress(rs.address);
  log(`  relayer ${rs.address} · budget left $${rs.budget.hourly.remaining.display}/h · $${rs.budget.daily.remaining.display}/day`);
  if (!SUMMARY_ONLY) {
    let sent = 0;
    for (let i = 0; i < STEPS.length; i++) {
      const s = STEPS[i]!;
      if (state.done[s.id]) continue;
      sent++;
      log(`\n[${i + 1}/${STEPS.length}] ${s.id}`);
      let res: Hex | undefined | 'skip';
      if (s.kind === 'register') res = await stepRegister(s);
      else if (s.kind === 'seed') res = await stepSeed(s);
      else if (s.kind === 'accept') res = await stepAccept(s);
      else {
        res = await stepPay(s);
        if (s.canonical && res) await verifyCanonical(res);
        const settled = await waitSettled(s, 30);
        log(`    ${settled ? `settled via Streams after ${state.pays[s.id]!.settled.afterSeconds}s` : 'not settled yet (re-checked at the end)'}`);
      }
      state.done[s.id] = { at: new Date().toISOString(), ...(res && res !== 'skip' ? { txHash: res } : {}), ...(res === 'skip' ? { note: 'customer already verified' } : {}) };
      save();
    }
    if (!sent) log('  nothing to do: every step is already done (no-op)');
    for (const p of paySteps()) if (state.done[p.id] && !state.pays[p.id]?.settled) await waitSettled(p, SETTLE_TIMEOUT_S);
    const canon = paySteps().find((p) => p.canonical)!;
    if (!state.canonical && state.pays[canon.id]?.txHash) await verifyCanonical(state.pays[canon.id]!.txHash!);
  }
  const out = await summary();
  const unsettled = out.payments.filter((p: Json) => p.done && !p.settled).length;
  if (!out.complete) process.exit(1);
  if (!out.canonical?.ok) process.exit(1);
  log(unsettled ? `\nSEED OK on chain; ${unsettled} payment(s) not yet settled in the hosted api` : '\nSEED OK (on chain + settled via Streams on the hosted api)');
}

main().catch((e) => {
  console.error(`\nSEED STOPPED: ${e instanceof Error ? e.message : e}`);
  console.error('Progress is saved; re-run the same command to resume.');
  process.exit(1);
});
