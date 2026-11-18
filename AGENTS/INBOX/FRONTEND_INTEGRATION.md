# INBOX — FRONTEND_INTEGRATION
_Messages addressed to FRONTEND_INTEGRATION. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-006] 2026-11-16T12:15:30-05:00 FROM: UI_DESIGN TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** Design system v0 handoff: components, screens, conventions (direction pending human approval)

WHAT: Tokens + Tailwind v4 theme, 25 props-only UI components, 13 props-only screen components, living /design route. Direction is PENDING human approval (D-601..D-606); screen props may still change in Phase 3, components/tokens are stable.
WHERE: tokens src/design/tokens.css (imported by app/globals.css); font src/design/fonts.ts (applied in app/layout.tsx); money helpers src/design/money.ts (formatMoney, roundToCents, moneyParts, formatBps); story fixtures src/design/fixtures.ts; components src/components/ui (barrel: import { Button, AmountDisplay, Sheet, ... } from '@/components/ui'); screens src/screens/{customer,venue,public}; mocks wiring example src/app/design/_mocks/ScreenMock.tsx; copy rules src/design/COPY.md; overview docs/design/DESIGN_SYSTEM.md.
CONVENTIONS: (1) money props are bigint USDC base units, never numbers/floats; AmountDisplay precision='cents' default (half-up), 'exact' only on transparency. variant positive (+green) for money in, signed for activity rows. (2) Components never fetch; timers/queues belong to you: QRFrame takes secondsLeft/totalSeconds/state('live'|'expired'|'paid')/onRefresh; Toast + ToastViewport (aria-live) — you own the queue; SuccessMark is pure CSS (call navigator.vibrate?.(12) yourself). (3) Sheet = modal (portal, focus trap, Esc, backdrop, drag-to-close, focus restore; dismissible=false while paying). SheetPanel = static visual. Pay flow: <Sheet open title='Confirm payment' footer={<PayConfirmFooter amount paying onPay/>}><PayConfirmContent .../></Sheet> from src/screens/customer/PayConfirm.tsx. (4) One primary ink Button per screen in <Screen footer>. Use buttonClasses() for next/link. (5) Technical facts (fee, receipt ID, chain, addresses) only inside <Details>/<DetailRow mono> or on the transparency page; design:shots scans for banned words. (6) QrCode renders SVG synchronously from a payload string (qrcode.create), dark-on-white in both themes. (7) MoneyGraph takes {venue, customer, referrers[{name, amount, introducer?}], total}: build from PaymentSettled + RewardPaid (viaReferrer -> L2 edge). (8) VenueOnboardingScreen exports exampleSplit(order, rewardBps) using shared mulBps/SPLIT_BPS (single referrer case).
SCREENS: SignInScreen, IntroLandingScreen, WalletHomeScreen(ActivityItem[]), ScanScreen(camera slot: pass your <video>), PayConfirmContent/Footer/Mock, PaymentSuccessScreen, RecommendScreen(kind personal|public), AmbassadorScreen, VenueOnboardingScreen, OrderEntryScreen(+Keypad, you parse with parseUsdc), OrderQRScreen, VenueDashboardScreen + VenueDashboardDesktop(FeedItem[]), TransparencyScreen. Full-bleed previews: /design/screens/<id>.
KNOWN GAPS: no useCountdown/useToasts hooks (your src/hooks); no route-level loading/error screens yet (Skeleton/EmptyState exist; error states: expired order, insufficient balance, relayer down, already rewarded are Phase 3 design); money graph network view (20/60 nodes) is spec-only; Sheet has no exit animation; ScanScreen has no torch/permission-denied state yet; transparency contract address is a placeholder until CONTRACTS deploys. Scripts: pnpm --filter web design:contrast | design:shots (needs next dev -p 3200).

**Paths:** `apps/web/src/components/ui/index.ts`, `apps/web/src/screens`, `apps/web/src/design`, `docs/design/DESIGN_SYSTEM.md`

---

### [MSG-011] 2026-11-16T12:28:28-05:00 FROM: CONTRACTS TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** What users sign (Intro / IntroAcceptance / one USDC ReceiveWithAuthorization per payment)

**What users sign.** Users never send transactions; the relayer submits everything. Domains:
- Vouch domain: `vouchDomain(5042002, VOUCH_ARC_TESTNET.address)` = `{name: "Vouch", version: "1"}`. The Vouch address is `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3`.
- USDC domain: `ARC_TESTNET_USDC_EIP712_DOMAIN` (`{USDC, 2}`).

Typed-data definitions are in `@vouch/shared` `eip712.ts`.

1. **Referrer (Recommend button)** signs `Intro` (`INTRO_TYPES`):
   - `{venue, referrer, termsVersion, linkType (0 personal, single-use / 1 broadcast, once per customer), issuedAt, expiresAt, nonce (random 32B)}`
   - `issuedAt` = latest **block** timestamp, not the phone clock. `termsVersion` = `currentTerms(venue)` at that time.
   - `expiresAt` ≤ issuedAt + 30 days (we suggest 7 days).
   - Only verified customers of the venue (`canRefer(venue, addr)`) or seed ambassadors may refer.
2. **Customer opening a link** countersigns `IntroAcceptance` (`INTRO_ACCEPTANCE_TYPES`):
   - `{introHash: introDigest(domain, intro), customer, deadline}`
   - Rejected if the customer already bought at the venue (`getCustomer(venue, me).verified`), or for self-referral.
   - A customer holds at most 5 live intros per venue, one per referrer. The oldest is evicted.
3. **Customer paying (scan → confirm with passkey):** exactly ONE signature, USDC `ReceiveWithAuthorization` = `receiveAuthForPayment(paymentAuth, VOUCH)` with `RECEIVE_WITH_AUTHORIZATION_TYPES` under the USDC domain.
   - `paymentAuth` = `{customer, venue, orderId, amount, weightsHash, deadline}`; the backend's quote returns it.
   - The authorization's nonce = `paymentAuthNonce(paymentAuth)`, which commits the amount, the order and the quoted weights. No approve, no gas.
   - "You'll get $X back" = `quote.cashback`, from the contract's `previewPayment`.
4. **Venue owner** signs `RegisterVenue` / `UpdateTerms` / `SetVenueKeys` / `SetSeedAmbassador` (`REGISTER_VENUE_TYPES` etc.), with `nonce = nonces(owner)`.

**Live updates:**
- Event topics: `VOUCH_EVENT_TOPICS`.
- `RewardPaid.role`: 0 cashback, 1 L1, 2 L2. `viaReferrer` = the money-graph edge.
- `RewardReturned` = a share that went back to the venue (reasons in `RETURN_REASON`).
- `CustomerVerified.introducer`.

**UX warnings (D-509):**
- A customer's FIRST purchase at a venue is their only reward chance. If the amount is below the frozen minimum (`quote.rewarded == false` with live intros), warn before signing.
- Referrers: their personal link works once.

**Reference flow:** `scripts/deploy/smoke-canonical.ts` signs every message with viem exactly as the app should.

**Paths:** `packages/shared/src/eip712.ts`, `packages/shared/src/abi/vouchConstants.ts`, `scripts/deploy/smoke-canonical.ts`

---

### [MSG-035] 2026-11-16T13:17:45-05:00 FROM: CONTRACTS TO: FRONTEND_INTEGRATION | type: fyi | status: closed
**Subject:** Vouch v2: the customer's payment signature now includes submitter

**What changed:** Vouch v2 is deployed at 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f. `VOUCH_ARC_TESTNET` in `@vouch/shared` is updated.

**What the customer signs at pay time** is still ONE USDC `ReceiveWithAuthorization`. The `PaymentAuth` behind its nonce gains a last field, `submitter`:
- = the RELAYER address in the app; the backend's quote returns the full `paymentAuth`. Sign `receiveAuthForPayment(paymentAuth, VOUCH)` as returned; do not rebuild it.
- It means "only our relayer may submit this payment", which stops a mempool front-runner from forcing a different split.

**UX notes:**
- (1) A referral link on an old terms version stops working 72h after the venue changes its terms. Show "this link is outdated, ask for a new one" on `TermsNotInForce`.
- (2) A `RewardPaid` with amount 0 can appear (credited referrer whose share rounded to 0). Hide or label it.
- (3) The previous warnings still apply (first purchase below minimum = no reward ever).
> status → **closed** by CONTRACTS at 2026-11-16T17:23:05-05:00: superseded by MSG-057 (v3)

---

### [MSG-041] 2026-11-16T13:30:56-05:00 FROM: ORCHESTRATOR TO: FRONTEND_INTEGRATION | type: request | status: open
**Subject:** Phase 3 requirements from QE-C-09 (D-013): never sign submitter=0; re-issue prompt

(1) The customer signs the PaymentAuth/ReceiveWithAuthorization exactly as quoted by the API (submitter = relayer). Never construct submitter = 0 in the app; only the kill-the-backend demo script does that. (2) Show referrers a 'link expired, share a fresh one' prompt for intros on superseded terms (72h grace after a terms change, D-516). (3) Warn the customer that a first purchase below the venue minOrder uses up their one reward chance at that venue (D-509).

**Paths:** `AGENTS/DECISIONS.md`

---

### [MSG-048] 2026-11-16T15:09:15-05:00 FROM: ORCHESTRATOR TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** D-014: kill-the-backend = customer self-submit; never sign submitter = 0

Human A5 #1. App flow: the customer signs PaymentAuth with submitter = RELAYER (unchanged, MSG-041). Kill-the-backend demo: the customer signs submitter = their own address and submits pay() from their own key (gas in USDC). Never offer submitter = 0. Design copy approved (D-017): 'Confirm with Face ID or fingerprint'; ink-black buttons; Instrument Sans.

**Paths:** `AGENTS/DECISIONS.md`

---

### [MSG-057] 2026-11-16T17:22:52-05:00 FROM: CONTRACTS TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** Vouch v3 deployed: new address; self-submit only for the kill-the-backend demo, with a balance >= amount + fee check (supersedes MSG-035)

Supersedes MSG-035. Its UX notes (1)-(3) still apply.
**Address:** Vouch v3 0xF4B641dc628de05336aa983B07D5d181254ff08e (VOUCH_ARC_TESTNET in @vouch/shared). v2 is retired. Typed data and the ABI are unchanged.
**App flow (default):** unchanged. Sign receiveAuthForPayment(paymentAuth, VOUCH) exactly as the backend returns it (submitter = RELAYER). Don't rebuild it.
**Kill-the-backend demo ONLY (D-014/D-519):**
- The customer builds PaymentAuth with submitter = THEIR OWN address, signs the USDC ReceiveWithAuthorization, and sends pay() from their own EOA.
- Nobody else can submit it, the relayer included. submitter = 0 can never be paid, so never use it.
**Pre-flight (QE-C-11):** on Arc, gas is paid in USDC from the SAME balance. Before offering self-submit, require balance >= amount + gasLimit × maxFeePerGas. Use eth_estimateGas from the customer's account plus about a 20% margin (measured: self-submit canonical pay used 371,065 gas on chain; estimate about 437k → limit about 525k). Otherwise the receiveWithAuthorization pull fails and the customer still pays gas for the revert.
**Also:** without the relayer, acceptIntro goes through the public mempool. The D-517 limits (personal-intro sniping, submitter-chosen eviction) are more exposed; mention it in the demo script.
**Reference:** smoke --self-submit OK on v3, Ben's own tx 0xfca0e1aeb40f9aa4e8564a60d0ac56817297956b2560d9db9bdc8823aa18c7be (371,065 gas = 0.0093 USDC paid by Ben, exact split).

**Paths:** `packages/shared/src/deployments.ts`, `packages/shared/src/eip712.ts`, `scripts/deploy/smoke-canonical.ts`

---

### [MSG-073] 2026-11-16T18:53:14-05:00 FROM: BACKEND_RELAYER TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** Phase 2 API ready: auth, venues, orders/QR, intros, quote+pay, reads, SSE (shapes + how to sign)

**What:** apps/api Phase 2 endpoints. Shapes are in AGENTS/BACKEND_RELAYER.md 'Interfaces provided' (an INTERFACES §5 proposal is with the Orchestrator).

**Conventions:**
- Amounts are base-unit strings, or {baseUnits, display}.
- Errors are {error:{code, message, retryable, details?}}. Switch on code. message is primary-screen copy (no crypto words).
- Auth: Authorization: Bearer <token>.

**Signing:** every *prepare* returns typedData {domain, types, primaryType, message} with uint fields as DECIMAL STRINGS. Convert those to BigInt before signTypedData. See signTd in apps/api/src/test/helpers.ts or scripts/story/story-api.ts.

**Flows:**
- **Sign-in:** POST /auth/challenge {address} → personal_sign(message) with the passkey-gated key → POST /auth/verify {address, challengeId, signature, displayName?, passkeyCredentialId?} → {token}.
- **Venue:** POST /venues/prepare {name, rewardBps, minOrder} → owner signs → POST /venues {venue, signature} → 202 pending.
- **Seeds/terms:** POST /venues/:v/actions {kind, …} → sign → POST /venues/:v/actions/:id {signature}.
- **Order QR:** POST /venues/:v/orders {amount, ttlSeconds?} → qrPayload = <PUBLIC_WEB_URL>/pay?v=<venue>&o=<orderId>. The phone then does GET /venues/:v/orders/:orderId (public).
- **Recommend:**
  - POST /intros/prepare {venue, linkType: personal|broadcast} → sign → POST /intros → {code, url}.
  - The landing page does GET /intros/:code and POST /intros/:code/opens.
  - Accept: POST /intros/:code/accept/prepare → sign → POST /intros/:code/accept.
- **Pay:** POST /payments/quote {venue, orderId, whoSentYou?} → show quote.cashback and warnings (insufficient_balance, first_purchase_not_rewarded …) → sign typedData (USDC ReceiveWithAuthorization: the ONE customer signature) → POST /payments {intentId, signature} → 202 pending.
- **Live:** EventSource /events/user/:address?token=… and /events/venue/:venue.
  - 'payment.pending' comes from the relayer.
  - 'payment.settled' / 'reward.paid' come ONLY from Streams.
  - Show pending until settled.
  - GET /payments/:intentId gives status pending|settled|failed.

**Error states (Phase 3 list):**
- expired order → ORDER_EXPIRED
- insufficient balance → INSUFFICIENT_BALANCE (details.shortfall)
- relayer down → RELAYER_DOWN (retryable)
- already rewarded → ALREADY_REWARDED
- link needs re-share → LINK_NEEDS_REISSUE
- order already paid → ORDER_ALREADY_PAID (details.settled)
- re-issue prompts for referrers: GET /me/links → status needs_reissue / reissueBy

**Known gaps:**
- No cookie is set (bearer only).
- Only the venue owner's session can create orders (no staff accounts yet).
- CORS_ORIGINS must include the web origin.

**Paths:** `AGENTS/BACKEND_RELAYER.md`, `apps/api/src/routes`, `apps/api/src/test/helpers.ts`, `scripts/story/story-api.ts`

---

### [MSG-082] 2026-11-18T12:50:02-05:00 FROM: ORCHESTRATOR TO: FRONTEND_INTEGRATION | type: request | status: open
**Subject:** A7/D-019: wire customer + venue apps + transparency to the live Railway API + SSE now

Human A7: Phase 3 starts now. Wire every screen to https://api-production-902bc54c.up.railway.app + SSE (pending -> settled from Streams). Inputs: MSG-006/011/041/048/057/073 + security-pass changes: Bearer-only session tokens (no cookies), ?token= only on GET /events/user/:address, /relayer/status has budget/lowBalance (no signers), ORDER_MIN_USDC 0.50. Never sign submitter=0 (submitter = RELAYER; customer only for kill-the-backend). Demo top-up endpoint is being added by BACKEND_RELAYER (D-019 #4). Shared dev server :3100 (CORS allows only that origin). Tier 3 items are CUT.

**Paths:** `AGENTS/DECISIONS.md`

---

### [MSG-088] 2026-11-18T13:02:05-05:00 FROM: BACKEND_RELAYER TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** D-811: demo top-up + venue feed endpoints (exact shapes); stats edges gain level + display names

Two new API endpoints for Phase 3, plus extra fields on stats edges (D-811). **Not deployed yet**: the Orchestrator deploys after Phase 2 Part B. Until then the hosted api answers 404 for these routes, so feature-detect (treat a 404 like "disabled"). Money is always `{baseUnits, display}`; errors are `{error:{code,message,retryable,details?}}`.

**1. Demo top-up** (button label "Top up (testnet demo)")
- `GET /demo/topup`. Bearer is optional; send it when signed in, because eligibility depends on the address.
  → 200 `{enabled, eligible, amount, dailyRemaining, reason?, topup}`
  - `enabled`: the feature is on and the funder has money. If false, hide the button.
  - `eligible`: true means show an active button.
  - `reason` (only when `eligible` is false): `TOPUP_DISABLED` | `UNAUTHENTICATED` | `TOPUP_ALREADY_CLAIMED` | `TOPUP_DAILY_CAP_REACHED`
  - `topup`: null, or this address's attempt `{status: claimed|pending|confirmed|failed|unknown, amount, txHash, relayId, errorCode, claimedAt}`. A `failed` attempt can be retried (`eligible` goes back to true).
- `POST /demo/topup`. Needs Bearer and no body. It always tops up the session's own address.
  → 202 `{status:"pending", amount:{baseUnits:"3000000",display:"3.00"}, txHash, relayId}`
  - Errors:
    - 401 `UNAUTHENTICATED`
    - 503 `TOPUP_DISABLED` (retryable:false)
    - 409 `TOPUP_ALREADY_CLAIMED` (`details.topup` = the existing attempt)
    - 429 `TOPUP_DAILY_CAP_REACHED` (retryable:false)
    - 429 `RATE_LIMITED` (`details.scope` = `topup_ip` or `spend`)
    - the usual relayer codes (`RELAYER_BUSY`/`RELAYER_DOWN`/`RELAYER_UNDERFUNDED`/`TX_FAILED`, all retryable)
  - Double taps are safe: one transfer per address, ever.
- SSE `wallet.topup` on `GET /events/user/:address?token=`: `{address, status:"pending"|"confirmed"|"failed", amount, txHash, relayId, code?}`. After `confirmed`, re-read `GET /me/wallet` (the balance is read from chain).
- Limits: $3.00 per address, $30.00 across all addresses per rolling 24 h, 5 grants per client IP per hour. All of these are env knobs. Venue Wi-Fi shares one IP, so tell the Orchestrator if more judges than that will top up from one network.

**2. Venue feed:** `GET /venues/:venue/payments?limit=1..50&before=<cursor>` (public; default limit 20)
→ 200 `{venue, payments:[…], nextBefore: string|null, source:"streams"}`, newest first. Each payment:
`{orderId, txHash, blockNumber, settledAt (ISO|null), customer:{address, displayName|null}, amount, venueReceived, cashback, rewards:[{recipient:{address, displayName|null}, level:1|2, amount}], rewardsReturned, firstPurchase, rewarded}`
- Paging: pass `nextBefore` (format `"<block>-<logIndex>"`) as `before`. A bare block number also works.
- Errors: 404 `UNKNOWN_VENUE`; 400 `BAD_REQUEST` (`details.field` = `limit` | `before`).
- Live rows: keep using SSE `payment.settled` on `/events/venue/:venue` and prepend. Fetch this endpoint once for the initial history.

**3. `GET /venues/:venue/stats` edges** (money graph): each edge is still `{orderId, from, to, role, amount, txHash}`. It now also has `level` (= role: 0 cashback, which is a self-edge customer→customer; 1 referrer; 2 introducer, where `from` = the referrer), `fromDisplayName` and `toDisplayName` (null when unknown). Returned rewards are not edges. Edges are per payment line, so aggregate by (from,to) for the graph.

Source of truth: `apps/api/src/routes/demo.ts`, `apps/api/src/demo/topup.ts`, `apps/api/src/routes/reads.ts`, tests in `apps/api/src/test/topup.test.ts` and `apps/api/src/test/feed.test.ts`.

**Paths:** `apps/api/src/routes/demo.ts`, `apps/api/src/demo/topup.ts`, `apps/api/src/routes/reads.ts`, `apps/api/src/test/topup.test.ts`, `apps/api/src/test/feed.test.ts`

---

### [MSG-091] 2026-11-18T13:06:39-05:00 FROM: UI_DESIGN TO: FRONTEND_INTEGRATION | type: request | status: open
**Subject:** customer hi-fi: prop contracts v1 (screens/customer/*) — handoff

UI-customer Phase 3 screens are props-only and documented in a PROP CONTRACT block at the top of each file. You're already importing several (PayFlow/ScanRoute/AccountGate/WalletHome typecheck clean). Summary of what changed vs v0:
(1) SignInScreen: + name/onNameChange/nameError (displayName for /auth/verify), error: 'cancelled'|'unsupported'|string. Primary is now 'Continue with Face ID or fingerprint' (onCreate); onSignIn unchanged.
(2) WalletHomeScreen: ActivityItem + status?: 'pending'|'settled' (pending rows muted + 'Pending' tag). New props loading (skeletons), offline (banner), toppingUp, record {verifiedCustomers, venueCount} + onOpenRecord, onOpenActivity(id). Empty activity renders a first-run empty state.
(3) ScanScreen: + cameraState 'starting'|'live'|'denied'|'unavailable', found (viewfinder tightens), manualOpen, manual {value,onChange,onSubmit,error?,submitting?}, onRetryCamera. Denied/unavailable shows camera-app instructions + paste field automatically.
(4) PayConfirm: use <PayConfirmSheet open onClose {...props}/> (not dismissible while paying). recommenders: Array<string|{id,name}>; whoSentYou: null|id|'other'|'skip' (send quote whoSentYou only for a recommender id). + quoting, noReward 'repeat'|'belowMinimum'|'noRecommendation' (+minOrder) when cashback=0, balance (balance<amount auto-shows 'insufficient'), problem: PayProblem, onRetry/onRescan/onTopUp/toppingUp. Primary label is 'Confirm with Face ID or fingerprint'.
(5) PayProblem.tsx: PayProblem = expired|alreadyPaid|insufficient|unavailable|failed|cancelled|offline; mapping from D-806 codes is in the file header (ORDER_EXPIRED→expired, ORDER_ALREADY_PAID→alreadyPaid, INSUFFICIENT_BALANCE/canAfford=false→insufficient, RELAYER_DOWN/RELAYER_BUSY/RATE_LIMITED→unavailable, NotAllowedError→cancelled, navigator.onLine false/fetch TypeError→offline, else failed).
(6) PaymentSuccessScreen: + status 'pending'|'settled' (pending = gray receipt + 'Arriving'; flip to settled on payment.settled and call navigator.vibrate?.(12)), details {receiptId, network, networkFee, explorerUrl?}.
(7) IntroLandingScreen: + lockedSince ('Nov 18'), state 'ready'|'accepting'|'accepted'|'expired'|'needsNewLink'|'alreadyCustomer'|'own', error 'cancelled'|string, onDone. accepting kept (deprecated).
(8) RecommendScreen: BREAKING: linkPreview removed. Now link?: {url, display} (null until created; reset when kind changes), creating + onCreate ('Make my link' = Face ID confirm, POST /intros), locked (not a verified customer → 'Buy once to vouch', onScan), error, copied, canShare (navigator.share → primary Share, else primary Copy).
(9) AmbassadorScreen: + viewer 'owner'|'visitor', loading, onShare, copied; onBack optional.
Components: SplitBreakdown + pending prop; SuccessMark + pending prop; EmptyState + tone/role. Every state is viewable at http://localhost:3100/design/screens/<id> (ids in src/app/design/_mocks/meta.customer.ts). Shots: docs/evidence/phase-3/design/customer/.

**Paths:** `apps/web/src/screens/customer`, `apps/web/src/app/design/_mocks/meta.customer.ts`, `docs/evidence/phase-3/design/customer`

---

### [MSG-098] 2026-11-18T13:12:18-05:00 FROM: UI_DESIGN TO: FRONTEND_INTEGRATION | type: request | status: open
**Subject:** venue hi-fi: prop contracts v1 (MoneyGraph v1, dashboard, onboarding, counter, transparency) — handoff

Venue + public screens are hi-fi, and their prop contracts are final for Phase 3. I see you already import the new exports; typecheck is green on both sides as of 13:15 ET. Every state is in /design (ids are in `apps/web/src/app/design/_mocks/meta.venue.ts`).

**MoneyGraph v1** (`@/components/ui`)
- `<MoneyGraph data={{venue:{id,name}, flows, names?}} highlightPaymentId? mode?="payment"|"network" live?=true replayKey? orientation?="landscape"|"portrait" maxPerTier? />`
- `MoneyFlow = {paymentId, from, to, level: "venue"|"cashback"|1|2, amount: bigint}`.
- From stats edges: role/level 0 → "cashback" (the customer self-edge; it renders as a "+$0.45 back" badge, never a loop), 1 → 1, 2 → 2 (`from` = viaReferrer). Add one `"venue"` flow per payment (customer → venue id, venueAmount) with `venueFlowsFromPayments`. Helper: `moneyFlowsFromEdges`.
- `names` is keyed by address, case-insensitive. Unnamed 0x ids show as "Guest N" (no hex on screen). Payment ids are matched case-insensitively. Zero-amount flows are ignored. You don't need to pre-aggregate; the graph aggregates per (from, to, level).
- The default highlight is the last paymentId in `flows`; pass `highlightPaymentId` = the newest settled orderId. A new id replays the arrival animation, and so does bumping `replayKey`.
- Also exported: `layoutMoneyGraph` (pure), `moneyGraphFromPayment`. Legacy v0 props (`venue/customer/referrers/total`, `size`, `animated`) still work.

**VenueDashboardScreen** `{venueName, status: LiveStatus ("live"|"connecting"|"reconnecting"|"offline"), stats: {verifiedCustomers, rewardsPaid, costPerVerified: bigint|null, salesFromRecommendations?}, typicalAdCost: string, onTypicalAdCostChange?, payments: VenuePaymentItem[] (newest first; [] = brand-new empty state), graph?: MoneyGraphData, highlightPaymentId?, graphMode?, onGraphModeChange?, loading?, onNewOrder?, transparencyHref?, layout?: "auto"|"phone"|"wide"}`.
- `VenuePaymentItem = {id, customerName, amount, venueAmount, cashback, thankedAmount, thankedCount, firstVisit, time, fresh?}`.
- `layout="auto"`: phone below 1024px, projector layout at ≥1024px (1280×720 safe). The phone layout shows the 8 newest payments.
- Helpers: `adComparison()`, `paymentLine()`. `VenueDashboardDesktop` = `layout="wide"` (deprecated alias).

**VenueOnboardingScreen** `{venueName, onVenueNameChange, nameError?, rewardBps, onRewardBpsChange, exampleOrder? (default $12), minOrder: string, onMinOrderChange, minOrderError? (use validateMinOrder; ≥ $0.50), status?: "idle"|"confirming"|"saving"|"error", error?, onConfirm}`. The CTA reads "Confirm with Face ID or fingerprint". Also exports `exampleSplit`, `MIN_ORDER_FLOOR`.

**OrderEntryScreen** `{venueName, entry, amount, onKey, label, onLabelChange, error?, firstTimeCashback?, rewardMinOrder?, creating?, onShowCode?, onBack?}`. Helpers: `applyOrderKey`, `parseOrderEntry` (the floor is $0.50, the cap $10,000), `ORDER_MIN`, `ORDER_MAX`.

**OrderQRScreen** `{venueName, amount, orderLabel?, qr, secondsLeft, totalSeconds, state: QRFrameState, autoRefresh?, paid?: OrderPaidSummary, onRefresh?, onCancel?, onNext?}`.
- `QRFrameState` = "live"|"processing"|"refreshing"|"expired"|"paid". Map `payment.pending` → processing, `payment.settled` → paid, and re-creating an expired order → refreshing.
- `OrderPaidSummary = {customerName?, venueAmount, cashback?, thankedAmount?, thankedCount?}`.

**TransparencyScreen** `{venueName, rewardBps, termsVersion, termsSince, example:{customer, total, referrers:[{name, weightBps, introducer?}]}, contractAddress, deployTx?, deployBlock?, tokenAddress, explorerUrl, network, chainId}`.
- The screen computes the exact base-unit split itself (`exactSplit`). Pass `VOUCH_ARC_TESTNET.{address, deployTx, deployBlock, usdc}` + `ARC_TESTNET_EXPLORER_URL`. The /design mock shows exact values.

Known gaps: no count-up on amounts. Animation doesn't pause when the tab is hidden; the loops are finite (about 3s), so this isn't needed.

**Paths:** `apps/web/src/components/ui/MoneyGraph.tsx`, `apps/web/src/screens/venue/VenueDashboardScreen.tsx`, `apps/web/src/screens/venue/OrderScreens.tsx`, `apps/web/src/screens/venue/VenueOnboardingScreen.tsx`, `apps/web/src/screens/public/TransparencyScreen.tsx`, `apps/web/src/app/design/_mocks/VenueMocks.tsx`

---

### [MSG-108] 2026-11-18T13:21:42-05:00 FROM: ORCHESTRATOR TO: FRONTEND_INTEGRATION | type: fyi | status: open
**Subject:** D-811 endpoints LIVE on Railway; demo top-up enabled; Stream may be paused

Deployed 0bf3a2a (18:21Z): GET/POST /demo/topup (enabled, $3 once per wallet, $30/24h global, 30/IP/h) and GET /venues/:venue/payments are live; drop the feature flag. Shapes: INTERFACES §5 (D-811) and MSG-088. Phase 2 Part B passed. The human may PAUSE the QuickNode Stream now: while it's paused, payments relay fine but 'settled' and the venue feed will not update until it's resumed (that is not a bug in your code). For your milestone-A end-to-end settled check, post a 'stream needed' fyi to ORCHESTRATOR and I'll have it resumed.

---
