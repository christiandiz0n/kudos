import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainSeparator, encodeAbiParameters, keccak256, toHex, type Address } from 'viem';
import {
  PAYMENT_AUTH_TYPES,
  paymentAuthNonce,
  receiveAuthForPayment,
  hashAddressArray,
  hashUint256Array,
  type PaymentAuth,
} from './eip712';
import { ARC_TESTNET_USDC_DOMAIN_SEPARATOR, ARC_TESTNET_USDC_EIP712_DOMAIN } from './chains';

const typeString = (t: readonly { name: string; type: string }[], name: string) =>
  `${name}(${t.map((f) => `${f.type} ${f.name}`).join(',')})`;

test('USDC EIP-712 domain constants reproduce the live Arc DOMAIN_SEPARATOR (S1)', () => {
  assert.equal(domainSeparator({ domain: ARC_TESTNET_USDC_EIP712_DOMAIN }), ARC_TESTNET_USDC_DOMAIN_SEPARATOR);
});

test('PaymentAuth typehash + struct hash match Solidity keccak256(abi.encode(TYPEHASH, ...))', () => {
  const ts = typeString(PAYMENT_AUTH_TYPES.PaymentAuth, 'PaymentAuth');
  assert.equal(
    ts,
    'PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline)',
  );
  const p: PaymentAuth = {
    customer: '0x00000000000000000000000000000000000000c1',
    venue: '0x00000000000000000000000000000000000000a1',
    orderId: toHex(1n, { size: 32 }),
    amount: 12_000_000n,
    weightsHash: toHex(0n, { size: 32 }),
    deadline: 1_800_000_000n,
  };
  const manual = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint64' },
      ],
      [keccak256(toHex(ts)), p.customer, p.venue, p.orderId, p.amount, p.weightsHash, p.deadline],
    ),
  );
  assert.equal(paymentAuthNonce(p), manual);
  const rwa = receiveAuthForPayment(p, '0x00000000000000000000000000000000000000f1');
  assert.equal(rwa.nonce, manual);
  assert.equal(rwa.value, p.amount);
  assert.equal(rwa.validBefore, p.deadline);
});

test('array hashes equal keccak256(abi.encodePacked(T[]))', () => {
  const addrs: Address[] = ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'];
  assert.equal(hashAddressArray(addrs), keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }], addrs as [Address, Address])));
  assert.equal(hashUint256Array([1n, 2n]), keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [1n, 2n])));
});
