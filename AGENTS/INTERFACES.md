# INTERFACES — cross-agent source of truth
_Last updated: 2026-11-16 (session 2) by ORCHESTRATOR — §5 v1 + §6 ingestion (Phase 2); §2–§4 v3 (D-014, D-519, D-520; CONTRACTS_QE PASS-with-findings); §6–§7 Railway + delivery persistence (D-016, D-305). Changes require a DECISIONS.md entry; the ORCHESTRATOR applies them._

## 1. Network (Arc Testnet)
_Status: VERIFIED 2026-11-15 by ARCHITECT-research (S1). Evidence: docs/evidence/phase-0/research-s1-s3-s4.md. Decisions D-101..D-105._
| Key | Value | Verified? |
|---|---|---|
| Chain ID | `5042002` (hex `0x4cef52`) | ✅ live |
| Public RPC (canonical) | `https://rpc.testnet.arc.io` · WS `wss://rpc.testnet.arc.io` (open CORS, no key) | ✅ live |
| Legacy RPC alias | `https://rpc.testnet.arc.network` (still serves 5042002; viem `arcTestnet` default) | ✅ live |
| QuickNode RPC | env `ARC_RPC_URL` (keyed, needs account). Public partner endpoint `https://rpc.quicknode.testnet.arc.io` | ✅ public / ❌ keyed |
| Explorer | `https://explorer.testnet.arc.io` (Blockscout). `testnet.arcscan.app` 301-redirects here | ✅ live |
| Explorer API / verify | `--verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ --chain-id 5042002` | ✅ docs (not yet exercised) |
| Faucet | `https://faucet.circle.com`: 20 USDC / 2 h / address / chain, captcha, no login | ✅ docs |
| USDC (ERC-20) address | `0x3600000000000000000000000000000000000000` (FiatTokenProxy → `NativeFiatTokenV2_2` impl `0xc6ad664ac6679f4ce74e10e91449c93ec1ae3ca6`) | ✅ live |
| USDC ERC-20 decimals | `6` | ✅ live |
| Native gas decimals | `18` (same balance; `balanceOf = floor(native/1e12)`) | ✅ live |
| USDC EIP-712 domain | name `"USDC"`, version `"2"`, chainId 5042002, verifyingContract 0x3600…; `DOMAIN_SEPARATOR = 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0`; no `eip712Domain()` | ✅ live |
| EIP-2612 permit | Supported (`permit` v,r,s + bytes/ERC-1271 variant) | ✅ live |
| EIP-3009 | Supported: `transferWithAuthorization`, `receiveWithAuthorization` (payee-only), `cancelAuthorization`, v,r,s + bytes/ERC-1271 variants | ✅ live |
| Block time / finality | ~0.70 s measured (docs ~0.5 s); deterministic finality, no reorgs | ✅ live / docs |
| Gas pricing | EIP-1559+EWMA; min base fee 20 gwei (✅ live); txs with maxFeePerGas < 20 gwei are dropped (📄 docs only, not tested); gas limit 30M/block (✅ live) | ✅ live / 📄 docs |
| EVM | Osaka baseline; PREVRANDAO = 0; Foundry `evm_version = "prague"` recommended | ✅ docs |
| eth_getLogs range | a range of 10,000 blocks inclusive works (`toBlock - fromBlock ≤ 9,999`); 10,001 fails with `-32012` (QE-11) | ✅ live (QE reproduced) |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ✅ live |
| Multicall3 / Permit2 | `0xcA11bde05977b3631167028862bE2a173976CA11` / `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ live |
| Streams network id | `arc-testnet` (all EVM datasets supported) | ✅ docs |

## 2. Deployed contracts
| Contract | Address | Deploy block | Tx |
|---|---|---|---|
| `Hello` (**spike only**, canonical for S3, not production) | `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32` | 72567874 | `0x382fa0221cf39cf3c1107ffc6e2ecfef39620ddcc4e465a4aa363fbce6410f93` |
| `Hello` (QE gate re-deploy, Blockscout-verified; not watched by the Stream) | `0xc6282732b1852726F73D7Cea98cE6D03f9021906` | 72569134 | see `docs/evidence/phase-0/qe/` |
| **`Vouch` v3 (production, Blockscout-verified; runtime keccak `0x58517bb0…c6795`)** | `0xF4B641dc628de05336aa983B07D5d181254ff08e` | 72605845 | `0x7a9bd4b1f61888606b91e2a58f6a61efa2761e810216b04730addfead8dc2709` |
| `Vouch` v2 (**RETIRED**, D-520: superseded by the v3 submitter rule) | `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` | 72584790 | `0xa74642869c7f787be73598c4ffa590097ad7643af24ec8ade19d625b7265a2ab` |
| `Vouch` v1 (**RETIRED**, QE-C-01/02, do not use) | `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3` | 72580272 | `0xe3648ea6…016f` |

Constructor: `Vouch(IFiatTokenV2_2 usdc = 0x3600…0000)`. No owner, no admin, no upgradeability, non-payable. Code: `packages/shared/src/deployments.ts` (`VOUCH_ARC_TESTNET`; retired ones in `VOUCH_RETIRED_DEPLOYMENTS`), ABI `packages/shared/src/abi/vouch.ts` (`vouchAbi`, regenerate with `bash contracts/script/export-abi.sh`).

## 3. EIP-712
**Domain** (main contract): `{ name: "Vouch", version: "1", chainId: 5042002, verifyingContract: 0xF4B6…f08e }` (ERC-5267 `eip712Domain()` available; TS `vouchDomain(chainId, address)`).

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
- **`auth.submitter` (D-012, D-014, D-519):** `msg.sender` MUST equal `submitter`; anyone else gets `UnauthorizedSubmitter()` (checked last in the order checks, no state change). The app signs `submitter = RELAYER`. The kill-the-backend demo signs `submitter = customer`, and the customer's EOA calls `pay`; its USDC balance must be ≥ `amount + gasLimit × maxFeePerGas` (QE-C-11). `submitter = 0` is unpayable. The binding is per auth, not per order (QE-C-10): a customer can settle a second self-submit auth first, so the relayer treats `OrderAlreadySettled` as terminal and reads the split from events. **Normative (D-013):** never a public forwarder, multicall or meta-tx relay (Vouch has no ERC-2771).
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

- **Spike only:** `SplitAuth` (Hello.sol, domain `{name:"WomHello",version:"1"}`) has fields `address token, address from, bytes32 recipientsHash, bytes32 amountsHash, uint256 nonce, uint256 deadline`, typehash `0xa5393841…050168`. Array hashes are `keccak256(abi.encodePacked(arr))`. Proven locally in S5. The spike uses approve + `transferFrom`, not EIP-3009.

Other typehashes (the Vouch types are in the canonical block above; a stale pre-submitter PaymentAuth line was removed here per QE-2-02):
```
ReceiveWithAuth  0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8  (USDC/EIP-3009)
SplitAuth(spike) 0xa539384164e343b0ca91506ffcd85c6cabf826e8dda0690ff23c9b0aa1050168
```

## 4. Events (Streams filter targets)
> `topic0 = keccak256("Name(types)")`. Filter by the Vouch v3 address `0xF4B641dc628de05336aa983B07D5d181254ff08e` only (never the `0xffff…fffe` system emitter). Start block **72605845**. Topics unchanged from v2. Render the production filter with the `--events vouch` preset (= `VOUCH_EVENT_TOPICS` minus `EIP712DomainChanged`, D-305). Code: `VOUCH_EVENT_TOPICS` / `VOUCH_EVENT_SIGNATURES` in `@vouch/shared`.

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

## 5. API endpoints
> **v1 (Phase 2, BACKEND_RELAYER D-801..D-806; applied by ORCHESTRATOR).** Fastify `apps/api`. Production base URL `https://api-production-902bc54c.up.railway.app`. Source of truth for shapes: the route files in `apps/api/src/routes/` and the tests. "Settled" fields come only from STREAMS_INFRA's derived tables (D-803). `POST /payments` relays with `submitter = RELAYER`; `OrderAlreadySettled` → 409, terminal, split read from Streams (QE-C-10); balance ≥ amount (relayed) / ≥ amount + 900k × maxFee (self-submit) (QE-C-11).

- **Conventions:** amounts are base-unit strings or `{baseUnits, display}`. Errors are `{error: {code, message, retryable, details?}}`. Auth is `Authorization: Bearer <token>`. Typed data comes back as `{domain, types, primaryType, message}` with uint fields as decimal strings; convert them to BigInt before signing.
- **Auth:**
  - `POST /auth/challenge {address}` → `{challengeId, message, expiresAt}`
  - `POST /auth/verify {address, challengeId, signature, displayName?, passkeyCredentialId?}` → `{token, expiresAt, user}`
  - `GET /auth/session`
  - `POST /auth/logout`
  - `PATCH /me {displayName}`
- **Venues:**
  - `POST /venues/prepare {name, rewardBps, minOrder, payout?, description?, slug?}` → `{venue, slug, typedData}`
  - `POST /venues {venue, signature}` → 202 `{venue, status: "pending", txHash, relayId}`
  - `GET /venues`
  - `GET /venues/:venue`
  - `PATCH /venues/:venue`
  - `GET /venues/:venue/terms`
- **Owner actions:**
  - `POST /venues/:venue/actions {kind: updateTerms|setKeys|setSeedAmbassador, …}` → `{actionId, typedData}`
  - `POST /venues/:venue/actions/:id {signature}` → 202
  - `GET /venues/:venue/actions/:id`
- **Orders:**
  - `POST /venues/:venue/orders {amount, ttlSeconds?, label?}` → 201 `{order, signature, qrPayload, …}`
  - `GET /venues/:venue/orders` (owner)
  - `GET /venues/:venue/orders/:orderId` (public; `status: pending|relayed|failed|expired|paid`, `settled`)
- **Intros:**
  - `POST /intros/prepare {venue, linkType, ttlDays?}` → `{intro, typedData}`
  - `POST /intros {intro, signature, note?}` → 201 `{code, url, introHash}`
  - `GET /intros/:code`, which includes `status: active|expired|needs_reissue` and `reissueBy`
  - `POST /intros/:code/opens`
  - `POST /intros/:code/accept/prepare` → `{acceptance, typedData}`
  - `POST /intros/:code/accept {acceptance, signature}` → 202
  - `GET /me/links`
- **Payments:**
  - `POST /payments/quote {venue, orderId, whoSentYou?, mode?}` → `{intentId, quote, attribution, weights, weightsSignature, paymentAuth, typedData, balance, canAfford, warnings}`
  - `POST /payments {intentId, signature}` → 202 `{intentId, status: "pending", txHash, relayId}`
  - `GET /payments/:intentId` (`status: pending|settled|failed`, `settled` from Streams)
- **Reads:**
  - `GET /me/wallet`
  - `GET /me/activity`
  - `GET /ambassadors/:address`
  - `GET /venues/:venue/stats`
  - `GET /relay/:id`
  - `GET /relayer/status`
- **SSE:**
  - `GET /events/user/:address?token=` (own address only)
  - `GET /events/venue/:venue` (public)
  - Events: `payment.pending`, `payment.failed`, `payment.settled`, `reward.paid`, `intro.pending`, `intro.failed`, `intro.accepted`, `intro.dropped`, `customer.verified`, `venue.pending`, `venue.failed`, `venue.registered`, `venue.action.pending`, `venue.action.failed`, `terms.updated`, `venue.keys`, `seed.set`.
- **Dropped from the v0 draft:** `POST /onboarding/topup` (the CLI exists).
- **Also:** `GET /health`; `POST /webhooks/streams` (§6).

## 6. Webhook (QuickNode Streams → api)
_Updated 2026-11-16 by ORCHESTRATOR from STREAMS_INFRA (D-301..D-303). Live-only items still UNVERIFIED until the first real delivery._
- **Endpoint:** `POST /webhooks/streams` (Fastify, raw-body route). Production: **`https://api-production-902bc54c.up.railway.app/webhooks/streams`** (Railway project `vouch`, service `api`, D-016). Quick tunnels: local fallback only.
- **Auth (D-301):** headers `X-QN-Nonce`, `X-QN-Timestamp`, `X-QN-Signature` = `hex(HMAC-SHA256(key = utf8(STREAMS_WEBHOOK_SECRET), msg = nonce + timestamp + body))` over the exact decoded bytes (gunzip first if `Content-Encoding: gzip`). Constant-time compare.
- **Responses:** `503` secret unset/placeholder (fail closed) · `401` missing headers / bad signature · `400 body-decode-failed` bad gzip · `500 persist-failed` verified but not stored (QuickNode retries, D-305) · `200` accepted. Timestamp skew is logged, not rejected.
- **Body (D-302, our filter's envelope v1):** `{ v: 1, streamId, network, dataset, batchStart, batchEnd, batchSource: "metadata"|"logs", events: [ {address, topics, data, blockNumber, transactionHash, logIndex, event, ...} ] }`. The filter (`infra/streams/filter-logs.js`) keeps only logs from our contract address(es) with known topic0s and returns `null` otherwise. It never matches the EIP-7708 system emitter `0xffff…fffe`.
- **Ingestion (D-306, STREAMS_INFRA):** after the raw row commits, logs are decoded strictly with `vouchAbi` (only the v3 address, the 10 topics, `removed=false`; USDC/system-emitter/unknown topics counted as ignored), inserted into `ev_events` `ON CONFLICT (tx_hash, log_index) DO NOTHING`, applied in (block, logIndex) order (a batch behind the cursor triggers an in-order rebuild of derived tables from `ev_events`), one transaction + advisory lock per batch. **Ingest failure still answers 200** (raw row is durable); it is recorded in `ev_ingest_log` and retried from `stream_deliveries` after the next delivery and at boot (`ingestPending`). Response gains `ingested`; the log line gains `ingest:{ok,newEvents,duplicates,ignored,rebuilt,cursorBlock,events}`.
- **Derived tables (`ev_*`, own migrations folder `apps/api/drizzle-streams/`, table `__drizzle_migrations_streams`):** `ev_events, ev_cursor, ev_ingest_log, ev_venues, ev_terms, ev_seeds, ev_intros, ev_verified, ev_payments, ev_rewards, ev_venue_stats, ev_ambassadors`. Cost per verified customer = `rewardsPaid / verifiedCustomers` (`ev_venue_stats`).
- **StreamsPort (in-process API):** `createStreams(db)` → queries + `bus`; types in `apps/api/src/streams/types.ts` (structurally equal to `apps/api/src/ports/streams.ts`). The bus emits only NEW events after commit (never for replay/backfill); listener errors are contained.
- **Determinism:** `pnpm --filter @vouch/scripts streams:verify [--db]` asserts chain-backfill == live == replay == rebuild (hash over derived tables, excluding `blockTime`). Also `streams:backfill`, `streams:replay [--in-place]`, `streams:hash`.
- **Persistence (D-305):** every *verified* delivery becomes one `stream_deliveries` row before the 200 (`id, received_at, verified, stream_id, batch_start, batch_end, event_count, bytes, gzip, headers jsonb (allow-list, no signature), summary jsonb, body jsonb, body_text`; stream/batch from headers first, then body; no dedupe). 503/401/400 store nothing. One structured log line `streams delivery` per request (no token/signature/body). Read hosted rows: `pnpm --filter @vouch/scripts streams:deliveries --db [--db-url …]` (uses `DATABASE_PUBLIC_URL` then `DATABASE_URL`; refuses `*.railway.internal`).
- **Spike log (local dev only):** NDJSON at `data/local/streams-spike.ndjson`; off when `NODE_ENV=production` unless `STREAMS_SPIKE_LOG` names a path; `STREAMS_SPIKE_LOG=off` disables it. View with `pnpm --filter @vouch/scripts streams:deliveries`.
- **UNVERIFIED (live):** the timestamp unit (seconds?), whether the raw dataset arrives 3-deep nested or unwrapped (the filter handles both), and whether `blockTimestamp` is present on logs.

## 7. Env vars
> **v0 DRAFT.** Names match root `.env.example` (placeholders only). Real values live only in root `.env` / `apps/*/.env.local` (gitignored, D-003). `NEXT_PUBLIC_*` values are exposed to the browser and must never hold secrets.

| Var | Used by | Meaning |
|---|---|---|
| `ARC_RPC_URL` | api, scripts, foundry (`arc_testnet`) | JSON-RPC: keyed QuickNode, or public `https://rpc.testnet.arc.io` (D-101) |
| `ARC_CHAIN_ID` | api, scripts | `5042002` (D-101) |
| `ARC_EXPLORER_URL` | web, docs | `https://explorer.testnet.arc.io` (Blockscout, D-101) |
| `USDC_ADDRESS` | all | `0x3600000000000000000000000000000000000000` (6 dec, D-101) |
| `VOUCH_CONTRACT_ADDRESS` · `VOUCH_DEPLOY_BLOCK` | api, streams, web | Main contract + deploy block (backfill start). Prefer `VOUCH_ARC_TESTNET` from `@vouch/shared` (D-510) |
| `HELLO_ADDRESS` | scripts (S2/S5 spike) | Hello spike contract |
| `DEPLOYER_PRIVATE_KEY` | contracts scripts | Deploys contracts (**secret**) |
| `RELAYER_PRIVATE_KEY` | api | Submits all user txs, pays gas (**secret**) |
| `ATTRIBUTOR_PRIVATE_KEY` | api (attribution) | Signs `Weights` for demo venues (**secret**) |
| `VENUE_SIGNER_PRIVATE_KEY` | api | Signs `Order` for demo venues (**secret**) |
| `SPIKE_USER_PRIVATE_KEY` | scripts (S5) | Throwaway customer key for spikes (**secret**) |
| `QUICKNODE_STREAMS_API_KEY` | scripts/infra | Create/manage Streams (**secret**) |
| `STREAMS_WEBHOOK_SECRET` | api | Verify Streams webhook signature (**secret**; on Railway: service `api` → Variables; mirrored in `.env`) |
| `DATABASE_URL` | api | `postgres://…` (hosted; on Railway `${{Postgres.DATABASE_URL}}`, private network) or `pglite://<path>` / `pglite://memory` (local/tests) |
| `DATABASE_PUBLIC_URL` | scripts | Railway Postgres public URL, only for `streams:deliveries --db` (needs Postgres public networking) |
| `PORT` | api | Injected by the host (Railway; pinned 8080); wins over `API_PORT` (D-305) |
| `NODE_ENV` | api | `production` on Railway (turns the NDJSON spike log off) |
| `API_PORT` · `API_HOST` · `CORS_ORIGINS` | api | Local listen fallback (`PORT` wins); comma-separated allowed origins (Railway starts with `http://localhost:3100`; add the web origin when web deploys) |
| `SESSION_SECRET` | api | Session signing (**secret**) |
| `PUBLIC_API_URL` · `NEXT_PUBLIC_API_URL` | web | API base URL (server-side / browser) |
| `LLM_PROVIDER` · `LLM_API_KEY` | api (Tier 3) | Optional AI attribution refinement (`none` disables) |
| `STREAMS_SPIKE_LOG` _(optional)_ | api | Override path of the S3 NDJSON log |

**Phase 1 note (D-510, v2):** `WOM_CONTRACT_ADDRESS` / `WOM_DEPLOY_BLOCK` should become `VOUCH_CONTRACT_ADDRESS=0xF4B641dc628de05336aa983B07D5d181254ff08e` / `VOUCH_DEPLOY_BLOCK=72605845` (v3, D-520). Code should prefer `VOUCH_ARC_TESTNET` from `@vouch/shared` over env vars.

**Phase 2 env additions (D-801, optional with defaults; see `.env.example`):** `SESSION_TTL_SECONDS`, `PUBLIC_WEB_URL`, `RELAYER_MAX_GAS_PAY`, `RELAYER_MAX_FEE_GWEI`, `RELAYER_RECEIPT_TIMEOUT_MS`, `RELAYER_MAX_SEND_ATTEMPTS`, `RELAYER_RATE_PER_USER_PER_MIN`, `RELAYER_RATE_GLOBAL_PER_MIN`, `RELAYER_MAX_QUEUE`, `STORY_API_URL` (scripts). `ARC_RPC_URL` is also used by the `streams:*` commands. Secrets on Railway (api → Variables): `RELAYER_PRIVATE_KEY`, `ATTRIBUTOR_PRIVATE_KEY`, `VENUE_SIGNER_PRIVATE_KEY`, `SESSION_SECRET`, `STREAMS_WEBHOOK_SECRET`.

**Phase 2 security additions (D-808/D-809, all optional, defaults in `apps/api/src/config.ts`, listed commented in `.env.example`):** relayer spend budget `RELAYER_BUDGET_{HOURLY,DAILY}_USDC` (1/5), `RELAYER_BUDGET_USER_{HOURLY,DAILY}_USDC` (0.20/0.50), `RELAYER_BUDGET_VENUE_{HOURLY,DAILY}_USDC` (0.50/2), `RELAYER_MIN_BALANCE_USDC` (2), `ORDER_MIN_USDC` (0.50); queue/quotas `RELAYER_PAY_RESERVE`, `RELAYER_QUOTA_*`; per-IP `RATE_{AUTH,SPEND,WRITE,READ,SSE}_PER_MIN`; `SSE_MAX_*`, `SSE_HEARTBEAT_MS`; `TRUST_PROXY` (default `100.64.0.0/10`). New error codes: `RELAYER_BUDGET_EXHAUSTED` (503), `SPEND_QUOTA_EXCEEDED` (429), `TOO_MANY_CONNECTIONS` (429); `RATE_LIMITED.details.scope`. API changes: session token = `Authorization: Bearer` only (`?token=` only on `GET /events/user/:address`; no cookie); `/relayer/status` → `{enabled, budget, lowBalance}` (no `signers`); `/venues` paginated (`limit` ≤ 50); webhook raw ≤ 4 MiB / decoded ≤ 8 MiB (413), per-IP 429, duplicate deliveries → 200 `duplicate:true` (D-308/D-309).
