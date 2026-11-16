// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {Vouch} from "../../src/Vouch.sol";
import {IVouch} from "../../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../../src/interfaces/IFiatTokenV2_2.sol";
import {MockFiatTokenV2_2} from "../mocks/MockFiatTokenV2_2.sol";

/// @notice CONTRACTS_QE's own harness (distinct from the builder's ghost-counter harness): TWO venues with different
///         terms, 8 actors who are both customers and referrers at either venue, random weights modes, blacklists,
///         terms changes and time. Every pay() is checked against (1) the previewPayment quote taken just before it,
///         (2) the eligible intro set read just before it, (3) the per-slice dust bound. Global state is checked against
///         a ledger rebuilt ONLY from Vouch's events (an indexer's view), plus introducer immutability.
contract QeLedgerHandler is Test {
    bytes32 constant T_INTRO = keccak256(
        "Intro(address venue,address referrer,uint32 termsVersion,uint8 linkType,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)"
    );
    bytes32 constant T_ACCEPT = keccak256("IntroAcceptance(bytes32 introHash,address customer,uint64 deadline)");
    bytes32 constant T_ORDER = keccak256("Order(address venue,bytes32 orderId,uint256 amount,uint64 expiresAt)");
    bytes32 constant T_WEIGHTS =
        keccak256("Weights(address venue,address customer,bytes32 orderId,address[] referrers,uint16[] bps)");
    bytes32 constant T_AUTH = keccak256(
        "PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline,address submitter)"
    );
    bytes32 constant T_RWA = 0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    bytes32 constant SETTLED_SIG =
        keccak256("PaymentSettled(address,address,bytes32,uint256,uint256,uint256,bool,bool,uint8)");
    bytes32 constant PAID_SIG = keccak256("RewardPaid(bytes32,address,address,address,uint8,uint256,address)");
    bytes32 constant RETURNED_SIG =
        keccak256("RewardReturned(bytes32,address,address,address,uint8,uint256,address,uint8)");
    bytes32 constant VERIFIED_SIG = keccak256("CustomerVerified(address,address,address,bytes32)");

    uint256 constant SIGNER_PK = 0x5161;
    uint256 constant ATTR_PK = 0xA77B;
    uint256 constant OWNER_PK = 0xB0B;

    Vouch public vouch;
    MockFiatTokenV2_2 public usdc;
    address public owner;
    address[2] public venues;
    address[2] public payouts;
    uint256[8] internal pks;
    address[8] public actors;
    bool[8] public blacklisted;
    uint256 internal seq;

    // ---- event-sourced ledger (what an indexer would know) ----
    mapping(address => uint256) public evVerified;
    mapping(address => uint256) public evRewarded;
    mapping(address => uint256) public evGross;
    mapping(address => uint256) public evPaid;
    mapping(address => uint256) public evReturned;
    mapping(address => uint256) public evL1;
    mapping(address => uint256) public evL2;
    // ---- ghosts ----
    uint256 public minted;
    mapping(address => mapping(address => address)) public frozenIntroducer;
    mapping(address => mapping(address => bool)) public frozenSet;
    uint256 public pays;
    uint256 public rewardedPays;
    uint256 public attributorPays;
    uint256 public quoteChecks;
    uint256 public frontRunsRefused;
    uint256 public selfSubmitPays;
    uint256 public zeroSubmitterRefused;
    string public violation;

    constructor() {
        vm.warp(1_800_000_000);
        usdc = new MockFiatTokenV2_2();
        vouch = new Vouch(IFiatTokenV2_2(address(usdc)));
        owner = vm.addr(OWNER_PK);
        for (uint256 i; i < 8; ++i) {
            pks[i] = 0xA001 + i;
            actors[i] = vm.addr(pks[i]);
        }
        payouts = [makeAddr("payoutA"), makeAddr("payoutB")];
        uint16[2] memory rates = [uint16(1_500), uint16(300)];
        uint256[2] memory mins = [uint256(1e6), uint256(0)];
        vm.startPrank(owner);
        for (uint256 k; k < 2; ++k) {
            venues[k] = vouch.registerVenue(
                owner,
                bytes32(k),
                IVouch.VenueConfig(payouts[k], vm.addr(SIGNER_PK), vm.addr(ATTR_PK), rates[k], mins[k], "inv"),
                0,
                ""
            );
            vouch.setSeedAmbassador(venues[k], actors[0], true, 0, "");
        }
        vouch.setSeedAmbassador(venues[0], actors[1], true, 0, "");
        vm.stopPrank();
    }

    function _fail(string memory why) internal {
        if (bytes(violation).length == 0) violation = why;
    }

    function _digest(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vouch.domainSeparator(), sh));
    }

    function _sign(uint256 pk, bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    // ============================================================ actions
    function seed(uint256 vi, uint256 ai, bool allowed) external {
        vm.prank(owner);
        vouch.setSeedAmbassador(venues[vi % 2], actors[ai % 8], allowed, 0, "");
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 4 days));
    }

    function setTerms(uint256 vi, uint16 rate, uint256 minOrder) external {
        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        vouch.updateTerms(venues[vi % 2], uint16(bound(rate, 1, 5_000)), bound(minOrder, 0, 50e6), 0, "");
    }

    function toggleBlacklist(uint256 ai) external {
        uint256 i = ai % 8;
        blacklisted[i] = !blacklisted[i];
        if (blacklisted[i]) usdc.blacklist(actors[i]);
        else usdc.unBlacklist(actors[i]);
    }

    function introduce(uint256 vi, uint256 ri, uint256 ci, bool broadcast, uint256 ttl) external {
        address v = venues[vi % 2];
        uint256 r = ri % 8;
        uint256 c = ci % 8;
        // bias toward valid pairs (coverage): first actor at/after r who may refer, first unverified customer at/after c
        for (uint256 k; k < 8 && !vouch.canRefer(v, actors[r]); ++k) {
            r = (r + 1) % 8;
        }
        for (uint256 k; k < 8 && vouch.getCustomer(v, actors[c]).verified; ++k) {
            c = (c + 1) % 8;
        }
        if (r == c) c = (c + 1) % 8;
        if (!vouch.canRefer(v, actors[r]) || vouch.getCustomer(v, actors[c]).verified) return;
        (uint32 tv,) = vouch.currentTerms(v);
        IVouch.Intro memory i = IVouch.Intro({
            venue: v,
            referrer: actors[r],
            termsVersion: tv,
            linkType: broadcast ? 1 : 0,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + bound(ttl, 1 hours, 30 days)),
            nonce: bytes32(++seq)
        });
        bytes32 ih = _digest(
            keccak256(abi.encode(T_INTRO, i.venue, i.referrer, i.termsVersion, i.linkType, i.issuedAt, i.expiresAt, i.nonce))
        );
        IVouch.IntroAcceptance memory a = IVouch.IntroAcceptance(ih, actors[c], uint64(block.timestamp + 1 hours));
        vouch.acceptIntro(i, _sign(pks[r], ih), a, _sign(pks[c], _digest(keccak256(abi.encode(T_ACCEPT, ih, a.customer, a.deadline)))));
    }

    struct P {
        address v;
        uint256 c;
        address customer;
        uint256 amount;
        uint8 mode;
        IVouch.Order o;
        bytes osig;
        IVouch.Weights w;
        bytes wsig;
        IVouch.PaymentAuth a;
        bytes usig;
        address[5] elig;
        uint256 nElig;
        uint256 maxRate;
        bool anyBlacklisted;
    }

    function pay(uint256 vi, uint256 ci, uint256 amountSeed, uint256 modeSeed) external {
        P memory p;
        p.v = venues[vi % 2];
        p.c = ci % 8;
        // half the time, steer to an unverified customer that holds intros (so rewarded first purchases are common)
        if (modeSeed % 2 == 0) {
            for (uint256 k; k < 8; ++k) {
                uint256 cand = (p.c + k) % 8;
                if (!vouch.getCustomer(p.v, actors[cand]).verified && vouch.getCustomer(p.v, actors[cand]).introCount > 0) {
                    p.c = cand;
                    break;
                }
            }
        }
        p.customer = actors[p.c];
        if (blacklisted[p.c]) return;
        p.amount = amountSeed % 4 == 0 ? bound(amountSeed, 1, 2e6) : bound(amountSeed, 1e6, 20_000e6);
        p.mode = uint8((modeSeed >> 1) % 4);
        _eligible(p);
        _build(p, modeSeed);
        IVouch.Quote memory q =
            vouch.previewPayment(p.v, p.customer, p.o.orderId, p.amount, p.w, p.wsig, p.a.weightsHash);
        // the quote assumes every transfer succeeds: compare exactly unless a quoted recipient is blacklisted
        for (uint256 k; k < q.referrers.length; ++k) {
            if (usdc.isBlacklisted(q.referrers[k]) || usdc.isBlacklisted(q.l2Recipients[k])) p.anyBlacklisted = true;
        }
        uint256[8] memory before;
        for (uint256 i; i < 8; ++i) {
            before[i] = usdc.balanceOf(actors[i]);
        }
        uint256 payout0 = usdc.balanceOf(payouts[vi % 2]);
        usdc.mint(p.customer, p.amount);
        minted += p.amount;
        // v2 (D-012): an actor front-runs with a garbage attributor sig; the submitter binding must refuse it, unchanged
        // v3 (D-519): the OTHER legitimate party is refused too (relayer on a self-submit auth, customer on a
        // relayer-bound one), and a zero-submitter auth for the same order is unpayable by either of them.
        // A breach RETURNS (no revert) so the recorded violation is not rolled back by the honest pay reverting.
        if (_probeAll(p, modeSeed)) return;
        vm.recordLogs();
        if (p.a.submitter == p.customer) {
            selfSubmitPays++;
            vm.prank(p.customer, p.customer);
        }
        vouch.pay(p.o, p.osig, p.w, p.wsig, p.a, p.usig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        pays++;
        if (q.rewarded) rewardedPays++;
        if (q.weightsMode == 1) attributorPays++;
        _ingest(logs, p, q);
        if (!p.anyBlacklisted) {
            quoteChecks++;
            for (uint256 i; i < 8; ++i) {
                uint256 exp = before[i];
                if (i == p.c) exp = exp + q.cashback; // minted amount in, amount out
                for (uint256 k; k < q.referrers.length; ++k) {
                    if (q.referrers[k] == actors[i]) exp += q.l1Amounts[k];
                    if (q.l2Recipients[k] == actors[i]) exp += q.l2Amounts[k];
                }
                if (usdc.balanceOf(actors[i]) != exp) _fail("quote != settlement (actor)");
            }
            if (usdc.balanceOf(payouts[vi % 2]) - payout0 != q.venueAmount) _fail("quote != settlement (venue)");
        }
        // introducer: set once, then frozen
        IVouch.CustomerState memory cs = vouch.getCustomer(p.v, p.customer);
        if (!frozenSet[p.v][p.customer] && cs.verified) {
            frozenSet[p.v][p.customer] = true;
            frozenIntroducer[p.v][p.customer] = cs.introducer;
            if (cs.introducer != q.introducer) _fail("introducer != quoted top referrer");
        }
    }

    function _eligible(P memory p) internal view {
        if (vouch.getCustomer(p.v, p.customer).verified) return;
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(p.v, p.customer);
        for (uint256 i; i < li.length; ++i) {
            IVouch.Terms memory t = vouch.getTerms(p.v, li[i].termsVersion);
            if (block.timestamp > li[i].expiresAt || p.amount < t.minOrder) continue;
            p.elig[p.nElig++] = li[i].referrer;
            if (t.rewardBps > p.maxRate) p.maxRate = t.rewardBps;
        }
    }

    function _build(P memory p, uint256 r) internal {
        p.o = IVouch.Order(p.v, bytes32(++seq), p.amount, uint64(block.timestamp + 600));
        p.osig = _sign(SIGNER_PK, _digest(keccak256(abi.encode(T_ORDER, p.o.venue, p.o.orderId, p.o.amount, p.o.expiresAt))));
        bytes32 wh;
        if (p.mode != 0 && p.nElig > 0) {
            uint256 m = 1 + (r >> 8) % p.nElig;
            address[] memory refs = new address[](m);
            uint16[] memory bps = new uint16[](m);
            uint256 left = 10_000;
            for (uint256 j; j < m; ++j) {
                refs[j] = p.elig[j];
                bps[j] = j == m - 1 ? uint16(left) : uint16(left / (m - j) + ((r >> (16 + j)) % 7));
                left -= bps[j];
            }
            p.w = IVouch.Weights(p.v, p.customer, p.o.orderId, refs, bps);
            wh = keccak256(
                abi.encode(T_WEIGHTS, p.v, p.customer, p.o.orderId, keccak256(abi.encodePacked(refs)), keccak256(abi.encodePacked(bps)))
            );
            p.wsig = _sign(ATTR_PK, _digest(wh));
            if (p.mode == 2) p.wsig = hex"00"; // garbage attributor signature (front-runner)
            if (p.mode == 3) p.w.bps[0] = p.w.bps[0] == 1 ? 2 : 1; // swapped weights (hash mismatch)
        }
        // v3 (D-014/D-519): half the auths name the relayer (this handler), half the customer (kill-the-backend)
        address submitter = (r >> 3) % 2 == 0 ? address(this) : p.customer;
        p.a = IVouch.PaymentAuth(p.customer, p.v, p.o.orderId, p.amount, wh, uint64(block.timestamp + 600), submitter);
        p.usig = _usdcSig(p.c, p.a);
    }

    function _nonce(IVouch.PaymentAuth memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(T_AUTH, a.customer, a.venue, a.orderId, a.amount, a.weightsHash, a.deadline, a.submitter));
    }

    function _usdcSig(uint256 c, IVouch.PaymentAuth memory a) internal view returns (bytes memory) {
        return _sign(
            pks[c],
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    usdc.DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(T_RWA, a.customer, address(vouch), a.amount, 0, uint256(a.deadline), _nonce(a)))
                )
            )
        );
    }

    function _probeAll(P memory p, uint256 modeSeed) internal returns (bool breached) {
        bool b1 = _probe(p, actors[(p.c + 1 + modeSeed % 7) % 8]);
        bool b2 = _probe(p, p.a.submitter == p.customer ? address(this) : p.customer);
        bool b3 = _probeZero(p);
        if (b1 || b2 || b3) return true;
        if (usdc.authorizationState(p.customer, _nonce(p.a))) {
            _fail("probe consumed the authorization");
            return true;
        }
        if (vouch.isOrderSettled(p.v, p.o.orderId)) {
            _fail("probe settled the order");
            return true;
        }
    }

    /// @dev `caller` (never the named submitter) races the payment with a garbage attributor sig: must be refused
    ///      with UnauthorizedSubmitter.
    function _probe(P memory p, address caller) internal returns (bool breached) {
        if (caller == p.a.submitter) _fail("probe harness: caller is the submitter");
        vm.prank(caller, caller);
        try vouch.pay(p.o, p.osig, p.w, hex"dead", p.a, p.usig) {
            _fail("front-run by a non-submitter was accepted");
            breached = true;
        } catch (bytes memory err) {
            if (bytes4(err) != IVouch.UnauthorizedSubmitter.selector) _fail("front-run refused for the wrong reason");
            frontRunsRefused++;
        }
    }

    /// @dev The same order under a validly signed submitter = 0 auth: unpayable by the relayer and the customer.
    function _probeZero(P memory p) internal returns (bool breached) {
        IVouch.PaymentAuth memory z = IVouch.PaymentAuth(p.customer, p.v, p.o.orderId, p.amount, p.a.weightsHash, p.a.deadline, address(0));
        bytes memory zsig = _usdcSig(p.c, z);
        address[2] memory callers = [address(this), p.customer];
        for (uint256 i; i < 2; ++i) {
            vm.prank(callers[i], callers[i]);
            try vouch.pay(p.o, p.osig, p.w, p.wsig, z, zsig) {
                _fail("zero-submitter auth was paid");
                return true;
            } catch (bytes memory err) {
                if (bytes4(err) != IVouch.UnauthorizedSubmitter.selector) _fail("zero submitter refused for the wrong reason");
                zeroSubmitterRefused++;
            }
        }
        if (usdc.authorizationState(p.customer, _nonce(z))) {
            _fail("zero-submitter authorization consumed");
            breached = true;
        }
    }

    struct Acc {
        uint256 out;
        uint256 paid;
        uint256 returned;
        uint256 venueAmount;
    }

    /// @dev Folds this payment's events into the indexer ledger and checks the per-payment properties.
    function _ingest(Vm.Log[] memory logs, P memory p, IVouch.Quote memory q) internal {
        Acc memory acc;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(usdc)) {
                if (
                    l.topics[0] == keccak256("Transfer(address,address,uint256)")
                        && address(uint160(uint256(l.topics[1]))) == address(vouch)
                ) acc.out += abi.decode(l.data, (uint256));
            } else if (l.emitter == address(vouch)) {
                bytes32 t0 = l.topics[0];
                if (t0 == VERIFIED_SIG) evVerified[p.v]++;
                else if (t0 == SETTLED_SIG) _onSettled(l, p, acc);
                else if (t0 == PAID_SIG) _onPaid(l, p, acc);
                else if (t0 == RETURNED_SIG) _onReturned(l, p, acc);
            }
        }
        if (acc.out != p.amount) _fail("sum of transfers out of Vouch != amount");
        if (acc.venueAmount + acc.paid != p.amount) _fail("D-504 identity");
        // dust: venueAmount - (amount - pool) - returned <= 2 per slice
        if (q.rewarded && !p.anyBlacklisted) {
            uint256 extra = acc.venueAmount + q.rewardPool - p.amount;
            if (extra > acc.returned + 2 * q.referrers.length) _fail("dust above 2 units per referrer");
        }
    }

    function _onSettled(Vm.Log memory l, P memory p, Acc memory acc) internal {
        (uint256 amount, uint256 va, uint256 pool, bool first, bool rewarded,) =
            abi.decode(l.data, (uint256, uint256, uint256, bool, bool, uint8));
        acc.venueAmount = va;
        evGross[p.v] += amount;
        if (first && rewarded) evRewarded[p.v]++;
        if (pool * 10_000 > p.amount * p.maxRate) _fail("pool > amount x max frozen rate");
    }

    function _onPaid(Vm.Log memory l, P memory p, Acc memory acc) internal {
        (, uint8 role, uint256 amt, address via) = abi.decode(l.data, (address, uint8, uint256, address));
        address to = address(uint160(uint256(l.topics[2])));
        acc.paid += amt;
        evPaid[p.v] += amt;
        if (role == 1) {
            evL1[to] += amt;
            if (!_inElig(p, to)) _fail("L1 paid to an address without an eligible intro");
        } else if (role == 2) {
            evL2[to] += amt;
            if (to != vouch.introducerOf(p.v, via)) _fail("L2 paid to someone other than the recorded introducer");
            if (to == p.customer) _fail("customer paid as its own L2");
        } else if (to != p.customer) {
            _fail("cashback to non-customer");
        }
    }

    function _onReturned(Vm.Log memory l, P memory p, Acc memory acc) internal {
        (,, uint256 amt,,) = abi.decode(l.data, (address, uint8, uint256, address, uint8));
        acc.returned += amt;
        evReturned[p.v] += amt;
    }

    function _inElig(P memory p, address a) internal pure returns (bool) {
        for (uint256 i; i < p.nElig; ++i) {
            if (p.elig[i] == a) return true;
        }
        return false;
    }

    function payoutOf(uint256 k) external view returns (address) {
        return payouts[k];
    }

    function actor(uint256 i) external view returns (address) {
        return actors[i];
    }
}

contract QeLedgerInvariantTest is Test {
    QeLedgerHandler internal h;

    function setUp() public {
        h = new QeLedgerHandler();
        targetContract(address(h));
    }

    function invariant_qe_noPerPaymentViolation() public view {
        assertEq(h.violation(), "");
    }

    function invariant_qe_vouchHoldsNothingAndConservation() public view {
        MockFiatTokenV2_2 usdc = h.usdc();
        assertEq(usdc.balanceOf(address(h.vouch())), 0);
        uint256 sum = usdc.balanceOf(h.payoutOf(0)) + usdc.balanceOf(h.payoutOf(1));
        for (uint256 i; i < 8; ++i) {
            sum += usdc.balanceOf(h.actor(i));
        }
        assertEq(sum, h.minted());
    }

    function invariant_qe_statsEqualEventSourcedLedger() public view {
        Vouch vouch = h.vouch();
        for (uint256 k; k < 2; ++k) {
            address v = h.venues(k);
            IVouch.VenueStats memory s = vouch.getVenueStats(v);
            assertEq(s.verifiedCustomers, h.evVerified(v), "verified");
            assertEq(s.rewardedCustomers, h.evRewarded(v), "rewarded");
            assertEq(s.grossVolume, h.evGross(v), "gross");
            assertEq(s.rewardsPaid, h.evPaid(v), "paid");
            assertEq(s.rewardsReturned, h.evReturned(v), "returned");
        }
        for (uint256 i; i < 8; ++i) {
            IVouch.AmbassadorStats memory a = vouch.getAmbassadorStats(h.actor(i));
            assertEq(a.l1Earned, h.evL1(h.actor(i)), "l1Earned");
            assertEq(a.l2Earned, h.evL2(h.actor(i)), "l2Earned");
        }
    }

    function invariant_qe_introducerFrozenAndRewardedImpliesVerified() public view {
        Vouch vouch = h.vouch();
        for (uint256 k; k < 2; ++k) {
            address v = h.venues(k);
            for (uint256 i; i < 8; ++i) {
                address c = h.actor(i);
                IVouch.CustomerState memory cs = vouch.getCustomer(v, c);
                if (h.frozenSet(v, c)) assertEq(cs.introducer, h.frozenIntroducer(v, c), "introducer changed");
                if (cs.rewarded) assertTrue(cs.verified);
                if (!cs.rewarded) assertEq(cs.introducer, address(0));
                assertTrue(cs.introducer != c, "own introducer");
            }
        }
    }

    function afterInvariant() external view {
        console2.log("qe pays", h.pays(), "rewarded", h.rewardedPays());
        console2.log("qe attributorPays", h.attributorPays(), "quoteChecks", h.quoteChecks());
        console2.log("qe frontRunsRefused", h.frontRunsRefused(), "selfSubmitPays", h.selfSubmitPays());
        console2.log("qe zeroSubmitterRefused", h.zeroSubmitterRefused());
    }
}
