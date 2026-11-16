# CONTRACTS_QE
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Independent adversarial reviewer of the contracts. Writes additional failing tests and fuzz/invariant tests that expose bugs, files issues to CONTRACTS, re-verifies fixes. Does NOT edit contract logic — reports issues instead.

## Owned paths
- `contracts/test/qe/`
- `docs/evidence/phase-1/contracts-qe.md`

## Current status
🟢 on track — not started yet.

## Mental model (read this first)
_Nothing built yet. The first agent to work here rewrites this section._

## Key files map
| Path | What it does | Notes |
|---|---|---|
| — | — | — |

## Interfaces consumed / provided
See `AGENTS/INTERFACES.md`. Relevant sections to be filled as they are defined.

## Done (rolling, newest first)
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] **(Human-required, D-103)** Prove that USDC `receiveWithAuthorization` is invoked **by the payee contract** (msg.sender == `to` == the Vouch contract). Tests must show: (a) the happy path, where the relayer calls `pay` and the Vouch contract calls `receiveWithAuthorization` with `to = address(this)`; (b) a third party (relayer/attacker EOA) calling USDC `receiveWithAuthorization` directly with the customer's signature reverts (`caller must be the payee`); (c) a signature for `to = Vouch` can't be redirected to another payee; (d) a front-run `cancelAuthorization` or a reused nonce makes `pay` revert cleanly, with no partial split; (e) the nonce equals our PaymentAuth struct hash, so changing any payment field invalidates it. Use a mock that faithfully reproduces FiatTokenV2_2's payee check, **and** a fork test against Arc testnet USDC `0x3600…` if forking works.
- [ ] Replay (order id, intro nonce), signature malleability, cross-venue/cross-customer intro reuse
- [ ] Self-referral, introducer cycles (A→B→A), reentrancy via token callbacks
- [ ] Decimal mistakes (6 vs 18), rounding drift, exact-sum invariant
- [ ] Griefing via bad attributor weights (must fall back, never block payment)
- [ ] Order expiry edge cases (== expiry, chain time skew)

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
