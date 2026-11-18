/**
 * Demo top-up (D-811, A7/D-019 #4). Judges join the live demo with a fresh wallet holding $0, so the API can send a
 * fixed testnet amount once per address, ever.
 *
 *   - Once per address: the `demo_topups` primary key plus a conditional upsert is the atomic claim. Only a `failed`
 *     row (nothing sent, or the transfer reverted) may be claimed again, so double taps and concurrent requests send
 *     one transfer.
 *   - Global cap: non-failed amounts claimed in the last 24 h (rolling) must stay ≤ DEMO_TOPUP_DAILY_USDC. The cap is
 *     checked in the same INSERT statement and claims are serialized in-process (the api runs as one Railway instance).
 *   - Per client IP: DEMO_TOPUP_PER_IP_PER_HOUR successful claims (refunded when the claim or the send is refused).
 *   - Funder: TOPUP_PRIVATE_KEY through its own serialized Relayer, or else the relayer key through THE relayer's
 *     queue and nonce manager (never a second sender on that key). Jobs are `budgetExempt`: neither the amount nor the
 *     gas counts against the relayer spend budget (D-808).
 *   - Disabled (503 TOPUP_DISABLED, not retryable) when DEMO_TOPUP_ENABLED != "true", no funder key is configured, or
 *     the funder would drop below DEMO_TOPUP_FUNDER_FLOOR_USDC after sending.
 */
import { sql } from 'drizzle-orm';
import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { ARC_TESTNET_USDC_ADDRESS } from '@vouch/shared';
import type { TopupConfig } from '../config';
import type { DbHandle } from '../db/index';
import { ApiError } from '../http/errors';
import { money } from '../http/json';
import { errText } from '../http/redact';
import { RateLimiter } from '../relayer/rate-limit';
import type { Relayer } from '../relayer/relayer';
import { SseHub } from '../sse/hub';

const HOUR = 3_600_000;
const NATIVE_PER_BASE_UNIT = 10n ** 12n;
const BALANCE_CACHE_MS = 10_000;

export type TopupStatus = 'claimed' | 'pending' | 'confirmed' | 'failed' | 'unknown';

interface TopupRow {
  address: string;
  amount: string;
  status: TopupStatus;
  relay_tx_id: string | null;
  tx_hash: string | null;
  error_code: string | null;
  claimed_at: string | Date;
}

const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : (((r as { rows?: unknown[] }).rows ?? []) as T[]));

export function topupView(r: TopupRow) {
  return {
    status: r.status,
    amount: money(BigInt(r.amount)),
    txHash: r.tx_hash,
    relayId: r.relay_tx_id,
    errorCode: r.error_code,
    claimedAt: new Date(r.claimed_at).toISOString(),
  };
}

export interface TopupEligibility {
  enabled: boolean;
  eligible: boolean;
  amount: ReturnType<typeof money>;
  dailyRemaining: ReturnType<typeof money>;
  reason?: 'TOPUP_DISABLED' | 'UNAUTHENTICATED' | 'TOPUP_ALREADY_CLAIMED' | 'TOPUP_DAILY_CAP_REACHED';
  topup: ReturnType<typeof topupView> | null;
}

export class DemoTopup {
  private readonly ipLimiter: RateLimiter;
  private chain: Promise<unknown> = Promise.resolve();
  private balanceCache: { at: number; ok: boolean } | null = null;
  private lowWarned = false;

  constructor(
    private readonly handle: DbHandle,
    readonly cfg: TopupConfig,
    /** The Relayer that sends the transfer (the main relayer, or a dedicated TOPUP_PRIVATE_KEY one). */
    readonly funder: Relayer | null,
    private readonly sse: SseHub,
    private readonly log: (msg: string, extra?: Record<string, unknown>) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.ipLimiter = new RateLimiter(cfg.perIpPerHour, HOUR, now);
  }

  /** Configured on, with a positive amount and a funder key. */
  get available(): boolean {
    return this.cfg.enabled && this.cfg.amount > 0n && !!this.funder?.address;
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Funder balance ≥ amount + floor (18-dec native = the same USDC on Arc). Fresh read when `fresh`. */
  async funderOk(fresh = false): Promise<boolean> {
    const t = this.now();
    if (!fresh && this.balanceCache && t - this.balanceCache.at < BALANCE_CACHE_MS) return this.balanceCache.ok;
    const bal = await this.funder!.chain.relayerBalance();
    const ok = bal >= (this.cfg.amount + this.cfg.funderFloor) * NATIVE_PER_BASE_UNIT;
    this.balanceCache = { at: t, ok };
    if (!ok && !this.lowWarned) this.log('ALERT demo top-up funder below floor; top-ups paused', { funder: this.funder!.address });
    this.lowWarned = !ok;
    return ok;
  }

  private async row(address: Address): Promise<TopupRow | null> {
    const r = await this.handle.db.execute(sql`select address, amount::text as amount, status, relay_tx_id, tx_hash, error_code, claimed_at from demo_topups where address = ${address}`);
    return rowsOf<TopupRow>(r)[0] ?? null;
  }

  /** Non-failed amount claimed in the last 24 h. */
  async usedToday(): Promise<bigint> {
    const r = await this.handle.db.execute(
      sql`select coalesce(sum(amount), 0)::text as used from demo_topups where status <> 'failed' and claimed_at > now() - interval '24 hours'`,
    );
    return BigInt(rowsOf<{ used: string }>(r)[0]?.used ?? '0');
  }

  async eligibility(address: Address | null): Promise<TopupEligibility> {
    const amount = money(this.cfg.amount);
    if (!this.available) return { enabled: false, eligible: false, amount, dailyRemaining: money(0n), reason: 'TOPUP_DISABLED', topup: null };
    const [row, used] = await Promise.all([address ? this.row(address) : Promise.resolve(null), this.usedToday()]);
    const remaining = this.cfg.dailyCap > used ? this.cfg.dailyCap - used : 0n;
    const funderOk = await this.funderOk().catch(() => false);
    const base = { enabled: funderOk, amount, dailyRemaining: money(remaining), topup: row ? topupView(row) : null };
    if (row && row.status !== 'failed') return { ...base, eligible: false, reason: 'TOPUP_ALREADY_CLAIMED' };
    if (!funderOk) return { ...base, eligible: false, reason: 'TOPUP_DISABLED' };
    if (remaining < this.cfg.amount) return { ...base, eligible: false, reason: 'TOPUP_DAILY_CAP_REACHED' };
    if (!address) return { ...base, eligible: false, reason: 'UNAUTHENTICATED' };
    return { ...base, eligible: true };
  }

  /** Atomic claim: once per address (PK + conditional upsert) and under the rolling-24 h cap, in one statement. */
  private async claimRow(address: Address, ipHash: string): Promise<void> {
    const amt = this.cfg.amount.toString();
    const cap = this.cfg.dailyCap.toString();
    await this.serialized(async () => {
      const r = await this.handle.db.execute(sql`
        insert into demo_topups (address, amount, status, ip_hash, attempts, claimed_at, updated_at)
        select ${address}, ${amt}::bigint, 'claimed', ${ipHash}, 1, now(), now()
        where (select coalesce(sum(amount), 0) from demo_topups
               where status <> 'failed' and claimed_at > now() - interval '24 hours' and address <> ${address}) + ${amt}::bigint <= ${cap}::bigint
        on conflict (address) do update set
          amount = excluded.amount, status = 'claimed', ip_hash = excluded.ip_hash, attempts = demo_topups.attempts + 1,
          claimed_at = now(), updated_at = now(), funder = null, relay_tx_id = null, tx_hash = null, error_code = null
        where demo_topups.status = 'failed'
        returning address`);
      if (rowsOf(r).length === 1) return;
      const existing = await this.row(address);
      if (existing && existing.status !== 'failed') {
        throw new ApiError('TOPUP_ALREADY_CLAIMED', { details: { topup: topupView(existing) } });
      }
      throw new ApiError('TOPUP_DAILY_CAP_REACHED');
    });
  }

  private async setRow(address: Address, patch: { status: TopupStatus; funder?: string | null; relayTxId?: string; txHash?: string | null; errorCode?: string | null }) {
    await this.handle.db.execute(sql`
      update demo_topups set status = ${patch.status},
        funder = coalesce(${patch.funder ?? null}, funder),
        relay_tx_id = coalesce(${patch.relayTxId ?? null}, relay_tx_id),
        tx_hash = coalesce(${patch.txHash ?? null}, tx_hash),
        error_code = ${patch.errorCode ?? null},
        updated_at = now()
      where address = ${address}`);
  }

  /** POST /demo/topup for the session address. Resolves at broadcast (202 pending). */
  async request(address: Address, ipKey: string) {
    if (!this.available) throw new ApiError('TOPUP_DISABLED');
    const funder = this.funder!;
    if (!(await this.funderOk(true))) throw new ApiError('TOPUP_DISABLED');
    if (!this.ipLimiter.take(ipKey)) {
      throw new ApiError('RATE_LIMITED', { details: { scope: 'topup_ip', retryAfterMs: this.ipLimiter.retryAfterMs(ipKey) } });
    }
    try {
      await this.claimRow(address, ipKey);
    } catch (e) {
      this.ipLimiter.refund(ipKey);
      throw e;
    }

    const amount = this.cfg.amount;
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [address, amount] });
    let handle;
    try {
      handle = await funder.submit({
        kind: 'topup',
        to: ARC_TESTNET_USDC_ADDRESS,
        data,
        user: address,
        venue: null,
        ref: `topup:${address}`,
        budgetExempt: true,
        // Inside the funder's lock, right before sending: the funder must keep its floor after this transfer.
        preflight: async () => {
          if (!(await this.funderOk(true))) throw new ApiError('TOPUP_DISABLED');
        },
      });
    } catch (e) {
      // Nothing was sent: the address may claim again later.
      await this.setRow(address, { status: 'failed', errorCode: e instanceof ApiError ? e.code : 'INTERNAL' }).catch((err) =>
        this.log('demo topup row update failed', { err: errText(err) }),
      );
      this.ipLimiter.refund(ipKey);
      throw e;
    }

    await this.setRow(address, { status: 'pending', funder: funder.address, relayTxId: handle.id, txHash: handle.hash });
    const evt = { address, status: 'pending', amount: money(amount), txHash: handle.hash, relayId: handle.id };
    this.sse.publish(SseHub.userChannel(address), 'wallet.topup', evt);
    void handle.done
      .then(async (out) => {
        // A broadcast tx with no receipt may still mine: keep it non-claimable ("unknown") so it can't be paid twice.
        const status: TopupStatus = out.status === 'mined' ? 'confirmed' : out.status === 'reverted' ? 'failed' : out.row.hash ? 'unknown' : 'failed';
        const errorCode = out.status === 'mined' ? null : out.status === 'reverted' ? 'TX_FAILED' : out.error.code;
        await this.setRow(address, { status, txHash: out.status === 'failed' ? null : out.hash, errorCode });
        if (status === 'unknown') return;
        this.sse.publish(SseHub.userChannel(address), 'wallet.topup', {
          ...evt,
          status: status === 'confirmed' ? 'confirmed' : 'failed',
          ...(out.status === 'failed' ? {} : { txHash: out.hash }),
          ...(errorCode ? { code: errorCode } : {}),
        });
      })
      .catch((err) => this.log('demo topup completion failed', { err: errText(err) }));
    return { status: 'pending' as const, amount: money(amount), txHash: handle.hash as Hex, relayId: handle.id };
  }
}
