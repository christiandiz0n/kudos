import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNativeAsUsdc,
  formatUsd,
  formatUsdc,
  mulBps,
  nativeToUsdcBaseUnits,
  parseUsdc,
} from './money';
import { BPS_DENOMINATOR, SPLIT_BPS } from './constants';

test('parseUsdc', () => {
  assert.equal(parseUsdc('12.00'), 12_000_000n);
  assert.equal(parseUsdc('$1,234.5'), 1_234_500_000n);
  assert.equal(parseUsdc('0.000001'), 1n);
  assert.equal(parseUsdc('7'), 7_000_000n);
  assert.throws(() => parseUsdc('0.0000001'));
  assert.throws(() => parseUsdc('abc'));
  assert.throws(() => parseUsdc('1e6'));
});

test('formatUsdc / formatUsd', () => {
  assert.equal(formatUsdc(12_000_000n), '12.00');
  assert.equal(formatUsdc(693_000n), '0.693');
  assert.equal(formatUsdc(1n), '0.000001');
  assert.equal(formatUsdc(0n), '0.00');
  assert.equal(formatUsd(10_200_000n), '$10.20');
  assert.equal(formatUsd(-450_000n), '-$0.45');
});

test('native gas -> USDC', () => {
  assert.equal(nativeToUsdcBaseUnits(10n ** 12n), 1n);
  assert.equal(nativeToUsdcBaseUnits(10n ** 12n + 1n), 2n); // rounds up
  assert.equal(formatNativeAsUsdc(123_456_789_000_000n), '0.000123456789');
});

test('product-story split: $12.00 at 15%', () => {
  const sale = parseUsdc('12.00');
  const pool = mulBps(sale, 1_500);
  assert.equal(formatUsdc(pool), '1.80');
  assert.equal(formatUsdc(mulBps(pool, SPLIT_BPS.CASHBACK)), '0.45');
  assert.equal(formatUsdc(mulBps(pool, SPLIT_BPS.L1)), '0.99');
  assert.equal(formatUsdc(mulBps(pool, SPLIT_BPS.L2)), '0.36');
  assert.equal(SPLIT_BPS.CASHBACK + SPLIT_BPS.L1 + SPLIT_BPS.L2, BPS_DENOMINATOR);
});
