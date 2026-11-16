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
