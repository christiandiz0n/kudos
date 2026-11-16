// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {VouchBase} from "./VouchBase.t.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";

contract VouchTest is VouchBase {
    // =====================================================================================
    // Canonical story (README): $12.00, 15%, Ana 70% / Priya 30%, both with introducers.
    // =====================================================================================

    function test_canonical_exactSplit() public {
        _canonicalSetup();
        uint256 p0 = usdc.balanceOf(payout);
        uint256 ben0 = usdc.balanceOf(ben);
        uint256 ana0 = usdc.balanceOf(ana);
        uint256 priya0 = usdc.balanceOf(priya);
        uint256 sam0 = usdc.balanceOf(sam);
        uint256 omar0 = usdc.balanceOf(omar);

        IVouch.Order memory o = _pay(venue, BEN_PK, 12_000_000, _arr(ana, priya), _bps(7_000, 3_000));

        assertEq(usdc.balanceOf(payout) - p0, 10_200_000, "venue $10.20");
        assertEq(usdc.balanceOf(ben) - ben0, 450_000, "ben cashback $0.45"); // minted 12.00, paid 12.00
        assertEq(usdc.balanceOf(ana) - ana0, 693_000, "ana L1 $0.693");
        assertEq(usdc.balanceOf(priya) - priya0, 297_000, "priya L1 $0.297");
        assertEq(usdc.balanceOf(sam) - sam0, 252_000, "sam L2 (ana's introducer) $0.252");
        assertEq(usdc.balanceOf(omar) - omar0, 108_000, "omar L2 (priya's introducer) $0.108");
        assertEq(usdc.balanceOf(address(vouch)), 0, "contract holds nothing");

        IVouch.CustomerState memory cs = vouch.getCustomer(venue, ben);
        assertTrue(cs.verified && cs.rewarded);
        assertEq(cs.introducer, ana, "introducer = top-weight L1");
        assertTrue(vouch.isOrderSettled(venue, o.orderId));
        assertTrue(vouch.canRefer(venue, ben));
    }

    function test_canonical_events() public {
        _canonicalSetup();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12_000_000);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);

        vm.expectEmit(address(vouch));
        emit CustomerVerified(venue, ben, ana, o.orderId);
        vm.expectEmit(address(vouch));
        emit PaymentSettled(venue, ben, o.orderId, 12_000_000, 10_200_000, 1_800_000, true, true, 1);
        vm.expectEmit(address(vouch));
        emit RewardPaid(o.orderId, ben, venue, ben, 0, 450_000, address(0));
        vm.expectEmit(address(vouch));
        emit RewardPaid(o.orderId, ana, venue, ben, 1, 693_000, ana);
        vm.expectEmit(address(vouch));
        emit RewardPaid(o.orderId, priya, venue, ben, 1, 297_000, priya);
        vm.expectEmit(address(vouch));
        emit RewardPaid(o.orderId, sam, venue, ben, 2, 252_000, ana);
        vm.expectEmit(address(vouch));
        emit RewardPaid(o.orderId, omar, venue, ben, 2, 108_000, priya);
        vm.prank(relayer);
        vouch.pay(o, osig, w, wsig, a, usig);
    }

    function test_canonical_previewMatches() public {
        _canonicalSetup();
        (IVouch.Order memory o,) = _order(venue, 12_000_000);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        IVouch.Quote memory q = vouch.previewPayment(venue, ben, o.orderId, o.amount, w, wsig, _weightsHash(w));
        assertTrue(q.firstPurchase && q.rewarded);
        assertEq(q.weightsMode, 1);
        assertEq(q.rewardPool, 1_800_000);
        assertEq(q.cashback, 450_000);
        assertEq(q.venueAmount, 10_200_000);
        assertEq(q.introducer, ana);
        assertEq(q.l1Amounts[0], 693_000);
        assertEq(q.l1Amounts[1], 297_000);
        assertEq(q.l2Recipients[0], sam);
        assertEq(q.l2Recipients[1], omar);
        assertEq(q.l2Amounts[0], 252_000);
        assertEq(q.l2Amounts[1], 108_000);
        assertEq(q.termsVersions[0], 1);
    }

    function test_canonical_stats() public {
        _canonicalSetup();
        _pay(venue, BEN_PK, 12_000_000, _arr(ana, priya), _bps(7_000, 3_000));
        IVouch.AmbassadorStats memory a = vouch.getAmbassadorStats(ana);
        assertEq(a.customersCredited, 1);
        assertEq(a.venues, 1);
        assertEq(a.l1Earned, 693_000);
        assertEq(a.l2Earned, 0);
        IVouch.AmbassadorStats memory s = vouch.getAmbassadorStats(sam);
        assertEq(s.customersCredited, 1); // Ana
        assertEq(s.l1Earned, 20e6 * 1500 / 10_000 * 5500 / 10_000);
        assertEq(s.l2Earned, 252_000);
        IVouch.VenueStats memory vs = vouch.getVenueStats(venue);
        assertEq(vs.verifiedCustomers, 3);
        assertEq(vs.rewardedCustomers, 3);
        assertEq(vs.grossVolume, 52e6);
        // Ana/Priya first purchases: pool $3.00 each, L2 $0.60 each returned (seeds have no introducer).
        assertEq(vs.rewardsReturned, 2 * 600_000);
        assertEq(vs.rewardsPaid, 2 * 2_400_000 + 1_800_000);
    }

    /// @dev Isolated canonical pay() for a precise gas number (see report).
    function test_gas_canonicalPay() public {
        _canonicalSetup();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12_000_000);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        vm.prank(relayer);
        uint256 g = gasleft();
        vouch.pay(o, osig, w, wsig, a, usig);
        emit log_named_uint("pay() gas, canonical 2-level split (mock USDC)", g - gasleft());
    }

    // =====================================================================================
    // Venues
    // =====================================================================================

    function test_register_storesVenueAndTerms() public view {
        IVouch.Venue memory v = vouch.getVenue(venue);
        assertEq(v.owner, lena);
        assertEq(v.payout, payout);
        assertEq(v.signer, venueSigner);
        assertEq(v.attributor, attributor);
        assertEq(v.termsVersion, 1);
        assertEq(venue, vouch.computeVenueId(lena, SALT));
        (uint32 tv, IVouch.Terms memory t) = vouch.currentTerms(venue);
        assertEq(tv, 1);
        assertEq(t.rewardBps, RATE);
        assertEq(t.minOrder, MIN_ORDER);
    }

    function _registerSig(uint256 ownerPk, bytes32 salt, IVouch.VenueConfig memory c, uint256 nonce, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 sh = keccak256(
            bytes.concat(
                abi.encode(T_REGISTER, vm.addr(ownerPk), salt, c.payout, c.signer, c.attributor),
                abi.encode(c.rewardBps, c.minOrder, keccak256(bytes(c.metadataURI)), nonce, deadline)
            )
        );
        return _sign(ownerPk, _digest(sh));
    }

    function test_register_relayedWithOwnerSig() public {
        IVouch.VenueConfig memory c = _cfg(1000, 0);
        uint64 dl = uint64(block.timestamp + 1 hours);
        uint256 n = vouch.nonces(lena); // 1: the direct registration in setUp consumed nonce 0 (QE-C-04)
        assertEq(n, 1);
        bytes memory sig = _registerSig(LENA_PK, bytes32("two"), c, n, dl);
        vm.prank(relayer);
        address v2 = vouch.registerVenue(lena, bytes32("two"), c, dl, sig);
        assertEq(vouch.getVenue(v2).owner, lena);
        assertEq(vouch.nonces(lena), n + 1);
        // replay of the same signature (nonce consumed / venue exists) fails
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.registerVenue(lena, bytes32("two"), c, dl, sig);
    }

    function test_register_revertsBadSigExpiredDuplicateAndBounds() public {
        IVouch.VenueConfig memory c = _cfg(1000, 0);
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory wrong = _registerSig(BEN_PK, bytes32("x"), c, 0, dl);
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.registerVenue(lena, bytes32("x"), c, dl, wrong);

        bytes memory sig = _registerSig(LENA_PK, bytes32("x"), c, 0, dl);
        vm.warp(dl + 1);
        vm.prank(relayer);
        vm.expectRevert(IVouch.SignatureExpired.selector);
        vouch.registerVenue(lena, bytes32("x"), c, dl, sig);

        vm.prank(lena);
        vm.expectRevert(IVouch.VenueAlreadyRegistered.selector);
        vouch.registerVenue(lena, SALT, c, 0, "");

        vm.startPrank(lena);
        vm.expectRevert(IVouch.InvalidTerms.selector);
        vouch.registerVenue(lena, bytes32("a"), _cfg(0, 0), 0, "");
        vm.expectRevert(IVouch.InvalidTerms.selector);
        vouch.registerVenue(lena, bytes32("b"), _cfg(5_001, 0), 0, "");
        vm.expectRevert(IVouch.InvalidTerms.selector);
        vouch.registerVenue(lena, bytes32("c"), _cfg(100, 10_000e6 + 1), 0, "");
        c.signer = address(0);
        vm.expectRevert(IVouch.ZeroAddress.selector);
        vouch.registerVenue(lena, bytes32("d"), c, 0, "");
        vm.expectRevert(IVouch.ZeroAddress.selector);
        vouch.registerVenue(address(0), bytes32("e"), _cfg(100, 0), 0, "");
        vm.stopPrank();
        // max rate is allowed
        vm.prank(lena);
        vouch.registerVenue(lena, bytes32("f"), _cfg(5_000, 10_000e6), 0, "");
    }

    function test_updateTerms_versionsAreAppendOnly() public {
        vm.prank(lena);
        vouch.updateTerms(venue, 1_000, 1e6, 0, "");
        (uint32 tv, IVouch.Terms memory t) = vouch.currentTerms(venue);
        assertEq(tv, 2);
        assertEq(t.rewardBps, 1_000);
        assertEq(vouch.getTerms(venue, 1).rewardBps, RATE, "v1 unchanged");

        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig =
            _sign(LENA_PK, _digest(keccak256(abi.encode(T_TERMS, venue, uint16(2_000), uint256(0), vouch.nonces(lena), dl))));
        vm.prank(relayer);
        vouch.updateTerms(venue, 2_000, 0, dl, sig);
        (tv,) = vouch.currentTerms(venue);
        assertEq(tv, 3);
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector); // nonce consumed
        vouch.updateTerms(venue, 2_000, 0, dl, sig);

        vm.prank(ben);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.updateTerms(venue, 2_000, 0, dl, "");
        vm.prank(lena);
        vm.expectRevert(IVouch.InvalidTerms.selector);
        vouch.updateTerms(venue, 6_000, 0, 0, "");
        vm.expectRevert(IVouch.UnknownVenue.selector);
        vouch.updateTerms(address(0xdead), 1_000, 0, 0, "");
    }

    function test_setKeys_rotatesSignerAndAttributor() public {
        uint256 newSignerPk = 0x7777;
        uint64 dl = uint64(block.timestamp + 1 hours);
        address np = makeAddr("newPayout");
        bytes memory sig = _sign(
            LENA_PK,
            _digest(keccak256(abi.encode(T_KEYS, venue, np, vm.addr(newSignerPk), attributor, vouch.nonces(lena), dl)))
        );
        vm.prank(relayer);
        vouch.setKeys(venue, np, vm.addr(newSignerPk), attributor, dl, sig);
        IVouch.Venue memory v = vouch.getVenue(venue);
        assertEq(v.payout, np);
        assertEq(v.signer, vm.addr(newSignerPk));

        // an order signed by the old signer key is now rejected
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        vm.expectRevert(IVouch.InvalidVenueSignature.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);

        vm.prank(lena);
        vm.expectRevert(IVouch.ZeroAddress.selector);
        vouch.setKeys(venue, address(0), venueSigner, attributor, 0, "");
    }

    function test_seedAmbassador_relayedAndRevocable() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig =
            _sign(LENA_PK, _digest(keccak256(abi.encode(T_SEED, venue, sam, true, vouch.nonces(lena), dl))));
        vm.prank(relayer);
        vouch.setSeedAmbassador(venue, sam, true, dl, sig);
        assertTrue(vouch.isSeedAmbassador(venue, sam));
        assertTrue(vouch.canRefer(venue, sam));
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.setSeedAmbassador(venue, sam, true, dl, sig);
        vm.prank(lena);
        vouch.setSeedAmbassador(venue, sam, false, 0, "");
        assertFalse(vouch.canRefer(venue, sam));
        vm.prank(lena);
        vm.expectRevert(IVouch.ZeroAddress.selector);
        vouch.setSeedAmbassador(venue, address(0), true, 0, "");
    }

    // =====================================================================================
    // Intros
    // =====================================================================================

    function test_intro_acceptStoresFrozenTerms() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("n1"));
        vm.expectEmit(address(vouch));
        emit IntroAccepted(venue, sam, ben, _introHash(i), 1, 0, i.expiresAt);
        _acceptSigned(i, SAM_PK, BEN_PK);
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, ben);
        assertEq(li.length, 1);
        assertEq(li[0].referrer, sam);
        assertEq(li[0].termsVersion, 1);
        assertEq(li[0].introHash, vouch.hashIntro(i));
        assertTrue(vouch.isIntroUsed(_introHash(i), ben, 0));
    }

    function test_intro_referrerMustBeVerifiedOrSeed() public {
        IVouch.Intro memory i = _introStruct(venue, ANA_PK, 0, bytes32("n"));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(ANA_PK, _introHash(i));
        vm.expectRevert(IVouch.ReferrerNotEligible.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        // Ana becomes verified by a plain purchase → now eligible
        _payFallback(venue, ANA_PK, 1e6);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_selfReferralReverts() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("n"));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, SAM_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.SelfReferral.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_verifiedCustomerCannotAccept() public {
        _seed(venue, sam);
        _payFallback(venue, BEN_PK, 1e6);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("n"));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.CustomerAlreadyVerified.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_personalIsSingleUse() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("p"));
        _acceptSigned(i, SAM_PK, BEN_PK);
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, ANA_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        // and the same customer cannot accept it twice either
        (a, csig) = _acceptance(i, BEN_PK);
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_broadcastOncePerCustomer() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 1, bytes32("b"));
        _acceptSigned(i, SAM_PK, BEN_PK);
        _acceptSigned(i, SAM_PK, ANA_PK);
        _acceptSigned(i, SAM_PK, PRIYA_PK);
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function _expectAcceptRevert(IVouch.Intro memory i, bytes4 err) internal {
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(err);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_windowAndTypeChecks() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 2, bytes32("t"));
        _expectAcceptRevert(i, IVouch.InvalidLinkType.selector);

        i = _introStruct(venue, SAM_PK, 0, bytes32("ttl"));
        i.expiresAt = i.issuedAt + 30 days + 1;
        _expectAcceptRevert(i, IVouch.InvalidIntroWindow.selector);
        i.expiresAt = i.issuedAt + 30 days; // max TTL ok
        _acceptSigned(i, SAM_PK, BEN_PK);

        i = _introStruct(venue, SAM_PK, 0, bytes32("neg"));
        i.expiresAt = i.issuedAt;
        _expectAcceptRevert(i, IVouch.InvalidIntroWindow.selector);

        i = _introStruct(venue, SAM_PK, 0, bytes32("future"));
        i.issuedAt = uint64(block.timestamp + 15 minutes + 1);
        i.expiresAt = i.issuedAt + 1 days;
        _expectAcceptRevert(i, IVouch.InvalidIntroWindow.selector);

        i = _introStruct(venue, SAM_PK, 0, bytes32("expired"));
        vm.warp(i.expiresAt + 1);
        _expectAcceptRevert(i, IVouch.IntroExpired.selector);
    }

    function test_intro_expiryBoundaryIsInclusive() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("edge"));
        vm.warp(i.expiresAt); // now == expiresAt is still valid
        _acceptSigned(i, SAM_PK, BEN_PK);
    }

    function test_intro_signatureChecks() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("s"));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes32 ih = _introHash(i);
        bytes memory rsig = _sign(SAM_PK, ih);
        bytes memory wrongRef = _sign(ANA_PK, ih);

        vm.expectRevert(IVouch.InvalidReferrerSignature.selector);
        vouch.acceptIntro(i, wrongRef, a, csig);
        vm.expectRevert(IVouch.InvalidCustomerSignature.selector);
        vouch.acceptIntro(i, rsig, a, rsig);

        IVouch.IntroAcceptance memory bad =
            IVouch.IntroAcceptance({introHash: keccak256("other"), customer: a.customer, deadline: a.deadline});
        vm.expectRevert(IVouch.IntroHashMismatch.selector);
        vouch.acceptIntro(i, rsig, bad, csig);

        vm.warp(a.deadline + 1);
        vm.expectRevert(IVouch.SignatureExpired.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_cannotMoveToAnotherVenue() public {
        address v2 = _register(lena, bytes32("v2"), RATE, 0);
        _seed(venue, sam);
        _seed(v2, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("mv"));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        i.venue = v2; // relayer swaps the venue
        vm.expectRevert(IVouch.IntroHashMismatch.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function test_intro_termsMustBeInForceAtIssuance() public {
        _seed(venue, sam);
        IVouch.Intro memory old = _introStruct(venue, SAM_PK, 0, bytes32("old")); // v1, issued now
        vm.warp(block.timestamp + 1 hours);
        vm.prank(lena);
        vouch.updateTerms(venue, 1_000, 0, 0, "");
        // signed before the update with v1 → still accepted (frozen terms)
        _acceptSigned(old, SAM_PK, BEN_PK);
        // a NEW intro cannot pick the superseded (better) v1
        IVouch.Intro memory sneaky = _introStruct(venue, SAM_PK, 0, bytes32("sneaky"));
        sneaky.termsVersion = 1;
        _expectAcceptRevert(sneaky, IVouch.TermsNotInForce.selector);
        sneaky.termsVersion = 3;
        _expectAcceptRevert(sneaky, IVouch.TermsNotInForce.selector);
        sneaky.termsVersion = 0;
        _expectAcceptRevert(sneaky, IVouch.TermsNotInForce.selector);
        // issued before the venue existed
        sneaky = _introStruct(venue, SAM_PK, 0, bytes32("pre"));
        sneaky.termsVersion = 1;
        sneaky.issuedAt = uint64(vouch.getVenue(venue).registeredAt - 1);
        sneaky.expiresAt = sneaky.issuedAt + 7 days;
        _expectAcceptRevert(sneaky, IVouch.TermsNotInForce.selector);
    }

    function test_intro_capEvictsOldestAndReplacesSameReferrer() public {
        uint256[6] memory pks = [uint256(0x101), 0x102, 0x103, 0x104, 0x105, 0x106];
        for (uint256 k; k < 6; ++k) {
            _seed(venue, vm.addr(pks[k]));
        }
        for (uint256 k; k < 5; ++k) {
            _introduce(venue, pks[k], BEN_PK, 1);
            vm.warp(block.timestamp + 1);
        }
        assertEq(vouch.getLiveIntros(venue, ben).length, 5);
        // 6th referrer → oldest (slot 0, referrer pks[0]) evicted
        IVouch.Intro memory i = _introStruct(venue, pks[5], 1, bytes32("6th"));
        IVouch.LiveIntro[] memory before = vouch.getLiveIntros(venue, ben);
        vm.expectEmit(address(vouch));
        emit IntroDropped(venue, ben, vm.addr(pks[0]), before[0].introHash, 2);
        _acceptSigned(i, pks[5], BEN_PK);
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, ben);
        assertEq(li.length, 5);
        assertEq(li[0].referrer, vm.addr(pks[5]));

        // same referrer again → replaces its own slot (reason 0), count unchanged
        vm.warp(block.timestamp + 1);
        IVouch.Intro memory again = _introStruct(venue, pks[2], 0, bytes32("again"));
        vm.expectEmit(address(vouch));
        emit IntroDropped(venue, ben, vm.addr(pks[2]), li[2].introHash, 0);
        _acceptSigned(again, pks[2], BEN_PK);
        li = vouch.getLiveIntros(venue, ben);
        assertEq(li.length, 5);
        assertEq(li[2].linkType, 0);
    }

    function test_intro_expiredSlotIsReused() public {
        _seed(venue, sam);
        _seed(venue, omar);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("short"));
        i.expiresAt = uint64(block.timestamp + 1 hours);
        _acceptSigned(i, SAM_PK, BEN_PK);
        vm.warp(block.timestamp + 2 hours);
        vm.expectEmit(address(vouch));
        emit IntroDropped(venue, ben, sam, _introHash(i), 1);
        _introduce(venue, OMAR_PK, BEN_PK, 0);
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, ben);
        assertEq(li.length, 1);
        assertEq(li[0].referrer, omar);
    }

    function test_intro_erc1271ReferrerAndCustomer() public {
        uint256 ownerPk = 0xC0FFEE;
        MockERC1271Wallet refWallet = new MockERC1271Wallet(vm.addr(ownerPk));
        _seed(venue, address(refWallet));
        uint256 custPk = 0xD00D;
        MockERC1271Wallet custWallet = new MockERC1271Wallet(vm.addr(custPk));
        IVouch.Intro memory i = IVouch.Intro({
            venue: venue,
            referrer: address(refWallet),
            termsVersion: 1,
            linkType: 0,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: bytes32("1271")
        });
        IVouch.IntroAcceptance memory a = IVouch.IntroAcceptance({
            introHash: _introHash(i), customer: address(custWallet), deadline: uint64(block.timestamp + 1 hours)
        });
        bytes memory csig = _sign(custPk, _digest(keccak256(abi.encode(T_ACCEPT, a.introHash, a.customer, a.deadline))));
        vouch.acceptIntro(i, _sign(ownerPk, a.introHash), a, csig);

        // and the smart-account customer pays via the bytes overload (ERC-1271 inside USDC)
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 10e6);
        IVouch.PaymentAuth memory pa = IVouch.PaymentAuth({
            customer: address(custWallet),
            venue: venue,
            orderId: o.orderId,
            amount: o.amount,
            weightsHash: 0,
            deadline: uint64(block.timestamp + 10 minutes),
            submitter: relayer
        });
        bytes32 sh = keccak256(
            abi.encode(T_RWA, pa.customer, address(vouch), pa.amount, uint256(0), uint256(pa.deadline), _authNonce(pa))
        );
        // (submitter = relayer, see the prank before pay below)
        bytes memory usig = _sign(custPk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), sh)));
        usdc.mint(address(custWallet), o.amount);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", pa, usig);
        assertTrue(vouch.getCustomer(venue, address(custWallet)).rewarded);
        assertEq(usdc.balanceOf(address(refWallet)), 10e6 * 1500 / 10_000 * 5500 / 10_000);
    }

    // =====================================================================================
    // Pay — paths
    // =====================================================================================

    function test_pay_plainFirstPurchaseWithoutIntros() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 3e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        vm.expectEmit(address(vouch));
        emit CustomerVerified(venue, ben, address(0), o.orderId);
        vm.expectEmit(address(vouch));
        emit PaymentSettled(venue, ben, o.orderId, 3e6, 3e6, 0, true, false, 0);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        assertEq(usdc.balanceOf(payout), 3e6);
        IVouch.CustomerState memory cs = vouch.getCustomer(venue, ben);
        assertTrue(cs.verified);
        assertFalse(cs.rewarded);
        assertEq(cs.introducer, address(0));
        assertTrue(vouch.canRefer(venue, ben));
    }

    function test_pay_belowMinOrderIsPlainAndConsumesFirstPurchase() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        _pay(venue, BEN_PK, MIN_ORDER - 1, _arr(sam), _bps(10_000));
        assertEq(usdc.balanceOf(payout), MIN_ORDER - 1);
        assertEq(usdc.balanceOf(sam), 0);
        IVouch.CustomerState memory cs = vouch.getCustomer(venue, ben);
        assertTrue(cs.verified);
        assertFalse(cs.rewarded);
        // next purchase above min is a repeat purchase: no reward
        _pay(venue, BEN_PK, 50e6, _arr(sam), _bps(10_000));
        assertEq(usdc.balanceOf(sam), 0);
    }

    function test_pay_minOrderBoundaryIsRewarded() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        _pay(venue, BEN_PK, MIN_ORDER, _arr(sam), _bps(10_000));
        assertTrue(vouch.getCustomer(venue, ben).rewarded);
    }

    function test_pay_repeatPurchaseIsPlain_oneRewardEver() public {
        _canonicalSetup();
        _pay(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        uint256 ana0 = usdc.balanceOf(ana);
        uint256 p0 = usdc.balanceOf(payout);
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        vm.expectEmit(address(vouch));
        emit PaymentSettled(venue, ben, o.orderId, 12e6, 12e6, 0, false, false, 0);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        assertEq(usdc.balanceOf(ana), ana0);
        assertEq(usdc.balanceOf(payout) - p0, 12e6);
        assertEq(vouch.getVenueStats(venue).rewardedCustomers, 3);
    }

    function test_pay_expiredIntroIsIgnored() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0); // expires in 7 days
        vm.warp(block.timestamp + 7 days + 1);
        _pay(venue, BEN_PK, 10e6, _arr(sam), _bps(10_000));
        assertFalse(vouch.getCustomer(venue, ben).rewarded);
        assertEq(usdc.balanceOf(sam), 0);
    }

    function test_pay_seedReferrerWithoutIntroducer_L2ReturnsToVenue() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 10e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(sam), _bps(10_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        vm.expectEmit(address(vouch));
        emit RewardReturned(o.orderId, address(0), venue, ben, 2, 300_000, sam, 0);
        vm.prank(relayer);
        vouch.pay(o, osig, w, wsig, a, usig);
        // pool 1.5: cashback .375, L1 .825, L2 .30 → venue
        assertEq(usdc.balanceOf(payout), 10e6 - 375_000 - 825_000);
    }

    function test_pay_cycle_selfPaymentReturnsToVenue() public {
        // Ben is a seed who refers Ana; Ana (verified, introducer = Ben) then refers Ben (unverified seed).
        _seed(venue, ben);
        _introduce(venue, BEN_PK, ANA_PK, 0);
        _pay(venue, ANA_PK, 10e6, _arr(ben), _bps(10_000));
        assertEq(vouch.introducerOf(venue, ana), ben);
        _introduce(venue, ANA_PK, BEN_PK, 0);
        uint256 ben0 = usdc.balanceOf(ben);
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 10e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana), _bps(10_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        vm.expectEmit(address(vouch));
        emit RewardReturned(o.orderId, ben, venue, ben, 2, 300_000, ana, 1);
        vm.prank(relayer);
        vouch.pay(o, osig, w, wsig, a, usig);
        // Ben gets only his cashback, not the L2 through Ana
        assertEq(usdc.balanceOf(ben) - ben0, 375_000);
        assertEq(vouch.introducerOf(venue, ben), ana);
    }

    function test_pay_blacklistedReferrer_shareGoesToVenue() public {
        _canonicalSetup();
        usdc.blacklist(priya);
        uint256 p0 = usdc.balanceOf(payout);
        uint256 priya0 = usdc.balanceOf(priya);
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        vm.expectEmit(address(vouch));
        emit RewardReturned(o.orderId, priya, venue, ben, 1, 297_000, priya, 2);
        vm.prank(relayer);
        vouch.pay(o, osig, w, wsig, a, usig);
        assertEq(usdc.balanceOf(priya), priya0);
        assertEq(usdc.balanceOf(payout) - p0, 10_200_000 + 297_000);
        assertEq(usdc.balanceOf(address(vouch)), 0);
        assertEq(vouch.getVenueStats(venue).rewardsReturned, 2 * 600_000 + 297_000);
    }

    function test_pay_blacklistedPayout_reverts() public {
        usdc.blacklist(payout);
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        vm.expectRevert(IVouch.PayoutTransferFailed.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
    }

    /// @dev A relayer that under-funds gas must not be able to turn recipient transfers into "failed" ones that
    ///      route to the venue: any successful pay() at any gas limit pays Ana/Priya/Sam/Omar exactly.
    function test_pay_gasStarvationCannotRedirectShares() public {
        _canonicalSetup();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        uint256 ana0 = usdc.balanceOf(ana);
        uint256 omar0 = usdc.balanceOf(omar);
        bytes memory cd = abi.encodeCall(vouch.pay, (o, osig, w, wsig, a, usig));
        uint256 successes;
        for (uint256 g = 150_000; g < 700_000; g += 2_500) {
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

    function test_pay_multipleFrozenTermsVersions() public {
        _seed(venue, sam);
        _seed(venue, omar);
        _introduce(venue, SAM_PK, BEN_PK, 0); // frozen v1 = 15%
        vm.warp(block.timestamp + 1);
        vm.prank(lena);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, 0, ""); // v2 = 10%
        _introduce(venue, OMAR_PK, BEN_PK, 1); // frozen v2
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, ben);
        assertEq(li[0].termsVersion, 1);
        assertEq(li[1].termsVersion, 2);
        uint256 p0 = usdc.balanceOf(payout);
        _pay(venue, BEN_PK, 12e6, _arr(sam, omar), _bps(7_000, 3_000));
        // slices: 12e6×0.7×15% = 1,260,000 ; 12e6×0.3×10% = 360,000 → pool 1,620,000
        assertEq(usdc.balanceOf(sam), 1_260_000 * 55 / 100);
        assertEq(usdc.balanceOf(omar), 360_000 * 55 / 100);
        // cashback 405,000 to ben; L2 (no introducers) 324,000 back to venue
        assertEq(usdc.balanceOf(payout) - p0, 12e6 - 405_000 - 693_000 - 198_000);
    }

    // =====================================================================================
    // Pay — weights validation → fallback (never revert)
    // =====================================================================================

    function _payExpectMode(
        IVouch.Weights memory w,
        bytes memory wsig,
        bytes32 committed,
        uint8 mode,
        IVouch.Order memory o,
        bytes memory osig
    ) internal {
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, committed);
        usdc.mint(ben, o.amount);
        vm.recordLogs();
        vm.prank(relayer);
        vouch.pay(o, osig, w, wsig, a, usig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 j; j < logs.length; ++j) {
            if (logs[j].topics[0] == PaymentSettled.selector) {
                (,,,,, uint8 m) = abi.decode(logs[j].data, (uint256, uint256, uint256, bool, bool, uint8));
                assertEq(m, mode, "weightsMode");
                found = true;
            }
        }
        assertTrue(found);
    }

    function _twoIntros() internal {
        _canonicalSetup(); // Ben holds Ana (personal) + Priya (broadcast), accepted in the same block
    }

    function test_fallback_noCommitment() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        _payExpectMode(_emptyWeights(), "", 0, 2, o, osig);
        // personal 2 : broadcast 1, same age → 6666/3333 + remainder 1 to the newest (tie → index 0 = Ana)
        assertEq(vouch.getCustomer(venue, ben).introducer, ana);
    }

    function test_fallback_weightsValues() public {
        _twoIntros();
        (IVouch.Order memory o,) = _order(venue, 12e6);
        IVouch.Quote memory q = vouch.previewPayment(venue, ben, o.orderId, o.amount, _emptyWeights(), "", 0);
        assertEq(q.weightsMode, 2);
        assertEq(q.bps[0], 6_667);
        assertEq(q.bps[1], 3_333);
        vm.warp(block.timestamp + 3 days); // both halve → same ratio
        q = vouch.previewPayment(venue, ben, o.orderId, o.amount, _emptyWeights(), "", 0);
        assertEq(q.bps[0], 6_667);
    }

    function test_fallback_decayFavorsRecentIntro() public {
        _seed(venue, sam);
        _seed(venue, omar);
        _introduce(venue, SAM_PK, BEN_PK, 0); // personal
        _introduce(venue, SAM_PK, ANA_PK, 0); // personal
        vm.warp(block.timestamp + 3 days);
        _introduce(venue, OMAR_PK, BEN_PK, 1); // broadcast, 3 days newer
        IVouch.Quote memory q = vouch.previewPayment(venue, ben, bytes32("x"), 10e6, _emptyWeights(), "", 0);
        // raw: 2·2^20 >> 1 = 2^20 vs 1·2^20 → 5000/5000; equal weight → introducer = lower index (Sam)
        assertEq(q.bps[0], 5_000);
        assertEq(q.bps[1], 5_000);
        assertEq(q.introducer, sam);
        vm.warp(block.timestamp + 3 days);
        _introduce(venue, OMAR_PK, ANA_PK, 1); // broadcast, 6 days newer than Sam's
        q = vouch.previewPayment(venue, ana, bytes32("x"), 10e6, _emptyWeights(), "", 0);
        // raw: 2·2^20 >> 2 = 2^19 vs 2^20 → 3333 / 6666 + remainder 1 to the newest
        assertEq(q.bps[0], 3_333);
        assertEq(q.bps[1], 6_667);
        assertEq(q.introducer, omar);
    }

    function test_fallback_hashMismatch() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        (IVouch.Weights memory w2, bytes memory wsig2) = _weights(o, ben, _arr(ana, priya), _bps(3_000, 7_000));
        // customer committed to w, relayer submits validly-signed w2 → fallback, not w2
        assertTrue(wsig.length == 65);
        _payExpectMode(w2, wsig2, _weightsHash(w), 3, o, osig);
    }

    function test_fallback_badSignature() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w,) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        _payExpectMode(w, _sign(BEN_PK, _digest(_weightsHash(w))), _weightsHash(w), 5, o, osig);
    }

    function test_fallback_garbageSignatureBytes() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w,) = _weights(o, ben, _arr(ana, priya), _bps(7_000, 3_000));
        _payExpectMode(w, hex"deadbeef", _weightsHash(w), 5, o, osig);
    }

    function _invalidCase(address[] memory refs, uint16[] memory bps) internal {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, refs, bps);
        _payExpectMode(w, wsig, _weightsHash(w), 4, o, osig);
    }

    function test_fallback_invalid_sumNot10000() public {
        _twoIntros();
        _invalidCase(_arr(ana, priya), _bps(7_000, 2_999));
    }

    function test_fallback_invalid_overCap() public {
        _twoIntros();
        _invalidCase(_arr(ana, priya), _bps(8_001, 1_999));
    }

    function test_fallback_invalid_duplicate() public {
        _twoIntros();
        _invalidCase(_arr(ana, ana), _bps(5_000, 5_000));
    }

    function test_fallback_invalid_nonHolder() public {
        _twoIntros();
        _invalidCase(_arr(ana, sam), _bps(5_000, 5_000));
    }

    function test_fallback_invalid_zeroWeight() public {
        _twoIntros();
        address[] memory r = new address[](3);
        r[0] = ana;
        r[1] = priya;
        r[2] = ana;
        uint16[] memory b = new uint16[](3);
        b[0] = 5_000;
        b[1] = 5_000;
        _invalidCase(r, b);
    }

    function test_fallback_invalid_wrongOrderOrCustomer() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        IVouch.Weights memory w = IVouch.Weights({
            venue: venue, customer: ana, orderId: o.orderId, referrers: _arr(ana, priya), bps: _bps(7_000, 3_000)
        });
        bytes memory wsig = _sign(ATTR_PK, _digest(_weightsHash(w)));
        _payExpectMode(w, wsig, _weightsHash(w), 4, o, osig);
    }

    function test_fallback_invalid_lengthMismatch() public {
        _twoIntros();
        uint16[] memory b = new uint16[](1);
        b[0] = 10_000;
        _invalidCase(_arr(ana, priya), b);
    }

    function test_fallback_invalid_emptyButCommitted() public {
        _twoIntros();
        _invalidCase(new address[](0), new uint16[](0));
    }

    function test_fallback_invalid_tooMany() public {
        _twoIntros();
        address[] memory r = new address[](6);
        uint16[] memory b = new uint16[](6);
        _invalidCase(r, b);
    }

    function test_fallback_singleReferrerMustBe10000() public {
        _twoIntros();
        _invalidCase(_arr(ana), _bps(9_000));
    }

    function test_attributor_singleReferrerFullWeight() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(priya), _bps(10_000));
        _payExpectMode(w, wsig, _weightsHash(w), 1, o, osig);
        assertEq(vouch.getCustomer(venue, ben).introducer, priya);
    }

    function test_attributor_tieGoesToLowerIndex() public {
        _twoIntros();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w, bytes memory wsig) = _weights(o, ben, _arr(priya, ana), _bps(5_000, 5_000));
        _payExpectMode(w, wsig, _weightsHash(w), 1, o, osig);
        assertEq(vouch.getCustomer(venue, ben).introducer, priya);
    }

    // =====================================================================================
    // Pay — reverts / replay / payee path
    // =====================================================================================

    function test_pay_orderReplayReverts() public {
        IVouch.Order memory o = _payFallback(venue, BEN_PK, 6e6);
        bytes memory osig =
            _sign(SIGNER_PK, _digest(keccak256(abi.encode(T_ORDER, o.venue, o.orderId, o.amount, o.expiresAt))));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, ANA_PK, 0);
        usdc.mint(ana, o.amount);
        vm.expectRevert(IVouch.OrderAlreadySettled.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
    }

    function test_pay_orderChecks() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);

        IVouch.PaymentAuth memory bad = _copy(a);
        bad.amount = 5e6;
        vm.expectRevert(IVouch.AuthMismatch.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", bad, usig);
        bad = _copy(a);
        bad.orderId = bytes32("other");
        vm.expectRevert(IVouch.AuthMismatch.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", bad, usig);
        bad = _copy(a);
        bad.venue = address(0xbeef);
        vm.expectRevert(IVouch.AuthMismatch.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", bad, usig);
        bad = _copy(a);
        bad.customer = address(0);
        vm.expectRevert(IVouch.ZeroAddress.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", bad, usig);

        bytes memory wrongSig = _sign(ATTR_PK, keccak256("x"));
        vm.expectRevert(IVouch.InvalidVenueSignature.selector);
        vm.prank(relayer);
        vouch.pay(o, wrongSig, _emptyWeights(), "", a, usig);

        IVouch.Order memory o2 =
            IVouch.Order({venue: address(0xbeef), orderId: o.orderId, amount: o.amount, expiresAt: o.expiresAt});
        vm.expectRevert(IVouch.UnknownVenue.selector);
        vm.prank(relayer);
        vouch.pay(o2, osig, _emptyWeights(), "", a, usig);

        vm.warp(a.deadline); // USDC validBefore is exclusive
        vm.expectRevert(IVouch.AuthExpired.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        vm.warp(o.expiresAt + 1);
        vm.expectRevert(IVouch.OrderExpired.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
    }

    function _copy(IVouch.PaymentAuth memory a) internal pure returns (IVouch.PaymentAuth memory) {
        return IVouch.PaymentAuth(a.customer, a.venue, a.orderId, a.amount, a.weightsHash, a.deadline, a.submitter);
    }

    function test_pay_amountBounds() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 0);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        vm.expectRevert(IVouch.InvalidAmount.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        (o, osig) = _order(venue, 1_000_000e6 + 1);
        (a, usig) = _auth(o, BEN_PK, 0);
        vm.expectRevert(IVouch.InvalidAmount.selector);
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
    }

    function test_pay_tamperedFieldsBreakTheUsdcAuthorization() public {
        // The relayer changes weightsHash (part of the EIP-3009 nonce) → USDC rejects the signature.
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        a.weightsHash = bytes32(uint256(1));
        vm.expectRevert("FiatTokenV2: invalid signature");
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        a.weightsHash = 0;
        a.deadline += 1;
        vm.expectRevert("FiatTokenV2: invalid signature");
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
    }

    function test_pay_usdcAuthorizationIsPayeeOnly() public {
        (IVouch.Order memory o,) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        // a relayer/attacker redeeming the customer's authorization directly fails the payee check
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: caller must be the payee");
        usdc.receiveWithAuthorization(ben, address(vouch), o.amount, 0, a.deadline, _authNonce(a), usig);
    }

    function test_pay_pullIsByVouchAsPayee() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        vm.expectCall(
            address(usdc),
            abi.encodeWithSignature(
                "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
                ben,
                address(vouch),
                o.amount,
                uint256(0),
                uint256(a.deadline),
                _authNonce(a),
                usig
            )
        );
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        assertEq(usdc.lastReceiveCaller(), address(vouch));
        assertEq(usdc.receiveCalls(address(vouch)), 1);
        assertTrue(usdc.authorizationState(ben, _authNonce(a)));
        assertEq(vouch.paymentAuthNonce(a), _authNonce(a));
    }

    function test_pay_cancelledAuthorizationRevertsCleanly() public {
        _canonicalSetup();
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        bytes32 cancelHash = keccak256(
            abi.encode(usdc.CANCEL_AUTHORIZATION_TYPEHASH(), ben, _authNonce(a))
        );
        usdc.cancelAuthorization(
            ben, _authNonce(a), _sign(BEN_PK, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), cancelHash)))
        );
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
        assertFalse(vouch.isOrderSettled(venue, o.orderId));
        assertFalse(vouch.getCustomer(venue, ben).verified);
        assertEq(usdc.balanceOf(ben), 12e6);
    }

    function test_pay_insufficientBalanceReverts() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        vm.expectRevert("ERC20: transfer amount exceeds balance");
        vm.prank(relayer);
        vouch.pay(o, osig, _emptyWeights(), "", a, usig);
    }

    function test_nonPayable() public {
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 6e6);
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, 0);
        usdc.mint(ben, o.amount);
        vm.deal(relayer, 1 ether);
        vm.prank(relayer);
        (bool ok,) = address(vouch).call{value: 1}(abi.encodeCall(vouch.pay, (o, osig, _emptyWeights(), "", a, usig)));
        assertFalse(ok);
        vm.prank(relayer);
        (ok,) = address(vouch).call{value: 1}("");
        assertFalse(ok);
    }

    function test_domain() public view {
        (, string memory n, string memory v, uint256 chainId, address vc,,) = vouch.eip712Domain();
        assertEq(n, "Vouch");
        assertEq(v, "1");
        assertEq(chainId, block.chainid);
        assertEq(vc, address(vouch));
    }
}
