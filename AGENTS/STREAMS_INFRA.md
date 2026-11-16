# STREAMS_INFRA
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns the QuickNode Streams pipeline: Stream configuration (dashboard steps or REST API), filter code, the webhook handler (auth/signature verification if supported, idempotency on (txHash, logIndex), ordered processing, reorg safety), building ALL derived views from events, backfill/replay tooling, and deployment config for public endpoints. Does NOT own UI or relayer logic.

## Owned paths
- `apps/api/src/streams/`
- `infra/streams/` (filter code, stream config JSON)
- `scripts/backfill/`
- Deployment config files (e.g. `railway.json`, `fly.toml`, `vercel.json`)

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
- [ ] Production Stream on Arc testnet filtered to our contract + 6 events → api webhook
- [ ] Idempotent, ordered webhook handler; reorg handling per Streams docs
- [ ] Derived tables built only from Streams events
- [ ] Backfill/replay: wipe derived → backfill from deploy block → assert identical hash
- [ ] Record exact Stream config here + draft README section

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
