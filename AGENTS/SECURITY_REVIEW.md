# SECURITY_REVIEW
_Last updated: 2026-11-17 by SECURITY_REVIEW — Phase 2 re-verification_

## Mission
Owns security review: secrets hygiene (git history, client bundles), signature/replay review across EIP-712 flows, relayer abuse/drain limits, CORS and rate limits, webhook authenticity, dependency check. Does NOT do feature work — files findings to owners.

## Owned paths
- `docs/security/` (review reports, threat model)

## Current status
🟢 **Phase 2 security: PASS-with-notes.** Re-verified 2026-11-17 at HEAD `aab31f2` (fixes in `920a042`). Report: `docs/qa/phase-2-security-review.md` (section "Re-verification").
- **Verdicts:** SEC-2-01..09 and SEC-2-11..13 FIXED. SEC-2-10 PARTIAL: the replay window stays log-only until the timestamp unit is verified (D-309d), Low.
- **Residual notes:** N-1 the global budget isn't reserved for `pay` (availability, Low); N-2 webhook burst/raw cap could be tighter; N-3 `TRUST_PROXY=2` is required on Railway; N-4 a chain-reverted relayed pay still marks the shared order `failed`; N-5 a PGlite/V8 test-runner flake.
- **`RELAYER_PRIVATE_KEY` on Railway:** safe to set now, with testnet funding sized to the $5/day budget, `TRUST_PROXY=2` kept, and the other secrets set as dashboard variables.
- **No MSGs:** the coordinator routed the fixes and the residual notes go through the report.

## Mental model (read this first)
_Nothing built yet. The first agent to work here rewrites this section._

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `docs/qa/phase-2-security-review.md` | Phase 2 findings | SEC-2-01..16 |
| `docs/evidence/phase-2/security/` | Raw probe, scan and audit results (`reverify-*` = 2026-11-17 re-verification) | `scan-keys.mjs` derives addresses from 64-hex strings and never prints keys |

## Interfaces consumed / provided
See `AGENTS/INTERFACES.md`. Relevant sections to be filled as they are defined.

## Done (rolling, newest first)
- 2026-11-17: Phase 2 re-verification: PASS-with-notes. Local heavy probes only, one request per hosted check, read-only Railway log check for client IP and token redaction.
- 2026-11-16: Phase 2 security review. Clean: git history and key scan, `.env` hygiene, image, prod deps, and the auth/replay/signature controls. Verdict BLOCKED (2 High).
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Phase 0: verify .gitignore covers secrets; no keys in repo
- [x] Phase 2: signature/replay review, relayer limits, webhook auth, CORS (BLOCKED, see report)
- [x] Phase 2 re-verify: SEC-2-01..13 (PASS-with-notes)
- [ ] Close SEC-2-10 (replay window) once the X-QN-Timestamp unit is verified; recheck N-1..N-4 if they are fixed
- [ ] Phase 5: final pass — git history scan, client bundle scan, dependency audit

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/SECURITY_REVIEW.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
