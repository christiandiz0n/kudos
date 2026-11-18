# INBOX — ORCHESTRATOR
_Messages addressed to ORCHESTRATOR. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-005] 2026-11-16T11:46:38-05:00 FROM: CONTRACTS TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: Design for testability: CONTRACTS_QE will verify the receiveWithAuthorization payee path _(re: MSG-004)_

Ack. The USDC pull is isolated in ONE internal function Vouch._pullPayment(customer, amount, deadline, nonce, sig), which calls USDC.receiveWithAuthorization(bytes overload) with to = address(this). Tests use contracts/test/mocks/MockFiatTokenV2_2.sol, which enforces the FiatTokenV2_2 payee check (msg.sender == to) with the same revert strings, plus a fork test (contracts/test/VouchFork.t.sol, rpc alias arc_testnet). Full details follow in the CONTRACTS -> CONTRACTS_QE handoff packet.
> status → **closed** by ORCHESTRATOR at 2026-11-16T12:16:39-05:00: ack; noted for CONTRACTS_QE brief

---

### [MSG-007] 2026-11-16T12:15:31-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: question | status: closed
**Subject:** Human approval needed: Vouch visual direction (gate before Phase 3 hi-fi)

Please ask the human to approve or redirect the design direction. Evidence: docs/evidence/phase-1/design/ (start with desktop-01-direction.png, screen-05-pay-confirm.png, screen-06-success.png, desktop-venue-dashboard.png) or run next dev -p 3200 and open /design. Decisions to confirm: (1) D-601 warm paper neutrals + ink-black primary buttons + ONE deep green accent reserved for money-to-people (alternative: green primary buttons). (2) D-602 Instrument Sans. (3) D-603 split-receipt + loupe signature motif. (4) Passkey copy says 'Face ID or fingerprint' rather than 'passkey' (default; Android wording is covered by 'fingerprint'). (5) L2 introducer placeholder names Marco and Sofia (D-606). (6) Optional: next.config devIndicators:false to hide the Next 'N' badge in demos (FRONTEND/ARCHITECT owns next.config; my screenshots hide it via CSS). Default if no answer: proceed with the documented direction in Phase 3.

**Paths:** `docs/design/DESIGN_SYSTEM.md`, `docs/evidence/phase-1/design`
> status → **closed** by ORCHESTRATOR at 2026-11-16T15:09:15-05:00: see MSG-043

---

### [MSG-022] 2026-11-16T13:03:59-05:00 FROM: CONTRACTS_QE TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: Human requirement: prove receiveWithAuthorization is called by the payee contract _(re: MSG-003)_

MSG-003 PROVEN. USDC receiveWithAuthorization is invoked only by the payee contract (msg.sender == to == Vouch). Each item is proven three ways: on the faithful mock (QePayeeAuth.t.sol, 13/13), on the REAL Arc USDC bytecode on a fork (QeForkPayee.t.sol, 7/7, VOUCH_FORK=true), and live on Arc Testnet with read-only eth_call (no tx, no funds).
(a) pay(): expectCall count 1 with exact args (to=Vouch, validAfter 0, validBefore=deadline, nonce=hashStruct(PaymentAuth)); lastReceiveCaller == Vouch; exact split; on the fork, the native 18-dec delta == 6-dec x 1e12.
(b) Calling USDC directly with the customer's REAL valid signature reverts 'FiatTokenV2: caller must be the payee' for the relayer, an attacker, the customer itself, payout, owner and the token (both overloads). The identical call from Vouch succeeds. LIVE on the deployed 0xfEe6…b2d3: from 0x…dEaD and from the customer -> 'caller must be the payee'. Simulated from Vouch, the same call passes the payee and signature checks and fails only on balance; a value-0 authorization from Vouch returns success.
(c) Attacker as payee, transferWithAuthorization, cancelAuthorization, and a second Vouch deployment (same venue id, validly signed order) all fail with 'FiatTokenV2: invalid signature' (also LIVE for attacker-as-payee). No Vouch function other than pay() calls the pull (expectCall count 0).
(d) Front-run cancelAuthorization (both overloads), or the nonce consumed by a transferWithAuthorization: pay reverts 'authorization is used or canceled'. Balances of all 7 parties, stats, customer state, intros and the order flag are unchanged, and no events are emitted. The same order then settles with a re-signed auth (mock + fork).
(e) Independent keccak == paymentAuthNonce == the nonce USDC marks used (LIVE: the deployed paymentAuthNonce equals my keccak). Each of the 6 fields was changed while the venue re-signed a matching order, so ONLY USDC rejects ('invalid signature'). This holds on the mock, on the fork, and in a 1,000-run fuzz.
Separately, the review found 2 blockers unrelated to MSG-003 (QE-C-01 front-run forced fallback, QE-C-02 payout==Vouch funds stuck). Details are in docs/qa/phase-1-contracts-qe.md and MSG-014..MSG-021.

**Paths:** `docs/qa/phase-1-contracts-qe.md`, `docs/evidence/phase-1/contracts-qe/live-arc-eth-call.txt`, `contracts/test/qe/QePayeeAuth.t.sol`, `contracts/test/qe/QeForkPayee.t.sol`
> status → **closed** by ORCHESTRATOR at 2026-11-16T13:30:56-05:00: MSG-003 evidence accepted (mock 13/13, fork 8/8, live eth_call on v2); relayed to the human in the Phase 1 report

---

### [MSG-051] 2026-11-16T15:13:30-05:00 FROM: CONTRACTS TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: A5 #1 / D-014: v3 submitter rule (RELAYER or customer, no submitter=0); size check first, no deploy until QE _(re: MSG-045)_

Implemented option (a), msg.sender == auth.submitter, as D-519. Runtime 24,036 -> 23,998 B (578 B margin); option (b) would have been 24,042 B. No deploy, nothing committed. Builder forge suites: 101/0 fail. Full suite: 179 pass, 2 fail, 2 skipped; both failures are QE-owned v2 pins in QeV2Reattack (MSG-046 sent to CONTRACTS_QE). Fork: builder 5/5; QE 7/8, where the failing one is the v2 deployed-bytecode pin. EIP-712, ABI and events are unchanged. Full report in the session handback.

**Paths:** `contracts/src/Vouch.sol`, `AGENTS/DECISIONS.md`
> status → **closed** by ORCHESTRATOR at 2026-11-16T15:15:21-05:00: builder result verified by the Orchestrator (23,998 B / 578 B margin; 179 pass, 2 QE-owned v2 pins fail by design); independent CONTRACTS_QE launched

---

### [MSG-067] 2026-11-16T18:42:39-05:00 FROM: STREAMS_INFRA TO: ORCHESTRATOR | type: fyi | status: closed
**Subject:** Phase 2 Streams ingestion done: hash equality on real v3 data; filter untouched; commit needed for Railway

**Phase 2 STREAMS_INFRA done** (uncommitted; Railway only sees it after your commit). Full report goes back through the agent handoff.

**Results:**
- `pnpm -r typecheck` clean.
- Tests: api 34/34, scripts 13/13, shared 10/10.
- `streams:verify` on real v3 data (72605845..72612484, 48 logs): chain-backfill == live (29 signed webhook POSTs incl. retries + overlap) == replay == replay-in-place == rebuild = `0b0c880d…5c1f34`.

**Frozen filter:** `docs/streams/filter-vouch.js` is untouched, as you asked. Your test-filter expectations match the frozen filter exactly; I added 72606174 (CustomerVerified@53, PaymentSettled@69, RewardPaid@70–74). They are in runbook §P.1 and `infra/streams/stream-vouch-prod.json`, and a test keeps them in sync.

**After you commit + Railway redeploys:**
1. `/health` should come up; boot runs both migration folders.
2. When the Stream is live: `railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:verify --db`.

**INTERFACES proposals:** in my report (§4 / §6 / a new StreamsPort section).

**Paths:** `AGENTS/STREAMS_INFRA.md`, `docs/streams/S3-RUNBOOK.md`, `infra/streams/stream-vouch-prod.json`
> status → **closed** by ORCHESTRATOR at 2026-11-18T12:14:09-05:00: committed e90c49d; deployed to Railway; hash checks re-verified by QE

---

### [MSG-069] 2026-11-16T18:52:43-05:00 FROM: BACKEND_RELAYER TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: Phase 2 requirements from QE-C-09 (D-013): submitter, owner nonces, link re-issue _(re: MSG-040)_

Done. (1) PaymentAuth.submitter = the RELAYER EOA in every app quote; the code refuses 0 (asserted, tested); self-submit mode names the customer. (2) Owner actions are prepared and signed only at the current nonces(owner); submit re-reads the nonce and answers 409 OWNER_NONCE_STALE if it moved; only one action in flight per owner; nothing future-nonce is ever queued (D-804). (3) Superseded-terms links: GET /intros/:code and GET /me/links report status active + reissueBy (effectiveAt(next)+72h) and then needs_reissue; accept/prepare answers LINK_NEEDS_REISSUE. (4) The pay gas cap is 1.2M (estimate x 1.2 must be <= the cap; worst case >= 804,619); the self-submit fee pre-flight uses a 900k bound.

**Paths:** `apps/api/src/routes/venues.ts`, `apps/api/src/routes/intros.ts`, `apps/api/src/config.ts`
> status → **closed** by ORCHESTRATOR at 2026-11-16T18:57:21-05:00: accepted

---

### [MSG-070] 2026-11-16T18:52:43-05:00 FROM: BACKEND_RELAYER TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: D-014 supersedes D-013(1): submitter is RELAYER (app) or the customer (self-submit); never 0 _(re: MSG-047)_

Ack. The app path signs submitter = RELAYER. A kill-the-backend helper exists: POST /payments/quote {mode: 'self-submit'} returns PaymentAuth.submitter = customer plus the QE-C-11 pre-flight (balance >= amount + 900k x maxFeePerGas, else 402). The API never relays those intents and never produces submitter = 0. The api runs on Railway with PORT honoured; relayer secrets are env-only (names in .env.example).

**Paths:** `apps/api/src/routes/payments.ts`
> status → **closed** by ORCHESTRATOR at 2026-11-18T12:14:09-05:00: accepted (D-014)

---

### [MSG-077] 2026-11-16T21:07:57-05:00 FROM: QE_E2E TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: QE Part B target changed: verify S3 against the production Vouch Stream (D-015) _(re: MSG-049)_

Ack. Phase 2 Part A ran against the production Stream state: the hosted derived reads equal an independent chain re-derivation over 72605845..72624473 (72 events, 3 venues). Part B (live delivery) waits for the Stream to be ACTIVE and the hosted relayer to be enabled.
> status → **closed** by ORCHESTRATOR at 2026-11-18T12:14:09-05:00: Part B run against the production Stream in session 3 (Wed)

---

### [MSG-090] 2026-11-18T13:02:55-05:00 FROM: BACKEND_RELAYER TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: A7/D-019 #4: capped demo top-up endpoint for 'Top up (testnet demo)' _(re: MSG-083)_

Done (D-811), not deployed and not committed. The top-up is GET/POST /demo/topup: once per address (DB conditional upsert), a $30 rolling-24h global cap, a per-IP limit and a funder floor. It runs through the relayer queue or a TOPUP_PRIVATE_KEY Relayer, is exempt from the D-808 budget, and emits SSE wallet.topup. Also added: the venue feed GET /venues/:venue/payments, and level + display names on /stats edges. api 128/128; pnpm -r typecheck clean. Railway env names: DEMO_TOPUP_ENABLED=true (required to turn it on), optional DEMO_TOPUP_USDC / DEMO_TOPUP_DAILY_USDC / DEMO_TOPUP_PER_IP_PER_HOUR / DEMO_TOPUP_FUNDER_FLOOR_USDC, and secret TOPUP_PRIVATE_KEY (optional). Proposed INTERFACES text is in DECISIONS D-811. Shapes went to FRONTEND_INTEGRATION in MSG-088.

**Paths:** `AGENTS/DECISIONS.md`, `apps/api/src/demo/topup.ts`, `apps/api/src/routes/demo.ts`

---

### [MSG-092] 2026-11-18T13:06:39-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: fyi | status: open
**Subject:** customer hi-fi 1–2 done

UI-customer: items 1-2 done (and 3-5 drafted). 28 customer screens/states at /design/screens/<id> on :3100; design:shots (DESIGN_BASE_URL=:3100 DESIGN_WHO=Customer) wrote 35 PNGs to docs/evidence/phase-3/design/customer/ with 0 banned words, 0 console errors, 0 tap targets <44px; contrast PASS. MSG-044 magnifier: SplitBreakdown now groups rewards into ≤3 slices (you / recommenders / who brought them in), one soft wedge, no hairlines, 3-column legend with big amounts. Ben's MoneyGraph self-loop is venue-owned (MoneyGraph) and is with UI-venue. Handoff with prop contracts sent to FRONTEND_INTEGRATION. Note: current web typecheck fails only in venue/FI files (app/design/_mocks/ScreenMock.tsx venue mocks vs new MoneyGraph/OrderEntry props; src/lib/views.ts imports FeedItem from VenueDashboardScreen) — mid-edit by the other instances, not mine.

---

### [MSG-093] 2026-11-18T13:07:37-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: Design direction APPROVED by the human (D-017) + required fixes before Phase 3 _(re: MSG-044)_

Customer part done (UI-customer): (c) magnifier is lightweight + projector-readable: SplitBreakdown groups rewards into ≤3 slices with one soft wedge and big-amount legend (D-607); (d) 'Confirm with Face ID or fingerprint' is the pay sheet's primary and the onboarding CTA, 'passkey' appears nowhere; (f) devIndicators:false is already in next.config.ts. Error states designed (D-608, 28 ids at /design/screens/<id>). Fix (1), Ben's cashback self-loop, lives in MoneyGraph, which is owned by UI-venue per D-019 #2; it will be answered from their side.

---

### [MSG-094] 2026-11-18T13:07:37-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: A7/D-019: Phase 3 hi-fi + Phase 4 visuals NOW, two instances (customer / venue) _(re: MSG-081)_

UI-customer: onboarding, wallet home in dollars with 'Top up (testnet demo)', scan-to-pay incl. camera denied, confirm sheet (cashback + 'Who sent you here?' + Skip), success (pending→settled), recommend/share (QR, share, copy, locked), intro landing, ambassador record are hi-fi with error/loading states. Contracts handed to FRONTEND_INTEGRATION (MSG-091). Shots: docs/evidence/phase-3/design/customer/.

---

### [MSG-095] 2026-11-18T13:07:37-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: Orchestrator sign-off on design system v0 (human approval pending via MSG-007) _(re: MSG-008)_

UI-customer: the error/edge states are designed (D-608; expired, already paid, insufficient with top-up, relayer down, failed, cancelled prompt, offline, camera denied, already rewarded, skeletons). The cashback self-loop is in MoneyGraph, owned by UI-venue (D-019 #2), so it's tracked there.

---

### [MSG-097] 2026-11-18T13:10:00-05:00 FROM: FRONTEND_INTEGRATION TO: ORCHESTRATOR | type: fyi | status: open
**Subject:** Milestone A working end-to-end on hosted api (+ most of B)

Two 390px browser contexts on :3100 (CDP virtual passkey with PRF, real D-104 code path): venue Lena onboarded (registered in 2.2s, venue 0x4b4917358c7AB0b757F02023Ae6E160eFeF3d8f4) -> counter $1.00 -> QR http://localhost:3100/pay?v=..&o=.. -> customer Ben opens the QR URL, onboards, funded via CLI topup (fund tx 0x7151f3193ab13bb3bf0207f7f14a9365c0a07664776b6d8d754304a0c9f05939) -> confirm -> 202 pending (relay 0.8s) -> payment.settled via user SSE 1.19s later (Streams) -> venue QR flips to paid via venue SSE, dashboard feed+graph update. Pay tx 0xb72fedff3c7f30b241f7405654274da0774ba5e8adefcdfe7c475df6efea3594. Driver: node --no-warnings apps/web/scripts/phase3-e2e.ts (writes docs/evidence/phase-3/e2e-*.json + e2e/*.png). Added dep viem 2.57.18 to apps/web (already in lockfile via @vouch/shared). Next: intros/recommend flow, transparency, shots.

**Paths:** `apps/web/scripts/phase3-e2e.ts`, `docs/evidence/phase-3`

---

### [MSG-099] 2026-11-18T13:12:18-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: fyi | status: open
**Subject:** [venue] MoneyGraph v1 + venue dashboard hi-fi done (items 1-2); 3-5 first pass in

Venue items 1–2 are done (also 3–5 in first pass); polish + evidence next.
- MoneyGraph v1: cashback self-loop removed (now a "+$0.45 back" badge), deterministic tiered layout (venue ← customers → recommenders → introducers), √amount edges, arrival choreography keyed on highlightPaymentId, reduced-motion final frame, "N more" folding at 7/column (4/row on phone).
- Playground: /design/money-graph, plus /design/screens/money-graph-{5,20,60}.
- Dashboard hi-fi (phone + projector at ≥1024px, 1280×720): live/reconnecting/offline/loading/empty states; cost per new customer vs an editable typical ad cost.
- Onboarding: name, slider with worked example, min order ≥ $0.50, Face ID or fingerprint.
- Counter: entry + QR with processing/refreshing/expired/paid.
- Transparency: base-unit worked example, rounding rule, v3 address + Blockscout links, six events, Streams.
No new deps. Handoff with prop contracts sent to FRONTEND_INTEGRATION (they're already wiring against them; typecheck green). Edited shared app/design files: ScreenMock.tsx (now a slim dispatcher), meta.ts (spreads VENUE_SCREENS), page.tsx (money-graph section copy).
Note: a python in-place write to MoneyGraph.tsx was missed by the :3100 watcher (stale server bundle → hydration mismatch). A normal edit fixed it. Mentioning it in case other agents see "stale SSR" mismatches.

**Paths:** `apps/web/src/components/ui/MoneyGraph.tsx`, `apps/web/src/app/design/money-graph/page.tsx`

---

### [MSG-102] 2026-11-18T13:14:24-05:00 FROM: FRONTEND_INTEGRATION TO: ORCHESTRATOR | type: fyi | status: open
**Subject:** Milestone B + C core working on hosted api (venue spine + referral loop)

phase3-e2e.ts run 18:13 ET, all on :3100 + Railway: venue onboard (registered 2.1s) -> counter QR -> Ben pays $1.00 (pay tx 0xc0750187e87620310dd2c48419435819a9fd50cd78e405ec109a60b7a705f53a, relay 0.58s, settled via SSE +0.90s, venue QR 'paid' 3.5s after tap) -> Ben 'Make my link' (personal) -> Cara opens /i/SlLZJF3P1 signed-out, onboards in place, saves recommendation (accept relayed 1.8s) -> Cara pays $1.00 (pay tx 0x6dd7ca178c9411714c499f8476153e0e43c9c0d6521487483b3ad36c4e033044, settled +0.66s): split venue $0.88 / Cara +$0.04 / Ben +$0.08; Ben's wallet shows +$0.08 + record 1 customer; dashboard feed/graph/cost-per-customer live. Evidence: docs/evidence/phase-3/e2e-2026-11-18T18-13-51-051Z.json + e2e/*.png. Next: phase3-shots (every route/state at 390px), docs. Demo top-up + venue feed are feature-detected (404 -> hidden/fallback) and need no client change when deployed.

**Paths:** `docs/evidence/phase-3`

---

### [MSG-103] 2026-11-18T13:18:43-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: Design direction APPROVED by the human (D-017) + required fixes before Phase 3 _(re: MSG-044)_

[venue] Venue-side MSG-044 items done. (1) The cashback self-loop under Ben is removed from MoneyGraph. Cashback is now a '+$0.45 back' badge on the customer node, and the role-0 self-edge is never drawn (D-612). Evidence: docs/evidence/phase-3/design/venue/1280-money-graph-5.png, 1280-venue-dashboard-desktop.png. (2) Lightweight, projector-readable magnifier on venue screens: onboarding uses big-type worked-example lines plus a two-part keep/rewards bar instead of the loupe (D-614). The customer-side magnifier is D-607. (3) Venue error/edge states: expired / refreshing / processing code, reconnecting / offline / loading / empty dashboard, invalid minimum order, failed save.

---

### [MSG-104] 2026-11-18T13:18:43-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: Orchestrator sign-off on design system v0 (human approval pending via MSG-007) _(re: MSG-008)_

[venue] Fixed: MoneyGraph v1 renders cashback as a '+$0.45 back' badge on the customer, with no loop (D-612). Screenshots are in docs/evidence/phase-3/design/venue/.

---

### [MSG-109] 2026-11-18T13:24:15-05:00 FROM: FRONTEND_INTEGRATION TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: Phase 3 requirements from QE-C-09 (D-013): never sign submitter=0; re-issue prompt _(re: MSG-041)_

Done: (1) never submitter=0: client guard lib/sign.ts assertSafePaymentTypedData refuses unless submitter == relayer (/relayer/status), != 0, != me, nonce == paymentAuthNonce(quote.paymentAuth) (D-903). (2) re-issue: wallet toasts 'Your link for X is out of date, share a fresh one' from GET /me/links needs_reissue; /i/<code> shows needsNewLink (status needs_reissue / LINK_NEEDS_REISSUE). (3) below-minimum first purchase: PayConfirm noReward='belowMinimum' passed; asked UI-customer (MSG-100) to make that copy an explicit warning that it uses up the one money-back chance.

---

### [MSG-110] 2026-11-18T13:24:15-05:00 FROM: FRONTEND_INTEGRATION TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: A7/D-019: wire customer + venue apps + transparency to the live Railway API + SSE now _(re: MSG-082)_

Done: customer + venue + transparency wired to Railway api + SSE on :3100. Live evidence docs/evidence/phase-3/e2e-2026-11-18T18-21-31-010Z.json (pays 0x6ad99748…65be8 and 0xc898e244…695f, settled via Streams SSE <1 s after relay), 60 screenshots in docs/evidence/phase-3/screens/. Details in AGENTS/FRONTEND_INTEGRATION.md.

---

### [MSG-114] 2026-11-18T13:28:13-05:00 FROM: FRONTEND_INTEGRATION TO: ORCHESTRATOR | type: fyi | status: answered
**Subject:** stream needed: Phase 3 screenshot pass blocked on Streams (venue.registered)

Final phase3-shots run (18:25Z) stalled: a new venue registration mined but venue.registered never arrived, so I assume the Stream is paused. Please resume the Stream; I'll re-run apps/web/scripts/phase3-shots.ts (≈80 s, one venue registration + one $3 demo top-up). Meanwhile I added a client fallback: after the registerVenue relay is mined, onboarding continues to the dashboard after 15 s even without Streams (payments still wait for Streams 'settled' by design). FYI D-811 verified live in-app: demo top-up from the pay sheet funded a fresh wallet in 2.9 s (tx 0x515cc6b80c455797485c103b811e9ba656b491d4032f2e92a6d7b83a591aa3f9), then pay 0x48b6322e06d76c22fce1ea769c353cbf14899ef881ca57d2c922152cded9166b settled via SSE +0.96 s (before the pause).

**Paths:** `apps/web/scripts/phase3-shots.ts`, `apps/web/src/app/venue/new/VenueNew.tsx`
> status → **answered** by ORCHESTRATOR at 2026-11-18T13:32:30-05:00: human asked to resume the Stream for the Phase 3 QE gate

---

### [MSG-122] 2026-11-18T14:46:50-05:00 FROM: FRONTEND_INTEGRATION TO: ORCHESTRATOR | type: fyi | status: open
**Subject:** Vercel readiness (web): env, CORS origin, passkey domain; QE-3 FE fixes done (uncommitted)

The web app is ready for Thursday's Vercel deploy from the frontend side. `pnpm --filter web build` passes. The client bundle has no secrets: 0 key/secret names, and the 20 unique 64-hex strings are all public (secp256k1 curve constants and the Vouch deploy tx). Full scan: docs/evidence/phase-3/fixes/fe/bundle-secret-scan.txt.

Vercel project settings (root apps/web, framework Next.js):
- `NEXT_PUBLIC_API_URL=https://api-production-902bc54c.up.railway.app`. Optional, since this is also the default. It is inlined at **build** time, so set it before the first build.
- `NEXT_PUBLIC_WEB_URL`: leave it **unset**. QR codes and share links then use the deployed page's own origin (D-901). Set it only to pin QR codes to the production domain while running the counter from a preview URL. A localhost value is ignored when the page isn't on localhost (D-907); checks are in config-origin-check.ndjson.
- Flags: none needed (auto).

Needs a human or the Orchestrator:
1. Add the Vercel production origin (and any preview origin you'll demo from) to Railway `CORS_ORIGINS`. Without it every api call fails from the deployed app.
2. Passkeys are bound to the hostname (rpId = page host). An account created on a preview URL won't open on the production domain. Run the phone checklist on the final domain only.
3. Add to Home Screen is ready: /manifest.webmanifest (name "Vouch", theme #f6f4ef), icons, apple-touch-icon and apple-web-app meta.

QE-3-01/03/05/08 are fixed (MSG-121) and uncommitted in the working tree, alongside UI_DESIGN's parallel edits.

**Paths:** `apps/web/src/lib/config.ts`, `apps/web/src/app/manifest.ts`, `docs/evidence/phase-3/fixes/fe/bundle-secret-scan.txt`, `docs/evidence/phase-3/fixes/fe/config-origin-check.ndjson`

---

### [MSG-125] 2026-11-18T14:55:33-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: [customer] Orchestrator review of Phase 3 shots: 2 small polish items _(re: MSG-096)_

Both done. (1) Cashback shows once, as '+$0.45 back' on the purchase row. The separate 'Money back' row was only in the /design fixture, and FE's live activity builder already emits it once; the contract now says so. (2) The demo note sits under Top up as one line: 'Simulated money for this demo. No card needed.' Also, long reward titles ('Chloe came on your recommendation') wrap to 2 lines instead of truncating (new ListItem titleLines). Shot: after-msg-096-wallet.png.

**Paths:** `docs/evidence/phase-3/fixes/ui/after-msg-096-wallet.png`, `apps/web/src/screens/customer/WalletHomeScreen.tsx`

---

### [MSG-126] 2026-11-18T14:55:33-05:00 FROM: UI_DESIGN TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: [venue] Orchestrator review of projector shots: 2 polish items (Thursday) _(re: MSG-107)_

Both done in MoneyGraph. (1) In dense landscape columns, the '+$0.45 back' badge is pinned to Ben's node at its upper-right, over his ring, so it no longer reads as an edge label. (2) Same-column arcs in the last column now bulge inward, into the gap before the column. The bulge is sized by node distance and capped at 30% of the column gap, so nothing leaves the card (portrait too). Before/after: {before,after}-msg-107-*.png.

**Paths:** `docs/evidence/phase-3/fixes/ui/after-msg-107-dashboard-projector-network.png`, `docs/evidence/phase-3/fixes/ui/after-msg-107-money-graph-60.png`, `apps/web/src/components/ui/MoneyGraph.tsx`

---
