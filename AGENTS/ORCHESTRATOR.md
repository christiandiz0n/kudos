# ORCHESTRATOR — HANDOFF
_Last updated: 2026-11-16 (session 2) by ORCHESTRATOR — Phase 1.5 (A5 follow-ups); Phase 2 waits for "go"_

> **New orchestrator session: read in this order:** this file → `AGENTS/ORCHESTRATOR_PROMPT.md` (original prompt + Amendments A1–A5, which override it) → `AGENTS/README.md` (product story + comms protocol) → `AGENTS/HUMAN_INPUT.md` → `AGENTS/INBOX/_INDEX.md` → `AGENTS/PHASE_LOG.md` → `AGENTS/INTERFACES.md` → `AGENTS/DECISIONS.md` (as needed) → `AGENTS/AGENT_REGISTRY.md`.

## Mission
Plan each phase, delegate to subagents with self-contained briefs (template: prompt §5.2, plus the inbox rules), integrate, run **independent** QE, keep `AGENTS/` true to the code, maintain `HUMAN_INPUT.md`, route inbox messages, and **stop at every phase gate** for the human. Never mark a phase done on a builder's word. No gate passes with an open `blocker` message.

## Owned paths
`AGENTS/README.md`, `AGENTS/ORCHESTRATOR.md`, `AGENTS/ORCHESTRATOR_PROMPT.md`, `AGENTS/HUMAN_INPUT.md`, `AGENTS/PHASE_LOG.md`, `AGENTS/AGENT_REGISTRY.md`. The Orchestrator applies changes to `AGENTS/INTERFACES.md`. Also `scripts/agents/msg.py`, `scripts/setup/gen-env.py`, `scripts/spikes/s2-deploy.sh`, the root `README.md` skeleton (DOCS_SUBMISSION takes it over in Phase 6), and `apps/web/src/app/spike/passkey/`.

## Current status
🟡 **Phase 1.5 (A5).** Phase 1 gate PASS; design approved (D-017). In flight: **v3 submitter rule** (D-014: CONTRACTS → CONTRACTS_QE → redeploy), **Railway API host** (D-016: STREAMS_INFRA prep → human `railway login` → Orchestrator deploys), then **one production Stream** (D-015) from the dashboard checklist. Phone tests (#4) with the human on the session-2 web tunnel. The human has **not** said "go" for Phase 2. Time used ≈ 6.5 h of ~40–50.

## Mental model (read this first)
- **Product:** Vouch (D-007). Pay a local venue in USDC on Arc by scanning a QR; the payment atomically splits: cashback 25% / L1 referrers 55% / L2 introducers 20% of the reward pool, remainder to the venue. Canonical: $12.00 → 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108.
- **Chain:** Arc Testnet, chain 5042002. RPC `https://rpc.testnet.arc.io`; explorer `https://explorer.testnet.arc.io` (Blockscout). USDC `0x3600…0000`, 6-dec ERC-20 = the same balance as 18-dec native gas (D-101, D-102). Base-fee floor 20 gwei. No reorgs.
- **Payments:** the customer signs USDC `ReceiveWithAuthorization` whose nonce = the PaymentAuth struct hash (D-103). `PaymentAuth` binds `submitter` = the relayer (D-012/D-512, normative per D-013). Users never pay gas; RELAYER submits everything.
- **Wallet:** passkey-gated browser key + relayer (D-104). WebAuthn PRF support on the human's phone is unknown (S6b pending).
- **Data:** QuickNode Streams (dataset `logs`, JS filter, HMAC-verified webhook `POST /webhooks/streams`) → api → DB → SSE. **All derived state must come from Streams events** (Phase 2). The Stream is created **in the dashboard** (D-011); the REST API is unavailable on trial plans.
- **Monorepo:** `contracts/` (Foundry 1.9, OZ 5.6 via pnpm remappings), `apps/api` (Fastify 5 + tsx, Drizzle; PGlite locally, Postgres in deploy), `apps/web` (Next 16 + Tailwind v4), `packages/shared` (`@vouch/shared`: ABI, EIP-712, deployments, money, chains), `scripts/` (spikes, setup, deploy, streams, agents).
- **Comms (D-009):** every write goes through `python3 scripts/agents/msg.py` (flock-serialized). Agents read their inbox first; QE files bugs to the owner's inbox; producers send handoff packets.

## Done in Phases 0–1 (with evidence)
**Phase 0 — bootstrap + spikes** (PHASE_LOG §Phase 0; QE report `docs/qa/phase-0-qe-gate.md`)
- Repo, `.gitignore` (secrets ignored from the first commit), pnpm workspace, `AGENTS/` from the template, private repo **github.com/christiandiz0n/vouch** (D-007).
- S1 Arc facts ✅ (`docs/evidence/phase-0/research-s1-s3-s4.md`, `research-s1/`).
- S2 Hello deployed ✅ `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32` @ 72567874 (`docs/evidence/phase-0/s2-deploy.log`).
- S4 wallet decided ✅ (D-104).
- S5 relayer on testnet ✅: 7-recipient relayed split, 354,515 gas = $0.0071 (`docs/evidence/phase-0/s5-testnet.log`; one of the 7 amounts was 0, QE-08).
- S6 camera + S6b passkey pages built (`/spike/scan`, `/spike/qr`, `/spike/passkey`). **Phone run pending (human).**
- S3: HMAC webhook, filter, CLI, runbook built; offline QE PASS. **Live stream pending (human, dashboard).**
- Key generation `scripts/setup/gen-env.py` (D-004); demo top-up `pnpm --filter @vouch/scripts topup` (D-401); QE gate Part A done and all QE-01..15 fixed (D-304).

**Phase 1 — contracts + design system** (PHASE_LOG §Phase 1; QE report `docs/qa/phase-1-contracts-qe.md`)
- **Vouch v2 `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` @ 72584790**, Blockscout-verified. v1 `0xfEe6…b2d3` is RETIRED (QE-C-01/02).
- Canonical smoke on chain (v2 pay tx `0x5c6c9e965371a76e36ef440af422d11a67d8c4abd9a1046cf70369006d348a35`): exact split, 409,981 gas = $0.0102. Re-checked by the Orchestrator on Blockscout.
- `forge test`: **176 passed / 0 failed / 2 skipped** (opt-in fork suites; with `VOUCH_FORK=true` they pass 3/3 + 8/8). JS tests: shared 10, scripts 10, api 10. Typecheck clean.
- CONTRACTS_QE: v1 FAIL (2 blockers) → D-012 + fixes D-512..D-518 → v2 PASS-with-findings. The human requirement MSG-003 (receiveWithAuthorization is called only by the payee contract) is proven on the mock, on the fork, and live (`docs/evidence/phase-1/contracts-qe/`).
- Design system v0: tokens, 25 components, `/design` with 13 low-fi screens + money-graph mock (`docs/design/DESIGN_SYSTEM.md`, screenshots `docs/evidence/phase-1/design/`). Orchestrator signed off; **human approval pending (MSG-007, HUMAN_INPUT #11)**.
- S3 switched to dashboard creation (D-011): `docs/streams/S3-RUNBOOK.md`, rendered filter `docs/streams/filter-hello-s3.js`, root `README.md` Streams section.

## Deployed addresses (Arc Testnet)
| What | Address | Block |
|---|---|---|
| **Vouch v2 (production)** | `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` | 72584790 |
| Vouch v1 (retired) | `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3` | 72580272 |
| Hello (S3 spike target) | `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32` | 72567874 |
| Hello (QE re-deploy) | `0xc6282732b1852726F73D7Cea98cE6D03f9021906` | 72569134 |
| USDC | `0x3600000000000000000000000000000000000000` | — |
Wallet public addresses: `packages/shared/src/wallets.public.json`. In code: `VOUCH_ARC_TESTNET` in `packages/shared/src/deployments.ts`.

## Decisions so far (full text in DECISIONS.md)
- **Orchestrator / human:**
  - D-001 monorepo · D-002 placeholder name · D-003 secrets policy · D-004 human-run key gen, agents never read `.env` · D-005 cloudflared quick tunnels · D-006 web on port 3100 (3000 is an unrelated app).
  - D-007 name Vouch · D-008 L2 introducer rule · D-009 comms protocol · D-010 L2 per (customer, venue) confirmed; QN key 403 · D-011 Stream via dashboard.
  - D-012 bind the submitter (QE-C-01) · D-013 QE-C-09 residuals routed.
  - **Session 2 (A5):** D-014 submitter = RELAYER or customer, no `0` path (v3, conditional) · D-015 one production Stream = S3 proof · D-016 Railway API host · D-017 design approved.
- **ARCHITECT research:** D-101 network facts · D-102 decimals · D-103 EIP-3009 payments · D-104 wallet B · D-105 Streams feasible.
- **ARCHITECT scaffold:** D-201 Foundry/OZ via pnpm · D-202 Fastify · D-203 Drizzle + PGlite/Postgres · D-204 shared as TS source · D-205 jsqr/qrcode · D-206 pins (TS 5.9, viem 2.57.18, Next 16.4.6) · D-207 Hello hardening · D-208 EIP-712 v0 · D-209 S1 alignment.
- **STREAMS_INFRA:** D-301 HMAC, fail closed · D-302 filter envelope v1 · D-303 create defaults/token · D-304 QE hardening.
- **ARCHITECT top-up:** D-401 top-up tool.
- **CONTRACTS:**
  - D-501 venue id + relayed owner actions · D-502 fallback rule · D-503 per-referrer frozen-rate slices · D-504 rounding · D-505 intro rules (corrected by D-516) · D-506 griefing.
  - D-507 seed ambassadors · D-508 L2 cycles · D-509 first-purchase semantics · D-510 events v1/size/deploy · D-511 fork precompile shim.
  - D-512 submitter · D-513 payout guard · D-514 zero-amount credit events · D-515 owner nonces · D-516 72 h superseded-terms grace · D-517 gas floor + limits · D-518 v2 redeploy.
- **UI_DESIGN** (pending human approval): D-601 direction · D-602 Instrument Sans · D-603 split-receipt motif · D-604 money display · D-605 copy rules · D-606 placeholder names/dev port 3200.
- **QE:** D-701 test_BUG_ convention · D-702 test_FIXED_ renaming.

## Open human-input items (HUMAN_INPUT.md)
- **#3** production Stream (D-015): waits on the final contract + Railway URL; checklist not issued yet.
- **#4** phone tests on the session-2 web tunnel.
- **#8** Railway account + `railway login` (D-016): blocking #3.
- **#9** LLM provider (Phase 4).
- ✅ #11 design (D-017) · ✅ #12 D-012 (→ D-014, v3 in progress).

## Open inbox messages (none are blockers)
- MSG-007 **closed** (human answers relayed: MSG-043/MSG-044 to UI_DESIGN).
- Session-2 routing: MSG-044 UI_DESIGN (approved + fixes), MSG-045 CONTRACTS (v3), MSG-046 STREAMS_INFRA (one Stream + Railway), MSG-047 BACKEND_RELAYER and MSG-048 FRONTEND_INTEGRATION (D-014 submitter rule), MSG-049 QE_E2E (Part B target).
- Still open from session 1 (Phase 2–3 consumer handoffs): MSG-006, -008, -009, -011, -012, -034..-037, -040, -041. A v3 deploy will supersede MSG-034..-037.
- Live state: `python3 scripts/agents/msg.py list --open`.

## Running processes (session 2; ALL die when this session ends)
| What | Port | Status | Restart command (repo root) |
|---|---|---|---|
| API (Fastify, HMAC webhook) | 4000 | running, /health 200; unsigned POST → 503 secret-unset | `pnpm --filter @vouch/api start` (background task) |
| Web prod server (spikes + `/design`) | 3100 | running, 200 | `cd apps/web && node ./node_modules/next/dist/bin/next start -p 3100`. **Do not touch port 3000.** |
| Web quick tunnel (phone tests only) | — | `https://sophisticated-peaceful-further-spray.trycloudflare.com` (verified 200 via 1.1.1.1) | `cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3100` (QUIC timed out after the laptop slept; http2 is steadier) |
| API quick tunnel | — | **retired** (D-016: the production Stream uses the Railway URL) | — |
- **Verifying a new tunnel:** wait for "Registered tunnel connection". Local DNS may cache NXDOMAIN, so use `dig +short <host> @1.1.1.1` and `curl --resolve <host>:443:<ip> …`.

## Known gotchas
- **`.env` hook:** a PreToolUse hook blocks any Bash that references `.env`, and auto mode denies scripts that read secret values (even a last-4 fingerprint). Never read `.env`. Tools load it themselves (`tsx --env-file-if-exists=../.env` in pnpm scripts; bash wrappers like `scripts/spikes/s2-deploy.sh` that source it internally). When grepping the repo, **exclude `.env`** (I once printed two placeholder lines by accident).
- **QuickNode Streams REST API is blocked on trial plans** (403 Insufficient permissions / AuthenticationError). Create and pause/resume streams **in the dashboard** (D-011). The REST CLI `scripts/streams/streams.ts` is for paid plans only; its `render-filter` subcommand works offline.
- **Quick tunnels are fragile:** they die on network changes, sleep and restarts, and the URL changes every time. The human then has to update the webhook URL in the QuickNode dashboard. Push for an early stable deploy of the api (Railway/Render) in Phase 2.
- **Contract size:** Vouch runtime is 24,036 bytes, **540 bytes under EIP-170**. Any v3 change must be tiny or split into a library.
- **Arc specifics:** maxFeePerGas ≥ 20 gwei; ignore EIP-7708 system Transfer logs from `0xffff…fffe`; `eth_getLogs` ≤ 10,000 blocks; the fork EVM lacks the `0x1800…` precompile (D-511 shim).
- **pnpm 11 `minimumReleaseAge`** blocks packages published within the last day; pin older versions rather than bypassing it.
- **Foundry** is at `~/.foundry/bin` (not on PATH by default).
- **Commit hygiene:** stage only your own paths while agents run (one early commit swept in agents' unfinished files).
- **zsh:** don't rely on `$VAR` word-splitting in loops; use `while read` or functions.
- **Next 16:** `next build` while a `next start` server runs from `.next` can break it; rebuild, then restart the 3100 server.
- `rtk` filters command output; use `rtk proxy <cmd>` for raw output.

## Next up (exact next actions; A5 supersedes the session-1 list)
1. **v3 (D-014):** when CONTRACTS returns, check size margin + test counts yourself, then launch an **independent CONTRACTS_QE** (brief with acceptance criteria, not the builder's summary). On PASS: authorize the redeploy (CONTRACTS: deploy, Blockscout verify, canonical smoke, `@vouch/shared` deployments, handoffs superseding MSG-034/035/036/037), apply INTERFACES, record the deploy block. If v3 doesn't fit or fails: keep v2 and tell the human.
2. **Railway (D-016):** when STREAMS_INFRA returns, verify its tests + simulated start; commit; push. After the human replies "railway ready": `railway init` → `railway add --database postgres` → api service (Dockerfile) → vars (`DATABASE_URL=${{Postgres.DATABASE_URL}}`, `CORS_ORIGINS`) → deploy → `railway domain` → verify `/health` 200 (db.kind=postgres) and unsigned POST → 503. Follow `docs/deploy/RAILWAY.md`.
3. **Production Stream (D-015):** once 1 + 2 are done, render the production filter for the final address/topics and give the human the full dashboard checklist (name, Arc/Testnet, start block = final deploy block, run continuously, latest-block delay, Logs, filter code + expected test output, webhook = Railway URL + `/webhooks/streams`, compression, retries/timeout, where the token is). Human creates it paused, sets `STREAMS_WEBHOOK_SECRET` in Railway Variables + `.env`, replies "stream created <ID>" → redeploy/restart → unsigned/forged → 401 → human activates → verify deliveries in the `stream_deliveries` table / `railway logs` → human pauses → fresh QE_E2E runs **QE Part B** against it.
4. **Phone tests (#4):** wait for the human's S6/S6b results; record in PHASE_LOG + DECISIONS (PRF support).
5. **Wait for "go" on Phase 2.** Then BACKEND_RELAYER ∥ STREAMS_INFRA (derived tables from the production Stream) → QE_E2E + SECURITY_REVIEW. UI_DESIGN fixes (MSG-044) at Phase 3 start.

## Struggles, open questions, known issues
- The QuickNode credits-per-block multiplier for Arc is unknown (human couldn't find it). Stay on the free plan, keep backfills small, pause when idle.
- PRF support on the demo phone is unknown → S6b.
- D-012's `submitter = 0` path (kill-the-backend demo) is front-runnable by design (documented).
- Payouts to system addresses (`0x1800…`, `0xffff…fffe`) are accepted (D-013 residual).

## Time tracking
| Phase | Target | Used | Notes |
|---|---|---|---|
| 0 | 3–4 h | ~3.5 h | S3 live + S6 still pending on the human |
| 1 | 6–8 h | ~2.5 h wall clock | parallel agents; 1 QE fix round |
| 1.5 (A5) | ~1–2 h | in progress | v3 + Railway + production Stream |
Budget: ~40–50 h total to Fri 9:00 AM CST. About 6 h used.

## How to run / test
```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm install && pnpm -r typecheck && pnpm -r --if-present run test
(cd contracts && forge test)                       # 176 pass / 2 skipped
(cd contracts && VOUCH_FORK=true forge test --match-path 'test/**/*Fork*')
pnpm --filter @vouch/scripts smoke:canonical       # on-chain canonical story (spends ~$0.05 gas)
pnpm --filter @vouch/scripts topup --dry-run       # demo wallet top-ups from DEPLOYER
python3 scripts/agents/msg.py list --open          # inbox state
```

## Handoff notes
- Agent IDs are in `AGENT_REGISTRY.md`. They may not be resumable from a new session; if SendMessage fails, launch a fresh agent with a full brief and point it at its role file and inbox.
- Phase reports must include: Status, What was built, Evidence, QE results, Scope changes, Risks, Time check, **🟥 HUMAN INPUT NEEDED** (top, numbered, copy-pasteable), **Comms**, and Proposed next phase.
