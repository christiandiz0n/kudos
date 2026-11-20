# ORCHESTRATOR — HANDOFF
_Last updated: 2026-11-20 ~06:10Z (session 4, A8/A9) by ORCHESTRATOR._

> **Session 5 (Fri 2026-11-20 ~09:00 CST) — read first.** Old Stream 6b792277 TERMINATED 00:18 CST (trial credits). New Stream `vouch-v3-production-2` `e77ce7b6-6642-4cd5-9894-7bb8de5c030a` (QuickNode account Rutgers BC, start 73205500; no events missed: last old delivery 73143834, no contract logs in between). ui-blue QE PASS-with-findings → merged (747f41b) + prod deployed. Display name **Kudos** (web-only `apps/web/src/lib/brand.ts`; shared APP_NAME stays 'Vouch' because the API sign-in message uses it). p4-stage uses `rawChromium` (lib forces headless). Prod live story PASS 15:15Z via the new Stream (Ben 0x6894f75b exact). Rollback deployment: vouch-7pejykqtl (pre-merge). Pending: video URL → README/DEVPOST; submit; pause Stream; re-enable Vercel preview protection (`vercel project protection enable vouch --sso`).

> **Session 4 (A8 + A9, Thu 2026-11-19 23:20 CST →) — read this block first; it supersedes the Session 3 block.**
> - **Deadline** Fri 12:00 CST; target submitted by 10:00 CST. A8 priorities: submission → demo-on-video → pitch. A9: blue re-skin on branch `ui-blue` (worktree `../ubc-2026-ui-blue`), preview https://vouch-ubc-blue.vercel.app; the human decides "ship it"/"keep old" ~02:00–02:30 CST. D-021..D-023.
> - **Prod (main):** P5-01 fixed + deployed (97808d9). Prod live story PASS (Thu 23:33–23:52, `docs/qa/phase-5-prod-regression.md` §8). Stream LIVE (caught up). Secret scan CLEAN-with-notes (`docs/qa/pre-public-secret-scan.md`); the repo has been public since Mon (human: keep public).
> - **P4 stage (for the video):** `e2e/phase5/p4-stage.mjs` (`--verify` headless, `--build`, `--present` = headed, HUMAN ONLY). Lena's Corner `0x18235a7735DE0D4dC077E52fE8dBf0fFedc15581` 20%; Priya → Ana chain; Ben's link https://vouch-ubc.vercel.app/i/4gh0y7xmW (single-use). State in gitignored `e2e/phase5/.state/`. Findings to route: P5-03 (no "Take an order" on the wide dashboard once it has payments; the counter is tab 2) and P5-04 (the referrer chip shows "A friend" briefly).
> - **Docs:** README/DEVPOST/SUBMIT_STEPS/RECORDING_KIT committed (cf30d25, 76497e3, 006f298). Author: Christian Dizon, Rutgers University, built solo. Only `<VIDEO_URL>` is open. Kit page https://claude.ai/artifact/N7P16izBQFTPGtFSyFzL8b ; before/after page https://claude.ai/artifact/Ts66ZYY82bXy4GCsx7WPrn (source scratchpad `ba_build.py` + `ba_status.json`).
> - **Infra changes tonight:** Railway `CORS_ORIGINS` += `https://vouch-ubc-blue.vercel.app`; Vercel project SSO protection DISABLED (re-enable after the decision: `vercel project protection enable vouch --sso`). Dev server :3100 now runs from the ui-blue worktree.
> - **Rules:** ALL Playwright headless (human). After 06:00 CST only docs/copy or demo-breaking fixes, verified on prod before and after.
> - **On "ship it":** merge ui-blue → main, deploy prod (`git archive HEAD` → `vercel deploy --prod`), re-run the prod live story + core screens headless, swap README/Devpost screenshots, re-enable protection. **On "keep old":** delete the branch/worktree, re-enable protection.
> - **SHUTDOWN STATE (Fri 00:20 CST, human closed the laptop):** all agents stopped; dev server :3100 stopped; no browsers running. **Production unchanged (current UI, main).** `ui-blue` pushed to origin, NOT merged. **QE on ui-blue is NOT finished:** no `docs/qa/ui-blue-qe.md`; WIP evidence committed on ui-blue (`docs/evidence/ui-blue/qe/`, `e2e/a9/`). The live story on the FIRST preview build (before the desktop layout) ran: Ana `0xd8373c1f…` and Ben `0x0f2beeb1…` status 1 on chain, not yet checked for exact amounts. NOT done: the desktop-layout re-check on the current preview (deployment vouch-6tryrh3x5 = ui-blue 4fff109), the verdict, the compare-page verdict. **Ship/keep decision PENDING (human).** If the human says "ship it" in the morning: finish QE first (resume from the evidence; headless), then merge. Previews stay unprotected until morning (human OK).
> - **P4 recording setup:** built and `--verify`-READY at 23:51 Thu; **Ben's link https://vouch-ubc.vercel.app/i/4gh0y7xmW is UNUSED**. Morning: `node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --verify` (headless, free) → human runs `--present` (headed). DEPLOYER $25 (~3 rebuilds at ~$6). Demo top-up pool: ~$15 left today (UTC) after the two story runs.
> - **Human morning:** ~7:30 confirm the Stream is on; 7:45 6-step phone check; ~8:00 record (kit; run `--verify` then `--present`); ~9:00 video URL; 9:30 submit via SUBMIT_STEPS.md.

> **Session 3 (A7 D-019; updated 2026-11-19 ~04:00Z = Wed 23:00 ET) — read this block first; it supersedes "Current status"/"Next up" below.**
> - **Gates:** Phase 2 PASS-with-findings (Part B). **Phase 3 PASS** (independent QE, live two-device story exact on chain, 9/9 findings fixed). Phase 4 visuals (money graph, cost/verified, transparency) shipped inside Phase 3. Tier 3 CUT.
> - **Deployed:** web **https://vouch-ubc.vercel.app** (D-020, Vercel project `vouch`; the ONLY URL to share/rehearse; omega domain unused). api Railway (D-811 live: /demo/topup enabled, /venues/:v/payments). `CORS_ORIGINS` = localhost:3100 + vouch-ubc. Deploy commands: Railway §Hosted infra; Vercel in D-020.
> - **Seed DONE** (b73af06): Lena's café 0x9a40…6289, Kiln Bakery 0xDbf2…A494, Pressed 0x8289…6b4c; canonical pay 0x83214e73…f980 exact (Orchestrator re-verified). **Docs drafts DONE** (e98ab1a; gas numbers re-verified on chain: canonical Part B 375,553 gas = $0.00856; seeded canonical 0x83214e73 494,313 gas = $0.01236). **Docs follow-ups:** (a) README: add the seeded Lena's café canonical pay (6 distinct payees) next to the Part B one; (b) swap README screenshots for seeded prod shots from docs/evidence/phase-5/prod/ when QE returns; (c) fix `infra/streams/stream-vouch-prod.json` name → `vouch-v3-production` (MSG-130, STREAMS_INFRA); (d) Mermaid render check once public; (e) `<AUTHOR_NAME>`, `<VIDEO_URL>` from the human. **Running:** QE_E2E prod regression (no-settle part; live story Thu AM). On return: verify, commit, push.
> - **Stream:** human told "PAUSE THE STREAM NOW" (Wed ~23:15 ET) after the seed; must RESUME first thing Thursday (then run `e2e/phase3/story.mjs --base https://vouch-ubc.vercel.app`).
> - **Next (no human needed):** (1) QE_E2E regression on the deployed Vercel app (Playwright 390×844, two contexts, seeded venues visible, CORS from vouch-ubc) — A7 Thu PM gate; (2) demo choreography doc `docs/demo/RUNBOOK.md` (judges join via QR → stage venue; fallbacks); (3) kill-the-backend self-submit script + Streams replay demo only if cheap (scripts exist: CONTRACTS self-submit smoke, `streams:verify`); (4) re-test QE-2-03/04/06/09 (MSG-079); (5) DOCS review vs code/chain.
> - **Human (Thu AM):** resume Stream; run the 32-step phone checklist https://claude.ai/artifact/4oWhxvJuPmLU9Ag2D8SJgA on vouch-ubc; create the clean stage venue on prod with their own Face ID; record the video from docs/submission/VIDEO_SCRIPT.md; Fri AM approve making the repo public + submit.
> - Artifacts: Phase 3 gate report https://claude.ai/artifact/GqpwDiupiQpdEm7PA2q48k ; phone checklist above.
> - Shared web dev server `next dev -p 3100` (Orchestrator background task) — dies with the session; restart: `cd apps/web && node ./node_modules/next/dist/bin/next dev -p 3100`.
> - Hand off / ask for a context reset at ~75% context.

> **New orchestrator session: read in this order:**
> 1. this file
> 2. `AGENTS/ORCHESTRATOR_PROMPT.md` (the original prompt + Amendments A1–A6, which override it)
> 3. `AGENTS/README.md` (product story + comms protocol)
> 4. `AGENTS/HUMAN_INPUT.md`
> 5. `AGENTS/INBOX/_INDEX.md`
> 6. `AGENTS/PHASE_LOG.md`
> 7. `AGENTS/INTERFACES.md`
> 8. `AGENTS/DECISIONS.md` (as needed)
> 9. `AGENTS/AGENT_REGISTRY.md`

## Mission
- Plan each phase and delegate to subagents with self-contained briefs (template: prompt §5.2, plus the inbox rules).
- Integrate the results and run **independent** QE.
- Keep `AGENTS/` true to the code, maintain `HUMAN_INPUT.md`, and route inbox messages.
- **Stop at every phase gate** for the human.
- Never mark a phase done on a builder's word, and no gate passes with an open `blocker` message.

## Owned paths
- **Orchestrator files:** `AGENTS/README.md`, `AGENTS/ORCHESTRATOR.md`, `AGENTS/ORCHESTRATOR_PROMPT.md`, `AGENTS/HUMAN_INPUT.md`, `AGENTS/PHASE_LOG.md`, `AGENTS/AGENT_REGISTRY.md`.
- **Applied by the Orchestrator:** changes to `AGENTS/INTERFACES.md`, plus `.env.example`.
- **Scripts:** `scripts/agents/msg.py`, `scripts/setup/gen-env.py`, `scripts/spikes/s2-deploy.sh`.
- **Other:** the root `README.md` skeleton (DOCS_SUBMISSION takes it over in Phase 6) and `apps/web/src/app/spike/passkey/`.

## Current status
🟡 **Phase 2 gate OPEN: everything verifiable passed, and the exit criterion is still unverified.**

**What passed:**
- **Code:** built, security-fixed, committed and deployed to Railway (code commit `920a042`).
- **QE_E2E Part A:** PASS-with-findings. All findings are fixed, and the QE-2-01 fix was re-tested.
- **Guards:** 7/7 on the deployed code.
- **SECURITY_REVIEW re-verify:** PASS-with-notes. It is safe to put the relayer key on Railway.

**What's missing:** QE **Part B**, the canonical story through the **hosted** api, settled from the **live** Stream, with latency measured.
- It was attempted 2026-11-18 at 17:05–17:30Z and **NOT RUN**.
- The Railway secrets weren't applied: `/relayer/status` showed `enabled:false`, and the 4 names were absent from the api service variables.
- The Stream delivered nothing (0 `verified:true` log lines).
- Nothing was spent.

**Phone tests (S6/S6b) PASSED** (human, Mon 2026-11-16).

The human has not said "go" for Phase 3. Time used ≈ 14 h of ~40–50.

## Next up (exact next actions)
1. **Get the human prerequisites** (HUMAN_INPUT #13 + #3). Check them yourself, never printing values:
   ```
   railway variable list --project 3b27e94a-c760-4579-bbca-6212dd8de35f --environment production --service api --json \
     | python3 -c "import json,sys;s=sys.stdin.read();d=json.loads(s[s.index('{'):]);print(sorted(k for k in d if not k.startswith('RAILWAY_')))"
   ```
   - **Expected names:** `RELAYER_PRIVATE_KEY`, `ATTRIBUTOR_PRIVATE_KEY`, `VENUE_SIGNER_PRIVATE_KEY`, `SESSION_SECRET` (alongside the existing ones).
   - **Then:** `curl -s https://api-production-902bc54c.up.railway.app/relayer/status` → `enabled:true, reachable:true, lowBalance:false`.
   - **If the names are missing:** the human most likely left them as **staged changes**. In Railway they need to click "Apply changes"/Deploy on the canvas, on the **`api`** service.
2. **Tell the human to activate the Stream** with "Continue where it left off". The catch-up is about 260k blocks: the hosted DB had events up to ~72.62M, and the head was 72.88M on 2026-11-18. Watch for `"verified":true` with:
   ```
   rtk proxy railway logs --project 3b27e94a-c760-4579-bbca-6212dd8de35f --environment production --service api --lines 300 --filter "streams delivery"
   ```
   Activate it as soon as possible, because the catch-up doesn't need the secrets.
3. **Run QE Part B.** Resume QE_E2E `a238b561112816a7a` if possible; otherwise start a fresh QE_E2E pointed at `AGENTS/QE_E2E.md` and `docs/qa/phase-2-qe-e2e.md`. Its ready-made command:
   ```
   node scripts/qa/story-latency.mjs --api https://api-production-902bc54c.up.railway.app \
     --out docs/evidence/phase-2/qe/part-b-story-latency.ndjson \
     -- --fund-from-payout --require-settled --settle-timeout 120
   ```
   Then run `independent-derive.mjs --hosted --onchain`. The time box is 15 min from readiness.
4. **When Part B reports "STREAM CAN BE PAUSED", tell the human to pause.** Then write the Phase 2 gate report: Status, What was built, Evidence, QE results, Scope changes, Risks, Time check, 🟥 HUMAN INPUT NEEDED, Comms, Proposed next phase. **Stop and wait for "go" on Phase 3.**
5. **Phase 3 kickoff (after "go"):**
   - UI_DESIGN fixes from MSG-044: the magnifier and Ben's cashback self-loop.
   - FRONTEND_INTEGRATION against the v1 API. Inbox: MSG-006/011/041/048/057/073. API changes from the security pass: Bearer-only tokens, `?token=` only on `GET /events/user/:address`, `/relayer/status` has `budget`/`lowBalance` and no `signers`, `ORDER_MIN_USDC` 0.50.
   - The Phase 3 security backlog: see PHASE_LOG "Phase 2 security loop".

## Mental model (read this first)
- **Product:** Vouch (D-007).
  - Pay a local venue in USDC on Arc by scanning a QR.
  - The payment splits atomically: of the reward pool, 25% is cashback, 55% goes to L1 referrers and 20% to L2 introducers; the remainder goes to the venue.
  - Canonical: $12.00 → 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108.
- **Chain:** Arc Testnet, chain 5042002.
  - RPC `https://rpc.testnet.arc.io`; explorer `https://explorer.testnet.arc.io` (Blockscout).
  - USDC `0x3600…0000` is a 6-dec ERC-20, and it is the same balance as the 18-dec native gas.
  - The fee floor is 20 gwei, and there are no reorgs.
- **Payments:**
  - The customer signs a USDC `ReceiveWithAuthorization` whose nonce is hashStruct(PaymentAuth).
  - **v3 rule (D-014/D-519):** `msg.sender == auth.submitter`, and the submitter is RELAYER (the app) or the customer (kill-the-backend self-submit). It is never 0.
  - `OrderAlreadySettled` is terminal, and the split is read from chain (QE-C-10).
  - Self-submit requires balance ≥ amount + gasLimit×maxFee (QE-C-11).
- **Data:** QuickNode Stream `vouch-v3-production` (dashboard, D-011/D-015) → HMAC webhook on Railway → raw `stream_deliveries` → idempotent ingest into `ev_*` derived tables → StreamsPort queries plus an in-process bus → SSE.
  - **All derived state comes from Streams events.**
  - Backfill, live, replay and rebuild all produce the same hash.
- **Hosting:** api + Postgres on Railway (D-016). The web app is local for now, with Vercel planned for Phase 5.
- **Monorepo:**
  - `contracts/`: Foundry.
  - `apps/api`: Fastify 5, Drizzle. PGlite locally, Postgres on Railway. Two migration folders: `drizzle/` and `drizzle-streams/`.
  - `apps/web`: Next 16.
  - `packages/shared`: `@vouch/shared`.
  - `scripts/`: story, backfill, qa, streams, agents.
- **Comms (D-009):** every message goes through `python3 scripts/agents/msg.py`. In zsh, use a function `M(){ python3 scripts/agents/msg.py "$@"; }`, not `$M`.

## Done so far (with evidence)
**Phases 0–1** (details in PHASE_LOG): spikes S1/S2/S4/S5 ✅, design system v0 (approved D-017), contracts v1→v2→**v3**.

**Phase 1.5 (A5, session 2)**
- **v3 deployed:** `0xF4B641dc628de05336aa983B07D5d181254ff08e` @ 72605845, Blockscout-verified, independent CONTRACTS_QE PASS-with-findings (D-519/D-520/D-703).
- **Railway:** `https://api-production-902bc54c.up.railway.app` (D-016).
- **Production Stream:** ID `6b792277-2c66-4c0c-a141-4d452cddfdf8`, backfilled 18 verified deliveries / 48 events. This is the S3 proof (D-015).
- **Phone tests (S6 camera QR + S6b passkey): PASSED** (human, 2026-11-16).

**Phase 2 (session 2)**
- **Build:** relayer API + Streams ingestion (`e90c49d`) → security + QE fixes (`920a042`) → docs and decision commits.
  - BACKEND_RELAYER: D-801..D-810. STREAMS_INFRA: D-305..D-309.
- **Tests:** api 112, scripts 13, shared 10 (all pass); `pnpm -r typecheck` is clean.
- **Story via the api, exact on chain** (local api): canonical pay `0x8f2ea5c0fe009ef083b5048bdc43f8508f6fbd94895527d77f0c4edfc8617168`, settled from Streams.
- **Hosted DB matches chain:** 73/73 checks (72 events, 3 venues).
- **Reports:**
  - QE: `docs/qa/phase-2-qe-e2e.md`, evidence in `docs/evidence/phase-2/qe/`.
  - Security: `docs/qa/phase-2-security-review.md`, evidence in `docs/evidence/phase-2/security/`.
- **D-018:** `TRUST_PROXY=2` on Railway, verified.

## Deployed addresses (Arc Testnet)
| What | Address | Block |
|---|---|---|
| **Vouch v3 (production)** | `0xF4B641dc628de05336aa983B07D5d181254ff08e` | 72605845 |
| Vouch v2 (retired, D-520) | `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` | 72584790 |
| Vouch v1 (retired) | `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3` | 72580272 |
| Hello (S2 spike) | `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32` | 72567874 |
| USDC | `0x3600000000000000000000000000000000000000` | — |

Wallet public addresses are in `packages/shared/src/wallets.public.json`. In code: `VOUCH_ARC_TESTNET` in `packages/shared/src/deployments.ts`.

## Hosted infrastructure
| What | Where | Notes |
|---|---|---|
| **API (Railway)** | `https://api-production-902bc54c.up.railway.app` (PORT 8080) | Project `vouch`, id `3b27e94a-c760-4579-bbca-6212dd8de35f`, env `production`, services `api` + `Postgres`. Postgres has no public networking (A6). |
| Railway variables (names) | `ARC_CHAIN_ID ARC_RPC_URL CORS_ORIGINS DATABASE_URL NODE_ENV PORT STREAMS_WEBHOOK_SECRET TRUST_PROXY USDC_ADDRESS VOUCH_CONTRACT_ADDRESS VOUCH_DEPLOY_BLOCK` | **Missing (human, #13):** `RELAYER_PRIVATE_KEY ATTRIBUTOR_PRIVATE_KEY VENUE_SIGNER_PRIVATE_KEY SESSION_SECRET`. Never print variable values. |
| Stream | QuickNode dashboard, `vouch-v3-production`, `6b792277-2c66-4c0c-a141-4d452cddfdf8` | **PAUSED** (last delivery 2026-11-16). The human activates and pauses it, always with "Continue where it left off". |
| Deploy command | `git archive HEAD \| tar -x -C <scratch>/deploy-head && cd <scratch>/deploy-head && railway up --project 3b27e94a-c760-4579-bbca-6212dd8de35f --environment production --service api --ci` | Always deploy a clean export of the committed HEAD. CLI: `export PATH="$(npm prefix -g)/bin:$PATH"`. |
| Logs | `rtk proxy railway logs --project … --environment production --service api --lines N [--filter "streams delivery"]` | `rtk` truncates; use `rtk proxy`. |

## Running processes
**None.** The local api :4000, web :3100 and the quick tunnel were stopped on 2026-11-18, so only the hosted relayer would hold the relayer key.
- **Restart web (phone tests only):** `cd apps/web && node ./node_modules/next/dist/bin/next start -p 3100`, plus `cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3100`. **Do not touch port 3000.**
- **Do not** run a local api with the real relayer key while the hosted relayer is enabled: the two would clash over transaction nonces.

## Decisions (full text in DECISIONS.md)
- **Session 1:** D-001..D-013 (orchestrator/human), D-101..D-105, D-201..D-209, D-301..D-304, D-401, D-501..D-518, D-601..D-606, D-701/702.
- **Session 2, Orchestrator:** D-014 submitter RELAYER/customer · D-015 one production Stream = S3 · D-016 Railway · D-017 design approved · **D-018 `TRUST_PROXY=2`**.
- **Session 2, agents:**
  - D-519/D-520 v3 + redeploy · D-703 QE-C-10/11 pins.
  - D-305 raw deliveries · D-306 ingest semantics · D-307 compression none · D-308 webhook caps · D-309 webhook rate limit/dedupe/bounded retries.
  - D-801..D-806 API v1 · D-807 logged-out opens excluded · D-808 relayer budget · D-809 security middleware · D-810 QE-2-03..09.

## Open human-input items (HUMAN_INPUT.md)
- **#13** Railway secrets on the `api` service: **not applied**, and they block Part B.
- **#3** activate the Stream for Part B, then pause it.
- **#9** LLM provider (Phase 4).
- ✅ #4 phone tests (passed).

## Inbox
- 0 blockers.
- The open messages are Phase 3–4 consumer handoffs (FRONTEND_INTEGRATION, ATTRIBUTION_AI, DOCS_SUBMISSION) plus answered pairs waiting on the original sender to close.
- Live state: `python3 scripts/agents/msg.py list --open`.

## Known gotchas
- **`.env`:** a hook blocks any Bash that mentions `.env`. Never read it. Tools load it themselves.
- **Railway:**
  - `railway variable list` prints **values**, so always pipe it through a names-only filter.
  - Variable edits made in the dashboard stay **staged** until the human applies or deploys them.
  - `railway.json` (config-as-code) is deprecated but works until 2026-12-01; migrate before then.
  - `railway up <PATH>` fails with "prefix not found", so cd into the export instead.
- **QuickNode:** the Streams REST API is blocked on the trial plan, so the dashboard is the only way to manage Streams. The credits-per-block cost on Arc is unknown, so pause the Stream when idle.
- **Quick tunnels** die on sleep or network changes. Use `--protocol http2`; plain `kill` may not stop them, so use `kill -9`.
- **Auto-mode classifier:** batched SendMessage/Bash calls sometimes return "no verdict". Re-issue them one at a time.
- **Subagent writes:** a safety classifier stopped one write that contained exploit-style detail. Ask security agents for class + fix, no recipes.
- **Arc:** maxFee ≥ 20 gwei; ignore system Transfer logs from `0xffff…fffe`; `eth_getLogs` covers ≤ 10k blocks.
- **Commit hygiene:** stage only owned or verified paths while agents run, and scan diffs for the 9 wallet keys (derive with `cast wallet address`) before pushing.
- **Other paths:** Foundry is at `~/.foundry/bin`. `rtk proxy <cmd>` gives raw output.

## Struggles and known issues
- **Phase 3 security backlog:**
  - N-1: reserve part of the budget for `pay`.
  - N-2: a tighter webhook burst cap.
  - N-4: a reverted relayed pay marks the order `failed`.
  - N-5: a flaky PGlite crash in ingest.test.
  - Unbounded tables.
  - SEC-2-10: the webhook replay window is log-only until the X-QN-Timestamp unit is verified on a live delivery (D-309).
- Payouts to system addresses are accepted (D-013 residual; the human didn't take up the offer to add a check).
- `/venues` lists only venues registered through the api. The 3 on-chain venues registered via CLI/story don't appear (QE-2-07, documented).

## Time tracking
| Phase | Target | Used | Notes |
|---|---|---|---|
| 0 | 3–4 h | ~3.5 h | |
| 1 | 6–8 h | ~2.5 h | |
| 1.5 (A5) | ~1–2 h | ~2 h | v3, Railway, Stream |
| 2 | ~8 h | ~6 h | build + security loop; Part B pending |

Budget: ~40–50 h total, to Fri 9:00 AM CST. About 14 h used.

## How to run / test
```bash
export PATH="$HOME/.foundry/bin:$PATH"
pnpm install && pnpm -r typecheck && pnpm -r --if-present run test   # api 112 · scripts 13 · shared 10
(cd contracts && forge test)
pnpm --filter @vouch/scripts streams:verify       # chain == live == replay == rebuild hash
python3 scripts/agents/msg.py list --open
```

## Handoff notes
- Agent IDs are in `AGENT_REGISTRY.md`. They may not be resumable from a new session. If SendMessage fails, start a fresh agent with a full brief pointing at its role file and inbox.
- Phase reports must include: Status, What was built, Evidence, QE results, Scope changes, Risks, Time check, **🟥 HUMAN INPUT NEEDED** (at the top, numbered, copy-pasteable), **Comms**, and Proposed next phase.
