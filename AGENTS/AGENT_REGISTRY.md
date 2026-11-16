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
| CONTRACTS (session 2) | `a914bc3d449f4f20b` | 1.5 | D-014 v3: remove submitter=0 path, size check, tests (no deploy) | ✅ | option (a) `msg.sender == submitter`; 23,998 B (578 B margin); resumable for the redeploy |
| STREAMS_INFRA (session 2) | `a7d6b022bcb70614d` | 1.5 | D-016 Railway prep: Dockerfile, PORT, raw delivery table, runbook | ✅ | D-305; resumed once after laptop sleep; the Orchestrator deploys after `railway login` |
| CONTRACTS_QE (session 2) | `af2eb2c52e8488e91` | 1.5 | Independent v3 review + QE test re-pins (MSG-050) | 🟢 | verdict gates the v3 redeploy |
