# Kudos UI v2: critique of the demo path (before)

Branch `ui-v2`, from main 36f3ce6. Evidence: `docs/evidence/ui-v2/before/` (390x844 and 1440x900, plus 1280x720 for the
dashboard, light and dark; captured with `e2e/ui-v2/shots.mjs`). Method: impeccable critique in Operate mode (the visitor
completes a task, so clarity and consistency outrank expression) plus the unslop-ui rules (U1 to U20) and the copy rules in
`apps/web/src/design/COPY.md`. Unslop counter before: `docs/design/ui-v2-tells-before.json` (55 hits; most are on the
internal /design and /spike pages, not the demo path).

## System-wide

| # | Problem | Evidence | Fix |
|---|---|---|---|
| S1 | Dark-mode primary button is washed out: a pale `#7fa6d6` fill with dark text. It reads as disabled next to the light-text UI. | `01-sign-in-390-dark`, `03-wallet-activity-390-dark`, `05-pay-confirm-390-dark` | Saturated mid blue fill (`#3a74b5`, white text 4.83:1, 3.97:1 against the canvas), lighter hover. Blue text keeps its own AA shade. |
| S2 | Desktop backdrop is a radial blue glow (U17). In dark mode it becomes a bright navy spotlight that fights the dark column. | `05-pay-confirm-1440-dark` | Solid backdrop one step off the canvas, hairline + soft neutral shadow on the column. |
| S3 | Motion uses an overshooting spring (`cubic-bezier(.34,1.56,.64,1)`) on routine UI (U20). | tokens.css `--vx-ease-spring` | One exponential ease-out for the app; the overshoot is kept small and only on the success mark. |
| S4 | Payment success uses a big green check for money *leaving* you (QE F6). Green is reserved for money arriving to a person. | `07-success-390-*` | The "done" mark is brand blue; green stays on "+$0.45 back to you" and on the people who were thanked. |
| S5 | Browser surfaces are unthemed: default selection colour, and scroll containers that Chrome makes focusable get the UA amber outline (QE F5). | `/transparency` math table | Theme `::selection`; a global `:focus-visible` fallback in the brand focus colour; the table scroller gets a name and the focus-ring utility. |
| S6 | Pending amounts are drawn at 80% opacity on top of ink-2, which drops "−$4.50" to 4.27:1 (QE F2). | `03-wallet-activity-390-light` | Pending uses `ink-2` at full opacity (6.9:1); the "Pending" badge carries the state. |

## Per screen

**Sign-in.** Clear headline and one primary, good. "I run a venue" is absolutely positioned and ends up below the fold at 390 and
invisible at 1440; at desktop it was a 20px-tall link (QE F4). The brand mark is a check in a disc, which reads as a success
state. Fix: a header row with the wordmark on the left and "I run a venue" as a 44px link on the right; brand mark becomes a
rounded square; hero card tightened so the name field sits higher.

**Wallet home.** The balance card is good, but the top-up row competes with the balance (a bordered button + a caption on the
same line). The "Liked Lena's café?" card stacks three lines of 13px text next to a button. Fix: balance hero with the earned chip,
top-up as a quiet secondary row under a hairline; the recommend card gets one title and one line; section heading "Recent" at
body size in ink; F2 fixed.

**Scan.** Always-dark camera, calm; no change beyond tokens.

**Pay confirm sheet.** Two blue fills compete: the selected "Ana" chip is solid primary (QE F3) and the confirm button. Fix:
selected chip = soft blue tint + 2px primary ring + check, so the only solid blue is "Confirm with Face ID or fingerprint". The
cashback panel uses a "+" in a disc that looks like an add button; use the arrow-in glyph-free layout (amount carries it).

**Payment success.** Green check for an outgoing payment (S4). The split card, legend and "See who got what" are good. Fix: blue
mark, tighter vertical rhythm, the green chip stays the one green moment.

**Recommend / share.** Readable. The link-ready card stacks six text elements (U4 "Share it, or let a friend scan this from your
screen." restates the buttons). Fix: drop the botsplaining caption; keep the friend/you explanation.

**Venue counter.** "New order" pill above the amount is an eyebrow label (U1). Keypad keys are bare text on canvas, so the
touch targets are invisible. Fix: drop the pill, keys get a surface fill and a pressed state.

**Order QR.** Strong. Uses hard-coded hex colours inside the white QR plate (deliberate: the plate is always white). Paid state
uses green for money arriving to the venue; switched to blue with the rest of S4.

**Venue dashboard (projector, the hero).** The money graph is a small strip in the middle of a big empty card: the SVG is drawn
in a fixed 1280x720 viewBox and scaled down to ~60%, so names are ~13px and amounts/badges ~10px at 1280x720 (QE F1). Feed meta
lines truncate (QE F7). Fix: draw the landscape graph at the card's real pixel size (measured), with a 18px floor for names and
amounts, so 1 unit = 1px on the projector; compact KPI row so the graph card gets the height; feed meta wraps to two lines.

**Transparency.** Reading column is fine. F5 (amber focus outline on the table scroller) fixed by S5.

## Out of scope / kept

- Copy and labels that the e2e scripts select by (see the report) are unchanged.
- No data, API, signing, storage or route changes.
