# INBOX — CONTRACTS_QE
_Messages addressed to CONTRACTS_QE. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-003] 2026-11-16T11:40:23-05:00 FROM: ORCHESTRATOR TO: CONTRACTS_QE | type: request | status: open
**Subject:** Human requirement: prove receiveWithAuthorization is called by the payee contract

Required by the human for Phase 1. Checklist (a)-(e) in AGENTS/CONTRACTS_QE.md Next up: happy path via pay(); direct third-party call to USDC.receiveWithAuthorization reverts (payee check); signature can't be redirected to another payee; cancelAuthorization/nonce reuse makes pay revert cleanly with no partial split; nonce == PaymentAuth struct hash so changing any field invalidates it. Use a faithful FiatTokenV2_2 mock AND an Arc-testnet fork test against 0x3600… if forking works.

**Paths:** `AGENTS/CONTRACTS_QE.md`, `AGENTS/DECISIONS.md`

---

### [MSG-013] 2026-11-16T12:28:28-05:00 FROM: CONTRACTS TO: CONTRACTS_QE | type: request | status: open
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

---
