import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseError, encodeErrorResult, parseAbi } from 'viem';
import { vouchAbi } from '@vouch/shared';
import { decodeRevert } from '../chain/client';
import { classifySendError, revertCode } from '../chain/errors';

class WithData extends BaseError {
  data: string;
  constructor(data: string, cause?: Error) {
    super('call failed', cause ? { cause } : {});
    this.data = data;
  }
}

test('decodeRevert: Vouch custom errors and USDC revert strings from raw revert data in the cause chain', () => {
  const settled = encodeErrorResult({ abi: vouchAbi, errorName: 'OrderAlreadySettled' });
  assert.deepEqual(decodeRevert(new BaseError('outer', { cause: new WithData(settled) })), { name: 'OrderAlreadySettled', args: [] });
  const str = encodeErrorResult({ abi: parseAbi(['error Error(string)']), errorName: 'Error', args: ['ERC20: transfer amount exceeds balance'] });
  const r = decodeRevert(new WithData(str))!;
  assert.equal(r.name, 'Error');
  assert.equal(revertCode(r), 'INSUFFICIENT_BALANCE');
  assert.equal(decodeRevert(new BaseError('fetch failed')), null, 'transport failure is not a revert');
  assert.equal(decodeRevert(new Error('plain')), null);
});

test('revertCode: every pay/intro/owner revert has a friendly code', () => {
  const cases: [string, string][] = [
    ['OrderExpired', 'ORDER_EXPIRED'],
    ['OrderAlreadySettled', 'ORDER_ALREADY_PAID'],
    ['AuthExpired', 'PAYMENT_EXPIRED'],
    ['CustomerAlreadyVerified', 'ALREADY_REWARDED'],
    ['TermsNotInForce', 'LINK_NEEDS_REISSUE'],
    ['InvalidAccountNonce', 'OWNER_NONCE_STALE'],
    ['UnauthorizedSubmitter', 'UNAUTHORIZED_SUBMITTER'],
    ['SomethingNew', 'TX_FAILED'],
  ];
  for (const [name, code] of cases) assert.equal(revertCode({ name }), code, name);
  assert.equal(revertCode({ name: 'Error', reason: 'FiatTokenV2: authorization is used or canceled' }), 'PAYMENT_ALREADY_USED');
  assert.equal(revertCode({ name: 'Error', reason: 'FiatTokenV2: invalid signature' }), 'INVALID_SIGNATURE');
});

test('classifySendError', () => {
  assert.equal(classifySendError(new Error('nonce too low')), 'nonce_low');
  assert.equal(classifySendError(new Error('replacement transaction underpriced')), 'underpriced');
  assert.equal(classifySendError(new Error('already known')), 'already_known');
  assert.equal(classifySendError(new Error('insufficient funds for gas * price + value')), 'insufficient_funds');
  assert.equal(classifySendError(new Error('fetch failed')), 'transport');
  assert.equal(classifySendError(new Error('weird')), 'other');
});
