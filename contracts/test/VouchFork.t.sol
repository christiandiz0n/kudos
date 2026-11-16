// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Vouch} from "../src/Vouch.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../src/interfaces/IFiatTokenV2_2.sol";

/// @dev Arc moves native USDC through a chain precompile at 0x1800…0000 (`transfer(from, to, value18)`), which
///      Foundry's fork EVM does not implement. This shim reproduces ONLY that balance move with vm.deal; every other
///      line of USDC logic (payee check, EIP-712 signature, authorization nonces, blacklist) is the real Arc bytecode.
contract ArcNativeTransferShim {
    Vm constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function transfer(address from, address to, uint256 value) external returns (bool) {
        require(from.balance >= value, "shim: insufficient native balance");
        VM.deal(from, from.balance - value);
        VM.deal(to, to.balance + value);
        return true;
    }
}

interface IArcUSDC is IFiatTokenV2_2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() external view returns (bytes32);
}

/// @notice Runs the canonical story against the REAL Arc Testnet USDC (0x3600…, NativeFiatTokenV2_2) on a fork
///         (native-transfer precompile shimmed, see ArcNativeTransferShim).
/// @dev Skipped unless VOUCH_FORK=true. Run:  VOUCH_FORK=true forge test --match-contract VouchForkTest -vv
///      (RPC = $ARC_RPC_URL if set, else the public https://rpc.testnet.arc.io). Wrapper: scripts/deploy/fork-test.sh
contract VouchForkTest is Test {
    IArcUSDC constant USDC = IArcUSDC(0x3600000000000000000000000000000000000000);
    bytes32 constant T_ORDER = keccak256("Order(address venue,bytes32 orderId,uint256 amount,uint64 expiresAt)");
    bytes32 constant T_INTRO = keccak256(
        "Intro(address venue,address referrer,uint32 termsVersion,uint8 linkType,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );
    bytes32 constant T_ACCEPT = keccak256("IntroAcceptance(bytes32 introHash,address customer,uint64 deadline)");
    bytes32 constant T_WEIGHTS =
        keccak256("Weights(address venue,address customer,bytes32 orderId,address[] referrers,uint16[] bps)");
    bytes32 constant T_AUTH = keccak256(
        "PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline)"
    );
    bytes32 constant T_RWA = 0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    Vouch vouch;
    address venue;
    address payout = makeAddr("fork-payout");
    uint256 signerPk = 0x5161;
    uint256 attrPk = 0xA77B;
    uint256 anaPk = 0xA7A;
    uint256 priyaPk = 0x9819A;
    uint256 benPk = 0xBE7;
    address relayer = makeAddr("fork-relayer");

    function setUp() public {
        if (!vm.envOr("VOUCH_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("ARC_RPC_URL", string("https://rpc.testnet.arc.io")));
        vm.etch(0x1800000000000000000000000000000000000000, address(new ArcNativeTransferShim()).code);
        vm.allowCheatcodes(0x1800000000000000000000000000000000000000);
        vouch = new Vouch(USDC);
        address owner = makeAddr("fork-owner");
        vm.prank(owner);
        venue = vouch.registerVenue(
            owner,
            bytes32("fork"),
            IVouch.VenueConfig(payout, vm.addr(signerPk), vm.addr(attrPk), 1_500, 0, "fork"),
            0,
            ""
        );
        vm.startPrank(owner);
        vouch.setSeedAmbassador(venue, vm.addr(anaPk), true, 0, "");
        vouch.setSeedAmbassador(venue, vm.addr(priyaPk), true, 0, "");
        vm.stopPrank();
    }

    function _sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _digest(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vouch.domainSeparator(), sh));
    }

    function _intro(uint256 refPk, uint256 custPk, uint8 linkType) internal {
        IVouch.Intro memory i = IVouch.Intro(
            venue,
            vm.addr(refPk),
            1,
            linkType,
            uint64(block.timestamp),
            uint64(block.timestamp + 1 days),
            bytes32(refPk)
        );
        bytes32 ih = _digest(
            keccak256(abi.encode(T_INTRO, i.venue, i.referrer, i.termsVersion, i.linkType, i.issuedAt, i.expiresAt, i.nonce))
        );
        IVouch.IntroAcceptance memory a = IVouch.IntroAcceptance(ih, vm.addr(custPk), uint64(block.timestamp + 1 hours));
        vouch.acceptIntro(
            i, _sign(refPk, ih), a, _sign(custPk, _digest(keccak256(abi.encode(T_ACCEPT, ih, a.customer, a.deadline))))
        );
    }

    /// @dev Fund via the native balance: on Arc, USDC balanceOf == floor(native / 1e12) (D-102).
    function _fund(address who, uint256 usdc6) internal {
        vm.deal(who, usdc6 * 1e12);
    }

    function test_fork_realUsdcFacts() public view {
        assertEq(USDC.DOMAIN_SEPARATOR(), 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0);
        assertEq(USDC.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), T_RWA);
    }

    function test_fork_payeeCheckOnRealUsdc() public {
        vm.prank(relayer);
        vm.expectRevert("FiatTokenV2: caller must be the payee");
        USDC.receiveWithAuthorization(vm.addr(benPk), address(vouch), 1e6, 0, block.timestamp + 60, bytes32(0), "");
    }

    struct P {
        IVouch.Order o;
        bytes osig;
        IVouch.Weights w;
        bytes wsig;
        IVouch.PaymentAuth a;
        bytes usig;
        bytes32 nonce;
    }

    function _build(address ben, address[] memory refs, uint16[] memory bps) internal view returns (P memory p) {
        p.o = IVouch.Order(venue, bytes32("fork-order-1"), 12_000_000, uint64(block.timestamp + 600));
        p.osig =
            _sign(signerPk, _digest(keccak256(abi.encode(T_ORDER, p.o.venue, p.o.orderId, p.o.amount, p.o.expiresAt))));
        p.w = IVouch.Weights(venue, ben, p.o.orderId, refs, bps);
        bytes32 wh = keccak256(
            abi.encode(
                T_WEIGHTS, venue, ben, p.o.orderId, keccak256(abi.encodePacked(refs)), keccak256(abi.encodePacked(bps))
            )
        );
        p.wsig = _sign(attrPk, _digest(wh));
        p.a = IVouch.PaymentAuth(ben, venue, p.o.orderId, p.o.amount, wh, uint64(block.timestamp + 600));
        p.nonce = keccak256(abi.encode(T_AUTH, ben, venue, p.o.orderId, p.o.amount, wh, p.a.deadline));
        bytes32 rwa = keccak256(abi.encode(T_RWA, ben, address(vouch), p.o.amount, 0, uint256(p.a.deadline), p.nonce));
        p.usig = _sign(benPk, keccak256(abi.encodePacked("\x19\x01", USDC.DOMAIN_SEPARATOR(), rwa)));
    }

    function test_fork_canonicalPayOnRealUsdc() public {
        address ben = vm.addr(benPk);
        _intro(anaPk, benPk, 0);
        _intro(priyaPk, benPk, 1);
        _fund(ben, 12e6);
        address[] memory refs = new address[](2);
        refs[0] = vm.addr(anaPk);
        refs[1] = vm.addr(priyaPk);
        uint16[] memory bps = new uint16[](2);
        bps[0] = 7_000;
        bps[1] = 3_000;
        P memory p = _build(ben, refs, bps);

        uint256 p0 = USDC.balanceOf(payout);
        uint256 ana0 = USDC.balanceOf(refs[0]);
        uint256 priya0 = USDC.balanceOf(refs[1]);
        vm.prank(relayer);
        uint256 g = gasleft();
        vouch.pay(p.o, p.osig, p.w, p.wsig, p.a, p.usig);
        emit log_named_uint("fork pay() gas (real Arc USDC, L2 returned)", g - gasleft());
        // seeds have no introducers -> L2 ($0.36) returns to the venue: 10.20 + 0.36
        assertEq(USDC.balanceOf(payout) - p0, 10_560_000, "venue");
        assertEq(USDC.balanceOf(refs[0]) - ana0, 693_000, "ana L1");
        assertEq(USDC.balanceOf(refs[1]) - priya0, 297_000, "priya L1");
        assertEq(USDC.balanceOf(ben), 450_000, "ben cashback");
        assertEq(USDC.balanceOf(address(vouch)), 0);
        assertTrue(USDC.authorizationState(ben, p.nonce));
    }
}
