// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vouch} from "../src/Vouch.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../src/interfaces/IFiatTokenV2_2.sol";
import {MockFiatTokenV2_2} from "./mocks/MockFiatTokenV2_2.sol";

/// @notice Shared fixture + signing helpers. Struct hashes are re-implemented here from the type strings
///         (independently of src/libraries/VouchHash.sol) so a typehash/encoding drift fails the tests.
abstract contract VouchBase is Test {
    // Type strings (must equal VouchHash + packages/shared/src/eip712.ts).
    bytes32 internal constant T_INTRO = keccak256(
        "Intro(address venue,address referrer,uint32 termsVersion,uint8 linkType,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );
    bytes32 internal constant T_ACCEPT = keccak256("IntroAcceptance(bytes32 introHash,address customer,uint64 deadline)");
    bytes32 internal constant T_ORDER = keccak256("Order(address venue,bytes32 orderId,uint256 amount,uint64 expiresAt)");
    bytes32 internal constant T_WEIGHTS =
        keccak256("Weights(address venue,address customer,bytes32 orderId,address[] referrers,uint16[] bps)");
    bytes32 internal constant T_AUTH = keccak256(
        "PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline)"
    );
    bytes32 internal constant T_REGISTER = keccak256(
        "RegisterVenue(address owner,bytes32 salt,address payout,address signer,address attributor,uint16 rewardBps,uint256 minOrder,string metadataURI,uint256 nonce,uint64 deadline)"
    );
    bytes32 internal constant T_TERMS =
        keccak256("UpdateTerms(address venue,uint16 rewardBps,uint256 minOrder,uint256 nonce,uint64 deadline)");
    bytes32 internal constant T_KEYS = keccak256(
        "SetVenueKeys(address venue,address payout,address signer,address attributor,uint256 nonce,uint64 deadline)"
    );
    bytes32 internal constant T_SEED =
        keccak256("SetSeedAmbassador(address venue,address ambassador,bool allowed,uint256 nonce,uint64 deadline)");
    bytes32 internal constant T_RWA = 0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    // Events (re-declared for vm.expectEmit).
    event PaymentSettled(
        address indexed venue,
        address indexed customer,
        bytes32 indexed orderId,
        uint256 amount,
        uint256 venueAmount,
        uint256 rewardPool,
        bool firstPurchase,
        bool rewarded,
        uint8 weightsMode
    );
    event RewardPaid(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed venue,
        address customer,
        uint8 role,
        uint256 amount,
        address viaReferrer
    );
    event RewardReturned(
        bytes32 indexed orderId,
        address indexed intendedRecipient,
        address indexed venue,
        address customer,
        uint8 role,
        uint256 amount,
        address viaReferrer,
        uint8 reason
    );
    event CustomerVerified(address indexed venue, address indexed customer, address indexed introducer, bytes32 orderId);
    event IntroAccepted(
        address indexed venue,
        address indexed referrer,
        address indexed customer,
        bytes32 introHash,
        uint32 termsVersion,
        uint8 linkType,
        uint64 expiresAt
    );
    event IntroDropped(
        address indexed venue, address indexed customer, address indexed referrer, bytes32 introHash, uint8 reason
    );

    Vouch internal vouch;
    MockFiatTokenV2_2 internal usdc;

    uint256 internal constant LENA_PK = 0x1E7A;
    uint256 internal constant SIGNER_PK = 0x5161;
    uint256 internal constant ATTR_PK = 0xA77B;
    uint256 internal constant ANA_PK = 0xA7A;
    uint256 internal constant PRIYA_PK = 0x9819A;
    uint256 internal constant BEN_PK = 0xBE7;
    uint256 internal constant SAM_PK = 0x5A3; // seed ambassador, Ana's introducer
    uint256 internal constant OMAR_PK = 0x03A2; // seed ambassador, Priya's introducer

    address internal lena;
    address internal payout;
    address internal venueSigner;
    address internal attributor;
    address internal ana;
    address internal priya;
    address internal ben;
    address internal sam;
    address internal omar;
    address internal relayer = makeAddr("relayer");

    address internal venue; // Lena's café
    bytes32 internal constant SALT = keccak256("lenas-cafe");
    uint16 internal constant RATE = 1_500; // 15%
    uint256 internal constant MIN_ORDER = 5e6; // $5.00

    uint256 internal orderSeq;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new MockFiatTokenV2_2();
        vouch = new Vouch(IFiatTokenV2_2(address(usdc)));
        lena = vm.addr(LENA_PK);
        payout = makeAddr("lenaPayout");
        venueSigner = vm.addr(SIGNER_PK);
        attributor = vm.addr(ATTR_PK);
        ana = vm.addr(ANA_PK);
        priya = vm.addr(PRIYA_PK);
        ben = vm.addr(BEN_PK);
        sam = vm.addr(SAM_PK);
        omar = vm.addr(OMAR_PK);
        venue = _register(lena, SALT, RATE, MIN_ORDER);
        vm.label(venue, "venue");
        vm.label(payout, "payout");
        vm.label(ana, "ana");
        vm.label(priya, "priya");
        vm.label(ben, "ben");
        vm.label(sam, "sam");
        vm.label(omar, "omar");
    }

    // ------------------------------------------------------------------ venue helpers
    function _cfg(uint16 rate, uint256 minOrder) internal view returns (IVouch.VenueConfig memory) {
        return IVouch.VenueConfig({
            payout: payout,
            signer: venueSigner,
            attributor: attributor,
            rewardBps: rate,
            minOrder: minOrder,
            metadataURI: "ipfs://lenas-cafe"
        });
    }

    function _register(address owner, bytes32 salt, uint16 rate, uint256 minOrder) internal returns (address v) {
        vm.prank(owner);
        v = vouch.registerVenue(owner, salt, _cfg(rate, minOrder), 0, "");
    }

    function _seed(address v, address who) internal {
        vm.prank(lena);
        vouch.setSeedAmbassador(v, who, true, 0, "");
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vouch.domainSeparator(), structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ intro helpers
    function _introStruct(address v, uint256 referrerPk, uint8 linkType, bytes32 nonce)
        internal
        view
        returns (IVouch.Intro memory i)
    {
        (uint32 tv,) = vouch.currentTerms(v);
        i = IVouch.Intro({
            venue: v,
            referrer: vm.addr(referrerPk),
            termsVersion: tv,
            linkType: linkType,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 7 days),
            nonce: nonce
        });
    }

    function _introHash(IVouch.Intro memory i) internal view returns (bytes32) {
        return _digest(
            keccak256(
                abi.encode(T_INTRO, i.venue, i.referrer, i.termsVersion, i.linkType, i.issuedAt, i.expiresAt, i.nonce)
            )
        );
    }

    function _acceptance(IVouch.Intro memory i, uint256 customerPk)
        internal
        view
        returns (IVouch.IntroAcceptance memory a, bytes memory sig)
    {
        a = IVouch.IntroAcceptance({
            introHash: _introHash(i), customer: vm.addr(customerPk), deadline: uint64(block.timestamp + 1 hours)
        });
        sig = _sign(customerPk, _digest(keccak256(abi.encode(T_ACCEPT, a.introHash, a.customer, a.deadline))));
    }

    function _acceptSigned(IVouch.Intro memory i, uint256 referrerPk, uint256 customerPk) internal {
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, customerPk);
        bytes memory rsig = _sign(referrerPk, _introHash(i));
        vm.prank(relayer);
        vouch.acceptIntro(i, rsig, a, csig);
    }

    function _introduce(address v, uint256 referrerPk, uint256 customerPk, uint8 linkType) internal {
        IVouch.Intro memory i = _introStruct(v, referrerPk, linkType, keccak256(abi.encode(referrerPk, customerPk, v)));
        _acceptSigned(i, referrerPk, customerPk);
    }

    // ------------------------------------------------------------------ payment helpers
    function _order(address v, uint256 amount) internal returns (IVouch.Order memory o, bytes memory sig) {
        o = IVouch.Order({
            venue: v,
            orderId: keccak256(abi.encode("order", ++orderSeq)),
            amount: amount,
            expiresAt: uint64(block.timestamp + 10 minutes)
        });
        sig = _sign(SIGNER_PK, _digest(keccak256(abi.encode(T_ORDER, o.venue, o.orderId, o.amount, o.expiresAt))));
    }

    function _weightsHash(IVouch.Weights memory w) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                T_WEIGHTS,
                w.venue,
                w.customer,
                w.orderId,
                keccak256(abi.encodePacked(w.referrers)),
                keccak256(abi.encodePacked(w.bps))
            )
        );
    }

    function _weights(IVouch.Order memory o, address customer, address[] memory refs, uint16[] memory bps)
        internal
        view
        returns (IVouch.Weights memory w, bytes memory sig)
    {
        w = IVouch.Weights({venue: o.venue, customer: customer, orderId: o.orderId, referrers: refs, bps: bps});
        sig = _sign(ATTR_PK, _digest(_weightsHash(w)));
    }

    function _emptyWeights() internal pure returns (IVouch.Weights memory w) {}

    function _authNonce(IVouch.PaymentAuth memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(T_AUTH, a.customer, a.venue, a.orderId, a.amount, a.weightsHash, a.deadline));
    }

    function _auth(IVouch.Order memory o, uint256 customerPk, bytes32 weightsHash)
        internal
        view
        returns (IVouch.PaymentAuth memory a, bytes memory sig)
    {
        a = IVouch.PaymentAuth({
            customer: vm.addr(customerPk),
            venue: o.venue,
            orderId: o.orderId,
            amount: o.amount,
            weightsHash: weightsHash,
            deadline: uint64(block.timestamp + 10 minutes)
        });
        sig = _usdcSig(customerPk, a);
    }

    function _usdcSig(uint256 customerPk, IVouch.PaymentAuth memory a) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(T_RWA, a.customer, address(vouch), a.amount, uint256(0), uint256(a.deadline), _authNonce(a)));
        return _sign(customerPk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)));
    }

    /// @dev Pay with attributor weights (refs/bps) or, if refs is empty, the on-chain fallback (weightsHash 0).
    function _pay(address v, uint256 customerPk, uint256 amount, address[] memory refs, uint16[] memory bps)
        internal
        returns (IVouch.Order memory o)
    {
        bytes memory osig;
        (o, osig) = _order(v, amount);
        IVouch.Weights memory w;
        bytes memory wsig;
        bytes32 wh;
        if (refs.length > 0) {
            (w, wsig) = _weights(o, vm.addr(customerPk), refs, bps);
            wh = _weightsHash(w);
        }
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, customerPk, wh);
        usdc.mint(a.customer, amount);
        vm.prank(relayer);
        vouch.pay(o, osig, w, wsig, a, usig);
    }

    function _payFallback(address v, uint256 customerPk, uint256 amount) internal returns (IVouch.Order memory) {
        return _pay(v, customerPk, amount, new address[](0), new uint16[](0));
    }

    function _arr(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _arr(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _bps(uint16 a) internal pure returns (uint16[] memory r) {
        r = new uint16[](1);
        r[0] = a;
    }

    function _bps(uint16 a, uint16 b) internal pure returns (uint16[] memory r) {
        r = new uint16[](2);
        r[0] = a;
        r[1] = b;
    }

    /// @dev Canonical story setup: seeds Sam + Omar; Sam→Ana and Omar→Priya first purchases ($20 each, single
    ///      referrer); then Ana (personal) and Priya (broadcast) introduce Ben.
    function _canonicalSetup() internal {
        _seed(venue, sam);
        _seed(venue, omar);
        _introduce(venue, SAM_PK, ANA_PK, 0);
        _pay(venue, ANA_PK, 20e6, _arr(sam), _bps(10_000));
        _introduce(venue, OMAR_PK, PRIYA_PK, 0);
        _pay(venue, PRIYA_PK, 20e6, _arr(omar), _bps(10_000));
        _introduce(venue, ANA_PK, BEN_PK, 0);
        _introduce(venue, PRIYA_PK, BEN_PK, 1);
    }
}
