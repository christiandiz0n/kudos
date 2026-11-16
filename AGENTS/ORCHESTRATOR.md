# ORCHESTRATOR — HANDOFF
_Last updated: 2026-11-16 ~14:00 ET by ORCHESTRATOR (session 1, before a context reset) — between Phase 1 and Phase 2_

> **New orchestrator session: read in this order:** this file → `AGENTS/ORCHESTRATOR_PROMPT.md` (original prompt + Amendments A1–A4, which override it) → `AGENTS/README.md` (product story + comms protocol) → `AGENTS/HUMAN_INPUT.md` → `AGENTS/INBOX/_INDEX.md` → `AGENTS/PHASE_LOG.md` → `AGENTS/INTERFACES.md` → `AGENTS/DECISIONS.md` (as needed) → `AGENTS/AGENT_REGISTRY.md`.

## Mission
Plan each phase, delegate to subagents with self-contained briefs (template: prompt §5.2, plus the inbox rules), integrate, run **independent** QE, keep `AGENTS/` true to the code, maintain `HUMAN_INPUT.md`, route inbox messages, and **stop at every phase gate** for the human. Never mark a phase done on a builder's word. No gate passes with an open `blocker` message.

## Owned paths
`AGENTS/README.md`, `AGENTS/ORCHESTRATOR.md`, `AGENTS/ORCHESTRATOR_PROMPT.md`, `AGENTS/HUMAN_INPUT.md`, `AGENTS/PHASE_LOG.md`, `AGENTS/AGENT_REGISTRY.md`. The Orchestrator applies changes to `AGENTS/INTERFACES.md`. Also `scripts/agents/msg.py`, `scripts/setup/gen-env.py`, `scripts/spikes/s2-deploy.sh`, the root `README.md` skeleton (DOCS_SUBMISSION takes it over in Phase 6), and `apps/web/src/app/spike/passkey/`.

## Current status
🟡 **Phase 1 gate: contracts PASS; design approval pending.** The human has **not** said "go" for Phase 2 yet. S3 live (Phase 0 leftover) is waiting on the human to create the stream in the QuickNode dashboard, and **the webhook URL I gave them is now dead** (see Running processes). Time used ≈ 6 h of ~40–50; on schedule (target: submit by Fri Nov 20, 9:00 AM CST).

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
  - D-012 bind the submitter (QE-C-01) — **awaiting human confirmation (HUMAN_INPUT #12)** · D-013 QE-C-09 residuals routed.
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
- **#3** S3 stream in the QuickNode dashboard. The webhook URL previously given is **dead**: generate a new one and re-send step 1 of the checklist.
- **#4** phone tests (S6 scan + S6b passkey/PRF). The tunnel URL is dead; give a new one.
- **#7** ✅ cloudflared.
- **#8** hosting accounts (Vercel + Railway/Render) by Phase 2/5. **Recommend doing this now**: quick tunnels keep dying.
- **#9** LLM provider (Phase 4).
- **#11** approve the design direction (6 questions in MSG-007).
- **#12** confirm D-012.

## Open inbox messages (none are blockers)
- **MSG-007** question UI_DESIGN → ORCHESTRATOR: human design approval. Relay the human's answers to UI_DESIGN, then close it.
- **MSG-008** fyi ORCHESTRATOR → UI_DESIGN: sign-off notes (fix the cashback self-loop in MoneyGraph; design the error states).
- Handoffs waiting for Phase 2 consumers:
  - BACKEND_RELAYER: **MSG-009** (v1 flow), **MSG-034** (v2 address + submitter), **MSG-040** (D-013 requirements).
  - STREAMS_INFRA: **MSG-036** (v2 address, start block 72584790, topics unchanged).
  - ATTRIBUTION_AI: **MSG-012** (weights bounds + fallback parity), **MSG-037** (v2 + sybil note).
- Handoffs for Phase 3 consumers: FRONTEND_INTEGRATION **MSG-006** (design handoff), **MSG-011** (what users sign), **MSG-035** (submitter), **MSG-041** (D-013 UI rules).
- Check live state any time: `python3 scripts/agents/msg.py list --open`.

## Running processes (ALL die when session 1 ends)
| What | Port | Status at handoff | Restart command (repo root) |
|---|---|---|---|
| API (Fastify, HMAC webhook) | 4000 | running locally (200) | `pnpm --filter @vouch/api start`; run it as a background task. It loads the root env itself. Restart after `STREAMS_WEBHOOK_SECRET` changes. |
| API quick tunnel | — | **DEAD** ("Tunnel not found", after a network change) | `cloudflared tunnel --no-autoupdate --url http://localhost:4000` → read the `https://*.trycloudflare.com` URL from its output. Webhook = `<url>/webhooks/streams`. |
| Web prod server (spikes + `/design`) | 3100 | running locally (200) | `pnpm --filter web build`, then `cd apps/web && node ./node_modules/next/dist/bin/next start -p 3100`. **Do not touch port 3000** (unrelated app). |
| Web quick tunnel (phone tests) | — | **DEAD** | `cloudflared tunnel --no-autoupdate --url http://localhost:3100` |
- **Verifying a new tunnel:** wait for "Registered tunnel connection" in its output. Local DNS may cache NXDOMAIN for a new hostname, so verify with `dig +short <host> @1.1.1.1` and `curl --resolve <host>:443:<ip> …`. Expected: `/health` → 200; unsigned `POST /webhooks/streams` → 503 `secret-unset` until the token is set, then 401.

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

## Next up (exact next actions)
1. **On resume, before anything else:** start the API (:4000) and both tunnels (commands above) as background tasks. Verify them, then send the human the new webhook URL and phone-test URL (re-issue the S3 checklist from `docs/streams/S3-RUNBOOK.md` with the new webhook URL; all other wizard values are unchanged: name `vouch-s3-hello-spike`, Arc/Testnet, start block **72567874**, run continuously, latest-block delay 0, dataset Logs, filter `docs/streams/filter-hello-s3.js` (copy with `! pbcopy < ~/Desktop/ubc-2026/docs/streams/filter-hello-s3.js`), expected test-filter results: 72567880 → one Ping (tx 0x6a6ad1c2…a3d0, logIndex 4), 72567926 → one Split (tx 0x2de25bf8…8214, logIndex 19), 72567881 → null; destination Webhook, compression none, default retries; create PAUSED; token → `.env` `STREAMS_WEBHOOK_SECRET`; reply "stream created <ID>").
2. **When the human replies "stream created <ID>":** restart the api (loads the token) → confirm unsigned/forged POST → 401 → tell the human to ACTIVATE → watch `pnpm --filter @vouch/scripts streams:deliveries` for the backfilled Ping (72567880) + Split (72567926) as VERIFIED → `pnpm --filter @vouch/scripts streams:ping --hello 0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32` → confirm the live delivery is VERIFIED → tell the human to PAUSE → resume QE_E2E (or launch a fresh QE_E2E if it can't be resumed) for **QE Part B**: reproduce S3 live from the runbook.
3. Relay the human's answers to MSG-007 (design) and #12 (D-012) when they arrive. Close MSG-007.
4. **Wait for "go" on Phase 2.** Then: BACKEND_RELAYER (DB schema, endpoints, relayer with submitter=RELAYER, SSE; inbox MSG-009/034/040) ∥ STREAMS_INFRA (production Stream for Vouch v2 via the **dashboard**, start block 72584790, all 6 core events + the extra events in INTERFACES §4; ingest → derived tables; backfill/replay with a state-hash check; inbox MSG-036) → QE gate: QE_E2E + SECURITY_REVIEW in parallel (CLI canonical story through the api with the DB updated via Streams; replay determinism; secrets/rate limits). Strongly suggest the human creates Railway/Render (#8) so the production Stream gets a stable webhook URL.
5. After each agent returns: route its messages; update AGENT_REGISTRY, PHASE_LOG, HUMAN_INPUT; commit only owned/finished paths.

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
