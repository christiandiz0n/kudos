import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, STEPS, VENUES, baselineBps, computeSplit, fmt, paySteps, planFunding, remainingSpend, score, simulatePlan, usd, type Step } from './plan';

test('usd/fmt are exact', () => {
  assert.equal(usd('12.00'), 12_000_000n);
  assert.equal(usd('0.693'), 693_000n);
  assert.equal(fmt(10_200_000n), '10.20');
  assert.equal(fmt(252_000n), '0.252');
  assert.equal(fmt(-1_750_000n), '-1.75');
  assert.throws(() => usd('1.2.3'));
});

test('the seed plan passes every contract rule', () => {
  const r = simulatePlan();
  assert.deepEqual(r.errors, []);
});

test('plan shape: 3 venues, ~10 personas, 15–20 payments of $0.50–$12, ≤ $60', () => {
  assert.equal(VENUES.length, 3);
  assert.deepEqual(VENUES.map((v) => [v.name, v.rewardBps]), [["Lena's café", 1500], ['Kiln Bakery', 1200], ['Pressed', 2000]]);
  const owners = new Set(VENUES.map((v) => v.owner));
  assert.equal(PERSONAS.filter((p) => !owners.has(p.key)).length, 10);
  const pays = paySteps();
  assert.ok(pays.length >= 15 && pays.length <= 20, `${pays.length} payments`);
  for (const p of pays) assert.ok(p.amount >= usd('0.50') && p.amount <= usd('12.00'), p.id);
  assert.ok(simulatePlan().volume <= usd('60.00'));
});

test('the web has what the story needs: repeat, below-minimum, 2-referrer customers, public links reused, L2 chains', () => {
  const r = simulatePlan();
  const pays = r.payments;
  assert.equal(pays.filter((p) => p.step.expect === 'repeat').length, 1);
  assert.equal(pays.filter((p) => p.step.expect === 'below_min').length, 1);
  assert.ok(pays.filter((p) => p.referrers.length === 2).length >= 3);
  const accepts = STEPS.filter((s): s is Extract<Step, { kind: 'accept' }> => s.kind === 'accept');
  const reused = new Map<string, number>();
  for (const a of accepts) if (a.linkType === 'broadcast') reused.set(a.link, (reused.get(a.link) ?? 0) + 1);
  assert.ok([...reused.values()].filter((n) => n >= 2).length >= 2, 'at least two public links used by 2+ customers');
  // L2 chains: payments that pay an introducer who is not a seed (so the chain is ≥ 3 people deep)
  const l2 = pays.flatMap((p) => p.split.lines.filter((l) => l.role === 'introducer'));
  assert.ok(l2.length >= 8);
  assert.ok(r.introducers['cafe:chloe'] === 'ben' && r.introducers['cafe:ben'] === 'ana' && r.introducers['cafe:ana'] === 'marco');
  // repeat + below-min pay nothing
  for (const p of pays.filter((x) => x.step.expect !== 'rewarded')) assert.deepEqual(p.split.lines, []);
});

test("canonical: Ben's $12.00 splits 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108", () => {
  assert.deepEqual(baselineBps([score('personal', 3), score('broadcast', 2)]), [7000, 3000]);
  const canon = simulatePlan().payments.find((p) => p.step.canonical)!;
  assert.equal(canon.step.customer, 'ben');
  assert.deepEqual(canon.referrers, [
    { who: 'ana', bps: 7000, introducer: 'marco' },
    { who: 'priya', bps: 3000, introducer: 'sofia' },
  ]);
  const s = canon.split;
  assert.equal(s.venueAmount, 10_200_000n);
  assert.equal(s.pool, 1_800_000n);
  assert.deepEqual(
    s.lines.map((l) => `${l.role}:${l.recipient}:${l.amount}`),
    ['cashback:ben:450000', 'referrer:ana:693000', 'referrer:priya:297000', 'introducer:marco:252000', 'introducer:sofia:108000'],
  );
  assert.equal(s.venueAmount + s.lines.reduce((a, l) => a + l.amount, 0n), 12_000_000n);
});

test('split: L2 via a seed (no introducer) or back to the customer returns to the venue; Σ = amount', () => {
  const viaSeed = computeSplit(usd('2.80'), 1500, 'ana', [{ who: 'marco', bps: 10_000, introducer: null }]);
  assert.equal(viaSeed.returned, 84_000n);
  assert.equal(viaSeed.venueAmount, 2_800_000n - 105_000n - 231_000n);
  const cycle = computeSplit(usd('5.00'), 1000, 'ana', [{ who: 'ben', bps: 10_000, introducer: 'ana' }]);
  assert.equal(cycle.lines.some((l) => l.role === 'introducer'), false);
  for (const p of simulatePlan().payments) assert.equal(p.split.venueAmount + p.split.lines.reduce((a, l) => a + l.amount, 0n), p.step.amount, p.step.id);
});

test('baselineBps: largest remainder, Σ 10,000, 8,000 cap water-filled, single = 10,000', () => {
  assert.deepEqual(baselineBps([1]), [10_000]);
  assert.deepEqual(baselineBps([2, 1]), [6667, 3333]);
  assert.deepEqual(baselineBps([9, 1]), [8000, 2000]);
  const b = baselineBps([2.5, 1, 1]);
  assert.equal(b.reduce((a, x) => a + x, 0), 10_000);
});

test('funding: donors surplus first (above reserve + gas buffer, ≥ $0.10 chunks), deployer covers the rest', () => {
  const f = planFunding(usd('12.00'), [
    { key: 'lena', balance: usd('4.60'), reserved: 0n },
    { key: 'tomas', balance: usd('0.12'), reserved: 0n }, // surplus 0.07 < 0.10 → skipped
    { key: 'maya', balance: usd('3.00'), reserved: usd('1.90') },
  ]);
  assert.deepEqual(f.fromDonors, [
    { from: 'lena', amount: usd('4.55') },
    { from: 'maya', amount: usd('1.05') },
  ]);
  assert.equal(f.fromDeployer, usd('6.40'));
  assert.deepEqual(planFunding(0n, [{ key: 'lena', balance: usd('9'), reserved: 0n }]), { fromDonors: [], fromDeployer: 0n });
  assert.deepEqual(planFunding(usd('1'), [{ key: 'lena', balance: usd('9'), reserved: 0n }]).fromDeployer, 0n);
});

test('remainingSpend counts only that persona from the index on', () => {
  const i = STEPS.findIndex((s) => s.id === 'pay:cafe:ben:1');
  assert.equal(remainingSpend('ben', i), usd('12.00') + usd('2.20') + usd('3.80'));
  assert.equal(remainingSpend('ben', i + 1), usd('2.20') + usd('3.80'));
});

test('simulatePlan catches rule breaks', () => {
  const bad: Step[] = [
    { kind: 'register', id: 'r', venue: 'cafe' },
    { kind: 'accept', id: 'a1', venue: 'cafe', customer: 'ben', referrer: 'ana', linkType: 'personal', link: 'x', opens: 0 },
    { kind: 'pay', id: 'p1', venue: 'cafe', customer: 'chloe', amount: usd('0.40'), label: '', expect: 'rewarded' },
    { kind: 'accept', id: 'a2', venue: 'cafe', customer: 'chloe', referrer: 'chloe', linkType: 'personal', link: 'x', opens: 0 },
  ];
  const e = simulatePlan(bad).errors.join('\n');
  assert.match(e, /ana is neither a seed nor verified/);
  assert.match(e, /below the api's \$0.50/);
  assert.match(e, /expected rewarded, the rules give below_min/);
  assert.match(e, /self-referral/);
  assert.match(e, /already verified/);
  assert.match(e, /personal link x used twice/);
});
