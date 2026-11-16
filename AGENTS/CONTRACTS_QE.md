# CONTRACTS_QE
_Last updated: 2026-11-16 by CONTRACTS_QE — Phase 1.5: independent review of Vouch v3 (D-014/D-519, working tree)_

## Mission
Independent adversarial reviewer of the contracts. Writes additional failing tests and fuzz/invariant tests that expose bugs, files issues to CONTRACTS, re-verifies fixes. Does NOT edit contract logic — reports issues instead.

## Owned paths
- `contracts/test/qe/` (tests + `qe/mocks/`)
- `docs/qa/phase-1-contracts-qe.md`
- `docs/evidence/phase-1/contracts-qe/`
- this file

## Current status
🟢 **v3 (D-014/D-519, uncommitted working tree, not deployed): PASS-with-findings for redeploy.**
- The rule is `msg.sender == auth.submitter`, and `submitter = 0` is unpayable. Third parties are refused for every submitter value (0, relayer, customer). A customer self-submit gets the exact canonical split. The interface (typehash, nonce, ABI, topics) is identical to v2. Runtime is 23,998 B.
- `forge test`: 197 passed, 0 failed, 2 skipped. Fork: 16 passed, 1 skipped (the v3 pin waits for `VOUCH_V3`). Invariants are green at 256×64 and 1024×128.
- Open Info requests: QE-C-10 (MSG-053) and QE-C-11 (MSG-054). MSG-050 is answered (MSG-055).

**Phase 1 gate (v2 `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f`): PASS-with-findings.**
- QE-C-01..08 are fixed or accepted, and MSG-014..021 are closed.
- MSG-003 is re-proven on v2 (mock, fork, live `eth_call`).
- `forge test`: 176 passed, 0 failed, 2 skipped. Fork: 3/3 + 8/8.
- One Low/Info request is open: QE-C-09 (MSG-038), submitter choice plus info notes.

## Mental model (read this first)
- **v3 (D-519):** `_checkOrder` ends with `if (msg.sender != auth.submitter) revert UnauthorizedSubmitter();`. There is no zero branch, and the customer self-submits by signing `submitter = self`. A refusal makes 0 SSTOREs and never calls USDC (checked with a state-diff recording in `QeV3Submitter._refused`). The order is NOT bound to a submitter: a customer can pre-empt its own relayer-bound auth with a second self-submit auth (QE-C-10).
- **Invariant-probe gotcha (D-703):** when a must-refuse probe in the handler is wrongly accepted, return immediately. If the honest call runs next, it reverts, and the revert rolls back `_fail` under `fail_on_revert = false`.
- **v2 (D-012/D-512):** `PaymentAuth` gained `address submitter`, which is part of the USDC nonce. `pay` reverts `UnauthorizedSubmitter` unless `submitter == 0 || msg.sender == submitter`. Tests must `vm.prank(relayer)` because `VouchBase._auth` binds the relayer. Other v2 changes:
  - `InvalidPayout` rejects a payout of Vouch or USDC.
  - A zero-amount L1 emits `RewardPaid` with amount 0.
  - Direct owner actions consume nonces.
  - A superseded terms version can be used for 72h after the cut.
  - A 100k gas floor applies before each transfer.
- **Snapshot gotcha:** `vm.revertToState` also reverts the TEST contract's storage. Keep reference values in memory.
- **Vouch** is permissionless. `pay()` takes the order (venue signer), the weights (attributor), the PaymentAuth, and the customer's USDC `ReceiveWithAuthorization` signature. Its nonce = `hashStruct(PaymentAuth)`. The ONLY USDC pull is `_pullPayment`, which calls `receiveWithAuthorization(to = this)`. USDC's payee check means nobody else can redeem the signature. Everything that decides who gets paid is computed before the pull. Transfers come after the pull, and events come last.
- **The weak spot is the weights.** The customer commits `weightsHash`, but the attributor signature and the weights themselves are NOT covered by anything the customer signed. Any invalid or mismatched submission silently falls back (D-502/inv. 6). Because pay() is permissionless, any mempool observer chooses between the attributor split and the fallback split (QE-C-01).
- **Gas starvation:** `_tryTransfer`'s 63/64 guard is not what keeps pay() safe on Arc, because the precompile adds a nested frame. What keeps it safe is the ordering: lots of work remains after any reward transfer (QE-C-07). If `_distribute` is reordered, re-run `QeGasStarvation*`.
- **Fixture:** `QeBase` builds on the builder's `VouchBase`. `_bundle()` builds an honest relayer's calldata without executing it, so a test can tamper with, front-run or starve exactly what the relayer would send.
- **Mocks:**
  - `QeNestedUsdc`: an Arc-shaped token whose balance moves are a nested call into `QeLedger`, with an optional ERC-777-style recipient hook. It is vm.etch-ed over the fixture's USDC address.
  - `QeEvil1271`: four hostile ERC-1271 signers (always-valid, reverting, gas-burner, re-entrant).
  - `QeHookReferrer`: a smart-account referrer that re-enters on the hook.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `contracts/test/qe/QePayeeAuth.t.sol` | MSG-003 (a)–(e) on the faithful mock, incl. a 1,000-run field-mutation fuzz | all pass |
| `contracts/test/qe/QeForkPayee.t.sol` | MSG-003 (a)–(e) + gas sweep on the REAL Arc USDC (fork); v3 self-submit/refusal/relabel; v2 pinned to its recorded runtime hash; v3 pin via `VOUCH_V3` (D-703) | opt-in `VOUCH_FORK=true`; imports the builder's `ArcNativeTransferShim` |
| `contracts/test/qe/QeWeights.t.sol` | bad-weights shapes/fuzz never revert; `test_FIXED_frontRun*` (QE-C-01) | pass on v2 |
| `contracts/test/qe/QeGasStarvation.t.sol` | 1-gas sweeps (mock, 1271 attributor, nested token cheap/expensive) + guard false-negative demo | chunked: Foundry caps a test at ~1.07e9 gas |
| `contracts/test/qe/QeReplaySignatures.t.sol` | replay, malleability, cross-domain, hostile 1271, static re-entry; LIMIT tests for QE-C-04/06 | |
| `contracts/test/qe/QeIntrosTerms.t.sol` | eviction, terms freezing/races, back-dating (QE-C-05), sybil, cycles | |
| `contracts/test/qe/QeEdges.t.sol` | boundaries, decimals, key rotation, blacklists, size, non-payable, hook re-entry; `test_FIXED_payoutCanBeTheVouchContract*` (QE-C-02) | pass on v2 |
| `contracts/test/qe/QeEvents.t.sol` | stats rebuilt from logs, preview == settlement fuzz; `test_FIXED_ambassadorCredit*` (QE-C-03) | pass on v2 |
| `contracts/test/qe/QeInvariant.t.sol` | own harness: 2 venues, event-sourced ledger, preview/eligibility/introducer/dust checks | 4 invariants pass |
| `contracts/test/qe/QeV2Reattack.t.sol` | v2 re-attack: submitter bypasses, payout guard, future nonce, 72h grace boundaries, max-split gas floor; `test_FIXED_zeroSubmitterUnpayable` (QE-C-09, v3) | 14 pass |
| `contracts/test/qe/QeV3Submitter.t.sol` | v3: refusal matrix for submitter 0/relayer/customer (state-diff: no SSTORE, no USDC call), fuzz, relabel matrix, exact self-submit split == relayer path == preview, ERC-1271 account, D-509, gas sweep, interface pins, INFO QE-C-10 | 16 pass |
| `docs/qa/phase-1-contracts-qe.md` | report: findings, MSG-003 evidence, counts, verdict + **Re-verification (v2)** | |
| `docs/evidence/phase-1/contracts-qe/` | forge summary, fork output, gas sweeps, live eth_call script + output | |

## Interfaces consumed / provided
Consumed: `IVouch` (INTERFACES §3/§4), Arc USDC `0x3600…` (DOMAIN_SEPARATOR `0x3611…c6b0`, RWA typehash `0xd099…3de8`), deployed Vouch `0xfEe6…b2d3`. Provided: nothing (tests and reports only). The proposed interface changes live in MSG-014 (option b: `submitter` in PaymentAuth) and MSG-016 (a per-referrer attribution event); CONTRACTS decides on both.

## Done (rolling, newest first)
- 2026-11-16: Independent v3 review (D-014/D-519): **PASS-with-findings**.
  - Added `QeV3Submitter.t.sol` (16 tests) and 3 v3 fork tests.
  - Flipped `test_LIMIT_zeroSubmitterReopensFrontRun` → `test_FIXED_zeroSubmitterUnpayable` and updated the zero half of `test_v2_submitterSwapBreaksTheUsdcSignature`.
  - The fork pin now pins v2 to its recorded hash, and the v3 pin is env-targeted (D-703).
  - Added self-submit and zero-submitter probes to the invariant handler, and fixed its breach-rollback blind spot (D-703).
  - Mutation-checked: v2 rule / option (b) / no check are all caught.
  - Diffed the interface against the v2 source, Blockscout v2 and `@vouch/shared`: identical.
  - Filed MSG-053 (QE-C-10) and MSG-054 (QE-C-11); answered MSG-050 (MSG-055).
- 2026-11-16: Re-verified v2 (`0x9C50…b95f`, deployed runtime == source).
  - Adapted the harness to the 7-field PaymentAuth.
  - Adjudicated the builder's two disputes: agreed with both and fixed my tests (aliasing; an inverted assertion).
  - Flipped the BUG/LIMIT tests for fixed findings to `test_FIXED_*`.
  - Added `QeV2Reattack.t.sol`, a fork bytecode-equality test, and a front-run probe in the invariant handler.
  - Ran the live v2 `eth_call`.
  - Closed MSG-014..021 and MSG-024..032, answered MSG-033 (MSG-039), and filed QE-C-09 (MSG-038). Recorded D-702.
- 2026-11-16: Phase 1 Contracts QE gate.
  - Wrote 72 QE tests: 65 run by default, plus 7 fork tests.
  - Results: 4 intentional `test_BUG_*` failures; 1 own invariant harness.
  - Proved MSG-003 (a)–(e) on the mock, on the fork, and live.
  - Filed MSG-014..021 (2 blockers, 6 requests).
  - Replied to MSG-003 (MSG-022) and acked MSG-013 (MSG-023).
- 2026-11-15: File initialized by ORCHESTRATOR.

## Next up
- [ ] After the v3 redeploy:
  - Run `VOUCH_V3=<addr> VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol'` (live v3 == source).
  - Record the v3 runtime keccak as a constant, like v2 (D-703).
  - Run the live `eth_call` script with `VOUCH=<addr>`.
- [ ] Re-verify the answers to QE-C-10 (MSG-053) and QE-C-11 (MSG-054). Check that `packages/shared/src/eip712.ts` and INTERFACES §3 no longer say "zero = anyone".
- [ ] Re-verify when CONTRACTS answers MSG-038 (QE-C-09: submitter policy docs, optional system-address payout guard).
- [ ] When BACKEND_RELAYER lands, check that it:
  - binds its own EOA (not a public forwarder; see `test_LIMIT_publicForwarderAsSubmitterIsNoBinding`);
  - treats `OrderAlreadySettled` as terminal (QE-C-10).

  On v3, zero is unpayable (`test_FIXED_zeroSubmitterUnpayable`).
- [ ] On any redeploy: run `VOUCH=<addr> bash docs/evidence/phase-1/contracts-qe/live-arc-eth-call-v2.sh`, set `VOUCH_V3`, and re-run the fork suites (D-703; don't re-target the v2 pin).

## Struggles, open questions, known issues
- QE-C-01 was resolved by D-012 (submitter binding), which keeps the fallback semantics. The residual risk lives in how the relayer chooses the submitter (QE-C-09).
- Calibration: real Arc USDC transfer = 74,597 tx gas from `eth_estimateGas` (~52k execution). In the nested-token model, burn 120 ≈ Arc and burn 300 ≈ 95k per move, above the 100k floor's 98k guarantee.
- **Test environment:** Foundry charges the EIP-7623 calldata floor on test sub-calls, so measure gas against a trivial call with the same calldata (`_trivialCallGas`). The inline `forge-config: default.gas_limit` doesn't work, so split long sweeps into chunks below ~1.07e9 gas.
- **Foundry gotcha:** a `new X()` written inside a call's arguments consumes `vm.prank`, and a call that computes signatures/hashes inside a call's arguments consumes `vm.expectRevert`. Precompute both.

## How to run / test this area
```bash
cd contracts && forge test --match-path 'test/qe/*'                        # all green on v3 working tree (D-702: test_FIXED_* = regressions)
VOUCH_V3=<addr> VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol'  # after the v3 redeploy (D-703)
VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol' -vv    # real Arc USDC (public RPC unless ARC_RPC_URL)
VOUCH_FORK=true forge test --match-path 'test/VouchFork.t.sol' -vv          # builder fork suite
bash docs/evidence/phase-1/contracts-qe/live-arc-eth-call-v2.sh            # MSG-003 (b) live on v2, read-only eth_call
```

## Handoff notes
Read `AGENTS/README.md`, `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-501..D-511, D-701) and `docs/qa/phase-1-contracts-qe.md` first. Never edit `contracts/src` or the builder's tests. File findings with `scripts/agents/msg.py` (blocker = breaks inv. 1–9 or moves funds). Testnet access is read-only.
**Comms (D-009):** read `AGENTS/INBOX/CONTRACTS_QE.md` first. Open sent items: MSG-053 (QE-C-10) and MSG-054 (QE-C-11), both requests to CONTRACTS. MSG-038 (QE-C-09) was routed by the Orchestrator (MSG-042); its zero part is fixed in v3. MSG-014..021 are closed.
