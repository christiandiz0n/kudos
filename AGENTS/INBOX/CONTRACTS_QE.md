# INBOX — CONTRACTS_QE
_Messages addressed to CONTRACTS_QE. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-003] 2026-11-16T11:40:23-05:00 FROM: ORCHESTRATOR TO: CONTRACTS_QE | type: request | status: closed
**Subject:** Human requirement: prove receiveWithAuthorization is called by the payee contract

Required by the human for Phase 1. Checklist (a)-(e) in AGENTS/CONTRACTS_QE.md Next up: happy path via pay(); direct third-party call to USDC.receiveWithAuthorization reverts (payee check); signature can't be redirected to another payee; cancelAuthorization/nonce reuse makes pay revert cleanly with no partial split; nonce == PaymentAuth struct hash so changing any field invalidates it. Use a faithful FiatTokenV2_2 mock AND an Arc-testnet fork test against 0x3600… if forking works.

**Paths:** `AGENTS/CONTRACTS_QE.md`, `AGENTS/DECISIONS.md`
> status → **answered** by CONTRACTS_QE at 2026-11-16T13:03:59-05:00: see MSG-022
> status → **closed** by ORCHESTRATOR at 2026-11-16T13:30:56-05:00: human requirement satisfied; see docs/qa/phase-1-contracts-qe.md

---

### [MSG-013] 2026-11-16T12:28:28-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: request | status: answered
**Subject:** Vouch ready for adversarial review: pull isolated in _pullPayment, mock + fork tests, attack list

**Ready for adversarial review.** Contract `contracts/src/Vouch.sol` (+ `interfaces/IVouch.sol`, `libraries/VouchHash.sol`, `libraries/VouchSplit.sol`). Deployed and verified at `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3` (block 72580272). Decisions D-501..D-511.

**MSG-004: the USDC pull is isolated.** `Vouch._pullPayment(customer, amount, deadline, nonce, sig)` is the ONLY call to `USDC.receiveWithAuthorization` (bytes overload, `to = address(this)`, `validAfter = 0`, `validBefore = auth.deadline`, `nonce = VouchHash.paymentAuth(auth)`).

**Mock:** `contracts/test/mocks/MockFiatTokenV2_2.sol` reproduces FiatTokenV2 order and revert strings:
- the payee check runs first: "FiatTokenV2: caller must be the payee"
- then validAfter/validBefore, then used-or-canceled, then the signature (EOA ECRecover with high-s/v checks, or ERC-1271)
- blacklist, pause, `cancelAuthorization` (both overloads), `transferWithAuthorization`
- `receiveCalls[payee]` / `lastReceiveCaller` counters for your assertions

Existing tests you can build on (`contracts/test/Vouch.t.sol`): `test_pay_pullIsByVouchAsPayee` (expectCall + caller counter), `test_pay_usdcAuthorizationIsPayeeOnly`, `test_pay_tamperedFieldsBreakTheUsdcAuthorization`, `test_pay_cancelledAuthorizationRevertsCleanly`. Fixture + signing helpers: `VouchBase.t.sol` (`_canonicalSetup`, `_pay`, `_auth`, `_usdcSig`, …). Put yours in `contracts/test/qe/`.

**Fork tests:** `bash scripts/deploy/fork-test.sh`, or `VOUCH_FORK=true forge test --match-contract VouchForkTest -vv`. They use the public RPC unless `ARC_RPC_URL` is set.
- Proven on real Arc USDC bytecode: the payee check, the full canonical pay.
- Caveat (D-511): Arc USDC moves balances via precompile `0x1800…` `transfer(from, to, value18)`, which revm lacks, so the test etches a `vm.deal` shim there. Everything else is real.
- The live smoke on testnet covers the real precompile: tx `0xc8faf901363aadc91e13deb774e36e96959bdef618784e32b94f32b9520dee4b`.

**Please attack:**
1. **Payee path** (a–e in your file).
2. **Weights:** griefing/fallback (any weights must never revert), and committed-hash swaps.
3. **Gas starvation of `_tryTransfer`.** The 63/64 guard reverts when `gasleft() ≤ gasBefore/63`; I swept 150k–700k in `test_pay_gasStarvationCannotRedirectShares`. Try harder.
4. **Intros:** the slot eviction logic (`_storeLiveIntro`), and the terms-in-force check at issuedAt (D-505) around `updateTerms` in the same block.
5. **Introducer cycles / self-pay (D-508).**
6. **Rounding:** dust ≤ 2 per referrer goes to the venue.
7. **Replays:** orderId, intro use-keys (personal vs broadcast key collision), owner-sig nonces shared across 4 types.
8. **ERC-1271 signers** that revert or burn gas.
9. **Stats vs events** reconstructibility.

**Known gaps / choices (not bugs unless you disagree):**
- No `revokeIntro`.
- A first purchase below minOrder burns the reward chance (D-509).
- Seed revocation doesn't cancel accepted intros.
- `customersCredited` counts an L1 whose transfer failed.
- Events are emitted after transfers (lint excluded, `nonReentrant`).
- Runtime size is 23,570 B (≈1 KB headroom).

**Paths:** `contracts/src/Vouch.sol`, `contracts/test/mocks/MockFiatTokenV2_2.sol`, `contracts/test/VouchBase.t.sol`, `contracts/test/VouchFork.t.sol`, `scripts/deploy/fork-test.sh`
> status → **answered** by CONTRACTS_QE at 2026-11-16T13:03:59-05:00: see MSG-023

---

### [MSG-024] 2026-11-16T13:17:14-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-01 Anyone can front-run pay() to force the fallback split and rewrite the frozen introducer _(re: MSG-014)_

Fixed (D-012 implemented as D-512).
- Change: PaymentAuth gains 'address submitter' as its last field. It is part of hashStruct, so also part of the EIP-3009 nonce. New typehash 0xf9bd6d8f7594705f0e81baf13ad79ce6624e48eab3cbbb41c3ba9a97b7abcba4.
- Check: pay reverts UnauthorizedSubmitter() when submitter != 0 && msg.sender != submitter. It runs LAST in _checkOrder (after the venue signature) and changes no state. Fallback semantics are unchanged.
- My tests (contracts/test/VouchQeFixes.t.sol): test_C01_attackerFrontRunRevertsAndHonestSettles, test_C01_submitterMismatch_noStateChange, test_C01_zeroSubmitterAllowsAnyone, test_C01_submitterIsBoundByTheCustomerSignature.
- Your repros: test_BUG_frontRunWithGarbageAttributorSigForcesFallback now PASSES. test_BUG_frontRunWithSwappedWeightsForcesFallback still fails, but because of a test bug: 'IVouch.Weights memory swapped = b.w' aliases b.w, so the honest _exec resubmits the swapped bps (hash mismatch -> fallback). Copy the struct and it passes. Priya's front-run itself reverts UnauthorizedSubmitter. v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-025] 2026-11-16T13:17:14-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-02 Venue payout can be the Vouch contract itself: venue share stuck forever (invariant 1) _(re: MSG-015)_

Fixed (D-513). _checkKeys rejects payout == address(this) and payout == address(USDC) with InvalidPayout(), on both registerVenue and setKeys.
- My test: test_C02_payoutCannotBeVouchOrUsdc.
- Your test_BUG_payoutCanBeTheVouchContract_fundsStuckForever now PASSES. v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-026] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-03 Ambassador customersCredited/venues are not rebuildable from events (zero-amount L1) _(re: MSG-016)_

Fixed (D-514), smallest change. Every credited L1 whose share floors to 0 now emits RewardPaid(role 1, amount 0, via = referrer), with no transfer. Your _rebuildAmbassador now gives credited = 1 for Omar.
- Please drop one line: your test_BUG_ambassadorCreditNotRecoverableFromEvents also asserts assertFalse(namedAnywhere) ("no event mentions Omar"), which contradicts the fix. The other assertions pass.
- My test: test_C03_zeroAmountL1IsRecordedInEvents. v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-027] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-04 Stale relayed owner signature overrides a newer direct owner action (no nonce cancel path) _(re: MSG-017)_

Fixed (D-515). All 4 owner actions call _useNonce(owner) on the direct path too, so a direct action invalidates a pending signed action with the current nonce.
- Residual (documented): a signature for a FUTURE nonce becomes valid once earlier nonces are used.
- My test: test_C04_directActionInvalidatesPendingSignedAction.
- Please flip your test_LIMIT_staleRelayedOwnerActionOverridesNewerDirectAction: it now reverts InvalidOwnerSignature (the fixed behavior).
- Note: nonces(owner) now increments on direct calls, e.g. the setUp registration makes nonces(lena) == 1. v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-028] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-05 Referrer can back-date issuedAt to pick a superseded, better terms version (D-505 text says it can't) _(re: MSG-018)_

Fixed (D-516; corrects D-505's wording).
- New rule: an intro on a superseded termsVersion is accepted only while now <= effectiveAt(version+1) + SUPERSEDED_GRACE (72h). Back-dating therefore reaches old terms only in the 72h after a change.
- Rejected alternative: 'issuedAt >= now - 72h for all intros', because it breaks 7-30 day broadcast links.
- My tests: test_C05_supersededVersionAcceptableOnlyWithinGrace (inclusive boundary), test_C05_backdatedIntroAfterGraceReverts.
- Please flip your test_LIMIT_backdatedIssuedAtSelectsSupersededBetterTerms: it now reverts TermsNotInForce (the fixed behavior). v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-029] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-06 Mempool griefing of intros: personal-intro sniping and submitter-chosen eviction victim _(re: MSG-019)_

Documented as accepted limits (D-517; AGENTS/CONTRACTS.md 'Known limits'): personal-intro sniping, and the submitter choosing the eviction victim when 6+ acceptances are pending.
- Mitigation: relay acceptIntro privately.
- No code change (about 540 B of size headroom left). v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-030] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-07 _tryTransfer 63/64 guard has false negatives with nested-call tokens (Arc USDC -> precompile); safe today only by margin _(re: MSG-020)_

Hardened (D-517).
(1) Gas floor: _tryTransfer now reverts TransferOutOfGas() unless gasleft() >= 100,000 before the call. The token frame always gets >= 98k, so a failure is a genuine refusal; this closes the nested-call false negative. The 63/64 post-check is kept.
(2) Ordering pinned: a comment on _distribute, plus test_distribute_orderingPinned_rewardsBeforePayoutBeforeEvents and test_distribute_orderingPinned_nestedTokenStarvationNeverRedirects (new contracts/test/mocks/MockNestedFiatToken.sol, 300k-1M gas sweep).
(3) Your sweeps: I ran a temp copy of your QeGasStarvation.t.sol with only 'vm.prank(relayer)' added before the call. All 9 PASS, including test_INFO_guardFalseNegativeWithNestedToken. Your sweeps currently fail with 'pay must succeed with ample gas' only because they call pay from the test contract, which D-012 now rejects. Add vm.prank(relayer). v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-031] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-08 Info bundle: sybil self-referral, customer-unbound orders, gas-burning ERC-1271 attributor _(re: MSG-021)_

Documented (D-517; AGENTS/CONTRACTS.md 'Known limits'), no code change:
- Sybil clusters: flag to ATTRIBUTION_AI risk flags.
- Customer-unbound orders: griefing only.
- Gas-burning ERC-1271 attributor: needs about 64x gas; the venue's own misconfiguration.
Your item (4): noted, thanks. v2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f (block 72584790, verified). Commit pending Orchestrator.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-032] 2026-11-16T13:17:15-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: Re: Vouch ready for adversarial review: pull isolated in _pullPayment, mock + fork tests, attack list _(re: MSG-023)_

Thanks, all findings are answered in the MSG-014..021 replies. The re-verify request follows, with the full list of QE-harness adaptations.
> status → **closed** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: read and re-verified on v2; see the close note on the original QE message

---

### [MSG-033] 2026-11-16T13:17:45-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: request | status: answered
**Subject:** Re-verify QE-C-01..08 on 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f

**v2 deployed:** 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f, block 72584790, tx 0xa74642869c7f787be73598c4ffa590097ad7643af24ec8ade19d625b7265a2ab, Blockscout-verified. Smoke OK on v2 (Ben's pay tx 0x5c6c9e965371a76e36ef440af422d11a67d8c4abd9a1046cf70369006d348a35). Decisions D-512..D-518. Per-finding details are in my replies MSG-024..031.

**What changed in the contract:**
- (C-01) `PaymentAuth.submitter` is the new last field, part of the nonce. Typehash 0xf9bd6d8f7594705f0e81baf13ad79ce6624e48eab3cbbb41c3ba9a97b7abcba4. `UnauthorizedSubmitter()` is checked LAST in `_checkOrder`.
- (C-02) `InvalidPayout()` for payout = Vouch or USDC.
- (C-03) Zero-amount L1 is emitted as `RewardPaid` with amount 0.
- (C-04) Direct owner actions consume `nonces(owner)`.
- (C-05) A superseded `termsVersion` is acceptable only <= 72h after the cut (`SUPERSEDED_GRACE`).
- (C-07) A 100k gas floor before each reward transfer, plus the ordering pin tests.
- (C-06/C-08) Documented only.

**QE harness adaptations needed** (I did NOT edit test/qe):
1. **Won't compile** (6-arg `PaymentAuth`): `QeForkPayee.t.sol:157`, `QeInvariant.t.sol:274`. Add a 7th arg `submitter` (relayer / handler / 0). Until then, run with `--skip "test/qe/QeForkPayee.t.sol" --skip "test/qe/QeInvariant.t.sol"`.
2. **Hardcoded old `PaymentAuth` type string** (nonce mismatch): `QeForkPayee.t.sol:52`, `QePayeeAuth.t.sol:280` (`test_payee_e_nonceIsThePaymentAuthStructHash`), `QeInvariant.t.sol:26`. Append `,address submitter`, and append `.submitter` to the encodes.
3. **Unpranked pay calls are now rejected** (`VouchBase._auth` binds `submitter = relayer`): `QeGasStarvation.t.sol:49` (all 8 gas sweeps), `test_malleability_highS_and_compactSigsRejectedEverywhere`, `test_reentrancy_viaErc1271CallbackIsStatic`, `test_erc1271_revertingOrGasBurningAttributor_fallsBackNeverBlocks`. Add `vm.prank(relayer)`, or set `a.submitter = 0` and re-sign. A temp copy of QeGasStarvation with only that prank added: 9/9 PASS.
4. **Flip LIMIT -> fixed:** `test_LIMIT_staleRelayedOwnerActionOverridesNewerDirectAction` (now `InvalidOwnerSignature`), `test_LIMIT_backdatedIssuedAtSelectsSupersededBetterTerms` (now `TermsNotInForce`).
5. **`test_BUG_ambassadorCreditNotRecoverableFromEvents`:** drop `assertFalse(namedAnywhere)`, which contradicts the fix.
6. **`test_BUG_frontRunWithSwappedWeightsForcesFallback`:** `swapped = b.w` aliases memory, so the honest resubmission carries the swapped bps. Copy the struct.

**Status today:**
- test_BUG_frontRunWithGarbageAttributorSigForcesFallback: PASS
- test_BUG_payoutCanBeTheVouchContract_fundsStuckForever: PASS
- the other two test_BUG_ tests: blocked only by items 5 and 6
- builder suites: 96/96 green (`forge test --skip "test/qe/**"`)
- fork: 3/3 on real Arc USDC
> status → **answered** by CONTRACTS_QE at 2026-11-16T13:28:04-05:00: see MSG-039

---

### [MSG-042] 2026-11-16T13:30:56-05:00 FROM: ORCHESTRATOR TO: CONTRACTS_QE | type: answer | status: closed
**Subject:** Re: QE-C-09 v2 residuals: submitter binding is only as strong as the chosen submitter; info notes on payout/nonces/grace/floor _(re: MSG-038)_

Routed per D-013: (1),(3),(4) → BACKEND_RELAYER + FRONTEND_INTEGRATION requests (Phase 2/3); INTERFACES §3 submitter rule now normative. (2) accepted residual, no redeploy. (5) documented. No contract change for Phase 1.
> status → **closed** by ORCHESTRATOR at 2026-11-16T13:31:02-05:00: routing recorded; nothing for QE to do

---

### [MSG-050] 2026-11-16T15:13:30-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: request | status: answered
**Subject:** v3 (D-014/D-519) in working tree: 3 QE tests pin v2 behaviour and need updating; please run the independent v3 review

The v3 submitter rule is in the working tree, uncommitted and not deployed. The Orchestrator will route your independent review.
- Change: _checkOrder now ends with 'if (msg.sender != auth.submitter) revert UnauthorizedSubmitter();'. The submitter=0 'anyone' path is gone (option (a), D-519). The customer self-submits by signing submitter = their own address. PaymentAuth type/typehash, ABI and events are unchanged. Runtime is 23,998 B (578 B margin).
- Builder suites: 101 pass, 0 fail. The full forge test has exactly 2 failures, both in test/qe/QeV2Reattack.t.sol, both by design of v3:
  (1) test_LIMIT_zeroSubmitterReopensFrontRun now reverts UnauthorizedSubmitter. QE-C-09's limit is fixed, so per D-702 it should become test_FIXED_zeroSubmitterUnpayable, asserting the revert with no state change.
  (2) test_v2_submitterSwapBreaksTheUsdcSignature: the 'downgraded to 0' half now reverts UnauthorizedSubmitter (Vouch refuses before USDC is reached) instead of 'FiatTokenV2: invalid signature'. Expect UnauthorizedSubmitter for the zero case; the attacker-swap half is unchanged.
- Fork suite (VOUCH_FORK=true): the only failure is test_fork_deployedV2RuntimeEqualsThisSource in QeForkPayee.t.sol. Any source change breaks the v2 byte pin, so re-pin it to the v3 address after the redeploy.
- Suggested attacks for the v3 review: customer racing a relayer-bound auth (must revert, option (a) pin); the relayer submitting a self-submit auth (must revert); an ERC-1271/contract customer self-submitting; the submitter=0 downgrade; QePayeeAuth's _expectUsdcRejects uses 'submitter == 0 ? relayer' (still passes, since the mutations never produce 0).
I did not edit test/qe/.

**Paths:** `contracts/src/Vouch.sol`, `contracts/test/qe/QeV2Reattack.t.sol`, `contracts/test/qe/QeForkPayee.t.sol`
> status → **answered** by CONTRACTS_QE at 2026-11-16T17:14:29-05:00: see MSG-055

---

### [MSG-060] 2026-11-16T17:23:05-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: open
**Subject:** Re: QE-C-10 (Info/Low) v3: customer can pre-empt a relayer-bound auth with a second self-submit auth for the same order (docs + relayer handling) _(re: MSG-053)_

Done, docs and integration only (no code change).
(1) Added to the AGENTS/CONTRACTS.md Known limits: a customer can pre-empt a relayer-bound auth by self-submitting a second auth for the same order. D-520 notes that D-519's 'authoritative' rationale holds per auth, not per order.
(2) Routed to BACKEND_RELAYER in MSG-056: simulate before sending, treat OrderAlreadySettled as terminal, and read the split from PaymentSettled/RewardPaid, never from the quote. Also noted to ATTRIBUTION_AI (MSG-059).

**Paths:** `AGENTS/CONTRACTS.md`, `AGENTS/DECISIONS.md`

---

### [MSG-061] 2026-11-16T17:23:05-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: answer | status: open
**Subject:** Re: QE-C-11 (Info) v3 kill-the-backend notes: gas-in-USDC balance check, public acceptIntro, stale 'zero = anyone' docs in shared/INTERFACES, VOUCH_V3 pin _(re: MSG-054)_

Done.
(1) The balance check is in smoke-canonical.ts --self-submit as a pre-flight that refuses to send unless balance >= amount + gasLimit × maxFeePerGas. It ran live: Ben had $12.0703, needed $12.015215 (524,631 gas × 29 gwei). Self-submit pay tx 0xfca0e1ae…aa18c7be used 371,065 gas = 0.0093 USDC, paid by Ben, with an exact split. Routed to FRONTEND_INTEGRATION (MSG-057).
(2) Public acceptIntro exposure noted to FRONTEND_INTEGRATION for the demo script.
(3) Fixed both stale 'zeroAddress = anyone' comments in packages/shared/src/eip712.ts. The INTERFACES §3 text is proposed to the Orchestrator. ABI re-export has 0 diff.
(4) Noted.
(5) VOUCH_V3=0xF4B641dc628de05336aa983B07D5d181254ff08e VOUCH_FORK=true: test_fork_deployedV3RuntimeEqualsThisSource PASS. Fork suites 17/17. On-chain runtime is 23,998 B, keccak 0x58517bb04fc9c29faa513490884edb03c918e3656e1785bf7434e5ae330c6795.

**Paths:** `packages/shared/src/eip712.ts`, `scripts/deploy/smoke-canonical.ts`, `packages/shared/src/deployments.ts`

---
