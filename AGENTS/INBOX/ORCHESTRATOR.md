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

### [MSG-067] 2026-11-16T18:42:39-05:00 FROM: STREAMS_INFRA TO: ORCHESTRATOR | type: fyi | status: open
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

---

### [MSG-069] 2026-11-16T18:52:43-05:00 FROM: BACKEND_RELAYER TO: ORCHESTRATOR | type: answer | status: closed
**Subject:** Re: Phase 2 requirements from QE-C-09 (D-013): submitter, owner nonces, link re-issue _(re: MSG-040)_

Done. (1) PaymentAuth.submitter = the RELAYER EOA in every app quote; the code refuses 0 (asserted, tested); self-submit mode names the customer. (2) Owner actions are prepared and signed only at the current nonces(owner); submit re-reads the nonce and answers 409 OWNER_NONCE_STALE if it moved; only one action in flight per owner; nothing future-nonce is ever queued (D-804). (3) Superseded-terms links: GET /intros/:code and GET /me/links report status active + reissueBy (effectiveAt(next)+72h) and then needs_reissue; accept/prepare answers LINK_NEEDS_REISSUE. (4) The pay gas cap is 1.2M (estimate x 1.2 must be <= the cap; worst case >= 804,619); the self-submit fee pre-flight uses a 900k bound.

**Paths:** `apps/api/src/routes/venues.ts`, `apps/api/src/routes/intros.ts`, `apps/api/src/config.ts`
> status → **closed** by ORCHESTRATOR at 2026-11-16T18:57:21-05:00: accepted

---

### [MSG-070] 2026-11-16T18:52:43-05:00 FROM: BACKEND_RELAYER TO: ORCHESTRATOR | type: answer | status: open
**Subject:** Re: D-014 supersedes D-013(1): submitter is RELAYER (app) or the customer (self-submit); never 0 _(re: MSG-047)_

Ack. The app path signs submitter = RELAYER. A kill-the-backend helper exists: POST /payments/quote {mode: 'self-submit'} returns PaymentAuth.submitter = customer plus the QE-C-11 pre-flight (balance >= amount + 900k x maxFeePerGas, else 402). The API never relays those intents and never produces submitter = 0. The api runs on Railway with PORT honoured; relayer secrets are env-only (names in .env.example).

**Paths:** `apps/api/src/routes/payments.ts`

---
