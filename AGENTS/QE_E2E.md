# QE_E2E
_Last updated: 2026-11-16T15:20:00Z by QE_E2E — Phase 0 QE gate, Part A_

## Mission
Owns test plans and end-to-end verification: scripted testnet flows, API contract tests against INTERFACES.md, Playwright tests at 390×844 with venue + customer contexts, real-phone checklists for the human, copy checks (no crypto jargon on primary screens), and bug reports. Does NOT fix the code it tests — files bugs to owners.

## Owned paths
- `e2e/` (Playwright)
- `docs/qa/` (test plans, bug reports, phone checklists)
- `docs/evidence/phase-*/` (evidence it captures)

## Current status
🟡 Phase 0 gate **Part A done**: S1 PASS, S2 PASS-with-defects, S3 offline PASS-with-defects (2 major, 0 blockers). **Part B (S3 live) waits** on a valid QuickNode key: `streams list` → 403 at 15:15Z.

## Mental model (read this first)
- Verify from the **written** docs only, and re-derive every claim with an independent tool (cast/curl/Blockscout v2 API) rather than the builder's script. Then also re-run the builder's script.
- Never touch the root env file. Tools load it: `bash scripts/spikes/s2-deploy.sh` and `pnpm … streams*`/`api start` (`tsx --env-file-if-exists`). Inline env vars **override** the file (proven: an inline `STREAMS_WEBHOOK_SECRET` verified a signed delivery).
- Run local servers on QE ports (4020), with `API_HOST=127.0.0.1 DATABASE_URL=pglite://memory STREAMS_SPIKE_LOG=<scratch>` so the shared DB and spike log aren't touched. Never use 3000/3100/4000.
- Use real Arc logs for payload tests (`eth_getLogs` on a single block). The raw JSON for blocks 72567880 (Ping), 72567926 (Split + USDC + system logs) and 72567881 (no Hello) is kept in `docs/evidence/phase-0/qe/`.
- Testnet spend so far: 0.01764372 USDC (one Hello deploy + ping).

## Key files map
| Path | What it does | Notes |
|---|---|---|
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
- 2026-11-16 — Phase 0 QE gate Part A.
  - S1: all live rows REPRODUCED. Also exercised the Blockscout verify flags (fresh Hello verified).
  - S2: fresh Hello `0xc6282732b1852726F73D7Cea98cE6D03f9021906` (block 72569134) + ping `0xe68b5e3f…1ff1`. Original deploy/ping and the S5 split confirmed on RPC + Blockscout.
  - S3 offline: tests 10/10 + 9/9, create dry-run, filter on real logs 10/10, real-server HMAC 200/401/401 (+400 gzip), viewer OK.
  - Report: `docs/qa/phase-0-qe-gate.md`.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Phase 0 gate Part B: reproduce S3 live from `docs/streams/S3-RUNBOOK.md` steps 1–9 once the Orchestrator confirms a valid key. First confirm `HELLO_ADDRESS` = stream contract (QE-02).
- [ ] Re-check QE-01/02/03/05 fixes when owners report them.
- [ ] Phase 2: API contract tests + CLI end-to-end canonical story on testnet + replay determinism
- [ ] Phase 3: Playwright full story (two contexts) + real-phone checklist
- [ ] Phase 5: full regression + demo rehearsal from written steps

## Struggles, open questions, known issues
- The Bash guard also blocks commands that merely name `.env.example`. Use the Read tool for that file if needed.
- The `rtk` hook rewrites some compound commands (`grep`, `cat`, `for … set --`). Put multi-step logic in a script file under `docs/evidence/phase-0/qe/` and run it with `bash`.
- Arc public RPC rate-limits bursts (`-32005`). Add `sleep 1–3` between heavy `eth_getLogs` calls.
- Open defects: see `docs/qa/phase-0-qe-gate.md` (QE-01 and QE-02 major).

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
