/**
 * Testnet smoke: runs the canonical Vouch story on Arc Testnet against the deployed contract.
 *
 *   Lena (DEMO_LENA)          venue owner + payout; signs RegisterVenue / SetSeedAmbassador (relayed)
 *   VENUE_SIGNER              signs every Order
 *   ATTRIBUTOR                signs the Weights of Ben's purchase (Ana 70% / Priya 30%)
 *   RELAYER                   submits EVERY tx and pays all gas (users only sign)
 *   Sam (SPIKE_USER)          seed ambassador → introduces Ana (so Ana's introducer = Sam)
 *   Ana (DEMO_ANA)            first purchase via Sam; then introduces Priya (so Priya's introducer = Ana)
 *   Priya (DEMO_PRIYA)        first purchase via Ana
 *   Ben (DEMO_BEN)            accepts Ana (personal) + Priya (broadcast), pays $12.00 → the canonical split:
 *                             venue 10.20 · Ben 0.45 · Ana 0.693 · Priya 0.297 · L2 0.252 → Sam, 0.108 → Ana
 *
 * Each run registers a FRESH venue (unique salt), so it is repeatable. Customer payments only move USDC between our
 * own wallets (Ana $1.00, Priya $1.00, Ben $12.00). Gas is capped (default $0.50 total, aborts before exceeding).
 *
 * Run (repo root):  pnpm --filter @vouch/scripts smoke:canonical [-- --amount 12.00 --gas-cap 0.50]
 * Env (loaded by the pnpm script from the root env file; never printed): RELAYER/ATTRIBUTOR/VENUE_SIGNER/
 * SPIKE_USER/DEMO_LENA/DEMO_ANA/DEMO_PRIYA/DEMO_BEN _PRIVATE_KEY, optional ARC_RPC_URL.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_USDC_ADDRESS,
  ARC_TESTNET_USDC_EIP712_DOMAIN,
  INTRO_ACCEPTANCE_TYPES,
  INTRO_TYPES,
  ORDER_TYPES,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  REGISTER_VENUE_TYPES,
  SET_SEED_AMBASSADOR_TYPES,
  VOUCH_ARC_TESTNET,
  WEIGHTS_TYPES,
  arcTestnet,
  computeVenueId,
  erc20MinAbi,
  explorerTxUrl,
  formatNativeAsUsdc,
  formatUsdc,
  introDigest,
  parseUsdc,
  receiveAuthForPayment,
  vouchAbi,
  vouchDomain,
  weightsStructHash,
  type Intro,
  type Order,
  type PaymentAuth,
  type Weights,
} from '@vouch/shared';

// ------------------------------------------------------------------------------------------------ config
const args = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt;
};
const AMOUNT = parseUsdc(arg('amount', '12.00'));
const GAS_CAP = parseUsdc(arg('gas-cap', '0.50')); // USDC 6-dec
const FIRST_PURCHASE = parseUsdc('1.00');
const RATE = 1_500; // 15%
const MIN_ORDER = parseUsdc('1.00');
if (AMOUNT > parseUsdc('12.00') || AMOUNT < MIN_ORDER) throw new Error('amount must be within [1.00, 12.00]');

function key(name: string): PrivateKeyAccount {
  const v = process.env[`${name}_PRIVATE_KEY`];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    console.error(`missing/invalid env ${name}_PRIVATE_KEY`); // never echo the value
    process.exit(2);
  }
  return privateKeyToAccount(v as Hex);
}
const relayer = key('RELAYER');
const attributor = key('ATTRIBUTOR');
const venueSigner = key('VENUE_SIGNER');
const sam = key('SPIKE_USER');
const lena = key('DEMO_LENA');
const ana = key('DEMO_ANA');
const priya = key('DEMO_PRIYA');
const ben = key('DEMO_BEN');
const NAMES = new Map<string, string>([
  [lena.address.toLowerCase(), 'Lena (venue payout)'],
  [sam.address.toLowerCase(), 'Sam (seed, SPIKE_USER)'],
  [ana.address.toLowerCase(), 'Ana'],
  [priya.address.toLowerCase(), 'Priya'],
  [ben.address.toLowerCase(), 'Ben'],
]);
const who = (a: string) => NAMES.get(a.toLowerCase()) ?? a;

const rpcUrl = process.env.ARC_RPC_URL || ARC_TESTNET_RPC_URL;
const pub = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) });
const wallet = createWalletClient({ account: relayer, chain: arcTestnet, transport: http(rpcUrl) });
const VOUCH = VOUCH_ARC_TESTNET.address;
const domain = vouchDomain(ARC_TESTNET_CHAIN_ID, VOUCH);

// ------------------------------------------------------------------------------------------------ tx helpers
let gasSpentNative = 0n;
const txLog: { label: string; hash: Hex; gasUsed: bigint; feeNative: bigint }[] = [];

async function fees() {
  const est = await pub.estimateFeesPerGas();
  const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const maxPriorityFeePerGas = est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

// biome-ignore lint: viem's generic writeContract args are verbose; the ABI keeps calls type-checked
async function send(label: string, functionName: any, fnArgs: any): Promise<TransactionReceipt> {
  const f = await fees();
  const gas = await pub.estimateContractGas({ address: VOUCH, abi: vouchAbi, functionName, args: fnArgs, account: relayer });
  const worst = ((gas * 12n) / 10n) * f.maxFeePerGas;
  if ((gasSpentNative + worst) / 10n ** 12n > GAS_CAP) {
    throw new Error(`gas cap: spent ${formatNativeAsUsdc(gasSpentNative)} + worst ${formatNativeAsUsdc(worst)} > cap`);
  }
  const hash = await wallet.writeContract({
    address: VOUCH,
    abi: vouchAbi,
    functionName,
    args: fnArgs,
    gas: (gas * 12n) / 10n,
    ...f,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  const feeNative = r.gasUsed * r.effectiveGasPrice;
  gasSpentNative += feeNative;
  txLog.push({ label, hash, gasUsed: r.gasUsed, feeNative });
  console.log(`  ✓ ${label.padEnd(34)} gas ${r.gasUsed.toString().padStart(7)}  fee ${formatNativeAsUsdc(feeNative)} USDC  ${explorerTxUrl(hash)}`);
  return r;
}

async function now(): Promise<bigint> {
  return (await pub.getBlock({ blockTag: 'latest' })).timestamp;
}

const rand32 = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

async function balanceOf(a: Address): Promise<bigint> {
  return pub.readContract({ address: ARC_TESTNET_USDC_ADDRESS, abi: erc20MinAbi, functionName: 'balanceOf', args: [a] });
}

// ------------------------------------------------------------------------------------------------ steps
async function introduce(venue: Address, referrer: PrivateKeyAccount, customer: PrivateKeyAccount, linkType: 0 | 1) {
  const t = await now();
  const [termsVersion] = await pub.readContract({ address: VOUCH, abi: vouchAbi, functionName: 'currentTerms', args: [venue] });
  const intro: Intro = {
    venue,
    referrer: referrer.address,
    termsVersion,
    linkType,
    issuedAt: t, // chain time (not the local clock) so the terms-in-force check matches
    expiresAt: t + 7n * 86_400n,
    nonce: rand32(),
  };
  const introHash = introDigest(domain, intro);
  const referrerSig = await referrer.signTypedData({ domain, types: INTRO_TYPES, primaryType: 'Intro', message: intro });
  const acceptance = { introHash, customer: customer.address, deadline: t + 3_600n };
  const customerSig = await customer.signTypedData({
    domain,
    types: INTRO_ACCEPTANCE_TYPES,
    primaryType: 'IntroAcceptance',
    message: acceptance,
  });
  await send(`acceptIntro ${who(referrer.address).split(' ')[0]}→${who(customer.address)}`, 'acceptIntro', [
    intro,
    referrerSig,
    acceptance,
    customerSig,
  ]);
}

async function pay(venue: Address, customer: PrivateKeyAccount, amount: bigint, w?: { referrers: Address[]; bps: number[] }) {
  const t = await now();
  const order: Order = { venue, orderId: rand32(), amount, expiresAt: t + 600n };
  const orderSig = await venueSigner.signTypedData({ domain, types: ORDER_TYPES, primaryType: 'Order', message: order });
  let weights: Weights = { venue: zeroAddress, customer: zeroAddress, orderId: zeroHash, referrers: [], bps: [] };
  let weightsSig: Hex = '0x';
  let weightsHash: Hex = zeroHash;
  if (w) {
    weights = { venue, customer: customer.address, orderId: order.orderId, referrers: w.referrers, bps: w.bps };
    weightsSig = await attributor.signTypedData({ domain, types: WEIGHTS_TYPES, primaryType: 'Weights', message: weights });
    weightsHash = weightsStructHash(weights);
  }
  const auth: PaymentAuth = {
    customer: customer.address,
    venue,
    orderId: order.orderId,
    amount,
    weightsHash,
    deadline: t + 600n,
  };
  // The ONE signature the customer makes: USDC ReceiveWithAuthorization (to = Vouch, nonce = hashStruct(auth)).
  const usdcSig = await customer.signTypedData({
    domain: ARC_TESTNET_USDC_EIP712_DOMAIN,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: receiveAuthForPayment(auth, VOUCH),
  });
  const quote = await pub.readContract({
    address: VOUCH,
    abi: vouchAbi,
    functionName: 'previewPayment',
    args: [venue, customer.address, order.orderId, amount, weights, weightsSig, weightsHash],
  });
  const r = await send(`pay ${who(customer.address)} $${formatUsdc(amount)}`, 'pay', [
    order,
    orderSig,
    weights,
    weightsSig,
    auth,
    usdcSig,
  ]);
  return { r, quote, order };
}

function check(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    process.exitCode = 1;
  } else console.log(`  ✓ ${msg}`);
}

// Expected split, same integer math as VouchSplit (per-referrer slice at its frozen rate, floors, remainder → venue).
function expectedSplit(amount: bigint, bps: bigint[], rate: bigint) {
  const slices = bps.map((b) => (amount * b * rate) / 100_000_000n);
  const cashback = slices.reduce((s, x) => s + (x * 2_500n) / 10_000n, 0n);
  const l1 = slices.map((x) => (x * 5_500n) / 10_000n);
  const l2 = slices.map((x) => (x * 2_000n) / 10_000n);
  const paid = cashback + l1.reduce((a, b) => a + b, 0n) + l2.reduce((a, b) => a + b, 0n);
  return { cashback, l1, l2, venue: amount - paid, pool: slices.reduce((a, b) => a + b, 0n) };
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const chainId = await pub.getChainId();
  if (chainId !== ARC_TESTNET_CHAIN_ID) throw new Error(`wrong chain ${chainId}`);
  console.log(`Vouch ${VOUCH} (deploy block ${VOUCH_ARC_TESTNET.deployBlock}) on Arc Testnet ${chainId}`);
  console.log(`relayer ${relayer.address} · amount $${formatUsdc(AMOUNT)} · gas cap $${formatUsdc(GAS_CAP)}`);

  const salt = keccak256(toHex(`smoke-canonical-${Date.now()}`));
  const venue = computeVenueId(lena.address, salt);
  const t0 = await now();
  const cfg = {
    payout: lena.address,
    signer: venueSigner.address,
    attributor: attributor.address,
    rewardBps: RATE,
    minOrder: MIN_ORDER,
    metadataURI: 'vouch://smoke/lenas-cafe',
  };
  const n0 = await pub.readContract({ address: VOUCH, abi: vouchAbi, functionName: 'nonces', args: [lena.address] });
  const deadline = t0 + 3_600n;
  const regSig = await lena.signTypedData({
    domain,
    types: REGISTER_VENUE_TYPES,
    primaryType: 'RegisterVenue',
    message: { owner: lena.address, salt, ...cfg, nonce: n0, deadline },
  });
  console.log(`\n[1] venue setup (venue id ${venue})`);
  await send('registerVenue (Lena-signed)', 'registerVenue', [lena.address, salt, cfg, deadline, regSig]);
  const seedSig = await lena.signTypedData({
    domain,
    types: SET_SEED_AMBASSADOR_TYPES,
    primaryType: 'SetSeedAmbassador',
    message: { venue, ambassador: sam.address, allowed: true, nonce: n0 + 1n, deadline },
  });
  await send('setSeedAmbassador Sam (Lena-signed)', 'setSeedAmbassador', [venue, sam.address, true, deadline, seedSig]);

  console.log('\n[2] Ana joins via Sam (introducer(Ana) = Sam)');
  await introduce(venue, sam, ana, 0);
  await pay(venue, ana, FIRST_PURCHASE, { referrers: [sam.address], bps: [10_000] });

  console.log('\n[3] Priya joins via Ana (introducer(Priya) = Ana)');
  await introduce(venue, ana, priya, 0);
  await pay(venue, priya, FIRST_PURCHASE, { referrers: [ana.address], bps: [10_000] });

  console.log('\n[4] Ben gets intros from Ana (personal) and Priya (broadcast)');
  await introduce(venue, ana, ben, 0);
  await introduce(venue, priya, ben, 1);

  console.log(`\n[5] Ben pays $${formatUsdc(AMOUNT)} — attributor weights Ana 70% / Priya 30%`);
  const people = [lena, ben, ana, priya, sam].map((a) => a.address);
  const before = await Promise.all(people.map(balanceOf));
  const { r, quote } = await pay(venue, ben, AMOUNT, { referrers: [ana.address, priya.address], bps: [7_000, 3_000] });
  const after = await Promise.all(people.map(balanceOf));

  const logs = parseEventLogs({ abi: vouchAbi, logs: r.logs }).filter((l) => l.address.toLowerCase() === VOUCH.toLowerCase());
  const settled = logs.find((l) => l.eventName === 'PaymentSettled');
  const rewards = logs.filter((l) => l.eventName === 'RewardPaid');
  console.log('\n  per-recipient (RewardPaid events):');
  if (settled && settled.eventName === 'PaymentSettled') {
    console.log(`    venue payout  ${who(lena.address).padEnd(24)} $${formatUsdc(settled.args.venueAmount, { minFraction: 6 })}`);
  }
  for (const l of rewards) {
    if (l.eventName !== 'RewardPaid') continue;
    const role = ['CASHBACK', 'L1', 'L2'][l.args.role]!;
    const via = l.args.role === 2 ? ` (via ${who(l.args.viaReferrer)})` : '';
    console.log(`    ${role.padEnd(13)} ${who(l.args.recipient).padEnd(24)} $${formatUsdc(l.args.amount, { minFraction: 6 })}${via}`);
  }

  const exp = expectedSplit(AMOUNT, [7_000n, 3_000n], BigInt(RATE));
  const delta = after.map((b, i) => b - before[i]!);
  console.log('\n[6] assertions');
  if (AMOUNT === 12_000_000n) {
    check(exp.venue === 10_200_000n && exp.cashback === 450_000n, 'canonical constants: venue 10,200,000 · cashback 450,000');
    check(exp.l1[0] === 693_000n && exp.l1[1] === 297_000n, 'canonical L1: Ana 693,000 · Priya 297,000');
    check(exp.l2[0] === 252_000n && exp.l2[1] === 108_000n, 'canonical L2: 252,000 (→Sam) · 108,000 (→Ana)');
  }
  check(delta[0] === exp.venue, `Lena (payout) +${exp.venue} (got ${delta[0]})`);
  check(delta[1] === -AMOUNT + exp.cashback, `Ben ${-AMOUNT + exp.cashback} (got ${delta[1]})`);
  check(delta[2] === exp.l1[0]! + exp.l2[1]!, `Ana +${exp.l1[0]! + exp.l2[1]!} = L1 ${exp.l1[0]} + L2-via-Priya ${exp.l2[1]} (got ${delta[2]})`);
  check(delta[3] === exp.l1[1], `Priya +${exp.l1[1]} (got ${delta[3]})`);
  check(delta[4] === exp.l2[0], `Sam +${exp.l2[0]} (got ${delta[4]})`);
  check(delta.reduce((a, b) => a + b, 0n) === 0n, 'Σ deltas == 0 (every unit of the payment is accounted for)');
  check(settled?.eventName === 'PaymentSettled' && settled.args.weightsMode === 1, 'weightsMode = ATTRIBUTOR (1)');
  check(quote.venueAmount === exp.venue && quote.cashback === exp.cashback, 'previewPayment matched the settled split');
  const cs = await pub.readContract({ address: VOUCH, abi: vouchAbi, functionName: 'getCustomer', args: [venue, ben.address] });
  check(cs.verified && cs.rewarded && cs.introducer === ana.address, 'Ben verified + rewarded, introducer = Ana');

  console.log('\n[7] gas (paid by the relayer in USDC)');
  for (const t of txLog) console.log(`    ${t.label.padEnd(34)} ${t.gasUsed.toString().padStart(8)} gas  ${formatNativeAsUsdc(t.feeNative)} USDC`);
  console.log(`    TOTAL ${txLog.length} txs: ${formatNativeAsUsdc(gasSpentNative)} USDC (cap $${formatUsdc(GAS_CAP)})`);
  const payBen = txLog[txLog.length - 1]!;
  console.log(`    canonical pay(): ${payBen.gasUsed} gas = ${formatNativeAsUsdc(payBen.feeNative)} USDC`);
  console.log(`\nvenue ${venue} · explorer ${arcTestnet.blockExplorers.default.url}/address/${VOUCH}`);
  if (process.exitCode) console.error('\nSMOKE FAILED');
  else console.log('\nSMOKE OK');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
