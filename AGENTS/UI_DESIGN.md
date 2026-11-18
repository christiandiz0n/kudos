# UI_DESIGN
_Last updated: 2026-11-18 by UI_DESIGN — Phase 3 gate fix pass (single instance, owns customer + venue)_

## Mission
Owns the visual and interaction design: design tokens, typography, color, motion, core components, screen layouts, copy, and the money graph's visual design. Direction: clean fintech — calm, minimal, one restrained accent, tabular numerals, dollars only on primary screens. Does NOT wire screens to the chain or API (FRONTEND_INTEGRATION does).

## Owned paths
- `apps/web/src/design/` (tokens, theme)
- `apps/web/src/components/ui/`
- `apps/web/src/app/design/` (living design-system route)
- Presentational screen components under `apps/web/src/screens/` (props-only, no data fetching)

## Current status
🟢 Phase 3 hi-fi built and wired. The QE gate and Orchestrator polish fixes are done (D-615). Direction was approved in D-017. No open requests in the inbox.

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

### Customer (Phase 3)
_UI-customer instance, 2026-11-18. Owns `screens/customer/**`, `design/**`, `components/ui/*` except the venue set (D-019 #2)._
- **Screens (props-only, contract block at the top of each file):** SignIn (name + "Continue with Face ID or fingerprint"), WalletHome (pending/settled rows, loading/offline/empty, labelled demo top-up), Scan (cameraState starting/live/denied/unavailable + manual paste), PayConfirm (`PayConfirmSheet`, quoting, noReward, problem states), `PayProblem.tsx` (D-806 code → state mapping), PaymentSuccess (`status` pending→settled, Details receipt), IntroLanding ("Ana vouched for Lena's café", locked-in terms, 7 states), Recommend (make link with Face ID → QR + share/copy; locked "Buy once to vouch"), Ambassador (owner/visitor, share).
- **Components changed:** SplitBreakdown (grouped ≤3-slice magnifier + `pending`, D-607), SuccessMark (`pending`), EmptyState (`tone`, `role`), ChoiceChips (`quiet` option), Icon (+faceId, camera, cameraOff, wifiOff, clock, lock, qr, pause), Button sm + SegmentedControl → 44px (D-610).
- **/design:** 28 customer ids in `app/design/_mocks/meta.customer.ts`, rendered by `CustomerMocks.tsx` (ScreenMock delegates). Shots: `docs/evidence/phase-3/design/customer/` via `DESIGN_BASE_URL=http://localhost:3100 DESIGN_WHO=Customer DESIGN_OUT=docs/evidence/phase-3/design/customer pnpm --filter web design:shots`.
- **Rules added:** green only after settlement (D-609); every pay error says "Nothing was charged" and offers one way forward (D-608); copy table in COPY.md "Phase 3 customer states".

### Venue (Phase 3)
_UI-venue instance, 2026-11-18. Owns `screens/venue/**`, `screens/public/**`, and MoneyGraph, Slider, Keypad, QrCode, QRFrame, Stat (D-019 #2)._
- **MoneyGraph v1 (D-611/D-612):** `data={venue, flows: MoneyFlow[], names?}`. Each flow is `{paymentId, from, to, level: "venue"|"cashback"|1|2, amount}`, 1:1 with stats `edges` plus one venue flow per payment (`moneyFlowsFromEdges`, `venueFlowsFromPayments`).
  - Fixed tiered layout: venue ← customers → recommenders → introducers. Landscape 1280×720, portrait 360 wide. Highlighted people sit in the column of their role. The tail folds into "N more" (7 per column / 4 per row).
  - Cashback is a "+$0.45 back" badge, never a loop.
  - Arrival choreography is re-keyed on `highlightPaymentId`/`replayKey`. Reduced motion shows the final frame.
  - Pure `layoutMoneyGraph` is exported. v0 props are still accepted.
- **Screens (props-only; contracts in MSG-098):**
  - VenueDashboard: `layout="auto"` = phone <1024, projector ≥1024. States: live, connecting, reconnecting, offline, loading, empty. Shows cost per new customer vs an editable typical ad cost.
  - VenueOnboarding: name, slider with a big-type worked example plus a two-part bar, min order ≥ $0.50 (`validateMinOrder`). Status idle/confirming/saving/error.
  - OrderEntry: `applyOrderKey`, `parseOrderEntry`, optional note.
  - OrderQR: `QRFrameState` = live/processing/refreshing/expired/paid, plus a paid summary.
  - Transparency: computes the exact base-unit split itself (`exactSplit`); v3 address, Blockscout links, six events, Streams.
- **/design:** 25 venue/public ids in `_mocks/meta.venue.ts`, rendered by `_mocks/VenueMocks.tsx`. Seeded networks at 5/20/60 people are in `_mocks/venueFixtures.ts` (the last payment is always Ben's $12.00). The playground is at `/design/money-graph`. `ScreenMock.tsx` is now a dispatcher only.
- **Evidence:** `node --no-warnings scripts/design-shots-venue.ts` (shared :3100) writes 45 PNGs + checks.json to `docs/evidence/phase-3/design/venue/`.
- **Fix-pass evidence:** `FIX_PHASE=before|after node --no-warnings scripts/design-shots-fixes.ts` takes 390×844 *viewport* shots (not full-page, so sticky-footer overlaps stay visible) to `docs/evidence/phase-3/fixes/ui/`. `design-shots.ts` now picks up `who: V` venue ids, and both scripts accept `DESIGN_OUT` (absolute paths are fine), so checks can run into a scratch dir without churning the evidence.
- **Gotcha:** an in-place scripted (python) rewrite of a source file was missed by the :3100 watcher. The result was a stale SSR bundle and a hydration mismatch. A normal editor save fixed it.

## Interfaces consumed / provided
- Consumes `@vouch/shared`: `formatUsd`, `parseUsdc`, `mulBps`, `SPLIT_BPS`, `USDC_UNIT`, `APP_NAME`, Arc constants (transparency mock).
- Provides `@/components/ui` + `src/screens/*` props contracts to FRONTEND_INTEGRATION (handoff MSG-006). MoneyGraph expects data derivable from `PaymentSettled` + `RewardPaid` (viaReferrer → L2 edge).

## Done (rolling, newest first)
- 2026-11-18 — Phase 3 gate fix pass (D-615):
  - **QE-3-02 / MSG-115:** Screen footer is opaque, with a fade + scroll-padding.
  - **QE-3-01:** PayProblem `invalidLink`.
  - **QE-3-03 / MSG-100:** success `noReward`/`minOrder`, the D-509 below-minimum warning, `PayBackdrop`.
  - **MSG-096:** cashback shown once; demo note under the button; 2-line activity titles.
  - **MSG-107:** badge pinned to the node; same-column arcs stay inside the card.
  - **MSG-101:** sub-cent cost guard.
  - **QE-3-04:** "verified first purchases".
  - **QE-3-06:** 44px toast dismiss.
  - **QE-3-07:** single TextField ring.
  - **MSG-119:** dashboard `viewer: "visitor"`.
  - **/design:** 10 new ids. 24 before/after shots in `docs/evidence/phase-3/fixes/ui/`.
  - **Checks:** 57 screens, 0 banned words, 0 targets <44, 0 console errors, focus visible on every first Tab stop.
  - **Messages:** replies MSG-123..127, fyi MSG-128.
- venue: 2026-11-18 — MoneyGraph v1: cashback self-loop removed (MSG-008/044), arrival choreography, 5/20/60 playground. Venue dashboard hi-fi (phone + projector, live/reconnecting/offline/loading/empty). Onboarding (Face ID or fingerprint, ≥ $0.50 minimum). Counter entry + QR (processing/refreshing/expired/paid). Transparency (base units, rounding rule, v3 + Blockscout, events, Streams). 25 /design ids, 45 shots, 0 banned words, 0 console errors, reduced motion + focus pass. D-611..D-614, handoff MSG-098, fyi MSG-099.
- customer: 2026-11-18 — Phase 3 hi-fi customer screens + all error/empty/loading states (28 ids), MSG-044 magnifier (D-607), pending→settled (D-609), recommend/intro/ambassador, design:shots phase-3 mode (0 banned words, 0 console errors, 0 targets <44px), D-607..D-610, handoff MSG-091, fyi MSG-092.
- 2026-11-16 — Phase 1 design system v0: tokens (light+dark, AA verified), Instrument Sans, 25 components, 13 screen mocks at 390px + projector dashboard, money graph mock + scale notes, COPY.md, DESIGN_SYSTEM.md, 30 screenshots + checks.json, D-601..D-606, handoff MSG-006, approval question MSG-007.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Re-check on the deployed app: the opaque Screen footer on iOS Safari (safe area, keyboard open on /venue/new) and the `html:has()` scroll-padding (Safari ≥15.4)
- [ ] If the projector shows dense networks often, consider a larger badge font in landscape (it's 13px at 1280 now)
- [ ] venue: check the live dashboard on the projector against real hosted data (long display names, >5 recommenders, a "Guest N" fallback) once FRONTEND_INTEGRATION's wiring is deployed
- [ ] venue: optional count-up on graph amounts; optional pause when the tab is hidden (the loops are already finite)
- [ ] customer: phone pass on the deployed app (real Face ID prompt timing, sheet height on small phones ~667px, camera denied on iOS Safari)
- [ ] customer: Sheet exit animation; success → recommend hand-off moment
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
