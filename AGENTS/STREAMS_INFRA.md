# STREAMS_INFRA
_Last updated: 2026-11-16 by STREAMS_INFRA — Phase 0 (S3: switched to dashboard creation, D-011)_

## Mission
Owns the QuickNode Streams pipeline: Stream configuration (dashboard steps or REST API), filter code, the webhook handler (auth/signature verification if supported, idempotency on (txHash, logIndex), ordered processing, reorg safety), building ALL derived views from events, backfill/replay tooling, and deployment config for public endpoints. Does NOT own UI or relayer logic.

## Owned paths
- `apps/api/src/streams/` (not yet created), `apps/api/src/routes/webhooks.ts`, `apps/api/src/webhooks.test.ts`
- `infra/streams/` (filter code, stream config JSON)
- `scripts/streams/`, `scripts/backfill/`
- `docs/streams/`
- Deployment config files (e.g. `railway.json`, `fly.toml`, `vercel.json`)

## Current status
🟡 **S3 code complete; the live run uses DASHBOARD stream creation (D-011).** The Streams REST API is blocked on QuickNode trial plans: even a fresh account's Admin key gets `403 {"message":"Insufficient permissions","name":"AuthorizationError"}`, and `qn auth login` fails the same way. The HUMAN creates, activates and pauses the stream in the dashboard wizard (Arc Testnet is offered) using `docs/streams/filter-hello-s3.js`. Agents run the api, the tunnel, verification and the live ping. Procedure: `docs/streams/S3-RUNBOOK.md`. Waiting on the human's wizard run.

## Mental model (read this first)
```
Arc block ─▶ QuickNode Stream (arc-testnet / logs / filter-logs.js) ─▶ HTTPS POST (sequential; waits for 2xx)
   ─▶ cloudflared quick tunnel ─▶ apps/api POST /webhooks/streams
        1. raw bytes (encapsulated buffer parser) → gunzip if needed
        2. HMAC check: hex(HMAC-SHA256(token, nonce+timestamp+body)) vs X-QN-Signature
           503 if no secret · 401 missing/bad · 200 verified
        3. append NDJSON record {verified, headers, body, summary} → data/local/streams-spike.ndjson
```
- **Filter** (`infra/streams/filter-logs.js`): keeps `address ∈ ADDRESSES && topic0 ∈ TOPICS` and returns `null` otherwise. It delivers **envelope v1** `{v, streamId, network, dataset, batchStart, batchEnd, batchSource, events[]}` (D-302, D-304). Each event's label field is **`event`**, not `eventName` (QE-01). Billing is per block processed whatever the filter returns, so **pause when idle**.
- **Stream lifecycle on trial = dashboard (HUMAN).** Create (paused) → the human pastes the security token into the root env as `STREAMS_WEBHOOK_SECRET` → the agent restarts the api → the human activates → the agent verifies → the human pauses. When the quick-tunnel URL changes, the human edits the webhook URL in the dashboard. It becomes stable after the Phase 5 deploy.
- **CLI** (`scripts/streams/streams.ts`): `render-filter` (pure-JS stdout → `docs/streams/filter-hello-s3.js`), `create --dry-run`, `streams:deliveries` and `streams:ping` work without the REST API. `list/get/create/pause/activate/delete/set-webhook/sync-secret/test-filter/enabled-count` need the REST API (`https://api.quicknode.com/streams/rest/v1`, `x-api-key`), i.e. a **paid plan**. They are kept for later. They never print the key or token (GET responses contain the token in clear text, so output is redacted).
- The api reads `STREAMS_WEBHOOK_SECRET` at start-up, so **restart the api after the token is saved**.
- **Contract targets are always explicit** (D-304). The canonical spike Hello is `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32`, deploy block 72567874, from INTERFACES §2. Never take it from `run-latest.json` or trust the env's `HELLO_ADDRESS`. The stream's `--contract` must equal `streams:ping --hello`.
- Phase 2 (not built): replace the NDJSON spike sink with idempotent upserts keyed by `(txHash, logIndex)`, ordered by `(blockNumber, logIndex)`, and decode with the shared ABI.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `apps/api/src/routes/webhooks.ts` | Webhook route + exported `decodeBody`, `computeSignature`, `signatureMatches`, `timestampSkew`, `collectLogs`, `summarize` | Raw-body parser is scoped to this plugin only |
| `apps/api/src/env.ts` | `realSecret()` treats empty / `__placeholder__` as unset; `STREAMS_SPIKE_LOG` resolved against the repo root | → 503 fail-closed |
| `apps/api/src/webhooks.test.ts` | 9 cases: valid sig 200, tampered 401, wrong token 401, missing headers 401, gzip 200, secret unset 503, placeholders, summary nesting, timestamp units | `pnpm --filter @vouch/api test` |
| `infra/streams/filter-logs.js` | QuickNode `main(stream)` filter template, placeholders `/*__ADDRESSES__*/ []`, `/*__TOPICS__*/ {}` | No require/import (sandbox) |
| `scripts/streams/lib.ts` | renderFilter, parseEvents (`hello` preset), redaction, `writeEnvVar` (atomic, mode-preserving), REST client `qn()` with key scrubbing | |
| `scripts/streams/streams.ts` | CLI: list/get/create/pause/activate/delete/set-webhook/sync-secret/test-filter/render-filter/enabled-count/key-info | `--dry-run` on create/test-filter/set-webhook |
| `scripts/streams/show-deliveries.ts` | Prints the NDJSON digest (verified flag, batch, blocks, events, tx hashes). Labels only for VERIFIED lines | `streams:deliveries` (loads the root env like the api) |
| `scripts/streams/ping.ts` | Sends one `Hello.ping()` (SPIKE_USER or DEPLOYER key) to trigger a delivery | `streams:ping --hello <addr>`; refuses a zero address or no code |
| `scripts/streams/filter.test.ts` | Runs the rendered filter in a bare `vm` context on sample payloads (3-deep, 2-deep, unwrapped, no-match) + env writer + redaction | `pnpm --filter @vouch/scripts test` |
| `docs/streams/S3-RUNBOOK.md` | Step-by-step S3 reproduction: [AGENT] api/tunnel/verify/ping + [HUMAN] dashboard wizard, with pass criteria | Dashboard flow (D-011) |
| `docs/streams/filter-hello-s3.js` | Rendered filter for the canonical Hello (Ping+Split), pasted into the dashboard | Re-render: `streams render-filter --contract <HELLO> --events hello > …` |

## Interfaces consumed / provided
- Consumes INTERFACES §4 topic0s (Ping/Split verified equal to `toEventSelector` in tests), §7 env (`QUICKNODE_STREAMS_API_KEY`, `STREAMS_WEBHOOK_SECRET`, `HELLO_ADDRESS`, `STREAMS_SPIKE_LOG`).
- Provides INTERFACES §6 (proposed update in the S3 report): signature scheme, 503/401/400/200 semantics, envelope v1 body, NDJSON record shape.

## Done (rolling, newest first)
- 2026-11-16 — Runbook rewritten for DASHBOARD stream creation (D-011): AGENT/HUMAN role split, filter tests at 72567880 (Ping, logIndex 4) / 72567926 (Split, logIndex 19) / 72567881 (null), create paused → token → restart → activate → verify → pause; DNS-NXDOMAIN note; REST-only CLI commands marked paid-plan.
- 2026-11-16 — QE-gate fixes (D-304): QE-01 `event` field confirmed in all consumers; QE-02 `ping --hello` + zero/no-code guard, `--contract` mandatory in the CLI; QE-04 runbook takes Hello/deploy block from INTERFACES §2; QE-05 `render-filter` stdout = pure JS; QE-06 viewer loads the env + shared path rule; QE-07 viewer withholds labels for unverified bodies; QE-12 runbook batch example; QE-15 `batchSource` + derived range. Tests: api 10/10, scripts 10/10, `pnpm -r typecheck` clean.
- 2026-11-16 — S3 code: HMAC-verified webhook + tests, filter + tests, Streams CLI, NDJSON viewer, ping trigger, runbook, D-301..D-303. `pnpm -r typecheck` clean; api tests 10/10; scripts tests 9/9. Live `streams list` → **403 (key not recognized)**.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Run S3 per `docs/streams/S3-RUNBOOK.md`: agent A1–A4 → human H1–H4 (wizard; the filter tests on 72567880/72567926/72567881 are the live payload-shape proof) → A5 → H5a → A6–A7 → H5b pause.
- [ ] Record the UNVERIFIED items below from the first verified delivery; finalize INTERFACES §6.
- [ ] Phase 2: production handler (`apps/api/src/streams/`): idempotent upsert on (txHash, logIndex), ordering by batch, decoded events → derived tables; backfill/replay hash check; stable hosted URL (D-005).

## Struggles, open questions, known issues
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
pnpm --filter @vouch/api test                 # webhook HMAC cases (inject, no server)
pnpm --filter @vouch/scripts test             # filter + env writer + redaction
pnpm -r typecheck
pnpm --silent --filter @vouch/scripts streams render-filter --contract 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32 --events hello > docs/streams/filter-hello-s3.js
pnpm --silent --filter @vouch/scripts streams create --name s3-hello-spike --contract 0x… --events hello --start <block> --webhook https://<tunnel> --dry-run
pnpm --silent --filter @vouch/scripts streams:deliveries --last 10
pnpm --silent --filter @vouch/scripts streams:ping --hello 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32   # sends a real tx
```
Full live procedure: `docs/streams/S3-RUNBOOK.md`.

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-105, D-301..D-303), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/STREAMS_INFRA.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
