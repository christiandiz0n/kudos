# QE_E2E
_Last updated: 2026-11-18T18:22:00Z by QE_E2E — Phase 2 QE gate Part B attempt 2: PASS-with-findings_

## Mission
Owns test plans and end-to-end verification: scripted testnet flows, API contract tests against INTERFACES.md, Playwright tests at 390×844 with venue + customer contexts, real-phone checklists for the human, copy checks (no crypto jargon on primary screens), and bug reports. Does NOT fix the code it tests — files bugs to owners.

## Owned paths
- `e2e/` (Playwright)
- `docs/qa/` (test plans, bug reports, phone checklists)
- `docs/evidence/phase-*/` (evidence it captures)

## Current status
🟢 **Phase 2 gate PASS-with-findings** (Part A 2026-11-17; Part B hosted 2026-11-18 18:08–18:17Z).
- **Hosted story:** the canonical story ran through the hosted api (deployment `ce50f9ff`, code `920a042`).
  - Pay `0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb` is exact on chain.
  - It settled via the live Stream ~0.3 s after the relay receipt; SSE `payment.settled` came +0.81 s after block time.
- **Hosted == chain:** 177/177 checks, 141 events. No events missing.
- **Deliveries:** 28/28 verified.
- **Open:** QE-2-10 (Info, MSG-106): the X-QN-Timestamp unit is not observable in the logs, so SEC-2-10 stays open.
- **The Stream can be paused.**
- **Next:** Thursday PM QE gate on the deployed web app.

## Mental model (read this first)
- Verify from the **written** docs only, and re-derive every claim with an independent tool (cast/curl/Blockscout v2 API) rather than the builder's script. Then also re-run the builder's script.
- Never touch the root env file. Tools load it: `bash scripts/spikes/s2-deploy.sh` and `pnpm … streams*`/`api start` (`tsx --env-file-if-exists`). Inline env vars **override** the file (proven: an inline `STREAMS_WEBHOOK_SECRET` verified a signed delivery).
- Run local servers on QE ports (4020), with `API_HOST=127.0.0.1 DATABASE_URL=pglite://memory STREAMS_SPIKE_LOG=<scratch>` so the shared DB and spike log aren't touched. Never use 3000/3100/4000.
- Use real Arc logs for payload tests (`eth_getLogs` on a single block). The raw JSON for blocks 72567880 (Ping), 72567926 (Split + USDC + system logs) and 72567881 (no Hello) is kept in `docs/evidence/phase-0/qe/`.
- Testnet spend so far: 0.01764372 USDC (one Hello deploy + ping).

## Phase 2 notes (read before Part B)
- Guards without the real relayer key: start the local api with an inline `RELAYER_PRIVATE_KEY=<QE X key from qe-state.json>` (unfunded), `ORDER_MIN_USDC=0.01` (920a042 enforces a $0.50 minimum), `RELAYER_MAX_GAS_PAY=100000`, `RELAYER_RATE_PER_USER_PER_MIN=2`. The coordinator forbids a local api holding the real relayer key while the hosted relayer is live.
- On 920a042, `/events/venue/:v` opens only for a venue known on chain or in Streams. `?token=` was removed (bearer-only).
- **Other agents edit `apps/api` in this same checkout during the gate.** Check `git status` and file mtimes before starting a local api, and record which code each run used. Never stash their work.
- Local api for tests: `PORT=4030 API_HOST=127.0.0.1 DATABASE_URL=pglite://<scratch>/db STREAMS_SPIKE_LOG=off pnpm --filter @vouch/api start`. Inline vars beat the env file. PGlite is single-process: stop the api before `streams:backfill --db-url pglite://<same dir>`. `pkill -f` on the DB path doesn't kill the tsx child; kill the pid from `lsof -tiTCP:<port> -sTCP:LISTEN`.
- QE throwaway wallets (O owner, C customer, U unfunded, X bystander) live ONLY in `<scratch>/qe-state.json`. Fund C with `pnpm --filter @vouch/scripts topup -- --to <C> --target 0.20 --max-total 0.25`. QE venue `0xd5eab90441172616F87DfFc5b4A32e85DD159422` (payout = DEMO_LENA).
- The hosted Stream delivered past 72606174: the 3rd venue was registered at block 72613566. Hosted == chain over 72605845..72624473 (72 events).
- Part B (2026-11-18):
  - The Stream reached head 22 min after it re-crossed the last old event (>200 blocks/s, faster than the 150 estimated).
  - The pino `time=` in railway logs is the true server time; the Railway timestamp lags up to ~2 min.
  - Other agents/the human use the hosted api concurrently (extra venues); compare against everything, not just QE's venues.
  - `api-contract guards` can't run against hosted (production caps → it would broadcast real pays).
- Hosted `/me/*` needs `SESSION_SECRET` on Railway. Postgres public networking is OFF, so there is no hosted hash or cursor read: compare via public reads with `independent-derive.mjs --hosted`.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `docs/qa/phase-2-qe-e2e.md` | Phase 2 gate report (Part A; Part B to append) | findings QE-2-01..09 |
| `scripts/qa/api-contract.ts` | Live API contract harness: `setup|noauth|main|guards|settled` | run with `scripts/node_modules/.bin/tsx`; `main` spends about $0.012 gas |
| `scripts/qa/independent-derive.mjs` | Independent chain re-derivation: topic0s, invariants, receipt + USDC transfers, on-chain stats, hosted reads, PGlite rows | read-only; no api code |
| `scripts/qa/story-latency.mjs` | Part B: wraps `story:api`, timestamps every line, subscribes to the public venue SSE, computes block time → `payment.settled` | never reads the env file |
| `scripts/qa/webhook-probes.sh` | 11 negative webhook probes (§6) | safe on hosted (no load, no bomb) |
| `docs/qa/phase-0-qe-gate.md` | Phase 0 gate report: per-spike tables + defect list QE-01..QE-15 | Part B to be appended |
| `docs/evidence/phase-0/qe/s1-live.sh` | Independent S1 re-derivation (chain, RPCs, CORS, explorer, USDC, selectors, typehashes, 1e12, fees, getLogs cap, predeploys) | read-only; python urllib is 403'd by the RPC, so use curl |
| `docs/evidence/phase-0/qe/s2-verify.sh` | RPC + Blockscout check of a Hello deployment, its Ping, and the S5 split tx | args: `<hello> <deploy_tx> <ping_tx>` |
| `docs/evidence/phase-0/qe/s2-cast-logs.sh` | `cast logs` of all Hello logs (capped at head) | |
| `docs/evidence/phase-0/qe/filter-harness.mjs` | Runs the `render-filter` output in a bare vm against real-log payloads (3-deep / unwrapped / unrelated) | strips the CLI preamble (QE-05) |
| `docs/evidence/phase-0/qe/hmac-e2e.mjs` | Signed/tampered/missing-header/gzip/ms-ts POSTs to a running api, built from INTERFACES §6 | `node hmac-e2e.mjs <base> <secret> <filter.js>` |
| `docs/evidence/phase-0/qe/s2-original-run-latest.json.bak` | Copy of the original S2 broadcast `run-latest.json` before QE re-ran S2 | |

## Interfaces consumed / provided
Consumes INTERFACES §1 (all live rows re-derived), §2 (Hello), §4 (Ping/Split topic0), §6 (HMAC, envelope), §7 (env names). Proposed INTERFACES change (via Orchestrator): §6 body field `eventName` → `event` (QE-01).

## Done (rolling, newest first)
- 2026-11-18: Phase 2 QE gate Part B attempt 2 (hosted): **PASS-with-findings**.
  - Hosted story exact on chain (pay `0x40147554…ddfcb`, block 72890535) and settled via the live Stream: SSE +0.144 s and `GET /payments/:id` +0.296 s after the relay receipt.
  - 28/28 verified deliveries.
  - Hosted == chain: 105/105 before the story (101 events), 177/177 after (141 events).
  - Completeness: no events missing (the 2 QuickNode dashboard errors were retried or predate the data).
  - QE-2-05/08 fixed on hosted.
  - Messages: MSG-106 (QE-2-10 → STREAMS_INFRA); MSG-078 and MSG-084 closed; MSG-079 left open with a note.
  - Gas 0.0444 USDC.
- 2026-11-18: Phase 2 Part B attempt 1. Not run: the relayer was disabled and the Stream idle. `guards` 7/7 on `920a042` locally, including the QE-2-01 re-test.
- 2026-11-17: Phase 2 QE gate Part A (PASS-with-findings).
  - API contract: 157 live checks.
  - Determinism: reference `0b0c880d…` reproduced; head `73a460fd…`; independent re-derivation equals the derived rows and on-chain stats.
  - Hosted == chain: 73/73.
  - Webhook probes: 11/11.
  - Local `story:api` exact on chain, then settled via `streams:backfill` + `--check-intent`.
  - Messages: MSG-075 (QE-2-01), MSG-076 (Lows), MSG-077 (ack of MSG-049).
  - Gas about $0.054.
- 2026-11-16 — Phase 0 QE gate Part A.
  - S1: all live rows REPRODUCED. Also exercised the Blockscout verify flags (fresh Hello verified).
  - S2: fresh Hello `0xc6282732b1852726F73D7Cea98cE6D03f9021906` (block 72569134) + ping `0xe68b5e3f…1ff1`. Original deploy/ping and the S5 split confirmed on RPC + Blockscout.
  - S3 offline: tests 10/10 + 9/9, create dry-run, filter on real logs 10/10, real-server HMAC 200/401/401 (+400 gzip), viewer OK.
  - Report: `docs/qa/phase-0-qe-gate.md`.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] **Thursday PM QE gate on the deployed web app:**
  - Playwright at 390×844 with two browser contexts (venue + customer), running the full story against the deployed web + hosted api.
  - A real-phone checklist for the human.
  - Copy check: no crypto jargon on primary screens.
- [ ] At Thursday's gate, re-test QE-2-03/04/06/09 on hosted (MSG-079).
- [ ] Re-check QE-2-10 / SEC-2-10 when STREAMS_INFRA logs the timestamp unit (MSG-106).
- [ ] Phase 0 gate Part B leftovers: QE-01/02/03/05 re-checks when owners report them.
- [x] Phase 2 Part A: API contract tests, CLI story (local), replay determinism, hosted == chain, webhook probes.
- [x] Phase 2 Part B: hosted story `--require-settled`, latency, delivery logs, hosted == chain (2026-11-18).
- [x] Re-test QE-2-01: PASS on 920a042.
- [ ] Phase 5: full regression + demo rehearsal from written steps.

## Struggles, open questions, known issues
- The Bash guard also blocks commands that merely name `.env.example`. Use the Read tool for that file if needed.
- The `rtk` hook rewrites some compound commands (`grep`, `cat`, `for … set --`). Put multi-step logic in a script file under `docs/evidence/phase-0/qe/` and run it with `bash`.
- Arc public RPC rate-limits bursts (`-32005`). Add `sleep 1–3` between heavy `eth_getLogs` calls.
- Open defects: Phase 0 `docs/qa/phase-0-qe-gate.md` (QE-01, QE-02 major); Phase 2 `docs/qa/phase-2-qe-e2e.md` (QE-2-03/04/06/09 not re-tested; QE-2-10 Info, MSG-106). QE-2-01 is closed.
- Proposed INTERFACES change (QE-2-02): delete the stale second "Full typehashes" block in §3 (PaymentAuth `0x83204ea1…` is pre-D-012).

## How to run / test this area
```bash
bash docs/evidence/phase-0/qe/s1-live.sh                      # S1 independent live facts
bash scripts/spikes/s2-deploy.sh                               # S2 (spends ~0.0176 USDC, overwrites broadcast run-latest.json)
bash docs/evidence/phase-0/qe/s2-verify.sh <hello> <deploy_tx> <ping_tx>
pnpm --filter @vouch/api test && pnpm --filter @vouch/scripts test
pnpm --silent --filter @vouch/scripts streams render-filter --contract <hello> --events hello 2>/dev/null > /tmp/f.js
node docs/evidence/phase-0/qe/filter-harness.mjs /tmp/f.js
STREAMS_WEBHOOK_SECRET=qe-test-secret API_PORT=4020 API_HOST=127.0.0.1 DATABASE_URL=pglite://memory STREAMS_SPIKE_LOG=<scratch>/x.ndjson pnpm --filter @vouch/api start
node docs/evidence/phase-0/qe/hmac-e2e.mjs http://127.0.0.1:4020 qe-test-secret /tmp/f.js
STREAMS_SPIKE_LOG=<scratch>/x.ndjson pnpm --silent --filter @vouch/scripts streams:deliveries --last 20
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/QE_E2E.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
