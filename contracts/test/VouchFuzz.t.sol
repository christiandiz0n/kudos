// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {VouchBase} from "./VouchBase.t.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";

/// @notice Property fuzzing of pay(): exact sum, frozen-rate cap, recipient legitimacy, never-revert on weights,
///         replay protection. Runs = foundry.toml [fuzz] runs (1,000).
contract VouchFuzzTest is VouchBase {
    uint256[5] internal REF_PKS = [uint256(0x201), 0x202, 0x203, 0x204, 0x205];

    struct Case {
        uint256 amount;
        uint256 nRefs;
        uint8 introducerMask;
        uint8 linkMask;
        uint16[5] rates;
        uint256[5] minOrders;
        uint32[5] gaps;
        uint16[5] rawBps;
        uint8 mode; // 0 none, 1 valid attributor, 2 raw/random weights, 3 valid weights + bad signature
        uint32 finalWarp;
    }

    struct Seen {
        address[5] eligible;
        uint256 k;
        uint256 maxRate;
    }

    function _eligibleNow(uint256 amount) internal view returns (Seen memory s) {
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, ben);
        for (uint256 i; i < li.length; ++i) {
            if (block.timestamp > li[i].expiresAt) continue;
            IVouch.Terms memory t = vouch.getTerms(venue, li[i].termsVersion);
            if (amount < t.minOrder) continue;
            s.eligible[s.k++] = li[i].referrer;
            if (t.rewardBps > s.maxRate) s.maxRate = t.rewardBps;
        }
    }

    function _isEligible(Seen memory s, address a) internal pure returns (bool) {
        for (uint256 i; i < s.k; ++i) {
            if (s.eligible[i] == a) return true;
        }
        return false;
    }

    function _setupCase(Case memory c) internal {
        _seed(venue, sam);
        for (uint256 k; k < c.nRefs; ++k) {
            address r = vm.addr(REF_PKS[k]);
            _seed(venue, r);
            if (c.introducerMask & (1 << k) != 0) {
                _introduce(venue, SAM_PK, REF_PKS[k], 0);
                _pay(venue, REF_PKS[k], 10e6, _arr(sam), _bps(10_000)); // introducer(r) = sam
            }
        }
        for (uint256 k; k < c.nRefs; ++k) {
            vm.warp(block.timestamp + 1 + bound(c.gaps[k], 0, 3 days));
            vm.prank(lena);
            vouch.updateTerms(venue, uint16(bound(c.rates[k], 1, 5_000)), bound(c.minOrders[k], 0, 10_000e6), 0, "");
            _introduce(venue, REF_PKS[k], BEN_PK, uint8((c.linkMask >> k) & 1));
        }
        vm.warp(block.timestamp + bound(c.finalWarp, 0, 4 days));
    }

    function _buildWeights(Case memory c, Seen memory s, IVouch.Order memory o)
        internal
        view
        returns (IVouch.Weights memory w, bytes memory wsig, bytes32 committed)
    {
        uint8 mode = c.mode % 4;
        if (mode == 0) return (w, "", 0);
        address[] memory refs;
        uint16[] memory bps;
        if (mode == 2 || s.k == 0) {
            refs = new address[](c.nRefs);
            bps = new uint16[](c.nRefs);
            for (uint256 k; k < c.nRefs; ++k) {
                refs[k] = vm.addr(REF_PKS[(k + c.rawBps[0]) % c.nRefs]);
                bps[k] = c.rawBps[k];
            }
        } else {
            uint256 m = s.k;
            refs = new address[](m);
            bps = new uint16[](m);
            for (uint256 i; i < m; ++i) {
                refs[i] = s.eligible[m - 1 - i]; // reversed order on purpose
            }
            if (m == 1) {
                bps[0] = 10_000;
            } else {
                uint256 w0 = bound(c.rawBps[0], m == 2 ? 2_000 : 1, 8_000);
                uint256 rest = 10_000 - w0;
                bps[0] = uint16(w0);
                for (uint256 i = 1; i < m; ++i) {
                    bps[i] = uint16(rest / (m - 1));
                }
                bps[m - 1] += uint16(rest - (rest / (m - 1)) * (m - 1));
            }
        }
        w = IVouch.Weights({venue: venue, customer: ben, orderId: o.orderId, referrers: refs, bps: bps});
        committed = _weightsHash(w);
        wsig = _sign(mode == 3 ? BEN_PK : ATTR_PK, _digest(committed));
    }

    function _balances(address[] memory who) internal view returns (uint256[] memory b) {
        b = new uint256[](who.length);
        for (uint256 i; i < who.length; ++i) {
            b[i] = usdc.balanceOf(who[i]);
        }
    }

    struct Tx {
        IVouch.Order o;
        bytes osig;
        IVouch.Weights w;
        bytes wsig;
        bytes32 committed;
        IVouch.PaymentAuth a;
        bytes usig;
    }

    function testFuzz_pay_exactSumCapAndLegitRecipients(Case memory c) public {
        c.nRefs = bound(c.nRefs, 1, 5);
        c.amount = bound(c.amount, 1, 1_000_000e6);
        _setupCase(c);
        Seen memory s = _eligibleNow(c.amount);

        Tx memory t;
        (t.o, t.osig) = _order(venue, c.amount);
        (t.w, t.wsig, t.committed) = _buildWeights(c, s, t.o);
        (t.a, t.usig) = _auth(t.o, BEN_PK, t.committed);
        usdc.mint(ben, c.amount);

        address[] memory who = new address[](8);
        who[0] = payout;
        who[1] = ben;
        who[2] = sam;
        for (uint256 k; k < 5; ++k) {
            who[3 + k] = vm.addr(REF_PKS[k]);
        }
        uint256[] memory b0 = _balances(who);

        vm.recordLogs();
        vm.prank(relayer);
        vouch.pay(t.o, t.osig, t.w, t.wsig, t.a, t.usig); // must never revert for any weights
        Vm.Log[] memory logs = vm.getRecordedLogs();

        _checkConservation(who, b0);
        uint256 venueAmount = _checkEvents(logs, s, c);
        assertEq(usdc.balanceOf(payout) - b0[0], venueAmount, "venue payout matches event");
        _checkReplays(t, c.amount);
    }

    function _checkConservation(address[] memory who, uint256[] memory b0) internal view {
        uint256[] memory b1 = _balances(who);
        uint256 gained;
        for (uint256 i; i < who.length; ++i) {
            if (i != 1) gained += b1[i] - b0[i];
        }
        assertEq(gained, b0[1] - b1[1], "sum of transfers == amount (net of cashback)");
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    function _checkEvents(Vm.Log[] memory logs, Seen memory s, Case memory c) internal view returns (uint256 venueAmount) {
        uint256 rewardsPaid;
        uint256 rewardsAll;
        uint8 mode;
        bool rewarded;
        for (uint256 j; j < logs.length; ++j) {
            bytes32 t0 = logs[j].topics[0];
            if (t0 == PaymentSettled.selector) {
                (, venueAmount,,, rewarded, mode) =
                    abi.decode(logs[j].data, (uint256, uint256, uint256, bool, bool, uint8));
            } else if (t0 == RewardPaid.selector || t0 == RewardReturned.selector) {
                (, uint8 role, uint256 amt, address via) = abi.decode(logs[j].data, (address, uint8, uint256, address));
                rewardsAll += amt;
                if (t0 == RewardPaid.selector) {
                    rewardsPaid += amt;
                    _checkRecipient(s, address(uint160(uint256(logs[j].topics[2]))), role, via);
                }
            }
        }
        assertEq(venueAmount + rewardsPaid, c.amount, "venueAmount + rewards == amount");
        assertLe(rewardsAll, c.amount * s.maxRate / 10_000, "total reward <= amount x max frozen rate");
        assertEq(rewarded, s.k > 0, "rewarded iff an eligible intro existed");
        if (s.k > 0) {
            uint8 m = c.mode % 4;
            if (m == 0) assertEq(mode, 2);
            if (m == 1) assertEq(mode, 1);
            if (m == 3) assertEq(mode, 5);
            assertTrue(_isEligible(s, vouch.introducerOf(venue, ben)), "introducer is an eligible L1");
        } else {
            assertEq(vouch.introducerOf(venue, ben), address(0));
        }
    }

    function _checkRecipient(Seen memory s, address recipient, uint8 role, address via) internal view {
        if (role == 0) assertEq(recipient, ben, "cashback only to the customer");
        if (role == 1) assertTrue(_isEligible(s, recipient), "L1 only to valid intro holders");
        if (role == 2) {
            assertTrue(_isEligible(s, via), "L2 only via a valid L1");
            assertEq(recipient, vouch.introducerOf(venue, via), "L2 only to the recorded introducer");
            assertTrue(recipient != ben, "no self L2");
        }
    }

    function _checkReplays(Tx memory t, uint256 amount) internal {
        vm.expectRevert(IVouch.OrderAlreadySettled.selector);
        vm.prank(relayer);
        vouch.pay(t.o, t.osig, t.w, t.wsig, t.a, t.usig);
        // the same USDC authorization cannot fund a different order: the nonce binds the orderId
        (IVouch.Order memory o2, bytes memory osig2) = _order(venue, amount);
        IVouch.PaymentAuth memory a2 = IVouch.PaymentAuth(ben, venue, o2.orderId, amount, t.committed, t.a.deadline, relayer);
        usdc.mint(ben, amount);
        vm.expectRevert("FiatTokenV2: invalid signature");
        vm.prank(relayer);
        vouch.pay(o2, osig2, t.w, t.wsig, a2, t.usig);
        // and the second purchase is never rewarded again
        uint256 repeatPayout0 = usdc.balanceOf(payout);
        bytes memory usig2;
        (a2, usig2) = _auth(o2, BEN_PK, 0);
        vm.prank(relayer);
        vouch.pay(o2, osig2, _emptyWeights(), "", a2, usig2);
        assertEq(usdc.balanceOf(payout) - repeatPayout0, amount, "repeat purchase is plain");
    }

    /// @dev Any garbage attributor signature → fallback, never a revert.
    function testFuzz_pay_garbageAttributorSigFallsBack(bytes memory garbage, uint16 w0) public {
        _canonicalSetup();
        w0 = uint16(bound(w0, 2_000, 8_000));
        (IVouch.Order memory o, bytes memory osig) = _order(venue, 12e6);
        (IVouch.Weights memory w,) = _weights(o, ben, _arr(ana, priya), _bps(w0, 10_000 - w0));
        (IVouch.PaymentAuth memory a, bytes memory usig) = _auth(o, BEN_PK, _weightsHash(w));
        usdc.mint(ben, o.amount);
        vm.recordLogs();
        vm.prank(relayer);
        vouch.pay(o, osig, w, garbage, a, usig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 j; j < logs.length; ++j) {
            if (logs[j].topics[0] == PaymentSettled.selector) {
                (,,,,, uint8 m) = abi.decode(logs[j].data, (uint256, uint256, uint256, bool, bool, uint8));
                assertEq(m, 5);
            }
        }
        assertTrue(vouch.getCustomer(venue, ben).rewarded);
    }

    /// @dev Intro replays: a personal intro can never be accepted twice; a broadcast once per customer.
    function testFuzz_introReplayReverts(bytes32 nonce, bool broadcast, uint256 otherPk) public {
        otherPk = bound(otherPk, 0x1000, 0xffffff);
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, broadcast ? 1 : 0, nonce);
        _acceptSigned(i, SAM_PK, BEN_PK);
        (IVouch.IntroAcceptance memory acc, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
        vouch.acceptIntro(i, rsig, acc, csig);
        (acc, csig) = _acceptance(i, otherPk);
        if (broadcast) {
            vouch.acceptIntro(i, rsig, acc, csig);
        } else {
            vm.expectRevert(IVouch.IntroAlreadyUsed.selector);
            vouch.acceptIntro(i, rsig, acc, csig);
        }
    }
}
