# STREAMS_INFRA
_Last updated: 2026-11-16 by STREAMS_INFRA — Phase 0 (S3)_

## Mission
Owns the QuickNode Streams pipeline: Stream configuration (dashboard steps or REST API), filter code, the webhook handler (auth/signature verification if supported, idempotency on (txHash, logIndex), ordered processing, reorg safety), building ALL derived views from events, backfill/replay tooling, and deployment config for public endpoints. Does NOT own UI or relayer logic.

## Owned paths
- `apps/api/src/streams/` (not yet created), `apps/api/src/routes/webhooks.ts`, `apps/api/src/webhooks.test.ts`
- `infra/streams/` (filter code, stream config JSON)
- `scripts/streams/`, `scripts/backfill/`
- `docs/streams/`
- Deployment config files (e.g. `railway.json`, `fly.toml`, `vercel.json`)

## Current status
🟡 **S3 code complete, live run BLOCKED on the API key.** `QUICKNODE_STREAMS_API_KEY` is well-formed (`QN_` + 32 chars) but QuickNode answers `HTTP 403 AuthenticationError: Provided key is incorrect or malformed under x-api-key header`. A fabricated `QN_000…` key gets the same answer, so the key is not recognized at all (this is not a scope problem). The human must create a new Console API key with Streams enabled.

## Mental model (read this first)
```
Arc block ─▶ QuickNode Stream (arc-testnet / logs / filter-logs.js) ─▶ HTTPS POST (sequential; waits for 2xx)
   ─▶ cloudflared quick tunnel ─▶ apps/api POST /webhooks/streams
        1. raw bytes (encapsulated buffer parser) → gunzip if needed
        2. HMAC check: hex(HMAC-SHA256(token, nonce+timestamp+body)) vs X-QN-Signature
           503 if no secret · 401 missing/bad · 200 verified
        3. append NDJSON record {verified, headers, body, summary} → data/local/streams-spike.ndjson
```
- **Filter** (`infra/streams/filter-logs.js`): keeps `address ∈ ADDRESSES && topic0 ∈ TOPICS` and returns `null` otherwise. It delivers **envelope v1** `{v, streamId, network, dataset, batchStart, batchEnd, events[]}` (D-302). Billing is per block processed whatever the filter returns, so **pause when idle**.
- **CLI** (`scripts/streams/streams.ts`) is the only thing that talks to the QuickNode REST API (`https://api.quicknode.com/streams/rest/v1`, header `x-api-key`). It renders and base64-encodes the filter, creates, pauses or activates the stream, and patches the webhook URL. It writes the stream's security token into the root env file as `STREAMS_WEBHOOK_SECRET` without printing it. All output is redacted: GET responses contain the token in clear text.
- The api reads `STREAMS_WEBHOOK_SECRET` at start-up, so **restart the api after create or sync-secret**.
- Phase 2 (not built): replace the NDJSON spike sink with idempotent upserts keyed by `(txHash, logIndex)`, ordered by `(blockNumber, logIndex)`, and decode with the shared ABI.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `apps/api/src/routes/webhooks.ts` | Webhook route + exported `decodeBody`, `computeSignature`, `signatureMatches`, `timestampSkew`, `collectLogs`, `summarize` | Raw-body parser is scoped to this plugin only |
| `apps/api/src/env.ts` | `realSecret()` treats empty / `__placeholder__` as unset | → 503 fail-closed |
| `apps/api/src/webhooks.test.ts` | 9 cases: valid sig 200, tampered 401, wrong token 401, missing headers 401, gzip 200, secret unset 503, placeholders, summary nesting, timestamp units | `pnpm --filter @vouch/api test` |
| `infra/streams/filter-logs.js` | QuickNode `main(stream)` filter template, placeholders `/*__ADDRESSES__*/ []`, `/*__TOPICS__*/ {}` | No require/import (sandbox) |
| `scripts/streams/lib.ts` | renderFilter, parseEvents (`hello` preset), redaction, `writeEnvVar` (atomic, mode-preserving), REST client `qn()` with key scrubbing | |
| `scripts/streams/streams.ts` | CLI: list/get/create/pause/activate/delete/set-webhook/sync-secret/test-filter/render-filter/enabled-count/key-info | `--dry-run` on create/test-filter/set-webhook |
| `scripts/streams/show-deliveries.ts` | Prints the NDJSON digest (verified flag, batch, blocks, events, tx hashes) | `streams:deliveries` |
| `scripts/streams/ping.ts` | Sends one `Hello.ping()` (SPIKE_USER or DEPLOYER key) to trigger a delivery | `streams:ping` |
| `scripts/streams/filter.test.ts` | Runs the rendered filter in a bare `vm` context on sample payloads (3-deep, 2-deep, unwrapped, no-match) + env writer + redaction | `pnpm --filter @vouch/scripts test` |
| `docs/streams/S3-RUNBOOK.md` | Step-by-step S3 reproduction for QE | |

## Interfaces consumed / provided
- Consumes INTERFACES §4 topic0s (Ping/Split verified equal to `toEventSelector` in tests), §7 env (`QUICKNODE_STREAMS_API_KEY`, `STREAMS_WEBHOOK_SECRET`, `HELLO_ADDRESS`, `STREAMS_SPIKE_LOG`).
- Provides INTERFACES §6 (proposed update in the S3 report): signature scheme, 503/401/400/200 semantics, envelope v1 body, NDJSON record shape.

## Done (rolling, newest first)
- 2026-11-16 — S3 code: HMAC-verified webhook + tests, filter + tests, Streams CLI, NDJSON viewer, ping trigger, runbook, D-301..D-303. `pnpm -r typecheck` clean; api tests 10/10; scripts tests 9/9. Live `streams list` → **403 (key not recognized)**.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] **Human:** create a new QuickNode Console API key (Dashboard → API Keys → Add, enable Streams) → root env `QUICKNODE_STREAMS_API_KEY`. Verify with `pnpm --silent --filter @vouch/scripts streams list`.
- [ ] Run `streams test-filter --contract 0x66cb4392322b2aede460a4314ce092e0cc1c2b32 --events hello --block 72567880` (live proof of payload nesting), then the S3 runbook steps 3–9.
- [ ] Record the UNVERIFIED items below from the first verified delivery; finalize INTERFACES §6.
- [ ] Phase 2: production handler (`apps/api/src/streams/`): idempotent upsert on (txHash, logIndex), ordering by batch, decoded events → derived tables; backfill/replay hash check; stable hosted URL (D-005).

## Struggles, open questions, known issues
- **API key rejected (blocker):** 403 `AuthenticationError`, identical to a fake key; without any key the API returns 401. Format looks right (35 chars, `QN_` prefix, no whitespace or quotes).
- **Still UNVERIFIED (needs a live delivery):**
  1. `logs` payload nesting on Arc. Docs JSON spec + REST example: `data[block][receipt][log]`; prose: "array of arrays". The filter handles both, plus a missing wrapper.
  2. Whether the delivered body is exactly the filter's return value or wrapped in `{data, metadata}`. The NDJSON `summary.shape` will tell.
  3. `X-QN-Timestamp` unit. The guide's sample is 10 digits (seconds). We log skew only; we never reject on it.
  4. `blockTimestamp` presence in Streams logs (Arc's public RPC *does* return `blockTimestamp` in `eth_getLogs`).
  5. The Arc + `logs` credit multiplier and the Free-plan max `dataset_batch_size` (we need ≥ 5).
  6. Whether PATCH `set-webhook` without `security_token` really keeps the token. The docs say so. The CLI re-saves the token if the response shows a different one.
- Docs nit: OpenAPI `WebhookAttributes` lists `security_token` and `headers` as *required*, but the create-stream page says `security_token` is optional ("omit it … one is generated"). We omit the token and send `headers: {}`.
- Rejected deliveries are also logged to the NDJSON (bounded by the 50 MB body limit). That is fine for the spike; production should rate-limit or skip logging unauthenticated bodies.
- Webhook replay protection (nonce cache / timestamp window) is not implemented. Dedupe on `(txHash, logIndex)` in Phase 2 makes replays harmless.

## How to run / test this area
```bash
pnpm --filter @vouch/api test                 # webhook HMAC cases (inject, no server)
pnpm --filter @vouch/scripts test             # filter + env writer + redaction
pnpm -r typecheck
pnpm --silent --filter @vouch/scripts streams list            # read-only API check
pnpm --silent --filter @vouch/scripts streams create --name s3-hello-spike --contract 0x… --events hello --start <block> --webhook https://<tunnel> --dry-run
pnpm --silent --filter @vouch/scripts streams:deliveries --last 10
```
Full live procedure: `docs/streams/S3-RUNBOOK.md`.

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-105, D-301..D-303), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
