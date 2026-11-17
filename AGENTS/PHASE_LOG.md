# PHASE_LOG

## Phase 0
_Bootstrap, verification spikes, human setup — started 2026-11-15 ~21:30 ET, target ~3–4h_

### Plan
1. Repo skeleton, git, `.gitignore`, pnpm workspace, `AGENTS/` initialized, `HUMAN_INPUT.md` populated. (ORCHESTRATOR)
2. Spikes:
   - **S1** Arc network facts — desk research + live RPC reads (no key needed). (ARCHITECT/research)
   - **S2** Hello contract — write + local tests now; deploy needs funded key (human).
   - **S3** Streams — desk research now (Arc availability, filter function format, webhook payload, backfill); live test needs QuickNode account + public URL (human).
   - **S4** Wallet approach — desk research on Circle Modular Wallets / passkeys on Arc testnet; decide or adopt fallback.
   - **S5** Relayer — script written now; run needs funded relayer key.
   - **S6** Mobile camera — bare HTTPS page; human runs on phone.
3. INTERFACES.md v0 draft.

### Delegated tasks
| Task | Agent | Status |
|---|---|---|
| S1 Arc facts + S3/S4 research | ARCHITECT (research instance) | ✅ done: D-101..D-105, `docs/evidence/phase-0/research-s1-s3-s4.md` |
| Scaffold workspace + Foundry + Hello + S5 local + S6 pages + INTERFACES v0 | ARCHITECT (scaffold instance) | ✅ done: commit `0cf41c5`, D-201..D-209, `docs/evidence/phase-0/scaffold.md` |
| S6b passkey/PRF probe page `/spike/passkey` | ORCHESTRATOR (small spike) | ✅ built; phone run pending the human |
| Key generation script `scripts/setup/gen-env.py` | ORCHESTRATOR | ✅ tested on a throwaway copy; the human runs it (D-004) |

### Spike outcomes
| Spike | Outcome |
|---|---|
| S1 Arc facts | ✅ PASS, all verified live/docs. Surprises: canonical domains are now arc.io; block time ~0.70 s; base-fee floor 20 gwei. USDC `0x3600…` supports permit **and** EIP-3009 → D-103 |
| S2 Hello contract | ✅ PASS: deployed `0x66cb…2B32` @ block 72567874, ping confirmed on the explorer; QE reproduced it with a fresh deploy |
| S3 Streams | 🟡 HMAC webhook + filter + CLI + runbook built; offline QE PASS (real Arc logs, real server). **Live Stream blocked: QuickNode rejects the API key (403)**, HUMAN #3 |
| S4 Wallet | ✅ DECIDED: option B, passkey-gated local EOA + relayer (D-104). Circle Modular Wallets work on Arc but need ERC-1271/deployed accounts → deferred |
| S5 Relayer | ✅ PASS on testnet: relayed split tx `0x2de25bf8…8214`, 354,515 gas = **$0.0071** paid by the relayer, exact sum (QE-08: one of the 7 amounts was 0, so effectively 6 funded recipients). Anvil: 234,686 gas |
| S6 Camera + S6b passkey | 🟡 pages live over HTTPS tunnel; **phone run waits on the human** (HUMAN #4) |

### QE results
- Orchestrator independent spot-check (not the builder): `forge test` 11/11, `pnpm -r typecheck` clean; `cast chain-id` = 5042002; USDC `decimals()` = 6; `DOMAIN_SEPARATOR` = `0x3611…c6b0` (matches the research).
- **Formal QE gate, Part A (2026-11-16, fresh QE_E2E agent, written steps only):** S1 **PASS** (every live row reproduced). S2 **PASS-with-defects** (fresh deploy `0xc628…1906` reproduced + Blockscout-verified; S5 tx re-audited and matches the log). S3-offline **PASS-with-defects** (filter on real Arc logs 10/10; HMAC on a running server 200/401/401/400 as specified). Testnet spend $0.0176. Report: `docs/qa/phase-0-qe-gate.md`.
  - Defects: 2 major (QE-01 `eventName`/`event` mismatch; QE-02 ping target only from the env file), 10 minor, 3 info, 0 blockers.
  - Fixes: INTERFACES (QE-01/10/11) and ARCHITECT/PHASE_LOG (QE-03/08/09) by the ORCHESTRATOR; code/runbook (QE-02/04/05/06/07/12/15) routed to STREAMS_INFRA.
- **QE gate Part B (S3 live from the runbook): pending** a valid QuickNode key (HUMAN #3).

### Gate outcome
**PARTIAL.** Everything that doesn't need the human is done. S2/S3/S5 testnet runs + S6 phone + the QE gate are pending human input. Phase 1 must not start until the human says go.

## Phase 1
_Started 2026-11-16 on the human's "go". Target ~6–8 h._
### Plan
1. Comms system first (D-009) ✅
2. Parallel: **CONTRACTS** (Vouch.sol, tests incl. fuzz/invariants, fork test, Arc deploy + Blockscout verify, testnet canonical smoke, ABI/eip712/deployments export, handoff packets) and **UI_DESIGN** (tokens, components, `/design`, low-fi screens, money-graph spec, copy guide, screenshots).
3. Then **CONTRACTS_QE**, independent: adversarial review + the human-required receiveWithAuthorization payee tests (MSG-003). Bugs go to the CONTRACTS inbox.
4. In parallel: S3 live + QE Part B. **Blocked**: the second QuickNode key also returns 403 (D-010). Stopped per the human; escalated.
### Delegated tasks
| Task | Agent | Status |
|---|---|---|
| Vouch contract → testnet | CONTRACTS | ✅ 85 tests; deployed + verified `0xfEe6…b2d3` @ 72580272; canonical smoke exact on chain (Orchestrator re-verified on Blockscout) |
| Design system | UI_DESIGN | ✅ Orchestrator sign-off; human approval pending (MSG-007) |
| Adversarial review | CONTRACTS_QE | ✅ v1 FAIL (2 blockers) → fixes → v2 PASS-with-findings; MSG-003 PASS |
### Human requirements recorded in advance
- CONTRACTS_QE must explicitly test that USDC `receiveWithAuthorization` is called by the payee contract (see CONTRACTS_QE.md Next up, D-103).
- L2 introducer rule approved (D-008): top-weight L1 referrer of the first purchase, frozen per (customer, venue).

### QE results
- CONTRACTS_QE on v1: **FAIL**, with blockers QE-C-01 (front-run forces the fallback, MSG-014) and QE-C-02 (payout = Vouch strands funds, MSG-015), plus 6 low/info findings. MSG-003 PASS.
- The Orchestrator decided D-012 (bind the submitter). CONTRACTS fixed C-01..C-08 (D-512..D-517) and redeployed **v2 `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` @ 72584790** (Blockscout-verified; smoke on chain exact; the Orchestrator re-checked the token transfers).
- CONTRACTS_QE re-verified v2: **PASS-with-findings**. All 8 findings closed; QE-C-09 residuals routed per D-013. The live bytecode is byte-identical to the reviewed source.
- Final counts (re-run by the Orchestrator): `forge test` **176 passed / 0 failed / 2 skipped (fork, opt-in)**; fork suites 3/3 + 8/8 (QE run); JS tests shared 10, scripts 10, api 10; typecheck clean.
- UI_DESIGN: Orchestrator sign-off; **human approval pending (MSG-007)**.

### Gate outcome
**PASS (contracts). Design approval pending from the human.** No open blockers (`msg.py list --open` shows only handoffs/fyi for Phase 2–3 consumers, plus MSG-007 to the human).

## Session handoff — 2026-11-16 ~14:00 ET
- Orchestrator context reset requested by the human. Full handoff in `AGENTS/ORCHESTRATOR.md`; original prompt + amendments A1–A4 in `AGENTS/ORCHESTRATOR_PROMPT.md`.
- State: Phase 1 gate PASS (contracts), design approval pending; Phase 2 NOT started (waiting for "go").
- Phase 0 leftovers: S3 live (dashboard stream by the human; previous webhook URL dead), S6/S6b phone tests, QE Part B.
- Both quick tunnels were dead at handoff (network change). Local api :4000 and web :3100 were up but die with the session.

## Phase 1.5 — A5 follow-ups (session 2, 2026-11-16) — before Phase 2 "go"
### Plan (Amendment A5, decisions D-014..D-017)
1. **v3 submitter rule (D-014):** CONTRACTS removes the `submitter = 0` path (size check, tests, no deploy) → independent CONTRACTS_QE → Orchestrator authorizes redeploy → `@vouch/shared`, INTERFACES, consumer handoffs. Conditional on EIP-170 + invariants green; otherwise keep v2 and tell the human.
2. **Stable API host (D-016):** STREAMS_INFRA prepares Railway (Dockerfile, `PORT`, raw `stream_deliveries` table, runbook `docs/deploy/RAILWAY.md`); the human creates the Railway account + `railway login`; the Orchestrator deploys and verifies.
3. **One production Stream (D-015):** after 1 + 2, the human creates it in the dashboard from the Orchestrator's checklist (start block = final deploy block). Then QE Part B verifies S3 against it.
4. **Design approved (D-017):** relayed to UI_DESIGN (MSG-044); MSG-007 closed. Fixes (Ben's cashback self-loop, error states) land at Phase 3 start.
5. **Phone tests:** web :3100 + fresh quick tunnel up for the human (HUMAN_INPUT #4).
### Delegated
- CONTRACTS (session 2): v3 submitter change ✅ option (a) `msg.sender == auth.submitter` (D-519). Orchestrator re-ran: Vouch runtime **23,998 B (578 B margin)**; `forge test` 179 pass / 2 fail (QE-owned v2 pins in QeV2Reattack, expected) / 2 skipped.
- CONTRACTS_QE (session 2): independent v3 review **PASS-with-findings** (QE-C-10 order not bound to a submitter → relayer treats OrderAlreadySettled as terminal; QE-C-11 self-submit fee pre-check + stale wording; both Info). Mutation check: v2 rule / option (b) / deleted check all caught. Orchestrator re-ran: `forge test` **197 pass / 0 fail / 2 skipped**. Committed 5caef11 (not deployed).
- CONTRACTS (session 2): **v3 deployed `0xF4B641dc628de05336aa983B07D5d181254ff08e` @ 72605845**, Blockscout-verified; relayed smoke 0x95cbda97…673e (409,801 gas) + self-submit smoke 0xfca0e1ae…c7be (371,065 gas), exact split. Orchestrator re-checked on chain: receipts status 1, code 23,998 B, keccak = QE pin.
- ORCHESTRATOR: api on Railway `https://api-production-902bc54c.up.railway.app` (/health db=postgres; unsigned POST 503 secret-unset; delivery log lines visible). Production filter rendered → `docs/streams/filter-vouch.js`.
- STREAMS_INFRA (session 2): Railway prep ✅ (D-305): Dockerfile (prod-only filtered install), `.dockerignore` (.env* excluded), `railway.json`, `PORT`, `stream_deliveries` table (verified rows only; 500 persist-failed → QuickNode retries), `streams:deliveries --db`, `docs/deploy/RAILWAY.md`, runbook §P. Orchestrator re-ran: typecheck clean; tests shared 10, scripts 13, api 19, 0 fail. Live check = the Railway deploy smoke (health 200 db=postgres, unsigned POST 503/401).
### QE results / gate
_pending_

## Phase 2 — Backend, relayer, Streams pipeline (human said "go", session 2, 2026-11-16)
### Plan
- BACKEND_RELAYER ∥ STREAMS_INFRA, started without waiting for the Stream (human instruction). Ownership split inside apps/api: STREAMS_INFRA = src/streams/**, routes/webhooks.ts, drizzle-streams/ (own migrations table); BACKEND_RELAYER = the rest (own drizzle/ journal). They agree the query/bus API via inbox.
- Human-required rules: QE-C-10 (`OrderAlreadySettled` terminal; split read from PaymentSettled), QE-C-11 (balance ≥ amount, + gasLimit × maxFee for self-submit).
- Human in parallel: production Stream (HUMAN_INPUT #3).
- Gate: QE_E2E + SECURITY_REVIEW in parallel, independent (CLI canonical story through the api with the DB updated via Streams; replay determinism; secrets/rate limits/CORS).
### Delegated
- STREAMS_INFRA ✅ (D-306, D-307): `ev_*` derived tables in their own migrations folder; idempotent (tx, logIndex) ingest after the raw row; a failed ingest answers 200 and is retried from `stream_deliveries`; StreamsPort queries + bus (agreed with BACKEND_RELAYER, MSG-062/063); `streams:verify` on real v3 data: chain-backfill == live == replay == rebuild (hash `0b0c880d…5c1f34`, 48 events, 6 payments, 22 rewards). Orchestrator re-ran: typecheck clean, api 43/0 (incl. BACKEND_RELAYER WIP). Commit/deploy held until BACKEND_RELAYER returns (shared app.ts).
- **S3 live (D-015) ✅ backfill:** production Stream `vouch-v3-production` (ID `6b792277-2c66-4c0c-a141-4d452cddfdf8`) delivered **18 HMAC-verified batches, all 200, 48 events** (blocks 72606007…72606174), exactly matching `cast logs` for v3; raw rows in Railway Postgres `stream_deliveries` (evidence `docs/evidence/phase-2/stream-backfill-railway-logs.txt`). Derived state from these rows comes after the Phase 2 deploy (`streams:replay` / `streams:verify --db`). Live (post-backfill) delivery is proven in the Phase 2 QE gate.
- BACKEND_RELAYER ✅ (D-801..D-806): schema (10 app tables), auth, venues/owner actions, orders, intros, quote/pay, serialized relayer (nonce mgmt, fee bump, gas/fee caps, rate limits), SSE, `story:api`. Local story via api on Arc: canonical pay `0x4660d5bb…3da06` (block 72613599, from RELAYER, exact split; Orchestrator checked the receipt). Settled-via-live-Stream step pending (needs Railway secrets + active Stream).
- ORCHESTRATOR: secret scan of the Phase 2 diff (367 64-hex strings → derived addresses vs the 9 real wallets: 0 leaks). Committed e90c49d; Railway redeployed from a clean HEAD export: /health db=postgres; boot `ingestPending` rebuilt derived state from the 18 stored Stream deliveries (`/venues/0xf315…2005/stats`: 3 verified, 3 payments, gross $14.00, rewards $2.07, cost/verified $0.69). Relayer disabled on Railway until secrets are set. INTERFACES §5 v1, §6 ingestion, §7 env applied.
### QE gate (Phase 2)
- QE_E2E + SECURITY_REVIEW launched in parallel (independent).

### Phase 2 security loop (2026-11-17)
- The SECURITY_REVIEW found 2 High (SEC-2-01 webhook decode-before-auth / no caps; SEC-2-02 no relayer spend budget), 4 Med and 7 Low. QE Part A found QE-2-01 (Med, a non-atomic intent claim) plus several Lows.
- The fixes are in 920a042 (STREAMS_INFRA D-308/D-309; BACKEND_RELAYER D-807..D-810), and Railway was redeployed from a clean HEAD. D-018 sets `TRUST_PROXY=2` on Railway.
- Re-verify: **PASS-with-notes**. SEC-2-01..13 are FIXED, except SEC-2-10, which is PARTIAL (the timestamp window is log-only per D-309d). It is now safe to set the hosted relayer secrets.
- Phase 3 backlog:
  - N-1: reserve part of the budget for `pay`.
  - N-2: a tighter webhook burst/raw cap.
  - N-4: a reverted relayed pay marks the order `failed` (display only).
  - N-5: a one-off PGlite V8 crash in ingest.test (flaky, environmental).
  - Unbounded tables.
