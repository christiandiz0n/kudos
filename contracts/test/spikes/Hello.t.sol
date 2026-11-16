// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Hello} from "../../src/spikes/Hello.sol";
import {MockUSDC} from "../../src/spikes/MockUSDC.sol";

contract HelloTest is Test {
    Hello hello;
    MockUSDC usdc;

    uint256 userPk = 0xA11CE;
    address user;
    address relayer = makeAddr("relayer");

    event Ping(address indexed from, bytes32 tag, uint256 at);
    event Split(
        address indexed token, address indexed from, address indexed relayer, uint256 recipientCount, uint256 total
    );

    function setUp() public {
        hello = new Hello();
        usdc = new MockUSDC();
        user = vm.addr(userPk);
        usdc.mint(user, 1_000e6);
        vm.prank(user);
        usdc.approve(address(hello), type(uint256).max);
    }

    // --- helpers -------------------------------------------------------------------------------

    /// @dev The product-story $12.00 split: venue, cashback, 2x L1, 2x L2, plus one extra (7 recipients).
    function _sevenWay() internal returns (address[] memory r, uint256[] memory a, uint256 total) {
        r = new address[](7);
        a = new uint256[](7);
        r[0] = makeAddr("venue");
        a[0] = 10_200_000; // $10.20
        r[1] = makeAddr("ben");
        a[1] = 450_000; // $0.45 cashback
        r[2] = makeAddr("ana");
        a[2] = 693_000; // $0.693 L1
        r[3] = makeAddr("priya");
        a[3] = 297_000; // $0.297 L1
        r[4] = makeAddr("anaIntroducer");
        a[4] = 252_000; // $0.252 L2
        r[5] = makeAddr("priyaIntroducer");
        a[5] = 107_999; // L2
        r[6] = makeAddr("dust");
        a[6] = 1; // remainder
        for (uint256 i; i < 7; ++i) {
            total += a[i];
        }
    }

    function _sign(uint256 pk, address from, address[] memory r, uint256[] memory a, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                hello.SPLIT_AUTH_TYPEHASH(),
                address(usdc),
                from,
                keccak256(abi.encodePacked(r)),
                keccak256(abi.encodePacked(a)),
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", hello.domainSeparator(), structHash));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(rr, s, v);
    }

    // --- tests ---------------------------------------------------------------------------------

    function test_ping_emitsEvent() public {
        vm.warp(1_800_000_000);
        vm.expectEmit(true, false, false, true, address(hello));
        emit Ping(user, bytes32("hello-arc"), 1_800_000_000);
        vm.prank(user);
        hello.ping(bytes32("hello-arc"));
    }

    function test_pullAndSplit_sevenRecipients_sumsExactly() public {
        (address[] memory r, uint256[] memory a, uint256 total) = _sevenWay();
        assertEq(total, 12_000_000, "story total is $12.00");
        uint256 before = usdc.balanceOf(user);

        vm.expectEmit(true, true, true, true, address(hello));
        emit Split(address(usdc), user, user, 7, total);
        vm.prank(user);
        hello.pullAndSplit(IERC20(address(usdc)), user, r, a);

        uint256 received;
        for (uint256 i; i < 7; ++i) {
            assertEq(usdc.balanceOf(r[i]), a[i]);
            received += usdc.balanceOf(r[i]);
        }
        assertEq(received, total);
        assertEq(before - usdc.balanceOf(user), total);
    }

    function test_pullAndSplit_revertsIfCallerNotFrom() public {
        (address[] memory r, uint256[] memory a,) = _sevenWay();
        vm.prank(relayer);
        vm.expectRevert(Hello.NotFrom.selector);
        hello.pullAndSplit(IERC20(address(usdc)), user, r, a);
    }

    function test_relayedSplit_validSig_succeeds() public {
        (address[] memory r, uint256[] memory a, uint256 total) = _sevenWay();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(userPk, user, r, a, hello.nonces(user), deadline);

        vm.expectEmit(true, true, true, true, address(hello));
        emit Split(address(usdc), user, relayer, 7, total);
        vm.prank(relayer);
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);

        assertEq(usdc.balanceOf(r[0]), 10_200_000);
        assertEq(hello.nonces(user), 1);
        assertEq(usdc.balanceOf(relayer), 0);
    }

    function test_relayedSplit_replay_reverts() public {
        (address[] memory r, uint256[] memory a,) = _sevenWay();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(userPk, user, r, a, 0, deadline);
        vm.prank(relayer);
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);

        // Same signature again: the nonce has advanced, so the recovered signer no longer matches.
        vm.prank(relayer);
        vm.expectPartialRevert(Hello.InvalidSigner.selector);
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);
    }

    function test_relayedSplit_wrongSigner_reverts() public {
        (address[] memory r, uint256[] memory a,) = _sevenWay();
        uint256 deadline = block.timestamp + 600;
        uint256 attackerPk = 0xBAD;
        bytes memory sig = _sign(attackerPk, user, r, a, 0, deadline);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Hello.InvalidSigner.selector, vm.addr(attackerPk), user));
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);
    }

    function test_relayedSplit_tamperedAmounts_reverts() public {
        (address[] memory r, uint256[] memory a,) = _sevenWay();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(userPk, user, r, a, 0, deadline);
        a[0] += 1; // relayer tries to move one more base unit to the venue
        vm.prank(relayer);
        vm.expectPartialRevert(Hello.InvalidSigner.selector);
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);
    }

    function test_relayedSplit_expired_reverts() public {
        (address[] memory r, uint256[] memory a,) = _sevenWay();
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(userPk, user, r, a, 0, deadline);
        vm.warp(deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(Hello.Expired.selector);
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);
    }

    function test_relayedSplit_lengthMismatch_reverts() public {
        (address[] memory r,,) = _sevenWay();
        uint256[] memory a = new uint256[](6);
        uint256 deadline = block.timestamp + 600;
        bytes memory sig = _sign(userPk, user, r, a, 0, deadline);
        vm.prank(relayer);
        vm.expectRevert(Hello.LengthMismatch.selector);
        hello.relayedSplit(IERC20(address(usdc)), user, r, a, deadline, sig);
    }

    /// @dev Fuzz: any split within balance moves exactly sum(amounts) out of `from`.
    function testFuzz_pullAndSplit_conservesValue(uint64[7] memory raw) public {
        address[] memory r = new address[](7);
        uint256[] memory a = new uint256[](7);
        uint256 total;
        for (uint256 i; i < 7; ++i) {
            r[i] = address(uint160(0x1000 + i));
            a[i] = bound(raw[i], 0, 100e6);
            total += a[i];
        }
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        hello.pullAndSplit(IERC20(address(usdc)), user, r, a);
        assertEq(before - usdc.balanceOf(user), total);
    }

    /// @dev Sanity: ECDSA import is used by Hello; keep the symbol referenced for the compiler.
    function test_ecdsa_recoverMatchesVmAddr() public view {
        bytes32 h = keccak256("x");
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(userPk, h);
        assertEq(ECDSA.recover(h, v, rr, s), user);
    }
}
