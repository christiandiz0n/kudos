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
