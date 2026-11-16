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
