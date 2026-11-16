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
