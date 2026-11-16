# Proposed INTERFACES.md patch — Phase 1 (CONTRACTS)

_Author: CONTRACTS, 2026-11-16. **v2 (after the QE gate): new address, `PaymentAuth.submitter`, hardening; event signatures unchanged.** Decisions: D-501..D-511, D-012, D-512..D-517. The ORCHESTRATOR applies this. It replaces the "Vouch main contract" row of §2, all of §3 above "Spike only", and the §4 table + Semantics. §1, §5–§7 are unchanged except for the env note at the end._
Code sources of truth: `contracts/src/interfaces/IVouch.sol`, `contracts/src/libraries/VouchHash.sol`, `packages/shared/src/{eip712.ts,abi/vouch.ts,abi/vouchConstants.ts,deployments.ts}`.

---

## §2 Deployed contracts — replace the `_Vouch main contract_` row

| Contract | Address | Deploy block | Tx |
|---|---|---|---|
| **`Vouch` (production, Blockscout-verified)** | `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` | 72584790 | `0xa74642869c7f787be73598c4ffa590097ad7643af24ec8ade19d625b7265a2ab` |

Constructor: `Vouch(IFiatTokenV2_2 usdc = 0x3600…0000)`. No owner, no admin, no upgradeability, non-payable. Code: `packages/shared/src/deployments.ts` (`VOUCH_ARC_TESTNET`), ABI `packages/shared/src/abi/vouch.ts` (`vouchAbi`, regenerate with `bash contracts/script/export-abi.sh`).

## §3 EIP-712 — v1 FINAL

**Domain** (main contract): `{ name: "Vouch", version: "1", chainId: 5042002, verifyingContract: 0x9C50…b95f }` (ERC-5267 `eip712Domain()` available; TS `vouchDomain(chainId, address)`).

| Type | Signed by | Fields (in order) | typehash |
|---|---|---|---|
| `Intro` | referrer | `address venue, address referrer, uint32 termsVersion, uint8 linkType, uint64 issuedAt, uint64 expiresAt, bytes32 nonce` | `0xdc4192f6…dbb7c3` |
| `IntroAcceptance` | customer | `bytes32 introHash, address customer, uint64 deadline` | `0x400ca88e…a469d0` |
| `Order` | venue **signer** key | `address venue, bytes32 orderId, uint256 amount, uint64 expiresAt` | `0xd418cbc9…11d8a3` |
| `Weights` | venue **attributor** key | `address venue, address customer, bytes32 orderId, address[] referrers, uint16[] bps` | `0x6d9e3bfc…27720c` |
| `PaymentAuth` | (not signed; its hashStruct is the EIP-3009 nonce) | `address customer, address venue, bytes32 orderId, uint256 amount, bytes32 weightsHash, uint64 deadline, address submitter` | `0xf9bd6d8f…7abcba4` |
| `RegisterVenue` | venue **owner** | `address owner, bytes32 salt, address payout, address signer, address attributor, uint16 rewardBps, uint256 minOrder, string metadataURI, uint256 nonce, uint64 deadline` | `0x8c44f0dc…be789d` |
| `UpdateTerms` | venue owner | `address venue, uint16 rewardBps, uint256 minOrder, uint256 nonce, uint64 deadline` | `0x4a721d19…e52d54` |
| `SetVenueKeys` | venue owner | `address venue, address payout, address signer, address attributor, uint256 nonce, uint64 deadline` | `0x93435561…3d98c6` |
| `SetSeedAmbassador` | venue owner | `address venue, address ambassador, bool allowed, uint256 nonce, uint64 deadline` | `0x35f94fc4…3dd2c4` |
| `ReceiveWithAuthorization` (USDC domain `{USDC, 2, 5042002, 0x3600…}`) | customer | `address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce` | `0xd099cc98…413de8` |

Full typehashes:
```
Intro              0xdc4192f6970873be49c69a70fecca1bd4ec35227b3516fe7213b516246dbb7c3
IntroAcceptance    0x400ca88e9ec28bb1f7e73d44cb8743cd861d151b07da51fae9ff083083a469d0
Order              0xd418cbc9a68e3abda5b09e4e1b5c5404de5701543ff1c0c5a807f80f9d11d8a3
Weights            0x6d9e3bfc06d45d14351cb1d560fee0b175c5b21e7134c820b3c65deab627720c
PaymentAuth        0xf9bd6d8f7594705f0e81baf13ad79ce6624e48eab3cbbb41c3ba9a97b7abcba4  (v2: + address submitter, D-012)
RegisterVenue      0x8c44f0dcdc50560c5ff9c175514985b60426873e5e734c2cd9d1ca80acbe789d
UpdateTerms        0x4a721d19699712def4975cf0278ea92f7a6e53f7c54df3c211bfd9c525e52d54
SetVenueKeys       0x93435561eda21e37e71f216160aa9814f9afe1da95bc8cdb71f25c44213d98c6
SetSeedAmbassador  0x35f94fc49cd1dc823291d31054c54ddbcef90e2d3c9085f777d953f7f53dd2c4
ReceiveWithAuth    0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8  (USDC/EIP-3009)
```
Encoding: arrays = `keccak256(abi.encodePacked(T[]))` (elements padded to 32 bytes), `string` = `keccak256(bytes(s))`. This is identical to viem `hashStruct`, and golden vectors are pinned in both `contracts/test/VouchTypehash.t.sol` and `packages/shared/src/eip712.test.ts`.

Rules (contract-enforced):

**Venues (D-501)**
- The venue id is `address(uint160(uint256(keccak256(abi.encode(owner, salt)))))` (`computeVenueId`). Each owner action has one entry point:
  - `registerVenue(owner, salt, VenueConfig{payout, signer, attributor, rewardBps, minOrder, metadataURI}, deadline, ownerSig) → venue`
  - `updateTerms(venue, rewardBps, minOrder, deadline, ownerSig)`
  - `setKeys(venue, payout, signer, attributor, deadline, ownerSig)`
  - `setSeedAmbassador(venue, ambassador, allowed, deadline, ownerSig)`
- If `msg.sender == owner`, the signature is ignored. Otherwise the owner's signature over the matching type is required, with `nonce = nonces(owner)` (sequential, shared by all four types) and an inclusive deadline.
- Terms: `1 ≤ rewardBps ≤ 5,000` and `minOrder ≤ $10,000`. Versions start at 1, `updateTerms` appends `termsVersion + 1`, and stored versions are immutable (`getTerms(venue, v)`).
- **Seed ambassadors** (D-507) may refer without a prior purchase. They have no introducer.

**Intro + IntroAcceptance (D-505)**
- `introHash` = the full EIP-712 digest of the Intro (`hashIntro`).
- Window: `0 < expiresAt − issuedAt ≤ 30 days`, `issuedAt ≤ now + 15 min`, and `now ≤ expiresAt` (inclusive). `acceptance.deadline ≥ now`.
- `termsVersion` must be the version **in force at `issuedAt`**, so clients must use chain time for `issuedAt`.
- Parties: customer ≠ referrer. The referrer must be verified at the venue or a seed. The customer must NOT be verified yet.
- Use limits: a personal intro is single-use. A broadcast intro can be used once per customer.
- Live intros: ≤ 5 slots per (customer, venue), one per referrer. Slot choice: same referrer → replace; else the first expired slot; else append; else evict the oldest. Each drop emits `IntroDropped`.

**Order**
- Signed by `venues[venue].signer`, valid while `now ≤ expiresAt`. `orderId` is single-use per venue. `amount ∈ [1, 1,000,000e6]`.

**Weights (D-502)**
- Used only if all of these hold:
  - `PaymentAuth.weightsHash == hashStruct(Weights) != 0`
  - `venue`, `customer` and `orderId` match the payment
  - length 1–5, equal to the `bps` length
  - each bps > 0 and ≤ 8,000 unless single, Σ == 10,000, no duplicates
  - every referrer holds an **eligible** intro: unexpired, and `amount ≥ minOrder` of its frozen version
  - signed by `venues[venue].attributor`
- Otherwise the **fallback** applies (never a revert):
  - `raw_i = (personal ? 2 : 1) × 2^20 >> min(floor(age_i / 3 days), 10)`
  - `w_i = floor(raw_i × 10,000 / Σraw)`
  - the remainder goes to the most recently accepted intro (ties → lower index)
- `PaymentSettled.weightsMode` reports which path was used.

**PaymentAuth / pay (D-103, D-509)**
- The customer signs USDC `ReceiveWithAuthorization{from: customer, to: Vouch, value: amount, validAfter: 0, validBefore: auth.deadline, nonce: hashStruct(PaymentAuth)}`. TS helper: `receiveAuthForPayment(auth, VOUCH)`.
- The call is `pay(order, venueSig, weights, attributorSig, auth, customerUsdcSig)`, with `auth.{venue, orderId, amount}` equal to the order's. `now < auth.deadline`.
- **`auth.submitter` (D-012, QE-C-01):** if it is non-zero, only `msg.sender == submitter` may call `pay`; anyone else gets `UnauthorizedSubmitter()` (checked last in the order checks, no state change). The app always signs `submitter = RELAYER`. `submitter = 0` lets anyone submit (the kill-the-backend path; there, mempool front-running can force the fallback).
- `weightsHash = 0` selects the fallback.
- The pull is `USDC.receiveWithAuthorization(customer, address(this), amount, 0, deadline, nonce, sig)` (bytes overload, ERC-1271-ready), followed by `transfer`s, all in one tx.

**Split (D-503, D-504, D-508)**
- `slice_i = floor(amount × w_i × frozenRate_i / 10⁸)`.
- Each slice is split into `floor(25%)` cashback, `floor(55%)` L1 → referrer_i, and `floor(20%)` L2 → `introducerOf(venue, referrer_i)`.
- An L2 share returns to the venue if the introducer is 0 or is the paying customer.
- A failed recipient transfer also returns to the venue (D-506).
- The venue gets `amount − Σ transferred`.
- Only the **first** purchase per (customer, venue) can be rewarded. It is rewarded iff ≥ 1 eligible intro exists. It always marks the customer verified, and records `introducer` = the top-weight L1 (ties → lower index), frozen forever.

**Contract-wide**
- `SignatureChecker` (ECDSA + ERC-1271) is used for every signature.
- `nonReentrant` on `pay`; non-payable.
- **v2 hardening (QE-C-02..C-07):**
  - `payout` can't be the Vouch contract or USDC (`InvalidPayout()`).
  - Every owner action, direct OR relayed, consumes `nonces(owner)`, so a direct action invalidates a pending signed one.
  - An intro on a superseded terms version is accepted only until `effectiveAt(next version) + 72 h` (`SUPERSEDED_GRACE`).
  - Every reward transfer requires ≥ 100k gas left (`TransferOutOfGas()`).

**Read helpers**
- Venues and terms: `getVenue`, `getTerms`, `currentTerms`
- Customers and referral rights: `getCustomer`, `introducerOf`, `getLiveIntros`, `canRefer`, `isSeedAmbassador`
- Replay state: `isIntroUsed`, `isOrderSettled`
- Stats: `getVenueStats`, `getAmbassadorStats`
- Hashing: `hashIntro`, `hashWeights`, `paymentAuthNonce`, `domainSeparator`, `computeVenueId`, `nonces`
- Quotes: **`previewPayment(venue, customer, orderId, amount, weights, attributorSig, weightsHash) → Quote`** returns the exact split `pay` would make (use it for `/payments/quote`).

## §4 Events — v1 FINAL (replace the table and Semantics)

> `topic0 = keccak256("Name(types)")`. Filter by the Vouch address `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` only (never the `0xffff…fffe` system emitter). Start block **72584790**. Code: `VOUCH_EVENT_TOPICS` / `VOUCH_EVENT_SIGNATURES` in `@vouch/shared`.

| Event | Signature (indexed marked) | topic0 |
|---|---|---|
| `VenueRegistered` | `(address indexed venue, address indexed owner, bytes32 salt, address payout, address signer, address attributor, string metadataURI)` | `0xf0f4291fd5fccc2af9a998b6cf8aba2121c99823a21bcfac7a4821537f004d77` |
| `TermsUpdated` | `(address indexed venue, uint32 indexed termsVersion, uint16 rewardBps, uint256 minOrder, uint64 effectiveAt)` | `0x86d80d9334324698e8c0763e1f6a4179b0ae6af2e64a9724746ce284ec78bb8b` |
| `VenueKeysUpdated` | `(address indexed venue, address payout, address signer, address attributor)` | `0xc518545d9074ed155beb97a3caed0bbecc0d2cdcdee6d6d2d16a079883ab2ee2` |
| `SeedAmbassadorSet` | `(address indexed venue, address indexed ambassador, bool allowed)` | `0x213904416ef720404e57b83f59ff9f8b5029132b1581c57443cf044b11a835b2` |
| `IntroAccepted` | `(address indexed venue, address indexed referrer, address indexed customer, bytes32 introHash, uint32 termsVersion, uint8 linkType, uint64 expiresAt)` | `0xe75b5b5d835a46c918feb6cac867d2b1c6ed4d45a112ebaf7067bb9c1fcf37fc` |
| `IntroDropped` | `(address indexed venue, address indexed customer, address indexed referrer, bytes32 introHash, uint8 reason)` | `0x71760f14b6c295e573eb0712240020bcabda6d58907c0f3897ecf55f9ec193ea` |
| `CustomerVerified` | `(address indexed venue, address indexed customer, address indexed introducer, bytes32 orderId)` | `0xca816bf56b298971c59e72dcd003c06b351b66ffedb5ec84017d6195ec0152c8` |
| `PaymentSettled` | `(address indexed venue, address indexed customer, bytes32 indexed orderId, uint256 amount, uint256 venueAmount, uint256 rewardPool, bool firstPurchase, bool rewarded, uint8 weightsMode)` | `0x35f580066b94268579e33474e66ad0347864c26fe8683e577efb5072c80e7432` |
| `RewardPaid` | `(bytes32 indexed orderId, address indexed recipient, address indexed venue, address customer, uint8 role, uint256 amount, address viaReferrer)` | `0xd28b9898dcd3318ef486fd51dbeba03ddb126bdb888b82d4ac7504213412b36a` |
| `RewardReturned` | `(bytes32 indexed orderId, address indexed intendedRecipient, address indexed venue, address customer, uint8 role, uint256 amount, address viaReferrer, uint8 reason)` | `0x1cba477ed7240b8110e7fecc9c7f6fd041255365455d9c76f2b2febb4cfb7a15` |
| `EIP712DomainChanged` (OZ, never emitted in practice) | `()` | `0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31` |

Semantics:
- **Order within one `pay` tx:** `CustomerVerified` (first purchase only, emitted before the USDC pull), then `PaymentSettled`, then N × `RewardPaid` / `RewardReturned` in this order: cashback, L1 (by referrer index), L2 (by referrer index). The USDC `Transfer` logs come from `0x3600…`, interleaved. Join key: `(venue, orderId)` or the txHash. orderIds are unique per venue only.
- **Zero-amount L1 records (v2, QE-C-03):** every credited L1 referrer gets a `RewardPaid` with role 1, even when its L1 share floors to 0 (`amount = 0`, no transfer). Ambassador credit is therefore rebuildable from events alone. Feeds may hide amount-0 rows.
- **Invariants:** `venueAmount + Σ RewardPaid.amount == amount`. `rewardPool = Σ slices = Σ RewardPaid + Σ RewardReturned + dust`, where dust ≤ 2 base units per referrer and goes to the venue.
- **`role`:** 0 = CASHBACK (`viaReferrer` = 0), 1 = L1 (`viaReferrer` = the recipient), 2 = L2 (`viaReferrer` = the L1 whose introducer is paid; it draws the money-graph edge).
- **`RewardReturned.reason`:** 0 = NO_INTRODUCER (`intendedRecipient` = 0), 1 = SELF_PAYMENT, 2 = TRANSFER_FAILED.
- **`IntroDropped.reason`:** 0 = REPLACED, 1 = EXPIRED, 2 = EVICTED.
- **`weightsMode`:** 0 NONE (plain), 1 ATTRIBUTOR, 2 FALLBACK_NOT_COMMITTED, 3 FALLBACK_HASH_MISMATCH, 4 FALLBACK_INVALID, 5 FALLBACK_BAD_SIGNATURE.
- **`CustomerVerified.introducer`:** the customer's L2 parent at this venue (D-008/D-508), or 0. It fires exactly once per (customer, venue).
- **`VenueRegistered` is followed by `TermsUpdated(version 1)`** in the same tx.
- **Rebuilding every view from logs:**

  | View | How to rebuild it |
  |---|---|
  | venue config | `VenueRegistered` + `VenueKeysUpdated` |
  | terms history | `TermsUpdated` |
  | seeds | `SeedAmbassadorSet` |
  | live intros | `IntroAccepted` − `IntroDropped`, then filter by `expiresAt` |
  | verified / introducer | `CustomerVerified` |
  | venue stats | verified = count of `CustomerVerified`; rewarded = count of `PaymentSettled.rewarded`; gross = Σ `amount`; rewardsPaid = Σ `RewardPaid`; rewardsReturned = Σ `RewardReturned` |
  | ambassador stats | customersCredited = count of distinct (venue, orderId) with `RewardPaid` role 1 to the address¹; venues = distinct venues among those; l1/l2 earned = Σ `RewardPaid` by role |

  ¹ Count `RewardReturned` role 1 with reason 2 (TRANSFER_FAILED) too: on-chain, `customersCredited` includes an L1 whose transfer failed. Amount-0 L1 credits arrive as `RewardPaid` (v2).

## §7 Env note
`WOM_CONTRACT_ADDRESS` / `WOM_DEPLOY_BLOCK` should become `VOUCH_CONTRACT_ADDRESS=0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` / `VOUCH_DEPLOY_BLOCK=72584790`. Code should prefer `VOUCH_ARC_TESTNET` from `@vouch/shared` over env vars.
