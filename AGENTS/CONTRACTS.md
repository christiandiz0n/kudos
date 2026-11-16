# CONTRACTS
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns all production Solidity: venue registry + versioned terms, intro acceptance, `pay` with atomic two-level split, frozen terms, on-chain fallback attribution, verified-customer and ambassador counters. Owns Foundry unit/fuzz/invariant tests, deploy scripts, and exporting ABIs + addresses to `packages/shared`. Does NOT touch frontend or backend code.

## Owned paths
- `contracts/src/` (except `spikes/`)
- `contracts/test/` (except `test/qe/`)
- `contracts/script/` (except `spikes/`)
- `packages/shared/src/abi/`, `packages/shared/src/deployments.ts`

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
- [ ] Implement contract surface (INTERFACES.md §Contract) with EIP-712, nonces, expiries, custom errors, ReentrancyGuard
- [ ] Canonical story unit test: $12.00 → $10.20 venue / $0.45 Ben / $0.69 Ana / $0.30 Priya / L2 $0.25 + $0.11 (document rounding rule)
- [ ] Fuzz + invariant tests for every invariant in DECISIONS/INTERFACES
- [ ] Gas report
- [ ] Deploy script + deploy to Arc testnet; verify source if supported
- [ ] Export ABIs + addresses to packages/shared; propose INTERFACES.md update

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/CONTRACTS.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
