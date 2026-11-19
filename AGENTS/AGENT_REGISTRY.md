# AGENT_REGISTRY — roles → agent instances
_Maintained by ORCHESTRATOR (D-009). Session-1 rows (above the session-2 rows) are likely not resumable from a new session; launch a fresh agent with a full brief if SendMessage fails._
_One row per launched agent instance. A finished agent can usually be **resumed** with SendMessage using its ID (it keeps its context); a new brief starts fresh._

Status: 🟢 running · ✅ done (resumable) · ⏸ waiting on something · ❌ stopped

| Role | Agent ID | Phase | Task | Status | Notes |
|---|---|---|---|---|---|
| ARCHITECT (research) | `aa5be5e767b502b52` | 0 | S1 Arc facts, S3/S4 desk research | ✅ | D-101..D-105 |
| ARCHITECT (scaffold) | `a11154962d446a497` | 0 | Monorepo, Foundry, Hello, S5 local, S6 pages, INTERFACES v0 | ✅ | D-201..D-209 |
| ARCHITECT (top-up) | `a1d443e17788b2a90` | 0 | `scripts/setup/topup-demo.ts` | ✅ | D-401 |
| STREAMS_INFRA | `a55dd50bb9a376571` | 0 | HMAC webhook, filter, CLI, runbook; QE fixes; dashboard runbook (D-011) | ✅ | S3 live waits on the human creating the dashboard stream; Phase 2 production Stream next (inbox MSG-036) |
| QE_E2E | `ae51ee4ecd9fe7bb9` | 0 | Phase 0 gate Part A ✅; Part B (S3 live from the runbook) pending | ⏸ | run Part B after the stream is live (fresh agent if not resumable) |
| CONTRACTS | `ad7b974ed746e5ac4` | 1 | Vouch v1→v2, tests, deploy/verify, smoke, ABI, handoffs | ✅ | v2 0x9C50…b95f; resumable |
| UI_DESIGN | `a22d241dedf389e0f` | 1 | Design system, components, /design route, screen low-fi, screenshots | ✅ | Orchestrator signed off; human approval pending (MSG-007) |
| CONTRACTS_QE | `aef55c194d7c6021d` | 1 | Adversarial review + MSG-003 + v2 re-verify | ✅ | PASS-with-findings; resumable |
| CONTRACTS (session 2) | `a914bc3d449f4f20b` | 1.5 | D-014 v3: remove submitter=0 path, size check, tests (no deploy) | ✅ | v3 deployed 0xF4B6…f08e @ 72605845 (D-520); smokes exact; resumable |
| STREAMS_INFRA (session 2) | `a7d6b022bcb70614d` | 1.5 | D-016 Railway prep: Dockerfile, PORT, raw delivery table, runbook | ✅ | D-305; resumed once after laptop sleep; the Orchestrator deploys after `railway login` |
| CONTRACTS_QE (session 2) | `af2eb2c52e8488e91` | 1.5 | Independent v3 review + QE test re-pins (MSG-050) | ✅ | PASS-with-findings (QE-C-10/11 info, D-703); resumable |
| BACKEND_RELAYER (session 2) | `a69d2dbd43cef70dd` | 2 | Schema, endpoints, relayer (QE-C-10 terminal, QE-C-11 balance+fee), SSE, story:api CLI | ✅ | D-801..D-810 (incl. security pass + QE-2-01..09 fixes); resumable |
| STREAMS_INFRA (session 2, Phase 2) | `adedd98f81bc90884` | 2 | Ingestion → derived tables, bus/query API, backfill/replay + hash check | ✅ | D-306..D-309 (incl. webhook security pass); committed 920a042; resumable |
| QE_E2E (session 2) | `a238b561112816a7a` | 2 | Phase 2 gate: API vs INTERFACES, determinism, hosted vs chain, story via api (Part A); live hosted story (Part B) | ⏸ | Part A PASS-with-findings; guards 7/7 on 920a042. Part B NOT RUN (2026-11-18 readiness timeout: secrets not applied, Stream idle). Resume with `scripts/qa/story-latency.mjs` (see ORCHESTRATOR.md Next up #3) |
| SECURITY_REVIEW (session 2) | `aac1f528cc681b030` | 2 | Phase 2 gate: secrets history, auth, signatures, relayer drain, webhook, CORS, deps; re-verify | ✅ | BLOCKED (2 High) → fixes 920a042 → re-verify PASS-with-notes; residual N-1..N-5 |
| QE_E2E (session 3) | `adb6390837983a33b` | 2 | Part B: hosted canonical story settled via the live Stream, latency, hosted DB == chain | ✅ PASS-with-findings | 20-min box from Stream at head; ends with "STREAM CAN BE PAUSED" |
| BACKEND_RELAYER (session 3) | `a8bd2d888eaae5cee` | 3 | `POST/GET /demo/topup` (capped, once per wallet), `GET /venues/:venue/payments`, display names on edges | ✅ c6eafcb (not deployed) | no deploy/commit; Orchestrator deploys after Part B |
| UI_DESIGN-customer (session 3) | `a86ee9ce0586cd91d` | 3 | Customer hi-fi screens + states, magnifier | ✅ | owns screens/customer, design/, non-venue components |
| UI_DESIGN-venue (session 3) | `a84858c9dc21f4cb1` | 3 | Venue hi-fi, MoneyGraph v1 (no self-loop), dashboard, transparency | ✅ | owns screens/venue, screens/public, venue components |
| FRONTEND_INTEGRATION (session 3) | `a5fc4ff087c40b30b` | 3 | Wire customer/venue/transparency to hosted api + SSE; phase3-shots | ✅ | milestone A (pay spine) first |
| QE_E2E Phase 3 gate (session 3) | `a8079d2de53c43c45` | 3 | Independent gate: routes, copy, error states, live two-context story, fresh 390px shots, phone checklist | ✅ PASS (live story 03:47Z) | needs the Stream active for the live part |
| UI_DESIGN fix pass (session 3) | `a837480c5cba003aa` | 3 | QE-3 UI findings + Orchestrator polish notes | ✅ | all UI files |
| FRONTEND_INTEGRATION fix pass (session 3) | `a91555c1c5783074b` | 3 | QE-3-01/03/05/08, manifest, prod origin | ✅ | |
| DOCS_SUBMISSION (session 3) | `afe23a4ae4682c5bc` | 6 | README, Devpost, video script, pitch + Q&A, checklist | ✅ e98ab1a | pulled forward to Wed night |
| BACKEND_RELAYER seed (session 3) | `a0f716e0d3312af49` | 5 | scripts/seed/demo-seed.ts: 3 venues, ~10 personas, canonical story | ✅ | hosted api; needs Stream active |
| QE_E2E prod regression (session 3) | `a71b950e29c9c0107` | 5 | Regression on vouch-ubc (no-settle part), seeded dashboards, MSG-079, webkit | ✅ PASS-with-findings | live story Thu AM after Stream resume |
