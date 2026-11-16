# INTERFACES — cross-agent source of truth
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — v0 skeleton. Changes require a DECISIONS.md entry; the ORCHESTRATOR applies them._

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
| Gas pricing | EIP-1559+EWMA; min base fee 20 gwei (txs with maxFeePerGas < 20 gwei are dropped); gas limit 30M/block | ✅ live |
| EVM | Osaka baseline; PREVRANDAO = 0; Foundry `evm_version = "prague"` recommended | ✅ docs |
| eth_getLogs range | ≤ 10,000 blocks per call (public RPC) | ✅ live |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ✅ live |
| Multicall3 / Permit2 | `0xcA11bde05977b3631167028862bE2a173976CA11` / `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ live |
| Streams network id | `arc-testnet` (all EVM datasets supported) | ✅ docs |

## 2. Deployed contracts
| Contract | Address | Deploy block | Tx |
|---|---|---|---|
| _none yet_ | | | |

## 3. EIP-712
> **v0 DRAFT (ARCHITECT, 2026-11-15) — CONTRACTS/BACKEND finalize.** Code mirror: `packages/shared/src/eip712.ts` (field order = type string = typehash; keep them identical to the Solidity `*_TYPEHASH` constants).

**Domain** (main contract): `{ name: "wom", version: "1", chainId, verifyingContract: <main contract> }`.
`name` comes from `APP_NAME` at Phase 0 but is the separate literal `EIP712_DOMAIN_NAME`, **frozen at deploy**; a display-name change must not change it.

| Type | Signed by | Fields (in order) | typehash = keccak256(type string) |
|---|---|---|---|
| `Intro` | referrer | `address venue, address referrer, uint32 termsVersion, uint8 linkType, uint64 issuedAt, uint64 expiresAt, bytes32 nonce` | `0xdc4192f6…dbb7c3` |
| `IntroAcceptance` | customer | `bytes32 introHash, address customer, uint64 deadline` | `0x400ca88e…a469d0` |
| `Order` | venue **signer** key | `address venue, bytes32 orderId, uint256 amount, uint64 expiresAt` | `0xd418cbc9…11d8a3` |
| `Weights` | venue **attributor** key | `address venue, address customer, bytes32 orderId, address[] referrers, uint16[] bps` | `0x6d9e3bfc…27720c` |
| `PaymentAuth` | customer (committed via EIP-3009 nonce, not signed separately) | `address customer, address venue, bytes32 orderId, uint256 amount, bytes32 weightsHash, uint64 deadline` | `0x83204ea1…35b253` |
| `ReceiveWithAuthorization` (USDC's own type, domain `{name:"USDC",version:"2",chainId:5042002,verifyingContract:0x3600…}`) | customer | `address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce` | `0xd099cc98…413de8` |

Rules (contract-enforced):
- **Intro.** `linkType`: 0 = personal, 1 = broadcast. `termsVersion` pins the venue terms in force when the referrer shared; the payment uses those frozen terms. `expiresAt` is bounded by the contract (max TTL, e.g. 30 days, CONTRACTS decides). `nonce` is random 32 bytes, so the referrer can revoke it (`revokeIntro(nonce)`, optional).
- **IntroAcceptance.** `introHash` is the **full EIP-712 digest** of the Intro (`hashTypedData(domain, Intro)`), so it already binds venue, referrer, chain and contract. `customer` must equal the recovered signer, and `customer != referrer` (no self-referral).
  - Personal intro: **single-use**. The first valid acceptance consumes `introHash`.
  - Broadcast intro: many customers can accept it, but each `(introHash, customer)` pair only once.
  - So an intro can never be moved to another venue (venue is in the Intro), and a personal intro can't be reused for a second customer.
  - The relayer submits `acceptIntro(intro, referrerSig, acceptance, customerSig)`, which emits `IntroAccepted`.
- **Order.** `amount` is in USDC base units (6 decimals). `orderId` is unique per venue and becomes `settled` after one payment. Recovered signer == `venues[venue].signer`.
- **Weights.** `referrers.length == bps.length`, length between 1 and `MAX_REFERRERS` (5). `Σbps == 10_000`. Each `bps[i] <= 8_000` unless there is a single referrer. No duplicates. Every referrer holds an accepted, unexpired intro for this (customer, venue). Recovered signer == `venues[venue].attributor`. If weights are invalid or missing, the contract falls back on-chain (equal split across valid intros, capped at 5, most recent first; CONTRACTS finalizes).
- **PaymentAuth (D-103).** The payment goes through USDC EIP-3009 `receiveWithAuthorization`, and the customer signs **one** message.
  - **Nonce.** `nonce = hashStruct(PaymentAuth)`, the EIP-712 struct hash with no domain.
  - **What the customer signs.** USDC's `ReceiveWithAuthorization{from: customer, to: <main contract>, value: amount, validAfter: 0, validBefore: deadline, nonce}`, under the USDC domain.
  - **What the contract does.** It recomputes the nonce from the call params, calls `USDC.receiveWithAuthorization(customer, address(this), amount, 0, deadline, nonce, sig)`, then splits with `USDC.transfer`, all in one tx.
  - **What this binds.** The relayer can't change amount, venue, order or weights. Payee-only receive means the authorization can't be front-run. EIP-3009 nonces are unique per authorizer, so no sequential nonce is needed.
  - **No approve, no allowance, no customer gas.**
  - **`weightsHash`** = `hashStruct(Weights)` of the quoted attributor-signed weights, or `bytes32(0)` to accept the on-chain fallback.
  - **`amount`** must equal `Order.amount`.
  - **Fallback:** EIP-2612 `permit` + `transferFrom`, also supported on Arc USDC.
- **Contract-wide (D-102/D-104).**
  - Signature checks for Intro, IntroAcceptance, Order and Weights use OZ `SignatureChecker` (ECDSA + ERC-1271), so smart accounts can be added later.
  - The main contract is **non-payable**: no `msg.value`, no native sends. All amounts are 6-dec USDC via `0x3600…`.
- **Spike only:** `SplitAuth` (Hello.sol, domain `{name:"WomHello",version:"1"}`) has fields `address token, address from, bytes32 recipientsHash, bytes32 amountsHash, uint256 nonce, uint256 deadline`, typehash `0xa5393841…050168`. Array hashes are `keccak256(abi.encodePacked(arr))`. Proven locally in S5. The spike uses approve + `transferFrom`, not EIP-3009.

Full typehashes:
```
Intro            0xdc4192f6970873be49c69a70fecca1bd4ec35227b3516fe7213b516246dbb7c3
IntroAcceptance  0x400ca88e9ec28bb1f7e73d44cb8743cd861d151b07da51fae9ff083083a469d0
Order            0xd418cbc9a68e3abda5b09e4e1b5c5404de5701543ff1c0c5a807f80f9d11d8a3
Weights          0x6d9e3bfc06d45d14351cb1d560fee0b175c5b21e7134c820b3c65deab627720c
PaymentAuth      0x83204ea1500cc20bbe24158546e6acd5b12f1284315bff525545b80a5635b253
ReceiveWithAuth  0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8  (USDC/EIP-3009)
SplitAuth(spike) 0xa539384164e343b0ca91506ffcd85c6cabf826e8dda0690ff23c9b0aa1050168
```

## 4. Events (Streams filter targets)
> **v0 DRAFT — CONTRACTS finalizes.** `topic0 = keccak256("Name(type1,type2,…)")`: canonical types, no names, no spaces, no `indexed`. Compute with `cast keccak "<sig>"` or viem `toEventSelector`. Indexed fields are topics 1–3 (max 3). The payload is designed so the DB can be **rebuilt from logs alone** (backfill/replay).
> **Filter by our contract address only.** On Arc every USDC transfer also emits an 18-dec EIP-7708 system `Transfer` log from `0xffff…fffe`. Ignore it (D-102). `eth_getLogs` pages are ≤ 9,999 blocks and finality is 1 block (D-101).

| Event | Signature (indexed marked) | topic0 |
|---|---|---|
| `VenueRegistered` | `(address indexed venue, address indexed owner, address signer, address attributor, string metadataURI)` | `0xd58cd644fd18c3281d0b2b5087d2e5ab6dbb3bedaad3e8c7312b6e290ee0f7d4` |
| `VenueKeysUpdated` _(proposed)_ | `(address indexed venue, address signer, address attributor)` | `0x7f81f0bfae01323140c6d4001aa094b57b8674b05afc2cb8c1339e24a09e6f2e` |
| `TermsUpdated` | `(address indexed venue, uint32 indexed termsVersion, uint16 rewardBps, uint256 minOrderAmount, uint64 effectiveAt)` | `0x86d80d9334324698e8c0763e1f6a4179b0ae6af2e64a9724746ce284ec78bb8b` |
| `IntroAccepted` | `(address indexed venue, address indexed referrer, address indexed customer, bytes32 introHash, uint32 termsVersion, uint8 linkType, uint64 expiresAt)` | `0xe75b5b5d835a46c918feb6cac867d2b1c6ed4d45a112ebaf7067bb9c1fcf37fc` |
| `PaymentSettled` | `(address indexed venue, address indexed customer, bytes32 indexed orderId, uint256 amount, uint256 venueAmount, uint256 rewardPool, uint32 termsVersion, bool firstPurchase, bool fallbackWeights)` | `0xbaab006054cc197f7fd4876bdf177f9358ee432b9afea0feeacc842a99dc2adf` |
| `RewardPaid` | `(bytes32 indexed orderId, address indexed recipient, address indexed venue, uint8 role, uint256 amount, address viaReferrer)` | `0x4016cba481ec6fd9d671d18c19dd9b62b4fc63403c17edfafb37c52edeabf2c8` |
| `CustomerVerified` | `(address indexed venue, address indexed customer, address indexed introducer, bytes32 orderId)` | `0xca816bf56b298971c59e72dcd003c06b351b66ffedb5ec84017d6195ec0152c8` |

Semantics:
- `RewardPaid.role`: 0 = CASHBACK, 1 = L1, 2 = L2 (`REWARD_ROLE` in shared constants).
  - `viaReferrer`: for L2, the L1 referrer whose introducer is being paid. For L1, the referrer itself. For CASHBACK, `address(0)`. This field draws the money-graph edges.
  - Amounts are USDC base units.
- One `PaymentSettled`, followed by N `RewardPaid` logs in the same tx (share `orderId`). Invariant: `venueAmount + Σ RewardPaid.amount == amount`. Undistributable shares go into `venueAmount`.
- `CustomerVerified` fires on a customer's **first** purchase at a venue. `introducer` is the top-weight L1 referrer of that purchase (ties go to the lower array index), or `address(0)` if there was none. It becomes the customer's L2 parent when they later refer someone. _CONTRACTS to confirm the L2 parent rule._
- Spike events: `Ping(address indexed from, bytes32 tag, uint256 at)` `0x20aede858ee515bfb2b198e62ba10a8133ae61e0c55d61c40b4c6d4191c0ca55`; `Split(address indexed token, address indexed from, address indexed relayer, uint256 recipientCount, uint256 total)` `0x42fb8796ffe3237a1f58f3e03a85a890f71c1582e5ef97e78936c4f5b6968cd9`.

## 5. API endpoints
> **v0 DRAFT — BACKEND_RELAYER finalizes (Phase 2).** Fastify service (`apps/api`), JSON bodies, amounts as **decimal strings of base units** (never JS numbers), addresses checksummed, all signatures 0x-hex. Auth = session cookie/bearer from the passkey/wallet flow (S4 pending). "relay" = the backend relayer submits the tx and pays gas.

| Method | Path | Purpose / sketch |
|---|---|---|
| GET | `/health` | Liveness + DB ping (exists) |
| POST | `/auth/challenge` | `{address}` → `{nonce, message}` (SIWE-style or passkey challenge, S4) |
| POST | `/auth/verify` | `{address, signature \| credential}` → session |
| GET | `/auth/session` · POST `/auth/logout` | Current user `{address, displayName, roles}` / end session |
| GET | `/venues` · GET `/venues/:venue` | List / detail (name, terms, stats summary) |
| POST | `/venues` | Register venue → relay `registerVenue` (venue owner signs) |
| GET | `/venues/:venue/terms` | Current + historical terms (`termsVersion`, `rewardBps`, `minOrderAmount`) |
| POST | `/venues/:venue/terms` | Update terms → relay `setTerms` (owner-signed) |
| POST | `/venues/:venue/orders` | Staff keys amount → backend signs `Order` with VENUE_SIGNER key → `{order, signature, qrPayload}` |
| GET | `/orders/:orderId` | Order status `pending \| paid \| expired` (+ txHash) |
| POST | `/intros` | Referrer-signed `Intro` (personal/broadcast) stored → `{linkId, url}` |
| GET | `/intros/:linkId` | Public link landing data (venue, referrer display, terms, expiry) |
| POST | `/intros/:linkId/opens` | Record a link open (attribution signal; rate-limited, no auth) |
| POST | `/intros/:linkId/accept` | Customer `IntroAcceptance` sig → relay `acceptIntro` → `{txHash}` |
| POST | `/payments/quote` | `{order, orderSig, customer, whoSentYou?}` → split preview `{amount, cashback, rewards[], venueAmount}`, `Weights` with attributor sig, `paymentAuth` (incl. `weightsHash`, `deadline`), and the USDC `ReceiveWithAuthorization` typed data to sign (D-103) |
| POST | `/payments` | `{order, orderSig, weights?, weightsSig?, paymentAuth, receiveAuthSig}` → relay `pay` (maxFeePerGas ≥ 20 gwei) → `{txHash}` |
| GET | `/me/wallet` | Balance (USDC, formatted + base units), pending/claimed rewards |
| GET | `/me/activity` | Payments, rewards, intros (from DB, rebuilt from events) |
| GET | `/ambassadors/:address` | Ambassador record: venues recommended, verified customers brought, earnings (on-chain derived) |
| GET | `/venues/:venue/stats` | Verified customers, cost per verified customer, reward spend, money-graph edges |
| POST | `/onboarding/topup` | Testnet demo: simulated top-up (labeled). No approve is needed with EIP-3009 |
| GET (SSE) | `/events/user/:address` | Live stream: `payment.settled`, `reward.paid`, `intro.accepted` for this user |
| GET (SSE) | `/events/venue/:venue` | Live stream: `payment.settled`, `reward.paid`, `customer.verified`, `order.status` |
| POST | `/webhooks/streams` | QuickNode Streams delivery (exists as S3 stub; see §6) |

## 6. Webhook payload (Streams → api)
> **v0 DRAFT — STREAMS_INFRA finalizes after S3.**
- Endpoint `POST /webhooks/streams` (Fastify). The raw body is kept as a Buffer for signature verification.
- **Phase 0 stub:** appends `{receivedAt, method, url, headers, bytes, body | bodyBase64}` as one NDJSON line to `data/local/streams-spike.ndjson` (gitignored) and returns `200 {ok, bytes}`. `bodyBase64` is used when `content-encoding` is set.
- **Pending S3:**
  - exact payload shape (batch of blocks vs. filtered logs; field names);
  - compression;
  - QuickNode signature headers and HMAC scheme, verified with `STREAMS_WEBHOOK_SECRET`;
  - retry/ordering semantics;
  - the filter function that keeps only logs whose `address == WOM_CONTRACT_ADDRESS` and `topic0 ∈ §4`, dropping system logs from `0xffff…fffe`.
  - D-105 has the research outcome: dataset `logs`, JS `main(stream)` filter, HMAC `X-QN-Signature` = hex HMAC-SHA256(token, nonce+timestamp+body).
- **Planned processing:**
  - Idempotent upsert keyed by `(txHash, logIndex)`.
  - Reorg-safe: store `blockHash` and re-apply on mismatch.
  - Then fan out to SSE channels.
  - Backfill replays the same handler from `WOM_DEPLOY_BLOCK`.

## 7. Env vars
> **v0 DRAFT.** Names match root `.env.example` (placeholders only). Real values live only in root `.env` / `apps/*/.env.local` (gitignored, D-003). `NEXT_PUBLIC_*` values are exposed to the browser and must never hold secrets.

| Var | Used by | Meaning |
|---|---|---|
| `ARC_RPC_URL` | api, scripts, foundry (`arc_testnet`) | JSON-RPC: keyed QuickNode, or public `https://rpc.testnet.arc.io` (D-101) |
| `ARC_CHAIN_ID` | api, scripts | `5042002` (D-101) |
| `ARC_EXPLORER_URL` | web, docs | `https://explorer.testnet.arc.io` (Blockscout, D-101) |
| `USDC_ADDRESS` | all | `0x3600000000000000000000000000000000000000` (6 dec, D-101) |
| `WOM_CONTRACT_ADDRESS` · `WOM_DEPLOY_BLOCK` | api, streams, web | Main contract + deploy block (backfill start) |
| `HELLO_ADDRESS` | scripts (S2/S5 spike) | Hello spike contract |
| `DEPLOYER_PRIVATE_KEY` | contracts scripts | Deploys contracts (**secret**) |
| `RELAYER_PRIVATE_KEY` | api | Submits all user txs, pays gas (**secret**) |
| `ATTRIBUTOR_PRIVATE_KEY` | api (attribution) | Signs `Weights` for demo venues (**secret**) |
| `VENUE_SIGNER_PRIVATE_KEY` | api | Signs `Order` for demo venues (**secret**) |
| `SPIKE_USER_PRIVATE_KEY` | scripts (S5) | Throwaway customer key for spikes (**secret**) |
| `QUICKNODE_STREAMS_API_KEY` | scripts/infra | Create/manage Streams (**secret**) |
| `STREAMS_WEBHOOK_SECRET` | api | Verify Streams webhook signature (**secret**) |
| `DATABASE_URL` | api | `postgres://…` (hosted) or `pglite://<path>` / `pglite://memory` (local/tests) |
| `API_PORT` · `API_HOST` · `CORS_ORIGINS` | api | Listen address; comma-separated allowed origins |
| `SESSION_SECRET` | api | Session signing (**secret**) |
| `PUBLIC_API_URL` · `NEXT_PUBLIC_API_URL` | web | API base URL (server-side / browser) |
| `LLM_PROVIDER` · `LLM_API_KEY` | api (Tier 3) | Optional AI attribution refinement (`none` disables) |
| `STREAMS_SPIKE_LOG` _(optional)_ | api | Override path of the S3 NDJSON log |
