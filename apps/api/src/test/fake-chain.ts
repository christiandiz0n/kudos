/**
 * Test double for ChainClient: an in-memory model of the Vouch rules the API depends on (venues, owner nonces, seeds,
 * intros, first-purchase rewards with L1/L2 split at frozen rates, settled orders, USDC balances) plus a relayer whose
 * txs mine instantly. Signatures are NOT checked here (the API verifies them off-chain before relaying); everything
 * else mirrors the contract closely enough for endpoint contract tests and the canonical $12 split.
 */
import { decodeFunctionData, getAddress, keccak256, toHex, zeroAddress, zeroHash, type Address, type Hex } from 'viem';
import { VOUCH_ARC_TESTNET, computeVenueId, vouchAbi, type Weights } from '@vouch/shared';
import type { ChainClient, CustomerView, Fees, LiveIntroView, QuoteView, ReceiptLite, Revert, SimResult, TermsView, TxRequest, VenueView } from '../chain/client';

const k = (...xs: string[]) => xs.map((x) => x.toLowerCase()).join(':');

interface VenueState extends VenueView {
  terms: TermsView[];
}

export class FakeChain implements ChainClient {
  readonly vouch: Address = VOUCH_ARC_TESTNET.address;
  readonly chainId = 5042002;
  relayer: Address | null;
  time = 1_800_000_000n;
  block = 1_000n;
  venues = new Map<string, VenueState>();
  ownerNonces = new Map<string, bigint>();
  seeds = new Set<string>();
  customers = new Map<string, CustomerView>();
  live = new Map<string, LiveIntroView[]>();
  used = new Set<string>();
  settled = new Set<string>();
  balances = new Map<string, bigint>();
  relayerNative = 10n ** 20n;
  /** relayer nonces */
  nonce = 0;
  receipts = new Map<Hex, ReceiptLite>();
  sent: (TxRequest & { fn: string; hash: Hex })[] = [];
  /** Live-measured gas per call (MSG-009/MSG-056); `gasOverride` forces a value. */
  gasByFn: Record<string, bigint> = { registerVenue: 180_000n, setSeedAmbassador: 64_000n, updateTerms: 70_000n, setKeys: 70_000n, acceptIntro: 170_000n, pay: 410_000n };
  gasOverride: bigint | null = null;
  feeQuote: Fees = { maxFeePerGas: 25_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
  /** Force a revert on the next simulate of `fn` (e.g. to model a race). */
  forceRevert = new Map<string, Revert>();
  /** Calls observed, for assertions. */
  calls: string[] = [];

  constructor(relayer: Address | null) {
    this.relayer = relayer;
  }

  // ------------------------------------------------------------------ reads
  async now() {
    return this.time;
  }
  async usdcBalance(a: Address) {
    return this.balances.get(a.toLowerCase()) ?? 0n;
  }
  setBalance(a: Address, v: bigint) {
    this.balances.set(a.toLowerCase(), v);
  }
  async nonces(owner: Address) {
    return this.ownerNonces.get(owner.toLowerCase()) ?? 0n;
  }
  private bumpOwner(owner: Address) {
    this.ownerNonces.set(owner.toLowerCase(), (this.ownerNonces.get(owner.toLowerCase()) ?? 0n) + 1n);
  }
  private venue(v: Address) {
    return this.venues.get(v.toLowerCase());
  }
  async currentTerms(v: Address): Promise<TermsView> {
    const s = this.venue(v);
    if (!s) return { version: 0, rewardBps: 0, effectiveAt: 0n, minOrder: 0n };
    return s.terms.at(-1)!;
  }
  async getTerms(v: Address, version: number): Promise<TermsView> {
    const t = this.venue(v)?.terms[version - 1];
    return t ?? { version, rewardBps: 0, effectiveAt: 0n, minOrder: 0n };
  }
  async getVenue(v: Address): Promise<VenueView> {
    const s = this.venue(v);
    if (!s) return { owner: zeroAddress, termsVersion: 0, registeredAt: 0n, payout: zeroAddress, signer: zeroAddress, attributor: zeroAddress };
    const { terms: _t, ...rest } = s;
    return { ...rest, termsVersion: s.terms.length };
  }
  async getCustomer(v: Address, c: Address): Promise<CustomerView> {
    return this.customers.get(k(v, c)) ?? { verified: false, rewarded: false, introCount: 0, introducer: zeroAddress, verifiedAt: 0n };
  }
  async getLiveIntros(v: Address, c: Address) {
    return [...(this.live.get(k(v, c)) ?? [])];
  }
  async canRefer(v: Address, a: Address) {
    return this.seeds.has(k(v, a)) || (await this.getCustomer(v, a)).verified;
  }
  async isIntroUsed(h: Hex, c: Address, linkType: number) {
    return this.used.has(linkType === 0 ? h.toLowerCase() : k(h, c));
  }
  async isOrderSettled(v: Address, id: Hex) {
    return this.settled.has(k(v, id));
  }

  async previewPayment(venue: Address, customer: Address, orderId: Hex, amount: bigint, weights: Weights, _sig: Hex, weightsHash: Hex): Promise<QuoteView> {
    const plain = (firstPurchase: boolean): QuoteView => ({
      firstPurchase,
      rewarded: false,
      weightsMode: 0,
      amount,
      rewardPool: 0n,
      cashback: 0n,
      venueAmount: amount,
      introducer: zeroAddress,
      referrers: [],
      bps: [],
      termsVersions: [],
      l1Amounts: [],
      l2Recipients: [],
      l2Amounts: [],
    });
    const cust = await this.getCustomer(venue, customer);
    if (cust.verified) return plain(false);
    const eligible = (await this.getLiveIntros(venue, customer)).filter(
      (li) => this.time <= li.expiresAt && amount >= (this.venue(venue)?.terms[li.termsVersion - 1]?.minOrder ?? 0n),
    );
    if (eligible.length === 0) return plain(true);
    let refs: { referrer: Address; bps: number; termsVersion: number }[];
    let mode: number;
    const valid =
      weightsHash !== zeroHash &&
      weights.referrers.length > 0 &&
      weights.referrers.length === weights.bps.length &&
      weights.bps.reduce((a, b) => a + b, 0) === 10_000 &&
      weights.referrers.every((r) => eligible.some((e) => e.referrer.toLowerCase() === r.toLowerCase()));
    if (valid) {
      mode = 1;
      refs = weights.referrers.map((r, i) => ({ referrer: r, bps: weights.bps[i]!, termsVersion: eligible.find((e) => e.referrer.toLowerCase() === r.toLowerCase())!.termsVersion }));
    } else {
      mode = weightsHash === zeroHash ? 2 : 4;
      const raw = eligible.map((e) => (e.linkType === 0 ? 2 : 1));
      const total = raw.reduce((a, b) => a + b, 0);
      const bps = raw.map((r) => Math.floor((r * 10_000) / total));
      bps[bps.length - 1]! += 10_000 - bps.reduce((a, b) => a + b, 0);
      refs = eligible.map((e, i) => ({ referrer: e.referrer, bps: bps[i]!, termsVersion: e.termsVersion }));
    }
    let pool = 0n;
    let cashback = 0n;
    const l1: bigint[] = [];
    const l2: bigint[] = [];
    const l2r: Address[] = [];
    let paidL2 = 0n;
    for (const r of refs) {
      const rate = BigInt(this.venue(venue)!.terms[r.termsVersion - 1]!.rewardBps);
      const slice = (amount * BigInt(r.bps) * rate) / 100_000_000n;
      pool += slice;
      cashback += (slice * 2_500n) / 10_000n;
      l1.push((slice * 5_500n) / 10_000n);
      const share = (slice * 2_000n) / 10_000n;
      const intro = (await this.getCustomer(venue, r.referrer)).introducer;
      const pays = intro !== zeroAddress && intro.toLowerCase() !== customer.toLowerCase();
      l2r.push(pays ? intro : zeroAddress);
      l2.push(share);
      if (pays) paidL2 += share;
    }
    const top = refs.reduce((best, r, i) => (r.bps > refs[best]!.bps ? i : best), 0);
    return {
      firstPurchase: true,
      rewarded: true,
      weightsMode: mode,
      amount,
      rewardPool: pool,
      cashback,
      venueAmount: amount - cashback - l1.reduce((a, b) => a + b, 0n) - paidL2,
      introducer: refs[top]!.referrer,
      referrers: refs.map((r) => r.referrer),
      bps: refs.map((r) => r.bps),
      termsVersions: refs.map((r) => r.termsVersion),
      l1Amounts: l1,
      l2Recipients: l2r,
      l2Amounts: l2,
    };
  }

  // ------------------------------------------------------------------ contract rules (simulate + apply)
  private check(fn: string, args: readonly unknown[], from: Address): Revert | null {
    const forced = this.forceRevert.get(fn);
    if (forced) {
      this.forceRevert.delete(fn);
      return forced;
    }
    if (fn === 'registerVenue') {
      const [owner, salt, , deadline] = args as [Address, Hex, unknown, bigint];
      if (this.venue(computeVenueId(owner, salt))) return { name: 'VenueAlreadyRegistered' };
      if (this.time > deadline) return { name: 'SignatureExpired' };
    } else if (fn === 'setSeedAmbassador' || fn === 'updateTerms' || fn === 'setKeys') {
      if (!this.venue(args[0] as Address)) return { name: 'UnknownVenue' };
    } else if (fn === 'acceptIntro') {
      const [intro, , acc] = args as [{ venue: Address; referrer: Address; linkType: number; expiresAt: bigint }, Hex, { introHash: Hex; customer: Address; deadline: bigint }];
      if (intro.referrer.toLowerCase() === acc.customer.toLowerCase()) return { name: 'SelfReferral' };
      if (this.customers.get(k(intro.venue, acc.customer))?.verified) return { name: 'CustomerAlreadyVerified' };
      if (this.used.has(intro.linkType === 0 ? acc.introHash.toLowerCase() : k(acc.introHash, acc.customer))) return { name: 'IntroAlreadyUsed' };
      if (!(this.seeds.has(k(intro.venue, intro.referrer)) || this.customers.get(k(intro.venue, intro.referrer))?.verified)) return { name: 'ReferrerNotEligible' };
      if (this.time > intro.expiresAt) return { name: 'IntroExpired' };
    } else if (fn === 'pay') {
      const [order, , , , auth] = args as [{ venue: Address; orderId: Hex; amount: bigint; expiresAt: bigint }, Hex, Weights, Hex, { customer: Address; amount: bigint; deadline: bigint; submitter: Address }];
      if (this.settled.has(k(order.venue, order.orderId))) return { name: 'OrderAlreadySettled' };
      if (this.time > order.expiresAt) return { name: 'OrderExpired' };
      if (this.time >= auth.deadline) return { name: 'AuthExpired' };
      if (from.toLowerCase() !== auth.submitter.toLowerCase()) return { name: 'UnauthorizedSubmitter' };
      if ((this.balances.get(auth.customer.toLowerCase()) ?? 0n) < auth.amount) return { name: 'Error', reason: 'ERC20: transfer amount exceeds balance' };
    }
    return null;
  }

  private async apply(fn: string, args: readonly unknown[]) {
    if (fn === 'registerVenue') {
      const [owner, salt, cfg] = args as [Address, Hex, { payout: Address; signer: Address; attributor: Address; rewardBps: number; minOrder: bigint }];
      this.venues.set(computeVenueId(owner, salt).toLowerCase(), {
        owner: getAddress(owner),
        termsVersion: 1,
        registeredAt: this.time,
        payout: cfg.payout,
        signer: cfg.signer,
        attributor: cfg.attributor,
        terms: [{ version: 1, rewardBps: cfg.rewardBps, effectiveAt: this.time, minOrder: cfg.minOrder }],
      });
      this.bumpOwner(owner);
    } else if (fn === 'setSeedAmbassador') {
      const [venue, a, allowed] = args as [Address, Address, boolean];
      if (allowed) this.seeds.add(k(venue, a));
      else this.seeds.delete(k(venue, a));
      this.bumpOwner(this.venue(venue)!.owner);
    } else if (fn === 'updateTerms') {
      const [venue, rewardBps, minOrder] = args as [Address, number, bigint];
      const s = this.venue(venue)!;
      s.terms.push({ version: s.terms.length + 1, rewardBps, minOrder, effectiveAt: this.time });
      this.bumpOwner(s.owner);
    } else if (fn === 'setKeys') {
      const [venue, payout, signer, attributor] = args as [Address, Address, Address, Address];
      Object.assign(this.venue(venue)!, { payout, signer, attributor });
      this.bumpOwner(this.venue(venue)!.owner);
    } else if (fn === 'acceptIntro') {
      const [intro, , acc] = args as [{ venue: Address; referrer: Address; termsVersion: number; linkType: number; expiresAt: bigint }, Hex, { introHash: Hex; customer: Address }];
      const key = k(intro.venue, acc.customer);
      const slots = (this.live.get(key) ?? []).filter((s) => s.referrer.toLowerCase() !== intro.referrer.toLowerCase());
      slots.push({ referrer: intro.referrer, termsVersion: intro.termsVersion, linkType: intro.linkType, acceptedAt: this.time, expiresAt: intro.expiresAt, introHash: acc.introHash });
      this.live.set(key, slots);
      this.used.add(intro.linkType === 0 ? acc.introHash.toLowerCase() : k(acc.introHash, acc.customer));
    } else if (fn === 'pay') {
      const [order, , weights, sig, auth] = args as [{ venue: Address; orderId: Hex; amount: bigint }, Hex, Weights, Hex, { customer: Address; weightsHash: Hex }];
      await this.settle(order.venue, auth.customer, order.orderId, order.amount, weights, sig, auth.weightsHash);
    }
  }

  /** Settle an order (also used by tests to model a customer self-submit that wins the race, QE-C-10). */
  async settle(venue: Address, customer: Address, orderId: Hex, amount: bigint, weights: Weights = { venue: zeroAddress, customer: zeroAddress, orderId: zeroHash, referrers: [], bps: [] }, sig: Hex = '0x', weightsHash: Hex = zeroHash) {
    const q = await this.previewPayment(venue, customer, orderId, amount, weights, sig, weightsHash);
    const move = (a: Address, d: bigint) => this.balances.set(a.toLowerCase(), (this.balances.get(a.toLowerCase()) ?? 0n) + d);
    move(customer, -amount + q.cashback);
    q.referrers.forEach((r, i) => move(r, q.l1Amounts[i]!));
    q.l2Recipients.forEach((r, i) => r !== zeroAddress && move(r, q.l2Amounts[i]!));
    move(this.venue(venue)!.payout, q.venueAmount);
    this.settled.add(k(venue, orderId));
    const prev = await this.getCustomer(venue, customer);
    if (!prev.verified) this.customers.set(k(venue, customer), { verified: true, rewarded: q.rewarded, introCount: 0, introducer: q.rewarded ? q.introducer : zeroAddress, verifiedAt: this.time });
    this.live.delete(k(venue, customer));
    return q;
  }

  // ------------------------------------------------------------------ relayer primitives
  private decode(data: Hex) {
    const d = decodeFunctionData({ abi: vouchAbi, data });
    return { fn: d.functionName as string, args: (d.args ?? []) as readonly unknown[] };
  }
  async pendingNonce() {
    return this.nonce;
  }
  async latestNonce() {
    return this.nonce;
  }
  async fees() {
    return this.feeQuote;
  }
  async simulate(data: Hex): Promise<SimResult> {
    const { fn, args } = this.decode(data);
    this.calls.push(`simulate:${fn}`);
    const r = this.check(fn, args, this.relayer!);
    return r ? { ok: false, revert: r } : { ok: true };
  }
  async estimateGas(data: Hex) {
    return this.gasOverride ?? this.gasByFn[this.decode(data).fn] ?? 200_000n;
  }
  async send(tx: TxRequest): Promise<Hex> {
    if (tx.nonce !== this.nonce) throw new Error(tx.nonce < this.nonce ? 'nonce too low' : 'nonce too high');
    const { fn, args } = this.decode(tx.data);
    const hash = keccak256(toHex(`tx:${this.sent.length}:${tx.nonce}:${tx.data}`));
    this.sent.push({ ...tx, fn, hash });
    this.calls.push(`send:${fn}`);
    const revert = this.check(fn, args, this.relayer!);
    if (!revert) await this.apply(fn, args);
    this.nonce++;
    this.block++;
    this.time += 1n;
    this.receipts.set(hash, { status: revert ? 'reverted' : 'success', blockNumber: this.block, gasUsed: 200_000n, effectiveGasPrice: tx.maxFeePerGas, from: this.relayer! });
    return hash;
  }
  async receipt(hash: Hex) {
    return this.receipts.get(hash) ?? null;
  }
  async relayerBalance() {
    return this.relayerNative;
  }
}
