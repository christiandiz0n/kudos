// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";

/// @title Event completeness (can every product view be rebuilt from events alone?) and previewPayment == settlement.
contract QeEventsTest is QeBase {
    // ------------------------------------------------------------------ event-sourced rebuild
    struct Rebuilt {
        uint256 verified;
        uint256 rewarded;
        uint256 gross;
        uint256 paid;
        uint256 returned;
    }

    function _rebuildVenue(Vm.Log[] memory logs, address v) internal view returns (Rebuilt memory r) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter != address(vouch)) continue;
            bytes32 t0 = l.topics[0];
            if (t0 == VERIFIED_SIG && address(uint160(uint256(l.topics[1]))) == v) {
                r.verified++;
            } else if (t0 == SETTLED_SIG && address(uint160(uint256(l.topics[1]))) == v) {
                (uint256 amount, uint256 venueAmount,, bool first, bool rewarded,) =
                    abi.decode(l.data, (uint256, uint256, uint256, bool, bool, uint8));
                r.gross += amount;
                if (first && rewarded) r.rewarded++;
                // D-504 indexer invariant: venueAmount + Σ RewardPaid(orderId) == amount
                assertEq(venueAmount + _paidFor(logs, l.topics[3]), amount, "D-504 per-payment identity");
            } else if (t0 == PAID_SIG && address(uint160(uint256(l.topics[3]))) == v) {
                (,, uint256 amt,) = abi.decode(l.data, (address, uint8, uint256, address));
                r.paid += amt;
            } else if (t0 == RETURNED_SIG && address(uint160(uint256(l.topics[3]))) == v) {
                (,, uint256 amt,,) = abi.decode(l.data, (address, uint8, uint256, address, uint8));
                r.returned += amt;
            }
        }
    }

    function _paidFor(Vm.Log[] memory logs, bytes32 orderId) internal view returns (uint256 s) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(vouch) && logs[i].topics[0] == PAID_SIG && logs[i].topics[1] == orderId) {
                (,, uint256 amt,) = abi.decode(logs[i].data, (address, uint8, uint256, address));
                s += amt;
            }
        }
    }

    /// @dev l1/l2 earned, and "customers credited" = distinct orders in which `who` appears as an L1 (paid or returned).
    function _rebuildAmbassador(Vm.Log[] memory logs, address who)
        internal
        view
        returns (uint256 l1, uint256 l2, uint256 credited)
    {
        bytes32 lastOrder;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter != address(vouch)) continue;
            if (l.topics[0] == PAID_SIG && address(uint160(uint256(l.topics[2]))) == who) {
                (, uint8 role, uint256 amt,) = abi.decode(l.data, (address, uint8, uint256, address));
                if (role == 1) {
                    l1 += amt;
                    if (l.topics[1] != lastOrder) credited++;
                    lastOrder = l.topics[1];
                } else if (role == 2) {
                    l2 += amt;
                }
            } else if (l.topics[0] == RETURNED_SIG && address(uint160(uint256(l.topics[2]))) == who) {
                (, uint8 role,,,) = abi.decode(l.data, (address, uint8, uint256, address, uint8));
                if (role == 1 && l.topics[1] != lastOrder) {
                    credited++;
                    lastOrder = l.topics[1];
                }
            }
        }
    }

    /// @dev A multi-payment story (canonical + blacklisted recipient + plain repeat + second venue): every VenueStats
    ///      field and every ambassador's l1/l2/credited is rebuilt from events alone and equals the on-chain view.
    function test_events_rebuildEveryStatFromLogsAlone() public {
        vm.recordLogs();
        _canonicalSetup();
        _pay(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(7_000, 3_000));
        _payFallback(venue, BEN_PK, 3e6); // plain repeat
        usdc.blacklist(ana);
        _introduce(venue, ANA_PK, 0xC0DE, 0);
        _introduce(venue, PRIYA_PK, 0xC0DE, 1);
        _payFallback(venue, 0xC0DE, 40e6); // Ana's L1 returns (TRANSFER_FAILED)
        address v2 = _registerAs(lena, keccak256("v2"), 2_000, 0);
        _seed(v2, ben);
        _introduce(v2, BEN_PK, PRIYA_PK, 1);
        _payFallback(v2, PRIYA_PK, 7e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        address[2] memory venues = [venue, v2];
        for (uint256 k; k < 2; ++k) {
            Rebuilt memory r = _rebuildVenue(logs, venues[k]);
            IVouch.VenueStats memory s = vouch.getVenueStats(venues[k]);
            assertEq(r.verified, s.verifiedCustomers, "verifiedCustomers");
            assertEq(r.rewarded, s.rewardedCustomers, "rewardedCustomers");
            assertEq(r.gross, s.grossVolume, "grossVolume");
            assertEq(r.paid, s.rewardsPaid, "rewardsPaid");
            assertEq(r.returned, s.rewardsReturned, "rewardsReturned");
        }
        address[5] memory amb = [ana, priya, sam, omar, ben];
        for (uint256 k; k < 5; ++k) {
            (uint256 l1, uint256 l2, uint256 credited) = _rebuildAmbassador(logs, amb[k]);
            IVouch.AmbassadorStats memory a = vouch.getAmbassadorStats(amb[k]);
            assertEq(l1, a.l1Earned, "l1Earned");
            assertEq(l2, a.l2Earned, "l2Earned");
            assertEq(credited, a.customersCredited, "customersCredited");
        }
    }

    /// QE-C-03 (Low). EXPECTED (IVouch: "the DB is rebuildable from these alone"): an ambassador's customersCredited /
    /// venues can be derived from events. ACTUAL: a referrer whose L1 share floors to 0 (tiny amount or tiny weight ×
    /// rate) is counted in customersCredited/venues on-chain, but no event names them (no RewardPaid/RewardReturned for
    /// a 0 amount, CustomerVerified names only the top referrer, PaymentSettled has no per-referrer data).
    /// Fix: emit the per-referrer attribution (referrer, bps, termsVersion) in an event, or emit zero-amount L1 records.
    function test_BUG_ambassadorCreditNotRecoverableFromEvents() public {
        address v2 = _registerAs(lena, keccak256("tiny"), RATE, 0); // minOrder 0
        _seed(v2, sam);
        _seed(v2, omar);
        _introduce(v2, SAM_PK, BEN_PK, 0);
        _introduce(v2, OMAR_PK, BEN_PK, 1);
        vm.recordLogs();
        // 50 base units, Sam 80 / Omar 20: Omar's slice = floor(50*2000*1500/1e8) = 1 → L1 = floor(0.55) = 0
        _pay(v2, BEN_PK, 50, _arr(sam, omar), _bps(8_000, 2_000));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (,, uint256 creditedFromEvents) = _rebuildAmbassador(logs, omar);
        bool namedAnywhere;
        for (uint256 i; i < logs.length; ++i) {
            for (uint256 t = 1; t < logs[i].topics.length; ++t) {
                if (logs[i].topics[t] == bytes32(uint256(uint160(omar)))) namedAnywhere = true;
            }
        }
        assertEq(vouch.getAmbassadorStats(omar).customersCredited, 1, "on-chain: Omar credited");
        assertEq(vouch.getAmbassadorStats(omar).venues, 1);
        assertFalse(namedAnywhere, "(no event mentions Omar)");
        assertEq(creditedFromEvents, 1, "customersCredited cannot be rebuilt from events");
    }

    // ------------------------------------------------------------------ preview == settlement (fuzz)
    struct Case {
        uint256 seed;
        uint256 n;
        uint256 amount;
        uint8 mode;
    }

    struct Track {
        address[6] who;
        uint256[6] before;
        uint256[6] expected;
    }

    function _idx(Track memory t, address a) internal pure returns (uint256) {
        for (uint256 i; i < 6; ++i) {
            if (t.who[i] == a) return i;
        }
        revert("untracked recipient");
    }

    /// @dev Random graph (up to 4 referrers for Ben with random link types, ages and frozen terms versions), random
    ///      amount and weights mode (fallback / valid attributor subset / garbage signature / mismatched hash):
    ///      the quote equals what settles, per recipient, to the base unit; mode, pool, venueAmount and introducer too.
    function testFuzz_previewEqualsSettlement(uint256 seed) public {
        Case memory c = _fuzzGraph(seed);
        Bundle memory b = _fuzzBundle(c);
        IVouch.Quote memory q =
            vouch.previewPayment(venue, ben, b.o.orderId, c.amount, b.w, b.wsig, b.a.weightsHash);
        Track memory t = _expected(q);
        vm.recordLogs();
        _exec(b);
        (uint8 mode, uint256 venueAmount,) = _settledMode(vm.getRecordedLogs());
        for (uint256 i; i < 6; ++i) {
            uint256 got = usdc.balanceOf(t.who[i]) + (i == 0 ? c.amount : 0) - t.before[i];
            assertEq(got, t.expected[i], "per-recipient quote == settlement");
        }
        assertEq(mode, q.weightsMode, "mode");
        assertEq(venueAmount, q.venueAmount, "venueAmount");
        assertEq(vouch.introducerOf(venue, ben), q.introducer, "introducer");
        assertEq(vouch.getCustomer(venue, ben).rewarded, q.rewarded);
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    function _fuzzGraph(uint256 seed) internal returns (Case memory c) {
        c.seed = seed;
        _twoVerifiedReferrers();
        uint256[4] memory pks = [ANA_PK, PRIYA_PK, SAM_PK, OMAR_PK];
        c.n = 1 + seed % 4;
        for (uint256 k; k < c.n; ++k) {
            uint256 r = uint256(keccak256(abi.encode(seed, k)));
            vm.warp(block.timestamp + 1 + r % 3 days);
            if (r % 3 == 0) {
                vm.prank(lena);
                vouch.updateTerms(venue, uint16(1 + (r >> 8) % 5_000), (r >> 32) % 20e6, 0, "");
                vm.warp(block.timestamp + 1);
            }
            _introduce(venue, pks[k], BEN_PK, uint8((r >> 64) % 2));
        }
        c.amount = bound(uint256(keccak256(abi.encode(seed, "amt"))), 1, 50_000e6);
        c.mode = uint8(uint256(keccak256(abi.encode(seed, "mode"))) % 4);
    }

    function _fuzzBundle(Case memory c) internal returns (Bundle memory b) {
        (b.o, b.osig) = _order(venue, c.amount);
        bytes32 wh;
        if (c.mode != 0) {
            address[4] memory cand = [ana, priya, sam, omar];
            uint256 m = 1 + (c.seed >> 128) % c.n;
            address[] memory refs = new address[](m);
            uint16[] memory bps = new uint16[](m);
            uint256 left = 10_000;
            for (uint256 j; j < m; ++j) {
                refs[j] = cand[j];
                bps[j] = j == m - 1
                    ? uint16(left)
                    : uint16(1 + uint256(keccak256(abi.encode(c.seed, j))) % (left - (m - j)));
                left -= bps[j];
            }
            (b.w, b.wsig) = _weights(b.o, ben, refs, bps);
            wh = _weightsHash(b.w);
            if (c.mode == 2) b.wsig = hex"1234";
            if (c.mode == 3) wh = keccak256("other");
        }
        (b.a, b.usig) = _auth(b.o, BEN_PK, wh);
        usdc.mint(ben, c.amount);
    }

    function _expected(IVouch.Quote memory q) internal view returns (Track memory t) {
        t.who = [ben, ana, priya, sam, omar, payout];
        for (uint256 i; i < 6; ++i) {
            t.before[i] = usdc.balanceOf(t.who[i]);
        }
        t.expected[0] += q.cashback;
        for (uint256 i; i < q.referrers.length; ++i) {
            t.expected[_idx(t, q.referrers[i])] += q.l1Amounts[i];
            if (q.l2Recipients[i] != address(0)) t.expected[_idx(t, q.l2Recipients[i])] += q.l2Amounts[i];
        }
        t.expected[5] += q.venueAmount;
    }
}
