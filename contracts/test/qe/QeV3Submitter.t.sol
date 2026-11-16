// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {QeBase} from "./QeBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";

/// @notice A smart-account customer: ERC-1271 signatures by its owner key, and only the owner may make it call out.
contract QeSmartAccount is IERC1271 {
    address public immutable owner;

    constructor(address o) {
        owner = o;
    }

    function isValidSignature(bytes32 h, bytes memory sig) external view returns (bytes4) {
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(h, sig);
        return err == ECDSA.RecoverError.NoError && rec == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "account: not owner");
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }
}

/// @title CONTRACTS_QE independent review of Vouch v3 (D-014 human A5 #1, D-519): `msg.sender == auth.submitter`, no
///        "anyone" value. Submitter may be the RELAYER (app) or the customer (kill-the-backend self-submit).
/// @dev Refusals are checked with a state-diff recording: a refused pay() must make NO storage write anywhere and must
///      never reach USDC (so the EIP-3009 authorization cannot be consumed or even probed).
contract QeV3SubmitterTest is QeBase {
    address internal attacker = makeAddr("attacker");

    // ------------------------------------------------------------------ helpers
    function _bundleFor(uint256 pk, uint256 amount, address[] memory refs, uint16[] memory bps, address s)
        internal
        returns (Bundle memory b)
    {
        b = _bundle(venue, pk, amount, refs, bps);
        b.a.submitter = s;
        _resignAuth(b, pk);
    }

    function _canon(address s) internal returns (Bundle memory) {
        return _bundleFor(BEN_PK, 12_000_000, _arr(ana, priya), _bps(7_000, 3_000), s);
    }

    /// @dev `caller` sends pay(); it must revert UnauthorizedSubmitter with zero SSTOREs and no call into USDC.
    function _refused(address caller, Bundle memory b, bytes memory attrSig) internal {
        bytes memory cd = abi.encodeCall(vouch.pay, (b.o, b.osig, b.w, attrSig, b.a, b.usig));
        vm.startStateDiffRecording();
        vm.prank(caller, caller);
        (bool ok, bytes memory err) = address(vouch).call(cd);
        Vm.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();
        assertFalse(ok, "a non-submitter settled");
        assertEq(bytes4(err), IVouch.UnauthorizedSubmitter.selector, "refused for the wrong reason");
        for (uint256 i; i < acc.length; ++i) {
            assertTrue(acc[i].account != address(usdc), "a refused attempt reached USDC");
            for (uint256 j; j < acc[i].storageAccesses.length; ++j) {
                assertFalse(acc[i].storageAccesses[j].isWrite, "SSTORE before the submitter check");
            }
        }
    }

    /// @dev Digest of everything a refused attempt could have touched.
    function _obs(Bundle memory b) internal view returns (bytes32) {
        bytes32 h1 = keccak256(abi.encode(_bals(), usdc.balanceOf(relayer), usdc.balanceOf(attacker)));
        bytes32 h2 = keccak256(
            abi.encode(
                vouch.isOrderSettled(venue, b.o.orderId), vouch.getCustomer(venue, ben), vouch.getLiveIntros(venue, ben)
            )
        );
        bytes32 h3 = keccak256(
            abi.encode(
                vouch.getVenueStats(venue),
                vouch.getAmbassadorStats(ana),
                vouch.getAmbassadorStats(priya),
                usdc.authorizationState(ben, _authNonce(b.a))
            )
        );
        return keccak256(abi.encode(h1, h2, h3));
    }

    /// @dev [ben, ana, priya, sam, omar, payout, vouch]
    function _bals() internal view returns (uint256[7] memory r) {
        address[7] memory w = [ben, ana, priya, sam, omar, payout, address(vouch)];
        for (uint256 k; k < 7; ++k) {
            r[k] = usdc.balanceOf(w[k]);
        }
    }

    // ================================================================== 1. only the named submitter, ever
    /// @dev Every plausible non-submitter (attacker, both referrers, both L2 seeds, the venue owner/payout/signer/
    ///      attributor, the relayer, the customer) is refused, with a valid or a garbage attributor signature.
    function _matrix(address s) internal {
        _canonicalSetup();
        Bundle memory b = _canon(s);
        bytes32 before = _obs(b);
        address[11] memory callers =
            [attacker, priya, ana, sam, omar, lena, payout, venueSigner, attributor, relayer, ben];
        for (uint256 i; i < 11; ++i) {
            if (callers[i] == s) continue;
            _refused(callers[i], b, hex"dead");
            _refused(callers[i], b, b.wsig);
        }
        assertEq(_obs(b), before, "refused attempts changed observable state");
        assertFalse(usdc.authorizationState(ben, _authNonce(b.a)), "USDC authorization untouched");
        if (s == address(0)) {
            assertFalse(vouch.isOrderSettled(venue, b.o.orderId), "zero submitter: nobody can settle");
            return;
        }
        vm.recordLogs();
        vm.prank(s, s);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        (uint8 mode,,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 1, "the rightful submitter still gets the committed attributor split");
        assertEq(vouch.introducerOf(venue, ben), ana);
    }

    function test_v3_zeroSubmitter_refusedForEveryone_noWriteNoUsdc() public {
        _matrix(address(0));
    }

    /// @dev Includes: the customer cannot settle (or race) an auth that names the relayer (option (a) pin).
    function test_v3_relayerBound_onlyRelayer_customerRefused() public {
        _matrix(relayer);
    }

    /// @dev Includes: the relayer cannot settle a self-submit auth.
    function test_v3_selfSubmit_onlyCustomer_relayerRefused() public {
        _matrix(ben);
    }

    /// @dev Any caller other than the named submitter is refused, for submitter = 0 / relayer / customer / arbitrary.
    function testFuzz_v3_nonSubmitterAlwaysRefused(address caller, uint8 which, address other) public {
        address s = which % 4 == 0 ? address(0) : which % 4 == 1 ? relayer : which % 4 == 2 ? ben : other;
        vm.assume(caller != s);
        assumeNotForgeAddress(caller);
        vm.assume(caller != address(vouch) && caller != address(usdc));
        Bundle memory b = _bundleFor(BEN_PK, 6e6, new address[](0), new uint16[](0), s);
        _refused(caller, b, "");
        assertFalse(vouch.isOrderSettled(venue, b.o.orderId));
        assertFalse(usdc.authorizationState(ben, _authNonce(b.a)));
    }

    /// @dev A signature for submitter X relabelled to Y and sent by Y: refused by USDC (submitter is in the EIP-3009
    ///      nonce), or by Vouch first when Y = 0. The original auth stays usable by X.
    function test_v3_relabelMatrix_signatureBindsTheSubmitter() public {
        _canonicalSetup();
        address[3] memory signedFor = [relayer, ben, address(0)];
        address[4] memory relabel = [relayer, ben, attacker, address(0)];
        for (uint256 i; i < 3; ++i) {
            Bundle memory b = _canon(signedFor[i]);
            for (uint256 j; j < 4; ++j) {
                if (relabel[j] == signedFor[i]) continue;
                b.a.submitter = relabel[j];
                address from = relabel[j] == address(0) ? attacker : relabel[j];
                vm.prank(from, from);
                if (relabel[j] == address(0)) vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
                else vm.expectRevert("FiatTokenV2: invalid signature");
                vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
            }
            b.a.submitter = signedFor[i];
            assertFalse(usdc.authorizationState(ben, _authNonce(b.a)));
            assertFalse(vouch.isOrderSettled(venue, b.o.orderId));
            if (signedFor[i] != address(0)) {
                vm.prank(signedFor[i], signedFor[i]);
                vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
                assertTrue(usdc.authorizationState(ben, _authNonce(b.a)));
            }
        }
    }

    // ================================================================== 2. customer self-submit settles exactly
    /// @dev $12.00 -> venue 10.20 / cashback 0.45 / Ana 0.693 / Priya 0.297 / Sam 0.252 / Omar 0.108, identical to the
    ///      relayer path, equal to previewPayment, pulled by Vouch as payee (MSG-003), 6 transfers summing to $12.00.
    function test_v3_selfSubmit_canonicalExactSplit_equalsRelayerPathAndPreview() public {
        _canonicalSetup();
        Bundle memory r = _canon(relayer);
        Bundle memory b = _canon(ben);
        uint256[7] memory pre = _bals();
        uint256[7] memory viaRelayer = _outcomeVia(r, relayer);
        _assertCanonQuote(b);
        vm.expectCall(
            address(usdc),
            abi.encodeWithSignature(
                "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
                ben,
                address(vouch),
                uint256(12_000_000),
                uint256(0),
                uint256(b.a.deadline),
                _authNonce(b.a),
                b.usig
            ),
            1
        );
        vm.recordLogs();
        vm.prank(ben, ben);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        _assertCanonLogs(vm.getRecordedLogs());
        uint256[7] memory got = _bals();
        assertEq(usdc.lastReceiveCaller(), address(vouch), "MSG-003: the payee contract called receiveWithAuthorization");
        assertEq(pre[0] - got[0], 12_000_000 - 450_000, "ben pays 12.00, gets 0.45 cashback");
        assertEq(got[1] - pre[1], 693_000, "ana L1");
        assertEq(got[2] - pre[2], 297_000, "priya L1");
        assertEq(got[3] - pre[3], 252_000, "sam L2");
        assertEq(got[4] - pre[4], 108_000, "omar L2");
        assertEq(got[5] - pre[5], 10_200_000, "venue");
        assertEq(got[6], 0, "Vouch holds nothing");
        for (uint256 k; k < 7; ++k) {
            assertEq(got[k], viaRelayer[k], "self-submit == relayer path");
        }
        assertEq(vouch.introducerOf(venue, ben), ana);
        assertTrue(usdc.authorizationState(ben, vouch.paymentAuthNonce(b.a)), "nonce consumed = hashStruct(auth)");
        assertFalse(usdc.authorizationState(ben, _authNonce(r.a)), "the unused relayer-bound auth stays unused");
    }

    /// @dev Balances after `from` settles `b`, then the state is rolled back (result kept in memory).
    function _outcomeVia(Bundle memory b, address from) internal returns (uint256[7] memory out) {
        uint256 snap = vm.snapshotState();
        vm.prank(from, from);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        out = _bals();
        vm.revertToState(snap);
    }

    function _assertCanonQuote(Bundle memory b) internal view {
        IVouch.Quote memory q = vouch.previewPayment(venue, ben, b.o.orderId, 12_000_000, b.w, b.wsig, b.a.weightsHash);
        assertEq(q.weightsMode, 1);
        assertEq(q.venueAmount, 10_200_000);
        assertEq(q.cashback, 450_000);
        assertEq(q.l1Amounts[0], 693_000);
        assertEq(q.l1Amounts[1], 297_000);
        assertEq(q.l2Amounts[0], 252_000);
        assertEq(q.l2Amounts[1], 108_000);
        assertEq(q.introducer, ana);
    }

    function _assertCanonLogs(Vm.Log[] memory logs) internal view {
        (uint8 mode, uint256 venueAmount, bool found) = _settledMode(logs);
        assertTrue(found);
        assertEq(mode, 1, "ATTRIBUTOR");
        assertEq(venueAmount, 10_200_000);
        (uint256 out, uint256 n) = _sumOutOfVouch(logs);
        assertEq(out, 12_000_000, "transfers out of Vouch sum to the amount");
        assertEq(n, 6, "cashback + 2 L1 + 2 L2 + payout");
    }

    /// @dev MSG-003 under self-submit: holding the signature AND being the submitter gives the customer no way to
    ///      redeem it outside Vouch (payee check), nor to redirect it to itself (signature binds to = Vouch).
    function test_v3_selfSubmitter_cannotRedeemOwnAuthorizationOutsideVouch() public {
        Bundle memory b = _bundleFor(BEN_PK, 6e6, new address[](0), new uint16[](0), ben);
        bytes32 n = _authNonce(b.a);
        vm.prank(ben, ben);
        vm.expectRevert("FiatTokenV2: caller must be the payee");
        usdc.receiveWithAuthorization(ben, address(vouch), 6e6, 0, b.a.deadline, n, b.usig);
        vm.prank(ben, ben);
        vm.expectRevert("FiatTokenV2: invalid signature");
        usdc.receiveWithAuthorization(ben, ben, 6e6, 0, b.a.deadline, n, b.usig);
        assertFalse(usdc.authorizationState(ben, n));
        vm.prank(ben, ben);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        assertEq(usdc.lastReceiveCaller(), address(vouch));
        assertTrue(usdc.authorizationState(ben, n));
    }

    /// @dev Kill-the-backend end to end: the customer also submits its own intro acceptances (acceptIntro is
    ///      permissionless; the signatures bind the parties), then self-submits. No relayer involved at all.
    function test_v3_killTheBackend_customerAcceptsIntrosAndPays_noRelayer() public {
        _twoVerifiedReferrers();
        uint256[2] memory refPks = [ANA_PK, PRIYA_PK];
        for (uint256 k; k < 2; ++k) {
            IVouch.Intro memory i = _introStruct(venue, refPks[k], uint8(k), keccak256(abi.encode("ktb", k)));
            (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
            bytes memory rsig = _sign(refPks[k], _introHash(i));
            vm.prank(ben, ben);
            vouch.acceptIntro(i, rsig, a, csig);
        }
        Bundle memory b = _canon(ben);
        uint256[7] memory pre = _bals();
        vm.prank(ben, ben);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        uint256[7] memory got = _bals();
        assertEq(got[1] - pre[1], 693_000);
        assertEq(got[2] - pre[2], 297_000);
        assertEq(got[3] - pre[3], 252_000);
        assertEq(got[4] - pre[4], 108_000);
        assertEq(got[5] - pre[5], 10_200_000);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    /// @dev A smart-account customer (ERC-1271) self-submits through its own execute(); its owner EOA calling pay()
    ///      directly is NOT the submitter, and nobody else can drive the account.
    function test_v3_smartAccountCustomerSelfSubmits_exactSplit() public {
        uint256 ownerPk = 0x5A5A;
        address owner = vm.addr(ownerPk);
        QeSmartAccount acct = new QeSmartAccount(owner);
        address c = address(acct);
        _twoVerifiedReferrers();
        uint256[2] memory refPks = [ANA_PK, PRIYA_PK];
        for (uint256 k; k < 2; ++k) {
            IVouch.Intro memory i = _introStruct(venue, refPks[k], uint8(k), keccak256(abi.encode("1271", k)));
            bytes32 ih = _introHash(i);
            IVouch.IntroAcceptance memory a =
                IVouch.IntroAcceptance({introHash: ih, customer: c, deadline: uint64(block.timestamp + 1 hours)});
            bytes memory csig = _sign(ownerPk, _digest(keccak256(abi.encode(T_ACCEPT, a.introHash, a.customer, a.deadline))));
            bytes memory rsig = _sign(refPks[k], ih);
            vouch.acceptIntro(i, rsig, a, csig);
        }
        Bundle memory b;
        (b.o, b.osig) = _order(venue, 12_000_000);
        (b.w, b.wsig) = _weights(b.o, c, _arr(ana, priya), _bps(7_000, 3_000));
        b.a = IVouch.PaymentAuth({
            customer: c,
            venue: venue,
            orderId: b.o.orderId,
            amount: 12_000_000,
            weightsHash: _weightsHash(b.w),
            deadline: uint64(block.timestamp + 10 minutes),
            submitter: c
        });
        b.usig = _usdcSig(ownerPk, b.a); // ERC-1271: the owner's key signs for the account
        usdc.mint(c, 12_000_000);
        bytes memory cd = _payCalldata(b);
        uint256[7] memory pre = _bals();

        vm.prank(owner, owner);
        vm.expectRevert(IVouch.UnauthorizedSubmitter.selector);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        vm.prank(attacker, attacker);
        vm.expectRevert("account: not owner");
        acct.execute(address(vouch), cd);

        vm.prank(owner, owner);
        acct.execute(address(vouch), cd);
        uint256[7] memory got = _bals();
        assertEq(usdc.balanceOf(c), 450_000, "account cashback");
        assertEq(got[1] - pre[1], 693_000);
        assertEq(got[2] - pre[2], 297_000);
        assertEq(got[3] - pre[3], 252_000);
        assertEq(got[4] - pre[4], 108_000);
        assertEq(got[5] - pre[5], 10_200_000);
        assertEq(usdc.lastReceiveCaller(), address(vouch));
        assertEq(vouch.introducerOf(venue, c), ana);
    }

    // ================================================================== 3. interactions (D-509, D-506/D-517)
    /// @dev D-509 unchanged under self-submit: a below-minimum first purchase verifies the customer with no reward,
    ///      and it was the only chance (the next purchase is plain).
    function test_v3_selfSubmit_firstPurchaseSemanticsUnchanged() public {
        _canonicalSetup();
        uint256 p0 = usdc.balanceOf(payout);
        Bundle memory b = _bundleFor(BEN_PK, 4e6, new address[](0), new uint16[](0), ben); // MIN_ORDER = 5e6
        vm.recordLogs();
        vm.prank(ben, ben);
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        (uint8 mode, uint256 va,) = _settledMode(vm.getRecordedLogs());
        assertEq(mode, 0);
        assertEq(va, 4e6);
        IVouch.CustomerState memory cs = vouch.getCustomer(venue, ben);
        assertTrue(cs.verified);
        assertFalse(cs.rewarded);
        assertEq(cs.introducer, address(0));
        Bundle memory c = _canon(ben);
        vm.prank(ben, ben);
        vouch.pay(c.o, c.osig, c.w, c.wsig, c.a, c.usig);
        assertEq(usdc.balanceOf(payout) - p0, 16e6, "both purchases plain: venue gets everything");
        assertFalse(vouch.getCustomer(venue, ben).rewarded);
    }

    /// @dev D-506/D-517 with msg.sender = customer: no gas limit lets a self-submitter settle with a different split
    ///      (every success equals the ample-gas outcome); 1-gas sweep around the threshold.
    bytes internal cdSelf;

    function _selfSweep(bool near) internal {
        _canonicalSetup();
        Bundle memory b = _canon(ben);
        cdSelf = _payCalldata(b);
        uint256 s0 = vm.snapshotState();
        vm.prank(ben, ben);
        (bool ok0,) = address(vouch).call{gas: 5_000_000}(cdSelf);
        assertTrue(ok0);
        uint256[7] memory refBal = _bals();
        vm.revertToState(s0);
        uint256 lo = 100_000;
        uint256 hi = 5_000_000;
        while (hi - lo > 1) {
            uint256 mid = (lo + hi) / 2;
            uint256 s = vm.snapshotState();
            vm.prank(ben, ben);
            (bool ok,) = address(vouch).call{gas: mid}(cdSelf);
            vm.revertToState(s);
            if (ok) hi = mid;
            else lo = mid;
        }
        emit log_named_uint("self-submit canonical: min successful gas limit", hi);
        uint256 successes;
        uint256 from = near ? hi - 800 : hi - 300_000;
        uint256 to = near ? hi + 150 : hi - 800;
        uint256 step = near ? 1 : 307;
        for (uint256 g = from; g <= to; g += step) {
            uint256 fmp;
            assembly {
                fmp := mload(0x40)
            }
            uint256 s = vm.snapshotState();
            vm.prank(ben, ben);
            (bool ok,) = address(vouch).call{gas: g}(cdSelf);
            if (ok) {
                successes++;
                uint256[7] memory got = _bals();
                for (uint256 k; k < 7; ++k) {
                    assertEq(got[k], refBal[k], "an under-funded self-submit paid someone differently");
                }
            }
            vm.revertToState(s);
            assembly {
                mstore(0x40, fmp)
            }
        }
        emit log_named_uint("successes (all identical to the ample-gas outcome)", successes);
        if (near) assertGt(successes, 0);
        else assertEq(successes, 0);
    }

    function test_v3_selfSubmitGasStarvation_near_1gas() public {
        _selfSweep(true);
    }

    function test_v3_selfSubmitGasStarvation_far() public {
        _selfSweep(false);
    }

    // ================================================================== 4. interface unchanged vs v2
    /// @dev PaymentAuth typehash, the EIP-3009 nonce derivation, pay()/error selectors and event topic0s are the v2
    ///      values published in the shared package (packages/shared/src/abi/vouch.ts, eip712.ts).
    function test_v3_typehashNonceSelectorsAndTopicsUnchanged() public {
        bytes32 v2Typehash = 0xf9bd6d8f7594705f0e81baf13ad79ce6624e48eab3cbbb41c3ba9a97b7abcba4;
        assertEq(vouch.PAYMENT_AUTH_TYPEHASH(), v2Typehash);
        assertEq(T_AUTH, v2Typehash);
        assertEq(vouch.pay.selector, bytes4(0xbaeddac1), "pay selector");
        assertEq(IVouch.UnauthorizedSubmitter.selector, bytes4(0x93b78c88), "error selector");
        assertEq(SETTLED_SIG, 0x35f580066b94268579e33474e66ad0347864c26fe8683e577efb5072c80e7432);
        assertEq(PAID_SIG, 0xd28b9898dcd3318ef486fd51dbeba03ddb126bdb888b82d4ac7504213412b36a);
        assertEq(RETURNED_SIG, 0x1cba477ed7240b8110e7fecc9c7f6fd041255365455d9c76f2b2febb4cfb7a15);
        assertEq(VERIFIED_SIG, 0xca816bf56b298971c59e72dcd003c06b351b66ffedb5ec84017d6195ec0152c8);
        assertEq(
            keccak256("IntroAccepted(address,address,address,bytes32,uint32,uint8,uint64)"),
            0xe75b5b5d835a46c918feb6cac867d2b1c6ed4d45a112ebaf7067bb9c1fcf37fc
        );
        assertEq(
            keccak256("IntroDropped(address,address,address,bytes32,uint8)"),
            0x71760f14b6c295e573eb0712240020bcabda6d58907c0f3897ecf55f9ec193ea
        );
        address[3] memory subs = [address(0), relayer, ben];
        for (uint256 i; i < 3; ++i) {
            Bundle memory b = _bundleFor(BEN_PK, 6e6, new address[](0), new uint16[](0), subs[i]);
            assertEq(vouch.paymentAuthNonce(b.a), _authNonce(b.a), "nonce = hashStruct(PaymentAuth)");
        }
        // the topics a self-submit actually emits are those values
        Bundle memory s = _bundleFor(PRIYA_PK, 6e6, new address[](0), new uint16[](0), priya);
        vm.recordLogs();
        vm.prank(priya, priya);
        vouch.pay(s.o, s.osig, s.w, s.wsig, s.a, s.usig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawSettled;
        bool sawVerified;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(vouch)) continue;
            if (logs[i].topics[0] == SETTLED_SIG) sawSettled = true;
            if (logs[i].topics[0] == VERIFIED_SIG) sawVerified = true;
        }
        assertTrue(sawSettled && sawVerified);
        assertTrue(usdc.authorizationState(priya, vouch.paymentAuthNonce(s.a)));
    }

    // ================================================================== 5. residuals (INFO)
    /// INFO (QE-C-10): an auth naming the relayer can only be settled by the relayer, but the ORDER is not bound to a
    /// submitter: the customer can sign a second, self-submit auth for the same order (here weightsHash = 0) and settle
    /// it first. The customer picks the fallback over the attributor quote (no new power: in the app it could equally
    /// sign weightsHash = 0), the relayer's tx reverts OrderAlreadySettled, and the relayer-bound authorization stays
    /// unused (charged once). Backend must treat OrderAlreadySettled as terminal and read PaymentSettled for the split.
    function test_INFO_customerCanPreemptRelayerBoundAuthWithOwnSelfSubmitAuth() public {
        _twoVerifiedReferrers();
        _introduce(venue, ANA_PK, BEN_PK, 1);
        vm.warp(block.timestamp + 4 days);
        _introduce(venue, PRIYA_PK, BEN_PK, 0); // fallback favours Priya 80/20; the attributor quote says Ana 80/20
        Bundle memory app = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(8_000, 2_000));
        IVouch.PaymentAuth memory own =
            IVouch.PaymentAuth(ben, venue, app.o.orderId, 12e6, bytes32(0), app.a.deadline, ben);
        bytes memory ownSig = _usdcSig(BEN_PK, own);
        uint256 ben0 = usdc.balanceOf(ben);
        vm.prank(ben, ben);
        vouch.pay(app.o, app.osig, _emptyWeights(), "", own, ownSig);
        assertEq(vouch.introducerOf(venue, ben), priya, "customer chose the fallback");
        vm.prank(relayer);
        vm.expectRevert(IVouch.OrderAlreadySettled.selector);
        vouch.pay(app.o, app.osig, app.w, app.wsig, app.a, app.usig);
        assertFalse(usdc.authorizationState(ben, _authNonce(app.a)), "relayer-bound authorization unused");
        assertEq(ben0 - usdc.balanceOf(ben), 12e6 - 450_000, "charged exactly once");
    }

    /// INFO: a self-submitter can degrade its own committed weights to the fallback (garbage attributor sig, mode 5);
    /// the outcome is identical to having signed weightsHash = 0 (mode 2). In self-submit mode the customer, and only
    /// the customer, chooses attributor vs fallback. No third party can (see the matrix tests).
    function test_INFO_selfSubmitterCanDegradeOwnCommitToFallback_sameAsSigningZero() public {
        _twoVerifiedReferrers();
        _introduce(venue, ANA_PK, BEN_PK, 1);
        vm.warp(block.timestamp + 4 days);
        _introduce(venue, PRIYA_PK, BEN_PK, 0);
        Bundle memory b = _bundleFor(BEN_PK, 12e6, _arr(ana, priya), _bps(8_000, 2_000), ben);
        Bundle memory z = _bundleFor(BEN_PK, 12e6, new address[](0), new uint16[](0), ben);
        uint256 snap = vm.snapshotState();
        vm.recordLogs();
        vm.prank(ben, ben);
        vouch.pay(b.o, b.osig, b.w, hex"dead", b.a, b.usig);
        (uint8 m1,,) = _settledMode(vm.getRecordedLogs());
        uint256[7] memory degraded = _bals();
        vm.revertToState(snap);
        vm.recordLogs();
        vm.prank(ben, ben);
        vouch.pay(z.o, z.osig, z.w, z.wsig, z.a, z.usig);
        (uint8 m2,,) = _settledMode(vm.getRecordedLogs());
        assertEq(m1, 5, "FALLBACK_BAD_SIGNATURE");
        assertEq(m2, 2, "FALLBACK_NOT_COMMITTED");
        uint256[7] memory zero = _bals();
        for (uint256 k; k < 7; ++k) {
            assertEq(degraded[k], zero[k], "same split either way");
        }
        assertEq(vouch.introducerOf(venue, ben), priya);
    }

    /// INFO: "submitter = 0 is unpayable" rests on msg.sender never being 0 (no key for 0x0; Ethereum/Arc system calls
    /// use 0xff…fe, not 0). Only a cheatcode prank as 0x0 settles it, which is not reachable on chain.
    function test_INFO_zeroSubmitterUnpayabilityRestsOnMsgSenderNeverZero() public {
        Bundle memory b = _bundleFor(BEN_PK, 6e6, new address[](0), new uint16[](0), address(0));
        vm.prank(address(0));
        vouch.pay(b.o, b.osig, b.w, b.wsig, b.a, b.usig);
        assertTrue(vouch.isOrderSettled(venue, b.o.orderId));
    }
}
