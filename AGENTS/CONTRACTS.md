# CONTRACTS
_Last updated: 2026-11-16T15:15:00-05:00 by CONTRACTS — Phase 1.5 (v3 submitter rule in the working tree, not deployed)_

## Mission
Owns all production Solidity: venue registry + versioned terms, intro acceptance, `pay` with atomic two-level split, frozen terms, on-chain fallback attribution, verified-customer and ambassador counters. Owns Foundry unit/fuzz/invariant tests, deploy scripts, and exporting ABIs + addresses to `packages/shared`. Does NOT touch frontend or backend code.

## Owned paths
- `contracts/src/` (except `spikes/`)
- `contracts/test/` (except `test/qe/`)
- `contracts/script/` (except `spikes/`)
- `packages/shared/src/abi/`, `packages/shared/src/deployments.ts`
- `scripts/deploy/`, `docs/proposals/` (Phase 1)

## Current status
🟡 Phase 1.5 v3 (D-014/D-519): the submitter rule is implemented in the working tree, UNCOMMITTED and NOT deployed. It waits for an independent CONTRACTS_QE review, then the Orchestrator authorizes the redeploy.
- **Live deployment (still v2):** `Vouch` at `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f`, Arc Testnet block 72584790, Blockscout-verified. Its `submitter = 0` is still "anyone" until v3 is deployed.
- **v1 retired:** `0xfEe6…b2d3`; do not use it.
- **v3 source:** `pay` requires `msg.sender == auth.submitter` (no zero path). Runtime 23,998 B (578 B margin).
- **Builder tests:** 101 green (`forge test --skip "test/qe/**"`).
- **QE suites:**
  - Full `forge test`: 179 pass, 2 skipped, and 2 fail. Both failures are in QE-owned `QeV2Reattack` and pin v2's zero-submitter behaviour (MSG-050).
  - Fork: the QE v2 bytecode pin fails by construction until the redeploy.

## Mental model (read this first)
- **One contract, no admin.** `contracts/src/Vouch.sol` (≈800 lines). It inherits OZ `EIP712("Vouch","1")`, `Nonces` and `ReentrancyGuardTransient`. Types, events and errors live in `src/interfaces/IVouch.sol`. EIP-712 type strings and struct hashing live in `src/libraries/VouchHash.sol`. The pure split math (slices, fallback weights, top index) lives in `src/libraries/VouchSplit.sol`. USDC is the immutable `USDC` (Arc `0x3600…`). The contract is non-payable.
- **Venues (D-501).**
  - Identity: `venue = address(uint160(uint256(keccak256(abi.encode(owner, salt)))))`.
  - Owner actions: `registerVenue`, `updateTerms`, `setKeys`, `setSeedAmbassador`. Each takes `(…, deadline, ownerSig)`. Every call consumes `_useNonce(owner)`, direct calls included (D-515). If `msg.sender == owner` the signature is skipped; otherwise `_checkOwnerSig` verifies an owner-signed typed message carrying that nonce.
  - Payout guard: `payout` may not be zero, the Vouch contract or USDC (`InvalidPayout`, D-513).
  - Terms: append-only, stored in `_terms[venue][version]` as `{rewardBps, effectiveAt, minOrder}`.
- **Intros (D-505).**
  - `acceptIntro` → `_checkIntro` (window, terms-in-force at issuedAt, + a superseded version is acceptable only ≤ 72 h after the cut (D-516), both signatures) → eligibility (referrer verified-or-seed, customer not verified) → use-key (personal: introHash; broadcast: keccak(introHash, customer)) → `_storeLiveIntro`.
  - Slots: a fixed `LiveIntro[5]` per (venue, customer). `CustomerState.introCount` counts used slots. Slot choice: replace same referrer → reuse expired → append → evict oldest.
- **Pay** (`pay` → `_checkOrder` → `_settle` → `_pullPayment` → `_distribute`):
  1. `_checkOrder`: venue exists, order unexpired, amount in bounds, auth matches the order, `now < auth.deadline`, order not settled, venue signer signature, and LAST the D-519 submitter check (`msg.sender == auth.submitter`, else `UnauthorizedSubmitter`). `submitter = 0` is unpayable. The app signs RELAYER; the kill-the-backend demo signs the customer's own address and the customer EOA calls `pay`.
  2. `_settle`: sets the settled flag, adds gross volume. If the customer is not verified: `_plan` (view) builds the reward plan, then `_recordFirstPurchase` sets verified/rewarded/introducer, venue and ambassador counters, and emits `CustomerVerified`.
  3. `_pullPayment`: **the ONLY USDC pull**, `USDC.receiveWithAuthorization(customer, address(this), amount, 0, deadline, hashStruct(auth), sig)`.
  4. `_distribute`: transfers cashback, then L1s, then L2s via `_tryTransfer` (low-level; requires ≥100k gas before each call; a failure becomes `RewardReturned` reason 2, an out-of-gas failure reverts). A zero L1 share is still recorded as `RewardPaid` with amount 0 (D-514). **The ordering is load-bearing (D-517): never move the payout or the stats writes before the reward transfers.** An L2 share with introducer 0 or introducer == customer is returned without a transfer. Then the venue payout gets the remainder (it must succeed). Then events and stats.
- **`_plan`.**
  - `_eligible` lists live intros that are unexpired and have `amount ≥ frozen minOrder`. If there are none, the purchase is plain.
  - `_applyAttributorWeights` returns a `weightsMode`. Only mode 1 fills the plan. Otherwise `VouchSplit.fallbackWeights` is used.
  - Slices are computed per referrer at its intro's frozen rate. `l2To[i] = introducer of referrer i`.
  - `top = VouchSplit.topIndex` (ties → lower index).
- **`previewPayment`** runs the same `_plan` as a view (the backend quote). Keep it in sync if `_plan` or `_distribute` change.
- **Size.** Runtime is 23,998 B in the v3 source (EIP-170 limit 24,576), so there are only **578 B** of headroom. Enum-like constants are `internal` for that reason, and their values are mirrored in `packages/shared/src/abi/vouchConstants.ts`. When adding code, check `forge build --sizes`.
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
| `contracts/test/VouchQeFixes.t.sol` | Regression tests for QE-C-01..C-07 (submitter, payout, zero L1, nonce, grace, ordering pin + nested-token sweep) + D-519 v3 submitter tests | |
| `contracts/test/mocks/MockNestedFiatToken.sol` | Arc-shaped token whose balance move is a nested call | used by the ordering-pin sweep |
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
- 2026-11-16 — Phase 1.5 v3 submitter rule (D-014 → D-519, MSG-045). Working tree only; nothing deployed or committed.
  - **Rule:** option (a), `msg.sender == auth.submitter`.
  - **Size:** 24,036 → 23,998 B. Option (b) measured 24,042 B.
  - **Tests:** `test_C01_zeroSubmitterAllowsAnyone` replaced by 5 `test_D519_*` tests plus 1 fuzz test. The invariant handler now routes relayer, self-submit and zero-submitter pays, and probes a non-submitter on every pay. 2 fork tests added (self-submit and zero submitter on real Arc USDC).
  - **Unchanged:** `export-abi.sh` output is byte-identical (ABI, topics, EIP-712 type strings).
  - **Messages:** MSG-050 sent to CONTRACTS_QE (2 v2-pinned QE tests and the fork bytecode pin need updating).
- 2026-11-16 — v2 after the QE gate (MSG-014..021):
  - **Fixes:**
    - D-012/D-512 `PaymentAuth.submitter`
    - D-513 payout guard
    - D-514 zero-amount L1 events
    - D-515 owner nonce on direct calls
    - D-516 72 h superseded-terms grace (D-505 corrected)
    - D-517 gas floor + ordering pin + documented limits
  - **Tests:** 11 new regression tests.
  - **Redeploy:** v2 deployed and verified (`0x9C50…b95f`, block 72584790).
  - **Smoke:** OK on v2. 9 txs, $0.0485 gas; canonical pay 409,981 gas.
  - **Round spend:** $0.221 total (including an aborted first smoke: Ben was short of USDC after v1's smoke, so he was topped up $4.55 from DEPLOYER).
- 2026-11-16 — Phase 1:
  - Vouch implemented and tested: 64 unit, 3 fuzz × 1,000, 2 library fuzz × 1,000, 4 invariants over 16,384 calls, golden vectors, 3 fork tests on real Arc USDC.
  - Deployed + Blockscout-verified (`0xfEe6…b2d3`, block 72580272, deploy fee $0.129).
  - Canonical smoke on testnet passed: 9 relayed txs, $0.050 gas, exact 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108.
  - ABI, typed data and deployments exported; D-501..D-511 recorded.

## Next up
- [ ] **v3 redeploy after QE.** Wait for CONTRACTS_QE's independent v3 review and the Orchestrator's go. Then:
  - commit, run `deploy-vouch.sh` (writes `deployments.ts`), Blockscout-verify, run the smoke;
  - add a self-submit smoke variant if asked;
  - hand off the new address and start block (BACKEND_RELAYER, STREAMS_INFRA, FRONTEND_INTEGRATION, ATTRIBUTION_AI);
  - apply the INTERFACES §2/§3 text proposed in the D-519 report.
- [ ] If the contract changes again: keep `previewPayment` consistent with `_plan` / `_distribute`, and re-check `forge build --sizes`.

## Struggles, open questions, known issues
### Known limits (accepted, documented; D-515..D-517)
- **Mempool, intros (QE-C-06):**
  - A personal intro names no customer, so an observer can accept it first ("sniping").
  - With ≥ 6 pending acceptances for one customer, the submitter picks which referrer the 5-slot cap evicts.
  - Mitigation: relay `acceptIntro` privately.
- **`submitter = 0` (D-012):** on the LIVE v2 contract anyone may submit `pay`, so front-running can force the fallback. v3 (D-519, not yet deployed) makes it unpayable.
- **Self-submit (D-519):** the customer's balance must cover `amount` plus the tx fee, since on Arc both are paid in USDC.
- **Submitter choice (D-013):** a public forwarder as submitter is still no binding. The submitter must be the relayer EOA, the customer, or an access-controlled contract.
- **Sybil clusters (QE-C-08):** a customer's own second address can capture the pool. Each sybil costs one real purchase and the gain is capped by rewardBps. This needs off-chain risk flags.
- **Orders are not bound to a customer (QE-C-08):** a third party can pay a QR order first. That is griefing only, since they pay real money.
- **Gas-burning ERC-1271 attributor (QE-C-08):** `pay` needs about 64× normal gas. This is the venue's own misconfiguration.
- **Owner signatures (D-515):** an action pre-signed for a FUTURE owner nonce becomes valid once earlier nonces are used. Sign only the current nonce, with short deadlines.
- **Superseded terms (D-516):** a link shared before a terms change becomes unacceptable 72 h after the change. The referrer must re-share.
- **First purchase (D-509):** the first purchase always consumes the reward chance, even below the minimum order.
- No `revokeIntro` and no venue ownership transfer.
- **Stats:** `customersCredited` counts an L1 even if its transfer failed (blacklist).
### Other notes
- **Size headroom 578 B (v3).** Bigger features need via-IR or moving `previewPayment` into a lens contract.
- **Fork test** shims Arc's native-transfer precompile `0x1800…` (D-511). The live smoke run covers the real precompile.
- **Blockscout** reports a partial match (`bytecode_hash = "none"`).
- **`Intro.issuedAt`** must come from chain time.

## How to run / test this area
```bash
cd contracts && forge build                    # clean (lint classes excluded in foundry.toml with reasons)
forge test --skip "test/qe/**"                 # builder suites: 96 pass (+ fork suite skipped)
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
