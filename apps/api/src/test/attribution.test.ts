import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, type Address, type Hex } from 'viem';
import { baselineAttributor, sharesToBps, scoreCandidate, type AttributionCandidate } from '../attribution/baseline';

const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`) as Address;
const NOW = 1_800_000_000n;
const cand = (n: number, over: Partial<AttributionCandidate> = {}): AttributionCandidate => ({
  referrer: A(n),
  introHash: `0x${n.toString(16).padStart(64, '0')}` as Hex,
  linkType: 0,
  acceptedAt: NOW - 60n,
  expiresAt: NOW + 86_400n,
  termsVersion: 1,
  minOrder: 1_000_000n,
  opens: 0,
  ...over,
});
const input = (candidates: AttributionCandidate[], extra: Record<string, unknown> = {}) => ({
  venue: A(999),
  customer: A(998),
  orderId: `0x${'00'.repeat(32)}` as Hex,
  amount: 12_000_000n,
  now: NOW,
  candidates,
  ...extra,
});

test('canonical: personal ×(1+0.25×3) vs broadcast ×(1+0.25×2) → exactly 7000 / 3000', async () => {
  const r = await baselineAttributor.attribute(input([cand(1, { opens: 3, acceptedAt: NOW - 30n }), cand(2, { linkType: 1, opens: 2, acceptedAt: NOW - 20n })]));
  assert.deepEqual(r.bps, [7_000, 3_000]);
  assert.deepEqual(r.referrers, [A(1), A(2)]);
});

test('link type, opens (capped) and recency', () => {
  const base = cand(1);
  assert.ok(scoreCandidate(base, NOW) > scoreCandidate({ ...base, linkType: 1 }, NOW));
  assert.ok(scoreCandidate({ ...base, opens: 2 }, NOW) > scoreCandidate(base, NOW));
  assert.equal(scoreCandidate({ ...base, opens: 100 }, NOW), scoreCandidate({ ...base, opens: 8 }, NOW));
  const threeDays = scoreCandidate({ ...base, acceptedAt: NOW - 3n * 86_400n }, NOW);
  assert.ok(Math.abs(threeDays / scoreCandidate({ ...base, acceptedAt: NOW }, NOW) - 0.5) < 1e-9, 'half-life 3 days');
});

test('ineligible intros are excluded (expired, below the frozen minOrder); nothing eligible → no weights', async () => {
  const r = await baselineAttributor.attribute(input([cand(1, { expiresAt: NOW - 1n }), cand(2, { minOrder: 20_000_000n })]));
  assert.deepEqual(r.referrers, []);
  assert.deepEqual(r.bps, []);
  assert.deepEqual(r.scores.map((s) => s.reason), ['expired', 'below_min_order']);
});

test('"Who sent you here?" boosts the named eligible referrer (+50% of total)', async () => {
  const without = await baselineAttributor.attribute(input([cand(1), cand(2)]));
  assert.deepEqual(without.bps, [5_000, 5_000]);
  const withAnswer = await baselineAttributor.attribute(input([cand(1), cand(2)], { whoSentYou: A(2) }));
  assert.deepEqual(withAnswer.bps, [3_333, 6_667]); // 2 : (2 + 0.5 × 4)
  const unknown = await baselineAttributor.attribute(input([cand(1), cand(2)], { whoSentYou: A(77) }));
  assert.deepEqual(unknown.bps, [5_000, 5_000]);
});

test('contract bounds: ≤ 5 referrers (top scores, slot order kept), cap 8000 unless single, Σ = 10000, each ≥ 1', async () => {
  const many = await baselineAttributor.attribute(input([1, 2, 3, 4, 5, 6, 7].map((n) => cand(n, { opens: n }))));
  assert.equal(many.referrers.length, 5);
  assert.deepEqual(many.referrers, [3, 4, 5, 6, 7].map(A));
  assert.equal(many.bps.reduce((a, b) => a + b, 0), 10_000);
  const dominant = await baselineAttributor.attribute(input([cand(1, { opens: 8 }), cand(2, { linkType: 1, acceptedAt: NOW - 30n * 86_400n })]));
  assert.equal(dominant.bps[0], 8_000);
  assert.equal(dominant.bps[1], 2_000);
  const single = await baselineAttributor.attribute(input([cand(1)]));
  assert.deepEqual(single.bps, [10_000]);
  for (const scores of [[1, 1e-9], [1, 1, 1], [0.3, 0.3, 0.3, 0.1], [5, 1, 1, 1, 1]]) {
    const b = sharesToBps(scores);
    assert.equal(b.reduce((x, y) => x + y, 0), 10_000, `sum for ${scores}`);
    assert.ok(b.every((x) => x >= 1 && x <= 8_000), `bounds for ${scores}: ${b}`);
  }
});

test('duplicate referrer slots collapse to one (no duplicates in Weights)', async () => {
  const r = await baselineAttributor.attribute(input([cand(1), cand(1, { introHash: `0x${'ff'.repeat(32)}`, opens: 2 }), cand(2)]));
  assert.equal(new Set(r.referrers).size, r.referrers.length);
  assert.equal(r.referrers.length, 2);
});
