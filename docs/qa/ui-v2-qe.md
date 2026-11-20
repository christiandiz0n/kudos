# QE_E2E: ui-v2 revamp (Amendment A10), independent pass

- Date: 2026-11-20, run 15:58-16:20 UTC. A coordinator deadline time-boxed the run. Anything not run is listed under NOT RUN.
- Branch under test: `ui-v2` at 38712b9 (built on main 36f3ce6). Preview: https://vouch-ubc-blue.vercel.app
- The preview serves ui-v2: "I run a venue" is a 44px header link at the top of sign-in (y=12 at 390, y=44 at desktop), the title is "Kudos", and the light primary fill is `rgb(64,117,173)` = #4075AD (`preview/verify-preview.json`).
- Prod (read-only comparison): https://vouch-ubc.vercel.app. Both use the API at https://api-production-902bc54c.up.railway.app.
- Every Playwright run was headless. No spend: no payment was relayed (502/202 responses were intercepted), no top-up was pressed, no venue was registered, and venue onboarding "Confirm" was never pressed.
- Evidence: `docs/evidence/ui-v2/qe/`.

## Verdict: PASS-with-findings

There are no Blocker, High or Medium findings. Sign-in, pay confirm, the counter keypad and Show code, the venue dashboard, the primary button in dark mode and the e2e/P4 selector labels all pass. F1-F5 from `ui-blue-qe.md` are fixed, and F6 (the green success mark) is fixed as well. Every finding left is Low or Info.

## Findings

| # | Sev | Finding | One-line repro | Evidence |
|---|-----|---------|----------------|----------|
| V1 | Low (pre-existing) | Dark mode, segmented control "Latest / Everyone": the selected pill (`#141a23`) on its track (`#1b222d`) is about 1.1:1. Only the text colour shows which one is selected: blue `#9bbce4` vs grey `#b4bfcd`. Prod is the same (`#171d26` on `#1f2631`). | `/design/screens/venue-dashboard`, dark scheme | `v2/contrast-venue-dashboard-visitor-dark.png`, `node e2e/ui-v2/qe-v2-seg.mjs --base <origin>` (log in this report's run) |
| V2 | Info | Projector at 1440x900: the money graph now has 18-26px labels, but the graph card still leaves roughly 200px empty above and 150px below the graph. The "Ben paid $12.00" row is visible without scrolling. | `/venue/0x9a40…6289` at 1440x900 | `desktop/projector-lena-1440x900.png` |
| V3 | Info (harness) | `desktop-layout` reports `wideOk=false` for the projector at 1440x900 because the content is 1344px wide and the heuristic caps it at 1220px. A full-bleed projector layout is intentional here, so this is not an app defect. | same | `desktop/desktop-layout.json` |
| V4 | Info (transient, not a finding) | The builder's open item, visitor dashboard contrast. On the **light** mock, staggered fade-ins can be caught mid-animation (for example "Ana" 1.24:1 at 1.2s and "Marco" 2.74:1 at 2.0s). Every text item passes from 3.5s on. **Dark** passes at every sample from 0.3s to 6s. After all finite animations finish (`v2/qe-v2.json`, 98 page/scheme combinations, normal motion), there are 0 failures. This is opacity during the entrance, not a colour problem. | `/design/screens/venue-dashboard-visitor`, normal motion, sampled at 0.3/0.7/1.2/2/3.5/6s | `v2/qe-v2-probe.json` (`visitor`), `v2/visitor-dashboard-{dark,light}-390-6s.png` |
| V5 | Info | The verb "vouch" is still visible in lowercase: "Ana vouched for Lena's café" (intro) and "Buy once to vouch" (recommend-locked). This is the COPY.md wording and not the product name. The repo's own `e2e/kudos/name-check.mjs` only flags capital "Vouch" and passes. | `/design/screens/intro`, `/design/screens/recommend-locked` | `v2/qe-v2.json` (`vouch`), `kudos/` |
| V6 | Info | Pay confirm: the "Skip" text link sits about 16px to the right of the chip row's left edge. This looks like ghost-button padding. It is a cosmetic alignment issue. | `/design/screens/pay-confirm` | `v2/contrast-pay-confirm-dark.png` |
| V8 | Low (pre-existing, harness) | `e2e/phase3/story.mjs:309` clicks "Everyone" with `getByRole("tab")` or `getByRole("button")`. The dashboard `SegmentedControl` renders `role="radio"` (unchanged from main), so the click silently no-ops (`.catch`) and shot l29 stays on "Latest". This does not break the story. `p4-stage.mjs` does not use it. The fix belongs to the script (`getByRole("radio", { name: /Everyone/ })`), not the app. | rendered: tab 0, button 0, radio 1 on the mock and on live Lena | `v2/qe-v2.json` (`selectors`) |
| V7 | Info (harness, same as ui-blue F8) | `check-errors2` e50 "Camera is off" is missing because headless Chromium has no camera, so the app correctly shows "No camera available". The forced-denied case e51 passes ("Camera is off for Kudos"). `desktop-layout` `fixedInColumn=false` on live pay-confirm comes from the transparent scrim. The dialog itself is 460px wide and inside the column. | — | `errors2/`, `desktop/pay-confirm-live-1440x900.png` |

Counts: Blocker 0, High 0, Medium 0, Low 2 (both pre-existing), Info 6.

## F1-F5 (from docs/qa/ui-blue-qe.md), re-verified independently

| ID | Status | How verified |
|----|--------|--------------|
| F1 money graph small on projector | **Fixed** | `graph-size.mjs` at 1280x720. Preview label boxes are 24-35px tall (min 24) with node circles of 80-92px. Prod is 10-15px tall (min 10) with 36-42px circles. The SVG is 764x351. Screenshots show the names and amounts clearly readable. The empty space at 1440x900 is noted as V2. (`logs/graph-preview.log`, `logs/graph-prod.log`) |
| F2 wallet "−$4.50" contrast | **Fixed** | Light mock wallet: "−$4.50" is `#4a5668` on `#f6f8fb` = **6.99:1** (was 4.27), and "Pending" is 6.56:1. (`v2/qe-v2-probe.json` f2, `v2/f2-wallet-mock-light-390.png`) |
| F3 two primaries on confirm | **Fixed** | Selected "Ana" chip: `bg rgb(232,240,249)` soft tint with a `rgb(51,100,155)` border and a check. The only solid #4075AD fill is "Confirm with Face ID or fingerprint". The A9 audit gives primary count 1 in light and dark, and P=1 at 1440 and 1280. (`v2/qe-v2-probe.json` f3, `checks/a9-checks.json`) |
| F4 "I run a venue" target | **Fixed** | Link box 138x44 at 1440x900, 1280x720 and 390x844, in the header. (`v2/qe-v2-probe.json` f4, `v2/f4-sign-in-1440x900.png`) |
| F5 amber focus outline on transparency table | **Fixed** | The table scroller ("Worked example table, scrolls sideways") gets a `#4075ad` ring at 4.52:1 in light and `#8fb3e0` at 8.86:1 in dark. (`checks/a9-checks.json` live-transparency focusRings) |
| (F6 green success mark) | **Fixed** | The success mark is brand blue. Green stays on "+$0.45 back to you" and on the people who were paid. (`v2/contrast-success-dark.png`) |

## What was run (preview)

| Check | Result | Output |
|-------|--------|--------|
| Preview identity and fresh sign-in (`e2e/ui-v2/verify-preview.mjs`) | pass: venue link in the header (44px), primary #4075AD, sign-in lands on /wallet with "Your balance", 0 errors | `preview/` |
| Phase 3 static and route checks at 390x844 (`check-static.mjs --base`), 30 records | pass: every route renders, 0 page errors, 0 banned words, 0 money-format errors, 0 small targets, at most 1 primary per screen. The only console errors are the expected 404/409 responses (unknown intro, 404 page, already-paid). QE-3-02: the keyboard does not cover the input. QE-3-07: blue focus ring. Reduced motion: 0 animations vs 10 with normal motion. | `static/` |
| A9 checks (`qe-a9.mjs --mode checks`), 43 page/scheme combinations | pass: **0 contrast failures**, 0 banned, 0 money, 0 small targets, 0 multi-primary. Every focus ring is in the theme. Primary button text is 4.81:1 (light) and **4.83:1 (dark, white on #3a74b5)**. Lena row "Ben paid $12.00" is visible and hit-testable at 1280x720 and 1440x900. Reduced motion: 0 running animations on all 7 probed URLs. | `checks/` |
| Extended contrast (`e2e/ui-v2/qe-v2.mjs`): live sign-in plus 48 /design mocks, light and dark, normal motion, measured after all finite animations finish | **0 failures in 98 combinations**. Lowest primary-button text is 4.61 (light) and 4.83 (dark). Title "Kudos" everywhere, and no capital "Vouch" anywhere. | `v2/qe-v2.json`, `v2/contrast-*.png` |
| Reduced motion on all 48 mocks at 390 (`qe-v2.mjs`) | pass: **0 running animations** at 600ms and 1300ms on every mock | `v2/qe-v2.json` (`motion`) |
| CLS, normal motion (PerformanceObserver `layout-shift`, buffered, 5-7s after load) | pass: sign-in 0 (390) and 0 (1440). Wallet (signed in) 0 and 0. Lena dashboard 0.0007 (390) and 0.003 (1440). All far below 0.1. | `v2/qe-v2.json` (`cls`) |
| Rendered selectors (`qe-v2.mjs`) | pass: every e2e/P4 label resolves to exactly 1 visible element. Primaries are 56px, links and secondary buttons 44-48px. On live Lena "Ben paid $12.00" is visible. On live /venue/new "Name customers will see" and the Confirm button are present (Confirm not pressed). "Everyone" resolves as role=radio (see V8). | `v2/qe-v2.json` (`selectors`) |
| Error states part 2b (`check-errors2.mjs --base`): relay 502, offline at confirm, reduced-motion pending and settled, camera denied (forced), type the code | pass (e50 is a harness artifact, V7) | `errors2/` |
| Desktop 1440x900 and 1280x720 (`desktop-layout.mjs`), 15 screens each | pass: no horizontal scroll, edges OK, column centred, paragraphs ≤ 67ch, P ≤ 1, 0 small targets. V3 and V7 noted. | `desktop/` |
| Money graph size preview vs prod (`graph-size.mjs`) | F1 fixed | `logs/graph-*.log` |
| Kudos name check (`e2e/kudos/name-check.mjs --base`), 9 screens | PASS: no visible "Vouch", title Kudos | `kudos/` |
| Selector compatibility (source + rendered) | pass, see below | — |
| Scope: `git diff --stat main..ui-v2` | pass: only `apps/web/src/{app,components/ui,design,screens}`, docs and `e2e/ui-v2`. **Nothing** under `apps/api`, `contracts`, `packages`, `apps/web/src/lib` or `apps/web/src/state`. | — |

### Selector compatibility (e2e/phase3/*.mjs and e2e/phase5/p4-stage.mjs, read only)

Every label is present in the ui-v2 source with the same accessible role. Rendered on the preview:
- "Continue with Face ID or fingerprint" and the "first name" label: present on `/` (`static/` s01, `preview/`).
- "I already have an account": present (`static/` s01 text).
- "I run a venue": a link in the header.
- "Confirm with Face ID or fingerprint": the button on pay confirm (live in `errors2` e60/e61, `desktop` pay-confirm-live) and on /venue/new (disabled until named, s30).
- "Save Ben's recommendation": the primary on live `/i/<code>` (s24).
- "Top up (testnet demo)": a button on live /wallet (s20).
- "Name customers will see" and "Minimum first order": labels on live /venue/new (s30, QE-3-02).
- "Show code": `OrderScreens.tsx` (`Show code for $X` / `Show code`).
- "Latest" / "Everyone": `SegmentedControl` options, unchanged component.
- "Make my link", "Try again", "Scan a new code", "Not enough money yet", "didn't go through", keypad "Delete" / "Decimal point" / digits: unchanged in source.

Rendered check (`qe-v2.mjs`): each one resolves to exactly 1 visible element. "Everyone" is `role=radio`, which is pre-existing (V8). The diff of label-bearing lines between main and ui-v2 changes only class names and the position of "I run a venue".

## NOT RUN

- **LIVE PAYMENT STORY on the preview: NOT RUN, deferred.** It needs the human to turn the Stream on, and the demo top-up pool is reserved. Command ready: `node e2e/phase3/story.mjs --base https://vouch-ubc-blue.vercel.app --out docs/evidence/ui-v2/qe/story`
- **`e2e/phase3/check-errors.mjs` (part 1, which includes the live expired-order path).** It registers a venue on chain (spend). The expired, insufficient, failed, cancelled and offline states were covered as /design mocks (contrast and audit, light and dark) and by errors2.
- Visual review was spot-checked on screenshots (sign-in, wallet, pay confirm dark, success dark, visitor dashboard dark, projector). It was not exhaustive.
- WebKit pass, real device and real projector: not re-run.
