# STREAMS_INFRA
_Last updated: 2026-11-16 by STREAMS_INFRA — Phase 2 (Streams ingestion + derived state + backfill/replay, D-306/D-307)_

## Mission
Owns the QuickNode Streams pipeline: Stream configuration (dashboard steps or REST API), filter code, the webhook handler (auth/signature verification if supported, idempotency on (txHash, logIndex), ordered processing, reorg safety), building ALL derived views from events, backfill/replay tooling, and deployment config for public endpoints. Does NOT own UI or relayer logic.

## Owned paths
- `apps/api/src/streams/**`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/webhooks.test.ts`, `apps/api/drizzle-streams/**`, `apps/api/drizzle-streams.config.ts` (+ for D-305: `apps/api/src/env.ts`/`env.test.ts`, the `stream_deliveries` part of `apps/api/src/db/schema.ts`, `apps/api/drizzle/0001_*`)
- `infra/streams/` (filter template, `stream-vouch-prod.json`)
- `scripts/streams/`, `scripts/backfill/`
- `docs/streams/`
- Deployment config files: root `Dockerfile`, `.dockerignore`, `railway.json`, `docs/deploy/`
- Shared, minimal edits only (announced to BACKEND_RELAYER, MSG-063/064): `apps/api/src/app.ts` (createStreams + ingest hook), `apps/api/src/db/index.ts` (migrate both folders), `apps/api/package.json` (test glob, `db:generate:streams`), `scripts/package.json`.

## Current status
🟢 **Phase 2 code complete, tests green, not yet on Railway** (Railway deploys committed HEAD; the ORCH commits). Every verified delivery is now decoded and ingested idempotently into the `ev_*` derived tables. BACKEND_RELAYER reads them through `createStreams(db)` (StreamsPort + bus; it is wired in `app.ts`). On real v3 chain data, chain backfill == live webhook == replay == rebuild (hash `0b0c880d…5c1f34`, 48 events). **Waiting on:** the HUMAN creating the production Stream (D-015/D-307; values in runbook §P) → the first live delivery → `streams:verify --db` on Railway Postgres, and the UNVERIFIED items below.

## Mental model (read this first)
```
Arc block ─▶ QuickNode Stream "vouch-v3-prod" (arc-testnet / logs / docs/streams/filter-vouch.js, start 72605845)
   ─▶ POST https://api-production-902bc54c.up.railway.app/webhooks/streams   (sequential; waits for our 2xx)
        0. per-IP token bucket (burst 600, 50/s) in onRequest → 429 + Retry-After                    [D-309]
        1. 503 no secret · 401 missing X-QN-* headers  (BEFORE any decode)  · raw > 4 MiB → 413        [D-308]
           → gunzip capped at 8 MiB (413 decoded-body-too-large · 400 bad gzip) → HMAC (401) → JSON parse
        2. INSERT stream_deliveries deduped on sha256(stream|batch|body) via ev_delivery_keys
           repeat → 200 duplicate:true, no row, no ingest · insert fails → 500 (QuickNode retries)     [D-305/D-309]
        3. streams.ingestDelivery(rowId, body)                                                       [D-306]
             decodeDelivery: collectLogs(any shape) → keep address == Vouch v3 && topic0 ∈ 10 topics && !removed
                             && strict vouchAbi decode   (USDC 0x3600…, system 0xffff…fffe, unknown topics → ignored)
             one tx + pg_advisory_xact_lock: INSERT ev_events ON CONFLICT (tx_hash, log_index) DO NOTHING
               new events all after cursor → apply in (block, logIndex) order
               any new event before cursor → wipe derived, re-apply ALL ev_events in order (rebuilt: true)
               recompute ev_venue_stats / ev_ambassadors for touched keys · ev_cursor · ev_ingest_log 'ok'
             after commit → bus.publish (new events only; payment.settled = PaymentSettled + its lines)
           ingest throws → STILL 200 (raw row durable), ev_ingest_log 'failed'; the request waits ≤ 5 s for ingest
           then answers 200 anyway; retryFailed() = background pass (≤5 rows, <5 attempts, backoff 10 s·2^n ≤ 10 min);
           beyond the cap only ingestPending() (boot / streams:replay)                                 [D-309]
           X-QN-Timestamp skew: logged only (unit UNVERIFIED)                                           [D-309d]
        4. one pino line `streams delivery` (+ ingest:{ok,newEvents,duplicates,ignored,rebuilt,cursorBlock,events})
   reads: StreamsPort (queries.ts) over ev_* only — getPayment != null ⇔ settled (QE-C-10)
```
- **Derived state is a pure function of the set of events in `ev_events`.** That is why live, retries, overlaps, reverse order, replay and backfill all hash the same. `hashDerived` excludes provenance (`source`, `delivery_id`, `ingested_at`), `block_timestamp` (whether Streams carries it is unverified), `ev_ingest_log` and the cursor's batch/rebuild counters.
- **Tables** (`apps/api/src/streams/schema.ts`; migrations `apps/api/drizzle-streams/`, table `drizzle.__drizzle_migrations_streams`):
  - `ev_events` (PK tx_hash, log_index)
  - `ev_cursor`, `ev_ingest_log`
  - `ev_venues`, `ev_terms`, `ev_seeds`
  - `ev_intros` (accept rows; `live=false` on IntroDropped)
  - `ev_verified` (venue, customer)
  - `ev_payments` (venue, order_id)
  - `ev_rewards` (Paid + Returned lines)
  - `ev_venue_stats`, `ev_ambassadors` (address, venue)
  - Conventions: addresses checksummed, hashes lowercase, uint256 as `numeric(78,0)`.
- **Backfill = the same filter.** `backfill.ts` runs eth_getLogs in ≤10k chunks and wraps the result as `{data:[block][log], metadata}`. It then runs the FROZEN `docs/streams/filter-vouch.js` in a bare `vm`, so the output is the live envelope v1, which goes through the same ingest path. The api runtime never loads the filter file.
- **Filter is frozen.** The Orchestrator rendered and committed `docs/streams/filter-vouch.js`, and the human pasted it into the dashboard. Do not change the renderer output or the envelope without messaging the ORCH. The `filter-vouch-prod.js` name from the brief was replaced by `filter-vouch.js`.
- **Envelope v1** (D-302/D-304): `{v, streamId, network, dataset, batchStart, batchEnd, batchSource, events:[log + event]}`. The label field is `event`.
- **PORT:** `PORT` → `API_PORT` → 4000 (Railway pins 8080). `tsx` is the runtime dependency. `--prod` filtered install (D-305).

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `apps/api/src/streams/index.ts` | `createStreams(db, {addresses?, log?})` → `Streams` = StreamsPort + `ingestDelivery`, `ingestEnvelope`, `ingestPending`, `retryFailed`, `rebuild`, `wipeAll`, `hash`, `bus` | Wired in `app.ts`; `BuiltApp.streams` |
| `apps/api/src/streams/decode.ts` | `decodeDelivery(body, addresses)` → sorted, de-duplicated `DecodedEvent[]` + ignored counts; `HANDLED_EVENTS` | Pure |
| `apps/api/src/streams/ingest.ts` | `ingestInTx`, `ingestBatch`, `rebuildDerived`, `serialized` mutex, apply handlers, stats recompute | Advisory lock key 7305002 |
| `apps/api/src/streams/queries.ts` | StreamsQueries (getPayment, getPaymentByTx, listPayments, listRewardLines, listIntrosAccepted, getVenue, getVenueStats, getAmbassador, isVerified, cursor) | Reads ev_* only |
| `apps/api/src/streams/types.ts` | Port types, structurally equal to BACKEND's `apps/api/src/ports/streams.ts` (+ extra fields) | MSG-062/063 |
| `apps/api/src/streams/bus.ts` | `createBus()`: subscribe/publish, listener errors contained | |
| `apps/api/src/streams/hash.ts` | `hashDerived(db)`: sha256 per table + overall | |
| `apps/api/src/streams/backfill.ts` | `loadFilter`, `chunkRange`, `getLogs`, `getHead`, `buildEnvelopes`, `chainEnvelopes` | Read-only RPC |
| `apps/api/src/streams/verify.ts` | `runDeterminism`, `liveViaWebhook` (signed POSTs through the real route), `replayHashFrom`, `backfillHash`, `maxDeliveredBatchEnd`, `signedHeaders` | Shared by tests + CLI |
| `apps/api/src/streams/ingest.test.ts` + `fixtures/` | 15 tests on REAL v3 data (48 logs; full blocks 72606074/72606174/72606075) | fixtures fetched read-only 2026-11-16 |
| `apps/api/src/streams/deliveries.ts` | raw `stream_deliveries` insert/list (D-305) | |
| `apps/api/src/routes/webhooks.ts` | HMAC route + `ingest` hook option + `IngestSummary` | 200 on ingest failure |
| `apps/api/drizzle-streams.config.ts` · `apps/api/drizzle-streams/0000_ev_derived.sql` | Own drizzle-kit config + migration | `pnpm --filter @vouch/api db:generate:streams --name <x>` |
| `scripts/backfill/streams-derive.ts` | CLI `verify` / `backfill` / `replay [--in-place]` / `hash`, `--db-url` or `--db` | `streams:verify` etc. in `scripts/package.json` |
| `infra/streams/stream-vouch-prod.json` | Exact production Stream config + test-filter expectations (no secret) | A test keeps it in sync with the filter |
| `docs/streams/filter-vouch.js` | FROZEN production filter (ORCH-committed) | |
| `docs/streams/S3-RUNBOOK.md` §P | Production values, P.1 test-filter table, P.2 ingest semantics, P.3 determinism commands | |
| `docs/streams/README-streams-draft.md` | README Streams section draft for DOCS_SUBMISSION | |
| `scripts/streams/*` | Phase 0/1.5 CLI (render-filter, deliveries viewer, ping), filter tests | unchanged |
| `Dockerfile` · `.dockerignore` · `railway.json` · `docs/deploy/RAILWAY.md` | Railway image + deploy steps | `apps/api/` is copied whole, so `drizzle-streams/` ships |

## Production Stream config (exact; D-307)
| Field | Value |
|---|---|
| Name | `vouch-v3-prod` (any; dashboard) |
| Network / dataset | Arc Testnet (`arc-testnet`) / `logs` |
| Range | start **72605845**, no end, latest-block delay 0, reorg handling off |
| Filter | JavaScript, `docs/streams/filter-vouch.js` (ADDRESSES `["0xf4b641dc628de05336aa983b07d5d181254ff08e"]`, 10 topics, `--events vouch`) |
| Destination | Webhook `https://api-production-902bc54c.up.railway.app/webhooks/streams`, compression none |
| Token | QuickNode-generated → Railway → api → Variables → `STREAMS_WEBHOOK_SECRET` (never committed) |
| Test filter | 72606007 → VenueRegistered@4, TermsUpdated@5 (tx 0x7ecc2161…5ee7) · 72606074 → CustomerVerified@74, PaymentSettled@90, RewardPaid@91–95 (tx 0x95cbda97…673e) · 72606174 → CustomerVerified@53, PaymentSettled@69, RewardPaid@70–74 (tx 0xfca0e1ae…c7be) · 72606075 → `null` |

## Interfaces consumed / provided
- Consumes INTERFACES §2 (`VOUCH_ARC_TESTNET`), §4 (`vouchAbi`, `VOUCH_EVENT_TOPICS`, the rebuild table), §6, §7 (`STREAMS_WEBHOOK_SECRET`, `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `ARC_RPC_URL`, `PORT`, `NODE_ENV`, `STREAMS_SPIKE_LOG`).
- Provides:
  - the StreamsPort (queries + bus) to BACKEND_RELAYER;
  - §6 ingestion semantics (D-306);
  - the `ev_*` derived tables;
  - the `streams:verify/backfill/replay/hash` commands.
- INTERFACES changes are proposed in the Phase 2 report (§4 rebuild table → ev_* tables, §6 ingestion + 200-on-ingest-failure, a new StreamsPort section).

## Done (rolling, newest first)
- 2026-11-16 — **Security pass (D-308 / D-309).**
  - Gzip bomb (P-L3): the secret and header checks now run before any decode. Raw limit 4 MiB, gunzip capped at 8 MiB → 413. JSON is parsed only after the HMAC verifies.
  - SEC-2-10: per-IP rate limit (`streams/rate-limit.ts`); raw dedupe via `ev_delivery_keys` (migration `drizzle-streams/0001`); the request waits ≤ 5 s for ingest; `retryFailed` is bounded and runs in the background; skew stays log-only.
  - Tests: webhooks + streams 43/43. `streams:verify` on real chain (101 events) still shows equality.
- 2026-11-16 — **Phase 2 (D-306/D-307):**
  - Ingestion: decode → idempotent `ev_events` → ordered apply / rebuild-on-late → ev_* derived tables → cursor → bus.
  - Webhook: an ingest hook that answers 200 when ingest fails, with retries from the raw table.
  - Migrations: own folder and migrations table; `db.migrate()` runs both folders.
  - CLI: `streams:verify/backfill/replay/hash`.
  - Config + docs: `infra/streams/stream-vouch-prod.json`; runbook §P (v3, test-filter table); README draft.
  - Verified on real chain data:
    - `streams:verify` over 72605845..72612484 → backfill == live (29 signed POSTs) == replay == replay-in-place == rebuild = `0b0c880d…5c1f34`.
    - Both canonical pays give exact split rows.
    - Manual api on :4020: delivery 1 → 8 new, retry → 8 duplicates, unsigned → 401.
  - Tests: api 34/34 (19 existing + 15 new), scripts 13/13, shared 10/10. `pnpm -r typecheck` is clean (with BACKEND_RELAYER's Phase 2 files in the tree).
- 2026-11-16 — Phase 1.5 (D-305): `PORT` honoured; `stream_deliveries` raw ingest (verified only, persisted before the 200, 500 on insert failure) + migration 0001; structured `streams delivery` log line; NDJSON off in production; `streams:deliveries --db`; `--events vouch` preset; root `Dockerfile`/`.dockerignore`/`railway.json`; `tsx` → api dependency; `docs/deploy/RAILWAY.md`; runbook §P + README for the Railway URL (D-015/D-016). Simulated clean-clone image: 0 git calls, no forge-std/OZ/typescript/drizzle-kit, `/health` 200 (pglite memory), unsigned 503, 401 with secret, signed 200 → row 1. `pnpm -r typecheck` clean; tests shared 10/10, scripts 13/13, api 19/19.
- 2026-11-16 — Runbook rewritten for DASHBOARD stream creation (D-011): AGENT/HUMAN role split, filter tests at 72567880 (Ping, logIndex 4) / 72567926 (Split, logIndex 19) / 72567881 (null), create paused → token → restart → activate → verify → pause; DNS-NXDOMAIN note; REST-only CLI commands marked paid-plan.
- 2026-11-16 — QE-gate fixes (D-304): QE-01 `event` field confirmed in all consumers; QE-02 `ping --hello` + zero/no-code guard, `--contract` mandatory in the CLI; QE-04 runbook takes Hello/deploy block from INTERFACES §2; QE-05 `render-filter` stdout = pure JS; QE-06 viewer loads the env + shared path rule; QE-07 viewer withholds labels for unverified bodies; QE-12 runbook batch example; QE-15 `batchSource` + derived range. Tests: api 10/10, scripts 10/10, `pnpm -r typecheck` clean.
- 2026-11-16 — S3 code: HMAC-verified webhook + tests, filter + tests, Streams CLI, NDJSON viewer, ping trigger, runbook, D-301..D-303. `pnpm -r typecheck` clean; api tests 10/10; scripts tests 9/9. Live `streams list` → **403 (key not recognized)**.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] (ORCH) Commit Phase 2 so Railway picks it up. Check `/health`, then check that boot ran both migrations (`ev_*` tables exist).
- [ ] HUMAN creates the production Stream (paused) with §P values and runs the P.1 filter tests → token in Railway Variables → Deploy → unsigned 401 → activate.
- [ ] First live deliveries: check `ingest.newEvents` in `railway logs --filter "streams delivery"`, then run `railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:verify --db` (live == replay == chain). Resolve the UNVERIFIED items below.
- [ ] Optional: expose `cursor()` + last ingest status on `/health` (needs BACKEND agreement; `app.ts` is shared).
- [ ] Follow-up: migrate `railway.json` to Railway IaC before 2026-12-01 if the service ignores it.

## Struggles, open questions, known issues
- **`blockTimestamp` in Streams logs is UNVERIFIED.** It is stored when present (Arc eth_getLogs has it) and `blockTime` is null otherwise. It is excluded from the hash so live and backfill still agree. If Streams lacks it, BACKEND gets `blockTime: null` on live rows. Fix then: a block-timestamp lookup (one RPC per block) or the delivery `received_at`.
- **Late-batch rebuild is O(all events).** Fine at our volume (tens to hundreds of logs). Revisit only if `ev_events` grows past ~100k.
- **Ingest-failure policy:** a poison delivery stays `failed` in `ev_ingest_log` and is retried on every later delivery and boot. It never blocks other deliveries, but it shows up in logs. Check with `streams:hash` / logs.
- Not tested against real Postgres locally (PGlite only). The aggregates cast to `::text`/`::int` so both drivers return the same JS types, and the hash normalizes jsonb returned as strings. Check `streams:verify --db` on Railway.
- Railway config-as-code is deprecated (legacy until 2026-12-01). Confirm the healthcheck/restart settings in the UI.
- No REST API on the trial plan (D-011): no scripted pause/resume, so the human pauses manually (billed per block).
- **Still UNVERIFIED (needs a live delivery):**
  1. Whether the body is exactly the filter return value (envelope v1) or wrapped. Ingest handles both via collectLogs.
  2. The `X-QN-Timestamp` unit.
  3. `blockTimestamp` presence.
  4. The Arc `logs` credit multiplier / max batch size.
  5. The `batch-*` header names.
- Replay protection: there is no nonce cache or skew rejection yet (D-309d, the unit is unverified). Raw dedupe (D-309b) plus `(txHash, logIndex)` make replays harmless to storage and state.
- Rate limit keys on `req.ip`. Until BACKEND's trustProxy fix, all traffic behind Railway may share one bucket.

## How to run / test this area
```bash
pnpm --filter @vouch/api test                                   # webhook + env + 15 Streams ingestion tests (PGlite memory, real v3 fixtures)
pnpm --silent --filter @vouch/scripts streams:verify            # real chain (read-only RPC): backfill == live(webhook) == replay == rebuild
railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:verify --db           # hosted: live(db) == replay(raw) == chain
railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:replay --db --in-place  # wipe derived → rebuild from raw → same hash
pnpm --silent --filter @vouch/scripts streams:backfill --db-url pglite://<dir> [--from N --to N|head]  # chain → derived (stop the api first for on-disk pglite)
pnpm --silent --filter @vouch/scripts streams:hash --db-url <url>
pnpm --filter @vouch/api db:generate:streams --name <change>   # after editing apps/api/src/streams/schema.ts
pnpm --silent --filter @vouch/scripts streams:deliveries --db --last 10
railway logs --service api --lines 100 --filter "streams delivery"
pnpm --filter @vouch/scripts test && pnpm -r typecheck
# manual api: PORT=4020 DATABASE_URL=pglite://<scratch> STREAMS_WEBHOOK_SECRET=<test> STREAMS_SPIKE_LOG=off node --import tsx apps/api/src/server.ts  (never :3000/:4000)
```
Full live procedure: `docs/streams/S3-RUNBOOK.md` §P + `docs/deploy/RAILWAY.md`.

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-105, D-301..D-303), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/STREAMS_INFRA.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
