/**
 * Relayer spend budget (D-808, SEC-2-02). Rolling hourly and daily windows over the relayer's gas spend, globally and
 * per identity (session address, venue). Amounts are USDC base units (6-dec; native wei / 1e12, rounded up).
 *
 *   reserve(job)  before the first send: gasLimit × maxFeePerGas (worst case). Refused if ANY window would overflow.
 *   adjust(job)   on a fee-bumped replacement: the reservation grows to the new worst case (refused → stop bumping).
 *   settle(job)   at the receipt (success OR revert): the reservation becomes the actual gasUsed × effectiveGasPrice,
 *                 so reverted spend counts against the same budgets.
 *   release(job)  when nothing was ever broadcast.
 * Seeded from `relay_txs` at boot (`seed`), so a restart does not reset the budget.
 */
import { nativeToUsdcBaseUnits } from '@vouch/shared';
import type { SpendBudgetConfig } from '../config';
import { ApiError } from '../http/errors';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Entry {
  t: number;
  cost: bigint;
  user: string;
  venue: string | null;
}

export interface BudgetSnapshot {
  hourly: { limit: bigint; used: bigint; remaining: bigint };
  daily: { limit: bigint; used: bigint; remaining: bigint };
}

export class SpendBudget {
  private readonly entries = new Map<string, Entry>();
  constructor(
    readonly cfg: SpendBudgetConfig,
    private readonly now: () => number = Date.now,
  ) {}

  static costOf(gasLimit: bigint, maxFeePerGasWei: bigint): bigint {
    return nativeToUsdcBaseUnits(gasLimit * maxFeePerGasWei);
  }

  private sum(windowMs: number, match: (e: Entry) => boolean, skip?: string): bigint {
    const cutoff = this.now() - windowMs;
    let s = 0n;
    for (const [id, e] of this.entries) if (id !== skip && e.t > cutoff && match(e)) s += e.cost;
    return s;
  }

  private gc() {
    const cutoff = this.now() - DAY;
    for (const [id, e] of this.entries) if (e.t <= cutoff) this.entries.delete(id);
  }

  /** Throws when adding `cost` for (user, venue) would exceed any window. `skip` excludes the job's own current entry. */
  check(cost: bigint, user: string, venue: string | null, skip?: string): void {
    const u = user.toLowerCase();
    const v = venue?.toLowerCase() ?? null;
    const all = () => true;
    const g = [this.sum(HOUR, all, skip) + cost > this.cfg.globalHourly, this.sum(DAY, all, skip) + cost > this.cfg.globalDaily];
    if (g.some(Boolean)) {
      throw new ApiError('RELAYER_BUDGET_EXHAUSTED', { details: { scope: 'global', window: g[0] ? 'hour' : 'day' } });
    }
    const byUser = (e: Entry) => e.user === u;
    if (this.sum(HOUR, byUser, skip) + cost > this.cfg.perUserHourly || this.sum(DAY, byUser, skip) + cost > this.cfg.perUserDaily) {
      throw new ApiError('SPEND_QUOTA_EXCEEDED', { details: { scope: 'user' } });
    }
    if (v) {
      const byVenue = (e: Entry) => e.venue === v;
      if (this.sum(HOUR, byVenue, skip) + cost > this.cfg.perVenueHourly || this.sum(DAY, byVenue, skip) + cost > this.cfg.perVenueDaily) {
        throw new ApiError('SPEND_QUOTA_EXCEEDED', { details: { scope: 'venue' } });
      }
    }
  }

  /** Cheap gate before queueing: refuse when any window is already at its limit. */
  assertOpen(user: string, venue: string | null): void {
    this.check(1n, user, venue);
  }

  reserve(id: string, cost: bigint, user: string, venue: string | null): void {
    this.gc();
    this.check(cost, user, venue, id);
    this.entries.set(id, { t: this.now(), cost, user: user.toLowerCase(), venue: venue?.toLowerCase() ?? null });
  }

  /** Grow a reservation (fee bump). Returns false (and keeps the old one) if it would exceed a window. */
  adjust(id: string, cost: bigint): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    if (cost <= e.cost) return true;
    try {
      this.check(cost, e.user, e.venue, id);
    } catch {
      return false;
    }
    e.cost = cost;
    return true;
  }

  settle(id: string, actual: bigint): void {
    const e = this.entries.get(id);
    if (e) e.cost = actual;
  }

  release(id: string): void {
    this.entries.delete(id);
  }

  /** Restore spend recorded in the last 24 h (boot). */
  seed(rows: { id: string; at: number; cost: bigint; user: string; venue: string | null }[]): void {
    for (const r of rows) this.entries.set(r.id, { t: r.at, cost: r.cost, user: r.user.toLowerCase(), venue: r.venue?.toLowerCase() ?? null });
    this.gc();
  }

  snapshot(): BudgetSnapshot {
    const all = () => true;
    const h = this.sum(HOUR, all);
    const d = this.sum(DAY, all);
    const rem = (lim: bigint, used: bigint) => (lim > used ? lim - used : 0n);
    return {
      hourly: { limit: this.cfg.globalHourly, used: h, remaining: rem(this.cfg.globalHourly, h) },
      daily: { limit: this.cfg.globalDaily, used: d, remaining: rem(this.cfg.globalDaily, d) },
    };
  }
}
