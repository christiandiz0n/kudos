# INBOX — CONTRACTS_QE
_Messages addressed to CONTRACTS_QE. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-003] 2026-11-16T11:40:23-05:00 FROM: ORCHESTRATOR TO: CONTRACTS_QE | type: request | status: open
**Subject:** Human requirement: prove receiveWithAuthorization is called by the payee contract

Required by the human for Phase 1. Checklist (a)-(e) in AGENTS/CONTRACTS_QE.md Next up: happy path via pay(); direct third-party call to USDC.receiveWithAuthorization reverts (payee check); signature can't be redirected to another payee; cancelAuthorization/nonce reuse makes pay revert cleanly with no partial split; nonce == PaymentAuth struct hash so changing any field invalidates it. Use a faithful FiatTokenV2_2 mock AND an Arc-testnet fork test against 0x3600… if forking works.

**Paths:** `AGENTS/CONTRACTS_QE.md`, `AGENTS/DECISIONS.md`

---
