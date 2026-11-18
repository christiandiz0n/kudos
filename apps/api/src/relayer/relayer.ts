/**
 * The relayer: ONE EOA (RELAYER_PRIVATE_KEY) submits every user-signed call to Vouch and pays the gas.
 *
 * Design (D-801, hardened by D-808):
 *   - Strictly serialized: one job at a time holds the worker from simulation until its receipt (Arc blocks ≈ 0.7 s).
 *     Every simulation therefore runs on top of the previous tx's state, and at most one nonce is ever in flight.
 *   - Priority lane: `pay` jobs run before any other queued kind, and `payReserve` queue slots are reserved for them,
 *     so venue/intro traffic can never starve customer payments (SEC-2-02).
 *   - Nonce manager: chain ahead (key used elsewhere) → adopt; chain behind (dropped tx → gap) → reuse the lower nonce;
 *     "nonce too low" on send → resync and retry.
 *   - Retries with fee bump: no receipt within `receiptTimeoutMs` → re-send the SAME nonce with fees × 1.25, up to
 *     `maxSendAttempts`, never above `maxFeePerGasCap`, and only while the spend budget allows the bigger reservation.
 *   - Guards before sending: eth_call simulation (a revert is TERMINAL, e.g. OrderAlreadySettled, QE-C-10), a job
 *     pre-flight (e.g. customer balance, QE-C-11), the max-gas guard, the fee cap, the relayer balance floor, and the
 *     spend budget (global / per user / per venue, hourly + daily, D-808). Reverted spend is settled into the budget.
 *   - Limits at submit: per-user and global per-minute rates, per-user per-kind quotas, queue depth, budget open.
 * `submit()` resolves once the tx is BROADCAST ("pending"); `done` resolves at the receipt. "Settled" is never decided
 * here: it comes from Streams-derived state.
 */
import { randomUUID } from 'node:crypto';
import type { Address, Hex } from 'viem';
import { ARC_MIN_MAX_FEE_PER_GAS, nativeToUsdcBaseUnits } from '@vouch/shared';
import type { RelayKind, RelayerLimits, SpendBudgetConfig } from '../config';
import { ApiError } from '../http/errors';
import { errText } from '../http/redact';
import type { Fees, ReceiptLite, RelayChain } from '../chain/client';
import { classifySendError, revertToApiError } from '../chain/errors';
import { SpendBudget } from './budget';
import { RateLimiter } from './rate-limit';

export interface RelayJob {
  kind: RelayKind;
  /** Calldata for the target (default the Vouch contract). */
  data: Hex;
  /** Call target; default Vouch. The demo top-up sends an ERC-20 transfer to USDC (D-811). */
  to?: Address;
  /**
   * Not charged to the spend budget (D-808) and not gated by it: the demo top-up has its own caps (D-811). The job
   * still goes through this queue and nonce manager, rates, simulation, gas cap, fee cap and the balance floor.
   */
  budgetExempt?: boolean;
  /** Rate-limit / budget identity: the session address. */
  user: string;
  /** Venue the job belongs to (per-venue budget). */
  venue?: string | null;
  /** Domain reference (payment intent id, owner action id, …) stored with the relay row. */
  ref: string;
  /** Runs inside the worker right before estimating; throw an ApiError to refuse (terminal). */
  preflight?: () => Promise<void>;
}

export type RelayStatus = 'queued' | 'sent' | 'mined' | 'reverted' | 'failed';

export interface RelayRow {
  id: string;
  kind: RelayKind;
  ref: string;
  user: string;
  venue: string | null;
  status: RelayStatus;
  nonce: number | null;
  hash: Hex | null;
  hashes: Hex[];
  attempts: number;
  gasLimit: bigint | null;
  maxFeePerGas: bigint | null;
  gasUsed: bigint | null;
  blockNumber: bigint | null;
  /** Spend charged to the budget, USDC base units (reservation until the receipt, then the actual fee). */
  feeUsdc: bigint | null;
  errorCode: string | null;
  error: string | null;
}

export type RelayOutcome =
  | { status: 'mined'; hash: Hex; receipt: ReceiptLite; row: RelayRow }
  | { status: 'reverted'; hash: Hex; receipt: ReceiptLite; row: RelayRow }
  | { status: 'failed'; error: ApiError; row: RelayRow };

export interface RelayHandle {
  id: string;
  hash: Hex;
  done: Promise<RelayOutcome>;
}

export interface RelayStore {
  insert(row: RelayRow): Promise<void>;
  update(id: string, patch: Partial<RelayRow>): Promise<void>;
}

export interface RelayerOptions {
  maxGas: Record<RelayKind, bigint>;
  maxFeePerGasCap: bigint;
  receiptTimeoutMs: number;
  maxSendAttempts: number;
  limits: RelayerLimits;
  budget?: SpendBudgetConfig;
  pollMs?: number;
  /** Transport retries per step (simulate/estimate/fees/send). */
  transportRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  store?: RelayStore;
  onUpdate?: (row: RelayRow) => void;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/** No budget configured (unit tests): effectively unlimited. */
const UNLIMITED: SpendBudgetConfig = {
  globalHourly: 10n ** 30n,
  globalDaily: 10n ** 30n,
  perUserHourly: 10n ** 30n,
  perUserDaily: 10n ** 30n,
  perVenueHourly: 10n ** 30n,
  perVenueDaily: 10n ** 30n,
  minRelayerBalance: 0n,
};

export class NonceManager {
  private local: number | null = null;
  gapsRecovered = 0;
  externalAdvances = 0;

  /** Chain `pending` vs local: adopt the chain when it is ahead, fill a gap when it is behind. */
  async next(chain: RelayChain): Promise<number> {
    const pending = await chain.pendingNonce();
    if (this.local === null) this.local = pending;
    else if (pending > this.local) {
      this.externalAdvances++;
      this.local = pending;
    } else if (pending < this.local) {
      this.gapsRecovered++;
      this.local = pending;
    }
    return this.local;
  }
  commit(nonce: number) {
    this.local = nonce + 1;
  }
  reset() {
    this.local = null;
  }
  peek() {
    return this.local;
  }
}

const BUMP_NUM = 125n;
const BUMP_DEN = 100n;
const bump = (v: bigint) => (v * BUMP_NUM + BUMP_DEN - 1n) / BUMP_DEN;

interface Queued {
  job: RelayJob;
  row: RelayRow;
  onSent: (h: Hex) => void;
  onDone: (o: RelayOutcome) => void;
}

export class Relayer {
  readonly nonces = new NonceManager();
  readonly budget: SpendBudget;
  private readonly queue: Queued[] = [];
  private running = false;
  private depth = 0;
  private readonly perUser: RateLimiter;
  private readonly global: RateLimiter;
  private readonly kindLimiters = new Map<RelayKind, RateLimiter>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly transportRetries: number;
  private lowBalanceWarned = false;

  constructor(
    readonly chain: RelayChain,
    readonly opts: RelayerOptions,
  ) {
    const now = opts.now ?? Date.now;
    this.perUser = new RateLimiter(opts.limits.perUserPerMinute, 60_000, now);
    this.global = new RateLimiter(opts.limits.globalPerMinute, 60_000, now);
    for (const [kind, q] of Object.entries(opts.limits.kindQuota ?? {}) as [RelayKind, { max: number; windowMs: number }][]) {
      this.kindLimiters.set(kind, new RateLimiter(q.max, q.windowMs, now));
    }
    this.budget = new SpendBudget(opts.budget ?? UNLIMITED, now);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = opts.pollMs ?? 700;
    this.transportRetries = opts.transportRetries ?? 3;
  }

  get address() {
    return this.chain.relayer;
  }
  get queueDepth() {
    return this.depth;
  }

  /** Enqueue a job. Resolves at broadcast; rejects with an ApiError if refused before anything was sent. */
  async submit(job: RelayJob): Promise<RelayHandle> {
    if (!this.chain.relayer) throw new ApiError('RELAYER_DOWN');
    const maxQueue = this.opts.limits.maxQueue;
    const reserve = Math.min(this.opts.limits.payReserve ?? 0, maxQueue - 1);
    const cap = job.kind === 'pay' ? maxQueue : maxQueue - reserve;
    if (this.depth >= cap) throw new ApiError('RELAYER_BUSY', { details: { queueDepth: this.depth } });
    const venue = job.venue ?? null;
    // Budget gate first (no counters consumed if it is closed).
    if (!job.budgetExempt) this.budget.assertOpen(job.user, venue);
    const userKey = `u:${job.user.toLowerCase()}`;
    if (!this.perUser.take(userKey)) {
      throw new ApiError('RATE_LIMITED', { details: { scope: 'user', retryAfterMs: this.perUser.retryAfterMs(userKey) } });
    }
    const kindLimiter = this.kindLimiters.get(job.kind);
    if (kindLimiter && !kindLimiter.take(userKey)) {
      this.perUser.refund(userKey);
      throw new ApiError('SPEND_QUOTA_EXCEEDED', { details: { scope: 'kind', kind: job.kind, retryAfterMs: kindLimiter.retryAfterMs(userKey) } });
    }
    if (!this.global.take('global')) {
      this.perUser.refund(userKey);
      kindLimiter?.refund(userKey);
      throw new ApiError('RELAYER_BUSY', { details: { scope: 'global', retryAfterMs: this.global.retryAfterMs('global') } });
    }

    const row: RelayRow = {
      id: randomUUID(),
      kind: job.kind,
      ref: job.ref,
      user: job.user,
      venue,
      status: 'queued',
      nonce: null,
      hash: null,
      hashes: [],
      attempts: 0,
      gasLimit: null,
      maxFeePerGas: null,
      gasUsed: null,
      blockNumber: null,
      feeUsdc: null,
      errorCode: null,
      error: null,
    };
    // Reserve the queue slot synchronously (before any await) so concurrent submits can't overshoot maxQueue.
    this.depth++;
    try {
      await this.opts.store?.insert(row);
    } catch (e) {
      this.depth--;
      this.perUser.refund(userKey);
      kindLimiter?.refund(userKey);
      this.global.refund('global');
      this.opts.log?.('relay store insert failed', { err: errText(e) });
      throw new ApiError('INTERNAL');
    }

    let resolveSent!: (h: Hex) => void;
    let rejectSent!: (e: ApiError) => void;
    const sent = new Promise<Hex>((res, rej) => {
      resolveSent = res;
      rejectSent = rej;
    });
    sent.catch(() => {});
    const done = new Promise<RelayOutcome>((resolveDone) => {
      this.queue.push({
        job,
        row,
        onSent: resolveSent,
        onDone: (o) => {
          if (o.status === 'failed') rejectSent(o.error);
          resolveDone(o);
        },
      });
    });
    void this.pump();
    const hash = await sent;
    return { id: row.id, hash, done };
  }

  /** Worker: one job at a time; `pay` first, FIFO within a lane. */
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const i = this.queue.findIndex((q) => q.job.kind === 'pay');
        const next = this.queue.splice(i >= 0 ? i : 0, 1)[0];
        if (!next) break;
        let outcome: RelayOutcome;
        try {
          outcome = await this.run(next.job, next.row, next.onSent);
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError('INTERNAL');
          outcome = { status: 'failed', error: err, row: next.row };
        }
        this.depth--;
        next.onDone(outcome);
      }
    } finally {
      this.running = false;
    }
  }

  private async patch(row: RelayRow, p: Partial<RelayRow>) {
    Object.assign(row, p);
    try {
      await this.opts.store?.update(row.id, p);
    } catch (e) {
      this.opts.log?.('relay store update failed', { id: row.id, err: errText(e) });
    }
    this.opts.onUpdate?.({ ...row });
  }

  private async fail(row: RelayRow, err: ApiError, broadcast = false): Promise<RelayOutcome> {
    // Nothing broadcast → nothing spent; otherwise keep the reservation (the tx may still mine).
    if (!broadcast) this.budget.release(row.id);
    await this.patch(row, {
      status: 'failed',
      errorCode: err.code,
      error: err.details ? JSON.stringify(err.details).slice(0, 500) : err.code,
      ...(broadcast ? {} : { feeUsdc: null }),
    });
    return { status: 'failed', error: err, row };
  }

  /** Retry a read-ish RPC step on transport errors; anything else propagates. */
  private async rpc<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let i = 0; i <= this.transportRetries; i++) {
      try {
        return await fn();
      } catch (e) {
        if (classifySendError(e) !== 'transport') throw e;
        this.opts.log?.(`relayer ${label} transport error, retrying`, { attempt: i });
        await this.sleep(Math.min(250 * 2 ** i, 4_000));
      }
    }
    throw new ApiError('RELAYER_DOWN', { details: { step: label } });
  }

  private async run(job: RelayJob, row: RelayRow, onSent: (h: Hex) => void): Promise<RelayOutcome> {
    let broadcast = false;
    try {
      // 1. Simulate on top of the latest state (a revert is terminal: never retried, never paid for).
      const sim = await this.rpc('simulate', () => this.chain.simulate(job.data, job.to));
      if (!sim.ok) return this.fail(row, revertToApiError(sim.revert));
      // 2. Job pre-flight (e.g. QE-C-11 balance check).
      if (job.preflight) {
        try {
          await job.preflight();
        } catch (e) {
          return this.fail(row, e instanceof ApiError ? e : new ApiError('INTERNAL'));
        }
      }
      // 3. Max-gas guard.
      const est = await this.rpc('estimateGas', () => this.chain.estimateGas(job.data, job.to));
      const gasLimit = (est * 12n + 9n) / 10n;
      const cap = this.opts.maxGas[job.kind];
      if (gasLimit > cap) return this.fail(row, new ApiError('GAS_TOO_HIGH', { details: { kind: job.kind, gasLimit: gasLimit.toString(), cap: cap.toString() } }));
      // 4. Fees (≥ 20 gwei, ≤ cap), relayer balance floor, spend budget.
      let fees = clampFees(await this.rpc('fees', () => this.chain.fees()));
      if (fees.maxFeePerGas > this.opts.maxFeePerGasCap) {
        return this.fail(row, new ApiError('GAS_TOO_HIGH', { details: { maxFeePerGas: fees.maxFeePerGas.toString(), cap: this.opts.maxFeePerGasCap.toString() } }));
      }
      const bal = await this.rpc('balance', () => this.chain.relayerBalance());
      const floor = (this.opts.budget ?? UNLIMITED).minRelayerBalance * 10n ** 12n;
      if (bal < gasLimit * fees.maxFeePerGas + floor) {
        if (!this.lowBalanceWarned) this.opts.log?.('ALERT relayer balance below floor; relaying paused', { balanceUsdc: nativeToUsdcBaseUnits(bal).toString() });
        this.lowBalanceWarned = true;
        return this.fail(row, new ApiError('RELAYER_UNDERFUNDED'));
      }
      this.lowBalanceWarned = false;
      const reservation = SpendBudget.costOf(gasLimit, fees.maxFeePerGas);
      if (!job.budgetExempt) {
        try {
          this.budget.reserve(row.id, reservation, job.user, row.venue);
        } catch (e) {
          return this.fail(row, e instanceof ApiError ? e : new ApiError('RELAYER_BUDGET_EXHAUSTED'));
        }
      }
      // Exempt jobs have no budget entry: growing their (absent) reservation is always allowed.
      const adjust = (cost: bigint) => job.budgetExempt || this.budget.adjust(row.id, cost);
      await this.patch(row, { gasLimit, maxFeePerGas: fees.maxFeePerGas, feeUsdc: reservation });

      // 5. Nonce + send, with replacement on timeout.
      let nonce = await this.rpc('nonce', () => this.nonces.next(this.chain));
      let nonceRetries = 0;
      for (let attempt = 0; attempt < this.opts.maxSendAttempts; ) {
        let hash: Hex;
        try {
          hash = await this.chain.send({ data: job.data, ...(job.to ? { to: job.to } : {}), nonce, gas: gasLimit, ...fees });
        } catch (e) {
          const kind = classifySendError(e);
          this.opts.log?.('relayer send error', { kind, attempt, nonce, err: errText(e) });
          if (kind === 'nonce_low' && nonceRetries < 3) {
            nonceRetries++;
            const mined = await this.findReceipt(row.hashes);
            if (mined) return this.finish(row, nonce, mined.hash, mined.receipt);
            this.nonces.reset();
            nonce = await this.rpc('nonce', () => this.nonces.next(this.chain));
            continue;
          }
          if (kind === 'insufficient_funds') return this.fail(row, new ApiError('RELAYER_UNDERFUNDED'), broadcast);
          if (kind === 'underpriced' || kind === 'already_known') {
            attempt++;
            const next = this.bumped(fees);
            if (!adjust(SpendBudget.costOf(gasLimit, next.maxFeePerGas))) break;
            fees = next;
            continue;
          }
          if (kind === 'transport') {
            attempt++;
            await this.sleep(Math.min(500 * 2 ** attempt, 4_000));
            continue;
          }
          if (!broadcast) return this.fail(row, new ApiError('TX_FAILED'));
          attempt++;
          continue;
        }
        row.hashes.push(hash);
        await this.patch(row, { status: 'sent', nonce, hash, hashes: [...row.hashes], attempts: attempt + 1, maxFeePerGas: fees.maxFeePerGas });
        if (!broadcast) {
          broadcast = true;
          onSent(hash);
        }
        const r = await this.waitForAny(row.hashes);
        if (r) return this.finish(row, nonce, r.hash, r.receipt);
        // Timed out: was the nonce consumed by someone else (not one of our hashes)?
        const latest = await this.rpc('nonce', () => this.chain.latestNonce());
        if (latest > nonce) {
          const late = await this.findReceipt(row.hashes);
          if (late) return this.finish(row, nonce, late.hash, late.receipt);
          this.nonces.commit(nonce);
          this.budget.release(row.id);
          return this.fail(row, new ApiError('TX_FAILED', { details: { reason: 'nonce consumed by another transaction' } }), true);
        }
        // Re-simulate before paying for a replacement (SEC-2-12): if the state moved on (e.g. the order was settled by
        // another auth, QE-C-10), a replacement would only buy a revert. Terminal; the original may still land.
        const again = await this.chain.simulate(job.data, job.to).catch(() => null);
        if (again && !again.ok) {
          const last = await this.findReceipt(row.hashes);
          if (last) return this.finish(row, nonce, last.hash, last.receipt);
          this.nonces.reset();
          return this.fail(row, revertToApiError(again.revert), true);
        }
        attempt++;
        const next = this.bumped(fees);
        if (next.maxFeePerGas > this.opts.maxFeePerGasCap) break;
        // Stop bumping when the larger worst case would exceed the spend budget (D-808).
        if (!adjust(SpendBudget.costOf(gasLimit, next.maxFeePerGas))) break;
        fees = next;
      }
      // Gave up: leave the nonce to be recovered (gap fill) by the next job.
      this.nonces.reset();
      return this.fail(row, new ApiError(broadcast ? 'TX_FAILED' : 'RELAYER_DOWN', { details: { reason: 'no receipt after retries', hashes: row.hashes } }), broadcast);
    } catch (e) {
      if (e instanceof ApiError) return this.fail(row, e, broadcast);
      this.opts.log?.('relayer job error', { kind: job.kind, err: errText(e) });
      if (classifySendError(e) === 'transport') return this.fail(row, new ApiError('RELAYER_DOWN'), broadcast);
      return this.fail(row, new ApiError('INTERNAL'), broadcast);
    }
  }

  private bumped(f: Fees): Fees {
    let maxFeePerGas = bump(f.maxFeePerGas);
    let maxPriorityFeePerGas = bump(f.maxPriorityFeePerGas);
    if (maxFeePerGas > this.opts.maxFeePerGasCap && f.maxFeePerGas < this.opts.maxFeePerGasCap) maxFeePerGas = this.opts.maxFeePerGasCap;
    if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  private async finish(row: RelayRow, nonce: number, hash: Hex, receipt: ReceiptLite): Promise<RelayOutcome> {
    this.nonces.commit(nonce);
    const status = receipt.status === 'success' ? 'mined' : 'reverted';
    // Reverted txs still cost gas: the actual fee counts against the same budgets (SEC-2-12).
    const actual = nativeToUsdcBaseUnits(receipt.gasUsed * receipt.effectiveGasPrice);
    this.budget.settle(row.id, actual);
    await this.patch(row, {
      status,
      hash,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      feeUsdc: actual,
      ...(status === 'reverted' ? { errorCode: 'TX_FAILED', error: 'reverted on chain' } : {}),
    });
    return { status, hash, receipt, row };
  }

  private async findReceipt(hashes: Hex[]): Promise<{ hash: Hex; receipt: ReceiptLite } | null> {
    for (const h of hashes) {
      const r = await this.chain.receipt(h).catch(() => null);
      if (r) return { hash: h, receipt: r };
    }
    return null;
  }

  private async waitForAny(hashes: Hex[]): Promise<{ hash: Hex; receipt: ReceiptLite } | null> {
    // Poll-count based (deterministic with an injected sleep): receiptTimeoutMs / pollMs polls.
    const maxPolls = Math.max(1, Math.ceil(this.opts.receiptTimeoutMs / Math.max(1, this.pollMs)));
    for (let polls = 0; polls < maxPolls; polls++) {
      const r = await this.findReceipt(hashes);
      if (r) return r;
      await this.sleep(this.pollMs);
    }
    return this.findReceipt(hashes);
  }
}

export function clampFees(f: Fees): Fees {
  const maxFeePerGas = f.maxFeePerGas > ARC_MIN_MAX_FEE_PER_GAS ? f.maxFeePerGas : ARC_MIN_MAX_FEE_PER_GAS;
  const maxPriorityFeePerGas = f.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : f.maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}
