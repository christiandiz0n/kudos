# Vouch design system (v0, Phase 1, awaiting human approval)

Live at `/design` (`pnpm --filter web exec next dev -p 3200` → http://localhost:3200/design). Each screen also opens full-bleed at `/design/screens/<id>` for phone testing. Screenshots are in `docs/evidence/phase-1/design/`.

## Direction: "ink and paper; green means somebody got paid"
Clean fintech, set in a neighbourhood. The neutrals are warm paper tones (`canvas #f6f4ef`, `surface #fff`) with near-black ink text, and the primary buttons are ink too. There is **one accent, a deep green (`#17694f`)**, and it is reserved for money moving to a person: cashback, rewards, the referral flow, success. Primary actions are deliberately *not* green, so green always means "somebody got paid". Warning (amber) and danger (brick) exist only for expiring codes and errors. Spending is never red. Both light and dark are first-class (`prefers-color-scheme`, or force with `data-theme="dark"|"light"` on any element).

## Type: Instrument Sans (one family)
A modern grotesque with slightly narrow, warm proportions, loaded through `next/font/google` as a variable font (400–700 + `wdth`), exposed as `--font-instrument` → `--font-sans`. Why this one: it reads precise enough for payments without the default-template feel of Inter or Geist; its narrow figures keep `$1,234.56` on one line at 390px; and it ships real `tnum` tabular figures (verified in the font's GSUB table). Every amount uses the `money` utility (tnum + lnum). Scale: display 52, title-1 28, title-2 22, title-3 18, body 16, body-sm 14, caption 13 (`text-display`, `text-title-1`, …). Large amounts render with a raised small `$` and small cents (receipt style).

## Signature motif: the split receipt
`<SplitBreakdown>` draws each payment as a perforated receipt. A bar splits the total into the venue's share (warm gray) and a green reward slice, and a **loupe** (a trapezoid) magnifies that slice to full width, cut into one segment per person (one hue, stepped lighter). Below that sits one receipt line per recipient: face, plain-words reason, dotted leader, amount. It appears in the pay sheet (`bar`), on success (`receipt`, with "You" highlighted), in venue onboarding (live while the slider moves) and on the transparency page (`precision="exact"`, $0.693). The money graph continues the motif at venue scale: edge width is proportional to √amount, the venue edge is neutral, the reward edges are green, and dashes flow toward the person being paid.

## Tokens (`apps/web/src/design/tokens.css`)
CSS variables `--vx-*` (light, dark media, and `[data-theme]` blocks), mapped to Tailwind v4 via `@theme inline`: colors `bg-canvas bg-surface bg-surface-2/3 border-line border-line-strong text-ink text-ink-2 text-ink-3 bg-accent text-accent-ink bg-accent-soft accent-2..4 warning* danger*`; radius `xs 6 · sm 10 · md 14 · lg 20 · xl 28`; `shadow-1/2/3`; easing `ease-out / ease-in-out / ease-spring`; durations `--vx-dur-instant 90 · fast 160 · base 240 · slow 360 · celebrate 640 · flow 2400ms`; animations `animate-vx-fade-in / rise-in / sheet-in / pop / shimmer / spin`; utilities `money`, `focus-ring`, `perforated-top/bottom`. Layout: 4px grid, `--vx-gutter 20px`, `--vx-tap 48px` minimum (keypad 64px). **Reduced motion:** all durations collapse to 1ms, the flow and ripple stop, and the check renders already drawn (verified by the shots script).

## Contrast (WCAG 2.2 AA). Checked by `pnpm --filter web design:contrast`, also shown live on /design
| Pair | Min | Light | Dark |
|---|---|---|---|
| ink / canvas · surface | 4.5 | 15.97 · 17.55 | 16.74 · 15.28 |
| ink-2 / canvas · surface · accent-soft | 4.5 | 7.13 · 7.83 · 6.62 | 10.13 · 9.24 · 7.31 |
| ink-3 / canvas · surface · surface-2 | 4.5 | 5.31 · 5.83 · 4.90 | 6.79 · 6.20 · 5.57 |
| on-ink / ink (primary button) | 4.5 | 16.82 | 16.74 |
| accent-ink / canvas · surface · accent-soft | 4.5 | 7.76 · 8.53 · 7.21 | 10.43 · 9.52 · 7.53 |
| on-accent / accent | 4.5 | 6.62 | 8.63 |
| warning-ink / warning-soft · surface | 4.5 | 6.38 · 7.27 | 8.64 · 10.28 |
| danger-ink / danger-soft · surface | 4.5 | 6.58 · 7.77 | 7.39 · 8.13 |
| on-danger / danger | 4.5 | 6.57 | 7.72 |
| line-strong / surface (input border) | 3 | 3.55 | 3.83 |
| focus / canvas · surface | 3 | 6.03 · 6.62 | 10.43 · 9.52 |

## How Phase 3 should use it
- **Import from `@/components/ui`.** Components are props-only: AmountDisplay, Avatar/AvatarStack, Badge, Button/IconButton/`buttonClasses`, Card, ChoiceChips, Details/DetailRow, EmptyState, Icon, Keypad, List/ListItem, MoneyGraph, QrCode, QRFrame, Screen/AppBar/SectionLabel, SegmentedControl, Sheet/SheetPanel, Skeleton/SkeletonRow, Slider, SplitBreakdown, Stat, SuccessMark, TextField, Toast/ToastViewport.
- **Money is `bigint` base units.** Pass bigints straight to `<AmountDisplay value>` and `<SplitBreakdown parts>`. For strings, use `formatMoney()` from `@/design/money`, which wraps `@vouch/shared` `formatUsd` and adds half-up cent rounding. No floats.
- **Screens live in `src/screens/`** (customer, venue, public). They take data and callbacks only, and route files under `src/app/` wire them up. The pay sheet is `<Sheet open title="Confirm payment" footer={<PayConfirmFooter/>}><PayConfirmContent/></Sheet>`.
- **One primary (ink) Button per screen**, in `<Screen footer>` (the thumb zone). Use `variant="accent"` only for money moments, and rarely.
- **Technical facts go only in `<Details>`** or on `/transparency`. Follow `src/design/COPY.md`. `design:shots` fails if banned words appear in the screen mocks.
- **Timers belong to the caller.** QRFrame takes `secondsLeft`/`totalSeconds`, and Toast placement and queueing are up to the caller. Call `navigator.vibrate?.(12)` alongside `<SuccessMark>`.

## Money graph at scale (design notes; the /design #money-graph section has the full text)
- **5 nodes:** a single payment, with fixed positions and edges that draw outward in payout order (120ms stagger). Dashes flow for 3 loops, then stop.
- **20 nodes:** a network view with the venue at the centre and two rings (recommenders on the inner ring, customers on the outer). Only the latest path is green and animated; history sits at 40%. Only the top 5 are labelled.
- **60 nodes:** people with one connection collapse into "Ana + 9" clusters, with at most about 25 rendered nodes. A ranking sidebar carries the detail.
- **Projector:** labels are at least 20px at 1080p, nothing relies on colour alone, and the animation pauses when the tab is hidden.
