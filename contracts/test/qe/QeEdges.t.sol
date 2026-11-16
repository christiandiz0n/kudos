// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {QeLedger, QeNestedUsdc} from "./mocks/QeNestedUsdc.sol";
import {QeHookReferrer} from "./mocks/QeHookReferrer.sol";

/// @title Boundaries (expiry, deadline, minOrder, amount, decimals), key rotation mid-flow, blacklists, stuck funds,
///        contract size, non-payable.
contract QeEdgesTest is QeBase {
    // ================================================================== time boundaries
    function test_edge_orderExpiryInclusive_authDeadlineExclusive() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        // order.expiresAt == auth.deadline == now + 10 min (fixture). At now == expiresAt: order OK, auth expired.
        vm.warp(b.o.expiresAt);
        vm.expectRevert(IVouch.AuthExpired.selector);
        _exec(b);
        // auth deadline one second later, re-signed: at now == order.expiresAt the payment settles
        b.a.deadline = b.o.expiresAt + 1;
        _resignAuth(b, BEN_PK);
        _exec(b);
        // one second past order expiry: refused
        Bundle memory c = _bundle(venue, PRIYA_PK, 6e6, new address[](0), new uint16[](0));
        c.a.deadline = c.o.expiresAt + 100;
        _resignAuth(c, PRIYA_PK);
        vm.warp(c.o.expiresAt + 1);
        vm.expectRevert(IVouch.OrderExpired.selector);
        _exec(c);
    }

    /// @dev Vouch's deadline rule (now < deadline) equals USDC's validBefore rule, so Vouch never lets a payment reach
    ///      USDC that USDC would refuse for time reasons (and vice versa); validAfter = 0 is always satisfied.
    function test_edge_authDeadlineMatchesUsdcValidBefore() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        vm.warp(b.a.deadline - 1);
        _exec(b); // last valid second for both
        assertTrue(vouch.isOrderSettled(venue, b.o.orderId));
    }

    function test_edge_introExpiryInclusiveAtPayment() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        uint64 exp = vouch.getLiveIntros(venue, ben)[0].expiresAt;
        _seed(venue, omar);
        _introduce(venue, OMAR_PK, PRIYA_PK, 0);
        vm.warp(exp);
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        _exec(b);
        assertTrue(vouch.getCustomer(venue, ben).rewarded, "== expiresAt is still eligible");
        vm.warp(vouch.getLiveIntros(venue, priya)[0].expiresAt + 1);
        Bundle memory c = _bundle(venue, PRIYA_PK, 6e6, new address[](0), new uint16[](0));
        _exec(c);
        assertFalse(vouch.getCustomer(venue, priya).rewarded, "expiresAt + 1 is not (D-509: chance consumed)");
        assertTrue(vouch.getCustomer(venue, priya).verified);
    }

    // ================================================================== amounts
    function test_edge_minOrderBoundaries() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        _introduce(venue, SAM_PK, PRIYA_PK, 0);
        _payFallback(venue, BEN_PK, MIN_ORDER);
        assertTrue(vouch.getCustomer(venue, ben).rewarded, "amount == minOrder rewarded");
        _payFallback(venue, PRIYA_PK, MIN_ORDER - 1);
        assertFalse(vouch.getCustomer(venue, priya).rewarded, "minOrder - 1 is plain");
        // the burned chance is final: a later big purchase is plain too
        _payFallback(venue, PRIYA_PK, 100e6);
        assertFalse(vouch.getCustomer(venue, priya).rewarded);
        assertEq(vouch.getVenueStats(venue).rewardedCustomers, 1);
    }

    /// @dev Decimal mistakes: an 18-decimal amount (12 USDC as 12e18) is refused rather than mis-split; the largest
    ///      accepted amount is $1,000,000 (6 dec) and splits exactly; 1 base unit settles with everything rounding to 0.
    function test_edge_decimalsAndAmountBounds() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e18);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        vm.expectRevert(IVouch.InvalidAmount.selector);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        (o, osig) = _order(venue, 1_000_000e6 + 1);
        (a, usig) = _auth(o, BEN_PK, 0);
        vm.expectRevert(IVouch.InvalidAmount.selector);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        // max amount, rewarded at the maximum 50% rate: exact split, Vouch emptied
        address v2 = _registerAs(lena, keccak256("max"), 5_000, 0);
        _seed(v2, sam);
        _introduce(v2, SAM_PK, BEN_PK, 0);
        uint256 p0 = usdc.balanceOf(payout);
        _payFallback(v2, BEN_PK, 1_000_000e6);
        assertEq(usdc.balanceOf(ben), 125_000e6, "25% of 50%");
        assertEq(usdc.balanceOf(sam), 275_000e6, "55% of 50%");
        assertEq(usdc.balanceOf(payout) - p0, 600_000e6, "50% + returned L2 (seed has no introducer)");
        assertEq(usdc.balanceOf(address(vouch)), 0);
        // 1 base unit
        _introduce(v2, SAM_PK, PRIYA_PK, 0);
        _payFallback(v2, PRIYA_PK, 1);
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    // ================================================================== key rotation mid-flow
    function test_edge_keyRotationMidFlow() public {
        _canonicalSetup();
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        // venue rotates signer + attributor + payout between quote and settlement
        uint256 newSignerPk = 0x5162;
        uint256 newAttrPk = 0xA77C;
        address newPayout = makeAddr("newPayout");
        vm.prank(lena);
        vouch.setKeys(venue, newPayout, vm.addr(newSignerPk), vm.addr(newAttrPk), 0, "");
        // old order signature: refused cleanly, nothing moves
        vm.expectRevert(IVouch.InvalidVenueSignature.selector);
        _exec(b);
        assertEq(usdc.balanceOf(ben), 12e6);
        // new signer re-signs the SAME order: the customer's USDC authorization is still valid (it does not cover the
        // signer); the old attributor signature now selects the fallback (documented consequence of rotation)
        b.osig = _signOrder(b.o, newSignerPk);
        vm.recordLogs();
        _exec(b);
        (uint8 mode, uint256 venueAmount,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 5, "old attributor sig -> BAD_SIGNATURE fallback");
        assertEq(usdc.balanceOf(newPayout), venueAmount, "venue share goes to the NEW payout");
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    // ================================================================== blacklists
    function test_edge_blacklistedL2Introducer_shareReturnedExactSum() public {
        _canonicalSetup();
        usdc.blacklist(omar); // Priya's introducer
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        uint256 p0 = usdc.balanceOf(payout);
        vm.recordLogs();
        _exec(b);
        (uint256 out,) = _sumOutOfVouch(vm.getRecordedLogs());
        assertEq(out, 12e6);
        assertEq(usdc.balanceOf(payout) - p0, 10_200_000 + 108_000);
    }

    function test_edge_blacklistedCustomerOrVouch_revertsCleanly() public {
        _canonicalSetup();
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        usdc.blacklist(ben);
        vm.expectRevert("Blacklistable: account is blacklisted");
        _exec(b);
        usdc.unBlacklist(ben);
        usdc.blacklist(address(vouch));
        vm.expectRevert("Blacklistable: account is blacklisted");
        _exec(b);
        assertFalse(vouch.getCustomer(venue, ben).verified);
        usdc.unBlacklist(address(vouch));
        _exec(b);
    }

    /// @dev Every reward recipient blacklisted at once: all shares return, Σ still exact, payment not blocked.
    function test_edge_allRecipientsBlacklisted_stillSettlesExactly() public {
        _canonicalSetup();
        usdc.blacklist(ana);
        usdc.blacklist(priya);
        usdc.blacklist(sam);
        usdc.blacklist(omar);
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        uint256 p0 = usdc.balanceOf(payout);
        _exec(b);
        assertEq(usdc.balanceOf(payout) - p0, 12e6 - 450_000, "everything but Ben's cashback");
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    // ================================================================== stuck funds (invariant 1)
    /// QE-C-02 (invariant 1 "nothing stays stuck in the contract"). EXPECTED: registerVenue/setKeys refuse
    /// payout == address(vouch) (Vouch has no sweep and no admin, so anything it keeps is lost forever).
    /// ACTUAL: accepted; every payment then leaves the venue share inside Vouch permanently.
    function test_BUG_payoutCanBeTheVouchContract_fundsStuckForever() public {
        vm.prank(lena);
        try vouch.setKeys(venue, address(vouch), venueSigner, attributor, 0, "") {
            _payFallback(venue, BEN_PK, 6e6);
        } catch {}
        assertEq(usdc.balanceOf(address(vouch)), 0, "venue share stuck in Vouch forever");
    }

    // ================================================================== size / payable
    function test_edge_contractSizeHeadroom() public {
        uint256 size = address(vouch).code.length;
        emit log_named_uint("Vouch runtime size (B)", size);
        emit log_named_uint("EIP-170 headroom (B)", 24_576 - size);
        assertLe(size, 24_576);
        assertGe(24_576 - size, 512, "keep >= 512 B headroom for fixes");
    }

    function test_edge_nonPayableEverywhere() public {
        vm.deal(relayer, 1 ether);
        vm.prank(relayer);
        (bool ok,) = address(vouch).call{value: 1}("");
        assertFalse(ok, "no receive()");
        vm.prank(relayer);
        (ok,) = address(vouch).call{value: 1}(hex"12345678");
        assertFalse(ok, "no fallback()");
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        vm.prank(relayer);
        (ok,) = address(vouch).call{value: 1}(_payCalldata(b));
        assertFalse(ok, "pay is non-payable");
        assertEq(address(vouch).balance, 0);
    }
}

/// @notice Re-entrancy through a token callback: with a hook-calling USDC (real USDC has none), a smart-account
///         referrer re-enters pay() for ANOTHER valid payment while receiving its L1 share. nonReentrant must refuse it.
contract QeReentrancyHookTest is QeBase {
    function setUp() public override {
        super.setUp();
        vm.etch(address(usdc), address(new QeNestedUsdc()).code);
        QeNestedUsdc(address(usdc)).setLedger(new QeLedger(address(usdc)));
        QeNestedUsdc(address(usdc)).setHooks(true);
    }

    function test_reentrancy_tokenHookCannotReenterPay() public {
        uint256 ownerPk = 0x0E1;
        QeHookReferrer hook = new QeHookReferrer(vm.addr(ownerPk), address(vouch));
        _seed(venue, address(hook));
        _seed(venue, sam);
        // Ben is introduced by the hook referrer; Priya by Sam (her payment is the re-entry payload)
        IVouch.Intro memory i = IVouch.Intro({
            venue: venue,
            referrer: address(hook),
            termsVersion: 1,
            linkType: 0,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: bytes32("hook")
        });
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        vouch.acceptIntro(i, _sign(ownerPk, _introHash(i)), a, csig);
        _introduce(venue, SAM_PK, PRIYA_PK, 0);
        Bundle memory inner = _bundle(venue, PRIYA_PK, 6e6, _arr(sam), _bps(10_000));
        hook.setReentry(_payCalldata(inner));
        Bundle memory outer = _bundle(venue, BEN_PK, 10e6, _arr(address(hook)), _bps(10_000));
        vm.recordLogs();
        _exec(outer);
        assertGt(hook.hookCalls(), 0, "hook ran during the L1 transfer");
        assertFalse(hook.reentered(), "re-entry refused");
        assertEq(bytes4(hook.lastRet()), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        assertFalse(vouch.isOrderSettled(venue, inner.o.orderId));
        assertEq(usdc.balanceOf(address(hook)), 825_000, "hook referrer still paid its L1 exactly");
        assertEq(usdc.balanceOf(address(vouch)), 0);
        // the inner payment remains perfectly payable afterwards
        _exec(inner);
    }
}
