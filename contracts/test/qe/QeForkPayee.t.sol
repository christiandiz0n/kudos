// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Vouch} from "../../src/Vouch.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../../src/interfaces/IFiatTokenV2_2.sol";
import {ArcNativeTransferShim} from "../VouchFork.t.sol";

interface IArcUsdcFull is IFiatTokenV2_2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function CANCEL_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
    function TRANSFER_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) external;
}

/// @title MSG-003 (a)–(e) against the REAL Arc Testnet USDC bytecode (NativeFiatTokenV2_2 at 0x3600…) on a fork, plus a
///        gas-starvation sweep. The only non-real piece is Arc's native-transfer precompile (D-511 shim, vm.deal).
/// @dev Skipped unless VOUCH_FORK=true:  VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol' -vv
///      RPC = $ARC_RPC_URL if set, else the public https://rpc.testnet.arc.io.
contract QeForkPayeeTest is Test {
    IArcUsdcFull constant USDC = IArcUsdcFull(0x3600000000000000000000000000000000000000);
    bytes32 constant T_ORDER = keccak256("Order(address venue,bytes32 orderId,uint256 amount,uint64 expiresAt)");
    bytes32 constant T_INTRO = keccak256(
        "Intro(address venue,address referrer,uint32 termsVersion,uint8 linkType,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );
    bytes32 constant T_ACCEPT = keccak256("IntroAcceptance(bytes32 introHash,address customer,uint64 deadline)");
    bytes32 constant T_WEIGHTS =
        keccak256("Weights(address venue,address customer,bytes32 orderId,address[] referrers,uint16[] bps)");
    bytes32 constant T_AUTH = keccak256(
        "PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline,address submitter)"
    );
    bytes32 constant T_RWA = 0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    Vouch vouch;
    address venue;
    address venue2;
    address owner = makeAddr("qe-fork-owner");
    address payout = makeAddr("qe-fork-payout");
    address relayer = makeAddr("qe-fork-relayer");
    address attacker = makeAddr("qe-fork-attacker");
    uint256 signerPk = 0x5161;
    uint256 attrPk = 0xA77B;
    uint256 anaPk = 0xA7A;
    uint256 priyaPk = 0x9819A;
    uint256 benPk = 0xBE7;
    address ben;
    uint256 seq;
    uint256 anaStart;

    struct B {
        IVouch.Order o;
        bytes osig;
        IVouch.Weights w;
        bytes wsig;
        IVouch.PaymentAuth a;
        bytes usig;
    }

    function setUp() public {
        if (!vm.envOr("VOUCH_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("ARC_RPC_URL", string("https://rpc.testnet.arc.io")));
        vm.etch(0x1800000000000000000000000000000000000000, address(new ArcNativeTransferShim()).code);
        vm.allowCheatcodes(0x1800000000000000000000000000000000000000);
        vouch = new Vouch(USDC);
        ben = vm.addr(benPk);
        vm.startPrank(owner);
        venue = vouch.registerVenue(
            owner, bytes32("qe-fork"), IVouch.VenueConfig(payout, vm.addr(signerPk), vm.addr(attrPk), 1_500, 0, "qe"), 0, ""
        );
        venue2 = vouch.registerVenue(
            owner, bytes32("qe-fork-2"), IVouch.VenueConfig(payout, vm.addr(signerPk), vm.addr(attrPk), 1_500, 0, "qe"), 0, ""
        );
        vouch.setSeedAmbassador(venue, vm.addr(anaPk), true, 0, "");
        vouch.setSeedAmbassador(venue, vm.addr(priyaPk), true, 0, "");
        vm.stopPrank();
        _intro(anaPk, benPk, 0);
        _intro(priyaPk, benPk, 1);
        anaStart = USDC.balanceOf(vm.addr(anaPk));
    }

    // ------------------------------------------------------------------ helpers
    function _sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _digest(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vouch.domainSeparator(), sh));
    }

    function _intro(uint256 refPk, uint256 custPk, uint8 linkType) internal {
        IVouch.Intro memory i = IVouch.Intro(
            venue, vm.addr(refPk), 1, linkType, uint64(block.timestamp), uint64(block.timestamp + 1 days), bytes32(refPk)
        );
        bytes32 ih = _digest(
            keccak256(abi.encode(T_INTRO, i.venue, i.referrer, i.termsVersion, i.linkType, i.issuedAt, i.expiresAt, i.nonce))
        );
        IVouch.IntroAcceptance memory a = IVouch.IntroAcceptance(ih, vm.addr(custPk), uint64(block.timestamp + 1 hours));
        vouch.acceptIntro(
            i, _sign(refPk, ih), a, _sign(custPk, _digest(keccak256(abi.encode(T_ACCEPT, ih, a.customer, a.deadline))))
        );
    }

    function _nonce(IVouch.PaymentAuth memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(T_AUTH, a.customer, a.venue, a.orderId, a.amount, a.weightsHash, a.deadline, a.submitter));
    }

    function _usdcSig(uint256 pk, IVouch.PaymentAuth memory a, address to) internal view returns (bytes memory) {
        bytes32 sh = keccak256(abi.encode(T_RWA, a.customer, to, a.amount, 0, uint256(a.deadline), _nonce(a)));
        return _sign(pk, keccak256(abi.encodePacked("\x19\x01", USDC.DOMAIN_SEPARATOR(), sh)));
    }

    function _signOrder(B memory b) internal view {
        b.osig = _sign(signerPk, _digest(keccak256(abi.encode(T_ORDER, b.o.venue, b.o.orderId, b.o.amount, b.o.expiresAt))));
    }

    /// @dev Ben pays $12 with attributor weights Ana 70 / Priya 30 (funds via native balance: balanceOf = native/1e12).
    function _bundle() internal returns (B memory b) {
        b.o = IVouch.Order(venue, keccak256(abi.encode("qe-fork", ++seq)), 12_000_000, uint64(block.timestamp + 600));
        _signOrder(b);
        address[] memory refs = new address[](2);
        refs[0] = vm.addr(anaPk);
        refs[1] = vm.addr(priyaPk);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;
        b.w = IVouch.Weights(venue, ben, b.o.orderId, refs, bps);
        bytes32 wh = keccak256(
            abi.encode(T_WEIGHTS, venue, ben, b.o.orderId, keccak256(abi.encodePacked(refs)), keccak256(abi.encodePacked(bps)))
        );
        b.wsig = _sign(attrPk, _digest(wh));
        b.a = IVouch.PaymentAuth(ben, venue, b.o.orderId, b.o.amount, wh, uint64(block.timestamp + 600), relayer);
        b.usig = _usdcSig(benPk, b.a, address(vouch));
        vm.deal(ben, ben.balance + 12e6 * 1e12);
    }

    function _pay(B memory b) internal {
        vm.prank(relayer);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
    }

    function _assertUntouched(uint256 ben0, uint256 payout0, bytes32 orderId) internal view {
        assertEq(USDC.balanceOf(ben), ben0, "customer untouched");
        assertEq(USDC.balanceOf(payout), payout0, "venue untouched");
        assertEq(USDC.balanceOf(vm.addr(anaPk)), anaStart, "no L1 paid");
        assertEq(USDC.balanceOf(address(vouch)), 0);
        assertFalse(vouch.isOrderSettled(venue, orderId), "order not burned");
        assertFalse(vouch.getCustomer(venue, ben).verified, "customer not verified");
    }

    // ================================================================== deployed code == audited source (D-703)
    /// @dev keccak256 of the LIVE v2 runtime at 0x9C50…b95f (24,036 B). Recorded by CONTRACTS_QE on 2026-11-16 after
    ///      re-proving, in a scratch checkout of commit c7280bc/HEAD (the v2 source), that the original
    ///      `deployCodeTo` equality test passes; evidence: docs/evidence/phase-1/contracts-qe/v3-fork-pin.txt.
    bytes32 constant V2_RUNTIME_KECCAK = 0xae810c8a5ec482935e8f39469eee493428e4ca5d9f57413c68a5bbe266aa4513;
    address constant V2 = 0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f;

    /// @dev v2 stays pinned to ITS OWN recorded bytecode (it no longer equals this working tree, which is v3). The
    ///      typehash, USDC immutable and runtime size are re-read live.
    function test_fork_deployedV2RuntimeEqualsRecordedV2Build() public view {
        bytes memory live = V2.code;
        assertEq(live.length, 24_036, "v2 runtime size");
        assertEq(keccak256(live), V2_RUNTIME_KECCAK, "live v2 runtime == recorded v2 build");
        assertEq(Vouch(V2).PAYMENT_AUTH_TYPEHASH(), T_AUTH, "v2 typehash == v3 typehash (unchanged by D-519)");
        assertEq(address(Vouch(V2).USDC()), address(USDC));
    }

    /// @dev After the v3 redeploy: `VOUCH_V3=<addr> VOUCH_FORK=true forge test --match-path 'test/qe/QeForkPayee.t.sol'`
    ///      proves the LIVE v3 runs byte-identical code to this source. OZ EIP712 bakes address(this) + the domain
    ///      separator into immutables, so this source is re-deployed AT that address on the fork (deployCodeTo) and the
    ///      runtime bytes are compared exactly. Skipped while VOUCH_V3 is unset (v3 not deployed yet).
    function test_fork_deployedV3RuntimeEqualsThisSource() public {
        address v3 = vm.envOr("VOUCH_V3", address(0));
        if (v3 == address(0)) {
            vm.skip(true);
            return;
        }
        bytes memory live = v3.code;
        assertGt(live.length, 0, "v3 deployed");
        assertTrue(keccak256(live) != V2_RUNTIME_KECCAK, "VOUCH_V3 must not point at v2");
        assertEq(Vouch(v3).PAYMENT_AUTH_TYPEHASH(), T_AUTH);
        assertEq(address(Vouch(v3).USDC()), address(USDC));
        deployCodeTo("Vouch.sol:Vouch", abi.encode(address(USDC)), v3);
        assertEq(keccak256(live), keccak256(v3.code), "deployed v3 runtime == this source compiled");
    }

    // ================================================================== (a)
    function test_fork_a_payPullsAsPayee_exactSplit_nativeDecimals() public {
        B memory b = _bundle();
        bytes32 nonce = _nonce(b.a);
        assertEq(vouch.paymentAuthNonce(b.a), nonce);
        uint256 payoutNative0 = payout.balance;
        uint256 ana0 = USDC.balanceOf(vm.addr(anaPk));
        uint256 priya0 = USDC.balanceOf(vm.addr(priyaPk));
        uint256 ben0 = USDC.balanceOf(ben) - b.o.amount;
        uint256 payout0 = USDC.balanceOf(payout);
        vm.expectCall(
            address(USDC),
            abi.encodeWithSignature(
                "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
                ben,
                address(vouch),
                b.o.amount,
                uint256(0),
                uint256(b.a.deadline),
                nonce,
                b.usig
            ),
            1
        );
        _pay(b);
        assertTrue(USDC.authorizationState(ben, nonce), "real USDC consumed hashStruct(PaymentAuth)");
        assertEq(USDC.balanceOf(payout) - payout0, 10_560_000, "venue 10.20 + returned L2 0.36");
        assertEq(USDC.balanceOf(vm.addr(anaPk)) - ana0, 693_000);
        assertEq(USDC.balanceOf(vm.addr(priyaPk)) - priya0, 297_000);
        assertEq(USDC.balanceOf(ben) - ben0, 450_000);
        assertEq(USDC.balanceOf(address(vouch)), 0);
        // D-102: the 6-dec amounts Vouch moved are exactly the 18-dec native deltas / 1e12
        assertEq(payout.balance - payoutNative0, 10_560_000 * 1e12, "native delta = 6-dec x 1e12");
    }

    // ================================================================== (b)
    function test_fork_b_thirdPartyRedeemWithRealSignatureFailsPayeeCheck() public {
        B memory b = _bundle();
        bytes32 nonce = _nonce(b.a);
        address[4] memory callers = [relayer, attacker, ben, payout];
        for (uint256 i; i < 4; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert("FiatTokenV2: caller must be the payee");
            USDC.receiveWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, b.usig);
        }
        (bytes32 r, bytes32 s, uint8 v) = _rsv(b.usig);
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: caller must be the payee");
        USDC.receiveWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, v, r, s);
        assertFalse(USDC.authorizationState(ben, nonce));
        // control: identical call from the payee itself passes every check and moves the funds
        uint256 v0 = USDC.balanceOf(address(vouch));
        vm.prank(address(vouch));
        USDC.receiveWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, b.usig);
        assertEq(USDC.balanceOf(address(vouch)) - v0, b.o.amount);
    }

    // ================================================================== (c)
    function test_fork_c_signatureCannotBeRedirectedOrReused() public {
        B memory b = _bundle();
        bytes32 nonce = _nonce(b.a);
        // attacker as payee
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        USDC.receiveWithAuthorization(ben, attacker, b.o.amount, 0, b.a.deadline, nonce, b.usig);
        // via transferWithAuthorization (different typehash), to Vouch or to the attacker
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        USDC.transferWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, b.usig);
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        USDC.transferWithAuthorization(ben, attacker, b.o.amount, 0, b.a.deadline, nonce, b.usig);
        // via a second Vouch deployment (another payee) with a matching, validly signed order
        Vouch vouch2 = new Vouch(USDC);
        vm.prank(owner);
        vouch2.registerVenue(
            owner, bytes32("qe-fork"), IVouch.VenueConfig(payout, vm.addr(signerPk), vm.addr(attrPk), 1_500, 0, "qe"), 0, ""
        );
        bytes memory osig2 = _sign(
            signerPk,
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    vouch2.domainSeparator(),
                    keccak256(abi.encode(T_ORDER, b.o.venue, b.o.orderId, b.o.amount, b.o.expiresAt))
                )
            )
        );
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vouch2.pay(b.o, osig2, b.w, b.wsig, b.a, b.usig);
        assertFalse(USDC.authorizationState(ben, nonce));
        _pay(b); // the real path still works
    }

    // ================================================================== (d)
    function test_fork_d_frontRunCancelAuthorization_revertsCleanly() public {
        B memory b = _bundle();
        bytes32 nonce = _nonce(b.a);
        bytes memory csig = _sign(
            benPk,
            keccak256(
                abi.encodePacked(
                    "\x19\x01", USDC.DOMAIN_SEPARATOR(), keccak256(abi.encode(USDC.CANCEL_AUTHORIZATION_TYPEHASH(), ben, nonce))
                )
            )
        );
        vm.prank(attacker);
        USDC.cancelAuthorization(ben, nonce, csig);
        uint256 ben0 = USDC.balanceOf(ben);
        uint256 payout0 = USDC.balanceOf(payout);
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        _assertUntouched(ben0, payout0, b.o.orderId);
        // recovery with a fresh authorization for the same order
        b.a.deadline += 1;
        b.usig = _usdcSig(benPk, b.a, address(vouch));
        _pay(b);
        assertEq(USDC.balanceOf(vm.addr(anaPk)) - anaStart, 693_000);
    }

    function test_fork_d_nonceConsumedByTransferWithAuthorization_revertsCleanly() public {
        B memory b = _bundle();
        bytes32 nonce = _nonce(b.a);
        bytes32 twa = keccak256(
            abi.encode(USDC.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), ben, attacker, uint256(1), uint256(0), uint256(b.a.deadline), nonce)
        );
        vm.prank(attacker);
        USDC.transferWithAuthorization(
            ben, attacker, 1, 0, b.a.deadline, nonce, _sign(benPk, keccak256(abi.encodePacked("\x19\x01", USDC.DOMAIN_SEPARATOR(), twa)))
        );
        uint256 ben0 = USDC.balanceOf(ben);
        uint256 payout0 = USDC.balanceOf(payout);
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        _assertUntouched(ben0, payout0, b.o.orderId);
    }

    // ================================================================== (e)
    function test_fork_e_everyPaymentFieldBoundByRealUsdcSignature() public {
        for (uint256 f; f < 7; ++f) {
            B memory b = _bundle();
            if (f == 0) {
                b.a.customer = vm.addr(priyaPk); // someone else presents Ben's signature
                vm.deal(b.a.customer, 100e18);
            } else if (f == 1) {
                b.o.venue = venue2;
                b.a.venue = venue2;
                b.w.venue = venue2;
                _signOrder(b);
            } else if (f == 2) {
                b.o.orderId = keccak256("other-order");
                b.a.orderId = b.o.orderId;
                _signOrder(b);
            } else if (f == 3) {
                b.o.amount = 12_000_001;
                b.a.amount = 12_000_001;
                _signOrder(b);
            } else if (f == 4) {
                b.a.weightsHash = bytes32(uint256(1));
            } else if (f == 5) {
                b.a.deadline += 1;
            } else {
                b.a.submitter = attacker; // v2 (D-012): the submitter is part of the nonce too
            }
            vm.prank(f == 6 ? attacker : relayer);
            vm.expectRevert("FiatTokenV2: invalid signature");
            vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        }
    }

    // ================================================================== v3 (D-014/D-519) on real Arc USDC
    function _bundleFor(address submitter) internal returns (B memory b) {
        b = _bundle();
        b.a.submitter = submitter;
        b.usig = _usdcSig(benPk, b.a, address(vouch));
    }

    /// @dev Kill-the-backend: Ben signs submitter = Ben and sends pay() himself. Real USDC still sees Vouch as the
    ///      caller/payee (MSG-003: it would otherwise revert "caller must be the payee"), and the split is exact.
    function test_fork_v3_customerSelfSubmit_payeeIsVouch_exactSplit() public {
        B memory b = _bundleFor(ben);
        bytes32 nonce = _nonce(b.a);
        uint256 ana0 = USDC.balanceOf(vm.addr(anaPk));
        uint256 priya0 = USDC.balanceOf(vm.addr(priyaPk));
        uint256 ben0 = USDC.balanceOf(ben) - b.o.amount;
        uint256 payout0 = USDC.balanceOf(payout);
        // Ben cannot redeem his own authorization directly: the payee check binds it to Vouch.
        vm.prank(ben, ben);
        vm.expectRevert("FiatTokenV2: caller must be the payee");
        USDC.receiveWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, b.usig);
        vm.expectCall(
            address(USDC),
            abi.encodeWithSignature(
                "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
                ben,
                address(vouch),
                b.o.amount,
                uint256(0),
                uint256(b.a.deadline),
                nonce,
                b.usig
            ),
            1
        );
        vm.prank(ben, ben);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        assertTrue(USDC.authorizationState(ben, nonce), "real USDC consumed hashStruct(PaymentAuth)");
        assertEq(USDC.balanceOf(payout) - payout0, 10_560_000, "venue 10.20 + returned L2 0.36 (seeds, no introducer)");
        assertEq(USDC.balanceOf(vm.addr(anaPk)) - ana0, 693_000);
        assertEq(USDC.balanceOf(vm.addr(priyaPk)) - priya0, 297_000);
        assertEq(USDC.balanceOf(ben) - ben0, 450_000);
        assertEq(USDC.balanceOf(address(vouch)), 0);
    }

    /// @dev Every submitter value (0, relayer, customer) is refused for every non-named caller on the real token,
    ///      and the refused attempts leave the real USDC authorization unused and nothing moved.
    function test_fork_v3_thirdPartiesRefused_allSubmitterValues() public {
        address[3] memory subs = [address(0), relayer, ben];
        address[4] memory callers = [attacker, relayer, ben, vm.addr(priyaPk)];
        for (uint256 s; s < 3; ++s) {
            B memory b = _bundleFor(subs[s]);
            uint256 ben0 = USDC.balanceOf(ben);
            uint256 payout0 = USDC.balanceOf(payout);
            for (uint256 c; c < 4; ++c) {
                if (callers[c] == subs[s]) continue;
                vm.prank(callers[c], callers[c]);
                vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
                vouch.pay(b.o, b.osig, b.w, hex"dead", b.a, b.usig);
            }
            assertFalse(USDC.authorizationState(ben, _nonce(b.a)), "real USDC authorization unused");
            _assertUntouched(ben0, payout0, b.o.orderId);
        }
    }

    /// @dev A signature for one submitter cannot be re-labelled for another on the real token (submitter is in the
    ///      EIP-3009 nonce); a downgrade to 0 is refused by Vouch before USDC is reached.
    function test_fork_v3_submitterRelabelRefused() public {
        B memory b = _bundleFor(ben); // signed for self-submit
        b.a.submitter = relayer;
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        B memory c = _bundleFor(relayer); // signed for the relayer
        c.a.submitter = ben;
        vm.prank(ben, ben);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vouch.pay(c.o, c.osig, c.w, c.wsig, c.a, c.usig);
        c.a.submitter = address(0);
        vm.prank(ben, ben);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(c.o, c.osig, c.w, c.wsig, c.a, c.usig);
        c.a.submitter = relayer;
        _pay(c); // the original relayer-bound auth is intact
        assertEq(USDC.balanceOf(vm.addr(anaPk)) - anaStart, 693_000);
    }

    // ================================================================== gas starvation on real bytecode
    function test_fork_gasStarvation_noRedirectAtAnyGasLimit() public {
        B memory b = _bundle();
        bytes memory cd = abi.encodeCall(vouch.pay, (b.o, b.osig, b.w, b.wsig, b.a, b.usig));
        // threshold
        uint256 lo = 100_000;
        uint256 hi = 3_000_000;
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            uint256 snap = vm.snapshotState();
            vm.prank(relayer);
            (bool ok,) = address(vouch).call{gas: mid}(cd);
            vm.revertToState(snap);
            if (ok) hi = mid;
            else lo = mid;
        }
        uint256 successes;
        uint256 checked;
        uint256 ana0 = USDC.balanceOf(vm.addr(anaPk));
        uint256 priya0 = USDC.balanceOf(vm.addr(priyaPk));
        uint256 payout0 = USDC.balanceOf(payout);
        for (uint256 g = hi - 120_000; g <= hi + 200; g += (g + 800 >= hi ? 1 : 211)) {
            uint256 fmp;
            assembly {
                fmp := mload(0x40)
            }
            uint256 snap = vm.snapshotState();
            vm.prank(relayer);
            (bool ok,) = address(vouch).call{gas: g}(cd);
            if (ok) {
                successes++;
                assertEq(USDC.balanceOf(vm.addr(anaPk)) - ana0, 693_000, "ana underpaid at low gas");
                assertEq(USDC.balanceOf(vm.addr(priyaPk)) - priya0, 297_000, "priya underpaid at low gas");
                assertEq(USDC.balanceOf(payout) - payout0, 10_560_000, "venue got more than its share");
            }
            checked++;
            vm.revertToState(snap);
            assembly {
                mstore(0x40, fmp)
            }
        }
        emit log_named_uint("fork: min successful gas limit", hi);
        emit log_named_uint("fork: gas limits tried", checked);
        emit log_named_uint("fork: successes (all exact)", successes);
        assertGt(successes, 0);
    }

    function _rsv(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }
}
