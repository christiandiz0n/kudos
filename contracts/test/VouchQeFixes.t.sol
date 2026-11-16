// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {VouchBase} from "./VouchBase.t.sol";
import {Vouch} from "../src/Vouch.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../src/interfaces/IFiatTokenV2_2.sol";
import {MockNestedFiatToken} from "./mocks/MockNestedFiatToken.sol";

/// @notice Regression tests for the CONTRACTS_QE findings QE-C-01..C-07 (MSG-014..MSG-020).
contract VouchQeFixesTest is VouchBase {
    address internal attacker = makeAddr("attacker");

    struct B {
        IVouch.Order o;
        bytes osig;
        IVouch.Weights w;
        bytes wsig;
        IVouch.PaymentAuth a;
        bytes usig;
    }

    function _bundle(uint256 customerPk, uint256 amount, address[] memory refs, uint16[] memory bps, address submitter)
        internal
        returns (B memory b)
    {
        (b.o, b.osig) = _order(venue, amount);
        bytes32 wh;
        if (refs.length > 0) {
            (b.w, b.wsig) = _weights(b.o, vm.addr(customerPk), refs, bps);
            wh = _weightsHash(b.w);
        }
        (b.a,) = _auth(b.o, customerPk, wh);
        b.a.submitter = submitter;
        b.usig = _usdcSig(customerPk, b.a);
        usdc.mint(b.a.customer, amount);
    }

    // ============================================================ QE-C-01 / D-012: submitter binding

    function test_C01_attackerFrontRunRevertsAndHonestSettles() public {
        _canonicalSetup();
        B memory b = _bundle(BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000), relayer);
        // garbage attributor sig, swapped weights, or the exact honest calldata: all rejected for a non-submitter
        vm.prank(priya);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(b.o, b.osig, b.w, hex"deadbeef", b.a, b.usig);
        IVouch.Weights memory swapped = IVouch.Weights(b.w.venue, b.w.customer, b.w.orderId, b.w.referrers, _bps(3_000, 7_000));
        vm.prank(attacker);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(b.o, b.osig, swapped, b.wsig, b.a, b.usig);
        vm.prank(attacker);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        // the honest relayer still settles with the committed attributor weights
        vm.recordLogs();
        vm.prank(relayer);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        assertEq(_mode(vm.getRecordedLogs()), 1);
        assertEq(vouch.introducerOf(venue, ben), ana);
    }

    function test_C01_submitterMismatch_noStateChange() public {
        _canonicalSetup();
        B memory b = _bundle(BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000), relayer);
        uint256 ben0 = usdc.balanceOf(ben);
        uint256 p0 = usdc.balanceOf(payout);
        IVouch.VenueStats memory s0 = vouch.getVenueStats(venue);
        vm.prank(attacker);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        assertFalse(vouch.isOrderSettled(venue, b.o.orderId));
        assertFalse(vouch.getCustomer(venue, ben).verified);
        assertFalse(usdc.authorizationState(ben, _authNonce(b.a)), "USDC authorization not consumed");
        assertEq(usdc.balanceOf(ben), ben0);
        assertEq(usdc.balanceOf(payout), p0);
        assertEq(vouch.getVenueStats(venue).grossVolume, s0.grossVolume);
    }

    function test_C01_zeroSubmitterAllowsAnyone() public {
        _canonicalSetup();
        B memory b = _bundle(BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000), address(0));
        vm.prank(attacker);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        assertTrue(vouch.isOrderSettled(venue, b.o.orderId));
        assertEq(vouch.introducerOf(venue, ben), ana);
    }

    function test_C01_submitterIsBoundByTheCustomerSignature() public {
        // the attacker cannot rewrite auth.submitter to itself: it is part of the EIP-3009 nonce
        B memory b = _bundle(BEN_PK, 6e6, new address[](0), new uint16[](0), relayer);
        b.a.submitter = attacker;
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
    }

    function _mode(Vm.Log[] memory logs) internal view returns (uint8 m) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vouch) && logs[i].topics[0] == PaymentSettled.selector) {
                (,,,,, m) = abi.decode(logs[i].data, (uint256, uint256, uint256, bool, bool, uint8));
            }
        }
    }

    // ============================================================ QE-C-02: payout guard

    function test_C02_payoutCannotBeVouchOrUsdc() public {
        vm.startPrank(lena);
        vm.expectRevert(IVouch.InvalidPayout.selector);
        vouch.setKeys(venue, address(vouch), venueSigner, attributor, 0, "");
        vm.expectRevert(IVouch.InvalidPayout.selector);
        vouch.setKeys(venue, address(usdc), venueSigner, attributor, 0, "");
        IVouch.VenueConfig memory c = _cfg(RATE, 0);
        c.payout = address(vouch);
        vm.expectRevert(IVouch.InvalidPayout.selector);
        vouch.registerVenue(lena, bytes32("p"), c, 0, "");
        vm.stopPrank();
    }

    // ============================================================ QE-C-03: zero-amount L1 credit is in the events

    function test_C03_zeroAmountL1IsRecordedInEvents() public {
        address v2 = _register(lena, keccak256("tiny"), RATE, 0);
        _seed(v2, sam);
        _seed(v2, omar);
        _introduce(v2, SAM_PK, BEN_PK, 0);
        _introduce(v2, OMAR_PK, BEN_PK, 1);
        vm.recordLogs();
        _pay(v2, BEN_PK, 50, _arr(sam, omar), _bps(8_000, 2_000)); // Omar: slice 1 → L1 floor(0.55) = 0
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 omarL1Records;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vouch) || logs[i].topics[0] != RewardPaid.selector) continue;
            if (address(uint160(uint256(logs[i].topics[2]))) != omar) continue;
            (, uint8 role, uint256 amt, address via) = abi.decode(logs[i].data, (address, uint8, uint256, address));
            assertEq(role, 1);
            assertEq(amt, 0);
            assertEq(via, omar);
            omarL1Records++;
        }
        assertEq(omarL1Records, 1, "credit rebuildable from events");
        assertEq(vouch.getAmbassadorStats(omar).customersCredited, 1);
        assertEq(vouch.getAmbassadorStats(omar).l1Earned, 0);
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    // ============================================================ QE-C-04: direct owner actions burn the nonce

    function test_C04_directActionInvalidatesPendingSignedAction() public {
        uint64 dl = uint64(block.timestamp + 7 days);
        uint256 n = vouch.nonces(lena);
        bytes memory stale = _sign(LENA_PK, _digest(keccak256(abi.encode(T_SEED, venue, sam, true, n, dl))));
        vm.prank(lena);
        vouch.setSeedAmbassador(venue, sam, false, 0, ""); // newer direct action
        assertEq(vouch.nonces(lena), n + 1);
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.setSeedAmbassador(venue, sam, true, dl, stale);
        assertFalse(vouch.isSeedAmbassador(venue, sam));
    }

    // ============================================================ QE-C-05: superseded terms only within the grace window

    function test_C05_supersededVersionAcceptableOnlyWithinGrace() public {
        _seed(venue, sam);
        IVouch.Intro memory shared = _introStruct(venue, SAM_PK, 1, bytes32("pre-cut")); // v1, issued before the cut
        vm.warp(block.timestamp + 1 hours);
        vm.prank(lena);
        vouch.updateTerms(venue, 100, 0, 0, ""); // cut to 1%
        uint64 cut = uint64(block.timestamp);
        vm.warp(cut + 72 hours); // boundary inclusive: still acceptable
        _acceptSigned(shared, SAM_PK, BEN_PK);
        vm.warp(cut + 72 hours + 1); // afterwards a v1 intro (shared or back-dated) is refused
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(shared, ANA_PK);
        bytes memory rsig = _sign(SAM_PK, a.introHash);
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(shared, rsig, a, csig);
    }

    function test_C05_backdatedIntroAfterGraceReverts() public {
        _seed(venue, sam);
        uint64 t0 = uint64(block.timestamp);
        vm.warp(t0 + 10 days);
        vm.prank(lena);
        vouch.updateTerms(venue, 100, 0, 0, "");
        vm.warp(t0 + 15 days);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("backdated"));
        i.termsVersion = 1;
        i.issuedAt = t0;
        i.expiresAt = t0 + 30 days;
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, a.introHash);
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    // ============================================================ QE-C-07: _distribute ordering pinned

    /// @dev Every reward transfer precedes the venue payout transfer, and PaymentSettled comes after all transfers.
    function test_distribute_orderingPinned_rewardsBeforePayoutBeforeEvents() public {
        _canonicalSetup();
        vm.recordLogs();
        _pay(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 TRANSFER = keccak256("Transfer(address,address,uint256)");
        uint256 lastRewardTransfer;
        uint256 payoutTransfer;
        uint256 settled;
        uint256 outCount;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(usdc) && logs[i].topics[0] == TRANSFER) {
                if (address(uint160(uint256(logs[i].topics[1]))) != address(vouch)) continue;
                outCount++;
                if (address(uint160(uint256(logs[i].topics[2]))) == payout) payoutTransfer = i;
                else lastRewardTransfer = i;
            }
            if (logs[i].emitter == address(vouch) && logs[i].topics[0] == PaymentSettled.selector) settled = i;
        }
        assertEq(outCount, 6, "5 reward transfers + 1 payout");
        assertGt(payoutTransfer, lastRewardTransfer, "venue payout must be the LAST transfer");
        assertGt(settled, payoutTransfer, "events after all transfers");
    }

    /// @dev Arc-shaped nested-call token: at no gas limit does an under-funded pay() succeed with a redirected share.
    function test_distribute_orderingPinned_nestedTokenStarvationNeverRedirects() public {
        MockNestedFiatToken nested = new MockNestedFiatToken();
        usdc = nested;
        vouch = new Vouch(IFiatTokenV2_2(address(nested)));
        venue = _register(lena, SALT, RATE, MIN_ORDER);
        _canonicalSetup();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        bytes memory cd = abi.encodeCall(vouch.pay, (o, osig, w, wsig, a, usig));
        uint256 ana0 = usdc.balanceOf(ana);
        uint256 omar0 = usdc.balanceOf(omar);
        uint256 successes;
        for (uint256 g = 300_000; g < 1_000_000; g += 1_777) {
            uint256 snap = vm.snapshotState();
            vm.recordLogs();
            vm.prank(relayer);
            (bool ok,) = address(vouch).call{gas: g}(cd);
            if (ok) {
                successes++;
                assertEq(usdc.balanceOf(ana) - ana0, 693_000, "ana underpaid at low gas");
                assertEq(usdc.balanceOf(omar) - omar0, 108_000, "omar underpaid at low gas");
                Vm.Log[] memory logs = vm.getRecordedLogs();
                for (uint256 j; j < logs.length; ++j) {
                    assertTrue(logs[j].topics[0] != RewardReturned.selector, "no returned shares");
                }
            }
            vm.revertToState(snap);
        }
        assertGt(successes, 0, "some gas limit must succeed");
    }
}
