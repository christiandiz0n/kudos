# SECURITY_REVIEW
_Last updated: 2026-11-16 by SECURITY_REVIEW — Phase 2 QE gate (security half)_

## Mission
Owns security review: secrets hygiene (git history, client bundles), signature/replay review across EIP-712 flows, relayer abuse/drain limits, CORS and rate limits, webhook authenticity, dependency check. Does NOT do feature work — files findings to owners.

## Owned paths
- `docs/security/` (review reports, threat model)

## Current status
🔴 **Phase 2 BLOCKED pending fixes.** Report: `docs/qa/phase-2-security-review.md`.
- Open: 2 High (SEC-2-01 webhook decode-before-auth / body caps; SEC-2-02 relayer gas budget / lanes), 4 Medium (SEC-2-03..06), 7 Low (SEC-2-07..13).
- The coordinator already routed every fix to STREAMS_INFRA (SEC-2-01, 10) and BACKEND_RELAYER (the rest), so no MSGs were sent from here.
- Next: re-verify once the fixes are committed and redeployed. Hosted checks stay at one request per check; heavy probes run against a local api only.

## Mental model (read this first)
_Nothing built yet. The first agent to work here rewrites this section._

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `docs/qa/phase-2-security-review.md` | Phase 2 findings | SEC-2-01..16 |
| `docs/evidence/phase-2/security/` | Raw probe, scan and audit results | `scan-keys.mjs` derives addresses from 64-hex strings and never prints keys |

## Interfaces consumed / provided
See `AGENTS/INTERFACES.md`. Relevant sections to be filled as they are defined.

## Done (rolling, newest first)
- 2026-11-16: Phase 2 security review. Clean: git history and key scan, `.env` hygiene, image, prod deps, and the auth/replay/signature controls. Verdict BLOCKED (2 High).
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Phase 0: verify .gitignore covers secrets; no keys in repo
- [x] Phase 2: signature/replay review, relayer limits, webhook auth, CORS (BLOCKED, see report)
- [ ] Phase 2 re-verify: SEC-2-01..13 after the fixes are redeployed
- [ ] Phase 5: final pass — git history scan, client bundle scan, dependency audit

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/SECURITY_REVIEW.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
