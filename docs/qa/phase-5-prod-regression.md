# Phase 5: production regression of the deployed app (QE_E2E)

_Run 2026-11-19, 04:04Z to 04:25Z, by QE_E2E (independent)._

**Target:**
- Web: https://vouch-ubc.vercel.app (D-020).
- Api: https://api-production-902bc54c.up.railway.app.

**Verdict: PASS-with-findings.**
- Every check that doesn't need a new settlement passed on production.
- Findings: one Low (P5-01) and one Info (P5-02), both filed to UI_DESIGN as MSG-132. Neither blocks the demo.
- MSG-079 (QE-2-03/04/06/09) re-tested 18/18 and is **closed**.
- The live story (`story.mjs`) is prepared for Thursday morning and was not run tonight (see §5).

**Spend tonight:**
- One venue registration (QE errors café 04:08, `0x3F502804f5C1002113Bf712e2A1eb76D24beB8cC`): about $0.0045 relayer gas.
- No customer payments and no demo top-ups. Every POST /demo/topup was intercepted. Customers were unfunded or the pay was intercepted.

## 1. Phase 3 checks pointed at production (390×844, Chromium)

The scripts are now parametrized: `--base/--api/--out/--engine` flags, or `QE_BASE/QE_API/QE_OUT/QE_ENGINE` (`e2e/phase3/lib.mjs`). Nothing is hardcoded to `:3100` any more.

| Check | Result | Evidence |
|---|---|---|
| `check-static`: 26 route visits (signed out, new customer, reduced motion), plus the QE-3-02 geometry and the QE-3-07 ring | **PASS**. See the details below this table. | `docs/evidence/phase-5/prod/chromium/static-results.json`, `chromium/screens/s*.png` |
| `check-errors`: 30 states (real: insufficient, expired, malformed, unknown order, Face ID cancelled, non-owner counter; intercepted: relayer down, budget, failed, 402, repeat, top-up refusals, already a customer) | **PASS**. Every expected text was found. Recoveries navigate to `/scan`. | `chromium/errors-results.json`, `chromium/screens/e0*-e31*.png` |
| `check-errors2`: offline (with a control), reduced-motion pending/settled, camera denied | **PASS**. Offline shows "You're offline … Nothing was charged". Reduced motion runs 0 animations. The forced camera-denied state shows "Camera is off for Vouch". | `chromium/errors2-results.json` |
| `check-scanner` (fake camera, real counter QR) | **PASS**. The QR decoded and routed in 951 ms to `https://vouch-ubc.vercel.app/pay?...`, on the same origin with the path only. | `chromium/screens/e55`, `e56` |
| 404 | **PASS**. HTTP 404, "We can't find that page", one primary **Go to Vouch**, with a 2px ring on the first Tab. | `chromium/screens/s12-404.png` |
| Production QR payload | **PASS**. The counter QR encodes `https://vouch-ubc.vercel.app/pay?v=…&o=…`, so a phone's native camera opens production. | `chromium/errors-results.json` `state.qr` |
| CORS from the real origin | **PASS**. See the details below this table. | `curl` transcript in §6 |

**`check-static` details:**
- 0 banned words, including in accessible names.
- 0 money-format errors, 0 raw base units, 0 targets under 44 px.
- At most one primary per screen.
- First-Tab focus is visible on every screen with a focusable element.
- Reduced motion: 0 running animations vs 10 with motion on.
- QE-3-02: the "Minimum first order" input bottom is at 632 px and the footer top at 730 px.
- QE-3-07: one inset 2px ring, drawn on the wrapper.

**Errors seen:**
- No unexpected console or page errors.
- The only console errors are the expected api statuses on error states: 404 (unknown link or order), 409 (already paid or already a customer), 410 (expired), 402 and 502/503 (forced).
- Every `requestfailed` entry was `net::ERR_ABORTED`, meaning an SSE stream or read was cancelled by navigation.

**CORS details:**
- The preflight from `Origin: https://vouch-ubc.vercel.app` returns 204 with `access-control-allow-origin: https://vouch-ubc.vercel.app`.
- The omega domain gets no ACAO header, as D-020 intends.
- No CORS console error and no failed api request in any run: 0 matches for "CORS policy" in all of the production evidence.

## 2. Seeded venues and ambassador records (390×844 and 1280×720)

Run with `node e2e/phase5/check-seed.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/phase-5/prod`. Each venue was viewed as a signed-in visitor (not the owner) and compared with the hosted `/stats`, `/payments` and `/ambassadors` read at the same time.

| Venue | New customers | Rewards paid | Cost per new customer | Feed vs `/payments` | Graph names (Latest / Everyone) | Hex / "Guest" | Everyone at 1280 |
|---|---|---|---|---|---|---|---|
| Lena's café `0x9a40…6289` | 6 ✔ | $3.71 ✔ (3.713998) | $0.62 ✔ | 390: 7/7 rows ✔. 1280: 4 newest only (**P5-01**) | 8/8 named (Ana, Marco, Priya, Sofia, Ben, Chloe, Diego, Maya) ✔ | none ✔ | readable, no overlaps; venue node $24.29 = venueReceived 24.286 ✔ |
| Kiln Bakery `0xDbf2…A494` | 5 ✔ | $1.63 ✔ | $0.33 ✔ | 390: 5/5 ✔. 1280: 4 newest | 5/5 named ✔ | none ✔ | readable; venue node $15.47 = Σ venue amounts ✔ |
| Pressed `0x8289…6b4c` | 4 ✔ | $2.70 ✔ | $0.67 ✔ | 4/4 at both sizes ✔ | 5/5 named (incl. Tomás) ✔ | none ✔ | readable ✔ |

Notes:
- Gross ($28.00 / $17.10 / $14.60) is not on the dashboard by design. The cards are cost per new customer, new customers and rewards paid.
- The dashboard needs an account (AccountGate). The visitor view is what a judge sees after signing in.

| Public record `/a/<addr>` (signed out) | On screen | `/ambassadors/:addr` |
|---|---|---|
| Ana `0x995b…d26F` | 3 new customers across 2 venues, +$1.29 (Lena's +$0.97, Pressed +$0.32) | customersCredited 3, referrer 1.194773 + introducer 0.093 = 1.287773 ✔ |
| Priya `0xF066…0434` | 2 across 1 venue, +$0.41 | 2, 0.411226 ✔ |
| Ben `0x5d71…3D794` | 2 across 2 venues, +$0.80 | 2, 0.62975 + 0.173 = 0.80275 ✔ |

The record pages had 0 banned words, no hex, no money-format errors and no small targets at either size.

**Screenshots for the README and video** are in `docs/evidence/phase-5/prod/screens/`:
- Dashboards at 390, viewport and full page: `p-lena-dashboard-390.png`, `p-kiln-dashboard-390.png`, `p-pressed-dashboard-390.png`, plus the matching `-full` versions.
- Dashboards at 1280: `p-lena-dashboard-1280.png`, `p-kiln-dashboard-1280.png`, `p-pressed-dashboard-1280.png`.
- Everyone view: `p-lena-everyone-390.png` / `p-lena-everyone-1280.png`, and the same pair for kiln and pressed.
- Records: `p-record-ana-390.png` / `-1280`, and the same for priya and ben.
- Recommended for the video: `p-lena-everyone-1280.png`, `p-kiln-everyone-1280.png`, `p-lena-dashboard-390.png` and `p-record-ana-390.png`.

## 3. MSG-079 re-test (QE-2-03/04/06/09), hosted api: 18/18 PASS → closed

Run with `node e2e/phase5/msg079.mjs`. Evidence: `docs/evidence/phase-5/prod/msg079-results.json`. No chain spend.

| ID | Check | Result |
|---|---|---|
| QE-2-03 | `/venues/prepare` with payout zero / Vouch / USDC | 400 INVALID_PAYOUT ×3 ✔ |
| QE-2-03 | setKeys prepare (`POST /venues/:v/actions`) with payout Vouch / USDC / zero | 400 INVALID_PAYOUT ×3 ✔ |
| QE-2-04 | setSeedAmbassador with `allowed` = `"true"`, `"false"`, `1`, `0`, `null` | 400 BAD_REQUEST `details.field=allowed` ×5 ✔ |
| QE-2-04 | Control: `allowed: true` | 200, typed message `allowed === true` ✔. It was never signed. |
| QE-2-06 | The app signs a pay; the test holds the POST /payments until 6 s after the order's expiry | 410 **ORDER_EXPIRED** ✔. The UI shows "This code has expired … Nothing was charged" (`m06-pay-after-expiry.png`). |
| QE-2-06 | Quote after expiry; public order status | 410 ORDER_EXPIRED ✔; `expired` ✔ |
| QE-2-09 | A refused pay (real 402 INSUFFICIENT_BALANCE from an unfunded customer) | order stays `pending`, relayStatus `pending`, no tx ✔. A new quote on the same order → 200 ✔. |

QE-2-09 caveat: refusals inside the relayer (GAS_TOO_HIGH, quota) can't be forced on hosted without spending. They remain covered by `apps/api/src/test/security.test.ts`.

## 4. Real WebKit (Safari engine), iPhone 14 profile

Setup:
- WebKit 26.0 (Playwright build 2215) was installed under `node_modules` only, with `PLAYWRIGHT_BROWSERS_PATH=0`. Nothing was installed globally.
- Run with `node e2e/phase3/check-static.mjs --engine webkit --base … --out docs/evidence/phase-5/prod/webkit`.
- Virtual WebAuthn authenticators are Chromium-only, so the signed-in sections were skipped.

**Result: PASS (12 signed-out visits, the QE-3-07 ring and transparency at 1280).**
- 0 banned words, 0 money errors, 0 small targets, at most one primary per screen.
- Rendering matches Chromium (`webkit/screens/s05-record-public.png`).
- Info: on screens whose only focusable elements are buttons or links (transparency, scan, unknown link, 404), a plain Tab lands on `body`. This is WebKit/Safari's default ("Press Tab to highlight each item" is off). **Option+Tab** focuses the first control with the 2px ring and a 6px halo on all three screens checked. This is not an app defect.

## 5. What's left for Thursday morning (Stream resumed)

**Stream status tonight:** the free probe showed the Stream **ACTIVE** at 04:09:31Z. Tonight's venue `0x3F50…B8cC` was ingested (`onchain` set) within about 1 minute of its registration. So the human had not paused it yet.

**`story.mjs` was not run.** It needs 2 customer payments and 2 demo top-ups, which tonight's constraints forbid. Because tonight's venue is already ingested, it can't be reused as the morning probe.

**Hardening added to `story.mjs`:**
- The venue it registers first doubles as the Stream probe. If Streams hasn't ingested it within `QE_STREAM_WAIT_S` (default 90 s), the run stops **before any top-up or payment**, having spent about $0.0045.
- Optional `--probe-venue <addr>` runs a free preflight against an already-mined, not-yet-ingested venue.

**Morning commands** (repo root; never ports 3000/3100):

```bash
# 1. (optional, ~$0.0045) definitive probe: registers a venue and waits up to 90 s for venue.registered
node e2e/phase3/stream-probe-live.mjs --base https://vouch-ubc.vercel.app
# 2. the live story: 1 venue registration + 2 demo top-ups + 2 $1.00 relayed pays. Self-stops before spending if the Stream is down.
node e2e/phase3/story.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/phase-5/prod/story
# 3. verify Ben's pay exactly on chain (tx hash from story-results.json)
node e2e/phase3/verify-chain.mjs <ben pay tx> 1.00
```

After the story:
- Re-run `check-seed.mjs` to refresh the screenshots.
- Re-probe a venue you know about with `bash e2e/phase5/stream-probe-free.sh <venue> [polls] [interval]`. It only works for a venue that was mined while the Stream was paused.

## 6. Findings

| ID | Sev | Owner | Finding | Status |
|---|---|---|---|---|
| P5-01 | Low | UI_DESIGN (MSG-132) | The 1280 projector dashboard feed shows only the 4 newest payments, with no "see all" (`VenueDashboardScreen.tsx:416`, `max={4}`). At Lena's café the canonical Ben $12.00 is the 5th newest, so it isn't in the projector feed. | open |
| P5-02 | Info | UI_DESIGN (MSG-132) | The Everyone graph labels people who both paid and earned with their earnings only. Ben shows "+$0.31", not "paid $12.00". The numbers are correct. | open |
| P5-I1 | Info | none | WebKit's default Tab skips buttons and links. Option+Tab works with a visible ring. | n/a |
| P5-I2 | Info | none (pre-existing, same in Phase 3) | On the owner's new-venue dashboard (`e01`), the first-Tab probe lands on `body`. This has not been investigated. | noted |

**Process note:**
- My first `check-errors2`/`check-scanner` invocation passed the flags in one unquoted zsh variable, so they defaulted to `http://localhost:3100`, where another agent's dev server was running. That run only loaded pages from it (page loads, hosted-api reads, and one DB-only order on QE's own venue), with no writes to that server and no spend.
- It overwrote 7 committed Phase 3 evidence files. I restored them with `git checkout` and re-ran both scripts against production.

```
$ curl -i -X OPTIONS -H "Origin: https://vouch-ubc.vercel.app" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" $API/payments/quote
HTTP/2 204
access-control-allow-headers: authorization, content-type
access-control-allow-methods: GET, HEAD, POST, PATCH, DELETE, OPTIONS
access-control-allow-origin: https://vouch-ubc.vercel.app
$ curl -i -H "Origin: https://vouch-omega-six.vercel.app" $API/venues/0x9a40…/stats   → 200, no access-control-allow-origin
```

## 7. Files

**Scripts:**
- `e2e/phase3/lib.mjs`: flags and env for base, api, out and engine; a WebKit iPhone 14 path; `requestfailed` capture with tokens redacted.
- `e2e/phase3/check-static.mjs`: WebKit skips the WebAuthn sections.
- `e2e/phase3/story.mjs`: Stream self-probe and an optional preflight.
- `e2e/phase5/check-seed.mjs`, `e2e/phase5/msg079.mjs`, `e2e/phase5/stream-probe-free.sh`.

**Evidence:** `docs/evidence/phase-5/prod/`:
- `chromium/`: static, errors, errors2 and scanner; 71 screenshots.
- `webkit/`: 17 screenshots.
- `screens/`: seed and MSG-079 shots; 30 screenshots.
- `seed-results.json`, `msg079-results.json`.

## 8. Live story on production (Thu 23:33 CST / Fri 05:33Z)

_Run by QE_E2E. Web https://vouch-ubc.vercel.app, hosted api, Vouch v3 `0xF4B6…ff08e`._

**Verdict: PASS.**
- Both pays are exact on chain and settled live through the Stream in about 1.4 s.
- The audits are clean apart from the one known Info.

**Stream probe** (`stream-probe-live.mjs`, 23:33 CST): **STREAM_ACTIVE**.
- Probe venue `0x6B688679D1a6E15D40f483ee6db23B1b12dbe535` reached the dashboard in 2.39 s and was ingested 2.6 s after the tap.
- So the Stream had caught up with its backlog by then.

**Story run:** `node e2e/phase3/story.mjs --base https://vouch-ubc.vercel.app --out docs/evidence/phase-5/prod/story`, 05:33:35Z to 05:36:06Z.
- Evidence: `docs/evidence/phase-5/prod/story/story-2026-11-20T05-33-35-041Z.json`, `screens/l01–l34`.
- On-chain checks: `verify-ana.json` and `verify-ben.json`.

| Item | Value |
|---|---|
| Venue | "QE Lena's café 05:33" `0x8C03352aCAd63441F929a1295cdbAC357E6C86B8`. Slider 20 → `rewardBps 2000`, min $0.50. Registered in 1.9 s, already `onchain` at the dashboard. |
| Owner / payout | `0xa78CEDaE0f89d1abc53741Df0152C2E394FA9940` |
| Ana / Ben | `0x5554a3AC6f950D784f9D11361eDE5D86B4d3a1A2` / `0xEf782e50324FE9f5c20E03273f82d9D8e69077c0` |
| In-app top-ups ($3.00 each, from the demo cap) | Ana `0x5f3082a7cde5bd23dd7ec614b43bf57dacd40742ad05938eed32e7aa1dabe87a` (3.16 s to a usable pay button). Ben `0xa1cbaeaf97cd8c6a844248ccb96c87402227be428e78994e42855c55184dec38` (1.50 s). Cap afterwards: $21.00 left today (UTC). |
| Ana pays $1.00 (first visit, no recommendation) | `0x7b656f0962a658af39fd7a692718f7d81fb0c7522687eecc4d0f58505aed41b0`, block 73139010, fee $0.00602 |
| Ben pays $1.00 (saved Ana's link, picked "Ana") | `0x24407f3a4ce2846cad025094b2f901cfcd20ce83b1ef923596af97b1942ba948`, block 73139077, fee $0.00804 |

**Exact on chain** (Arc RPC receipts; USDC Transfer logs into and out of Vouch, decoded independently of the api):

| Pay | In | Out | Expected at 20% | Exact |
|---|---|---|---|---|
| Ana $1.00 | 1.000000 | venue payout 1.000000 | plain first purchase → all to the venue | ✔ |
| Ben $1.00 | 1.000000 | Ben 0.050000 · Ana 0.110000 · venue payout 0.840000 | pool 0.20 → cashback 25% 0.05 · L1 55% 0.11 · L2 20% 0.04 returned (Ana has no introducer) → venue 0.80 + 0.04 | ✔ |

The hosted `/venues/<v>/payments` and `/stats` agree exactly: 2 payments, 2 verified customers, rewards paid $0.16, returned $0.04, venue $1.84, `source: streams`.

**Tap → settled** (the app's `__vouchTimings`; SSE `payment.settled`):

| Pay | Face ID | Relay | Tap → pending | Tap → settled | Counter "Paid" | Projector feed | Ana's "just arrived" toast |
|---|---|---|---|---|---|---|---|
| Ana | 37 ms | 492 ms | 562 ms | **1415 ms** (settle 840 ms after pending, via SSE) | 1787 ms | 1494 ms | n/a |
| Ben | 53 ms | 533 ms | 629 ms | **1413 ms** (settle 783 ms, via SSE) | 1787 ms | 1482 ms | 1505 ms |

**Audits.** 29 audited screens:
- 0 banned words, including accessible names.
- 0 money-format errors, 0 raw base units, 0 targets under 44 px.
- 0 console, page or request errors.
- Reduced motion: 0 running animations.
- The only flag is l21 with "2 primaries". That is the selected "Who sent you here?" chip using the ink fill, the same Info as in Phase 3, so it is not a finding.
- The `GET /payments/:intentId` cross-check returned 401: the session was no longer attached when the script read it. This is the test harness, not the app, and the chain + `/payments` feed checks above cover it.

**Spend:**
- Relayer gas: about $0.023 (venue registration, Ben's save of the link, 2 pays).
- Demo cap: 2 in-app top-ups ($6.00).
- Plus the probe venue (about $0.0045).

## 9. P4 video stage on production (`e2e/phase5/p4-stage.mjs`)

How to use it: `e2e/phase5/P4_README.md`. Evidence: `docs/evidence/phase-5/prod/p4/` (`p4-build.json`, `b01–b06`, `present-*`, `present-check.json`).

**Build, 05:42–05:44Z: PASS** (`--build`, headless).

| Item | Value |
|---|---|
| Venue | **Lena's Corner** `0x18235a7735DE0D4dC077E52fE8dBf0fFedc15581`, 20% / min $0.50. Owner and payout Lena `0xBD030510813C2260Ff053c30Fcc52E0a3E4805a8`. Registration `0x3ca4ef1b…548a`. |
| Priya | `0x0CFc6fEfbe073Ce671d97e31fEaB3b94b79a9211`. DEPLOYER $3 `0x22eec6e3…f175`. Paid $1.00 `0x1a1696a17cb2414c33c86120d54a9dd8a8f50497c09299fe1584912293d76fa0`. |
| Ana | `0x5A8736a5926ED00Ebb867F6361f82DC3AE7e0994`. Saved Priya's link `0x5648d2af…7bb5`. DEPLOYER $3 `0x09f579f1…5a69`. Paid $2.00 `0x0a295b304d7214f33631d168919cf9bcfdf106a565ac0b52253e5392b26d2179`. |
| Ben's link | **https://vouch-ubc.vercel.app/i/4gh0y7xmW**: Ana, personal, active, terms v1 (20%), expires 2026-11-27 |

**Chain checks (all ✔):**
- Priya's pay: 1.00 → venue payout.
- Ana's pay: 2.00 in = Σ out. Ana 0.10, Priya 0.22, venue 1.68 (the 0.08 L2 share returns to the venue because Priya has no introducer).
- `introducerOf(venue, Ana) == Priya` and `introducerOf(venue, Priya) == 0`.
- Hosted stats: 2 payments, 2 verified, gross $3.00, rewards $0.32.

So Ben's live $2.00, as a fresh customer who picks Ana, will pay **pool $0.40 → Ben $0.10 · Ana $0.22 · Priya $0.08 · venue $1.60**.

The owner dashboard at 1440 shows the Ana → Priya graph and both payments (`b05`).

**Present check, 05:48Z: PASS** (`--present --check-seconds 20`, headed).
- The saved owner and Ana profiles reopened signed in. Their wallets are in "gated" mode, the re-added virtual passkeys passed a real WebAuthn assertion, and the api session was valid.
- W1's counter tab shows the keypad, and the dashboard shows both payments. W2 shows Ana's wallet ($1.10, "thanked Priya").
- The W3 QR decodes independently (jsQR) to Ben's link.
- Automation bar A/B, measuring `innerHeight` in an 800×700 persistent window: Playwright's default args give 561 px (bar shown), ours give 613 px (no bar). Dropping `--enable-automation` alone gives 508 px, because Chromium then shows an "unsupported flag" bar on the startup tab; `--test-type` removes it.
- macOS `screencapture` has no Screen Recording permission here (it captured only the wallpaper), so the A/B measurement is the evidence.

**Headless re-verify, 05:51Z: READY** (`--verify`).
- The human asked that agents run nothing headed, so `--verify` was added. It reopens the saved profiles headless, re-adds the passkeys, and runs the same checks: wallet, WebAuthn assertion, session, counter keypad, feed and Ana's wallet.
- Every check passed. The QR in `verify-w3-ben-link-qr.png` decodes to Ben's link. Evidence: `verify-check.json`, `verify-*.png`.
- Agents run only `--build` and `--verify` from now on. `--present` stays headed and is for the human only.

**Spend (P4):**
- First build attempt (05:40Z) **failed** at Ana's DEPLOYER top-up: the Arc RPC returned 429 inside the CLI before it sent anything. It had spent $3.00 + gas (Priya #1) and $0.0148 relayer gas. It left an unused venue "Lena's Corner" `0xD5c384c26860EA330Cba37112BD71A0f7B490E03`.
- The script now retries the CLI only when nothing was sent. The CLI tops up to a target, so a retry can't double-pay.
- Second build: DEPLOYER $6.0037, relayer $0.0228.
- Total for P4: DEPLOYER **$9.0055** ($34.0074 → $25.0019), relayer about $0.0376, demo cap **$0** (POST /demo/topup is blocked in build contexts).

**Findings:**

| ID | Sev | Owner | Finding |
|---|---|---|---|
| P5-03 | Low | UI_DESIGN | At ≥1024 px (`lg`), the owner dashboard shows **Take an order** only in the empty state (`VenueDashboardScreen.tsx` GraphEmpty / PhoneLayout footer). Once there are payments, the 1440 projector layout has no way to the counter. Workaround in `--present`: W1 tab 2 is `/venue/<v>/counter`. VIDEO_SCRIPT 0:24 ("Laptop: Take an order") should read "counter tab". |
| P5-04 | Info | FRONTEND_INTEGRATION | The pay sheet's "Who sent you here?" chip and split row read **"A friend"** until `/ambassadors/<addr>` resolves the name, a short moment after the quote enables Confirm. It was seen in the P4 build (Ana's sheet showed "A friend +$0.22"); after a settle it reads the name. On camera, wait a beat for "Ana" before tapping. |
