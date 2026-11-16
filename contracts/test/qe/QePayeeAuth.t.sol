// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {Vouch} from "../../src/Vouch.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../../src/interfaces/IFiatTokenV2_2.sol";

/// @title MSG-003 (human requirement) — USDC receiveWithAuthorization is invoked BY THE PAYEE (msg.sender == to == Vouch).
/// @notice (a) happy path via pay; (b) third-party direct redeem reverts on the payee check; (c) the signature cannot be
///         redirected to another payee or reused through another function; (d) a front-run cancel / already-used nonce
///         makes pay revert with no partial split; (e) nonce == hashStruct(PaymentAuth): changing ANY field invalidates it.
///         Against the faithful FiatTokenV2_2 mock. The same checks against real Arc USDC: QeForkPayee.t.sol.
contract QePayeeAuthTest is QeBase {
    bytes4 internal constant RWA_BYTES_SEL =
        bytes4(keccak256("receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)"));
    bytes4 internal constant RWA_VRS_SEL =
        bytes4(keccak256("receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)"));
    bytes32 internal constant T_TWA = 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    address internal attacker = makeAddr("attacker");

    // ------------------------------------------------------------------------------------------ (a)
    function test_payee_a_happyPath_pullCalledOnceByVouchWithToEqThis() public {
        _canonicalSetup();
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        bytes32 nonce = _authNonce(b.a);
        // exactly ONE receiveWithAuthorization, with to == address(vouch), validAfter 0, validBefore == deadline
        vm.expectCall(
            address(usdc),
            abi.encodeWithSelector(
                RWA_BYTES_SEL, ben, address(vouch), b.o.amount, uint256(0), uint256(b.a.deadline), nonce, b.usig
            ),
            1
        );
        vm.expectEmit(address(usdc));
        emit AuthorizationUsed(ben, nonce);
        vm.recordLogs();
        _exec(b);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(usdc.lastReceiveCaller(), address(vouch), "msg.sender of the pull");
        assertEq(usdc.receiveCalls(address(vouch)), 3, "3 pulls so far (Ana, Priya, Ben), all by Vouch");
        assertEq(usdc.receiveCalls(relayer), 0, "relayer never redeemed");
        // the tx's USDC flow: ben -> vouch (amount), then vouch -> recipients summing to amount, vouch left empty
        (uint256 out,) = _sumOutOfVouch(logs);
        assertEq(out, b.o.amount);
        assertEq(usdc.balanceOf(address(vouch)), 0);
        assertTrue(usdc.authorizationState(ben, nonce));
    }

    // ------------------------------------------------------------------------------------------ (b)
    function test_payee_b_thirdPartiesCannotRedeemTheCustomersAuthorization() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        bytes32 nonce = _authNonce(b.a);
        address[6] memory callers = [relayer, attacker, ben, payout, lena, address(usdc)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert("FiatTokenV2: caller must be the payee");
            IFiatTokenV2_2(address(usdc)).receiveWithAuthorization(
                ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, b.usig
            );
            // (v,r,s) overload too
            (bytes32 r, bytes32 s, uint8 v) = _split(b.usig);
            vm.prank(callers[i]);
            vm.expectRevert("FiatTokenV2: caller must be the payee");
            usdc.receiveWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, v, r, s);
        }
        assertFalse(usdc.authorizationState(ben, nonce), "failed attempts did not burn the nonce");
        assertEq(usdc.balanceOf(ben), 6e6);
        // the authorization is intact: the real payee path still settles it
        _exec(b);
        assertTrue(vouch.isOrderSettled(venue, b.o.orderId));
    }

    /// @dev Control: the SAME call succeeds when msg.sender == to == Vouch — so the payee check (not a bad signature) is
    ///      what stopped every third party above.
    function test_payee_b_control_sameCallSucceedsOnlyFromThePayee() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        vm.prank(address(vouch));
        IFiatTokenV2_2(address(usdc)).receiveWithAuthorization(
            ben, address(vouch), b.o.amount, 0, b.a.deadline, _authNonce(b.a), b.usig
        );
        assertEq(usdc.balanceOf(address(vouch)), 6e6);
    }

    // ------------------------------------------------------------------------------------------ (c)
    function test_payee_c_cannotRedirectToAnotherPayee() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        bytes32 nonce = _authNonce(b.a);
        // attacker names itself as payee (passes the payee check) -> the signature does not cover to = attacker
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        IFiatTokenV2_2(address(usdc)).receiveWithAuthorization(ben, attacker, b.o.amount, 0, b.a.deadline, nonce, b.usig);
        // relayer names itself
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: invalid signature");
        IFiatTokenV2_2(address(usdc)).receiveWithAuthorization(ben, relayer, b.o.amount, 0, b.a.deadline, nonce, b.usig);
        assertFalse(usdc.authorizationState(ben, nonce));
    }

    function test_payee_c_cannotReuseThroughOtherUsdcFunctions() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        bytes32 nonce = _authNonce(b.a);
        // transferWithAuthorization has a different typehash -> the RWA signature is not a TWA signature
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.transferWithAuthorization(ben, address(vouch), b.o.amount, 0, b.a.deadline, nonce, b.usig);
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.transferWithAuthorization(ben, attacker, b.o.amount, 0, b.a.deadline, nonce, b.usig);
        // nor a CancelAuthorization signature
        vm.prank(attacker);
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.cancelAuthorization(ben, nonce, b.usig);
        assertFalse(usdc.authorizationState(ben, nonce));
        _exec(b); // still payable through Vouch
    }

    /// @dev A second Vouch deployment (same USDC, same venue id = keccak(owner, salt), same signer) is another payee:
    ///      the customer's signature names the FIRST Vouch as `to`, so the second one cannot redeem it.
    function test_payee_c_anotherVouchDeploymentCannotRedeem() public {
        Vouch vouch2 = new Vouch(IFiatTokenV2_2(address(usdc)));
        vm.prank(lena);
        address venue2 = vouch2.registerVenue(lena, SALT, _cfg(RATE, MIN_ORDER), 0, "");
        assertEq(venue2, venue, "same venue id on both deployments");
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        // venue signer signs the same order under vouch2's domain
        bytes memory osig2 = _sign(
            SIGNER_PK,
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
        _exec(b);
    }

    /// @dev Of Vouch's state-changing functions, only pay() ever calls receiveWithAuthorization (MSG-004 isolation).
    function test_payee_c_noOtherVouchFunctionCallsUsdcPull() public {
        _seed(venue, sam);
        // count 0 = must NOT be called during the following non-pay actions
        vm.expectCall(address(usdc), abi.encodePacked(RWA_BYTES_SEL), 0);
        vm.expectCall(address(usdc), abi.encodePacked(RWA_VRS_SEL), 0);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        vm.startPrank(lena);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, 0, "");
        vouch.setKeys(venue, payout, venueSigner, attributor, 0, "");
        vouch.setSeedAmbassador(venue, omar, true, 0, "");
        vouch.registerVenue(lena, keccak256("other"), _cfg(RATE, MIN_ORDER), 0, "");
        vm.stopPrank();
    }

    // ------------------------------------------------------------------------------------------ (d)
    struct Snap {
        uint256[7] bal;
        IVouch.VenueStats vs;
        IVouch.CustomerState ben;
        uint256 liveIntros;
    }

    function _snap() internal view returns (Snap memory s) {
        address[7] memory who = [ben, ana, priya, sam, omar, payout, address(vouch)];
        for (uint256 i; i < 7; ++i) {
            s.bal[i] = usdc.balanceOf(who[i]);
        }
        s.vs = vouch.getVenueStats(venue);
        s.ben = vouch.getCustomer(venue, ben);
        s.liveIntros = vouch.getLiveIntros(venue, ben).length;
    }

    function _assertNoPartialSplit(Snap memory s0, bytes32 orderId) internal view {
        Snap memory s1 = _snap();
        for (uint256 i; i < 7; ++i) {
            assertEq(s1.bal[i], s0.bal[i], "no balance moved");
        }
        assertEq(abi.encode(s1.vs), abi.encode(s0.vs), "stats unchanged");
        assertEq(abi.encode(s1.ben), abi.encode(s0.ben), "customer state unchanged (not verified, no introducer)");
        assertEq(s1.liveIntros, s0.liveIntros, "intros intact");
        assertFalse(vouch.isOrderSettled(venue, orderId), "order not burned");
    }

    function test_payee_d_frontRunCancelAuthorization_bothOverloads_noPartialSplit() public {
        _canonicalSetup();
        Bundle memory b;
        for (uint256 k; k < 2; ++k) {
            b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
            bytes32 nonce = _authNonce(b.a);
            bytes memory csig = _sign(
                BEN_PK,
                keccak256(
                    abi.encodePacked(
                        "\x19\x01",
                        usdc.DOMAIN_SEPARATOR(),
                        keccak256(abi.encode(usdc.CANCEL_AUTHORIZATION_TYPEHASH(), ben, nonce))
                    )
                )
            );
            // front-run: anyone can submit the customer's cancel
            vm.prank(attacker);
            if (k == 0) {
                usdc.cancelAuthorization(ben, nonce, csig);
            } else {
                (bytes32 r, bytes32 s, uint8 v) = _split(csig);
                usdc.cancelAuthorization(ben, nonce, v, r, s);
            }
            Snap memory s0 = _snap();
            vm.recordLogs();
            vm.prank(relayer);
            (bool ok, bytes memory ret) = address(vouch).call(_payCalldata(b));
            assertFalse(ok);
            assertEq(ret, abi.encodeWithSignature("Error(string)", "FiatTokenV2: authorization is used or canceled"));
            assertEq(vm.getRecordedLogs().length, 0, "no events survive the revert");
            _assertNoPartialSplit(s0, b.o.orderId);
        }
        // recovery: the customer re-signs the SAME order (new deadline => new nonce) and it settles with the exact split
        uint256 ana0 = usdc.balanceOf(ana);
        uint256 omar0 = usdc.balanceOf(omar);
        b.a.deadline += 1;
        _resignAuth(b, BEN_PK);
        _exec(b);
        assertEq(usdc.balanceOf(ana) - ana0, 693_000);
        assertEq(usdc.balanceOf(omar) - omar0, 108_000);
        assertTrue(vouch.getCustomer(venue, ben).verified);
    }

    /// @dev EIP-3009 nonces are shared across transfer/receive/cancel for an authorizer: a TransferWithAuthorization that
    ///      happens to (or is crafted to) use the same nonce burns it, and pay then reverts cleanly.
    function test_payee_d_nonceAlreadyUsedByTransferWithAuthorization_noPartialSplit() public {
        _canonicalSetup();
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        bytes32 nonce = _authNonce(b.a);
        usdc.mint(ben, 1);
        bytes memory twa = _sign(
            BEN_PK,
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    usdc.DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(T_TWA, ben, attacker, uint256(1), uint256(0), uint256(b.a.deadline), nonce))
                )
            )
        );
        vm.prank(attacker);
        usdc.transferWithAuthorization(ben, attacker, 1, 0, b.a.deadline, nonce, twa);
        Snap memory s0 = _snap();
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        vm.prank(relayer);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        _assertNoPartialSplit(s0, b.o.orderId);
    }

    function test_payee_d_replayOfAUsedAuthorizationReverts() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        _exec(b);
        usdc.mint(ben, 6e6);
        vm.expectRevert(IVouch.OrderAlreadySettled.selector);
        _exec(b);
        // even if Vouch's own order guard were bypassed, USDC itself refuses the nonce (Vouch is the only payee)
        vm.prank(address(vouch));
        vm.expectRevert("FiatTokenV2: authorization is used or canceled");
        IFiatTokenV2_2(address(usdc)).receiveWithAuthorization(
            ben, address(vouch), b.o.amount, 0, b.a.deadline, _authNonce(b.a), b.usig
        );
    }

    // ------------------------------------------------------------------------------------------ (e)
    function test_payee_e_nonceIsThePaymentAuthStructHash() public {
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        bytes32 independent = keccak256(
            abi.encode(
                keccak256(
                    "PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline)"
                ),
                b.a.customer,
                b.a.venue,
                b.a.orderId,
                b.a.amount,
                b.a.weightsHash,
                b.a.deadline
            )
        );
        assertEq(vouch.paymentAuthNonce(b.a), independent);
        assertEq(vouch.PAYMENT_AUTH_TYPEHASH(), T_AUTH);
        _exec(b);
        assertTrue(usdc.authorizationState(ben, independent), "USDC marked exactly hashStruct(PaymentAuth) as used");
    }

    /// @dev Each of the six PaymentAuth fields is changed while keeping every Vouch-level check satisfied (the venue
    ///      re-signs a matching order), so the ONLY thing that rejects the payment is USDC's signature check.
    function test_payee_e_everyFieldIsBoundByTheUsdcSignature() public {
        _register(lena, keccak256("venue-2"), RATE, MIN_ORDER); // same signer key
        address venue2 = vouch.computeVenueId(lena, keccak256("venue-2"));
        for (uint8 f; f < 6; ++f) {
            Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
            _mutate(b, f, venue2, uint256(keccak256("qe-mutation-seed")));
            vm.expectRevert("FiatTokenV2: invalid signature");
            _exec(b);
        }
    }

    /// @dev Fuzzed version: any single-field change, any new value.
    function testFuzz_payee_e_anyFieldMutationInvalidatesTheAuthorization(uint8 field, uint256 seed) public {
        _register(lena, keccak256("venue-2"), RATE, MIN_ORDER);
        address venue2 = vouch.computeVenueId(lena, keccak256("venue-2"));
        Bundle memory b = _bundle(venue, BEN_PK, 6e6, new address[](0), new uint16[](0));
        bytes32 n0 = _authNonce(b.a);
        _mutate(b, field % 6, venue2, seed);
        assertTrue(_authNonce(b.a) != n0, "mutation changes the nonce");
        vm.expectRevert("FiatTokenV2: invalid signature");
        _exec(b);
        assertEq(usdc.balanceOf(address(vouch)), 0);
        assertFalse(vouch.getCustomer(venue, ben).verified);
    }

    function _mutate(Bundle memory b, uint8 f, address venue2, uint256 seed) internal {
        if (f == 0) {
            // customer: someone else (funded) presents Ben's signature
            address other = address(uint160(bound(seed, 1, type(uint160).max)));
            if (other == ben) other = priya;
            vm.assume(other.code.length == 0 && other != address(vouch) && uint160(other) > 0xffff);
            b.a.customer = other;
            usdc.mint(other, b.o.amount);
        } else if (f == 1) {
            // venue: the same order id/amount at another venue (re-signed by the venue signer)
            b.o.venue = venue2;
            b.a.venue = venue2;
            b.osig = _signOrder(b.o, SIGNER_PK);
        } else if (f == 2) {
            bytes32 id = keccak256(abi.encode("mutated", seed));
            b.o.orderId = id;
            b.a.orderId = id;
            b.osig = _signOrder(b.o, SIGNER_PK);
        } else if (f == 3) {
            uint256 amt = bound(seed, 1, 1_000_000e6);
            if (amt == b.o.amount) amt += 1;
            b.o.amount = amt;
            b.a.amount = amt;
            b.osig = _signOrder(b.o, SIGNER_PK);
            usdc.mint(ben, amt);
        } else if (f == 4) {
            b.a.weightsHash = bytes32(seed | 1);
        } else {
            uint64 d = uint64(bound(seed, block.timestamp + 1, block.timestamp + 365 days));
            if (d == b.a.deadline) d += 1;
            b.a.deadline = d;
        }
    }

    function _split(bytes memory sig) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }
}
