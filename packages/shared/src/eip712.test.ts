import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainSeparator, encodeAbiParameters, hashStruct, keccak256, toEventSelector, toHex, type Address } from 'viem';
import * as E from './eip712';
import {
  PAYMENT_AUTH_TYPES,
  paymentAuthNonce,
  receiveAuthForPayment,
  hashAddressArray,
  hashUint256Array,
  type PaymentAuth,
} from './eip712';
import { ARC_TESTNET_USDC_DOMAIN_SEPARATOR, ARC_TESTNET_USDC_EIP712_DOMAIN } from './chains';
import { VOUCH_EVENT_SIGNATURES, VOUCH_EVENT_TOPICS, VOUCH_TYPE_STRINGS, vouchAbi } from './abi/vouch';

const typeString = (t: readonly { name: string; type: string }[], name: string) =>
  `${name}(${t.map((f) => `${f.type} ${f.name}`).join(',')})`;

test('USDC EIP-712 domain constants reproduce the live Arc DOMAIN_SEPARATOR (S1)', () => {
  assert.equal(domainSeparator({ domain: ARC_TESTNET_USDC_EIP712_DOMAIN }), ARC_TESTNET_USDC_DOMAIN_SEPARATOR);
});

test('every TS typed-data definition equals the Solidity type string (VouchHash.sol via export-abi.sh)', () => {
  const ts: Record<string, string> = {
    Intro: typeString(E.INTRO_TYPES.Intro, 'Intro'),
    IntroAcceptance: typeString(E.INTRO_ACCEPTANCE_TYPES.IntroAcceptance, 'IntroAcceptance'),
    Order: typeString(E.ORDER_TYPES.Order, 'Order'),
    Weights: typeString(E.WEIGHTS_TYPES.Weights, 'Weights'),
    PaymentAuth: typeString(E.PAYMENT_AUTH_TYPES.PaymentAuth, 'PaymentAuth'),
    RegisterVenue: typeString(E.REGISTER_VENUE_TYPES.RegisterVenue, 'RegisterVenue'),
    UpdateTerms: typeString(E.UPDATE_TERMS_TYPES.UpdateTerms, 'UpdateTerms'),
    SetVenueKeys: typeString(E.SET_VENUE_KEYS_TYPES.SetVenueKeys, 'SetVenueKeys'),
    SetSeedAmbassador: typeString(E.SET_SEED_AMBASSADOR_TYPES.SetSeedAmbassador, 'SetSeedAmbassador'),
  };
  assert.deepEqual(Object.keys(ts).sort(), Object.keys(VOUCH_TYPE_STRINGS).sort());
  for (const [k, v] of Object.entries(ts)) {
    assert.equal(v, VOUCH_TYPE_STRINGS[k as keyof typeof VOUCH_TYPE_STRINGS], k);
  }
});

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const B = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;

test('golden struct hashes match contracts/test/VouchTypehash.t.sol', () => {
  const golden = {
    Intro: hashStruct({ types: E.INTRO_TYPES, primaryType: 'Intro', data: { venue: A(0xa1), referrer: A(0xb1), termsVersion: 3, linkType: 1, issuedAt: 1_800_000_000n, expiresAt: 1_800_600_000n, nonce: B(0x42) } }),
    IntroAcceptance: hashStruct({ types: E.INTRO_ACCEPTANCE_TYPES, primaryType: 'IntroAcceptance', data: { introHash: B(0x99), customer: A(0xc1), deadline: 1_800_003_600n } }),
    Order: E.orderStructHash({ venue: A(0xa1), orderId: B(7), amount: 12_000_000n, expiresAt: 1_800_000_600n }),
    Weights: E.weightsStructHash({ venue: A(0xa1), customer: A(0xc1), orderId: B(7), referrers: [A(0xb1), A(0xb2)], bps: [7000, 3000] }),
    PaymentAuth: E.paymentAuthNonce({ customer: A(0xc1), venue: A(0xa1), orderId: B(7), amount: 12_000_000n, weightsHash: B(0x77), deadline: 1_800_000_600n }),
    RegisterVenue: hashStruct({ types: E.REGISTER_VENUE_TYPES, primaryType: 'RegisterVenue', data: { owner: A(0xd1), salt: B(0x5a), payout: A(0xd2), signer: A(0xd3), attributor: A(0xd4), rewardBps: 1500, minOrder: 5_000_000n, metadataURI: 'ipfs://lenas-cafe', nonce: 2n, deadline: 1_800_003_600n } }),
    UpdateTerms: hashStruct({ types: E.UPDATE_TERMS_TYPES, primaryType: 'UpdateTerms', data: { venue: A(0xa1), rewardBps: 1000, minOrder: 1_000_000n, nonce: 3n, deadline: 1_800_003_600n } }),
    SetVenueKeys: hashStruct({ types: E.SET_VENUE_KEYS_TYPES, primaryType: 'SetVenueKeys', data: { venue: A(0xa1), payout: A(0xd2), signer: A(0xd3), attributor: A(0xd4), nonce: 4n, deadline: 1_800_003_600n } }),
    SetSeedAmbassador: hashStruct({ types: E.SET_SEED_AMBASSADOR_TYPES, primaryType: 'SetSeedAmbassador', data: { venue: A(0xa1), ambassador: A(0xb1), allowed: true, nonce: 5n, deadline: 1_800_003_600n } }),
  };
  assert.deepEqual(golden, {
    Intro: '0x9ff2d5883e4395056f16fca260e5a93e098131cdce2d673d2e0efff3907e2c70',
    IntroAcceptance: '0x29c96781dbd1854510c1a2556b694876538a2e7f0d3546fc5b334857c8e0d7f2',
    Order: '0x4d2385e0b84bc32342452a9f9108d837d2d8218abf887812286145120fb0dd50',
    Weights: '0x909c63ab79908e26937c0ffe835d6e125b6b728763010a9ee4b2cf10d1e55ae4',
    PaymentAuth: '0x9c467d24e100878416549589aa43ce1bc27ce24374c2ab19bee49bcb5a01d752',
    RegisterVenue: '0xe4331844ae4391c7e76bd8b8e5998c997fea731b961acdfbf853bbd0100e1b73',
    UpdateTerms: '0x60aae8e6da784d3d122ca18ced96e6166b7047b3164ee936814e2b67a9e562ae',
    SetVenueKeys: '0xfb9c844dff2b5cb746545d83b2373c1480785d69855d2b6a33f30959abfbec45',
    SetSeedAmbassador: '0xf0bac3e9a403d2a86a7be57cc789266416dc34b80c586c84308f9aa81bf5f7c1',
  });
  assert.equal(E.computeVenueId(A(0xd1), B(0x5a)), '0x64287Ee3a7eD83d23b8eDCcdC89D05629C0159fE');
});

test('event topics in the generated ABI module equal keccak256(signature)', () => {
  for (const [name, sig] of Object.entries(VOUCH_EVENT_SIGNATURES)) {
    assert.equal(toEventSelector(sig), VOUCH_EVENT_TOPICS[name as keyof typeof VOUCH_EVENT_TOPICS], name);
  }
  const abiEvents = vouchAbi.filter((x) => x.type === 'event').map((x) => x.name);
  assert.deepEqual([...abiEvents].sort(), Object.keys(VOUCH_EVENT_TOPICS).sort());
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
