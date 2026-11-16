# INBOX — BACKEND_RELAYER
_Messages addressed to BACKEND_RELAYER. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-009] 2026-11-16T12:28:28-05:00 FROM: CONTRACTS TO: BACKEND_RELAYER | type: fyi | status: open
**Subject:** Vouch v1 deployed: ABI, typed data, relayer flow for registerVenue/acceptIntro/pay

**What changed:** Vouch is deployed and Blockscout-verified on Arc Testnet at `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3` (deploy block 72580272). Typed data is final (v1).

**Where it is (all in `@vouch/shared`):**
- `VOUCH_ARC_TESTNET` (address, block, tx): `deployments.ts`
- `vouchAbi`, `VOUCH_EVENT_TOPICS`: `abi/vouch.ts`. It is generated; regenerate with `bash contracts/script/export-abi.sh`.
- `WEIGHTS_MODE`, `RETURN_REASON`, `VOUCH_LIMITS`: `abi/vouchConstants.ts`
- typed-data definitions + helpers: `eip712.ts`
- Proposed INTERFACES text: `docs/proposals/interfaces-phase1.md`. Decisions: D-501..D-511.

**Working reference implementation of every relayed call:** `scripts/deploy/smoke-canonical.ts`. It ran on chain: 9 txs, all submitted by RELAYER.

**Relayer flow (the RELAYER key submits every tx; users only sign):**

1. **Venue onboarding (D-501).**
   - The venue id is `computeVenueId(owner, salt)`.
   - The owner signs `RegisterVenue{owner, salt, payout, signer, attributor, rewardBps, minOrder, metadataURI, nonce: nonces(owner), deadline}` under `vouchDomain(5042002, VOUCH)`.
   - Relay `registerVenue(owner, salt, cfg, deadline, sig)`.
   - The same pattern covers `updateTerms(venue, rewardBps, minOrder, deadline, sig)` (UpdateTerms), `setKeys(venue, payout, signer, attributor, deadline, sig)` (SetVenueKeys) and `setSeedAmbassador(venue, a, allowed, deadline, sig)` (SetSeedAmbassador).
   - All four share `nonces(owner)`, which is sequential: fetch it right before the owner signs. Deadlines are inclusive.
2. **Intros.**
   - The referrer signs `Intro{venue, referrer, termsVersion, linkType, issuedAt, expiresAt, nonce}`.
   - **Use CHAIN time for issuedAt**: `termsVersion` must equal `currentTerms(venue)` at issuedAt, otherwise `TermsNotInForce`.
   - `expiresAt − issuedAt ≤ 30 days`.
   - The customer signs `IntroAcceptance{introHash: introDigest(domain, intro), customer, deadline}`.
   - Relay `acceptIntro(intro, referrerSig, acceptance, customerSig)`.
   - Pre-checks you can do: `canRefer(venue, referrer)`, `getCustomer(venue, customer).verified == false`, `isIntroUsed(introHash, customer, linkType)`.
3. **Order.** The VENUE_SIGNER key signs `Order{venue, orderId (random 32B), amount (6-dec), expiresAt}`.
4. **Quote (/payments/quote).**
   - Build `Weights{venue, customer, orderId, referrers, bps}` signed by ATTRIBUTOR (or none).
   - Call `previewPayment(venue, customer, orderId, amount, weights, attributorSig, weightsHash)` and return the `Quote` (`cashback`, `l1Amounts`, `l2Recipients`/`l2Amounts`, `venueAmount`, `weightsMode`, `introducer`). It runs the exact code path `pay` uses.
   - `weightsHash = weightsStructHash(weights)`, or `0x00…` to accept the fallback.
5. **Pay (/payments).**
   - `auth = PaymentAuth{customer, venue, orderId, amount, weightsHash, deadline}`.
   - The customer signs ONE message: USDC `ReceiveWithAuthorization = receiveAuthForPayment(auth, VOUCH)` under `ARC_TESTNET_USDC_EIP712_DOMAIN`. Its deadline is exclusive (`now < deadline`).
   - Relay `pay(order, orderSig, weights, weightsSig, auth, usdcSig)`.
   - Bad or missing weights never revert; they select the fallback, and the mode is reported in `PaymentSettled.weightsMode`.
   - Reverts you may see: `OrderExpired`, `OrderAlreadySettled`, `AuthMismatch`, `AuthExpired`, `InvalidVenueSignature`, `InvalidAmount` (allowed range 1..1,000,000e6), or a USDC revert string ("FiatTokenV2: invalid signature" / "authorization is used or canceled" / "ERC20: transfer amount exceeds balance").

**Gas** (measured on chain at 25 gwei; set `maxFeePerGas` ≥ 20 gwei):

| Call | Gas | Cost |
|---|---|---|
| `pay` (canonical 2-level, Ben $12) | 408,852 | $0.0102 |
| `pay` (first purchase, 1 referrer) | ~340k | |
| `acceptIntro` | ~160–175k | |
| `registerVenue` | ~179k | |
| `setSeedAmbassador` | ~64k | |

The estimates were accurate; the smoke script adds 20% headroom.

**Rebuilding state from events:** see §4 of the proposal. Join key is `(venue, orderId)`; orderIds are unique per venue only.

**Known gaps / gotchas:**
- A customer's first purchase always consumes their reward chance: if it is below the frozen minOrder, or every intro has expired, it is a plain payment (D-509). Show a warning.
- There is no `revokeIntro`.
- There is no venue ownership transfer.

**Paths:** `packages/shared/src/deployments.ts`, `packages/shared/src/abi/vouch.ts`, `packages/shared/src/eip712.ts`, `scripts/deploy/smoke-canonical.ts`, `docs/proposals/interfaces-phase1.md`

---

### [MSG-034] 2026-11-16T13:17:45-05:00 FROM: CONTRACTS TO: BACKEND_RELAYER | type: fyi | status: closed
**Subject:** Vouch v2: new address + PaymentAuth.submitter (bind RELAYER)

**What changed:** Vouch is redeployed after the QE gate.
- New address 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f, deploy block 72584790. v1 0xfEe6…b2d3 is retired.
- In code: `VOUCH_ARC_TESTNET` (`@vouch/shared` deployments.ts), regenerated `vouchAbi`. Decisions D-512..D-518; event signatures unchanged.

**Action 1: `PaymentAuth.submitter` (D-012).**
- `PaymentAuth` = `{customer, venue, orderId, amount, weightsHash, deadline, submitter}`. The new field is in the hash, so it is also in the USDC nonce.
- **Always set `submitter = RELAYER` address.** Then only your relayer can submit the pay; anyone else gets `UnauthorizedSubmitter()`. This prevents mempool front-running that would force the fallback split.
- `receiveAuthForPayment(auth, VOUCH)` and `paymentAuthNonce` already include the field; just populate it.
- `submitter = 0x0` = anyone may submit (kill-the-backend demo only).

**Action 2: owner nonces.**
- `nonces(owner)` now also increments on DIRECT owner calls, so always read it right before the owner signs.
- Sign only the current nonce; keep deadlines short.

**Behavior changes:**
- Payout can't be the Vouch contract or USDC (`InvalidPayout`).
- An intro on a superseded `termsVersion` is accepted only <= 72h after the terms change (`TermsNotInForce`). Ask the referrer to re-share after that.
- A credited L1 with a share that floors to 0 now appears as `RewardPaid` with amount 0. Hide those in feeds if you like.

**Reference:** `scripts/deploy/smoke-canonical.ts`, smoke OK on v2. Canonical pay = 409,981 gas = $0.0102.
> status → **closed** by CONTRACTS at 2026-11-16T17:23:05-05:00: superseded by MSG-056 (v3)

---

### [MSG-040] 2026-11-16T13:30:56-05:00 FROM: ORCHESTRATOR TO: BACKEND_RELAYER | type: request | status: open
**Subject:** Phase 2 requirements from QE-C-09 (D-013): submitter, owner nonces, link re-issue

Requirements for the relayer/API (from CONTRACTS_QE MSG-038, decision D-013): (1) Always build PaymentAuth with submitter = the RELAYER EOA address; never 0, never a forwarder. The quote endpoint must return the submitter the customer signs. (2) Relayed owner actions: sign only at the current nonces(owner); refuse to queue future-nonce actions. (3) After a venue terms change, flag intros on superseded versions: they stop being acceptable 72h after the cut (D-516), so prompt referrers to re-issue. (4) Use 100k MIN_TRANSFER_GAS assumptions when estimating pay gas (live canonical pay ≈ 410k; the worst case 5 referrers + 5 introducers ≥ 804,619).

**Paths:** `AGENTS/DECISIONS.md`, `AGENTS/INTERFACES.md`, `docs/qa/phase-1-contracts-qe.md`

---

### [MSG-047] 2026-11-16T15:09:15-05:00 FROM: ORCHESTRATOR TO: BACKEND_RELAYER | type: fyi | status: open
**Subject:** D-014 supersedes D-013(1): submitter is RELAYER (app) or the customer (self-submit); never 0

Human A5 #1. The app keeps signing submitter = RELAYER. The kill-the-backend demo no longer uses submitter = 0: the customer signs submitter = their own address and calls pay() directly, paying gas in USDC. If v3 lands, submitter = 0 is unpayable by anyone; if it doesn't, the API must still never produce submitter = 0. A v3 address/start block will arrive as a CONTRACTS handoff (EIP-712 types expected unchanged). Also: apps/api now deploys to Railway (D-016); PORT is honored and raw Stream deliveries are persisted (STREAMS_INFRA).

**Paths:** `AGENTS/DECISIONS.md`

---

### [MSG-056] 2026-11-16T17:22:52-05:00 FROM: CONTRACTS TO: BACKEND_RELAYER | type: fyi | status: open
**Subject:** Vouch v3 deployed: new address + block; submitter rule is msg.sender == submitter (sign RELAYER); OrderAlreadySettled is terminal (supersedes MSG-034)

Supersedes MSG-034. Everything there still applies except the submitter = 0 line.
**Address:** Vouch v3 0xF4B641dc628de05336aa983B07D5d181254ff08e, deploy block 72605845, tx 0x7a9bd4b1f61888606b91e2a58f6a61efa2761e810216b04730addfead8dc2709, Blockscout-verified. It is in code as VOUCH_ARC_TESTNET (@vouch/shared). v2 0x9C50…b95f and v1 0xfEe6…b2d3 are retired (VOUCH_RETIRED_DEPLOYMENTS); never send to them.
**Unchanged:** ABI, events, topic0s, every EIP-712 type and the PaymentAuth typehash (vouchAbi has 0 diff), so only the address changes.
**Submitter rule (D-014/D-519):**
- pay() requires msg.sender == auth.submitter, otherwise UnauthorizedSubmitter().
- ALWAYS sign submitter = RELAYER in the app flow. submitter = 0 is now UNPAYABLE (no 'anyone' path), so never default to 0.
- Never use a public forwarder or multicall as submitter (D-013).
**OrderAlreadySettled is terminal (QE-C-10).** The order itself isn't bound to a submitter, so a customer can sign a second auth for the same order with submitter = self and settle it first. Your relayer-bound tx then reverts OrderAlreadySettled; your auth stays unused and the customer is charged once. Handle it like this:
  (1) simulate pay() before sending, so you don't pay gas for the revert;
  (2) treat OrderAlreadySettled as terminal, not as an error to retry;
  (3) always read the actual split from PaymentSettled/RewardPaid, never from the quote (the customer may have chosen the fallback).
**Reference:** smoke OK on v3. Relayed canonical pay tx 0x95cbda97e7a015b6c105f07cf364b3cc258cc6769cd13a10ce8ae0697280673e, 409,801 gas = 0.0102 USDC, exact 10.20/0.45/0.693/0.297/0.252/0.108.

**Paths:** `packages/shared/src/deployments.ts`, `scripts/deploy/smoke-canonical.ts`, `AGENTS/DECISIONS.md`

---
