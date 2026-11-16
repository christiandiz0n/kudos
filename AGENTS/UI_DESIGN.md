# UI_DESIGN
_Last updated: 2026-11-16 by UI_DESIGN — Phase 1_

## Mission
Owns the visual and interaction design: design tokens, typography, color, motion, core components, screen layouts, copy, and the money graph's visual design. Direction: clean fintech — calm, minimal, one restrained accent, tabular numerals, dollars only on primary screens. Does NOT wire screens to the chain or API (FRONTEND_INTEGRATION does).

## Owned paths
- `apps/web/src/design/` (tokens, theme)
- `apps/web/src/components/ui/`
- `apps/web/src/app/design/` (living design-system route)
- Presentational screen components under `apps/web/src/screens/` (props-only, no data fetching)

## Current status
🟡 Design system v0 built and verified; **waiting for human approval of the direction** (MSG-007) before Phase 3 hi-fi.

## Mental model (read this first)
- **Direction (D-601):** warm "receipt paper" neutrals, ink-black primary buttons, ONE deep green accent reserved for money moving to a person (cashback, rewards, success). Spending is never red.
- **Type (D-602):** Instrument Sans via next/font (`--font-instrument` → `--font-sans`); `money` utility = tabular figures on every amount.
- **Signature (D-603):** `SplitBreakdown`: perforated receipt → bar (venue vs reward slice) → loupe magnifying rewards into people → recipient lines. MoneyGraph continues it (edges ∝ √amount, dashes flow to recipient).
- **Money (D-604):** bigint base units in; `src/design/money.ts` rounds half-up to cents via `@vouch/shared` formatUsd; `precision="exact"` only on transparency.
- **Copy (D-605):** banned technical words on primary screens; only `<Details>` (`data-copy-scope="details"`) and the transparency page may show them. `design:shots` enforces it.
- Tokens are `--vx-*` CSS vars (light / dark media / `[data-theme]`), mapped to Tailwind in `@theme inline`. Avoid `dark:` variants — use tokens (they follow `data-theme` too).
- Components are props-only; screens in `src/screens/` take data + callbacks; `/design` mocks wire them with the canonical story.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `apps/web/src/design/tokens.css` | All tokens, Tailwind theme, keyframes, utilities, reduced-motion | Imported by `app/globals.css` |
| `apps/web/src/design/fonts.ts` | Instrument Sans via next/font | Applied in `app/layout.tsx` |
| `apps/web/src/design/money.ts` | formatMoney / roundToCents / moneyParts / formatBps | bigint only |
| `apps/web/src/design/fixtures.ts` | STORY, STORY_SPLIT, STORY_GRAPH | Marco/Sofia = placeholder L2 names (D-606) |
| `apps/web/src/design/contrast.ts` | WCAG ratio + token parser | Used by /design |
| `apps/web/src/design/COPY.md` | Voice, banned words, approved phrases | |
| `apps/web/src/components/ui/` | 25 components + `index.ts` barrel | Sheet/Slider/Segmented/ChoiceChips/Keypad are client |
| `apps/web/src/screens/{customer,venue,public}/` | 13 props-only screens | Draft until approval |
| `apps/web/src/app/design/` | `/design` living system + `/design/screens/[id]` full-bleed | `_mocks/meta.ts` lists screens |
| `apps/web/scripts/design-shots.ts` | Playwright shots + checks (console errors, banned words, reduced motion, focus) | Writes `docs/evidence/phase-1/design/` |
| `apps/web/scripts/contrast.ts` | Contrast table from tokens.css | exits 1 on failure |
| `docs/design/DESIGN_SYSTEM.md` | 1-page direction + usage | |

## Interfaces consumed / provided
- Consumes `@vouch/shared`: `formatUsd`, `parseUsdc`, `mulBps`, `SPLIT_BPS`, `USDC_UNIT`, `APP_NAME`, Arc constants (transparency mock).
- Provides `@/components/ui` + `src/screens/*` props contracts to FRONTEND_INTEGRATION (handoff MSG-006). MoneyGraph expects data derivable from `PaymentSettled` + `RewardPaid` (viaReferrer → L2 edge).

## Done (rolling, newest first)
- 2026-11-16 — Phase 1 design system v0: tokens (light+dark, AA verified), Instrument Sans, 25 components, 13 screen mocks at 390px + projector dashboard, money graph mock + scale notes, COPY.md, DESIGN_SYSTEM.md, 30 screenshots + checks.json, D-601..D-606, handoff MSG-006, approval question MSG-007.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Human sign-off on direction (MSG-007); apply any redirect to tokens first (everything else follows)
- [ ] Phase 3 hi-fi: error/edge states (expired order, insufficient balance, relayer down, already rewarded, camera denied), loading skeletons per screen
- [ ] Sheet exit animation; money graph live-arrival choreography + 20/60-node network view
- [ ] Transparency page: real contract address once CONTRACTS deploys

## Struggles, open questions, known issues
- Next dev "N" badge overlays mocks; shots hide it via CSS. Suggest `devIndicators: false` (next.config is not UI_DESIGN-owned).
- L2 introducer names (Marco, Sofia) are placeholders, not in the canonical story.
- `/design/screens/<unknown>` streams the not-found UI with HTTP 200 (cacheComponents + Suspense); harmless for a design route.

## How to run / test this area
```bash
pnpm --filter web exec next dev -p 3200      # never 3000 / 3100; never next build/start (3100 = human's phone test)
open http://localhost:3200/design            # or /design/screens/<id>
pnpm --filter web design:contrast            # AA table, exit 1 on failure
pnpm --filter web design:shots               # needs the dev server; writes docs/evidence/phase-1/design/
pnpm --filter web typecheck && pnpm --filter web lint
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/UI_DESIGN.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
