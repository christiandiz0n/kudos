/**
 * S5 relayer spike (Phase 0, NOT production).
 *
 * Flow: the user (token holder) signs an EIP-712 SplitAuth; a separate relayer key submits
 * Hello.relayedSplit to 7 recipients and pays gas. Prints gasUsed, effectiveGasPrice and the fee
 * expressed in USDC.
 *
 * Units — be explicit (D-102):
 *   - ERC-20 USDC amounts (balances, transfers): 6 decimals.
 *   - Native gas on Arc (gasPrice, receipt fee, eth_getBalance): 18 decimals. The native gas token IS
 *     USDC (same balance, balanceOf == floor(native / 1e12)), so fee_native / 1e18 = fee in USDC.
 *   - On local anvil the native token is test ETH; the "USDC" fee label assumes Arc semantics.
 *   - Arc drops txs with maxFeePerGas < 20 gwei (D-101): fees are clamped up on Arc.
 * The spike uses approve + transferFrom; production uses EIP-3009 receiveWithAuthorization (D-103).
 *
 * Env:
 *   RPC_URL (or ARC_RPC_URL)      JSON-RPC endpoint
 *   USDC_ADDRESS                  ERC-20 token to split (mock 6-dec USDC locally)
 *   HELLO_ADDRESS                 deployed contracts/src/spikes/Hello.sol
 *   RELAYER_PRIVATE_KEY           pays gas, submits relayedSplit
 *   SPIKE_USER_PRIVATE_KEY        token holder, signs SplitAuth (and approves once if needed)
 *   SPLIT_TOTAL_USD               optional, default "1.20" (scaled from the $12.00 product story)
 *   RECIPIENTS                    optional, comma-separated 7 addresses (default: deterministic fresh addresses)
 *
 * Run: pnpm --filter @vouch/scripts s5:relayer   (loads ../.env if present)
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET_CHAIN_ID,
  SPLIT_AUTH_TYPES,
  arcTestnet,
  erc20MinAbi,
  formatNativeAsUsdc,
  formatUsd,
  formatUsdc,
  hashAddressArray,
  hashUint256Array,
  helloAbi,
  helloDomain,
  nativeToUsdcBaseUnits,
  parseUsdc,
} from '@vouch/shared';

function need(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    console.error(`missing env ${name}`);
    process.exit(1);
  }
  return v;
}

const rpcUrl = need('RPC_URL', process.env.ARC_RPC_URL);
const usdc = need('USDC_ADDRESS') as Address;
const hello = need('HELLO_ADDRESS') as Address;
const relayer = privateKeyToAccount(need('RELAYER_PRIVATE_KEY') as Hex);
const user = privateKeyToAccount(need('SPIKE_USER_PRIVATE_KEY') as Hex);
const total = parseUsdc(process.env.SPLIT_TOTAL_USD ?? '1.20');

// Product-story proportions of a $12.00 sale (venue, cashback, 2x L1, 2x L2, remainder).
const STORY = [10_200_000n, 450_000n, 693_000n, 297_000n, 252_000n, 108_000n] as const;
const STORY_TOTAL = 12_000_000n;

function storyAmounts(t: bigint): bigint[] {
  const out: bigint[] = STORY.map((s) => (t * s) / STORY_TOTAL);
  const used = out.reduce((a, b) => a + b, 0n);
  out.push(t - used); // 7th recipient takes the rounding remainder => sums exactly
  return out;
}

function recipientsFromEnv(): Address[] {
  const raw = process.env.RECIPIENTS;
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()) as Address[];
    if (list.length !== 7) throw new Error('RECIPIENTS must list exactly 7 addresses');
    return list;
  }
  // Deterministic, never-used addresses (cold accounts = worst-case gas).
  const salt = toHex(Date.now());
  return Array.from({ length: 7 }, (_, i) => `0x${keccak256(toHex(`wom-s5-${salt}-${i}`)).slice(-40)}` as Address);
}

const probe = createPublicClient({ transport: http(rpcUrl) });
const chainId = await probe.getChainId();
const chain =
  chainId === ARC_TESTNET_CHAIN_ID
    ? { ...arcTestnet, rpcUrls: { default: { http: [rpcUrl] } } }
    : defineChain({
        id: chainId,
        name: `local-${chainId}`,
        nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });

const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const relayerWallet = createWalletClient({ chain, account: relayer, transport: http(rpcUrl) });
const userWallet = createWalletClient({ chain, account: user, transport: http(rpcUrl) });

/** EIP-1559 fee overrides: on Arc clamp maxFeePerGas up to the 20 gwei floor (D-101). */
async function feeOverrides() {
  if (chainId !== ARC_TESTNET_CHAIN_ID) return {};
  const est = await pub.estimateFeesPerGas();
  const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const maxPriorityFeePerGas = est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

const recipients = recipientsFromEnv();
const amounts = storyAmounts(total);
const sum = amounts.reduce((a, b) => a + b, 0n);

console.log(`chainId            ${chainId}${chainId === ARC_TESTNET_CHAIN_ID ? ' (Arc Testnet)' : ' (local)'}`);
console.log(`hello              ${hello}`);
console.log(`token              ${usdc}  decimals=${await pub.readContract({ address: usdc, abi: erc20MinAbi, functionName: 'decimals' })}`);
console.log(`user (signer)      ${user.address}`);
console.log(`relayer (gas)      ${relayer.address}`);
console.log(`split total        ${formatUsd(total)} -> ${recipients.length} recipients, sum=${formatUsd(sum)}`);

// 1) One-time approval by the user (skipped if allowance already covers the split).
//    PENDING S1: with EIP-2612/EIP-3009 on Arc USDC this becomes a signature the relayer submits.
const allowance = await pub.readContract({
  address: usdc,
  abi: erc20MinAbi,
  functionName: 'allowance',
  args: [user.address, hello],
});
if (allowance < sum) {
  const approveHash = await userWallet.writeContract({
    address: usdc,
    abi: erc20MinAbi,
    functionName: 'approve',
    args: [hello, 2n ** 256n - 1n],
    ...(await feeOverrides()),
  });
  const r = await pub.waitForTransactionReceipt({ hash: approveHash });
  const fee = r.gasUsed * r.effectiveGasPrice;
  console.log(`approve            tx=${approveHash} status=${r.status} gasUsed=${r.gasUsed} fee=${formatNativeAsUsdc(fee)} USDC (paid by user, one-time)`);
} else {
  console.log('approve            skipped (allowance sufficient)');
}

// 2) User signs SplitAuth (off-chain, no gas).
const nonce = await pub.readContract({ address: hello, abi: helloAbi, functionName: 'nonces', args: [user.address] });
const block = await pub.getBlock();
const deadline = block.timestamp + 600n;
const signature = await user.signTypedData({
  domain: helloDomain(chainId, hello),
  types: SPLIT_AUTH_TYPES,
  primaryType: 'SplitAuth',
  message: {
    token: usdc,
    from: user.address,
    recipientsHash: hashAddressArray(recipients),
    amountsHash: hashUint256Array(amounts),
    nonce,
    deadline,
  },
});
console.log(`signed SplitAuth   nonce=${nonce} deadline=${deadline}`);

// 3) Relayer submits.
const userBalBefore = await pub.readContract({ address: usdc, abi: erc20MinAbi, functionName: 'balanceOf', args: [user.address] });
const relayerNativeBefore = await pub.getBalance({ address: relayer.address });
const balanceOf = (a: Address) => pub.readContract({ address: usdc, abi: erc20MinAbi, functionName: 'balanceOf', args: [a] });
const recipientsBefore = await Promise.all(recipients.map(balanceOf));
const hash = await relayerWallet.writeContract({
  address: hello,
  abi: helloAbi,
  functionName: 'relayedSplit',
  args: [usdc, user.address, recipients, amounts, deadline, signature],
  ...(await feeOverrides()),
});
const receipt = await pub.waitForTransactionReceipt({ hash });
const relayerNativeAfter = await pub.getBalance({ address: relayer.address, blockNumber: receipt.blockNumber });
const userBalAfter = await pub.readContract({ address: usdc, abi: erc20MinAbi, functionName: 'balanceOf', args: [user.address] });

// 4) Verify on-chain effects.
const [split] = parseEventLogs({ abi: helloAbi, eventName: 'Split', logs: receipt.logs });
const recipientsAfter = await Promise.all(recipients.map(balanceOf));
const delivered = recipientsAfter.reduce((acc, b, i) => acc + (b - recipientsBefore[i]!), 0n);

const feeNative = receipt.gasUsed * receipt.effectiveGasPrice; // 18-decimal native units
console.log('--- relayedSplit result ---');
console.log(`tx                 ${hash}`);
console.log(`status             ${receipt.status}  block=${receipt.blockNumber}`);
console.log(`Split event        recipients=${split?.args.recipientCount} total=${split ? formatUsd(split.args.total) : '?'} relayer=${split?.args.relayer}`);
console.log(`user debited       ${formatUsd(userBalBefore - userBalAfter)} (ERC-20, 6-dec)`);
console.log(`delivered          ${formatUsd(delivered)} across 7 recipients (exact=${delivered === sum})`);
console.log(`gasUsed            ${receipt.gasUsed}`);
console.log(`effectiveGasPrice  ${receipt.effectiveGasPrice} native-wei (18-dec) = ${formatNativeAsUsdc(receipt.effectiveGasPrice)} USDC/gas`);
console.log(`fee (native)       ${feeNative} native-wei (18-dec)`);
console.log(`fee in USDC        ${formatNativeAsUsdc(feeNative)} USDC  (~${formatUsdc(nativeToUsdcBaseUnits(feeNative), { minFraction: 6 })} USDC rounded up to 6-dec base units) — paid by relayer`);
console.log(`relayer balance Δ  ${formatNativeAsUsdc(relayerNativeBefore - relayerNativeAfter)} (native, cross-check)`);
if (receipt.status !== 'success' || delivered !== sum) process.exit(1);
