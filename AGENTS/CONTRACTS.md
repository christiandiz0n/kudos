# CONTRACTS
_Last updated: 2026-11-16T12:45:00-05:00 by CONTRACTS — Phase 1_

## Mission
Owns all production Solidity: venue registry + versioned terms, intro acceptance, `pay` with atomic two-level split, frozen terms, on-chain fallback attribution, verified-customer and ambassador counters. Owns Foundry unit/fuzz/invariant tests, deploy scripts, and exporting ABIs + addresses to `packages/shared`. Does NOT touch frontend or backend code.

## Owned paths
- `contracts/src/` (except `spikes/`)
- `contracts/test/` (except `test/qe/`)
- `contracts/script/` (except `spikes/`)
- `packages/shared/src/abi/`, `packages/shared/src/deployments.ts`
- `scripts/deploy/`, `docs/proposals/` (Phase 1)

## Current status
🟢 Phase 1 done. `Vouch` deployed + Blockscout-verified at `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3` (Arc Testnet, block 72580272). The canonical smoke test passed on chain. 85 Foundry tests green (fuzz 1,000 runs; invariants 256 × 64 = 16,384 calls). Awaiting the CONTRACTS_QE review.

## Mental model (read this first)
- **One contract, no admin.** `contracts/src/Vouch.sol` (≈800 lines). It inherits OZ `EIP712("Vouch","1")`, `Nonces` and `ReentrancyGuardTransient`. Types, events and errors live in `src/interfaces/IVouch.sol`. EIP-712 type strings and struct hashing live in `src/libraries/VouchHash.sol`. The pure split math (slices, fallback weights, top index) lives in `src/libraries/VouchSplit.sol`. USDC is the immutable `USDC` (Arc `0x3600…`). The contract is non-payable.
- **Venues (D-501).**
  - Identity: `venue = address(uint160(uint256(keccak256(abi.encode(owner, salt)))))`.
  - Owner actions: `registerVenue`, `updateTerms`, `setKeys`, `setSeedAmbassador`. Each takes `(…, deadline, ownerSig)`. If `msg.sender == owner` the signature is skipped. Otherwise `_checkOwnerSig` verifies an owner-signed typed message, using `_useNonce(owner)` inside the struct hash.
  - Terms: append-only, stored in `_terms[venue][version]` as `{rewardBps, effectiveAt, minOrder}`.
- **Intros (D-505).**
  - `acceptIntro` → `_checkIntro` (window, terms-in-force at issuedAt, both signatures) → eligibility (referrer verified-or-seed, customer not verified) → use-key (personal: introHash; broadcast: keccak(introHash, customer)) → `_storeLiveIntro`.
  - Slots: a fixed `LiveIntro[5]` per (venue, customer). `CustomerState.introCount` counts used slots. Slot choice: replace same referrer → reuse expired → append → evict oldest.
- **Pay** (`pay` → `_checkOrder` → `_settle` → `_pullPayment` → `_distribute`):
  1. `_checkOrder`: venue exists, order unexpired, amount in bounds, auth matches the order, `now < auth.deadline`, order not settled, venue signer signature.
  2. `_settle`: sets the settled flag, adds gross volume. If the customer is not verified: `_plan` (view) builds the reward plan, then `_recordFirstPurchase` sets verified/rewarded/introducer, venue and ambassador counters, and emits `CustomerVerified`.
  3. `_pullPayment`: **the ONLY USDC pull**, `USDC.receiveWithAuthorization(customer, address(this), amount, 0, deadline, hashStruct(auth), sig)`.
  4. `_distribute`: transfers cashback, then L1s, then L2s via `_tryTransfer` (low-level; a failure becomes `RewardReturned` reason 2, an out-of-gas failure reverts). An L2 share with introducer 0 or introducer == customer is returned without a transfer. Then the venue payout gets the remainder (it must succeed). Then events and stats.
- **`_plan`.**
  - `_eligible` lists live intros that are unexpired and have `amount ≥ frozen minOrder`. If there are none, the purchase is plain.
  - `_applyAttributorWeights` returns a `weightsMode`. Only mode 1 fills the plan. Otherwise `VouchSplit.fallbackWeights` is used.
  - Slices are computed per referrer at its intro's frozen rate. `l2To[i] = introducer of referrer i`.
  - `top = VouchSplit.topIndex` (ties → lower index).
- **`previewPayment`** runs the same `_plan` as a view (the backend quote). Keep it in sync if `_plan` or `_distribute` change.
- **Size.** Runtime is 23,570 B (EIP-170 limit 24,576), so there are about 1 KB of headroom. Enum-like constants are `internal` for that reason, and their values are mirrored in `packages/shared/src/abi/vouchConstants.ts`. When adding code, check `forge build --sizes`.
- **Gotchas found while building:**
  - (a) `(cond ? 2 : 1) << 20` is uint8 and truncates to 0. Cast to uint256 first; this was a real bug, caught by tests.
  - (b) In tests, `T memory b = a;` aliases. Copy explicitly.
  - (c) `vm.expectRevert` applies to the next external call, which includes view calls inside the arguments, so precompute digests.
  - (d) Under legacy codegen (no via-IR), `pay` / `acceptIntro` / big tests hit stack-too-deep. Split into helpers or use structs.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `contracts/src/Vouch.sol` | Production contract | `_pullPayment` = the only USDC pull (MSG-004) |
| `contracts/src/interfaces/IVouch.sol` | Structs, events, errors | INTERFACES §3/§4 source |
| `contracts/src/libraries/VouchHash.sol` | EIP-712 type strings + struct hashes | one `keccak256("…")` per line; parsed by export-abi.sh |
| `contracts/src/libraries/VouchSplit.sol` | slice/parts/fallbackWeights/topIndex | pure, fuzzed directly |
| `contracts/src/interfaces/IFiatTokenV2_2.sol` | USDC subset | bytes-signature overload |
| `contracts/test/VouchBase.t.sol` | Fixture + independent signing helpers + `_canonicalSetup` | struct hashes re-implemented from the type strings |
| `contracts/test/Vouch.t.sol` | 64 unit tests (canonical exact, every revert path, fallbacks, griefing, payee path) | `test_gas_canonicalPay` logs the exact gas |
| `contracts/test/VouchFuzz.t.sol` | Property fuzz (exact sum, cap, legit recipients, replays) | 1,000 runs |
| `contracts/test/VouchInvariant.t.sol` | Handler + 4 invariants | 256 runs × depth 64 |
| `contracts/test/VouchSplit.t.sol` / `VouchTypehash.t.sol` | Library fuzz / golden vectors shared with TS | |
| `contracts/test/VouchFork.t.sol` | Real Arc USDC on a fork (precompile shim, D-511) | opt-in `VOUCH_FORK=true` |
| `contracts/test/mocks/MockFiatTokenV2_2.sol` | Faithful FiatTokenV2_2 test double (payee check, nonces, 1271, blacklist, cancel) | Circle's revert strings |
| `contracts/script/DeployVouch.s.sol` | Deploy script | refuses non-0x3600 USDC on Arc |
| `contracts/script/export-abi.sh` | Regenerates `packages/shared/src/abi/vouch.ts` | run after ANY contract change |
| `scripts/deploy/deploy-vouch.sh` | Deploy + Blockscout verify + write deployments.ts | `--verify 0xADDR` re-verifies |
| `scripts/deploy/smoke-canonical.ts` | Testnet canonical story (fresh venue per run) | `pnpm --filter @vouch/scripts smoke:canonical` |
| `scripts/deploy/fork-test.sh` | Runs the fork tests | |
| `packages/shared/src/abi/vouch.ts` | GENERATED ABI + event topics + type strings | do not hand-edit |
| `packages/shared/src/abi/vouchConstants.ts` | WEIGHTS_MODE / RETURN_REASON / INTRO_DROP_REASON / VOUCH_LIMITS | hand-written mirror |
| `packages/shared/src/deployments.ts` | `VOUCH_ARC_TESTNET` | written by deploy-vouch.sh |
| `packages/shared/src/eip712.ts` (+ `.test.ts`) | TS typed data (owner-action types added) | test compares to Solidity strings + golden hashes |
| `docs/proposals/interfaces-phase1.md` | Proposed INTERFACES §2/§3/§4 final text | Orchestrator applies |

## Interfaces consumed / provided
- Provides: INTERFACES §2 (address), §3 (EIP-712 v1), §4 (events v1). See `docs/proposals/interfaces-phase1.md` and D-501..D-511.
- Consumes: §1 network facts (D-101..D-103), USDC `0x3600…` EIP-3009.

## Done (rolling, newest first)
- 2026-11-16 — Phase 1:
  - Vouch implemented and tested: 64 unit, 3 fuzz × 1,000, 2 library fuzz × 1,000, 4 invariants over 16,384 calls, golden vectors, 3 fork tests on real Arc USDC.
  - Deployed + Blockscout-verified (`0xfEe6…b2d3`, block 72580272, deploy fee $0.129).
  - Canonical smoke on testnet passed: 9 relayed txs, $0.050 gas, exact 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108.
  - ABI, typed data and deployments exported; D-501..D-511 recorded.

## Next up
- [ ] Triage CONTRACTS_QE findings (inbox), fix + redeploy if needed (re-run `export-abi.sh`, `deploy-vouch.sh`, smoke).
- [ ] If the contract changes: keep `previewPayment` consistent with `_plan` / `_distribute`, and re-check `forge build --sizes`.

## Struggles, open questions, known issues
- **Size headroom ~1 KB.** Bigger features need via-IR or splitting `previewPayment` out to a lens contract.
- **Fork test** shims Arc's native-transfer precompile `0x1800…` (revm lacks it). Everything else is the real USDC bytecode. The live smoke run covers the real precompile.
- **Blockscout** reports `is_verified: true`, `is_fully_verified: false` (partial match, because `bytecode_hash = "none"`).
- **Below-minimum first purchase.** A first purchase below the frozen minOrder (or with only expired intros) burns the customer's reward chance at that venue (D-509). The frontend should warn.
- **`issuedAt` and terms changes.** `Intro.issuedAt` must come from chain time. A client clock that lags behind a just-made terms update makes `TermsNotInForce`.
- **Stats.** `customersCredited` counts an L1 even if its transfer failed (blacklist). Earned amounts count only what was transferred.

## How to run / test this area
```bash
cd contracts && forge build                    # clean (lint classes excluded in foundry.toml with reasons)
forge test                                     # 85 pass + fork suite skipped
forge test --gas-report                        # gas table
forge test --match-test test_gas_canonicalPay -vv   # exact canonical pay() gas (mock USDC)
bash scripts/deploy/fork-test.sh               # real Arc USDC on a fork (from repo root)
bash contracts/script/export-abi.sh            # regenerate packages/shared/src/abi/vouch.ts
bash scripts/deploy/deploy-vouch.sh            # deploy + verify + deployments.ts (DEPLOYER key, ~$0.13)
pnpm --filter @vouch/scripts smoke:canonical   # canonical story on testnet (~$0.05 gas)
pnpm -r typecheck && pnpm -r --if-present run test
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-501..D-511), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/CONTRACTS.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
