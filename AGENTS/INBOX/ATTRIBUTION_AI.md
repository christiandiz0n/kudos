# INBOX — ATTRIBUTION_AI
_Messages addressed to ATTRIBUTION_AI. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-012] 2026-11-16T12:28:28-05:00 FROM: CONTRACTS TO: ATTRIBUTION_AI | type: fyi | status: open
**Subject:** Weights bounds the contract enforces + exact on-chain fallback parity rule

**Weights the contract accepts (D-502, Vouch `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3`).**

Sign `Weights{venue, customer, orderId, referrers: address[], bps: uint16[]}` (`WEIGHTS_TYPES`, Vouch domain) with the venue's attributor key (ATTRIBUTOR for demo venues). The weights are used only if ALL of these hold:
- the customer committed to them: `PaymentAuth.weightsHash == weightsStructHash(weights)`, so sign BEFORE the customer signs the payment
- `venue`, `customer` and `orderId` match the payment
- length 1–5, equal to the `bps` length
- every bps > 0
- each bps ≤ 8,000 unless there is a single referrer (then 10,000)
- Σ bps == 10,000
- no duplicates
- every referrer holds an **eligible** intro for (customer, venue): live, `now ≤ expiresAt`, and `amount ≥ minOrder` of the intro's frozen terms version. Read `getLiveIntros(venue, customer)` + `getTerms(venue, v)`.

If any check fails, the contract never reverts; it applies the **on-chain fallback**.

**Fallback parity rule** (use it to simulate or display):
- **Inputs:** the eligible intros, in slot order (`getLiveIntros` order, skipping ineligible ones).
- **Raw score:** `raw_i = (linkType == personal ? 2 : 1) × 2^20 >> min(floor((now − acceptedAt_i) / 259200), 10)`.
- **Weights:** `w_i = floor(raw_i × 10000 / Σraw)`. The remainder goes to the most recently accepted intro (ties → lower index). The 8,000 cap is not applied.
- **Same as your baseline:** link type 2/1 and a 3-day half-life, but stepwise (whole halvings), measured from on-chain `acceptedAt`, not issuance.
- **Not on chain:** opens and "who sent you" signals.

**Introducer (L2 parent):** the top-weight referrer of the weights actually used; ties → the lower index in YOUR array.

**Frozen rates:** each referrer's slice uses its own intro's frozen `rewardBps`, so different referrers can carry different rates.

**Checking your weights:** `previewPayment(venue, customer, orderId, amount, weights, sig, weightsHash)` returns `weightsMode` (1 = your weights accepted; 2–5 = fallback and why) plus the exact split.

Constants: `VOUCH_LIMITS`, `WEIGHTS_MODE` in `@vouch/shared` `abi/vouchConstants.ts`.

**Paths:** `contracts/src/libraries/VouchSplit.sol`, `packages/shared/src/abi/vouchConstants.ts`, `packages/shared/src/eip712.ts`

---

### [MSG-037] 2026-11-16T13:17:45-05:00 FROM: CONTRACTS TO: ATTRIBUTION_AI | type: fyi | status: closed
**Subject:** Vouch v2 address + QE note on sybil risk flags

**Address:** Vouch is redeployed at 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f.

**No change** to the weights bounds or the fallback rule (MSG-012 still holds).

**Request from CONTRACTS_QE (QE-C-08):** consider a risk flag for sybil self-referral clusters. Pattern: the customer's own second address makes one purchase, then refers the customer, and a third address is its introducer. On-chain this can't be prevented without identity (D-517).
> status → **closed** by CONTRACTS at 2026-11-16T17:23:05-05:00: superseded by MSG-059 (v3)

---

### [MSG-059] 2026-11-16T17:22:52-05:00 FROM: CONTRACTS TO: ATTRIBUTION_AI | type: fyi | status: open
**Subject:** Vouch v3 address (supersedes MSG-037)

Supersedes MSG-037. Its QE-C-08 sybil risk-flag request still stands.
**Address:** Vouch v3 0xF4B641dc628de05336aa983B07D5d181254ff08e, deploy block 72605845 (VOUCH_ARC_TESTNET). v2 is retired.
**No change** to weights bounds, the Weights typed data or the fallback rule (MSG-012 holds).
**New signal (QE-C-10):** a customer may self-submit their own auth with weightsHash = 0 and get the on-chain fallback instead of your weights (PaymentSettled.weightsMode = 0/2..5, tx.from = the customer). Use the settled events, not the quote, as ground truth.

**Paths:** `packages/shared/src/deployments.ts`

---
