# AGENT_REGISTRY — roles → agent instances
_Maintained by ORCHESTRATOR (D-009). One row per launched agent instance. A finished agent can usually be **resumed** with SendMessage using its ID (it keeps its context); a new brief starts fresh._

Status: 🟢 running · ✅ done (resumable) · ⏸ waiting on something · ❌ stopped

| Role | Agent ID | Phase | Task | Status | Notes |
|---|---|---|---|---|---|
| ARCHITECT (research) | `aa5be5e767b502b52` | 0 | S1 Arc facts, S3/S4 desk research | ✅ | D-101..D-105 |
| ARCHITECT (scaffold) | `a11154962d446a497` | 0 | Monorepo, Foundry, Hello, S5 local, S6 pages, INTERFACES v0 | ✅ | D-201..D-209 |
| ARCHITECT (top-up) | `a1d443e17788b2a90` | 0 | `scripts/setup/topup-demo.ts` | ✅ | D-401 |
| STREAMS_INFRA | `a55dd50bb9a376571` | 0 | HMAC webhook, filter, Streams CLI, runbook; QE fixes | ⏸ | waits on a valid QuickNode key (HUMAN_INPUT #3) |
| QE_E2E | `ae51ee4ecd9fe7bb9` | 0 | Phase 0 gate Part A (done); Part B = S3 live from runbook | ⏸ | resume for Part B once the key works |
| CONTRACTS | `ad7b974ed746e5ac4` | 1 | Vouch.sol + tests + Arc deploy/verify + smoke + ABI export + handoffs | 🟢 | launched 2026-11-16 |
| UI_DESIGN | `a22d241dedf389e0f` | 1 | Design system, components, /design route, screen low-fi, screenshots | 🟢 | launched 2026-11-16 |
