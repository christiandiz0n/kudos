# BACKEND_RELAYER
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns the API service: DB schema, auth/session, venue/order/intro/payment endpoints, venue order signing, payment quotes (baseline attribution + attributor signature), the relayer wallet (nonce mgmt, retries, rate limits, max-gas guard, friendly error mapping) and SSE fan-out. Does NOT own contract logic, the Streams webhook/derived-state ingestion (STREAMS_INFRA), or attribution scoring internals (ATTRIBUTION_AI).

## Owned paths
- `apps/api/` (except `apps/api/src/streams/` and `apps/api/src/attribution/`)

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
- [ ] DB schema: users, wallets, venues, terms, orders, intros, link_opens, payments, rewards, events_cursor
- [ ] Endpoints per INTERFACES.md §API
- [ ] Relayer with nonce mgmt, retries, per-user + global rate limits, max-gas guard
- [ ] SSE channels per user and per venue
- [ ] Error mapping to user-friendly messages

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
