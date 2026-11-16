import {
  concat,
  hashStruct,
  hashTypedData,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';

/**
 * EIP-712 typed-data definitions — v0 DRAFT (ARCHITECT). CONTRACTS finalizes in Phase 1.
 * Mirrors AGENTS/INTERFACES.md §3. Any change here must match the Solidity TYPEHASH strings exactly.
 *
 * Field order matters: it defines the type string and therefore the typehash.
 */

/**
 * EIP-712 domain name of the main contract. Derived from APP_NAME ('Vouch', D-007) but deliberately a
 * separate literal: it is FROZEN once the main contract is deployed (changing it invalidates every signature).
 */
export const EIP712_DOMAIN_NAME = 'Vouch' as const;
export const EIP712_DOMAIN_VERSION = '1' as const;

export function womDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return { name: EIP712_DOMAIN_NAME, version: EIP712_DOMAIN_VERSION, chainId, verifyingContract };
}

// ---------------------------------------------------------------------------------------------
// Main protocol types (draft)
// ---------------------------------------------------------------------------------------------

/**
 * Intro — signed by the REFERRER. A personal link (linkType 0) is single-use: the first valid
 * IntroAcceptance consumes it on-chain. A broadcast link (linkType 1) can be accepted by many
 * customers until expiresAt, but each (introHash, customer) pair only once.
 */
export const INTRO_TYPES = {
  Intro: [
    { name: 'venue', type: 'address' },
    { name: 'referrer', type: 'address' },
    { name: 'termsVersion', type: 'uint32' },
    { name: 'linkType', type: 'uint8' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * IntroAcceptance — countersigned by the CUSTOMER. `introHash` is the full EIP-712 digest of the Intro
 * (hashTypedData, i.e. domain-bound), so an acceptance cannot be replayed onto another intro, venue,
 * chain or contract. `customer` must equal the recovered signer.
 */
export const INTRO_ACCEPTANCE_TYPES = {
  IntroAcceptance: [
    { name: 'introHash', type: 'bytes32' },
    { name: 'customer', type: 'address' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

/** Order — signed by the VENUE's signer key; shown as QR at the counter. */
export const ORDER_TYPES = {
  Order: [
    { name: 'venue', type: 'address' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'amount', type: 'uint256' }, // USDC base units (6 decimals)
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const;

/** Weights — signed by the VENUE's attributor key. bps sum to 10_000; length <= MAX_REFERRERS. */
export const WEIGHTS_TYPES = {
  Weights: [
    { name: 'venue', type: 'address' },
    { name: 'customer', type: 'address' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'referrers', type: 'address[]' },
    { name: 'bps', type: 'uint16[]' },
  ],
} as const;

/**
 * PaymentAuth — the customer's payment commitment (D-103). It is NOT signed on its own: its EIP-712
 * **struct hash** (hashStruct, no domain) is used as the `nonce` of the USDC EIP-3009
 * `ReceiveWithAuthorization` the customer signs (one signature total). The contract recomputes
 * hashStruct(PaymentAuth) from the call params and passes it as the nonce to
 * `USDC.receiveWithAuthorization(customer, address(this), amount, 0, deadline, nonce, sig)`, so the relayer can
 * never pull funds for anything else. EIP-3009 nonces are unique per authorizer (no sequential nonce).
 * `weightsHash` = hashStruct(Weights) of the quoted weights, or bytes32(0) to accept the on-chain fallback.
 */
export const PAYMENT_AUTH_TYPES = {
  PaymentAuth: [
    { name: 'customer', type: 'address' },
    { name: 'venue', type: 'address' },
    { name: 'orderId', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'weightsHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const;

/**
 * USDC EIP-3009 ReceiveWithAuthorization (Circle FiatToken v2). Signed by the CUSTOMER under the USDC
 * domain (ARC_TESTNET_USDC_EIP712_DOMAIN: name "USDC", version "2"). `to` = our payment contract
 * (payee-only: only `to` may submit it, so it cannot be front-run). validAfter = 0, validBefore = deadline.
 */
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface Intro {
  venue: Address;
  referrer: Address;
  termsVersion: number;
  linkType: number;
  issuedAt: bigint;
  expiresAt: bigint;
  nonce: Hex;
}
export interface IntroAcceptance {
  introHash: Hex;
  customer: Address;
  deadline: bigint;
}
export interface Order {
  venue: Address;
  orderId: Hex;
  amount: bigint;
  expiresAt: bigint;
}
export interface Weights {
  venue: Address;
  customer: Address;
  orderId: Hex;
  referrers: readonly Address[];
  bps: readonly number[];
}
export interface PaymentAuth {
  customer: Address;
  venue: Address;
  orderId: Hex;
  amount: bigint;
  weightsHash: Hex;
  deadline: bigint;
}
export interface ReceiveWithAuthorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

/** Full EIP-712 digest of an Intro — the value used as IntroAcceptance.introHash. */
export function introDigest(domain: TypedDataDomain, intro: Intro): Hex {
  return hashTypedData({ domain, types: INTRO_TYPES, primaryType: 'Intro', message: intro });
}

/** hashStruct(Weights) — the value committed as PaymentAuth.weightsHash. */
export function weightsStructHash(w: Weights): Hex {
  return hashStruct({ types: WEIGHTS_TYPES, primaryType: 'Weights', data: w });
}

/** hashStruct(PaymentAuth) — used as the EIP-3009 nonce (D-103). */
export function paymentAuthNonce(p: PaymentAuth): Hex {
  return hashStruct({ types: PAYMENT_AUTH_TYPES, primaryType: 'PaymentAuth', data: p });
}

/** Build the ReceiveWithAuthorization message the customer signs for a PaymentAuth. */
export function receiveAuthForPayment(p: PaymentAuth, paymentContract: Address): ReceiveWithAuthorization {
  return {
    from: p.customer,
    to: paymentContract,
    value: p.amount,
    validAfter: 0n,
    validBefore: p.deadline,
    nonce: paymentAuthNonce(p),
  };
}

// ---------------------------------------------------------------------------------------------
// Spike S2/S5 (Hello.sol) — NOT production
// ---------------------------------------------------------------------------------------------

export const HELLO_DOMAIN_NAME = 'WomHello' as const;
export const HELLO_DOMAIN_VERSION = '1' as const;

export function helloDomain(chainId: number, verifyingContract: Address): TypedDataDomain {
  return { name: HELLO_DOMAIN_NAME, version: HELLO_DOMAIN_VERSION, chainId, verifyingContract };
}

export const SPLIT_AUTH_TYPES = {
  SplitAuth: [
    { name: 'token', type: 'address' },
    { name: 'from', type: 'address' },
    { name: 'recipientsHash', type: 'bytes32' },
    { name: 'amountsHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** keccak256 of the 32-byte-padded concatenation — equals Solidity keccak256(abi.encodePacked(address[])). */
export function hashAddressArray(addrs: readonly Address[]): Hex {
  return keccak256(addrs.length ? concat(addrs.map((a) => pad(a, { size: 32 }))) : '0x');
}

/** keccak256 of the 32-byte concatenation — equals Solidity keccak256(abi.encodePacked(uint256[])). */
export function hashUint256Array(values: readonly bigint[]): Hex {
  return keccak256(values.length ? concat(values.map((v) => toHex(v, { size: 32 }))) : '0x');
}
