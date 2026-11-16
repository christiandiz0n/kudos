/**
 * Fixed-capacity sliding-window rate limiter (in memory; the api is a single long-lived process, D-202).
 * `take(key)` records a hit and returns false when the key already used `limit` hits within `windowMs`.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit if allowed. */
  take(key: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.gc(t);
    return true;
  }

  /** Undo the newest hit (used when a later limiter in a chain refuses). */
  refund(key: string): void {
    this.hits.get(key)?.pop();
  }

  /** ms until the key may take again (0 when allowed now). */
  retryAfterMs(key: string): number {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length < this.limit) return 0;
    return Math.max(0, this.windowMs - (t - arr[0]!));
  }

  private gc(t: number) {
    for (const [k, arr] of this.hits) if (!arr.some((x) => t - x < this.windowMs)) this.hits.delete(k);
  }
}
