# QE_E2E: ui-blue re-skin (Amendment A9), independent pass

- Date: 2026-11-20, run 14:50-15:05 UTC
- Branch under test: `ui-blue` (UI code at 4fff109 "desktop framing")
- Preview: https://vouch-ubc-blue.vercel.app. `vercel inspect` resolves it to `vouch-6tryrh3x5-…` (dpl_3k3naCYtscrGBzKXxweVwMvgR7nU, target preview, Ready, created 2026-11-20 06:07 UTC). The desktop-framing feature is live: at 1440x900 every customer screen renders as a centred column about 460px wide (`desktop/desktop-layout.json`, `columnOk: true`).
- Before (read-only): https://vouch-ubc.vercel.app. API for both: https://api-production-902bc54c.up.railway.app
- Every Playwright run was headless. No spend: no payment was relayed, no top-up was claimed, no venue was registered.

## Verdict: PASS-with-findings

There are no Blocker or High findings. The theme, routes, error states, 390px layout, desktop framing, reduced motion, focus rings, banned-word rule and the Lena projector $12.00 row all pass. The two on-chain payments from the preview story are exact.

The two Medium findings should be fixed before the video if there is time. Neither one breaks a flow:
- the money graph is smaller on the projector than it is on production;
- one money amount on the wallet misses WCAG AA contrast by a small margin.

## Findings

| # | Sev | Finding | One-line repro | Evidence |
|---|-----|---------|----------------|----------|
| F1 | Medium | The money graph on the projector shrank compared with prod, which works against A9's "money graph as the hero" and projector readability. At 1280x720 the smallest label is 10px (prod 13px), names and amounts are 13-14px (prod 16-18px), and the SVG is 345px tall (prod 434px). At 1440x900 the hero card has a large empty area below the graph. | `node e2e/a9/graph-size.mjs --base https://vouch-ubc-blue.vercel.app`, then the same with `--base https://vouch-ubc.vercel.app` | `docs/evidence/ui-blue/qe/final/logs/graph-size-preview.log`, `…/logs/graph-size-prod-before.log`, `…/final/shots/13-projector-lena-1440x900.png` vs `docs/evidence/ui-blue/qe/before/13-projector-lena-1440x900.png` |
| F2 | Medium | WCAG AA contrast failure in light mode on wallet activity: the money-out amount "−$4.50" uses ink-2 `#6c7685` on `#f5f7fa`, giving 4.27:1 where 4.5:1 is needed (16px/600 is not "large"). It reproduced in two separate runs (05:59Z and 14:57Z), and a hand calculation gives 4.28. Dark mode passes. | `/design/screens/wallet` at 390x844, light scheme, `qe-a9.mjs --mode checks` | `docs/evidence/ui-blue/qe/final/checks/a9-checks.json` (page `mock-wallet`, light), `…/final/shots/03-wallet-home-mock-390.png` |
| F3 | Low | The confirm sheet shows two primary-styled elements. The selected "Who sent you here?" chip (Ana) uses the solid primary blue fill, so it competes with "Confirm with Face ID or fingerprint". A9 asks for light tints on selected states and one primary button. Reproduced in light, dark, and desktop at 1280x720 (`P=2`). | `/design/screens/pay-confirm`, 390x844 | `docs/evidence/ui-blue/qe/final/shots/05-pay-confirm-mock-390.png`, `…/checks/a9-checks.json` (`mock-pay-confirm`) |
| F4 | Low | The "I run a venue" link on sign-in is a 460x20 block at desktop widths, below the 44px tap target. At 390px it is inline text and exempt. Reproduced at 1440x900 and 1280x720. | `/` signed out at 1440x900 | `docs/evidence/ui-blue/qe/final/desktop/sign-in-1440x900.png`, `…/desktop/desktop-layout.json` |
| F5 | Low (pre-existing) | On /transparency the math-table scroll container gets the default amber focus outline `#e59700` at 2.23:1 against the background, below 3:1 and not in the blue theme. Prod has the same outline (2.18:1). | `/transparency`, Tab to the table | `…/checks/a9-checks.json` (`live-transparency` focusRings), `docs/evidence/ui-blue/qe/checks-prod-before/a9-checks.json` |
| F6 | Info (pre-existing) | Payment success uses a large green check circle for an outgoing payment. A strict reading of "green only for money arriving to a person" excludes it. Prod is identical. | `/design/screens/success` | `…/final/shots/07-success-mock-390.png` vs `…/before/07-success-mock-390.png` |
| F7 | Info | Projector payment-feed meta lines truncate with an ellipsis at 1440x900 (for example "First visit · $0.07 back to Maya · …"). Prod does the same. | `/venue/0x9a40…6289` at 1440x900 | `…/final/shots/13-projector-lena-1440x900.png` |
| F8 | Info (harness, not app) | Two harness false positives. (a) `desktop-layout` reports `fixedInColumn=false` on live pay-confirm because the transparent full-viewport sheet scrim is counted; the dialog itself is 460px wide and inside the column (see screenshot). (b) `check-errors2` e50 "Camera is off" is missing because headless Chromium has no camera device, so the app correctly shows "No camera available"; the forced-denied case e51 passes. | — | `…/final/desktop/pay-confirm-live-1440x900.png`, `…/final/errors2/errors2-results.json` |

Counts: Blocker 0, High 0, Medium 2, Low 3 (one pre-existing), Info 3.

## Chain check: preview-build story payments (task 1)

The story ran 05:56-05:59 UTC on the first preview build (venue "QE Lena's café 05:56", 20% reward, `docs/evidence/ui-blue/qe/story/story-2026-11-20T05-56-33-119Z.json`). I re-fetched the receipts from https://rpc.testnet.arc.io today and decoded the USDC `Transfer` logs plus the Vouch v3 `PaymentSettled`, `RewardPaid` and `RewardReturned` events. The split rule is in `contracts/src/libraries/VouchSplit.sol`: pool = amount × rewardBps, then cashback 25%, L1 55% and L2 20% of the pool, with a missing L2 returned to the venue.

| Tx | Status | Paid | Expected | On chain | USDC in = out |
|----|--------|------|----------|----------|---------------|
| Ana `0xd8373c1f…4d25d4e` (block 73141725) | 1 | 1,000,000 | first visit, no introducer, not rewarded, venue 1.00 | venue 1,000,000; `PaymentSettled` rewardPool 0, rewarded false | 1.00 = 1.00 |
| Ben `0x0f2beeb1…04ce15` (block 73141794) | 1 | 1,000,000 | pool 0.20: Ben 0.05, Ana (L1) 0.11, L2 0.04 returned, venue 0.84 | Ben 50,000; Ana 110,000; `RewardReturned` role 2 40,000; venue 840,000; `PaymentSettled` venueAmount 840,000, rewardPool 200,000 | 1.00 = 1.00 |

Both payments are exact, and they match what the UI showed: the projector and dashboard read "Ben paid $1.00 · +$0.05 back · Ana +$0.11 · $0.84 to the venue" and "Rewards paid $0.16". Evidence: `docs/evidence/ui-blue/qe/final/chain/` (`decoded.json`, `split-check.json`, raw receipts, `topics.txt`).

## What was run (against the current preview, 14:50-15:05 UTC)

| Check | Result | Output |
|-------|--------|--------|
| Desktop layout at 1440x900 and 1280x720, 15 screens each (`e2e/a9/desktop-layout.mjs`) | pass: no horizontal scroll, edges OK, column centred, paragraphs ≤ 70ch, sheets inside the column. F4 and F8a noted. | `final/desktop/` |
| A9 checks (`qe-a9.mjs --mode checks`): contrast in light and dark across 43 page/scheme combinations, focus rings (129 sampled), reduced motion, Lena projector $12.00 row, banned words, money format, tap targets, primary count | contrast: 1 failure (F2). Primary count: 1 failure (F3). Focus rings: all theme-blue except F5. Reduced motion: 0 running animations on every probed page. Lena "Ben paid $12.00" row visible without scrolling and hit-testable at 1280x720 and 1440x900. No banned words, no money-format errors, no raw units, no small targets at 390. | `final/checks/a9-checks.json`, `final/checks/projector-lena-*.png` |
| Screenshots (`qe-a9.mjs --mode shots`), 16 demo-path screens with the same filenames as `before/` | done | `final/shots/` |
| Phase 3 static and route checks at 390x844 (`e2e/phase3/check-static.mjs --base`), 30 records | pass: every route renders, 0 banned words, 0 small targets, at most 1 primary per screen. The console errors are the expected 404/409 responses on unknown intro, 404 and already-paid, the same as the baseline. QE-3-02: the keyboard does not cover the input. QE-3-07: a single blue focus ring (2px inset `#4075AD`). Reduced motion: 0 animations vs 10 with normal motion. | `final/static/` |
| Phase 3 error states, part 2b (`check-errors2.mjs --base`): relay failure (intercepted 502), offline at confirm, reduced-motion pending and settled, camera denied, type-the-code | pass (F8b is a harness artifact) | `final/errors2/` |
| Money-graph size, preview vs prod (`graph-size.mjs`) | F1 | `final/logs/graph-size-*.log` |
| Contract and API invariance: `git diff` from the merge-base with main to 4fff109 | only `apps/web/src` (UI/copy), `apps/web/scripts/contrast.ts` and e2e changed. Nothing changed under `apps/api`, `contracts` or `packages`, and no fetch or endpoint lines changed. `lib/views.ts` has copy-only changes to activity labels. | — |
| Chain check of the preview-story txs | exact | `final/chain/` |

## NOT RUN today

- **Live settle-via-Stream payment story on the current preview build.** The QuickNode Stream is down while it is being replaced, and the no-spend rule applies. As a substitute I cite the earlier preview-build story above (05:56Z: both payments settled through SSE in 1.5-2.2s, with ok true) plus today's chain re-check. That story ran on the first preview build, before deployment 6tryrh3x5 (06:07Z). Since then only the desktop framing has changed.
- **`e2e/phase3/check-errors.mjs` (Phase 3 error states, part 1).** It registers a fresh venue on chain, which spends relayer gas, so it was skipped under the no-spend rule. The earlier WIP run is in `docs/evidence/ui-blue/qe/errors/`. Part 2b did run today.
- **WebKit (Safari) pass.** Not re-run within the time box. The earlier WIP output is in `docs/evidence/ui-blue/qe/webkit/`.
- **Real-device and real-projector viewing.** Out of scope for headless QE.

## Most useful screenshots

- 390 home (new account): `docs/evidence/ui-blue/qe/final/shots/02-wallet-home-new-390.png` (with activity: `…/03-wallet-home-mock-390.png`)
- Confirm: `docs/evidence/ui-blue/qe/final/shots/05-pay-confirm-mock-390.png`
- Success: `docs/evidence/ui-blue/qe/final/shots/07-success-mock-390.png`
- Venue dashboard, projector 1440x900: `docs/evidence/ui-blue/qe/final/shots/13-projector-lena-1440x900.png` (and `…/desktop/projector-lena-1440x900.png`)
- Desktop framing, confirm sheet: `docs/evidence/ui-blue/qe/final/desktop/pay-confirm-live-1440x900.png`
