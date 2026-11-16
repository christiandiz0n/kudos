# FRONTEND_INTEGRATION
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns wiring the web app: auth/passkey onboarding and embedded wallet, EIP-712 signing in the client, QR display (venue) and camera scan (customer), API calls, SSE live updates (pending → settled), state management, error states. Does NOT do visual redesign — requests changes from UI_DESIGN.

## Owned paths
- `apps/web/src/app/` route files (except `app/design/`)
- `apps/web/src/lib/`, `apps/web/src/hooks/`, `apps/web/src/state/`

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
- [ ] Passkey onboarding → embedded wallet created invisibly
- [ ] Wallet home (dollars), testnet top-up
- [ ] Venue onboarding, order entry → signed-order QR with auto-refresh
- [ ] Scan-to-pay → confirm sheet → success; recommend flow; ambassador record
- [ ] SSE live updates; error states (expired order, insufficient balance, relayer down, already rewarded)

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
