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
