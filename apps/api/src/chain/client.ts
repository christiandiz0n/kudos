/**
 * ChainClient — the only thing that talks to Arc. Narrow on purpose so tests replace it with a fake (no RPC):
 *   - Vouch/USDC reads used by quotes, pre-checks and prepares
 *   - the relayer's primitives: pending nonce, fees, eth_call simulation (decoded revert), estimateGas, sign+send, receipt
 * The real implementation uses viem against `ARC_RPC_URL` (default https://rpc.testnet.arc.io).
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
  isHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARC_MIN_MAX_FEE_PER_GAS,
  ARC_TESTNET_USDC_ADDRESS,
  VOUCH_ARC_TESTNET,
  arcTestnet,
  erc20MinAbi,
  vouchAbi,
  type Weights,
} from '@vouch/shared';

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** A decoded revert: a Vouch custom error name, `Error` (revert string, `reason` set) or `Panic`. */
export interface Revert {
  name: string;
  reason?: string;
  args?: readonly unknown[];
}

export type SimResult = { ok: true } | { ok: false; revert: Revert };

export interface ReceiptLite {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  from: Address;
}

export interface TxRequest {
  data: Hex;
  /** Call target; default the Vouch contract. The demo top-up targets USDC (D-811). */
  to?: Address;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The subset the relayer needs (mocked in relayer unit tests). */
export interface RelayChain {
  /** null when RELAYER_PRIVATE_KEY is unset → relays answer RELAYER_DOWN. */
  readonly relayer: Address | null;
  pendingNonce(): Promise<number>;
  latestNonce(): Promise<number>;
  fees(): Promise<Fees>;
  /** eth_call `to` (default Vouch), `from = RELAYER`. Transport failures THROW; reverts resolve `{ ok: false }`. */
  simulate(data: Hex, to?: Address): Promise<SimResult>;
  estimateGas(data: Hex, to?: Address): Promise<bigint>;
  /** Sign with the relayer key and broadcast. Throws the node's error (nonce too low, underpriced, …). */
  send(tx: TxRequest): Promise<Hex>;
  receipt(hash: Hex): Promise<ReceiptLite | null>;
  /** Relayer's own balance in 18-dec native units (gas accounting only, D-102). */
  relayerBalance(): Promise<bigint>;
}

export interface TermsView {
  version: number;
  rewardBps: number;
  effectiveAt: bigint;
  minOrder: bigint;
}
export interface VenueView {
  owner: Address;
  termsVersion: number;
  registeredAt: bigint;
  payout: Address;
  signer: Address;
  attributor: Address;
}
export interface CustomerView {
  verified: boolean;
  rewarded: boolean;
  introCount: number;
  introducer: Address;
  verifiedAt: bigint;
}
export interface LiveIntroView {
  referrer: Address;
  termsVersion: number;
  linkType: number;
  acceptedAt: bigint;
  expiresAt: bigint;
  introHash: Hex;
}
export interface QuoteView {
  firstPurchase: boolean;
  rewarded: boolean;
  weightsMode: number;
  amount: bigint;
  rewardPool: bigint;
  cashback: bigint;
  venueAmount: bigint;
  introducer: Address;
  referrers: readonly Address[];
  bps: readonly number[];
  termsVersions: readonly number[];
  l1Amounts: readonly bigint[];
  l2Recipients: readonly Address[];
  l2Amounts: readonly bigint[];
}

export interface VouchReads {
  readonly vouch: Address;
  readonly chainId: number;
  /** Latest block timestamp (chain time, D-505). */
  now(): Promise<bigint>;
  usdcBalance(a: Address): Promise<bigint>;
  nonces(owner: Address): Promise<bigint>;
  currentTerms(venue: Address): Promise<TermsView>;
  getTerms(venue: Address, version: number): Promise<TermsView>;
  /** owner == 0 when unknown */
  getVenue(venue: Address): Promise<VenueView>;
  getCustomer(venue: Address, customer: Address): Promise<CustomerView>;
  getLiveIntros(venue: Address, customer: Address): Promise<LiveIntroView[]>;
  canRefer(venue: Address, account: Address): Promise<boolean>;
  isIntroUsed(introHash: Hex, customer: Address, linkType: number): Promise<boolean>;
  isOrderSettled(venue: Address, orderId: Hex): Promise<boolean>;
  previewPayment(venue: Address, customer: Address, orderId: Hex, amount: bigint, weights: Weights, attributorSig: Hex, weightsHash: Hex): Promise<QuoteView>;
}

export interface ChainClient extends RelayChain, VouchReads {}

/** Extract a decoded revert from any viem error; null when it is not a revert (transport failure etc.). */
export function decodeRevert(err: unknown): Revert | null {
  if (!(err instanceof BaseError)) return null;
  // 1. viem already decoded it (readContract / simulateContract paths).
  const decoded = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (decoded?.data?.errorName) {
    const name = decoded.data.errorName;
    return name === 'Error' ? { name, reason: decoded.reason ?? String(decoded.data.args?.[0] ?? '') } : { name, args: decoded.data.args };
  }
  // 2. raw revert data somewhere in the cause chain (eth_call / estimateGas paths).
  let data: Hex | undefined;
  err.walk((e) => {
    const x = (e as { data?: unknown }).data;
    if (typeof x === 'string' && isHex(x) && x.length >= 10) {
      data = x as Hex;
      return true;
    }
    return false;
  });
  if (data) {
    try {
      const d = decodeErrorResult({ abi: vouchAbi, data }) as { errorName: string; args?: readonly unknown[] };
      if (d.errorName === 'Error') return { name: 'Error', reason: String(d.args?.[0] ?? '') };
      return { name: d.errorName, args: d.args ?? [] };
    } catch {
      return { name: 'Unknown', reason: data };
    }
  }
  // 3. a node that only says "execution reverted[: reason]".
  const text = [err.shortMessage, err.details, err.message].filter(Boolean).join(' | ');
  const m = /execution reverted:?\s*([^|\n]*)/i.exec(text);
  if (m) return { name: 'Error', reason: (m[1] ?? '').trim() };
  return null;
}

export function createViemChainClient(opts: { rpcUrl: string; relayerKey?: Hex | undefined; vouch?: Address }): ChainClient {
  const vouch = opts.vouch ?? VOUCH_ARC_TESTNET.address;
  const pub = createPublicClient({ chain: arcTestnet, transport: http(opts.rpcUrl, { retryCount: 2, timeout: 15_000 }) });
  const account = opts.relayerKey ? privateKeyToAccount(opts.relayerKey) : null;
  const wallet = account ? createWalletClient({ account, chain: arcTestnet, transport: http(opts.rpcUrl, { retryCount: 0, timeout: 15_000 }) }) : null;
  const need = () => {
    if (!account || !wallet) throw new Error('relayer key not configured');
    return { account, wallet };
  };
  const read = pub.readContract.bind(pub);
  const terms = (version: number, t: { rewardBps: number; effectiveAt: bigint; minOrder: bigint }): TermsView => ({
    version,
    rewardBps: t.rewardBps,
    effectiveAt: t.effectiveAt,
    minOrder: t.minOrder,
  });

  return {
    vouch,
    chainId: arcTestnet.id,
    relayer: account?.address ?? null,
    async now() {
      return (await pub.getBlock({ blockTag: 'latest' })).timestamp;
    },
    usdcBalance: (a) => read({ address: ARC_TESTNET_USDC_ADDRESS, abi: erc20MinAbi, functionName: 'balanceOf', args: [a] }),
    nonces: (owner) => read({ address: vouch, abi: vouchAbi, functionName: 'nonces', args: [owner] }),
    async currentTerms(venue) {
      const [v, t] = await read({ address: vouch, abi: vouchAbi, functionName: 'currentTerms', args: [venue] });
      return terms(v, t);
    },
    async getTerms(venue, version) {
      return terms(version, await read({ address: vouch, abi: vouchAbi, functionName: 'getTerms', args: [venue, version] }));
    },
    async getVenue(venue) {
      const v = await read({ address: vouch, abi: vouchAbi, functionName: 'getVenue', args: [venue] });
      return { ...v };
    },
    async getCustomer(venue, customer) {
      return { ...(await read({ address: vouch, abi: vouchAbi, functionName: 'getCustomer', args: [venue, customer] })) };
    },
    async getLiveIntros(venue, customer) {
      const out = await read({ address: vouch, abi: vouchAbi, functionName: 'getLiveIntros', args: [venue, customer] });
      return out.map((x) => ({ ...x }));
    },
    canRefer: (venue, a) => read({ address: vouch, abi: vouchAbi, functionName: 'canRefer', args: [venue, a] }),
    isIntroUsed: (h, c, t) => read({ address: vouch, abi: vouchAbi, functionName: 'isIntroUsed', args: [h, c, t] }),
    isOrderSettled: (venue, id) => read({ address: vouch, abi: vouchAbi, functionName: 'isOrderSettled', args: [venue, id] }),
    async previewPayment(venue, customer, orderId, amount, weights, attributorSig, weightsHash) {
      const q = await read({
        address: vouch,
        abi: vouchAbi,
        functionName: 'previewPayment',
        args: [venue, customer, orderId, amount, weights, attributorSig, weightsHash],
      });
      return { ...q };
    },
    async pendingNonce() {
      return pub.getTransactionCount({ address: need().account.address, blockTag: 'pending' });
    },
    async latestNonce() {
      return pub.getTransactionCount({ address: need().account.address, blockTag: 'latest' });
    },
    async fees() {
      const est = await pub.estimateFeesPerGas();
      const maxFeePerGas = est.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? est.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
      const maxPriorityFeePerGas = est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas;
      return { maxFeePerGas, maxPriorityFeePerGas };
    },
    async simulate(data, to) {
      try {
        await pub.call({ account: need().account.address, to: to ?? vouch, data });
        return { ok: true };
      } catch (e) {
        const r = decodeRevert(e);
        if (r) return { ok: false, revert: r };
        throw e;
      }
    },
    async estimateGas(data, to) {
      return pub.estimateGas({ account: need().account.address, to: to ?? vouch, data });
    },
    async send(tx) {
      const { account, wallet } = need();
      return wallet.sendTransaction({
        account,
        chain: arcTestnet,
        to: tx.to ?? vouch,
        data: tx.data,
        nonce: tx.nonce,
        gas: tx.gas,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        value: 0n,
      });
    },
    async receipt(hash) {
      try {
        const r = await pub.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: r.blockNumber, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice, from: r.from };
      } catch (e) {
        if (e instanceof BaseError && /could not be found|not found/i.test(e.shortMessage)) return null;
        throw e;
      }
    },
    async relayerBalance() {
      if (!account) return 0n;
      return pub.getBalance({ address: account.address });
    },
  };
}

export const ZERO = zeroAddress;
