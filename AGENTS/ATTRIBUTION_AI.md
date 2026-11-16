# ATTRIBUTION_AI
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns attribution: the baseline scoring rule (link type, opens, recency, customer answer), attributor-key signing of Weights, parity notes vs. the on-chain fallback, optional LLM refinement (strict JSON schema, timeout, fallback, one-line explanation, venue opt-in), the evaluation harness, and risk flags. Does NOT own payment logic or the contract split.

## Owned paths
- `apps/api/src/attribution/`
- `packages/shared/src/attribution/` (pure scoring functions shared by api + eval)
- `scripts/eval/`

## Current status
🟢 on track — not started yet.

## Mental model (read this first)
_Nothing built yet. The first agent to work here rewrites this section._

## Key files map
| Path | What it does | Notes |
|---|---|---|
| — | — | — |

## Interfaces consumed / provided
See `AGENTS/INTERFACES.md`. Relevant sections to be filled as they are defined.

## Done (rolling, newest first)
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Baseline score = linkTypeWeight × (1 + 0.25 × opens) × recencyDecay(half-life 3d); normalize to 10,000 bps
- [ ] Customer 'Who sent you here?' blend (+50% of total weight, renormalize)
- [ ] Enforce contract bounds before signing (max 5, cap 8,000 bps unless single, sum = 10,000)
- [ ] Tier 3: LLM refinement behind provider-agnostic interface
- [ ] Eval harness: 20–30 synthetic scenarios, baseline vs AI, results table
- [ ] Risk flags: reciprocal rings, intro seconds before purchase, bursty one-visit accounts

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
