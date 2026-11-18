# Phase 3 QE gate (frontend): independent verification

_QE_E2E, session 3, Wed 2026-11-18, 18:30–19:25 UTC. Code under test: web `5f2d378` (`apps/web`, HEAD `9ee3171` is docs-only) on the shared dev server http://localhost:3100, against the hosted api https://api-production-902bc54c.up.railway.app._

## Verdict (re-verify, 20:35Z): PASS-with-findings on parts 1, 2, 4 and 5; part 3 (live story) is STREAM NOT ACTIVE again. The gate stays OPEN.
- **All 8 run-1 findings are fixed:** QE-3-01..08, each re-checked independently on `3d381e0`.
- **One new Low:** QE-3-09, the visitor dashboard wording.
- **Live story:** blocked only by the paused Stream; see the "Re-verify" section.

### Run 1 verdict (18:30–19:31Z): PASS-with-findings on parts 1, 2, 4 and 5; part 3: STREAM NOT ACTIVE

- **Static checks and every error state pass.** There is no Blocker or High finding: 2 Medium and 6 Low, all UX/copy, and nothing in money handling.
- **The live canonical story was not run.** The QuickNode Stream was paused for the whole 45+ min window (18:33–19:23Z), so nothing could reach "settled". I did not spend the two demo top-ups on a story that couldn't settle.
- **What remains:** run `node e2e/phase3/story.mjs` (about 3 min) once the Stream is active.

## How it was tested
- **Harness.** I wrote my own Playwright checks in `e2e/phase3/`. Playwright 1.56.1 is resolved from `apps/web`, Chromium is headless, and phones use 390×844 @2x with touch.
  - Each device is its own browser context with a CDP virtual WebAuthn authenticator (ctap2, internal, UV, resident keys, PRF). That is the builder's recipe; it is the only thing reused from `apps/web/scripts/phase3-*`.
  - The builder's scripts' conclusions were not reused.
- **Scripts:**
  - `check-static.mjs`: routes, copy, money format, tap targets, primary-action count, focus, reduced motion.
  - `check-errors.mjs` and `check-errors2.mjs`: error states.
  - `check-scanner.mjs`: the in-app scanner fed a real counter QR through Chrome's fake camera (`png-to-y4m.mjs`).
  - `decode-qr.mjs`: an independent jsQR decode of the QR screenshot.
  - `story.mjs`: the live story.
  - `verify-chain.mjs`: the receipt read from the Arc public RPC, with USDC `Transfer` logs decoded. It does not use api code.
- **Audit on every screen (`lib.mjs` `audit()`):**
  - Visible text outside `[data-copy-scope=details]`/`<details>` is scanned against the COPY.md banned list plus "passkey" (D-017d). Accessible names (aria-label/alt/placeholder/title) are scanned separately.
  - Every `$` amount must have exactly 2 decimals; there must be no ≥6-digit integers and no `0x…` strings.
  - Every visible interactive element is checked for ≥44×44 px (inline text links are exempt).
  - Primary actions are counted as elements with the ink-primary class `bg-ink`.
  - The first Tab stop must show a visible outline or ring.
  - Console errors and page errors are collected per screen.
- **Results (raw):** `docs/evidence/phase-3/qe/static-results.json`, `errors-results.json`, `errors2-results.json`, `story-*.json`, and the `*.ndjson` logs.

## 1. Static and route checks (no Stream needed)
Coverage: 28 route/state visits. That is every route in the FRONTEND_INTEGRATION route table, signed out and signed in, plus `/does-not-exist`.

| Check | Result |
|---|---|
| Every route renders | **PASS.** All app routes return 200 and render: `/`, `/wallet`, `/scan`, `/pay` (valid, paid, malformed ×2), `/recommend`, `/i/[code]` (valid, unknown), `/me`, `/a/[address]`, `/venue`, `/venue/new`, `/venue/[venue]`, `/venue/[venue]/counter`, `/transparency`, `/transparency?venue=`. |
| Page errors | **PASS: 0** across all runs. |
| Console errors | **PASS.** The only console errors are the browser's "Failed to load resource" lines for expected API answers (404 on an unknown intro code, 409 `ORDER_ALREADY_PAID` on a paid order) and the deliberate 404 route. There are no app exceptions. |
| Banned words, visible text, primary screens | **PASS: 0 hits** on 60+ audited screens. These include every error state, the pay sheet, success, counter, dashboard, onboarding and wallet. "testnet" appears only as "Top up (testnet demo)"; the note beside it reads "Simulated money for this demo". The transparency page (exempt) uses "smart contract", "Arc Testnet" and "transaction", as allowed. |
| Banned words, accessible names | **PASS: 0 hits.** |
| Tap targets ≥ 44 px, primary actions | **PASS.** All primary buttons are 48–56 px tall and full width. Icon buttons are 48×48. |
| Tap targets, all controls | **1 miss:** the toast "Dismiss" button is 40×40 (QE-3-06). |
| Exactly one primary action | **PASS on every action screen** (count = 1). Count = 0 on display-only screens, by design: counter QR (secondary "Cancel order"), scanner (the camera is the action), transparency, public record, unknown link (secondary "Open Vouch"). No screen has two. |
| Dollar formatting | **PASS.** Every amount has 2 decimals ($0.50, $3.00, +$0.02 back, $19.97). There are no base units or hex on primary screens. Hashes appear only inside "Receipt details". Order labels are 4 hex chars ("Order 7005"), which is acceptable. |
| Reduced motion | **PASS.** With `prefers-reduced-motion: reduce`, the dashboard + money graph run **0** animations (10 without the setting: ping, draw, run, pop, fade); the success pending/settled screens and transparency also run 0. The final frame renders completely and nothing breaks. |
| First-Tab focus visible | **PASS** on every route-loaded screen. The pay/problem sheets auto-focus the close button with a visible 2-px green ring. The text-field ring is doubled (QE-3-07, s01b). The default 404 has nothing focusable (QE-3-08). |
| QR integrity | **PASS.** An independent jsQR decode of the counter screenshot equals `data-qr-payload` exactly (`<origin>/pay?v=<venue>&o=<orderId>`). |
| In-app scanner | **PASS.** The fake camera showed the real counter QR, and the scanner routed to the matching `/pay?v=&o=` in **679 ms** (e55/e56). |

## 2. Error states
| State | How | Result | Shot |
|---|---|---|---|
| Expired order | **real**: order with ttl 30 s, opened after 32 s | PASS: "This code has expired … Nothing was charged. Ask for a new code and scan again." · **Scan a new code** → `/scan` | e23 (forced 410 variant: e14) |
| Insufficient balance + top-up CTA | **real**: fresh $0 account | PASS: "Not enough money yet · Your balance is $0.00. Add at least $0.50 to pay $0.50." The one primary is **Top up (testnet demo)**. A 402 at relay time shows the same state. | e11, e18 |
| Relayer down | forced 503 `RELAYER_DOWN` on quote | PASS: "Payments are paused for a moment … Nothing was charged. Try again in a minute." **Try again** recovers to the pay sheet once the api answers. | e12, e15 |
| Budget exhausted | forced 503 `RELAYER_BUDGET_EXHAUSTED` | PASS: same paused copy | e13 |
| Already rewarded (plain payment) | forced quote (`firstPurchase:false`, no rewards) | PASS: "Welcome back. Your first-visit thank-you at … has already been paid, so this one is a regular payment." It is a note, not an error, and pay stays enabled. | e21 |
| Payment failed | forced 502 `TX_FAILED` at POST /payments; and forced 202, then GET /payments/:id `failed` | PASS (both): "Payment didn't go through · Nothing was charged. Try again, or ask for a new code." | e16, e17 |
| Face ID cancelled | **real**: virtual authenticator with UV=false | PASS: "Payment not confirmed · Face ID or fingerprint was cancelled, so nothing was charged." | e19 |
| Offline | **real**: context offline at confirm | PASS: "You're offline · Connect to Wi-Fi or mobile data to pay. Nothing was charged." The signing control in the same context was OK (e60). | e61 |
| Camera denied | headless default (no device) → "No camera available"; `NotAllowedError` forced | PASS: "Camera is off for Vouch · That's fine, there are two other ways to pay:" (camera-app link + type the code) | e50, e51, e52 |
| Malformed link | **real**: `/pay?v=<venue>` (no order) and `/pay?v=0x123&o=nope` | **FINDING QE-3-01**: shows "Payment didn't go through · Nothing was charged · **Try again**". No payment was attempted, and Try again re-renders the same state. | s26, s27, e24, e25 |
| Unknown friend's link | **real**: `/i/NOPE0000` | PASS: "This link doesn't work · It may have been mistyped…" | s11 |
| Order already paid | **real** paid order | PASS: "This order is already paid · Someone has already paid with this code…" | s25 |
| Friend's link, already a customer | forced 409 `ALREADY_REWARDED` | PASS: "You've already been to … Thanks for being a regular." | e30 |
| Top-up refused (claimed / daily cap / disabled) | forced 409/429/503 on POST /demo/topup (nothing claimed) | PASS: a plain toast per case. The toast's Dismiss is 40 px (QE-3-06). | e26–e28 |
| Non-owner at another venue's counter | **real** | Refused cleanly ("You can't do that from this account."). The venue dashboard still offers **Take an order** to non-owners (QE-3-05). | s28, s29, e29 |
| Session gone | **real**: token removed | PASS: "Welcome back, Eve · Confirm it's you" | e31 |

## 3. Live canonical story
**STREAM NOT ACTIVE: not run.**

- **Liveness probe.** It is free and spends nothing. It watches `GET /venues/<v>` → `onchain`, which is filled only from Streams (`venue.registered`), for a venue whose registerVenue was mined at about 18:29Z (`0x30b2…8356`, "Shots café 18:29"). The probe ran every 3 min from 18:33Z: 13 polls, plus a manual check at 19:23Z. `onchain` stayed `null` throughout (`docs/evidence/phase-3/qe/stream-poll.log`).
- **Corroborating evidence:**
  - My own error-run venue `0xdAb6d0E70Ae9a11d757a9467cA9Df109Df533796` (registered 18:41Z) also never got `onchain`.
  - Its onboarding reached the dashboard only through the D-906 15-s fallback (17.0 s, versus 1.5–1.9 s in the builder's runs before the pause).
  - FRONTEND_INTEGRATION saw the same pause at 18:25Z (MSG-114).
  - The relayer was healthy the whole time: `enabled:true`, `reachable:true`, balance 10.53, queue 0.
- **Why it wasn't attempted:** a payment would relay but stay "Arriving". Spending two of the remaining demo top-ups on a story that can't settle wasn't justified, so I didn't attempt one. As a result no tap→settled or venue-sees-paid latency, and no on-chain split, was measured by QE this session.
- **Ready to run:** `e2e/phase3/story.mjs`. It covers:
  - venue onboarding with the slider at 20% and a $0.50 minimum;
  - a $1.00 order → QR;
  - Ana: fresh account, in-app $3 demo top-up from the pay sheet → pay → pending → settled; counter flips to Paid; a 1280×720 projector context watches the dashboard update live;
  - Ana recommends → Ben opens the link signed out, saves it, tops up from the wallet, and pays a new $1.00 order picking "Ana";
  - Ana's live "just arrived" toast; owner and projector dashboards + money graph at 390 and 1280×720; records; transparency; a reduced-motion pass on the live graph.

  It records tap→pending, tap→settled, venue-sees-paid, projector-feed and reward-toast latencies, and the app's own `__vouchTimings`. It aborts after Ana if her payment isn't settled within 60 s, so Ben's top-up isn't wasted. Afterwards, check the split with `node e2e/phase3/verify-chain.mjs <tx> 1000000`.
- **verify-chain.mjs has been validated** on the builder's referred pay `0xc898e244…695f`: USDC in = out = 500000 (venue 440000, L1 41250, cashback 18750), exact. That was a pre-pause tx, used only to validate the tool.
- **Expected split for the $1.00 referred story at 20%:**
  - pool $0.20;
  - Ben's cashback $0.05;
  - Ana (L1) $0.11;
  - L2 $0.04, returned to the venue because Ana has no introducer;
  - venue $0.84.

## 4. Screenshots
`docs/evidence/phase-3/qe/screens/`: 70 PNGs (re-verify run of `3d381e0`; run 1 is archived in `run1/screens/`) plus `index.json` (`{file, route, state, notes, viewport}`).
- Phones are 390×844 @2x. The `-full` files are full-page captures.
- Prefixes: `s*` static/routes, `e*` error states, `l*` live story.
- Desktop: `s50-transparency-1280`. The 1280×720 live venue dashboard and money graph (`l04/l12/l26/l28/l29`) come from `story.mjs` and **were not captured**, because the Stream was not active.
- The money graph at 390 on live data (an existing venue, viewed as a non-owner) is in `s28` and `s40` (reduced motion).
- Offline is `e61`, checked in an isolated context. Run 1's invalid `e20` has been dropped.

## 5. Real-phone checklist
`docs/qa/phase-3-phone-checklist.md`: 32 pass/fail steps for `<WEB_URL>`, covering:
- native-camera and in-app scanning, including camera denied and an expired code;
- Face ID/fingerprint at onboarding, confirm and cancel;
- the two-device (plus optional third) recommendation loop;
- Add to Home Screen on iOS and Android;
- latency stopwatch fields;
- airplane mode before confirm, during "Arriving", and on the venue dashboard;
- copy, amounts and thumb reach.

## Re-verify (2026-11-18, 19:57–20:35 UTC) of fix commit `3d381e0` on :3100
_The owners' replies are MSG-121 (FRONTEND_INTEGRATION) and MSG-123/124 (UI_DESIGN). Each finding was re-checked with my own scripts against the live dev server; none was taken on the owners' word._

**How:**
- Re-ran `check-static.mjs` (30 visits), `check-errors.mjs` (30 states), `check-errors2.mjs` (7) and `check-scanner.mjs`, all on a fresh evidence set.
- Run-1 evidence is archived in `docs/evidence/phase-3/qe/run1/`.
- Expectations changed only where the fix intentionally changed copy: malformed link → "This link doesn't look right"; non-owner counter → "Only the owner can take orders here".
- I also dropped run 1's invalid e20 (offline is checked in isolation by e61), and fixed my focus probe to accept a ring drawn by the focused element's wrapper (the QE-3-07 fix moved the ring there).

**Whole-app result after the fix:**
- 65 audited screens: 0 page errors, 0 banned words (visible text and accessible names), 0 bad money formats, 0 controls under 44 px, no screen with 2+ primaries.
- Reduced motion: 0 running animations.
- The only console errors are the expected API 404/409 resource lines.
- An independent decode of the new counter QR equals its payload, and the in-app scanner routes in 691 ms.

| ID | Verdict | Evidence (my check) |
|---|---|---|
| QE-3-01 | **FIXED** | All four links show "This link doesn't look right … Nothing was charged…" with one primary, **Scan a new code** (→ `/scan`, checked), and a ghost Close. There are 0 "Try again" buttons. Tested links: `/pay?v=0x123&o=nope`, `/pay?v=<venue>` (no `o`), a truncated `o`, and a well-formed unknown order on a real venue. Shots s26, s27, e24, e25, e25b, e25c. |
| QE-3-02 | **FIXED** | The footer is opaque (`rgb(246,244,239)`). Focusing "Minimum first order" scrolls it above the footer: label top 557 px, input bottom 632 px, footer top 730 px. Hit-testing at their centres returns the label and the input themselves, no longer the caption or the button. Shots s32, s33. |
| QE-3-03 | **FIXED** | The success screen after a first visit with no recommendation (forced settle) reads "Thanks for coming in. When a friend recommends a place to you, …" in both pending and settled (e40, e41). The repeat visit still says "Welcome back…" on the pay sheet (e21). |
| QE-3-04 | **FIXED** | The caption now reads "verified first purchases" (s28). |
| QE-3-05 | **FIXED** (order-taking) | A visitor's dashboard has no primary at all, so no "Take an order" (s28, s40). `/venue/<other>/counter` shows "Only the owner can take orders here", with 0 keypad keys and primary **Go to your place** (s29, e29). The owner still has Take an order (e01). **New Low QE-3-09** (below): the rest of the visitor view described in D-615 isn't wired. |
| QE-3-06 | **FIXED** | The toasts show (e26–e28) and the audit finds no control under 44 px on any screen, so the Dismiss button is now at least 44×44. |
| QE-3-07 | **FIXED** | First Tab on `/`: the input has `outline: none`, and the wrapper draws one 2-px inset green ring (s01b). |
| QE-3-08 | **FIXED** | `/does-not-exist` returns HTTP 404 with a styled "We can't find that page · Nothing has changed in your account", one primary **Go to Vouch**, a secondary "Scan a code", and a visible first-Tab ring (s12). |

**New finding:**
| ID | Sev | Route | Repro | Expected | Actual | Owner |
|---|---|---|---|---|---|---|
| QE-3-09 | Low | `/venue/[venue]` as a visitor | Sign in as anyone, open another venue's dashboard (`0xC6CF…319c`) | The D-615/MSG-119 visitor mode: no ad-cost input; feed rows say "to the venue". | The feed rows say "**$0.44 to you**" / "$0.50 to you" to a non-owner, and the "Typical ad cost" input is still shown (read-only, but focusable; it is the first Tab stop). `Dashboard.tsx` never passes `viewer="visitor"` to `VenueDashboardScreen` (the prop exists; the owner flag is computed). | FRONTEND_INTEGRATION |

**Live story:** **STREAM NOT ACTIVE: not run** (the story and the 1280×720 live dashboard/graph shots).
- **Free `onchain` probe:** every 3 min, 19:57–20:27Z (11 polls), then at 20:30Z. It stayed `null` on the 18:29Z venue and on both QE venues (18:41Z, 20:02Z).
- **Cursor-independent check:** a free probe can't tell a still-paused Stream from one resumed at head after the probe venue was mined. So `e2e/phase3/stream-probe-live.mjs` registered one fresh venue at 20:31Z (`0xD3Ad3B040F74B3F3dAe6B700dc85DC1A1637706D`, about $0.0045 gas). No `venue.registered` arrived within 108.8 s of the tap, and onboarding took the D-906 fallback (17.2 s).
- Log: `docs/evidence/phase-3/qe/stream-poll-reverify.log`.
- **Not used:** 0 top-ups; the CLI fallback for top-ups (now built into `story.mjs`) was not needed.
- **What remains is unchanged:** once the Stream is live, run `node e2e/phase3/story.mjs` (about 3 min), then `node e2e/phase3/verify-chain.mjs <Ben's tx> 1000000`.

**Spend (re-verify):**
- Two more venue registrations, about $0.0045 each: the errors run, plus the live Stream probe at 20:31Z. The relayer's daily used went from 0.134185 to 0.138682 USDC before the probe.
- 0 top-ups. No customer pay relayed.
- Phase 3 QE total so far: about $0.013 of gas.

## Findings (run 1, 18:30–19:31Z)
| ID | Sev | Route | Repro | Expected | Actual | Owner |
|---|---|---|---|---|---|---|
| QE-3-01 | Medium | `/pay?v=<venue>` (no `o`), `/pay?v=0x123&o=nope` | Open a malformed or truncated pay link (a mistyped short link, or a cut-off QR URL). | "This link doesn't work / code not recognized", with **Scan a new code** as the one primary (as `/i/<bad>` does). | "Payment didn't go through · Nothing was charged. Try again…". No payment was attempted. The primary **Try again** re-renders the same state (dead-end loop). `PayFlow` maps `badLink` → `"failed"`, and PayProblem has no invalid-link state. Shots s26, s27, e24, e25. | FRONTEND_INTEGRATION (mapping) + UI_DESIGN (state copy) |
| QE-3-02 | Medium | venue `/venue/new` at 390×844 | A signed-in user without a venue opens `/venue`. | The minimum-first-order label and field are readable above the sticky CTA. | The footer caption "Start at 15% · change it any time" is drawn over the "Minimum first order for a reward" label, and the field is hidden behind the Confirm button (s30). Also reported by FRONTEND_INTEGRATION as MSG-115. | UI_DESIGN (venue) |
| QE-3-03 | Low | `/pay` success (pending + settled) | First purchase at a venue with no recommendation (`firstPurchase:true`, `rewarded:false`; forced settle, e40/e41). | First-visit wording, e.g. "Thanks for coming in" / "No one recommended this place yet". | "Thanks for coming back." on someone's first visit. The pay sheet before it correctly says "No one recommended this place to you yet, so this is a regular payment" (e22). Related to MSG-100 (success `noReward` copy). | UI_DESIGN (customer) + FRONTEND_INTEGRATION (pass the reason) |
| QE-3-04 | Low | `/venue/[venue]` | A venue whose first customer came without a recommendation (`0xC6CF…319c`: Ben without a recommendation, Cara via Ben). | The KPI subline matches the count. | "New customers **2** · verified, via recommendations", but only 1 came via a recommendation (s28). `verifiedCustomers` counts every first purchase. | UI_DESIGN (venue) |
| QE-3-05 | Low | `/venue/[venue]`, `/venue/[venue]/counter` | Signed in as a non-owner, open someone else's venue dashboard. | No order-taking primary for non-owners (a read-only view, or "Set up your place"). | The primary **Take an order** is shown. The counter opens, and only after keying an amount and pressing Show code does it say "You can't do that from this account." (s28, s29, e29). The api refuses correctly, so this is not a security issue. | FRONTEND_INTEGRATION |
| QE-3-06 | Low | `/wallet` (toasts) | Trigger any toast (e.g. a top-up refusal). | Tap target ≥ 44×44. | The toast's Dismiss button is 40×40 (e26–e28). | UI_DESIGN |
| QE-3-07 | Low | `/` and every TextField | Focus the first-name field (Tab or tap). | One focus ring that follows the rounded field. | A doubled indicator: a square outline inset inside the rounded green ring (s01b). The `<input>` has `outline: 2px solid` with a 2-px offset, and its wrapper also has an inset 2-px green box-shadow. | UI_DESIGN |
| QE-3-08 | Low | any unknown path (`/does-not-exist`) | Open a mistyped URL. | An on-brand "page not found" with a way back to Vouch. | The unstyled Next.js default 404, with nothing focusable and no way home (s12). | FRONTEND_INTEGRATION |
| — | Gate blocker (env) | live story | QuickNode Stream paused 18:25Z → still paused 19:23Z | Stream active | Part 3 not run (see §3) | human / ORCHESTRATOR |

Info (no action):
- Display-only screens (counter QR, scanner, transparency, public record, unknown link) have no ink primary, by design.
- Headless "no camera device" shows "No camera available" (a distinct state); the denied state was checked by forcing `NotAllowedError`.

## Spend
- **Relayer gas:** one venue registration (`QE errors café 18:41`, `0xdAb6…3796`, via the in-app onboarding). The hosted relayer's daily-used figure moved from 0.130374 to 0.134185 USDC, about $0.004 (other agents may have contributed).
- **Customer money:** no customer payment was relayed; every pay/settle in §2 is intercepted.
- **Demo top-ups:** 0 of 3 used. All POST /demo/topup calls in §2 were intercepted.
- **Phase 3 QE total:** about $0.004, well under the $2 cap.

## Comms
- **Sent:**
  - MSG-116 → FRONTEND_INTEGRATION (request): QE-3-01 Medium, plus Lows QE-3-03/05/08.
  - MSG-117 → UI_DESIGN (request): QE-3-02 Medium, plus QE-3-01 state, QE-3-03/04/06/07.
- **Inbox:** MSG-079 (BACKEND_RELAYER) stays open. QE-2-03/04/06/09 are still to be re-tested at Thursday's gate on the deployed app.
- **Re-verify:** closed MSG-116, MSG-117, MSG-121 and MSG-123 (every finding fixed). Sent MSG-129 → FRONTEND_INTEGRATION (QE-3-09, Low).
- **Not messaged:** the Stream pause. The Orchestrator has already asked the human to resume it (MSG-114). It is the only gate blocker.
