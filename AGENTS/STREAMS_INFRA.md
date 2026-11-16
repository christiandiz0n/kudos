# STREAMS_INFRA
_Last updated: 2026-11-16 by STREAMS_INFRA — Phase 1.5 (Railway deploy config + raw delivery table + PORT, D-305)_

## Mission
Owns the QuickNode Streams pipeline: Stream configuration (dashboard steps or REST API), filter code, the webhook handler (auth/signature verification if supported, idempotency on (txHash, logIndex), ordered processing, reorg safety), building ALL derived views from events, backfill/replay tooling, and deployment config for public endpoints. Does NOT own UI or relayer logic.

## Owned paths
- `apps/api/src/streams/`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/webhooks.test.ts` (+ for D-305: `apps/api/src/env.ts`/`env.test.ts`, the `stream_deliveries` part of `apps/api/src/db/schema.ts`, `apps/api/drizzle/0001_*`)
- `infra/streams/` (filter code, stream config JSON)
- `scripts/streams/`, `scripts/backfill/`
- `docs/streams/`
- Deployment config files: root `Dockerfile`, `.dockerignore`, `railway.json` (later `.railway/`), `docs/deploy/`

## Current status
🟡 **Phase 1.5 code complete; not deployed yet.** The api is ready for Railway (D-016/D-305): it honours `PORT`, persists every verified delivery to Postgres `stream_deliveries` and logs one `streams delivery` line per request. A root `Dockerfile`, `.dockerignore` and `railway.json` are in place. A simulated image build from a clean clone works: no git or GitHub fetch, `/health` 200, unsigned POST 503. Steps: `docs/deploy/RAILWAY.md`. **Waiting on:** HUMAN `railway login` → ORCH deploy (RAILWAY.md §2–3) → the v3 Vouch redeploy (D-014) for the final address/start block → HUMAN creates the ONE production Stream (D-015) with webhook `<railway>/webhooks/streams` and sets `STREAMS_WEBHOOK_SECRET` in Railway Variables. The Hello Stream is dropped (D-015); the Hello runbook stays as the offline/QE reference.

## Mental model (read this first)
```
Arc block ─▶ QuickNode Stream (production: Vouch on arc-testnet / logs / filter --events vouch) ─▶ HTTPS POST (sequential; waits for 2xx)
   ─▶ https://<api>.up.railway.app  (Railway: Dockerfile, node:24-slim, tsx, $PORT; quick tunnels = phone tests only)
   ─▶ apps/api POST /webhooks/streams
        1. raw bytes (encapsulated buffer parser) → gunzip if needed
        2. HMAC check: hex(HMAC-SHA256(token, nonce+timestamp+body)) vs X-QN-Signature
           503 if no secret · 401 missing/bad · 400 bad gzip · (verified ↓)
        3. verified only: INSERT stream_deliveries (Postgres on Railway / PGlite locally) → 200
           insert fails → 500 persist-failed (QuickNode retries; never ack an unpersisted delivery)
        4. one pino line `streams delivery` per request (labels/ranges only when verified; never token/signature/body)
        5. local dev only: also append NDJSON → data/local/streams-spike.ndjson (off when NODE_ENV=production)
   read: railway logs --filter "streams delivery" · streams:deliveries --db (DATABASE_PUBLIC_URL via `railway run --service Postgres`)
```
- **`stream_deliveries`** (migration `0001_stream_deliveries`): `id, received_at, verified, stream_id, batch_start, batch_end, event_count, bytes, gzip, headers jsonb (allow-listed; no x-qn-signature), summary jsonb, body jsonb, body_text`. `stream_id`/`batch_*` come from the headers first (QE-15), then the body envelope. Raw ingest: no dedupe. Phase 2 derives decoded tables from it, idempotent on `(txHash, logIndex)`.
- **PORT:** `PORT` → `API_PORT` → 4000. On Railway `PORT=8080` is pinned in Variables and the domain targets 8080.
- **Image:** `pnpm install --frozen-lockfile --prod --filter "@vouch/api..."`. `--prod` is load-bearing: a filtered install still installs the root importer, whose devDeps pull `forge-std` from codeload.github.com. `tsx` is an api **dependency** (it is the runtime).
- **Filter** (`infra/streams/filter-logs.js`): keeps `address ∈ ADDRESSES && topic0 ∈ TOPICS` and returns `null` otherwise. It delivers **envelope v1** `{v, streamId, network, dataset, batchStart, batchEnd, batchSource, events[]}` (D-302, D-304). Each event's label field is **`event`**, not `eventName` (QE-01). Billing is per block processed whatever the filter returns, so **pause when idle**.
- **Stream lifecycle on trial = dashboard (HUMAN).** Create (paused) → the human pastes the security token into **Railway → api → Variables → `STREAMS_WEBHOOK_SECRET`** and deploys the staged change → the agent verifies (unsigned → 401) → the human activates → the agent verifies deliveries → the human pauses when idle. The webhook URL is the fixed Railway domain (D-016), so there are no URL edits.
- **CLI** (`scripts/streams/streams.ts`): `render-filter` (pure-JS stdout → `docs/streams/filter-hello-s3.js`), `create --dry-run`, `streams:deliveries` and `streams:ping` work without the REST API. `list/get/create/pause/activate/delete/set-webhook/sync-secret/test-filter/enabled-count` need the REST API (`https://api.quicknode.com/streams/rest/v1`, `x-api-key`), i.e. a **paid plan**. They are kept for later. They never print the key or token (GET responses contain the token in clear text, so output is redacted).
- The api reads `STREAMS_WEBHOOK_SECRET` at start-up. On Railway a variable change is **staged** and needs a Deploy (or `railway redeploy --service api --yes`). A local api needs a restart.
- **Contract targets are always explicit** (D-304). Production: the final Vouch address/deploy block from `VOUCH_ARC_TESTNET` (TBD after v3, D-014) and `--events vouch`. The canonical spike Hello (offline/QE reference only, D-015) is `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32`, deploy block 72567874, from INTERFACES §2. Never take it from `run-latest.json` or trust the env's `HELLO_ADDRESS`. The stream's `--contract` must equal `streams:ping --hello`.
- Phase 2 (not built): derive decoded tables from `stream_deliveries` (or a replay) with idempotent upserts keyed by `(txHash, logIndex)`, ordered by `(blockNumber, logIndex)`, decoded with the shared ABI.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `apps/api/src/routes/webhooks.ts` | Webhook route + exported `decodeBody`, `computeSignature`, `signatureMatches`, `timestampSkew`, `collectLogs`, `summarize` | Raw-body parser is scoped to this plugin only |
| `apps/api/src/env.ts` | `realSecret()` (empty / `__placeholder__` = unset → 503), `resolvePort()` (`PORT`→`API_PORT`→4000), `resolveSpikeLog()` (repo-root relative; null when `off` or production without a path) | `env.test.ts` |
| `apps/api/src/streams/deliveries.ts` | `pickHeaders` (allow-list), `buildDeliveryRow` (header-first stream/batch), `insertDelivery`, `listDeliveries` | Called by the route via `opts.store` (wired in `app.ts`) |
| `apps/api/src/db/schema.ts` + `apps/api/drizzle/0001_stream_deliveries.sql` | `stream_deliveries` table + 2 indexes (received_at; stream_id,batch_start) | `pnpm --filter @vouch/api exec drizzle-kit generate --name …`; migrated on boot |
| `apps/api/src/webhooks.test.ts` | HMAC cases (200/401/400/503) + persistence: verified → 1 row (fields, header allow-list, no signature), body-fallback stream/batch, non-JSON → body_text, 401s/503 → no row, insert failure → 500, NDJSON off still works | `pnpm --filter @vouch/api test` (19 total with app/env tests) |
| `Dockerfile` · `.dockerignore` · `railway.json` | Railway image (node:24-slim, corepack pnpm 11.28.6, `--prod` filtered install, `node --import tsx src/server.ts`, user node) · excludes `.env*` (keeps `.env.example`) · DOCKERFILE builder, `/health`, ON_FAILURE | Config-as-code is deprecated by Railway (legacy until 2026-12-01): confirm the settings in the UI |
| `docs/deploy/RAILWAY.md` | HUMAN login → ORCH init/add/up/domain → HUMAN secret → verify; logs; `--db`; redeploy/rollback; troubleshooting | CLI checked: v5.74.1 (2026-11-16) |
| `infra/streams/filter-logs.js` | QuickNode `main(stream)` filter template, placeholders `/*__ADDRESSES__*/ []`, `/*__TOPICS__*/ {}` | No require/import (sandbox) |
| `scripts/streams/lib.ts` | renderFilter, parseEvents (`hello` and `vouch` presets; `vouch` = 10 production events from `@vouch/shared`), redaction, `writeEnvVar` (atomic, mode-preserving), REST client `qn()` with key scrubbing | |
| `scripts/streams/streams.ts` | CLI: list/get/create/pause/activate/delete/set-webhook/sync-secret/test-filter/render-filter/enabled-count/key-info | `--dry-run` on create/test-filter/set-webhook |
| `scripts/streams/show-deliveries.ts` | Prints the delivery digest (verified flag, batch, blocks, events, tx hashes). Labels only for VERIFIED records. File mode (NDJSON, default) or `--db [--db-url]` | `streams:deliveries` (loads the root env like the api; process env wins, so `railway run` works) |
| `scripts/streams/deliveries-db.ts` | `readDbDeliveries` (postgres:// via postgres-js, pglite://<dir>), `rowToRec`, `redactDbUrl` | Refuses `*.railway.internal`; never prints credentials |
| `scripts/streams/ping.ts` | Sends one `Hello.ping()` (SPIKE_USER or DEPLOYER key) to trigger a delivery | `streams:ping --hello <addr>`; refuses a zero address or no code |
| `scripts/streams/filter.test.ts` | Runs the rendered filter in a bare `vm` context on sample payloads (3-deep, 2-deep, unwrapped, no-match) + env writer + redaction | `pnpm --filter @vouch/scripts test` |
| `docs/streams/S3-RUNBOOK.md` | §P production Stream values (Vouch, Railway URL, `--events vouch`, secret in Railway Variables) + the Hello reference run (offline/QE) with pass criteria | D-011, D-015, D-016 |
| `docs/streams/filter-hello-s3.js` | Rendered filter for the canonical Hello (Ping+Split), pasted into the dashboard | Re-render: `streams render-filter --contract <HELLO> --events hello > …` |

## Interfaces consumed / provided
- Consumes INTERFACES §4 topic0s (Ping/Split and the 10 Vouch events verified equal to `toEventSelector`/`VOUCH_EVENT_TOPICS` in tests), §2 `VOUCH_ARC_TESTNET`, §7 env (`QUICKNODE_STREAMS_API_KEY`, `STREAMS_WEBHOOK_SECRET`, `HELLO_ADDRESS`, `STREAMS_SPIKE_LOG`, `PORT`, `API_PORT`, `DATABASE_URL`, `DATABASE_PUBLIC_URL`, `CORS_ORIGINS`, `NODE_ENV`).
- Provides INTERFACES §6: signature scheme, 503/401/400/500/200 semantics, envelope v1 body, `stream_deliveries` row shape, the `streams delivery` log line, the NDJSON record shape (local). §7 changes proposed in the Phase 1.5 report.

## Done (rolling, newest first)
- 2026-11-16 — Phase 1.5 (D-305): `PORT` honoured; `stream_deliveries` raw ingest (verified only, persisted before the 200, 500 on insert failure) + migration 0001; structured `streams delivery` log line; NDJSON off in production; `streams:deliveries --db`; `--events vouch` preset; root `Dockerfile`/`.dockerignore`/`railway.json`; `tsx` → api dependency; `docs/deploy/RAILWAY.md`; runbook §P + README for the Railway URL (D-015/D-016). Simulated clean-clone image: 0 git calls, no forge-std/OZ/typescript/drizzle-kit, `/health` 200 (pglite memory), unsigned 503, 401 with secret, signed 200 → row 1. `pnpm -r typecheck` clean; tests shared 10/10, scripts 13/13, api 19/19.
- 2026-11-16 — Runbook rewritten for DASHBOARD stream creation (D-011): AGENT/HUMAN role split, filter tests at 72567880 (Ping, logIndex 4) / 72567926 (Split, logIndex 19) / 72567881 (null), create paused → token → restart → activate → verify → pause; DNS-NXDOMAIN note; REST-only CLI commands marked paid-plan.
- 2026-11-16 — QE-gate fixes (D-304): QE-01 `event` field confirmed in all consumers; QE-02 `ping --hello` + zero/no-code guard, `--contract` mandatory in the CLI; QE-04 runbook takes Hello/deploy block from INTERFACES §2; QE-05 `render-filter` stdout = pure JS; QE-06 viewer loads the env + shared path rule; QE-07 viewer withholds labels for unverified bodies; QE-12 runbook batch example; QE-15 `batchSource` + derived range. Tests: api 10/10, scripts 10/10, `pnpm -r typecheck` clean.
- 2026-11-16 — S3 code: HMAC-verified webhook + tests, filter + tests, Streams CLI, NDJSON viewer, ping trigger, runbook, D-301..D-303. `pnpm -r typecheck` clean; api tests 10/10; scripts tests 9/9. Live `streams list` → **403 (key not recognized)**.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] (ORCH, after HUMAN `railway login`) Deploy per `docs/deploy/RAILWAY.md` §2–3. Check `/health` → `db.kind: postgres` and unsigned → 503. Confirm the healthcheck/restart settings in the UI (config-as-code deprecation).
- [ ] After the v3 redeploy (D-014): fill runbook §P (address, start block), render `docs/streams/filter-vouch.js` with `--events vouch`, and run the wizard filter tests on blocks with known Vouch txs.
- [ ] HUMAN creates the production Stream (paused) → secret in Railway Variables → Deploy → unsigned 401 → activate → verify the backfill with `--db` → pause when idle.
- [ ] Record the UNVERIFIED items below from the first verified delivery; finalize INTERFACES §6.
- [ ] Phase 2: decoded/idempotent tables from `stream_deliveries` (`apps/api/src/streams/`), backfill/replay hash check.
- [ ] Follow-up: migrate `railway.json` to Railway IaC (`.railway/railway.ts`) before 2026-12-01 if the new service ignores it.

## Struggles, open questions, known issues
- **Railway config-as-code is deprecated** (docs, 2026-11-16): `railway.json` keeps working for legacy services until 2026-12-01, and it is unclear whether new services read it. The Dockerfile is auto-detected regardless, and RAILWAY.md tells the ORCH to check the healthcheck/restart settings in the UI.
- **Not tested against real Postgres:** no Postgres locally, so persistence is tested on PGlite (same SQL and migrations). drizzle-orm 0.45 + postgres-js should store jsonb as objects. The `--db` reader tolerates jsonb returned as strings either way. Check the first hosted row.
- `body` is jsonb, so key order and whitespace are normalized, and the exact signed bytes are not kept. The signature isn't stored either, so a row can't be re-verified offline. Acceptable for raw ingest; revisit if audit needs byte-exact bodies.
- Public endpoint: the body limit is still 50 MB and there is no rate limit on unauthenticated POSTs. Rejected bodies are no longer written to the DB or the NDJSON in production, and logs carry only size/reason. Consider a lower limit / Railway-level protection later.
- **No REST API on the trial plan (D-011):** the first key gave 403 `AuthenticationError` (not recognized). The human then confirmed that even a fresh Admin key gets 403 `AuthorizationError: Insufficient permissions`, and `qn auth login` fails too. Workaround: dashboard creation. Consequence: no scripted pause/resume/set-webhook, so the human must pause manually (credits are billed per block).
- Dashboard wizard fields (batch size/elastic batch, a metadata-in-payload toggle, retry fields) are documented from the REST schema and may be labelled differently or be missing in the UI. The filter tolerates both payload shapes.
- **Still UNVERIFIED (needs a live delivery):**
  1. `logs` payload nesting on Arc. Docs JSON spec + REST example: `data[block][receipt][log]`; prose: "array of arrays". The filter handles both, plus a missing wrapper.
  2. Whether the delivered body is exactly the filter's return value or wrapped in `{data, metadata}`. The NDJSON `summary.shape` will tell.
  3. `X-QN-Timestamp` unit. The guide's sample is 10 digits (seconds). We log skew only; we never reject on it.
  4. `blockTimestamp` presence in Streams logs (Arc's public RPC *does* return `blockTimestamp` in `eth_getLogs`).
  5. The Arc + `logs` credit multiplier and the Free-plan max `dataset_batch_size` (we need ≥ 5).
  6. Whether PATCH `set-webhook` without `security_token` really keeps the token. The docs say so. The CLI re-saves the token if the response shows a different one.
- Docs nit: OpenAPI `WebhookAttributes` lists `security_token` and `headers` as *required*, but the create-stream page says `security_token` is optional ("omit it … one is generated"). We omit the token and send `headers: {}`.
- Rejected deliveries are also logged to the NDJSON (bounded by the 50 MB body limit). That is fine for the spike; production should rate-limit or skip logging unauthenticated bodies.
- Unwrapped deliveries: `batchSource:"logs"` gives only a lower-bound range (blocks without logs are invisible). Use the `batch-*` headers as the authoritative range.
- Webhook replay protection (nonce cache / timestamp window) is not implemented. Dedupe on `(txHash, logIndex)` in Phase 2 makes replays harmless.

## How to run / test this area
```bash
pnpm --filter @vouch/api test                 # webhook HMAC + persistence + env cases (inject, no server)
pnpm --filter @vouch/api exec drizzle-kit generate --name <change>   # new migration after a schema.ts change
pnpm --silent --filter @vouch/scripts streams:deliveries --db --db-url pglite://<dir>      # local on-disk pglite (stop the api first)
railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:deliveries --db --last 10   # hosted
railway logs --service api --lines 100 --filter "streams delivery"
pnpm --filter @vouch/scripts test             # filter + env writer + redaction
pnpm -r typecheck
pnpm --silent --filter @vouch/scripts streams render-filter --contract 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32 --events hello > docs/streams/filter-hello-s3.js
pnpm --silent --filter @vouch/scripts streams create --name s3-hello-spike --contract 0x… --events hello --start <block> --webhook https://<tunnel> --dry-run
pnpm --silent --filter @vouch/scripts streams:deliveries --last 10
pnpm --silent --filter @vouch/scripts streams:ping --hello 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32   # sends a real tx
```
Full live procedure: `docs/streams/S3-RUNBOOK.md` (§P production) + `docs/deploy/RAILWAY.md`.

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-105, D-301..D-303), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/STREAMS_INFRA.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
