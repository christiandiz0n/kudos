// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {Vouch} from "../../src/Vouch.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../../src/interfaces/IFiatTokenV2_2.sol";
import {QeAlwaysValid1271, QeReverting1271, QeGasBurner1271, QeReentrant1271} from "./mocks/QeEvil1271.sol";

/// @title Replay (orders, intros, USDC auths, owner-signed venue actions), signature malleability, cross-domain reuse,
///        hostile ERC-1271 signers.
contract QeReplaySignaturesTest is QeBase {
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    address internal attacker = makeAddr("attacker");

    // ------------------------------------------------------------------ helpers
    function _highS(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s, uint8 v) = _rsv(sig);
        return abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
    }

    function _compact(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 s, uint8 v) = _rsv(sig);
        return abi.encodePacked(r, bytes32(uint256(s) | (uint256(v - 27) << 255)));
    }

    function _rsv(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }

    function _termsSig(address v, uint16 rate, uint256 minOrder, uint256 nonce, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(LENA_PK, _digest(keccak256(abi.encode(T_TERMS, v, rate, minOrder, nonce, deadline))));
    }

    function _seedSig(address v, address who, bool allowed, uint256 nonce, uint64 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sign(LENA_PK, _digest(keccak256(abi.encode(T_SEED, v, who, allowed, nonce, deadline))));
    }

    // ================================================================== replay
    function test_replay_orderIdCannotSettleTwiceEvenWithAFreshAuthorization() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        _exec(b);
        // the customer (or anyone holding a new customer signature) tries to pay the same order again
        b.a.deadline += 60;
        _resignAuth(b, BEN_PK);
        usdc.mint(ben, 6e6);
        vm.expectRevert(IVouch.OrderAlreadySettled.selector);
        _exec(b);
        // a different customer cannot pay it either
        b.a.customer = priya;
        b.usig = _usdcSig(PRIYA_PK, b.a);
        usdc.mint(priya, 6e6);
        vm.expectRevert(IVouch.OrderAlreadySettled.selector);
        _exec(b);
    }

    function test_replay_personalIntroSingleUse_evenAfterEviction() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("p1"));
        _acceptSigned(i, SAM_PK, BEN_PK);
        // evict it: Ben accepts 5 more intros from other seeds
        for (uint256 k = 1; k <= 5; ++k) {
            uint256 pk = 0x7000 + k;
            _seed(venue, vm.addr(pk));
            vm.warp(block.timestamp + 1);
            _introduce(venue, pk, BEN_PK, 1);
        }
        bool samLive;
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, ben);
        for (uint256 k; k < li.length; ++k) {
            if (li[k].referrer == sam) samLive = true;
        }
        assertFalse(samLive, "evicted");
        // re-accepting the same personal intro (same or other customer) is refused
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        (a, csig) = _acceptance(i, PRIYA_PK);
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    /// @dev linkType is inside the signed Intro, so flipping a personal intro to broadcast (to get a per-customer use
    ///      key) breaks the referrer signature; personal and broadcast use keys live in disjoint spaces.
    function test_replay_linkTypeFlipCannotEscapeSingleUse() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("p2"));
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        _acceptSigned(i, SAM_PK, BEN_PK);
        i.linkType = 1;
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, PRIYA_PK);
        vm.expectRevert(IVouch.InvalidReferrerSignature.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        bytes32 h = _introHash(i);
        assertTrue(vouch.introUseKey(h, priya, 1) != vouch.introUseKey(h, priya, 0));
    }

    function test_replay_ownerSigs_nonceTypeVenueChainAndDeadline() public {
        address venueB = _registerAs(lena, keccak256("venue-b"), RATE, MIN_ORDER);
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig = _termsSig(venue, 1_000, MIN_ORDER, vouch.nonces(lena), dl);
        // cross-venue: same owner, same nonce, other venue
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.updateTerms(venueB, 1_000, MIN_ORDER, dl, sig);
        // cross-type: a SetSeedAmbassador signature is not an UpdateTerms signature
        bytes memory seedSig = _seedSig(venue, sam, true, vouch.nonces(lena), dl);
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, dl, seedSig);
        // cross-chain
        uint256 chain0 = block.chainid;
        vm.chainId(chain0 + 1);
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, dl, sig);
        vm.chainId(chain0);
        // deadline is inclusive
        vm.warp(dl);
        vm.prank(relayer);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, dl, sig);
        // replay: nonce consumed
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, dl, sig);
        // and the seed signature (same nonce value, now stale) is dead too
        vm.prank(relayer);
        vm.expectRevert(IVouch.InvalidOwnerSignature.selector);
        vouch.setSeedAmbassador(venue, sam, true, dl, seedSig);
        // deadline + 1
        bytes memory sig2 = _termsSig(venue, 1_200, MIN_ORDER, vouch.nonces(lena), dl);
        vm.warp(dl + 1);
        vm.prank(relayer);
        vm.expectRevert(IVouch.SignatureExpired.selector);
        vouch.updateTerms(venue, 1_200, MIN_ORDER, dl, sig2);
    }

    /// LIMIT (Low, QE-C-06): direct owner calls do not consume `nonces(owner)`, so an owner-signed action that was
    /// handed to the relayer but not yet submitted stays valid until its deadline and can be applied AFTER a newer
    /// direct action, silently undoing it (here: terms go back to 15% after the owner directly set 10%; a revoked seed
    /// is re-allowed). The owner's only cancel path is to sign and relay another action that consumes the nonce.
    function test_LIMIT_staleRelayedOwnerActionOverridesNewerDirectAction() public {
        uint64 dl = uint64(block.timestamp + 7 days);
        bytes memory allowSam = _seedSig(venue, sam, true, vouch.nonces(lena), dl);
        // owner changes their mind and revokes directly (no nonce consumed)
        vm.prank(lena);
        vouch.setSeedAmbassador(venue, sam, false, 0, "");
        // days later anyone replays the stale, never-used signature
        vm.warp(block.timestamp + 3 days);
        vm.prank(attacker);
        vouch.setSeedAmbassador(venue, sam, true, dl, allowSam);
        assertTrue(vouch.isSeedAmbassador(venue, sam), "stale relayed action re-applied over the newer direct revoke");
    }

    // ================================================================== malleability
    function test_malleability_highS_and_compactSigsRejectedEverywhere() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("m1"));
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        // referrer: high-s / EIP-2098 compact / v ∈ {0,1}
        vm.expectRevert(IVouch.InvalidReferrerSignature.selector);
        vouch.acceptIntro(i, _highS(rsig), a, csig);
        vm.expectRevert(IVouch.InvalidReferrerSignature.selector);
        vouch.acceptIntro(i, _compact(rsig), a, csig);
        (bytes32 r, bytes32 s, uint8 v) = _rsv(rsig);
        vm.expectRevert(IVouch.InvalidReferrerSignature.selector);
        vouch.acceptIntro(i, abi.encodePacked(r, s, v - 27), a, csig);
        // customer acceptance
        vm.expectRevert(IVouch.InvalidCustomerSignature.selector);
        vouch.acceptIntro(i, rsig, a, _highS(csig));
        vm.expectRevert(IVouch.InvalidCustomerSignature.selector);
        vouch.acceptIntro(i, rsig, a, _compact(csig));
        vouch.acceptIntro(i, rsig, a, csig); // canonical form works
        // venue order signature
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        vm.expectRevert(IVouch.InvalidVenueSignature.selector);
        vouch.pay(b.o, _highS(b.osig), b.w, b.wsig, b.a, b.usig);
        vm.expectRevert(IVouch.InvalidVenueSignature.selector);
        vouch.pay(b.o, _compact(b.osig), b.w, b.wsig, b.a, b.usig);
        // customer USDC signature: Circle's ECRecover rejects high-s and non-65-byte sigs
        vm.expectRevert("ECRecover: invalid signature 's' value");
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, _highS(b.usig));
        vm.expectRevert("ECRecover: invalid signature length");
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, _compact(b.usig));
    }

    /// @dev A malleated attributor signature must neither revert nor be accepted: it selects the fallback.
    function test_malleability_highSAttributorSigFallsBack() public {
        _canonicalSetup();
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        b.wsig = _highS(b.wsig);
        vm.recordLogs();
        _exec(b);
        (uint8 mode,,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 5, "BAD_SIGNATURE fallback");
    }

    // ================================================================== cross-domain intro reuse
    function test_crossDomain_introNotReusableAcrossChainCustomerOrDeployment() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("x1"));
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        // cross-customer: Ben's acceptance presented for Priya
        IVouch.IntroAcceptance memory forged =
            IVouch.IntroAcceptance({introHash: a.introHash, customer: priya, deadline: a.deadline});
        vm.expectRevert(IVouch.InvalidCustomerSignature.selector);
        vouch.acceptIntro(i, rsig, forged, csig);
        // cross-chain: same contract address, other chain id → digest differs
        uint256 chain0 = block.chainid;
        vm.chainId(chain0 + 7);
        vm.expectRevert(IVouch.IntroHashMismatch.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        vm.chainId(chain0);
        // cross-deployment: a second Vouch with the same venue id
        Vouch vouch2 = new Vouch(IFiatTokenV2_2(address(usdc)));
        vm.startPrank(lena);
        vouch2.registerVenue(lena, SALT, _cfg(RATE, MIN_ORDER), 0, "");
        vouch2.setSeedAmbassador(venue, sam, true, 0, "");
        vm.stopPrank();
        vm.expectRevert(IVouch.IntroHashMismatch.selector);
        vouch2.acceptIntro(i, rsig, a, csig);
        // original still fine
        vouch.acceptIntro(i, rsig, a, csig);
    }

    /// LIMIT (Low, QE-C-07): a personal intro names no customer, so whoever lands acceptIntro first owns it. A mempool
    /// observer who sees Ben's acceptIntro(intro, referrerSig, …) can submit the same intro with THEIR OWN acceptance
    /// first; Ben's transaction then reverts IntroAlreadyUsed. (Griefing only: the attacker gains nothing but becomes
    /// the referrer's prospect.) Mitigation: relayer-private submission, or bind personal intros to a customer later.
    function test_LIMIT_personalIntroCanBeSniped() public {
        _seed(venue, sam);
        uint256 thiefPk = 0x7417;
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("snipe"));
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        (IVouch.IntroAcceptance memory benA, bytes memory benSig) = _acceptance(i, BEN_PK);
        (IVouch.IntroAcceptance memory thiefA, bytes memory thiefSig) = _acceptance(i, thiefPk);
        vm.prank(vm.addr(thiefPk));
        vouch.acceptIntro(i, rsig, thiefA, thiefSig); // front-run
        vm.prank(relayer);
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, benA, benSig);
    }

    // ================================================================== hostile ERC-1271 signers
    /// @dev A referrer wallet that approves anything still cannot place an intro without the CUSTOMER's countersignature.
    function test_erc1271_alwaysValidReferrer_stillNeedsCustomerCountersig() public {
        QeAlwaysValid1271 evil = new QeAlwaysValid1271();
        _seed(venue, address(evil));
        IVouch.Intro memory i = IVouch.Intro({
            venue: venue,
            referrer: address(evil),
            termsVersion: 1,
            linkType: 0,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 days),
            nonce: bytes32("evil")
        });
        IVouch.IntroAcceptance memory a =
            IVouch.IntroAcceptance({introHash: _introHash(i), customer: ben, deadline: uint64(block.timestamp + 1 hours)});
        vm.expectRevert(IVouch.InvalidCustomerSignature.selector);
        vouch.acceptIntro(i, "", a, hex"00");
        // with Ben's real countersignature it works (the referrer's own sig bytes are irrelevant — its own choice)
        bytes memory csig = _sign(BEN_PK, _digest(keccak256(abi.encode(T_ACCEPT, a.introHash, a.customer, a.deadline))));
        vouch.acceptIntro(i, "", a, csig);
    }

    /// LIMIT (Info): a CUSTOMER wallet that approves anything lets anyone fill/evict its intro slots — a wallet bug,
    /// not a Vouch bug (USDC would equally let anyone spend from it via receiveWithAuthorization to Vouch).
    function test_LIMIT_alwaysValidCustomerWalletCanBeFilledByAnyone() public {
        QeAlwaysValid1271 wallet = new QeAlwaysValid1271();
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 1, bytes32("w"));
        IVouch.IntroAcceptance memory a = IVouch.IntroAcceptance({
            introHash: _introHash(i), customer: address(wallet), deadline: uint64(block.timestamp + 1 hours)
        });
        vm.prank(attacker);
        vouch.acceptIntro(i, _sign(SAM_PK, _introHash(i)), a, "");
        assertEq(vouch.getLiveIntros(venue, address(wallet)).length, 1);
    }

    function test_erc1271_revertingOrGasBurningAttributor_fallsBackNeverBlocks() public {
        _canonicalSetup();
        // reverting attributor
        address reverting = address(new QeReverting1271());
        vm.prank(lena);
        vouch.setKeys(venue, payout, venueSigner, reverting, 0, "");
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        uint256 snap = vm.snapshotState();
        vm.recordLogs();
        _exec(b);
        (uint8 mode,,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 5, "reverting attributor -> BAD_SIGNATURE fallback");
        vm.revertToState(snap);
        // gas-burning attributor: the staticcall eats 63/64 of the gas; pay() still completes (fallback) as long as the
        // submitter forwards >= ~64x the rest of pay(); a normal gas limit reverts (the venue's own misconfiguration)
        address burner = address(new QeGasBurner1271());
        vm.prank(lena);
        vouch.setKeys(venue, payout, venueSigner, burner, 0, "");
        (bool okLow,) = address(vouch).call{gas: 1_000_000}(_payCalldata(b));
        assertFalse(okLow, "1M gas is not enough next to a gas-burning attributor");
        vm.recordLogs();
        (bool okHigh,) = address(vouch).call{gas: 40_000_000}(_payCalldata(b));
        assertTrue(okHigh, "with enough gas the payment completes");
        (mode,,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 5);
    }

    /// @dev Re-entrancy through an ERC-1271 callback: Vouch calls attributor.isValidSignature via STATICCALL, so the
    ///      attributor's attempt to call a state-changing Vouch function fails; it then approves, and the payment
    ///      settles in ATTRIBUTOR mode with nothing else changed.
    function test_reentrancy_viaErc1271CallbackIsStatic() public {
        _canonicalSetup();
        QeReentrant1271 evil = new QeReentrant1271(address(vouch));
        // a perfectly valid, relayable acceptIntro (anyone may submit it) — would succeed outside a static context
        uint256 custPk = 0x7777;
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("reenter"));
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, custPk);
        bytes memory payload = abi.encodeCall(vouch.acceptIntro, (i, _sign(SAM_PK, _introHash(i)), a, csig));
        evil.setPayload(payload);
        vm.prank(lena);
        vouch.setKeys(venue, payout, venueSigner, address(evil), 0, "");
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        vm.recordLogs();
        // (a state change inside a STATICCALL halts and burns that frame's gas, so give the submitter a big budget)
        (bool paid,) = address(vouch).call{gas: 60_000_000}(_payCalldata(b));
        assertTrue(paid);
        (uint8 mode,,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 1, "evil attributor approved => its state-changing re-entry was rejected");
        assertEq(vouch.getLiveIntros(venue, vm.addr(custPk)).length, 0, "re-entry had no effect");
        (bool ok,) = address(vouch).call(payload);
        assertTrue(ok, "the same payload succeeds outside the static context");
    }
}
