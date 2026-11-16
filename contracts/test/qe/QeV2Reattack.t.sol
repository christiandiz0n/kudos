// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";

/// @notice A public forwarder ("execute anything for anyone": a multicall / permissionless meta-tx relay).
contract QePublicForwarder {
    function forward(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }
}

/// @notice An access-controlled relay contract (only its operator may forward): a legitimate contract submitter.
contract QeOwnedRelay {
    address public immutable operator;

    constructor(address op) {
        operator = op;
    }

    function forward(address target, bytes calldata data) external {
        require(msg.sender == operator, "relay: not operator");
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// @title Re-attack of the v2 fixes (D-512..D-517): submitter binding (QE-C-01), payout guard (QE-C-02), owner nonces
///        (QE-C-04), superseded-terms grace (QE-C-05), 100k transfer floor on large splits (QE-C-07).
contract QeV2ReattackTest is QeBase {
    address internal attacker = makeAddr("attacker");

    /// @dev Same scenario as QeWeights: fallback would favour Priya 80/20, attributor says Ana 80/20.
    function _frontRunScenario(address submitter) internal returns (Bundle memory b) {
        _twoVerifiedReferrers();
        _introduce(venue, ANA_PK, BEN_PK, 1);
        vm.warp(block.timestamp + 4 days);
        _introduce(venue, PRIYA_PK, BEN_PK, 0);
        b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(8_000, 2_000));
        b.a.submitter = submitter;
        _resignAuth(b, BEN_PK);
    }

    // ================================================================== QE-C-01 submitter binding
    /// @dev The refused front-run changes nothing: the order is not settled and the USDC nonce is not consumed, so the
    ///      honest relayer settles the attributor split afterwards.
    function test_v2_submitterMismatch_noStateChange_honestStillSettles() public {
        Bundle memory b = _frontRunScenario(relayer);
        address[3] memory others = [priya, ben, attacker]; // a referrer, the customer itself, a stranger
        for (uint256 i; i < 3; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
            vouch.pay(b.o, b.osig, b.w, "", b.a, b.usig);
        }
        assertFalse(vouch.isOrderSettled(venue, b.o.orderId));
        assertFalse(usdc.authorizationState(ben, _authNonce(b.a)));
        _exec(b);
        assertEq(vouch.introducerOf(venue, ben), ana, "attributor split honoured");
    }

    /// @dev The customer's signature cannot be re-targeted to another submitter: submitter is inside the USDC nonce.
    ///      v3 (D-519): the "downgrade to 0" half is now refused by Vouch itself (UnauthorizedSubmitter, msg.sender is
    ///      never 0) before USDC is reached; whichever check fires, nothing moves and the authorization stays unused.
    function test_v2_submitterSwapBreaksTheUsdcSignature() public {
        Bundle memory b = _frontRunScenario(relayer);
        b.a.submitter = attacker;
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vouch.pay(b.o, b.osig, b.w, "", b.a, b.usig);
        b.a.submitter = address(0); // nor "downgraded" to anyone
        address[3] memory callers = [attacker, relayer, ben];
        for (uint256 i; i < 3; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
            vouch.pay(b.o, b.osig, b.w, "", b.a, b.usig);
        }
        b.a.submitter = relayer;
        assertFalse(usdc.authorizationState(ben, _authNonce(b.a)), "signed authorization still unused");
        assertFalse(vouch.isOrderSettled(venue, b.o.orderId));
        _exec(b);
        assertEq(vouch.introducerOf(venue, ben), ana, "the honest relayer still settles the attributor split");
    }

    /// FIXED (QE-C-09 residual, was test_LIMIT_zeroSubmitterReopensFrontRun; v3 D-014/D-519): submitter = 0 no longer
    /// means "anyone". A zero-submitter auth is unpayable by everyone (front-runner, relayer, the customer itself), so
    /// the QE-C-01 front-run cannot be re-opened by the client choosing 0. No state changes and the USDC authorization
    /// is never consumed.
    function test_FIXED_zeroSubmitterUnpayable() public {
        Bundle memory b = _frontRunScenario(address(0));
        address[4] memory callers = [priya, attacker, relayer, ben];
        uint256 ben0 = usdc.balanceOf(ben);
        for (uint256 i; i < 4; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
            vouch.pay(b.o, b.osig, b.w, i == 0 ? bytes(hex"dead") : b.wsig, b.a, b.usig);
        }
        assertFalse(vouch.isOrderSettled(venue, b.o.orderId), "order not settled");
        assertFalse(vouch.getCustomer(venue, ben).verified, "customer not verified");
        assertEq(vouch.introducerOf(venue, ben), address(0), "no introducer frozen");
        assertEq(vouch.getLiveIntros(venue, ben).length, 2, "intros untouched");
        assertFalse(usdc.authorizationState(ben, _authNonce(b.a)), "USDC authorization not consumed");
        assertEq(usdc.balanceOf(ben), ben0);
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    /// LIMIT (QE-C-09, Low): a PUBLIC forwarder/multicall as submitter is no binding at all: msg.sender is the forwarder
    /// for everyone (Vouch has no ERC-2771 _msgSender). Same for any meta-tx relay that executes for anybody.
    function test_LIMIT_publicForwarderAsSubmitterIsNoBinding() public {
        QePublicForwarder fwd = new QePublicForwarder();
        Bundle memory b = _frontRunScenario(address(fwd));
        vm.prank(priya);
        fwd.forward(address(vouch), abi.encodeCall(vouch.pay, (b.o, b.osig, b.w, hex"dead", b.a, b.usig)));
        assertEq(vouch.introducerOf(venue, ben), priya, "front-run through the public forwarder");
    }

    /// @dev An access-controlled contract submitter works: only its operator gets through.
    function test_v2_accessControlledContractSubmitterHolds() public {
        QeOwnedRelay r = new QeOwnedRelay(relayer);
        Bundle memory b = _frontRunScenario(address(r));
        bytes memory bad = abi.encodeCall(vouch.pay, (b.o, b.osig, b.w, hex"dead", b.a, b.usig));
        vm.prank(priya);
        vm.expectRevert("relay: not operator");
        r.forward(address(vouch), bad);
        vm.prank(priya);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(b.o, b.osig, b.w, hex"dead", b.a, b.usig);
        vm.prank(relayer);
        r.forward(address(vouch), _payCalldata(b));
        assertEq(vouch.introducerOf(venue, ben), ana);
    }

    // ================================================================== QE-C-02 payout guard
    function test_v2_payoutGuard_allEntryPoints() public {
        address[3] memory bad = [address(vouch), address(usdc), address(0)];
        for (uint256 i; i < 3; ++i) {
            IVouch.VenueConfig memory c = _cfg(RATE, MIN_ORDER);
            c.payout = bad[i];
            vm.prank(lena);
            vm.expectRevert(); // InvalidPayout (Vouch/USDC) or ZeroAddress (0)
            vouch.registerVenue(lena, keccak256(abi.encode("bad", i)), c, 0, "");
            vm.prank(lena);
            vm.expectRevert();
            vouch.setKeys(venue, bad[i], venueSigner, attributor, 0, "");
        }
        // relayed path too
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sign(
            LENA_PK,
            _digest(keccak256(abi.encode(T_KEYS, venue, address(vouch), venueSigner, attributor, vouch.nonces(lena), dl)))
        );
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidPayout.selector);
        vouch.setKeys(venue, address(vouch), venueSigner, attributor, dl, sig);
    }

    /// INFO: system addresses (Arc's native-transfer precompile 0x1800…, the EIP-7708 emitter 0xffff…fffe) are accepted
    /// as payout. Live eth_call shows real Arc USDC accepts transfers to both (it blocks only transfers to 0x3600), so a
    /// venue choosing them burns its own share to a keyless address. Nothing stays in Vouch (invariant 1 holds); this
    /// is the same class as payout = 0x…dEaD and is the owner's own misconfiguration.
    function test_INFO_systemAddressPayoutAcceptedButNothingStuckInVouch() public {
        address[2] memory sys = [0x1800000000000000000000000000000000000000, 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF];
        for (uint256 i; i < 2; ++i) {
            vm.prank(lena);
            vouch.setKeys(venue, sys[i], venueSigner, attributor, 0, "");
            _payFallback(venue, i == 0 ? BEN_PK : PRIYA_PK, 6e6);
            assertEq(usdc.balanceOf(address(vouch)), 0, "nothing stuck in Vouch");
        }
    }

    // ================================================================== QE-C-04 owner nonces
    /// LIMIT (residual, documented in MSG-027): a signature for a FUTURE nonce becomes valid once the nonces before it
    /// are used, including by direct actions. Owners must not pre-sign ahead; the API should sign only nonces(owner).
    function test_LIMIT_futureNonceSignatureBecomesValidAfterDirectActions() public {
        uint64 dl = uint64(block.timestamp + 7 days);
        uint256 n = vouch.nonces(lena);
        bytes memory future =
            _sign(LENA_PK, _digest(keccak256(abi.encode(T_SEED, venue, attacker, true, n + 1, dl))));
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.setSeedAmbassador(venue, attacker, true, dl, future);
        vm.prank(lena);
        vouch.setSeedAmbassador(venue, sam, true, 0, ""); // unrelated direct action consumes n
        vm.prank(relayer);
        vouch.setSeedAmbassador(venue, attacker, true, dl, future);
        assertTrue(vouch.isSeedAmbassador(venue, attacker));
    }

    // ================================================================== QE-C-05 superseded grace (72h)
    function _cutAt() internal returns (uint64 cut, IVouch.Intro memory i) {
        _seed(venue, sam);
        uint64 issued = uint64(block.timestamp);
        vm.warp(block.timestamp + 1 days);
        vm.prank(lena);
        vouch.updateTerms(venue, 100, MIN_ORDER, 0, "");
        cut = uint64(block.timestamp);
        i = IVouch.Intro({
            venue: venue,
            referrer: sam,
            termsVersion: 1,
            linkType: 1,
            issuedAt: issued,
            expiresAt: issued + 30 days,
            nonce: bytes32("grace")
        });
    }

    function test_v2_graceBoundary_inclusiveAt72h() public {
        (uint64 cut, IVouch.Intro memory i) = _cutAt();
        vm.warp(cut + 72 hours);
        _acceptSigned(i, SAM_PK, BEN_PK); // == cut + 72h: accepted (inclusive)
        assertEq(vouch.getLiveIntros(venue, ben)[0].termsVersion, 1);
    }

    function test_v2_graceBoundary_rejectedAt72hPlus1() public {
        (uint64 cut, IVouch.Intro memory i) = _cutAt();
        vm.warp(cut + 72 hours + 1);
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    /// @dev Grace is measured from the cut of THAT version, not the latest change: a second cut 1h later does not
    ///      extend v1's window, and v2 (superseded 1h after it started) is itself only reachable within its own 72h.
    function test_v2_graceMeasuredPerVersion() public {
        (uint64 cut, IVouch.Intro memory i) = _cutAt();
        vm.warp(cut + 1 hours);
        vm.prank(lena);
        vouch.updateTerms(venue, 200, MIN_ORDER, 0, ""); // v3 at cut + 1h
        vm.warp(cut + 72 hours + 30 minutes); // v1 grace over (from cut), v2 grace still open (from cut + 1h)
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        IVouch.Intro memory j = i;
        j = IVouch.Intro({
            venue: venue,
            referrer: sam,
            termsVersion: 2,
            linkType: 1,
            issuedAt: cut + 10 minutes,
            expiresAt: cut + 20 days,
            nonce: bytes32("v2")
        });
        _acceptSigned(j, SAM_PK, BEN_PK);
    }

    /// INFO (product consequence of D-516): an HONEST link issued before a terms change (e.g. a 30-day broadcast QR)
    /// stops being acceptable 72h after the change; the referrer must re-issue on the current version. Intros already
    /// accepted keep their frozen terms (invariant 8).
    function test_INFO_honestPreCutLinkDies72hAfterTermsChange() public {
        (uint64 cut, IVouch.Intro memory i) = _cutAt();
        vm.warp(cut + 4 days);
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    // ================================================================== QE-C-07 floor on a maximal split
    address[5] internal refs5;
    uint256[5] internal refPks = [uint256(0xC001), 0xC002, 0xC003, 0xC004, 0xC005];
    uint256[5] internal seedPks = [uint256(0xD001), 0xD002, 0xD003, 0xD004, 0xD005];

    /// @dev 5 referrers, each with its own introducer: 1 pull + 1 cashback + 5 L1 + 5 L2 + 1 payout = 13 balance moves.
    function _maxSplit() internal returns (bytes memory cd, address[11] memory who) {
        address[] memory r = new address[](5);
        uint16[] memory w = new uint16[](5);
        for (uint256 k; k < 5; ++k) {
            _seed(venue, vm.addr(seedPks[k]));
            _introduce(venue, seedPks[k], refPks[k], 0);
            _pay(venue, refPks[k], 10e6, _arr(vm.addr(seedPks[k])), _bps(10_000));
            r[k] = vm.addr(refPks[k]);
            w[k] = 2_000;
            who[k] = r[k];
            who[5 + k] = vm.addr(seedPks[k]);
        }
        for (uint256 k; k < 5; ++k) {
            _introduce(venue, refPks[k], BEN_PK, uint8(k % 2));
        }
        who[10] = payout;
        Bundle memory b = _bundle(venue, BEN_PK, 100e6, r, w);
        cd = _payCalldata(b);
    }

    function _balances(address[11] memory who) internal view returns (uint256[11] memory bal) {
        for (uint256 k; k < 11; ++k) {
            bal[k] = usdc.balanceOf(who[k]);
        }
    }

    address[11] internal who11;
    bytes internal cdMax;

    /// @dev Returned in MEMORY: revertToState also reverts this test contract's storage.
    function _reference() internal returns (uint256[11] memory refBal) {
        uint256 snap = vm.snapshotState();
        vm.prank(relayer);
        (bool okRef,) = address(vouch).call{gas: 5_000_000}(cdMax);
        assertTrue(okRef);
        refBal = _balances(who11);
        vm.revertToState(snap);
    }

    function _maxThreshold() internal returns (uint256 hi) {
        uint256 lo = 100_000;
        hi = 5_000_000;
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            uint256 s = vm.snapshotState();
            vm.prank(relayer);
            (bool ok,) = address(vouch).call{gas: mid}(cdMax);
            vm.revertToState(s);
            if (ok) hi = mid;
            else lo = mid;
        }
    }

    function _tryAt(uint256 g, uint256[11] memory refBal) internal returns (bool success) {
        uint256 fmp;
        assembly {
            fmp := mload(0x40)
        }
        uint256 s = vm.snapshotState();
        vm.prank(relayer);
        (success,) = address(vouch).call{gas: g}(cdMax);
        if (success) {
            uint256[11] memory got = _balances(who11);
            for (uint256 k; k < 11; ++k) {
                assertEq(got[k], refBal[k], "an under-funded max split paid someone differently");
            }
        }
        vm.revertToState(s);
        assembly {
            mstore(0x40, fmp)
        }
    }

    function _maxSplitSweep(bool near) internal {
        (cdMax, who11) = _maxSplit();
        uint256[11] memory refBal = _reference();
        uint256 hi = _maxThreshold();
        emit log_named_uint("max split (5 referrers + 5 introducers): min successful gas limit", hi);
        emit log_named_uint("Arc block gas limit (live)", 30_000_000);
        assertLt(hi, 3_000_000, "the 100k floor does not brick a maximal split (block limit 30M)");
        uint256 successes;
        uint256 from = near ? hi - 800 : hi - 300_000;
        uint256 to = near ? hi + 150 : hi - 800;
        uint256 step = near ? 1 : 307;
        for (uint256 g = from; g <= to; g += step) {
            if (_tryAt(g, refBal)) successes++;
        }
        emit log_named_uint("successes (all identical to the ample-gas outcome)", successes);
        if (near) assertGt(successes, 0);
        else assertEq(successes, 0);
    }

    function test_v2_maxSplitGasFloor_near_1gas() public {
        _maxSplitSweep(true);
    }

    function test_v2_maxSplitGasFloor_far() public {
        _maxSplitSweep(false);
    }
}
