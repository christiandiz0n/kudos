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

### Phase 2 gate status (2026-11-18, end of session 2)
- **Phone tests S6/S6b: PASSED** (human, 2026-11-16).
- **QE Part B attempt 1 (17:05–17:30Z): NOT RUN.** The readiness poll timed out: the Railway relayer secrets weren't applied (`enabled:false`; names absent on the api service), and the Stream wasn't active (0 deliveries). No hosted tx, $0 spent. Guards re-run on 920a042: 7/7 PASS, including the QE-2-01 re-test (evidence: `docs/evidence/phase-2/qe/part-b-*`).
- **Gate verdict: OPEN.**
  - PASS-with-findings on everything verifiable: Part A, the security re-verify, guards.
  - Exit criterion (canonical story through the hosted api settled via the live Stream, with latency) is pending HUMAN_INPUT #13 + #3.
- Local processes stopped. Handoff for the context reset (A6) is written.

## Session 3 — 2026-11-18 ~13:00 ET — Amendment A7 (schedule triage, D-019)
- **State at resume (Orchestrator-verified):** Railway secrets applied (names present; `/relayer/status` enabled:true, reachable:true, lowBalance:false, balance 19.67, budget unused; deployment ce50f9ff 12:43 ET). Stream ACTIVE, catching up (hosted cursor 72,625,258 vs head 72,887,135 at 17:47Z; ~150–170 blocks/s). Current deployment: 12/12 webhook deliveries HTTP 200, 0 non-200; older deployments' HTTP logs are gone, so the 2 dashboard errors are attributed by completeness (Part B independent-derive) rather than by log line.
- **Phase 2 Part B: PASS-with-findings** (fresh QE_E2E, attempt 2). T0 (Stream at head) 18:08:58Z; story 18:15:49–18:16:16Z, inside the box. Canonical pay `0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb` (block 72,890,535) exact on chain (10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108). Relay receipt → verified delivery +0.147 s; SSE `payment.settled` +0.144 s; GET settled +0.296 s; 202 → SSE settled ≈ 1.0 s. All 28 deliveries on ce50f9ff verified/200. Hosted DB == chain 177/177 (141 logs, 9 venues): **no events missing, so the 2 dashboard errors were retried or predate the data.** Finding QE-2-10 (Info): `X-QN-Timestamp` unit still not observable in logs (MSG-106 → STREAMS_INFRA). Hosted guards not re-run (they would broadcast real pays; 7/7 locally on 920a042). Spend 0.044 USDC. Report `docs/qa/phase-2-qe-e2e.md`; evidence `docs/evidence/phase-2/qe/part-b-*`.
- **Phase 2 gate: PASS-with-findings** (exit criterion met).

## Phase 3 (+ visual Phase 4) — Frontend, merged (A7: started without a "go")
### Plan
- Parallel: UI_DESIGN-customer (customer hi-fi + states), UI_DESIGN-venue (venue hi-fi, MoneyGraph v1 w/o self-loop, dashboard + cost/verified customer, transparency), FRONTEND_INTEGRATION (wire to the hosted api + SSE; milestone A = customer pay spine end-to-end), BACKEND_RELAYER (capped `POST/GET /demo/topup`, `GET /venues/:venue/payments` feed; deployed after Part B).
- Ownership split D-019 #2/#3; one shared dev server :3100 (CORS) run by the Orchestrator.
- Targets: FE milestone A ~17:00 ET, B ~19:30, all ~22:00; UI 1–4 by ~19:00, all ~21:00. Phase 3 gate report with 390px screenshots of every screen.
- CUT (A7): AI refinement, eval harness, risk flags, second frontend, friends feed.
### Delegated
| Task | Agent | Status |
|---|---|---|
| Phase 2 Part B | QE_E2E (session 3) | 🟢 |
| Demo top-up + venue feed endpoints | BACKEND_RELAYER (session 3) | 🟢 |
| Customer hi-fi | UI_DESIGN-customer | 🟢 |
| Venue hi-fi + money graph + transparency | UI_DESIGN-venue | 🟢 |
| Wiring | FRONTEND_INTEGRATION | 🟢 |
### Phase 3 gate (2026-11-18 ~14:40 ET)
- Builder evidence: FRONTEND_INTEGRATION live run on the hosted api (pay `0x6ad99748…65be8` relay 0.49 s → settled +0.77 s; referred pay `0xc898e244…695f` exact split; in-app top-up `0x515cc6b8…a3f9` 2.9 s). Orchestrator re-verified: typecheck/lint clean, 0 wallet keys in web code. Committed 5f2d378.
- Independent QE_E2E (`docs/qa/phase-3-qe-gate.md`): static/route + error states **PASS-with-findings** (QE-3-01/02 Medium, 03–08 Low; 0 Blocker/High); **live two-device story NOT RUN: Stream paused** for the whole 45-min window. Script ready: `node e2e/phase3/story.mjs` then `verify-chain.mjs`. Phone checklist `docs/qa/phase-3-phone-checklist.md` (32 steps, needs the Vercel URL).
- **Gate: OPEN** (live story + phone checklist pending). Fix pass launched in parallel: UI_DESIGN (QE-3-01 state, 02, 03, 04, 06, 07 + MSG-096/097/100/101/115) and FRONTEND_INTEGRATION (QE-3-01, 03, 05, 08, manifest, prod-origin readiness).
- Gate report published privately with all 89 screenshots: https://claude.ai/artifact/GqpwDiupiQpdEm7PA2q48k
- Relayer balance 10.53 (top-up funder floor $5) → HUMAN #15 faucet is now urgent.
- **Re-verify (QE, on 3d381e0, 20:33Z):** QE-3-01..08 all FIXED (independent re-checks, 65 screens: 0 banned words / page errors / sub-44px controls). New QE-3-09 (Low): the visitor dashboard still says "to you"; fixed by the Orchestrator (`viewer` prop in Dashboard.tsx), pending QE re-check. **The live story is still NOT RUN: the Stream stayed paused** (fresh probe venue 0xD3Ad…706D not ingested within 109 s). Gate remains OPEN only on the Stream; scripts are ready: `stream-probe-live.mjs` → `story.mjs` → `verify-chain.mjs`.
- **Live story (QE, 03:47Z Thu = 22:47 ET Wed, web 2a8c9ab, hosted api, live Stream): PASS.** Fresh accounts, in-app top-ups, no interception. Ana pay `0xe32df069…e8c3`; Ben referred pay `0x67fd5b7a…dfd7` (block 72,957,389, 321,489 gas = $0.0080) exact on chain: venue 840,000 (incl. 40,000 returned L2) / Ben 50,000 / Ana 110,000 = 1,000,000. Tap→settled 1.35 / 1.45 s; tap→venue counter Paid 1.79 s; projector feed 1.37–1.47 s. QE-3-09 fixed. Evidence `docs/evidence/phase-3/qe/` (l01–l34, 1280 shots l26/l28).
- **Phase 3 gate: PASS** (independent QE; 9/9 findings fixed + re-verified; 0 open). Real-phone checklist pending the human on https://vouch-ubc.vercel.app (D-020).
- Vercel deployed (D-020): https://vouch-ubc.vercel.app; Railway `CORS_ORIGINS` = localhost:3100 + vouch-ubc (verified preflight; omega domain refused).

## Phase 5 (pulled forward, Wed night) — seed
- BACKEND_RELAYER `scripts/seed/demo-seed.ts` (D-812..D-814): 3 venues on the hosted api: Lena's café `0x9a40…6289` (15%), Kiln Bakery `0xDbf2…A494` (12%), Pressed `0x8289…6b4c` (20%); 10 personas + 3 owners; 16 payments $59.70; 42 relayed txs, $0.243 relayer gas; DEPLOYER $12.68. Re-run = no-op. Canonical $12.00 pay `0x83214e73…f980` (block 72,958,157, 494,313 gas) **exact on chain, re-verified by the Orchestrator** (12,000,000 in → 10,200,000 / 450,000 / 693,000 / 297,000 / 252,000 / 108,000). Evidence `docs/evidence/phase-5/seed/`. Keys in gitignored `scripts/seed/.state/` (0 leaks in the diff).
- **Prod regression (QE, overnight, https://vouch-ubc.vercel.app): PASS-with-findings.** Phase 3 checks all pass on production (Chromium 390×844 + WebKit iPhone 14 signed-out); CORS OK from vouch-ubc, refused from omega; counter QR encodes the prod URL; seeded dashboards/feeds/graphs/records match the api; MSG-079 (QE-2-03/04/06/09) 18/18 closed. Findings: P5-01 Low (projector feed shows only the 4 newest → Ben's canonical $12 not visible at Lena's café; MSG-132 → UI_DESIGN), P5-02 Info. **Morning:** after the Stream resumes, run `node e2e/phase3/story.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/phase-5/prod/story` (self-stops if the Stream is not live) + `verify-chain.mjs`. Report `docs/qa/phase-5-prod-regression.md`.

## Session 4: A8 final sprint + A9 blue re-skin (Thu 2026-11-19 23:20 → Fri 00:20 CST)
- **P5-01 fixed on prod** (97808d9): the projector feed scrolls and shows up to 20 rows; Ben's $12.00 is visible at 1440×900 (evidence `docs/evidence/phase-5/prod/p5-01/`).
- **Prod live story PASS** (QE, 23:33–23:52): pays exact on chain, tap→settled ~1.4 s, toast 1.5 s; the Stream had caught up (probe ingested 2.6 s). `docs/qa/phase-5-prod-regression.md` §8.
- **P4 stage built + verified** (`e2e/phase5/p4-stage.mjs`): Lena's Corner `0x1823…5581` 20%, Priya → Ana (Ana's introducer = Priya on chain); Ben's link unused. Findings P5-03 (no "Take an order" on the wide dashboard once it has payments; the counter is tab 2) and P5-04 (the referrer chip briefly shows "A friend"), Low/Info, not routed.
- **Docs:** RECORDING_KIT, SUBMIT_STEPS, final DEVPOST fields, README follow-ups (a)–(c) and the author line; numbers re-verified on chain. Only `<VIDEO_URL>` is open; (d) Mermaid render check pending.
- **Secret scan CLEAN-with-notes** (`docs/qa/pre-public-secret-scan.md`); the repo has been public since Mon; the human said keep public.
- **A9 ui-blue:** theme + customer + venue + desktop layout built (branch `ui-blue`, 4fff109 + QE WIP), preview https://vouch-ubc-blue.vercel.app. Independent QE **stopped unfinished** at the human's shutdown (preview live story txs ok; no verdict). **Decision pending.** Production untouched by A9.
- Headless-only rule (human). Spend tonight: DEPLOYER $34.01 → $25.00; demo top-up pool ~$12 of $30 used (2 story runs).

