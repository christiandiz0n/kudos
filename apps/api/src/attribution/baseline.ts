/**
 * Baseline attribution (Phase 2, BACKEND_RELAYER; ATTRIBUTION_AI replaces/extends it in Phase 4 behind `Attributor`).
 *
 *   score_i = linkTypeWeight (personal 2, broadcast 1) × (1 + 0.25 × opens_i) × 2^(−age_i / 3 days)
 *   age_i   = now − acceptedAt_i (chain time, same clock as the on-chain fallback, D-502)
 *   opens_i = link opens by this customer (or anonymous), excluding the referrer's own, capped at MAX_OPENS
 *   "Who sent you here?" answer naming an eligible referrer: + 50% of the total score to that referrer
 *
 * Only ELIGIBLE intros are candidates (unexpired at `now` and `amount ≥ minOrder` of their frozen terms, D-505):
 * the contract falls back if any weighted referrer is ineligible. The result always satisfies the contract bounds
 * (D-502): 1–5 referrers, no duplicates, each bps ≥ 1, ≤ 8,000 unless single, Σ = 10,000. Rounding: largest remainder
 * (ties → lower index), so e.g. 3.5 : 1.5 → exactly 7,000 / 3,000.
 */
import type { Address, Hex } from 'viem';
import { ATTRIBUTION, MAX_REFERRERS, PER_REFERRER_CAP_BPS, BPS_DENOMINATOR } from '@vouch/shared';

export interface AttributionCandidate {
  referrer: Address;
  introHash: Hex;
  linkType: number;
  acceptedAt: bigint;
  expiresAt: bigint;
  termsVersion: number;
  /** frozen minOrder of `termsVersion` */
  minOrder: bigint;
  opens: number;
}

export interface AttributionInput {
  venue: Address;
  customer: Address;
  orderId: Hex;
  amount: bigint;
  /** chain time (seconds) */
  now: bigint;
  /** in on-chain slot order (getLiveIntros) */
  candidates: AttributionCandidate[];
  whoSentYou?: Address | null;
}

export interface CandidateScore {
  referrer: Address;
  eligible: boolean;
  reason?: 'expired' | 'below_min_order' | 'not_top_5';
  score: number;
  opens: number;
  linkType: number;
}

export interface AttributionResult {
  /** empty when nothing is eligible (then no weights are signed; the payment is plain or falls back) */
  referrers: Address[];
  bps: number[];
  method: string;
  explanation: string;
  scores: CandidateScore[];
}

export interface Attributor {
  readonly name: string;
  attribute(input: AttributionInput): Promise<AttributionResult>;
}

export const MAX_OPENS = 8;
export const ANSWER_BOOST = 0.5;

export function scoreCandidate(c: AttributionCandidate, now: bigint): number {
  const lt = ATTRIBUTION.LINK_TYPE_WEIGHT[c.linkType as 0 | 1] ?? 1;
  const opens = Math.max(0, Math.min(MAX_OPENS, Math.floor(c.opens)));
  const age = Number(now > c.acceptedAt ? now - c.acceptedAt : 0n);
  return lt * (1 + ATTRIBUTION.OPEN_BOOST * opens) * 2 ** (-age / ATTRIBUTION.HALF_LIFE_SECONDS);
}

/** Real-valued shares → contract-valid integer bps (cap, largest remainder, ≥ 1 each). */
export function sharesToBps(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  if (n === 1) return [BPS_DENOMINATOR];
  const total = scores.reduce((a, b) => a + b, 0);
  let s = total > 0 ? scores.map((x) => x / total) : scores.map(() => 1 / n);
  const cap = PER_REFERRER_CAP_BPS / BPS_DENOMINATOR;
  // Water-fill the cap: clamp, hand the excess to the uncapped ones in proportion.
  for (let iter = 0; iter < n; iter++) {
    const over = s.findIndex((x) => x > cap + 1e-12);
    if (over < 0) break;
    const excess = s[over]! - cap;
    s[over] = cap;
    const restTotal = s.reduce((a, x, i) => (i === over || x >= cap ? a : a + x), 0);
    s = s.map((x, i) => (i === over || x >= cap ? x : restTotal > 0 ? x + (excess * x) / restTotal : x + excess / (n - 1)));
  }
  const raw = s.map((x) => x * BPS_DENOMINATOR);
  const bps = raw.map((x) => Math.floor(x + 1e-9));
  let rem = BPS_DENOMINATOR - bps.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rem > 0; k = (k + 1) % n) {
    const i = order[k]!.i;
    if (bps[i]! + 1 > PER_REFERRER_CAP_BPS) continue;
    bps[i]!++;
    rem--;
  }
  // Every weighted referrer needs bps > 0.
  for (let i = 0; i < n; i++) {
    if (bps[i]! > 0) continue;
    const big = bps.indexOf(Math.max(...bps));
    bps[big]!--;
    bps[i] = 1;
  }
  return bps;
}

export const baselineAttributor: Attributor = {
  name: 'baseline-v1',
  async attribute(input) {
    const scores: CandidateScore[] = input.candidates.map((c) => {
      const eligible = input.now <= c.expiresAt && input.amount >= c.minOrder;
      return {
        referrer: c.referrer,
        eligible,
        ...(eligible ? {} : { reason: input.now > c.expiresAt ? ('expired' as const) : ('below_min_order' as const) }),
        score: eligible ? scoreCandidate(c, input.now) : 0,
        opens: c.opens,
        linkType: c.linkType,
      };
    });
    // De-duplicate referrers (the contract keeps one slot per referrer; be defensive): keep the best score.
    const best = new Map<string, number>();
    scores.forEach((s, i) => {
      if (!s.eligible) return;
      const k = s.referrer.toLowerCase();
      const j = best.get(k);
      if (j === undefined || scores[j]!.score < s.score) best.set(k, i);
    });
    let picked = [...best.values()].sort((a, b) => a - b);
    if (input.whoSentYou) {
      const k = input.whoSentYou.toLowerCase();
      const j = best.get(k);
      if (j !== undefined) {
        const total = picked.reduce((a, i) => a + scores[i]!.score, 0);
        scores[j]!.score += ANSWER_BOOST * total;
      }
    }
    if (picked.length > MAX_REFERRERS) {
      const keep = new Set([...picked].sort((a, b) => scores[b]!.score - scores[a]!.score || a - b).slice(0, MAX_REFERRERS));
      for (const i of picked) if (!keep.has(i)) Object.assign(scores[i]!, { eligible: false, reason: 'not_top_5' });
      picked = picked.filter((i) => keep.has(i));
    }
    const bps = sharesToBps(picked.map((i) => scores[i]!.score));
    const referrers = picked.map((i) => scores[i]!.referrer);
    const explanation =
      referrers.length === 0
        ? 'No eligible recommendation for this purchase.'
        : referrers.length === 1
          ? 'One recommendation: it gets the full referral share.'
          : `Split by link type (personal 2×, group 1×), link opens (+25% each) and recency (3-day half-life)${input.whoSentYou && best.has(input.whoSentYou.toLowerCase()) ? ', boosted by your answer' : ''}.`;
    return { referrers, bps, method: 'baseline-v1', explanation, scores };
  },
};
