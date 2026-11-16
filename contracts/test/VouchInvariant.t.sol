// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {Vouch} from "../src/Vouch.sol";
import {IVouch} from "../src/interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "../src/interfaces/IFiatTokenV2_2.sol";
import {MockFiatTokenV2_2} from "./mocks/MockFiatTokenV2_2.sol";

/// @notice Random sequences of seed / intro / pay / terms / time / blacklist / replay actions over 8 actors.
///         Every pay() is checked in-line (exact sum, cap, legit recipients); global invariants below.
contract VouchHandler is Test {
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
    bytes32 internal constant T_RWA = 0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    bytes32 internal constant SETTLED_SIG = keccak256(
        "PaymentSettled(address,address,bytes32,uint256,uint256,uint256,bool,bool,uint8)"
    );
    bytes32 internal constant PAID_SIG = keccak256("RewardPaid(bytes32,address,address,address,uint8,uint256,address)");
    bytes32 internal constant RETURNED_SIG =
        keccak256("RewardReturned(bytes32,address,address,address,uint8,uint256,address,uint8)");

    Vouch public vouch;
    MockFiatTokenV2_2 public usdc;
    address public venue;
    address public owner;
    address public payout;
    uint256 internal signerPk;
    uint256 internal attrPk;
    uint256[8] internal pks;

    // ghosts
    uint256 public ghostMinted;
    uint256 public ghostGross;
    uint256 public ghostPays;
    uint256 public ghostRewardedPays;
    uint256 public ghostFallbackPays;
    uint256 public ghostIntros;
    uint256 public ghostReplaysTried;
    mapping(address => uint256) public rewardedCount;
    string public violation; // empty = none

    bytes internal lastPayCalldata;
    bytes internal lastIntroCalldata;
    uint256 internal seq;

    constructor(Vouch v, MockFiatTokenV2_2 u, address venue_, address owner_, address payout_, uint256 sPk, uint256 aPk) {
        vouch = v;
        usdc = u;
        venue = venue_;
        owner = owner_;
        payout = payout_;
        signerPk = sPk;
        attrPk = aPk;
        for (uint256 i; i < 8; ++i) {
            pks[i] = 0xF00 + i;
        }
    }

    function actor(uint256 i) public view returns (address) {
        return vm.addr(pks[i % 8]);
    }

    function _flag(string memory why) internal {
        if (bytes(violation).length == 0) violation = why;
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vouch.domainSeparator(), sh));
    }

    // ------------------------------------------------------------------ actions
    function seed(uint256 who, bool allowed) external {
        vm.prank(owner);
        vouch.setSeedAmbassador(venue, actor(who), allowed, 0, "");
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 days));
    }

    function updateTerms(uint256 rate, uint256 minOrder) external {
        vm.warp(block.timestamp + 1);
        vm.prank(owner);
        vouch.updateTerms(venue, uint16(bound(rate, 1, 5_000)), bound(minOrder, 0, 50e6), 0, "");
    }

    function blacklist(uint256 who, bool on) external {
        if (on) usdc.blacklist(actor(who));
        else usdc.unBlacklist(actor(who));
    }

    function introduce(uint256 ref, uint256 cust, bool broadcast, uint256 ttl) external {
        uint256 rpk = pks[ref % 8];
        uint256 cpk = pks[cust % 8];
        (uint32 tv,) = vouch.currentTerms(venue);
        IVouch.Intro memory i = IVouch.Intro({
            venue: venue,
            referrer: vm.addr(rpk),
            termsVersion: tv,
            linkType: broadcast ? 1 : 0,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + bound(ttl, 1 hours, 30 days)),
            nonce: bytes32(++seq)
        });
        bytes32 ih = _digest(
            keccak256(
                abi.encode(T_INTRO, i.venue, i.referrer, i.termsVersion, i.linkType, i.issuedAt, i.expiresAt, i.nonce)
            )
        );
        IVouch.IntroAcceptance memory a =
            IVouch.IntroAcceptance({introHash: ih, customer: vm.addr(cpk), deadline: uint64(block.timestamp + 1 hours)});
        bytes memory cd = abi.encodeCall(
            vouch.acceptIntro,
            (i, _sign(rpk, ih), a, _sign(cpk, _digest(keccak256(abi.encode(T_ACCEPT, ih, a.customer, a.deadline)))))
        );
        (bool ok,) = address(vouch).call(cd);
        if (ok) {
            ghostIntros++;
            lastIntroCalldata = cd;
        }
    }

    struct Ctx {
        address customer;
        uint256 cpk;
        uint256 amount;
        address[5] eligible;
        uint256 k;
        uint256 maxRate;
        bool wasVerified;
        uint256 payout0;
    }

    function pay(uint256 cust, uint256 amount, uint256 wseed, uint8 mode) external {
        Ctx memory c = _ctx(cust, amount);
        bytes memory cd = _buildPay(c, wseed, mode);
        usdc.mint(c.customer, c.amount);
        ghostMinted += c.amount;
        c.payout0 = usdc.balanceOf(payout);

        vm.recordLogs();
        (bool ok, bytes memory ret) = address(vouch).call(cd);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        if (!ok) {
            // the only legitimate reasons: a blacklisted customer/payout at USDC
            if (!usdc.isBlacklisted(c.customer) && !usdc.isBlacklisted(payout)) {
                _flag("pay reverted unexpectedly");
                emit log_bytes(ret);
            }
            return;
        }
        lastPayCalldata = cd;
        ghostPays++;
        ghostGross += c.amount;
        _check(c, logs);
    }

    function _ctx(uint256 cust, uint256 amount) internal view returns (Ctx memory c) {
        c.cpk = pks[cust % 8];
        c.customer = vm.addr(c.cpk);
        c.amount = bound(amount, 1, 100_000e6);
        c.wasVerified = vouch.getCustomer(venue, c.customer).verified;
        IVouch.LiveIntro[] memory li = vouch.getLiveIntros(venue, c.customer);
        for (uint256 i; i < li.length; ++i) {
            if (block.timestamp > li[i].expiresAt) continue;
            IVouch.Terms memory t = vouch.getTerms(venue, li[i].termsVersion);
            if (c.amount < t.minOrder) continue;
            c.eligible[c.k++] = li[i].referrer;
            if (t.rewardBps > c.maxRate) c.maxRate = t.rewardBps;
        }
    }

    function _buildPay(Ctx memory c, uint256 wseed, uint8 mode) internal returns (bytes memory) {
        IVouch.Order memory o = IVouch.Order({
            venue: venue,
            orderId: bytes32(++seq),
            amount: c.amount,
            expiresAt: uint64(block.timestamp + 10 minutes)
        });
        bytes memory osig =
            _sign(signerPk, _digest(keccak256(abi.encode(T_ORDER, o.venue, o.orderId, o.amount, o.expiresAt))));
        (IVouch.Weights memory w, bytes memory wsig) = _weights(c, o, wseed, mode);
        IVouch.PaymentAuth memory a = IVouch.PaymentAuth(
            c.customer, venue, o.orderId, c.amount, mode % 3 == 0 ? bytes32(0) : _wh(w), o.expiresAt
        );
        bytes memory usig = _usig(c.cpk, a);
        return abi.encodeCall(vouch.pay, (o, osig, w, wsig, a, usig));
    }

    function _weights(Ctx memory c, IVouch.Order memory o, uint256 wseed, uint8 mode)
        internal
        view
        returns (IVouch.Weights memory w, bytes memory wsig)
    {
        uint256 n = bound(wseed, 1, 5);
        address[] memory refs = new address[](n);
        uint16[] memory bps = new uint16[](n);
        if (mode % 3 == 1 && c.k > 0) {
            // valid attributor weights over the eligible intros
            n = c.k;
            refs = new address[](n);
            bps = new uint16[](n);
            for (uint256 i; i < n; ++i) {
                refs[i] = c.eligible[i];
                bps[i] = uint16(10_000 / n);
            }
            bps[0] += uint16(10_000 - (10_000 / n) * n);
        } else {
            // random (mostly invalid) weights over random actors
            for (uint256 i; i < n; ++i) {
                refs[i] = actor(uint256(keccak256(abi.encode(wseed, i))));
                bps[i] = uint16(uint256(keccak256(abi.encode(wseed, i, "b"))) % 10_001);
            }
        }
        w = IVouch.Weights({venue: venue, customer: c.customer, orderId: o.orderId, referrers: refs, bps: bps});
        wsig = _sign(attrPk, _digest(_wh(w)));
    }

    function _wh(IVouch.Weights memory w) internal pure returns (bytes32) {
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

    function _usig(uint256 cpk, IVouch.PaymentAuth memory a) internal view returns (bytes memory) {
        bytes32 nonce = keccak256(abi.encode(T_AUTH, a.customer, a.venue, a.orderId, a.amount, a.weightsHash, a.deadline));
        bytes32 sh = keccak256(abi.encode(T_RWA, a.customer, address(vouch), a.amount, 0, uint256(a.deadline), nonce));
        return _sign(cpk, keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), sh)));
    }

    function _isEligible(Ctx memory c, address a) internal pure returns (bool) {
        for (uint256 i; i < c.k; ++i) {
            if (c.eligible[i] == a) return true;
        }
        return false;
    }

    function _check(Ctx memory c, Vm.Log[] memory logs) internal {
        uint256 amount = c.amount;
        uint256 venueAmount;
        uint256 paid;
        uint256 all;
        bool rewarded;
        uint8 mode;
        for (uint256 j; j < logs.length; ++j) {
            if (logs[j].emitter != address(vouch)) continue;
            bytes32 t0 = logs[j].topics[0];
            if (t0 == SETTLED_SIG) {
                (, venueAmount,,, rewarded, mode) =
                    abi.decode(logs[j].data, (uint256, uint256, uint256, bool, bool, uint8));
            } else if (t0 == PAID_SIG || t0 == RETURNED_SIG) {
                address recipient = address(uint160(uint256(logs[j].topics[2])));
                (, uint8 role, uint256 amt, address via) = abi.decode(logs[j].data, (address, uint8, uint256, address));
                all += amt;
                if (t0 == PAID_SIG) {
                    paid += amt;
                    if (role == 0 && recipient != c.customer) _flag("cashback to non-customer");
                    if (role == 1 && !_isEligible(c, recipient)) _flag("L1 to non-holder");
                    if (role == 2) {
                        if (!_isEligible(c, via)) _flag("L2 via non-holder");
                        if (recipient != vouch.introducerOf(venue, via)) _flag("L2 to non-introducer");
                        if (recipient == c.customer) _flag("L2 self payment");
                    }
                }
            }
        }
        if (venueAmount + paid != amount) _flag("sum != amount");
        if (usdc.balanceOf(payout) - c.payout0 != venueAmount) _flag("payout != venueAmount");
        if (all > amount * c.maxRate / 10_000) _flag("reward above frozen cap");
        if (c.wasVerified && rewarded) _flag("repeat purchase rewarded");
        if (!c.wasVerified && rewarded != (c.k > 0)) _flag("rewarded != has eligible intro");
        if (rewarded) {
            rewardedCount[c.customer]++;
            ghostRewardedPays++;
            if (mode != 1) ghostFallbackPays++;
        }
        if (usdc.balanceOf(address(vouch)) != 0) _flag("contract holds funds");
    }

    /// @dev Re-submitting the last successful pay / acceptIntro must always revert.
    function replay(bool intro) external {
        bytes memory cd = intro ? lastIntroCalldata : lastPayCalldata;
        if (cd.length == 0) return;
        ghostReplaysTried++;
        (bool ok,) = address(vouch).call(cd);
        if (ok) _flag(intro ? "intro replay succeeded" : "pay replay succeeded");
    }
}

contract VouchInvariantTest is Test {
    Vouch internal vouch;
    MockFiatTokenV2_2 internal usdc;
    VouchHandler internal handler;
    address internal venue;
    address internal payout = makeAddr("payout");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new MockFiatTokenV2_2();
        vouch = new Vouch(IFiatTokenV2_2(address(usdc)));
        uint256 ownerPk = 0x0E;
        uint256 signerPk = 0x51;
        uint256 attrPk = 0xA7;
        address owner = vm.addr(ownerPk);
        vm.prank(owner);
        venue = vouch.registerVenue(
            owner,
            bytes32("inv"),
            IVouch.VenueConfig(payout, vm.addr(signerPk), vm.addr(attrPk), 1_500, 1e6, "ipfs://inv"),
            0,
            ""
        );
        handler = new VouchHandler(vouch, usdc, venue, owner, payout, signerPk, attrPk);
        // two seed ambassadors to bootstrap the graph
        vm.startPrank(owner);
        vouch.setSeedAmbassador(venue, handler.actor(0), true, 0, "");
        vouch.setSeedAmbassador(venue, handler.actor(1), true, 0, "");
        vm.stopPrank();
        targetContract(address(handler));
    }

    function invariant_noPerPaymentViolation() public view {
        assertEq(handler.violation(), "");
    }

    function invariant_conservation() public view {
        uint256 sum = usdc.balanceOf(payout) + usdc.balanceOf(address(vouch));
        for (uint256 i; i < 8; ++i) {
            sum += usdc.balanceOf(handler.actor(i));
        }
        assertEq(sum, handler.ghostMinted(), "USDC only moves between actors and the venue");
        assertEq(usdc.balanceOf(address(vouch)), 0);
    }

    function invariant_atMostOneRewardPerCustomer() public view {
        for (uint256 i; i < 8; ++i) {
            assertLe(handler.rewardedCount(handler.actor(i)), 1);
            IVouch.CustomerState memory cs = vouch.getCustomer(venue, handler.actor(i));
            if (cs.rewarded) assertTrue(cs.verified);
            if (!cs.rewarded) assertEq(cs.introducer, address(0));
        }
    }

    function invariant_statsMatchGhosts() public view {
        IVouch.VenueStats memory s = vouch.getVenueStats(venue);
        assertEq(s.grossVolume, handler.ghostGross());
        assertEq(s.rewardedCustomers, handler.ghostRewardedPays());
        assertLe(s.rewardedCustomers, s.verifiedCustomers);
    }

    /// @dev Coverage evidence per run (visible with -vv): how many pays/rewards/fallbacks/intros/replays happened.
    function afterInvariant() external view {
        console2.log("pays", handler.ghostPays(), "rewarded", handler.ghostRewardedPays());
        console2.log("fallback", handler.ghostFallbackPays(), "intros", handler.ghostIntros());
        console2.log("replaysTried", handler.ghostReplaysTried());
    }
}
