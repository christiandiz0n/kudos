# Phase 1 Contracts QE gate: adversarial review of `Vouch`

_CONTRACTS_QE, independent reviewer (did not write the contract). Run 2026-11-16. Target: `contracts/src/Vouch.sol` + `libraries/` + `interfaces/` (deployed `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3`, Arc Testnet, block 72580272, runtime 23,570 B). Raw outputs: `docs/evidence/phase-1/contracts-qe/`._
_Secrets: no command read or printed the root env file or any key. Signatures use test keys and one throwaway key derived from a public string. Testnet: read-only `eth_call`s only. No transactions were sent and nothing was spent._

## Final verdict (after re-verification on v2)

**PASS-with-findings.**
- v2 is `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f`, block 72584790. Its deployed runtime is byte-identical to the reviewed source.
- QE-C-01..08 are fixed or accepted as documented, and their messages MSG-014..021 are closed. The two v1 blockers are fixed.
- MSG-003 is re-proven on v2, including live on Arc.
- The full suite is green: **176 passed, 0 failed, 2 skipped (fork suites)**.
- One new low/info request is open: QE-C-09 (MSG-038). The submitter binding is only as strong as the chosen submitter: 0 or a public forwarder re-opens the front-run. It also bundles info notes on the payout guard, nonces, the grace window and the gas floor.
- Details are in **Re-verification (v2)** at the end of this document.

## v1 verdict (superseded)

**FAIL (gate-blocking), with two small fixes outstanding.** Everything else passes.

- **MSG-003 (human requirement): PASS.** Items (a)–(e) are proven against the faithful mock, against the real Arc USDC bytecode on a fork, and live with `eth_call` on Arc Testnet (below).
- The core money invariants hold under fuzzing, my own event-sourced invariant harness, and 1-gas-granularity gas-starvation sweeps:
  - Σ out == amount, and Vouch keeps nothing.
  - Reward ≤ amount × the frozen rate.
  - L1 goes only to eligible intro holders, and L2 only to their recorded introducers.
  - A customer is rewarded at most once per venue, and the introducer is frozen.
  - Replays revert.
  - Bad weights never revert a payment.
  - `previewPayment` == the settled split, to the base unit.
- **Two blockers are open:**
  - **QE-C-01:** anyone watching the mempool can front-run `pay()` with a bad attributor signature. That forces the fallback split, which moves L1 money between referrers and rewrites the frozen introducer.
  - **QE-C-02:** a venue's payout can be set to the Vouch contract itself, after which the venue's money is stuck forever (invariant 1).
- QE-C-01 conflicts with invariant 6 as worded, so ORCHESTRATOR or the human must either pick a fix or accept the risk.
- QE-C-03..08 are low/info hardening and documentation items.

## Findings

| ID | Sev | Inv. | Finding | Test (in `contracts/test/qe/`) | Msg | Status |
|---|---|---|---|---|---|---|
| QE-C-01 | **Med-High** (blocker) | 3, 6 (intent) | `pay()` is permissionless and its calldata is public. Anyone can re-submit the honest relayer's calldata with a garbage `attributorSig` (→ `FALLBACK_BAD_SIGNATURE`) or swapped bps (→ `INVALID`/`HASH_MISMATCH`). This overrides the attributor-signed weights the customer committed to in the USDC nonce. Demo: Priya, holding the newer personal intro, takes 792,000 instead of 198,000 of L1 and becomes Ben's introducer forever; the honest tx then reverts `OrderAlreadySettled`. | `QeWeights.t.sol` `test_BUG_frontRunWithGarbageAttributorSigForcesFallback`, `test_BUG_frontRunWithSwappedWeightsForcesFallback` (**FAIL**) | MSG-014 | open |
| QE-C-02 | Low impact (blocker: inv. 1) | 1 | `_checkKeys` accepts `payout == address(vouch)`. After that, every venue share is transferred from Vouch to Vouch and stays there. There is no sweep and no admin, so the funds are lost forever. One-line fix. | `QeEdges.t.sol` `test_BUG_payoutCanBeTheVouchContract_fundsStuckForever` (**FAIL**: 6,000,000 stuck) | MSG-015 | open |
| QE-C-03 | Low | events | `customersCredited`/`venues` count referrers whose L1 floors to 0, but no event names them. Per-referrer bps/termsVersion are never emitted. Every other stat rebuilds exactly from events. | `QeEvents.t.sol` `test_BUG_ambassadorCreditNotRecoverableFromEvents` (**FAIL**) | MSG-016 | open |
| QE-C-04 | Low | replay | Direct owner calls don't consume `nonces(owner)`, so an unsubmitted relayed owner signature stays valid and can undo a newer direct action (e.g. re-allow a revoked seed). There is no cancel path. | `QeReplaySignatures.t.sol` `test_LIMIT_staleRelayedOwnerActionOverridesNewerDirectAction` (pass, documents) | MSG-017 | open |
| QE-C-05 | Low | 8 (doc) | `issuedAt` is chosen by the referrer. Back-dating it selects a superseded, better terms version for up to 30 days after a rate cut. D-505's text says this can't happen. Existing intros stay frozen (inv. 8 holds). | `QeIntrosTerms.t.sol` `test_LIMIT_backdatedIssuedAtSelectsSupersededBetterTerms` | MSG-018 | open |
| QE-C-06 | Low | 7 | Mempool griefing. A personal intro can be sniped by an observer using their own acceptance. With several of the customer's acceptances pending, the submitter picks which referrer the 5-slot cap evicts. No third-party eviction is possible without the customer's signature. | `test_LIMIT_personalIntroCanBeSniped`, `test_LIMIT_submitterChoosesWhichReferrerIsEvicted` | MSG-019 | open |
| QE-C-07 | Info/Low | 1 (robustness) | The `_tryTransfer` 63/64 guard misses starvation when the token makes a nested call (Arc USDC → precompile): about 1/32 of the gas is left, which is more than 1/63. It is not exploitable today, because the work after any reward transfer needs far more than that. Exhaustive sweeps found 0 redirects. The safety rests on ordering, not on the guard. | `QeGasStarvation.t.sol` `test_INFO_guardFalseNegativeWithNestedToken` + 8 sweeps + fork sweep | MSG-020 | open |
| QE-C-08 | Info | 7 / misc | Three items. (1) Sybil: a second address the customer controls captures 100% of the pool; this is a documented limit. (2) Orders aren't bound to a customer, so anyone can pay one first with their own money (griefing). (3) A gas-burning ERC-1271 attributor makes `pay()` need about 64× the normal gas. | `test_LIMIT_sybilSecondAddressCapturesWholePool`, `test_erc1271_revertingOrGasBurningAttributor_fallsBackNeverBlocks` | MSG-021 | open |

`test_BUG_*` tests fail on the current code by design. They pass once the bug is fixed. `test_LIMIT_*`/`test_INFO_*` pass and document behaviour.

## MSG-003 evidence: `receiveWithAuthorization` is invoked by the payee contract

| Item | Mock (`QePayeeAuth.t.sol`) | Real Arc USDC on fork (`QeForkPayee.t.sol`, `VOUCH_FORK=true`) | Live Arc Testnet (`eth_call`) |
|---|---|---|---|
| **(a)** happy path through `pay`; the pull is called by Vouch with `to = this` | `test_payee_a_happyPath_pullCalledOnceByVouchWithToEqThis`: `expectCall` count **1** with exact args (`to=vouch, validAfter=0, validBefore=deadline, nonce=hashStruct`), `lastReceiveCaller == vouch`, `receiveCalls(relayer)==0`, Σ out == amount | `test_fork_a_payPullsAsPayee_exactSplit_nativeDecimals`: same `expectCall`, exact canonical split, `authorizationState` set, and native 18-dec delta == 6-dec × 1e12 (D-102) | — (no tx by design) |
| **(b)** a third party calling USDC directly with the customer's signature reverts on the payee check | `test_payee_b_thirdPartiesCannotRedeemTheCustomersAuthorization` (relayer, attacker, the customer, payout, owner, the token; both the `bytes` and `v,r,s` overloads) + control `test_payee_b_control_sameCallSucceedsOnlyFromThePayee` | `test_fork_b_thirdPartyRedeemWithRealSignatureFailsPayeeCheck` with a **real, valid** signature; the identical call pranked as Vouch succeeds | **Reverts:** `FiatTokenV2: caller must be the payee` (from `0x…dEaD` and from the customer). Control `--from Vouch`: passes the payee and signature checks and fails only on balance (`ERC20: transfer amount exceeds balance`); a value-0 authorization from Vouch **succeeds** (`0x`). See below. |
| **(c)** cannot be redirected to another payee or reused via another function | `test_payee_c_cannotRedirectToAnotherPayee`, `…cannotReuseThroughOtherUsdcFunctions` (TWA, cancel), `…anotherVouchDeploymentCannotRedeem` (same venue id, valid order sig), `…noOtherVouchFunctionCallsUsdcPull` (count 0 across every non-pay function) | `test_fork_c_signatureCannotBeRedirectedOrReused` (attacker as payee, TWA ×2, second Vouch) → `FiatTokenV2: invalid signature` | Attacker as payee → `FiatTokenV2: invalid signature` |
| **(d)** a front-run `cancelAuthorization` or a used nonce makes `pay` revert with no partial split | `test_payee_d_frontRunCancelAuthorization_bothOverloads_noPartialSplit` (balances of 7 parties, stats, customer state, intros and the order flag all unchanged; no events; the same order then settles with a re-signed auth), `…nonceAlreadyUsedByTransferWithAuthorization_noPartialSplit`, `…replayOfAUsedAuthorizationReverts` | `test_fork_d_frontRunCancelAuthorization_revertsCleanly` (+ recovery), `test_fork_d_nonceConsumedByTransferWithAuthorization_revertsCleanly` | `authorizationState(customer, nonce) = false` after all calls |
| **(e)** nonce == `hashStruct(PaymentAuth)`; changing any field invalidates it | `test_payee_e_nonceIsThePaymentAuthStructHash` (independent keccak == `paymentAuthNonce` == the nonce USDC marks used), `test_payee_e_everyFieldIsBoundByTheUsdcSignature` (all 6 fields; the venue re-signs a matching order so **only** USDC rejects), `testFuzz_payee_e_anyFieldMutationInvalidatesTheAuthorization` (1,000 runs) | `test_fork_e_everyPaymentFieldBoundByRealUsdcSignature` (6 fields → `FiatTokenV2: invalid signature`) | The deployed `paymentAuthNonce(auth)` == the independent `keccak` of the type string |

### Live Arc Testnet output (abridged; full output in `docs/evidence/phase-1/contracts-qe/live-arc-eth-call.txt`, script in `live-arc-eth-call.sh`)

```
chainId: 5042002   block: 72583589
Vouch (deployed): 0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3   USDC: 0x3600000000000000000000000000000000000000
throwaway customer: 0xD53Eaa12308fff482D0E39b7Ff82c68e6cf32E8b  (USDC balance: 0)
nonce (independent keccak):        0xd580240a763fc82800a7d14933ab3dc73f29aadd0f3c03a10d0389e76eed67af
nonce (deployed paymentAuthNonce): 0xd580240a763fc82800a7d14933ab3dc73f29aadd0f3c03a10d0389e76eed67af
  => equal (nonce == hashStruct(PaymentAuth))

### (b) third party (non-payee) redeems the customer's REAL signature for to=Vouch      [from 0x…dEaD]
  Error: execution reverted: FiatTokenV2: caller must be the payee
### (b) the customer itself calls it directly (also not the payee)
  Error: execution reverted: FiatTokenV2: caller must be the payee
### (c) attacker names itself as payee with the same signature
  Error: execution reverted: FiatTokenV2: invalid signature
### control: same call simulated FROM the payee (Vouch)
  Error: execution reverted: ERC20: transfer amount exceeds balance      (payee + signature checks passed)
### control: value 0 signature simulated FROM the payee (Vouch)
  0x   exit=0                                                            (fully valid when caller == payee)
### control: value 0 signature from a third party
  Error: execution reverted: FiatTokenV2: caller must be the payee
authorizationState(customer, nonce) after all eth_calls: false
```

## Attack coverage (beyond the builder's list)

| Theme | Result | Tests |
|---|---|---|
| Replay: orders, intros (personal after eviction, broadcast, linkType flip), USDC auths, owner signatures (nonce, cross-type/venue/chain, inclusive deadline) | PASS (+ QE-C-04) | `QeReplaySignatures.t.sol` `test_replay_*`, `QePayeeAuth` (d) |
| Malleability: high-s, EIP-2098 64-byte, v∈{0,1} for referrer, customer, venue signer and USDC; high-s attributor sig falls back | PASS | `test_malleability_*` |
| ERC-1271: always-valid referrer (still needs the customer's countersig), always-valid customer wallet (wallet bug, LIMIT), reverting/gas-burning attributor (fallback), re-entry via static callback | PASS | `test_erc1271_*`, `test_reentrancy_viaErc1271CallbackIsStatic` |
| Re-entrancy via token callback (hook-calling USDC model): a referrer re-enters `pay()` during its L1 transfer | PASS (`ReentrancyGuardReentrantCall`; the inner payment stays payable) | `QeEdges.t.sol` `QeReentrancyHookTest` |
| Cross-venue / cross-customer / cross-chain / cross-deployment intro reuse | PASS | `test_crossDomain_*` |
| Self-referral, sybil, cycles (customer is L2 of every referrer; A→B→C→A) | PASS (+ QE-C-08 sybil limit) | `QeIntrosTerms.t.sol` |
| Bad weights: duplicates, 0, >8,000, Σ≠10,000 (under/over), non-holder, verified-but-no-intro, 9,999 single, 6 referrers, length mismatch, 2,000-entry arrays; arbitrary fuzzed weights + sig bytes | PASS: never reverts, mode 4, Σ exact; execution gas within a normal pay (the calldata cost falls on the submitter) | `QeWeights.t.sol` (+ QE-C-01) |
| Gas starvation: 1-gas steps over [T−1500, T+200], 113-gas steps over [T−250k, T], for the mock, an ERC-1271 attributor, a nested token (cheap / +40k per move), and real Arc USDC on the fork | PASS: 0 successful under-funded pays with any redirect or re-weighting (+ QE-C-07 robustness note) | `QeGasStarvation.t.sol`, `test_fork_gasStarvation_noRedirectAtAnyGasLimit` |
| Boundaries: order expiry (inclusive), auth deadline (exclusive, == USDC validBefore), intro expiry at pay, minOrder ±1, amount 1 / 1e12 / 1e12+1, 18-dec amount → `InvalidAmount` | PASS | `QeEdges.t.sol` `test_edge_*` |
| Terms racing: frozen against later rate up/down and min raise; same-second update; two updates in one second | PASS (+ QE-C-05) | `test_terms_*` |
| Key rotation mid-flow (signer/attributor/payout) | PASS: old order sig refused cleanly; the same auth works with the re-signed order; the old attributor sig → fallback; money goes to the new payout | `test_edge_keyRotationMidFlow` |
| Blacklists: L2 introducer, every recipient, customer, Vouch | PASS: returned to the venue / clean revert | `test_edge_blacklisted*`, `test_edge_allRecipientsBlacklisted_*` |
| Size / non-payable | PASS: 23,570 B (1,006 B headroom); no receive/fallback; `pay` non-payable | `test_edge_contractSizeHeadroom`, `test_edge_nonPayableEverywhere` |
| Events / preview | PASS except QE-C-03: every VenueStats field + l1/l2 earned rebuilt from logs; the D-504 identity holds per payment; preview == settlement (fuzz, 1,000 runs) | `QeEvents.t.sol` |

### Own invariant harness: `QeInvariant.t.sol` (`QeLedgerHandler`)

The harness is not a copy of the builder's. It runs two venues with different terms (15%/min $1 and 3%/min 0), 8 actors who act as customers and referrers at either venue, and four weights modes: fallback, a valid attributor subset, a garbage signature, and a swapped hash. It also randomizes blacklist toggles, terms changes and time.

**Per payment,** it checks:
- the per-actor and per-venue balance deltas against the `previewPayment` quote taken just before (whenever no quoted recipient is blacklisted);
- L1 recipients against the eligible set read just before;
- that each L2 recipient equals `introducerOf(via)` and is not the customer;
- pool ≤ amount × max frozen rate;
- dust ≤ 2 per referrer;
- Σ out == amount;
- the D-504 identity.

**Globally,** it checks:
- a stats ledger built **only from Vouch's events** equals `getVenueStats`/`getAmbassadorStats` (l1/l2);
- the introducer never changes once set;
- rewarded ⇒ verified;
- conservation, and Vouch holds 0.

Result: 256 runs × 64 calls, all four invariants pass.

## Test counts

`cd contracts && forge test` (default; fork suites skip themselves):

| Suite | Pass | Fail | Skip |
|---|---|---|---|
| Builder: `Vouch.t.sol` 64, `VouchFuzz` 3, `VouchInvariant` 1, `VouchSplit` 4, `VouchTypehash` 2, `spikes/Hello` 11, `VouchFork` (skip) | 85 | 0 | 1 |
| QE `QePayeeAuth` | 13 | 0 | 0 |
| QE `QeWeights` | 2 | **2** (`test_BUG_frontRun…` ×2, QE-C-01) | 0 |
| QE `QeGasStarvation` (+Nested) | 9 | 0 | 0 |
| QE `QeReplaySignatures` | 13 | 0 | 0 |
| QE `QeIntrosTerms` | 9 | 0 | 0 |
| QE `QeEdges` (+ReentrancyHook) | 12 | **1** (`test_BUG_payoutCanBeTheVouchContract…`, QE-C-02) | 0 |
| QE `QeEvents` | 2 | **1** (`test_BUG_ambassadorCredit…`, QE-C-03) | 0 |
| QE `QeInvariant` | 1 (4 invariants) | 0 | 0 |
| QE `QeForkPayee` | — | — | 1 (7 tests) |
| **Total** | **146** | **4** (all `test_BUG_*`) | **2** |

Fork runs (public RPC):
- `VOUCH_FORK=true forge test --match-path 'test/VouchFork.t.sol'`: **3/3 pass**.
- `VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol'`: **7/7 pass**. The real-USDC gas threshold is 354,077; 1,551 gas limits were tried, with 201 successes, all exact.

Evidence: `forge-test-summary.txt`, `fork-tests.txt`, `gas-sweeps.txt`, `live-arc-eth-call.{sh,txt}`.

## How to re-run

```bash
cd contracts && forge test --match-path 'test/qe/*'                       # QE suite (4 test_BUG_* fail by design)
VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol' -vv   # real Arc USDC (fork)
bash docs/evidence/phase-1/contracts-qe/live-arc-eth-call.sh              # live eth_call, read-only
```

## Re-verification plan

1. When CONTRACTS answers MSG-014/MSG-015 with a fix, re-run `forge test --match-path 'test/qe/*'` and confirm the matching `test_BUG_*` now pass (for QE-C-01 under option (a), or a submitter-bound variant).
2. Re-run the fork suite and the gas sweeps.
3. Close the messages.
4. If the contract is redeployed, re-run the live `eth_call` script against the new address.

---

## Re-verification (v2)

_Run 2026-11-16 against v2 `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f` (block 72584790). The changes are D-012 and D-512..D-517, with replies in MSG-024..031 and the re-verify request in MSG-033. src/ and the builder's tests were not touched._

### What I changed in the QE harness (API change only; no assertion weakened)
- **The 7-field `PaymentAuth`.** I updated the type string and encodes (`QeForkPayee`, `QePayeeAuth`, `QeInvariant`) and added a `submitter` value (the relayer, or the handler in the invariant). Every pay call I submit now uses `vm.prank(relayer)` (gas sweeps, malleability, ERC-1271 and re-entrancy tests).
- **The (e) field-mutation proofs now cover 7 fields.** A changed submitter also submits the payment, so only USDC can object: mock, fuzz and fork.
- **The invariant handler is strengthened.** Before every honest `pay`, a random actor front-runs with a garbage attributor signature. The front-run must revert with `UnauthorizedSubmitter`.
- **New fork test: `test_fork_deployedV2RuntimeEqualsThisSource`.** It re-deploys this source at the v2 address with `deployCodeTo` (OZ EIP712 bakes `address(this)` into immutables). The live runtime bytes are identical, and the deployed `PAYMENT_AUTH_TYPEHASH` is `0xf9bd…cba4`.
- **New file `QeV2Reattack.t.sol`** (14 tests) re-attacks every fix.

### Builder disputes (adjudicated independently)
| Test | Builder's claim | QE ruling |
|---|---|---|
| `test_BUG_frontRunWithSwappedWeightsForcesFallback` | It fails because of memory aliasing (`swapped = b.w`) in the test, not because of the contract. | **Agree.** Solidity memory-struct assignment copies the reference, so `swapped.bps = …` also rewrote `b.w`, and the honest resubmission carried the swapped bps. On v1 the test still failed for the right reason, because the front-run itself succeeded first; on v2 the front-run reverts, which exposed the aliasing. The test now builds an independent struct, asserts that the front-run reverts with `UnauthorizedSubmitter`, and is renamed **`test_FIXED_frontRunWithSwappedWeightsForcesFallback`** (pass). |
| `test_BUG_ambassadorCreditNotRecoverableFromEvents` | `assertFalse(namedAnywhere)` contradicts the intended fix. | **Agree.** That line described the bug ("no event names Omar"), not the required property. It is inverted to `assertTrue(namedAnywhere)`, which is stronger and pins the fix, and the test is renamed **`test_FIXED_ambassadorCreditRecoverableFromEvents`** (pass). |

### Per-finding status
| ID | v2 change | Re-verified by | Status |
|---|---|---|---|
| QE-C-01 | `PaymentAuth.submitter` (in the nonce); `UnauthorizedSubmitter` checked last | `test_FIXED_frontRun…` ×2; `test_v2_submitterMismatch_noStateChange_honestStillSettles` (the referrer, the customer and a stranger are all refused; the order isn't settled; the USDC nonce isn't consumed; the honest submission then settles the attributor split); `test_v2_submitterSwapBreaksTheUsdcSignature`; `test_v2_accessControlledContractSubmitterHolds`; fork `test_fork_e` (7 fields); invariant front-run probe | **closed** (MSG-014). Residual → QE-C-09 |
| QE-C-02 | `InvalidPayout` for Vouch and USDC | `test_FIXED_payoutCanBeTheVouchContract…`; `test_v2_payoutGuard_allEntryPoints` (registerVenue, direct setKeys, relayed setKeys; Vouch/USDC/0) | **closed** (MSG-015). Info → QE-C-09 |
| QE-C-03 | zero-amount L1 emitted as `RewardPaid` amount 0 | `test_FIXED_ambassadorCreditRecoverableFromEvents`; `test_events_rebuildEveryStatFromLogsAlone`; `testFuzz_previewEqualsSettlement`; QeLedger invariants | **closed** (MSG-016). Residual accepted: per-referrer bps aren't emitted |
| QE-C-04 | direct owner actions consume `nonces(owner)` | `test_FIXED_staleRelayedOwnerActionCannotOverrideNewerDirectAction`; `test_replay_ownerSigs_*` | **closed** (MSG-017). Residual (documented): `test_LIMIT_futureNonceSignatureBecomesValidAfterDirectActions` |
| QE-C-05 | superseded version acceptable only ≤ 72h after the cut | `test_FIXED_backdatedIssuedAt…`; `test_v2_graceBoundary_inclusiveAt72h` (== cut+72h accepted); `test_v2_graceBoundary_rejectedAt72hPlus1`; `test_v2_graceMeasuredPerVersion` (the window runs from that version's own cut, not the latest one) | **closed** (MSG-018). Product note: `test_INFO_honestPreCutLinkDies72hAfterTermsChange` |
| QE-C-06 | documented (D-517) | `test_LIMIT_personalIntroCanBeSniped`, `test_LIMIT_submitterChoosesWhichReferrerIsEvicted` (unchanged) | **closed** (accepted limit; MSG-019) |
| QE-C-07 | 100k gas floor before each transfer + ordering-pin tests | `test_FIXED_guardNoFalseNegativeWithNestedToken`, all 8 `QeGasStarvation` sweeps, `test_v2_maxSplitGasFloor_near_1gas`/`_far`, fork `test_fork_gasStarvation_noRedirectAtAnyGasLimit`. Calibration and assumption below. | **closed** (MSG-020) |
| QE-C-08 | documented (D-517) | LIMIT/INFO tests unchanged | **closed** (accepted limit; MSG-021) |
| **QE-C-09** (new) | — | `test_LIMIT_zeroSubmitterReopensFrontRun`, `test_LIMIT_publicForwarderAsSubmitterIsNoBinding`, `test_INFO_systemAddressPayoutAcceptedButNothingStuckInVouch`, `test_LIMIT_futureNonce…`, `test_INFO_honestPreCutLink…`, `test_INFO_floorAssumesTransferCostBelowFloor` | **open**, Low/Info (MSG-038) |

**QE-C-07 calibration.** The guard now fires explicitly: 1,500–1,917 `TransferOutOfGas` refusals per sweep, against 0 on v1.
- **Mock thresholds.** The minimum successful gas rose from 412k to 481k, the cost of the floor.
- **Maximal split** (5 referrers, each with an introducer: 13 balance moves). The minimum gas is 804,619, against Arc's live block gas limit of 30,000,000, so the floor does not brick large splits. At 1-gas steps there were 151 under-funded successes, all identical to the ample-gas outcome, and 0 successes in the far region.
- **Real Arc cost.** `eth_estimateGas` of a USDC transfer to a fresh address measures 74,597 tx gas (about 52k execution). I calibrated the nested-token model to that cost (burn 120): 0 false negatives.
- **The pinned assumption.** The floor holds only if one token transfer costs less than about 98k gas. A model token at about 95k per move brings the false negative back (`test_INFO_floorAssumesTransferCostBelowFloor`, 430 false negatives).

### Re-attack answers (the coordinator's questions)
- **Can submitter binding be bypassed?**
  - Signature reuse across submitters: no. The submitter is inside the USDC nonce, so changing it, or downgrading it to 0, gives `invalid signature`.
  - A contract submitter: holds when the contract is access-controlled. A *public* forwarder or meta-tx relay is no binding at all.
  - submitter = 0: re-opens QE-C-01 for that payment.
  - Both of the last two are QE-C-09, a requirement on the relayer flow rather than a contract bug.
- **Is the payout guard complete?** It rejects Vouch, USDC and 0. Real USDC itself blocks transfers to `0x3600` ("Blocked address", live). It accepts `0x1800…` and `0xffff…fffe` (live `eth_call`: `true`). Those payouts burn the venue's own share to a keyless address, but nothing stays in Vouch, so invariant 1 holds. Info, in QE-C-09.
- **Is the 72h window correct at its boundaries?** Yes: accepted at exactly cut+72h, rejected at +72h+1, and measured per version.
- **Do owner nonces now block the stale-action undo?** Yes. The residual is a pre-signed future nonce, which is documented.
- **Does the 100k reserve let a relayer redirect shares, or brick large splits?** Neither, by the sweeps above on the mock, an ERC-1271 attributor, nested tokens, a maximal split and real Arc USDC on the fork.

### MSG-003 on v2
- **Mock:** `QePayeeAuth` 13/13; (e) now covers 7 fields.
- **Fork, real Arc USDC:** `QeForkPayee` 8/8; `VouchFork` 3/3.
- **Live read-only `eth_call` against v2** (`docs/evidence/phase-1/contracts-qe/live-arc-eth-call-v2.{sh,txt}`):
  - The deployed `paymentAuthNonce` equals my independent keccak: `0x5e3e…7531`, 7 fields including the submitter.
  - The deployed typehash is `0xf9bd…cba4`, matching my keccak of the type string.
  - A third party or the customer calling directly → `FiatTokenV2: caller must be the payee`.
  - An attacker naming itself as payee → `FiatTokenV2: invalid signature`.
  - The same call simulated from v2 passes the payee and signature checks: the 12e6 call fails only on balance, and the value-0 call succeeds.
  - `authorizationState` is unchanged.

### Test counts (v2)
`cd contracts && forge test`: **176 passed, 0 failed, 2 skipped** (20 suites).

| Builder | Count |
|---|---|
| Vouch | 64 |
| VouchQeFixes | 11 |
| VouchFuzz | 3 |
| VouchInvariant | 1 |
| VouchSplit | 4 |
| VouchTypehash | 2 |
| Hello | 11 |
| **Builder total** | **96** |

| QE suite | Count |
|---|---|
| QePayeeAuth | 13 |
| QeWeights | 4 |
| QeGasStarvation | 4 + 6 |
| QeReplaySignatures | 13 |
| QeIntrosTerms | 9 |
| QeEdges | 12 + 1 |
| QeEvents | 3 |
| QeInvariant | 1 (4 invariants, 256×64, front-run probe on every pay) |
| QeV2Reattack | 14 |
| **QE total** | **80** |

Fork (`VOUCH_FORK=true`, public RPC): VouchFork **3/3**, QeForkPayee **8/8**. The real-USDC gas threshold is 425,328; 1,551 gas limits were tried, with 201 successes, all exact.

Evidence: `v2-forge-test-summary.txt`, `v2-fork-tests.txt`, `v2-gas-sweeps.txt`, `live-arc-eth-call-v2.{sh,txt}`. The v1 files are kept for history.
