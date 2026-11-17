/**
 * Per-key token bucket for POST /webhooks/streams (SEC-2-10a, D-309). In-process, no dependency.
 *
 * Sizing: QuickNode delivers SEQUENTIALLY per Stream (it waits for our 2xx before the next batch), so even a backfill
 * burst is one request per round trip, i.e. at most a few dozen req/s. Defaults: a 600-request burst and a 50 req/s
 * refill per IP (180k/hour sustained), far above any real delivery rate. A 429 is a non-2xx, so QuickNode simply
 * retries it (max_retry 20, retry_interval 1 s, D-303), and the bucket refills 50 tokens/s in the meantime.
 * Keyed on `req.ip` only: X-Forwarded-For is never parsed here (trustProxy is BACKEND_RELAYER's, SEC-2-x).
 */
export interface RateLimitOpts {
  /** Max tokens (burst). Default 600. */
  burst?: number;
  /** Refill rate, tokens per second. Default 50. */
  perSec?: number;
  /** Max tracked keys before full buckets are evicted. Default 10,000. */
  maxKeys?: number;
  /** Clock (ms), for tests. */
  now?: () => number;
}

export interface RateLimiter {
  /** true = allowed (one token taken). `retryAfterSec` is set when refused. */
  take(key: string): { ok: boolean; retryAfterSec: number; firstRefusal: boolean };
  size(): number;
}

export function createRateLimiter(o: RateLimitOpts = {}): RateLimiter {
  const burst = o.burst ?? 600;
  const perSec = o.perSec ?? 50;
  const maxKeys = o.maxKeys ?? 10_000;
  const now = o.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; at: number; refused: boolean }>();

  const refill = (b: { tokens: number; at: number }, t: number) => {
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * perSec);
    b.at = t;
  };

  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) {
          // Evict buckets that have refilled completely (they carry no state); if none, drop the oldest.
          for (const [k, v] of buckets) {
            refill(v, t);
            if (v.tokens >= burst) buckets.delete(k);
          }
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
        }
        b = { tokens: burst, at: t, refused: false };
        buckets.set(key, b);
      } else {
        refill(b, t);
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        b.refused = false;
        return { ok: true, retryAfterSec: 0, firstRefusal: false };
      }
      const firstRefusal = !b.refused;
      b.refused = true;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / perSec)), firstRefusal };
    },
    size: () => buckets.size,
  };
}
