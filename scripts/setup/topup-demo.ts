/**
 * Top up demo wallets with USDC from the funded DEPLOYER (Phase 0 tooling, D-401).
 *
 * Each target is brought UP TO `--target` dollars with an ERC-20 `transfer` on USDC (6-dec bigint
 * math, never floats). Wallets already at/above target are skipped. Sends are sequential (one tx,
 * wait for receipt, next) with explicit nonces.
 *
 * Units (D-102): ERC-20 amounts are 6-dec base units. Gas (gasUsed * effectiveGasPrice) is 18-dec
 * native. On Arc the native gas token IS the same USDC balance, so gas comes out of the deployer's
 * USDC and is counted against `--reserve`. On local anvil, gas is test ETH and is not counted.
 *
 * Env (loaded from the repo-root env file by the pnpm script, D-004):
 *   DEPLOYER_PRIVATE_KEY   sender (secret, never printed)
 *   ARC_RPC_URL            optional, defaults to the canonical Arc Testnet RPC (D-101)
 *   USDC_ADDRESS           optional on Arc (must equal 0x3600…); required on non-Arc chains (MockUSDC)
 *
 * Flags:
 *   --target <usd>         top each target up to this balance (default 5.00)
 *   --reserve <usd>        minimum the deployer must keep after sends + estimated gas (default 5.00)
 *   --max-total <usd>      abort if the planned total exceeds this (default 25.00)
 *   --only NAME[,NAME]     targets by wallets.public.json key (replaces the default set)
 *   --to 0xaddr[,0xaddr]   ad-hoc targets (replaces the default set; combinable with --only)
 *   --include-relayer      also top up RELAYER
 *   --dry-run              print the plan, send nothing
 *
 * Exit codes: 0 ok, 1 bad config/args, 2 safety abort (nothing sent), 3 send failure (partial run).
 *
 * Run: pnpm --filter @vouch/scripts topup [--dry-run] [--only DEMO_LENA --target 1.00]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_USDC_ADDRESS,
  arcTestnet,
  explorerAddressUrl,
  explorerTxUrl,
  formatNativeAsUsdc,
  formatUsdc,
  nativeToUsdcBaseUnits,
  parseUsdc,
} from '@vouch/shared';

const EXIT_CONFIG = 1;
const EXIT_SAFETY = 2;
const EXIT_SEND = 3;

const DEFAULT_TARGETS = ['DEMO_ANA', 'DEMO_BEN', 'DEMO_PRIYA', 'DEMO_LENA', 'SPIKE_USER'] as const;
/** Fallback gas limit if estimation fails (USDC transfer is ~35-60k). */
const FALLBACK_TRANSFER_GAS = 100_000n;
const RECEIPT_TIMEOUT_MS = 120_000;

function fail(code: number, msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

// ---------- args ----------
const argv = process.argv.slice(2).filter((a) => a !== '--');
let args;
try {
  args = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      target: { type: 'string', default: '5.00' },
      reserve: { type: 'string', default: '5.00' },
      'max-total': { type: 'string', default: '25.00' },
      only: { type: 'string', multiple: true },
      to: { type: 'string', multiple: true },
      'include-relayer': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }).values;
} catch (e) {
  fail(EXIT_CONFIG, (e as Error).message);
}
if (args.help) {
  console.log(
    'usage: topup [--target 5.00] [--reserve 5.00] [--max-total 25.00] [--only NAME[,NAME]] [--to 0xaddr] [--include-relayer] [--dry-run]',
  );
  process.exit(0);
}

function dollars(flag: string, raw: string): bigint {
  let v: bigint;
  try {
    v = parseUsdc(raw);
  } catch (e) {
    fail(EXIT_CONFIG, `--${flag}: ${(e as Error).message}`);
  }
  if (v < 0n) fail(EXIT_CONFIG, `--${flag} must be >= 0 (got ${raw})`);
  return v;
}
const target = dollars('target', args.target);
const reserve = dollars('reserve', args.reserve);
const maxTotal = dollars('max-total', args['max-total']);
const dryRun = args['dry-run'];

// ---------- wallets ----------
const walletsPath = new URL('../../packages/shared/src/wallets.public.json', import.meta.url);
const wallets = JSON.parse(readFileSync(walletsPath, 'utf8')) as Record<string, string>;

const splitList = (xs: string[] | undefined) =>
  (xs ?? []).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);

type Target = { name: string; address: Address };
const targets: Target[] = [];
const onlyNames = splitList(args.only).map((n) => n.toUpperCase());
const adHoc = splitList(args.to);
const names: string[] = onlyNames.length || adHoc.length ? onlyNames : [...DEFAULT_TARGETS];
if (args['include-relayer']) names.push('RELAYER');
for (const name of names) {
  const a = wallets[name];
  if (!a) fail(EXIT_CONFIG, `unknown wallet name "${name}" (known: ${Object.keys(wallets).join(', ')})`);
  targets.push({ name, address: getAddress(a) });
}
for (const a of adHoc) {
  if (!isAddress(a)) fail(EXIT_CONFIG, `--to: not an address: ${a}`);
  const addr = getAddress(a);
  const known = Object.entries(wallets).find(([, v]) => v.toLowerCase() === addr.toLowerCase());
  targets.push({ name: known ? known[0] : 'ad-hoc', address: addr });
}
// de-dupe by address, keep first occurrence
const seen = new Set<string>();
const uniqueTargets = targets.filter((t) => {
  const k = t.address.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
if (uniqueTargets.length === 0) fail(EXIT_CONFIG, 'no targets');

// ---------- chain ----------
const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) fail(EXIT_CONFIG, 'missing env DEPLOYER_PRIVATE_KEY');
let deployer;
try {
  deployer = privateKeyToAccount(pk as Hex);
} catch {
  fail(EXIT_CONFIG, 'DEPLOYER_PRIVATE_KEY is not a valid private key'); // never echo the value
}
for (const t of uniqueTargets) {
  if (t.address.toLowerCase() === deployer.address.toLowerCase()) fail(EXIT_CONFIG, `target ${t.name} is the deployer itself`);
}

const rpcUrl = process.env.ARC_RPC_URL || ARC_TESTNET_RPC_URL;
/** Never print a keyed RPC URL: only public/local hosts are shown by name. */
const rpcLabel = (() => {
  const u = new URL(rpcUrl);
  const publicHost = rpcUrl === ARC_TESTNET_RPC_URL || u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  return publicHost ? u.host : 'custom ARC_RPC_URL (redacted)';
})();
/** First line of an error message with the RPC URL redacted. */
const errLine = (e: unknown) => ((e as Error).message ?? String(e)).split('\n')[0]!.split(rpcUrl).join('<rpc>');
const probe = createPublicClient({ transport: http(rpcUrl) });
let chainId: number;
try {
  chainId = await probe.getChainId();
} catch (e) {
  fail(EXIT_CONFIG, `cannot reach RPC (${rpcLabel}): ${errLine(e)}`);
}
const isArc = chainId === ARC_TESTNET_CHAIN_ID;
const chain = isArc
  ? { ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } }
  : defineChain({
      id: chainId,
      name: `local-${chainId}`,
      nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });

let usdc: Address;
if (isArc) {
  usdc = ARC_TESTNET_USDC_ADDRESS;
  const envUsdc = process.env.USDC_ADDRESS;
  if (envUsdc && envUsdc.toLowerCase() !== usdc.toLowerCase()) {
    fail(EXIT_CONFIG, `USDC_ADDRESS ${envUsdc} != Arc USDC ${usdc}; refusing on Arc`);
  }
} else {
  const envUsdc = process.env.USDC_ADDRESS;
  if (!envUsdc || !isAddress(envUsdc)) fail(EXIT_CONFIG, `chain ${chainId} is not Arc: set USDC_ADDRESS (MockUSDC)`);
  usdc = getAddress(envUsdc);
}

const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, account: deployer, transport: http(rpcUrl) });

const decimals = await pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'decimals' });
if (decimals !== 6) fail(EXIT_CONFIG, `token ${usdc} has ${decimals} decimals, expected 6`);
const balanceOf = (a: Address) => pub.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });

/** EIP-1559 fees; maxFeePerGas never below Arc's 20 gwei floor (D-101). Applied on every chain. */
async function fees() {
  const est = await pub.estimateFeesPerGas();
  const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const maxPriorityFeePerGas = est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

// ---------- plan ----------
const deployerBefore = await balanceOf(deployer.address);
const deployerNativeBefore = await pub.getBalance({ address: deployer.address });
const befores = await Promise.all(uniqueTargets.map((t) => balanceOf(t.address)));
const plan = uniqueTargets.map((t, i) => {
  const before = befores[i]!;
  return { ...t, before, send: before >= target ? 0n : target - before };
});
const sends = plan.filter((p) => p.send > 0n);
const planTotal = sends.reduce((a, p) => a + p.send, 0n);

const feeCfg = await fees();
let gasUnits = 0n;
let gasEstimated = true;
if (planTotal <= deployerBefore) {
  for (const p of sends) {
    try {
      const g = await pub.estimateContractGas({
        account: deployer,
        address: usdc,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [p.address, p.send],
      });
      gasUnits += (g * 12n) / 10n; // +20% buffer
    } catch {
      gasUnits += FALLBACK_TRANSFER_GAS;
      gasEstimated = false;
    }
  }
} else {
  gasUnits = FALLBACK_TRANSFER_GAS * BigInt(sends.length);
  gasEstimated = false;
}
const gasBudgetNative = gasUnits * feeCfg.maxFeePerGas; // worst case, 18-dec
const gasBudgetUsdc = nativeToUsdcBaseUnits(gasBudgetNative); // 6-dec, rounded up
const gasCountsAgainstUsdc = isArc;
const projectedDeployer = deployerBefore - planTotal - (gasCountsAgainstUsdc ? gasBudgetUsdc : 0n);

const usd = (v: bigint) => formatUsdc(v);
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

console.log(`== Vouch demo top-up${dryRun ? ' (DRY RUN)' : ''}`);
console.log(`chain              ${chainId}${isArc ? ' (Arc Testnet)' : ' (local; gas is test ETH, not USDC)'}  rpc=${rpcLabel}`);
console.log(`token              ${usdc} (USDC, 6 dec)`);
console.log(`deployer           ${deployer.address}  balance=$${usd(deployerBefore)}`);
console.log(`target / reserve   $${usd(target)} each / keep >= $${usd(reserve)}   max-total=$${usd(maxTotal)}`);
console.log(
  `gas budget         ${gasUnits} gas x ${feeCfg.maxFeePerGas} wei (maxFeePerGas) = ${formatNativeAsUsdc(gasBudgetNative)} ${isArc ? 'USDC' : 'native'}${gasEstimated ? '' : ' (fallback estimate)'}`,
);
console.log('');
console.log(`${pad('name', 12)} ${pad('address', 42)} ${lpad('before', 10)} ${lpad('to send', 10)}`);
for (const p of plan) {
  console.log(`${pad(p.name, 12)} ${pad(p.address, 42)} ${lpad(usd(p.before), 10)} ${lpad(p.send ? usd(p.send) : 'skip', 10)}`);
}
console.log(`plan total         $${usd(planTotal)} in ${sends.length} transfer(s)`);
console.log(
  `deployer projected $${usd(projectedDeployer)} after sends${gasCountsAgainstUsdc ? ` and ~$${usd(gasBudgetUsdc)} gas` : ''} (reserve $${usd(reserve)})`,
);

// ---------- safety ----------
const breaches: string[] = [];
if (planTotal > maxTotal) breaches.push(`plan total $${usd(planTotal)} exceeds --max-total $${usd(maxTotal)}`);
if (projectedDeployer < reserve) {
  breaches.push(
    `deployer would end at $${usd(projectedDeployer)}, below --reserve $${usd(reserve)} (balance $${usd(deployerBefore)} - sends $${usd(planTotal)}${gasCountsAgainstUsdc ? ` - gas ~$${usd(gasBudgetUsdc)}` : ''})`,
  );
}
if (!gasCountsAgainstUsdc && deployerNativeBefore < gasBudgetNative) {
  breaches.push(`deployer native balance ${deployerNativeBefore} wei < gas budget ${gasBudgetNative} wei`);
}
if (breaches.length) {
  for (const b of breaches) console.error(`ABORT: ${b}`);
  console.error('ABORT: nothing was sent.');
  process.exit(EXIT_SAFETY);
}
if (sends.length === 0) {
  console.log('nothing to do: every target is already at or above target.');
  process.exit(0);
}
if (dryRun) {
  console.log('dry run: safety checks passed; nothing was sent.');
  process.exit(0);
}

// ---------- send (sequential) ----------
type Sent = { name: string; address: Address; hash: Hex; status: string; feeNative: bigint };
const sent: Sent[] = [];
let failure: string | undefined;
let nonce = await pub.getTransactionCount({ address: deployer.address, blockTag: 'pending' });
for (const p of sends) {
  let hash: Hex;
  try {
    hash = await wallet.writeContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [p.address, p.send],
      nonce,
      ...feeCfg,
    });
  } catch (e) {
    failure = `send to ${p.name} failed before broadcast: ${errLine(e)}`;
    break;
  }
  nonce += 1;
  console.log(`sent ${p.name.padEnd(12)} $${usd(p.send)}  tx=${hash}  waiting for receipt...`);
  try {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    const feeNative = r.gasUsed * r.effectiveGasPrice;
    sent.push({ name: p.name, address: p.address, hash, status: r.status, feeNative });
    if (r.status !== 'success') {
      failure = `transfer to ${p.name} REVERTED in block ${r.blockNumber} (tx ${hash})`;
      break;
    }
  } catch (e) {
    sent.push({ name: p.name, address: p.address, hash, status: 'unknown (receipt timeout)', feeNative: 0n });
    failure = `no receipt for ${p.name} within ${RECEIPT_TIMEOUT_MS / 1000}s (tx ${hash}): ${errLine(e)}. Check the explorer before re-running.`;
    break;
  }
}

// ---------- report ----------
const deployerAfter = await balanceOf(deployer.address);
const afters = await Promise.all(plan.map((p) => balanceOf(p.address)));
const totalFeeNative = sent.reduce((a, s) => a + s.feeNative, 0n);

console.log('');
console.log(`${pad('name', 12)} ${pad('address', 42)} ${lpad('before', 10)} ${lpad('sent', 10)} ${lpad('after', 10)}`);
plan.forEach((p, i) => {
  const s = sent.find((x) => x.address === p.address);
  const sentStr = s?.status === 'success' ? usd(p.send) : p.send === 0n ? 'skip' : s ? s.status : 'not sent';
  console.log(`${pad(p.name, 12)} ${pad(p.address, 42)} ${lpad(usd(p.before), 10)} ${lpad(sentStr, 10)} ${lpad(usd(afters[i]!), 10)}`);
});
console.log('');
for (const s of sent) {
  console.log(`tx ${s.name.padEnd(12)} ${s.hash}  status=${s.status}`);
  if (isArc) console.log(`   ${explorerTxUrl(s.hash)}`);
}
console.log(
  `gas fee total      ${formatNativeAsUsdc(totalFeeNative)} ${isArc ? 'USDC' : 'native (test ETH on local chain)'} (${totalFeeNative} wei, 18-dec)`,
);
console.log(`deployer           before=$${usd(deployerBefore)} after=$${usd(deployerAfter)}${isArc ? `  ${explorerAddressUrl(deployer.address)}` : ''}`);

if (failure) {
  console.error(`ERROR: ${failure}`);
  console.error(`ERROR: stopped after ${sent.filter((s) => s.status === 'success').length}/${sends.length} successful transfer(s).`);
  process.exit(EXIT_SEND);
}
console.log(`done: ${sent.length} transfer(s), $${usd(planTotal)} sent.`);
