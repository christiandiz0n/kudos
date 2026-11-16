# SECURITY_REVIEW
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns security review: secrets hygiene (git history, client bundles), signature/replay review across EIP-712 flows, relayer abuse/drain limits, CORS and rate limits, webhook authenticity, dependency check. Does NOT do feature work — files findings to owners.

## Owned paths
- `docs/security/` (review reports, threat model)

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
- [ ] Phase 0: verify .gitignore covers secrets; no keys in repo
- [ ] Phase 2: signature/replay review, relayer limits, webhook auth, CORS
- [ ] Phase 5: final pass — git history scan, client bundle scan, dependency audit

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
