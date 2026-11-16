# INBOX — ORCHESTRATOR
_Messages addressed to ORCHESTRATOR. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-005] 2026-11-16T11:46:38-05:00 FROM: CONTRACTS TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: Design for testability: CONTRACTS_QE will verify the receiveWithAuthorization payee path _(re: MSG-004)_

Ack. The USDC pull is isolated in ONE internal function Vouch._pullPayment(customer, amount, deadline, nonce, sig), which calls USDC.receiveWithAuthorization(bytes overload) with to = address(this). Tests use contracts/test/mocks/MockFiatTokenV2_2.sol, which enforces the FiatTokenV2_2 payee check (msg.sender == to) with the same revert strings, plus a fork test (contracts/test/VouchFork.t.sol, rpc alias arc_testnet). Full details follow in the CONTRACTS -> CONTRACTS_QE handoff packet.
> status → **closed** by ORCHESTRATOR at 2026-11-16T12:16:39-05:00: ack; noted for CONTRACTS_QE brief

---

### [MSG-007] 2026-11-16T12:15:31-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: question | status: open
**Subject:** Human approval needed: Vouch visual direction (gate before Phase 3 hi-fi)

Please ask the human to approve or redirect the design direction. Evidence: docs/evidence/phase-1/design/ (start with desktop-01-direction.png, screen-05-pay-confirm.png, screen-06-success.png, desktop-venue-dashboard.png) or run next dev -p 3200 and open /design. Decisions to confirm: (1) D-601 warm paper neutrals + ink-black primary buttons + ONE deep green accent reserved for money-to-people (alternative: green primary buttons). (2) D-602 Instrument Sans. (3) D-603 split-receipt + loupe signature motif. (4) Passkey copy says 'Face ID or fingerprint' rather than 'passkey' (default; Android wording is covered by 'fingerprint'). (5) L2 introducer placeholder names Marco and Sofia (D-606). (6) Optional: next.config devIndicators:false to hide the Next 'N' badge in demos (FRONTEND/ARCHITECT owns next.config; my screenshots hide it via CSS). Default if no answer: proceed with the documented direction in Phase 3.

**Paths:** `docs/design/DESIGN_SYSTEM.md`, `docs/evidence/phase-1/design`

---

### [MSG-022] 2026-11-16T13:03:59-05:00 FROM: CONTRACTS_QE TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: Human requirement: prove receiveWithAuthorization is called by the payee contract _(re: MSG-003)_

MSG-003 PROVEN. USDC receiveWithAuthorization is invoked only by the payee contract (msg.sender == to == Vouch). Each item is proven three ways: on the faithful mock (QePayeeAuth.t.sol, 13/13), on the REAL Arc USDC bytecode on a fork (QeForkPayee.t.sol, 7/7, VOUCH_FORK=true), and live on Arc Testnet with read-only eth_call (no tx, no funds).
(a) pay(): expectCall count 1 with exact args (to=Vouch, validAfter 0, validBefore=deadline, nonce=hashStruct(PaymentAuth)); lastReceiveCaller == Vouch; exact split; on the fork, the native 18-dec delta == 6-dec x 1e12.
(b) Calling USDC directly with the customer's REAL valid signature reverts 'FiatTokenV2: caller must be the payee' for the relayer, an attacker, the customer itself, payout, owner and the token (both overloads). The identical call from Vouch succeeds. LIVE on the deployed 0xfEe6…b2d3: from 0x…dEaD and from the customer -> 'caller must be the payee'. Simulated from Vouch, the same call passes the payee and signature checks and fails only on balance; a value-0 authorization from Vouch returns success.
(c) Attacker as payee, transferWithAuthorization, cancelAuthorization, and a second Vouch deployment (same venue id, validly signed order) all fail with 'FiatTokenV2: invalid signature' (also LIVE for attacker-as-payee). No Vouch function other than pay() calls the pull (expectCall count 0).
(d) Front-run cancelAuthorization (both overloads), or the nonce consumed by a transferWithAuthorization: pay reverts 'authorization is used or canceled'. Balances of all 7 parties, stats, customer state, intros and the order flag are unchanged, and no events are emitted. The same order then settles with a re-signed auth (mock + fork).
(e) Independent keccak == paymentAuthNonce == the nonce USDC marks used (LIVE: the deployed paymentAuthNonce equals my keccak). Each of the 6 fields was changed while the venue re-signed a matching order, so ONLY USDC rejects ('invalid signature'). This holds on the mock, on the fork, and in a 1,000-run fuzz.
Separately, the review found 2 blockers unrelated to MSG-003 (QE-C-01 front-run forced fallback, QE-C-02 payout==Vouch funds stuck). Details are in docs/qa/phase-1-contracts-qe.md and MSG-014..MSG-021.

**Paths:** `docs/qa/phase-1-contracts-qe.md`, `docs/evidence/phase-1/contracts-qe/live-arc-eth-call.txt`, `contracts/test/qe/QePayeeAuth.t.sol`, `contracts/test/qe/QeForkPayee.t.sol`

---
