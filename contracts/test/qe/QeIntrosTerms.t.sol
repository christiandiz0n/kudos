// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {QeBase} from "./QeBase.t.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";

/// @title Intro slots (5-cap eviction), terms racing / freezing, self-referral & sybils, introducer cycles.
contract QeIntrosTermsTest is QeBase {
    function _hasLive(address customer, address referrer) internal view returns (bool) {
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, customer);
        for (uint256 k; k < li.length; ++k) {
            if (li[k].referrer == referrer) return true;
        }
        return false;
    }

    function _seedPk(uint256 pk) internal returns (address a) {
        a = vm.addr(pk);
        _seed(venue, a);
    }

    // ================================================================== eviction
    /// @dev Nobody can push Ben's legitimate referrer out of his slots without Ben's own countersignature.
    function test_eviction_thirdPartyCannotEvictWithoutCustomerSignature() public {
        _seed(venue, sam);
        _introduce(venue, SAM_PK, BEN_PK, 0);
        for (uint256 k = 1; k <= 4; ++k) {
            _seedPk(0x8000 + k);
            vm.warp(block.timestamp + 1);
            _introduce(venue, 0x8000 + k, BEN_PK, 1);
        }
        assertEq(vouch.getLiveIntros(venue, ben).length, 5);
        // attacker (a seed) signs an intro and forges/omits Ben's acceptance
        uint256 atkPk = 0xA77AC;
        _seedPk(atkPk);
        IVouch.Intro memory i = _introStruct(venue, atkPk, 1, bytes32("evict"));
        (IVouch.IntroAcceptance memory a,) = _acceptance(i, BEN_PK);
        bytes memory attackerSig = _sign(atkPk, _digest(keccak256(abi.encode(T_ACCEPT, a.introHash, a.customer, a.deadline))));
        bytes memory atkRefSig = _sign(atkPk, _introHash(i));
        vm.expectRevert(IVouch.InvalidCustomerSignature.selector);
        vouch.acceptIntro(i, atkRefSig, a, attackerSig);
        assertTrue(_hasLive(ben, sam), "Sam's slot intact");
    }

    /// @dev An expired slot is recycled before any live intro is evicted.
    function test_eviction_expiredSlotRecycledBeforeLiveEviction() public {
        _seed(venue, sam);
        IVouch.Intro memory shortIntro = _introStruct(venue, SAM_PK, 0, bytes32("short"));
        shortIntro.expiresAt = uint64(block.timestamp + 1 hours);
        _acceptSigned(shortIntro, SAM_PK, BEN_PK);
        address[4] memory others;
        for (uint256 k; k < 4; ++k) {
            others[k] = _seedPk(0x8100 + k);
            _introduce(venue, 0x8100 + k, BEN_PK, 1);
        }
        vm.warp(block.timestamp + 2 hours); // Sam's intro expired, the others live (7 days)
        _seedPk(0x8200);
        _introduce(venue, 0x8200, BEN_PK, 0);
        for (uint256 k; k < 4; ++k) {
            assertTrue(_hasLive(ben, others[k]), "no live intro evicted");
        }
        assertFalse(_hasLive(ben, sam));
    }

    /// LIMIT (Low, part of QE-C-07): when several of the customer's acceptances are pending at once (e.g. they scanned
    /// 6 codes), whoever submits them chooses the order and therefore WHICH referrer is evicted (oldest acceptedAt,
    /// ties → lower index). Shown: same 6 signed acceptances, two submission orders, two different victims.
    function test_LIMIT_submitterChoosesWhichReferrerIsEvicted() public {
        IVouch.Intro[6] memory intros;
        bytes[6] memory rsigs;
        IVouch.IntroAcceptance[6] memory accs;
        bytes[6] memory csigs;
        for (uint256 k; k < 6; ++k) {
            _seedPk(0x8300 + k);
            intros[k] = _introStruct(venue, 0x8300 + k, 1, bytes32(k));
            rsigs[k] = _sign(0x8300 + k, _introHash(intros[k]));
            (accs[k], csigs[k]) = _acceptance(intros[k], BEN_PK);
        }
        uint256 snap = vm.snapshotState();
        for (uint256 k; k < 6; ++k) {
            vouch.acceptIntro(intros[k], rsigs[k], accs[k], csigs[k]);
        }
        assertFalse(_hasLive(ben, vm.addr(0x8300)), "order A evicts referrer #0");
        vm.revertToState(snap);
        for (uint256 j; j < 6; ++j) {
            uint256 k = (j + 1) % 6; // submit #1..#5 first, #0 last
            vouch.acceptIntro(intros[k], rsigs[k], accs[k], csigs[k]);
        }
        assertTrue(_hasLive(ben, vm.addr(0x8300)), "order B keeps #0");
        assertFalse(_hasLive(ben, vm.addr(0x8301)), "order B evicts #1 instead");
    }

    // ================================================================== terms
    /// @dev Invariant 8: terms can't be changed retroactively for an existing intro (rate up or down, minOrder up).
    function test_terms_frozenAgainstLaterUpdates() public {
        _twoVerifiedReferrers();
        _introduce(venue, ANA_PK, BEN_PK, 0); // frozen v1: 15%, min $5
        vm.warp(block.timestamp + 1);
        vm.prank(lena);
        vouch.updateTerms(venue, 5_000, 100e6, 0, ""); // 50%, min $100
        vm.warp(block.timestamp + 1);
        vm.prank(lena);
        vouch.updateTerms(venue, 1, 100e6, 0, ""); // 0.01%
        Bundle memory b = _bundle(venue, BEN_PK, 10e6, _arr(ana), _bps(10_000));
        IVouch.Quote memory q = vouch.previewPayment(venue, ben, b.o.orderId, 10e6, b.w, b.wsig, b.a.weightsHash);
        assertEq(q.termsVersions[0], 1);
        _exec(b);
        assertEq(q.rewardPool, 1_500_000, "15% of $10 under frozen v1, below the new $100 min");
        assertTrue(vouch.getCustomer(venue, ben).rewarded);
    }

    /// @dev Same-second race: an intro issued at t with version v becomes unacceptable if updateTerms lands at t
    ///      (effectiveAt(v+1) <= issuedAt). Clean revert, re-issue with v+1 works.
    function test_terms_sameSecondUpdateInvalidatesIntroCleanly() public {
        _seed(venue, sam);
        IVouch.Intro memory i = _introStruct(venue, SAM_PK, 0, bytes32("race"));
        vm.prank(lena);
        vouch.updateTerms(venue, 1_000, MIN_ORDER, 0, "");
        (IVouch.IntroAcceptance memory a, bytes memory csig) = _acceptance(i, BEN_PK);
        bytes memory rsig = _sign(SAM_PK, _introHash(i));
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(i, rsig, a, csig);
        i.termsVersion = 2;
        _acceptSigned(i, SAM_PK, BEN_PK);
        // two updates in the same second: v3 is never referencable, v4 is in force
        vm.startPrank(lena);
        vouch.updateTerms(venue, 1_100, MIN_ORDER, 0, "");
        vouch.updateTerms(venue, 1_200, MIN_ORDER, 0, "");
        vm.stopPrank();
        _seed(venue, omar);
        IVouch.Intro memory j = _introStruct(venue, OMAR_PK, 1, bytes32("v3"));
        j.termsVersion = 3;
        (a, csig) = _acceptance(j, BEN_PK);
        rsig = _sign(OMAR_PK, _introHash(j));
        vm.expectRevert(IVouch.TermsNotInForce.selector);
        vouch.acceptIntro(j, rsig, a, csig);
    }

    /// LIMIT (Low, QE-C-05): D-505 says "a referrer can't pick a superseded, better version", but `issuedAt` is chosen
    /// by the referrer. After the venue CUTS its rate (15% → 1%), a referrer can sign a NEW intro back-dated to before
    /// the cut, naming v1, and it is accepted at 15% for up to 30 days after the cut (bounded by MAX_INTRO_TTL).
    function test_LIMIT_backdatedIssuedAtSelectsSupersededBetterTerms() public {
        _seed(venue, sam);
        uint64 beforeCut = uint64(block.timestamp);
        vm.warp(block.timestamp + 10 days);
        vm.prank(lena);
        vouch.updateTerms(venue, 100, MIN_ORDER, 0, ""); // 1% from now on
        vm.warp(block.timestamp + 5 days);
        // Sam signs today, but claims issuedAt = before the cut and v1
        IVouch.Intro memory i = IVouch.Intro({
            venue: venue,
            referrer: sam,
            termsVersion: 1,
            linkType: 0,
            issuedAt: beforeCut,
            expiresAt: beforeCut + 30 days,
            nonce: bytes32("backdated")
        });
        _acceptSigned(i, SAM_PK, BEN_PK);
        Bundle memory b = _bundle(venue, BEN_PK, 100e6, _arr(sam), _bps(10_000));
        _exec(b);
        assertEq(vouch.getVenueStats(venue).rewardsPaid, 15e6 - 3e6, "paid at the superseded 15% (minus returned L2)");
    }

    // ================================================================== self-referral / sybils
    /// LIMIT (Info, sybil): Ben controls a second address. It makes a plain first purchase (now "verified"), refers Ben,
    /// and Ben's first purchase pays cashback (25%) + L1 (55%) = 80% of the pool to Ben's cluster; a third sybil as
    /// the second address's introducer lifts that to 100%. Cost: one real purchase per sybil. Unfixable on-chain
    /// without identity; the venue's rewardBps bounds the "discount".
    function test_LIMIT_sybilSecondAddressCapturesWholePool() public {
        uint256 ben2Pk = 0xBE72;
        uint256 ben3Pk = 0xBE73;
        _seed(venue, vm.addr(ben3Pk)); // or: ben3 verified via its own plain purchase
        _introduce(venue, ben3Pk, ben2Pk, 0);
        _pay(venue, ben2Pk, 5e6, _arr(vm.addr(ben3Pk)), _bps(10_000));
        _introduce(venue, ben2Pk, BEN_PK, 0);
        uint256 cluster0 = usdc.balanceOf(vm.addr(ben2Pk)) + usdc.balanceOf(vm.addr(ben3Pk));
        Bundle memory b = _bundle(venue, BEN_PK, 100e6, _arr(vm.addr(ben2Pk)), _bps(10_000));
        _exec(b);
        uint256 cluster = usdc.balanceOf(ben) + usdc.balanceOf(vm.addr(ben2Pk)) + usdc.balanceOf(vm.addr(ben3Pk))
            - cluster0;
        assertEq(cluster, 15e6, "the whole 15% pool went to addresses Ben controls");
    }

    // ================================================================== cycles
    /// @dev Ben (seed) introduced both Ana and Priya; both refer Ben; Ben pays: both L2 shares would go to Ben himself
    ///      → both returned (SELF_PAYMENT), Ben gets only cashback, Σ exact.
    function test_cycle_customerIsL2OfEveryReferrer() public {
        _seed(venue, ben);
        _introduce(venue, BEN_PK, ANA_PK, 0);
        _pay(venue, ANA_PK, 10e6, _arr(ben), _bps(10_000));
        _introduce(venue, BEN_PK, PRIYA_PK, 0);
        _pay(venue, PRIYA_PK, 10e6, _arr(ben), _bps(10_000));
        _introduce(venue, ANA_PK, BEN_PK, 0);
        _introduce(venue, PRIYA_PK, BEN_PK, 1);
        uint256 ben0 = usdc.balanceOf(ben);
        Bundle memory b = _bundle(venue, BEN_PK, 12e6, _arr(ana, priya), _bps(5_000, 5_000));
        vm.recordLogs();
        _exec(b);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countReturned(logs), 2, "both L2 shares returned");
        assertEq(usdc.balanceOf(ben) - ben0, 450_000, "Ben: cashback only");
        (uint256 out,) = _sumOutOfVouch(logs);
        assertEq(out, 12e6);
    }

    /// @dev A→B→C→A three-cycle: A (seed) refers B, B refers C, C refers A. A's purchase pays L1 to C and L2 to B
    ///      (introducer of C) — legitimate, nobody paid twice, no self-payment.
    function test_cycle_threeCycleIsWellFormed() public {
        _seed(venue, sam); // A = Sam (seed, unverified)
        _introduce(venue, SAM_PK, ANA_PK, 0);
        _pay(venue, ANA_PK, 10e6, _arr(sam), _bps(10_000)); // B = Ana, introducer Sam
        _introduce(venue, ANA_PK, PRIYA_PK, 0);
        _pay(venue, PRIYA_PK, 10e6, _arr(ana), _bps(10_000)); // C = Priya, introducer Ana
        _introduce(venue, PRIYA_PK, SAM_PK, 0);
        uint256 ana0 = usdc.balanceOf(ana);
        uint256 priya0 = usdc.balanceOf(priya);
        _pay(venue, SAM_PK, 10e6, _arr(priya), _bps(10_000));
        assertEq(usdc.balanceOf(priya) - priya0, 825_000, "C: L1");
        assertEq(usdc.balanceOf(ana) - ana0, 300_000, "B: L2 via C");
        assertEq(vouch.introducerOf(venue, sam), priya);
        assertEq(vouch.introducerOf(venue, ana), sam, "frozen, unchanged by the cycle");
    }
}
