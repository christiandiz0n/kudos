/**
 * The relayer: ONE EOA (RELAYER_PRIVATE_KEY) submits every user-signed call to Vouch and pays the gas.
 *
 * Design (D-801):
 *   - Strictly serialized: one job at a time holds the lock from simulation until its receipt (Arc blocks ≈ 0.7 s, so
 *     throughput is ~1 tx/s, plenty for the demo). Every simulation therefore runs on top of the previous tx's state,
 *     and there is at most one in-flight nonce.
 *   - Nonce manager: before each job, compare the local nonce with the chain's `pending` count. Chain ahead (key used
 *     elsewhere) → adopt it. Chain behind (a tx we sent was dropped → gap) → reuse the lower nonce, filling the gap.
 *     "nonce too low" on send → resync and retry.
 *   - Retries with fee bump: if no receipt within `receiptTimeoutMs`, re-send the SAME nonce with fees × 1.25
 *     (replacement), up to `maxSendAttempts`, never above `maxFeePerGasCap`. Transport errors back off and retry.
 *   - Guards before sending: eth_call simulation (a revert is TERMINAL; e.g. OrderAlreadySettled, QE-C-10), an optional
 *     job pre-flight (e.g. customer balance, QE-C-11), the max-gas guard (estimate × 1.2 must be ≤ the per-kind cap),
 *     the fee cap and the relayer's own balance.
 *   - Limits: per-user and global per-minute rate limits, and a max queue depth.
 * `submit()` resolves once the tx is BROADCAST ("pending"), with `done` resolving at the receipt. "Settled" is never
 * decided here: it comes from Streams-derived state.
 */
import { randomUUID } from 'node:crypto';
import type { Hex } from 'viem';
import { ARC_MIN_MAX_FEE_PER_GAS } from '@vouch/shared';
import type { RelayKind, RelayerLimits } from '../config';
import { ApiError } from '../http/errors';
import type { Fees, ReceiptLite, RelayChain } from '../chain/client';
import { classifySendError, revertToApiError } from '../chain/errors';
import { RateLimiter } from './rate-limit';

export interface RelayJob {
  kind: RelayKind;
  /** Calldata for the Vouch contract. */
  data: Hex;
  /** Rate-limit key: the session address (or IP). */
  user: string;
  /** Domain reference (payment intent id, owner action id, …) stored with the relay row. */
  ref: string;
  /** Runs inside the lock right before estimating; throw an ApiError to refuse (terminal). */
  preflight?: () => Promise<void>;
}

export type RelayStatus = 'queued' | 'sent' | 'mined' | 'reverted' | 'failed';

export interface RelayRow {
  id: string;
  kind: RelayKind;
  ref: string;
  user: string;
  status: RelayStatus;
  nonce: number | null;
  hash: Hex | null;
  hashes: Hex[];
  attempts: number;
  gasLimit: bigint | null;
  maxFeePerGas: bigint | null;
  gasUsed: bigint | null;
  blockNumber: bigint | null;
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
  pollMs?: number;
  /** Transport retries per step (simulate/estimate/fees/send). */
  transportRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  store?: RelayStore;
  onUpdate?: (row: RelayRow) => void;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

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

export class Relayer {
  readonly nonces = new NonceManager();
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;
  private readonly perUser: RateLimiter;
  private readonly global: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly transportRetries: number;

  constructor(
    readonly chain: RelayChain,
    readonly opts: RelayerOptions,
  ) {
    const now = opts.now ?? Date.now;
    this.perUser = new RateLimiter(opts.limits.perUserPerMinute, 60_000, now);
    this.global = new RateLimiter(opts.limits.globalPerMinute, 60_000, now);
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
    if (!this.chain.relayer) throw new ApiError('RELAYER_DOWN', { details: { reason: 'relayer key not configured' } });
    if (this.depth >= this.opts.limits.maxQueue) throw new ApiError('RELAYER_BUSY', { details: { queueDepth: this.depth } });
    const userKey = `u:${job.user.toLowerCase()}`;
    if (!this.perUser.take(userKey)) {
      throw new ApiError('RATE_LIMITED', { details: { scope: 'user', retryAfterMs: this.perUser.retryAfterMs(userKey) } });
    }
    if (!this.global.take('global')) {
      this.perUser.refund(userKey);
      throw new ApiError('RELAYER_BUSY', { details: { scope: 'global', retryAfterMs: this.global.retryAfterMs('global') } });
    }

    const row: RelayRow = {
      id: randomUUID(),
      kind: job.kind,
      ref: job.ref,
      user: job.user,
      status: 'queued',
      nonce: null,
      hash: null,
      hashes: [],
      attempts: 0,
      gasLimit: null,
      maxFeePerGas: null,
      gasUsed: null,
      blockNumber: null,
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
      this.global.refund('global');
      throw new ApiError('INTERNAL', { cause: e });
    }

    let resolveSent!: (h: Hex) => void;
    let rejectSent!: (e: ApiError) => void;
    const sent = new Promise<Hex>((res, rej) => {
      resolveSent = res;
      rejectSent = rej;
    });
    sent.catch(() => {});

    const done = new Promise<RelayOutcome>((resolveDone) => {
      this.tail = this.tail
        .then(() => this.run(job, row, resolveSent))
        .then(
          (outcome) => {
            if (outcome.status === 'failed') rejectSent(outcome.error);
            resolveDone(outcome);
          },
          (e: unknown) => {
            const err = e instanceof ApiError ? e : new ApiError('INTERNAL', { cause: e });
            rejectSent(err);
            resolveDone({ status: 'failed', error: err, row });
          },
        )
        .finally(() => {
          this.depth--;
        });
    });
    const hash = await sent;
    return { id: row.id, hash, done };
  }

  private async patch(row: RelayRow, p: Partial<RelayRow>) {
    Object.assign(row, p);
    try {
      await this.opts.store?.update(row.id, p);
    } catch (e) {
      this.opts.log?.('relay store update failed', { id: row.id, err: String(e) });
    }
    this.opts.onUpdate?.({ ...row });
  }

  private async fail(row: RelayRow, err: ApiError): Promise<RelayOutcome> {
    await this.patch(row, { status: 'failed', errorCode: err.code, error: err.details ? JSON.stringify(err.details) : err.message });
    return { status: 'failed', error: err, row };
  }

  /** Retry a read-ish RPC step on transport errors; anything else propagates. */
  private async rpc<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i <= this.transportRetries; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        if (classifySendError(e) !== 'transport') throw e;
        this.opts.log?.(`relayer ${label} transport error, retrying`, { attempt: i });
        await this.sleep(Math.min(250 * 2 ** i, 4_000));
      }
    }
    throw new ApiError('RELAYER_DOWN', { cause: last, details: { step: label } });
  }

  private async run(job: RelayJob, row: RelayRow, onSent: (h: Hex) => void): Promise<RelayOutcome> {
    try {
      // 1. Simulate on top of the latest state (a revert is terminal: never retried, never paid for).
      const sim = await this.rpc('simulate', () => this.chain.simulate(job.data));
      if (!sim.ok) return this.fail(row, revertToApiError(sim.revert));
      // 2. Job pre-flight (e.g. QE-C-11 balance check).
      if (job.preflight) {
        try {
          await job.preflight();
        } catch (e) {
          return this.fail(row, e instanceof ApiError ? e : new ApiError('INTERNAL', { cause: e }));
        }
      }
      // 3. Max-gas guard.
      const est = await this.rpc('estimateGas', () => this.chain.estimateGas(job.data));
      const gasLimit = (est * 12n + 9n) / 10n;
      const cap = this.opts.maxGas[job.kind];
      if (gasLimit > cap) return this.fail(row, new ApiError('GAS_TOO_HIGH', { details: { kind: job.kind, gasLimit: gasLimit.toString(), cap: cap.toString() } }));
      // 4. Fees (≥ 20 gwei, ≤ cap) and the relayer's own balance.
      let fees = await this.rpc('fees', () => this.chain.fees());
      fees = clampFees(fees);
      if (fees.maxFeePerGas > this.opts.maxFeePerGasCap) {
        return this.fail(row, new ApiError('GAS_TOO_HIGH', { details: { maxFeePerGas: fees.maxFeePerGas.toString(), cap: this.opts.maxFeePerGasCap.toString() } }));
      }
      const bal = await this.rpc('balance', () => this.chain.relayerBalance());
      if (bal < gasLimit * fees.maxFeePerGas) return this.fail(row, new ApiError('RELAYER_UNDERFUNDED'));
      await this.patch(row, { gasLimit, maxFeePerGas: fees.maxFeePerGas });

      // 5. Nonce + send, with replacement on timeout.
      let nonce = await this.rpc('nonce', () => this.nonces.next(this.chain));
      let broadcast = false;
      let nonceRetries = 0;
      for (let attempt = 0; attempt < this.opts.maxSendAttempts; ) {
        let hash: Hex;
        try {
          hash = await this.chain.send({ data: job.data, nonce, gas: gasLimit, ...fees });
        } catch (e) {
          const kind = classifySendError(e);
          this.opts.log?.('relayer send error', { kind, attempt, nonce, err: e instanceof Error ? e.message.slice(0, 200) : String(e) });
          if (kind === 'nonce_low' && nonceRetries < 3) {
            nonceRetries++;
            // Our nonce was used (by an earlier replacement that did mine, or externally). If one of OUR hashes
            // for this job mined, that is the outcome.
            const mined = await this.findReceipt(row.hashes);
            if (mined) return this.finish(row, nonce, mined.hash, mined.receipt);
            this.nonces.reset();
            nonce = await this.rpc('nonce', () => this.nonces.next(this.chain));
            continue;
          }
          if (kind === 'insufficient_funds') return this.fail(row, new ApiError('RELAYER_UNDERFUNDED'));
          if (kind === 'underpriced' || kind === 'already_known') {
            attempt++;
            fees = this.bumped(fees);
            continue;
          }
          if (kind === 'transport') {
            attempt++;
            await this.sleep(Math.min(500 * 2 ** attempt, 4_000));
            continue;
          }
          if (!broadcast) return this.fail(row, new ApiError('TX_FAILED', { cause: e }));
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
          return this.fail(row, new ApiError('TX_FAILED', { details: { reason: 'nonce consumed by another transaction' } }));
        }
        attempt++;
        fees = this.bumped(fees);
        if (fees.maxFeePerGas > this.opts.maxFeePerGasCap) break;
      }
      // Gave up: leave the nonce to be recovered (gap fill) by the next job.
      this.nonces.reset();
      return this.fail(row, new ApiError(broadcast ? 'TX_FAILED' : 'RELAYER_DOWN', { details: { reason: 'no receipt after retries', hashes: row.hashes } }));
    } catch (e) {
      if (e instanceof ApiError) return this.fail(row, e);
      if (classifySendError(e) === 'transport') return this.fail(row, new ApiError('RELAYER_DOWN', { cause: e }));
      return this.fail(row, new ApiError('INTERNAL', { cause: e, details: { reason: e instanceof Error ? e.message.slice(0, 200) : String(e) } }));
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
    await this.patch(row, {
      status,
      hash,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
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
