# CONTRACTS_QE
_Last updated: 2026-11-16 by CONTRACTS_QE — Phase 1 Contracts QE gate_

## Mission
Independent adversarial reviewer of the contracts. Writes additional failing tests and fuzz/invariant tests that expose bugs, files issues to CONTRACTS, re-verifies fixes. Does NOT edit contract logic — reports issues instead.

## Owned paths
- `contracts/test/qe/` (tests + `qe/mocks/`)
- `docs/qa/phase-1-contracts-qe.md`
- `docs/evidence/phase-1/contracts-qe/`
- this file

## Current status
🔴 **Phase 1 gate: FAIL until 2 small blockers are fixed** (MSG-014 QE-C-01 front-run forced fallback; MSG-015 QE-C-02 payout == Vouch strands funds). **MSG-003 (human requirement) PROVEN** on mock + real-USDC fork + live Arc `eth_call`. Six low/info requests open (MSG-016..021).

## Mental model (read this first)
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
| `contracts/test/qe/QeForkPayee.t.sol` | MSG-003 (a)–(e) + gas sweep on the REAL Arc USDC (fork) | opt-in `VOUCH_FORK=true`; imports the builder's `ArcNativeTransferShim` |
| `contracts/test/qe/QeWeights.t.sol` | bad-weights shapes/fuzz never revert; **`test_BUG_frontRun*` (QE-C-01)** | 2 fail by design |
| `contracts/test/qe/QeGasStarvation.t.sol` | 1-gas sweeps (mock, 1271 attributor, nested token cheap/expensive) + guard false-negative demo | chunked: Foundry caps a test at ~1.07e9 gas |
| `contracts/test/qe/QeReplaySignatures.t.sol` | replay, malleability, cross-domain, hostile 1271, static re-entry; LIMIT tests for QE-C-04/06 | |
| `contracts/test/qe/QeIntrosTerms.t.sol` | eviction, terms freezing/races, back-dating (QE-C-05), sybil, cycles | |
| `contracts/test/qe/QeEdges.t.sol` | boundaries, decimals, key rotation, blacklists, size, non-payable, hook re-entry; **`test_BUG_payoutCanBeTheVouchContract*` (QE-C-02)** | 1 fails by design |
| `contracts/test/qe/QeEvents.t.sol` | stats rebuilt from logs, preview == settlement fuzz; **`test_BUG_ambassadorCredit*` (QE-C-03)** | 1 fails by design |
| `contracts/test/qe/QeInvariant.t.sol` | own harness: 2 venues, event-sourced ledger, preview/eligibility/introducer/dust checks | 4 invariants pass |
| `docs/qa/phase-1-contracts-qe.md` | report: findings, MSG-003 evidence, counts, verdict | |
| `docs/evidence/phase-1/contracts-qe/` | forge summary, fork output, gas sweeps, live eth_call script + output | |

## Interfaces consumed / provided
Consumed: `IVouch` (INTERFACES §3/§4), Arc USDC `0x3600…` (DOMAIN_SEPARATOR `0x3611…c6b0`, RWA typehash `0xd099…3de8`), deployed Vouch `0xfEe6…b2d3`. Provided: nothing (tests and reports only). The proposed interface changes live in MSG-014 (option b: `submitter` in PaymentAuth) and MSG-016 (a per-referrer attribution event); CONTRACTS decides on both.

## Done (rolling, newest first)
- 2026-11-16: Phase 1 Contracts QE gate.
  - Wrote 72 QE tests: 65 run by default, plus 7 fork tests.
  - Results: 4 intentional `test_BUG_*` failures; 1 own invariant harness.
  - Proved MSG-003 (a)–(e) on the mock, on the fork, and live.
  - Filed MSG-014..021 (2 blockers, 6 requests).
  - Replied to MSG-003 (MSG-022) and acked MSG-013 (MSG-023).
- 2026-11-15: File initialized by ORCHESTRATOR.

## Next up
- [ ] Re-verify when CONTRACTS answers MSG-014 / MSG-015, then MSG-016..021. Re-run `forge test --match-path 'test/qe/*'`, the fork suite, and the gas sweeps, then close the messages.
- [ ] If Vouch is redeployed, re-run `bash docs/evidence/phase-1/contracts-qe/live-arc-eth-call.sh` with the new address (edit `VOUCH=`).
- [ ] If QE-C-01 is fixed with option (a), un-skip nothing. The two `test_BUG_frontRun*` tests accept either "the tampered submission reverts" or "the attributor split is honoured".

## Struggles, open questions, known issues
- QE-C-01 conflicts with invariant 6 as literally worded ("invalid signature → fallback"). It needs an ORCHESTRATOR/human call: either fix it (revert when `weightsHash != 0` and the weights or signature are bad, or bind a submitter), or accept the risk and record a decision.
- **Test environment:** Foundry charges the EIP-7623 calldata floor on test sub-calls, so measure gas against a trivial call with the same calldata (`_trivialCallGas`). The inline `forge-config: default.gas_limit` doesn't work, so split long sweeps into chunks below ~1.07e9 gas.
- **Foundry gotcha:** a `new X()` written inside a call's arguments consumes `vm.prank`, and a call that computes signatures/hashes inside a call's arguments consumes `vm.expectRevert`. Precompute both.

## How to run / test this area
```bash
cd contracts && forge test --match-path 'test/qe/*'                        # 4 test_BUG_* fail by design until fixed
VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol' -vv    # real Arc USDC (public RPC unless ARC_RPC_URL)
VOUCH_FORK=true forge test --match-path 'test/VouchFork.t.sol' -vv          # builder fork suite
bash docs/evidence/phase-1/contracts-qe/live-arc-eth-call.sh               # MSG-003 (b) live, read-only eth_call
```

## Handoff notes
Read `AGENTS/README.md`, `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-501..D-511, D-701) and `docs/qa/phase-1-contracts-qe.md` first. Never edit `contracts/src` or the builder's tests. File findings with `scripts/agents/msg.py` (blocker = breaks inv. 1–9 or moves funds). Testnet access is read-only.
**Comms (D-009):** read `AGENTS/INBOX/CONTRACTS_QE.md` first. Open sent items: MSG-014 (blocker), MSG-015 (blocker), MSG-016..021 (requests), all to CONTRACTS.
