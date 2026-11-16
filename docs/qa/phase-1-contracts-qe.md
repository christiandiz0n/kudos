# Phase 1 Contracts QE gate: adversarial review of `Vouch`

_CONTRACTS_QE, independent reviewer (did not write the contract). Run 2026-11-16. Target: `contracts/src/Vouch.sol` + `libraries/` + `interfaces/` (deployed `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3`, Arc Testnet, block 72580272, runtime 23,570 B). Raw outputs: `docs/evidence/phase-1/contracts-qe/`._
_Secrets: no command read or printed the root env file or any key. Signatures use test keys and one throwaway key derived from a public string. Testnet: read-only `eth_call`s only. No transactions were sent and nothing was spent._

## Verdict

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
