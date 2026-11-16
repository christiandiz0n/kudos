// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";

/// @title Weights griefing / fallback / front-running.
/// @notice Property: bad weights never block a payment (invariant 6). Finding QE-C-01: because pay() is permissionless
///         and every argument is public in the mempool, ANY observer can re-submit the honest relayer's calldata with a
///         garbage attributor signature (or swapped weights) and force the fallback split, overriding the
///         attributor-signed, customer-committed weights and rewriting the frozen introducer.
contract QeWeightsTest is QeBase {
    /// @dev Ana: older broadcast intro (4 days → 1 halving). Priya: fresh personal intro. Attributor says Ana 80 / Priya
    ///      20; the on-chain fallback says Ana 20 / Priya 80. Priya profits from forcing the fallback.
    function _frontRunSetup() internal returns (Bundle memory b) {
        _twoVerifiedReferrers();
        _introduce(venue, ANA_PK, BEN_PK, 1);
        vm.warp(block.timestamp + 4 days);
        _introduce(venue, PRIYA_PK, BEN_PK, 0);
        b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(8_000, 2_000));
        // sanity: what the honest submission would settle
        IVouch.Quote memory q =
            vouch.previewPayment(venue, ben, b.o.orderId, b.o.amount, b.w, b.wsig, b.a.weightsHash);
        assertEq(q.weightsMode, 1, "honest = ATTRIBUTOR");
        assertEq(q.introducer, ana);
        IVouch.Quote memory fq = vouch.previewPayment(venue, ben, b.o.orderId, b.o.amount, b.w, "", b.a.weightsHash);
        assertEq(fq.weightsMode, 5);
        assertEq(fq.introducer, priya, "fallback would crown Priya");
    }

    function _honestOutcomeAfterFrontRun(Bundle memory b) internal {
        if (!vouch.isOrderSettled(venue, b.o.orderId)) _exec(b);
        assertEq(vouch.introducerOf(venue, ben), ana, "front-runner rewrote the committed attributor split/introducer");
    }

    /// QE-C-01 (Medium) — FIXED in v2 (D-012/D-512: PaymentAuth.submitter): Priya's front-run now reverts
    /// UnauthorizedSubmitter and the honest relayer settles the attributor split. Original finding — EXPECTED: the attributor-signed weights the customer committed to (weightsHash in the USDC nonce)
    /// are honoured, or the tampered submission reverts. ACTUAL: Priya front-runs with attributorSig = "" →
    /// WEIGHTS_FALLBACK_BAD_SIGNATURE; Priya takes 80% of L1 (≈ $0.79 instead of $0.20) and becomes Ben's introducer forever.
    function test_FIXED_frontRunWithGarbageAttributorSigForcesFallback() public {
        Bundle memory b = _frontRunSetup();
        uint256 priya0 = usdc.balanceOf(priya);
        vm.prank(priya); // anyone; Priya is the one who benefits
        try vouch.pay(b.o, b.osig, b.w, hex"deadbeef", b.a, b.usig) {}
        catch (bytes memory err) {
            assertEq(bytes4(err), IVouch.UnauthorizedSubmitter.selector, "v2: front-run refused by submitter binding");
        }
        emit log_named_uint("priya L1 gained by front-running (base units)", usdc.balanceOf(priya) - priya0);
        _honestOutcomeAfterFrontRun(b);
    }

    /// QE-C-01 variant: swapped weights (hash mismatch) also degrade to the fallback.
    function test_FIXED_frontRunWithSwappedWeightsForcesFallback() public {
        Bundle memory b = _frontRunSetup();
        // independent copy: `swapped = b.w` would alias b.w and make the HONEST resubmission carry the swapped bps
        // (that aliasing bug in this test was found by CONTRACTS in MSG-024 and confirmed by QE)
        IVouch.Weights memory swapped = IVouch.Weights({
            venue: b.w.venue, customer: b.w.customer, orderId: b.w.orderId, referrers: b.w.referrers, bps: _bps(2_000, 8_000)
        });
        vm.prank(priya);
        try vouch.pay(b.o, b.osig, swapped, b.wsig, b.a, b.usig) {} catch {}
        _honestOutcomeAfterFrontRun(b);
    }

    // -------------------------------------------------------------------- never-revert properties (pass)

    /// @dev Every malformed weights shape settles (never reverts) and Σ out == amount, with the expected mode.
    function test_badWeightsShapes_alwaysFallBack_neverRevert() public {
        _canonicalSetup();
        address stranger = makeAddr("stranger");
        address[] memory r;
        uint16[] memory w;
        // (refs, bps, expectedMode)
        _shape(_arr(ana, ana), _bps(5_000, 5_000), 4); // duplicate
        _shape(_arr(ana, priya), _bps(0, 10_000), 4); // zero bps
        _shape(_arr(ana, priya), _bps(8_001, 1_999), 4); // > 8,000 with n > 1
        _shape(_arr(ana, priya), _bps(7_000, 2_999), 4); // Σ ≠ 10,000
        _shape(_arr(ana, priya), _bps(7_000, 3_001), 4); // Σ ≠ 10,000 (over)
        _shape(_arr(ana, stranger), _bps(7_000, 3_000), 4); // referrer without intro
        _shape(_arr(ana, sam), _bps(7_000, 3_000), 4); // verified ambassador, but no intro for Ben
        _shape(_arr(ana), _bps(9_999), 4); // single referrer must be exactly 10,000
        // 6 referrers
        r = new address[](6);
        w = new uint16[](6);
        for (uint256 i; i < 6; ++i) {
            r[i] = i % 2 == 0 ? ana : priya;
            w[i] = i < 4 ? 1_667 : 1_666;
        }
        _shape(r, w, 4);
        // length mismatch
        _shape(_arr(ana, priya), _bps(10_000), 4);
        // huge arrays (gas bomb attempt): 2,000 entries
        r = new address[](2_000);
        w = new uint16[](2_000);
        _shape(r, w, 4);
    }

    function _shape(address[] memory refs, uint16[] memory bps, uint8 expectedMode) internal {
        uint256 snap = vm.snapshotState();
        bytes memory cd = _shapeCalldata(refs, bps);
        vm.recordLogs();
        (bool ok, uint256 g) = _relayRaw(cd);
        assertTrue(ok, "pay must not revert on bad weights");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint8 mode,, bool found) = _settledMode(logs);
        assertTrue(found);
        assertEq(mode, expectedMode, "fallback mode");
        (uint256 out,) = _sumOutOfVouch(logs);
        assertEq(out, 12e6, "exact sum");
        // The environment charges per calldata byte (EIP-7623 floor), the submitter's own cost: compare with the gas
        // of a trivial view receiving the same number of bytes.
        uint256 t = _trivialCallGas(cd.length);
        g = g > t ? g - t : 0;
        assertLt(g, 470_000, "bad weights cannot gas-bomb pay beyond a normal pay (~435k)");
        emit log_named_uint("pay() gas above a trivial call with the same calldata", g);
        vm.revertToState(snap);
    }

    function _shapeCalldata(address[] memory refs, uint16[] memory bps) internal returns (bytes memory) {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        IVouch.Weights memory w =
            IVouch.Weights({venue: venue, customer: ben, orderId: o.orderId, referrers: refs, bps: bps});
        bytes memory wsig = _sign(ATTR_PK, _digest(_weightsHash(w)));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        return abi.encodeCall(vouch.pay, (o, osig, w, wsig, a, usig));
    }

    function _relayRaw(bytes memory cd) internal returns (bool ok, uint256 g) {
        vm.prank(relayer);
        g = gasleft();
        (ok,) = address(vouch).call(cd);
        g -= gasleft();
    }

    /// @dev Gas of a trivial view call carrying `len` bytes of calldata (what merely submitting that much data costs).
    function _trivialCallGas(uint256 len) internal returns (uint256 g) {
        bytes memory big = abi.encodePacked(vouch.isOrderSettled.selector, new bytes(len - 4));
        g = gasleft();
        (bool ok,) = address(vouch).call(big);
        g -= gasleft();
        assertTrue(ok);
    }

    /// @dev Fuzz: arbitrary attacker-chosen weights + signature bytes, committed or not → never reverts, exact sum,
    ///      only intro holders paid L1, cashback ≤ 25% of the pool.
    function testFuzz_arbitraryWeightsNeverBlockPayment(
        address[] memory refs,
        uint16[] memory bps,
        bytes memory sig,
        bool commit,
        bool signIt
    ) public {
        _canonicalSetup();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        IVouch.Weights memory w =
            IVouch.Weights({venue: venue, customer: ben, orderId: o.orderId, referrers: refs, bps: bps});
        if (signIt) sig = _sign(ATTR_PK, _digest(_weightsHash(w)));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, commit ? _weightsHash(w) : bytes32(0));
        usdc.mint(ben, o.amount);
        uint256 ben0 = usdc.balanceOf(ben);
        vm.recordLogs();
        vm.prank(relayer);
        vouch.pay(o, osig, w, sig, a, usig); // must not revert
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (uint256 out,) = _sumOutOfVouch(logs);
        assertEq(out, 12e6);
        assertEq(usdc.balanceOf(address(vouch)), 0);
        // only Ana / Priya (the intro holders) can receive L1; cashback ≤ 25% of max pool (15%)
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vouch) && logs[i].topics[0] == PAID_SIG) {
                (, uint8 role,,) = abi.decode(logs[i].data, (address, uint8, uint256, address));
                address to = address(uint160(uint256(logs[i].topics[2])));
                if (role == 1) assertTrue(to == ana || to == priya, "L1 only to intro holders");
                if (role == 2) assertTrue(to == sam || to == omar, "L2 only to recorded introducers");
            }
        }
        assertLe(usdc.balanceOf(ben) + o.amount - ben0, 12e6 * 1_500 / 10_000 / 4);
    }
}
