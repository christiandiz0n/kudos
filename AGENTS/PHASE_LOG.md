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
- CONTRACTS (session 2): v3 submitter change + size check (running).
- STREAMS_INFRA (session 2): Railway deploy prep (running).
### QE results / gate
_pending_
