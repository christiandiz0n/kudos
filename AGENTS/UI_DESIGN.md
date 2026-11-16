# UI_DESIGN
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Owns the visual and interaction design: design tokens, typography, color, motion, core components, screen layouts, copy, and the money graph's visual design. Direction: clean fintech — calm, minimal, one restrained accent, tabular numerals, dollars only on primary screens. Does NOT wire screens to the chain or API (FRONTEND_INTEGRATION does).

## Owned paths
- `apps/web/src/design/` (tokens, theme)
- `apps/web/src/components/ui/`
- `apps/web/src/app/design/` (living design-system route)
- Presentational screen components under `apps/web/src/screens/` (props-only, no data fetching)

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
- [ ] Tokens (color, type scale, spacing, radius, shadow, motion), one sans family, tabular numerals
- [ ] Core components: Button, AmountDisplay, Card, ListItem, Sheet, Toast, QRFrame
- [ ] Low-fi layouts of all required screens at 390px, shown at `/design`
- [ ] Orchestrator + human sign-off before hi-fi screens
- [ ] Money graph visual design (projector-readable)

## Struggles, open questions, known issues
_None yet._

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
