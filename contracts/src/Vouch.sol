// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IVouch} from "./interfaces/IVouch.sol";
import {IFiatTokenV2_2} from "./interfaces/IFiatTokenV2_2.sol";
import {VouchHash} from "./libraries/VouchHash.sol";
import {VouchSplit} from "./libraries/VouchSplit.sol";

/// @title Vouch — pay-per-verified-customer referral payments in USDC (Arc Testnet).
/// @notice A customer's USDC payment to a venue is split atomically: reward pool = amount × frozen rewardBps;
///         25% cashback to the customer, 55% to the direct referrers (L1) by weight, 20% to those referrers'
///         introducers (L2); the rest (plus anything undistributable) to the venue payout. Σ transfers == amount.
/// @dev No owner/admin, no upgradeability, non-payable. Every user action is relayable: users only sign.
///      Design decisions: AGENTS/DECISIONS.md D-501..D-510. Tests: contracts/test/Vouch*.t.sol.
contract Vouch is IVouch, EIP712, Nonces, ReentrancyGuardTransient {
    // ------------------------------------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------------------------------------

    uint256 public constant BPS = 10_000;
    uint256 public constant CASHBACK_BPS = 2_500;
    uint256 public constant L1_BPS = 5_500;
    uint256 public constant L2_BPS = 2_000;
    uint16 public constant MAX_REWARD_BPS = 5_000;
    uint256 public constant MAX_MIN_ORDER = 10_000e6; // $10,000
    uint256 public constant MAX_ORDER_AMOUNT = 1_000_000e6; // $1,000,000 (keeps all math far from overflow)
    uint256 public constant MAX_REFERRERS = 5;
    uint256 public constant PER_REFERRER_CAP_BPS = 8_000;
    uint256 public constant MAX_LIVE_INTROS = 5;
    uint64 public constant MAX_INTRO_TTL = 30 days;
    uint64 public constant MAX_CLOCK_SKEW = 15 minutes;

    // Enum-like codes are internal to stay under the EIP-170 size limit; mirrored in
    // packages/shared/src/abi/vouchConstants.ts (WEIGHTS_MODE, RETURN_REASON, INTRO_DROP_REASON) and constants.ts.
    uint8 internal constant LINK_PERSONAL = 0;
    uint8 internal constant LINK_BROADCAST = 1;

    uint8 internal constant ROLE_CASHBACK = 0;
    uint8 internal constant ROLE_L1 = 1;
    uint8 internal constant ROLE_L2 = 2;

    uint8 internal constant RETURN_NO_INTRODUCER = 0;
    uint8 internal constant RETURN_SELF_PAYMENT = 1;
    uint8 internal constant RETURN_TRANSFER_FAILED = 2;

    uint8 internal constant DROP_REPLACED = 0;
    uint8 internal constant DROP_EXPIRED = 1;
    uint8 internal constant DROP_EVICTED = 2;

    /// @notice PaymentSettled.weightsMode. NONE = not a rewarded purchase.
    uint8 internal constant WEIGHTS_NONE = 0;
    uint8 internal constant WEIGHTS_ATTRIBUTOR = 1;
    uint8 internal constant WEIGHTS_FALLBACK_NOT_COMMITTED = 2;
    uint8 internal constant WEIGHTS_FALLBACK_HASH_MISMATCH = 3;
    uint8 internal constant WEIGHTS_FALLBACK_INVALID = 4;
    uint8 internal constant WEIGHTS_FALLBACK_BAD_SIGNATURE = 5;

    bytes32 public constant INTRO_TYPEHASH = VouchHash.INTRO_TYPEHASH;
    bytes32 public constant INTRO_ACCEPTANCE_TYPEHASH = VouchHash.INTRO_ACCEPTANCE_TYPEHASH;
    bytes32 public constant ORDER_TYPEHASH = VouchHash.ORDER_TYPEHASH;
    bytes32 public constant WEIGHTS_TYPEHASH = VouchHash.WEIGHTS_TYPEHASH;
    bytes32 public constant PAYMENT_AUTH_TYPEHASH = VouchHash.PAYMENT_AUTH_TYPEHASH;
    bytes32 public constant REGISTER_VENUE_TYPEHASH = VouchHash.REGISTER_VENUE_TYPEHASH;
    bytes32 public constant UPDATE_TERMS_TYPEHASH = VouchHash.UPDATE_TERMS_TYPEHASH;
    bytes32 public constant SET_VENUE_KEYS_TYPEHASH = VouchHash.SET_VENUE_KEYS_TYPEHASH;
    bytes32 public constant SET_SEED_AMBASSADOR_TYPEHASH = VouchHash.SET_SEED_AMBASSADOR_TYPEHASH;

    /// @notice USDC (FiatTokenV2_2). Arc Testnet: 0x3600000000000000000000000000000000000000 (6 decimals).
    IFiatTokenV2_2 public immutable USDC;

    // ------------------------------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------------------------------

    mapping(address venue => Venue) private _venues;
    mapping(address venue => mapping(uint32 version => Terms)) private _terms;
    mapping(address venue => mapping(address account => bool)) private _seed;
    mapping(address venue => mapping(address customer => CustomerState)) private _customers;
    mapping(address venue => mapping(address customer => LiveIntro[5])) private _intros;
    /// @dev personal: key = introHash; broadcast: key = keccak256(abi.encode(introHash, customer)).
    mapping(bytes32 key => bool) private _introUsed;
    mapping(address venue => mapping(bytes32 orderId => bool)) private _settled;
    mapping(address venue => VenueStats) private _venueStats;
    mapping(address ambassador => AmbassadorStats) private _ambassadorStats;
    mapping(address ambassador => mapping(address venue => bool)) private _ambassadorAtVenue;

    // ------------------------------------------------------------------------------------------------
    // In-memory working types
    // ------------------------------------------------------------------------------------------------

    /// @dev Eligible intros of (customer, venue) for one payment: live, unexpired, amount >= frozen minOrder.
    struct Eligible {
        uint256 k;
        address[5] referrer;
        uint8[5] linkType;
        uint64[5] acceptedAt;
        uint32[5] termsVersion;
        uint256[5] rate;
    }

    /// @dev The reward plan of one payment (all zero for a plain payment).
    struct Plan {
        bool first;
        bool rewarded;
        uint8 weightsMode;
        uint256 n;
        uint256 top;
        uint256 pool;
        address[5] referrers;
        uint256[5] bps;
        uint256[5] rate;
        uint32[5] termsVersion;
        uint256[5] slice;
        address[5] l2To; // stored introducer of referrers[i] at this venue (0 = none)
    }

    struct Payout {
        address to;
        address via;
        uint8 role;
        bool paid;
        uint8 reason; // RETURN_* when !paid
        uint256 amount;
    }

    constructor(IFiatTokenV2_2 usdc) EIP712("Vouch", "1") {
        if (address(usdc) == address(0)) revert ZeroAddress();
        USDC = usdc;
    }

    // ================================================================================================
    // Venues (D-501: venue id = keccak(owner, salt); owner acts directly or via an owner-signed EIP-712 message)
    // ================================================================================================

    /// @notice Register a venue. Called by `owner` directly (ownerSig ignored) or by anyone (the relayer) with the
    ///         owner's `RegisterVenue` signature (consumes `nonces(owner)`).
    /// @return venue The venue id = address(uint160(uint256(keccak256(abi.encode(owner, salt))))).
    function registerVenue(
        address owner,
        bytes32 salt,
        VenueConfig calldata cfg,
        uint64 deadline,
        bytes calldata ownerSig
    ) external returns (address venue) {
        if (owner == address(0)) revert ZeroAddress();
        if (msg.sender != owner) {
            _checkOwnerSig(owner, VouchHash.registerVenue(owner, salt, cfg, _useNonce(owner), deadline), deadline, ownerSig);
        }
        venue = computeVenueId(owner, salt);
        Venue storage v = _venues[venue];
        if (v.owner != address(0)) revert VenueAlreadyRegistered();
        _checkKeys(cfg.payout, cfg.signer, cfg.attributor);
        v.owner = owner;
        v.registeredAt = uint64(block.timestamp);
        v.payout = cfg.payout;
        v.signer = cfg.signer;
        v.attributor = cfg.attributor;
        emit VenueRegistered(venue, owner, salt, cfg.payout, cfg.signer, cfg.attributor, cfg.metadataURI);
        _pushTerms(venue, v, cfg.rewardBps, cfg.minOrder);
    }

    /// @notice Append a new immutable terms version (termsVersion + 1). Existing intros keep their frozen version.
    function updateTerms(address venue, uint16 rewardBps, uint256 minOrder, uint64 deadline, bytes calldata ownerSig)
        external
    {
        Venue storage v = _venue(venue);
        address owner = v.owner;
        if (msg.sender != owner) {
            _checkOwnerSig(
                owner, VouchHash.updateTerms(venue, rewardBps, minOrder, _useNonce(owner), deadline), deadline, ownerSig
            );
        }
        _pushTerms(venue, v, rewardBps, minOrder);
    }

    /// @notice Rotate the payout address, the order-signer key and the attributor key.
    function setKeys(
        address venue,
        address payout,
        address signer,
        address attributor,
        uint64 deadline,
        bytes calldata ownerSig
    ) external {
        Venue storage v = _venue(venue);
        address owner = v.owner;
        if (msg.sender != owner) {
            _checkOwnerSig(
                owner,
                VouchHash.setVenueKeys(venue, payout, signer, attributor, _useNonce(owner), deadline),
                deadline,
                ownerSig
            );
        }
        _checkKeys(payout, signer, attributor);
        v.payout = payout;
        v.signer = signer;
        v.attributor = attributor;
        emit VenueKeysUpdated(venue, payout, signer, attributor);
    }

    /// @notice Allow (or disallow) `ambassador` to refer this venue without a prior purchase (bootstrap, D-507).
    function setSeedAmbassador(address venue, address ambassador, bool allowed, uint64 deadline, bytes calldata ownerSig)
        external
    {
        Venue storage v = _venue(venue);
        address owner = v.owner;
        if (msg.sender != owner) {
            _checkOwnerSig(
                owner,
                VouchHash.setSeedAmbassador(venue, ambassador, allowed, _useNonce(owner), deadline),
                deadline,
                ownerSig
            );
        }
        if (ambassador == address(0)) revert ZeroAddress();
        _seed[venue][ambassador] = allowed;
        emit SeedAmbassadorSet(venue, ambassador, allowed);
    }

    // ================================================================================================
    // Intros (D-505)
    // ================================================================================================

    /// @notice Record a referrer-signed Intro countersigned by the customer. Relayable by anyone.
    function acceptIntro(
        Intro calldata intro,
        bytes calldata referrerSig,
        IntroAcceptance calldata acceptance,
        bytes calldata customerSig
    ) external {
        bytes32 introHash = _checkIntro(intro, referrerSig, acceptance, customerSig);
        address venue = intro.venue;
        address customer = acceptance.customer;
        address referrer = intro.referrer;

        CustomerState storage cs = _customers[venue][customer];
        if (cs.verified) revert CustomerAlreadyVerified();
        if (!_customers[venue][referrer].verified && !_seed[venue][referrer]) revert ReferrerNotEligible();

        {
            bytes32 useKey = introUseKey(introHash, customer, intro.linkType);
            if (_introUsed[useKey]) revert IntroAlreadyUsed();
            _introUsed[useKey] = true;
        }

        LiveIntro memory li;
        li.referrer = referrer;
        li.termsVersion = intro.termsVersion;
        li.linkType = intro.linkType;
        li.acceptedAt = uint64(block.timestamp);
        li.expiresAt = intro.expiresAt;
        li.introHash = introHash;
        _storeLiveIntro(venue, customer, cs, li);
        emit IntroAccepted(venue, referrer, customer, introHash, li.termsVersion, li.linkType, li.expiresAt);
    }

    // ================================================================================================
    // Pay (D-103, D-502..D-506)
    // ================================================================================================

    /// @notice Settle a venue-signed order with the customer's USDC ReceiveWithAuthorization, splitting atomically.
    /// @param weights Attributor-signed weights, or empty (auth.weightsHash == 0) for the on-chain fallback.
    ///        Bad/missing/mismatched weights NEVER revert: they select the fallback (PaymentSettled.weightsMode).
    /// @param customerUsdcSig The customer's signature over USDC's ReceiveWithAuthorization{from: customer,
    ///        to: this, value: amount, validAfter: 0, validBefore: auth.deadline, nonce: hashStruct(auth)}.
    function pay(
        Order calldata order,
        bytes calldata venueSig,
        Weights calldata weights,
        bytes calldata attributorSig,
        PaymentAuth calldata auth,
        bytes calldata customerUsdcSig
    ) external nonReentrant {
        _checkOrder(order, venueSig, auth);
        // ---- effects (everything that decides who gets paid), CustomerVerified emitted here ----
        Plan memory p = _settle(order, weights, attributorSig, auth.customer, auth.weightsHash);
        // ---- interactions ----
        _pullPayment(auth.customer, order.amount, auth.deadline, VouchHash.paymentAuth(auth), customerUsdcSig);
        _distribute(order.venue, auth.customer, order.orderId, order.amount, p);
    }

    /// @dev Marks the order settled, counts volume, and (first purchase only) plans the reward and records the
    ///      customer's verification. No external calls.
    function _settle(
        Order calldata order,
        Weights calldata weights,
        bytes calldata attributorSig,
        address customer,
        bytes32 weightsHash
    ) internal returns (Plan memory p) {
        address venue = order.venue;
        _settled[venue][order.orderId] = true;
        VenueStats storage vs = _venueStats[venue];
        vs.grossVolume += uint128(order.amount);
        CustomerState storage cs = _customers[venue][customer];
        if (!cs.verified) {
            p = _plan(venue, customer, order.orderId, order.amount, weights, attributorSig, weightsHash);
            p.first = true;
            _recordFirstPurchase(venue, customer, order.orderId, cs, vs, p);
        }
    }

    /// @dev THE ONLY place USDC is pulled (MSG-004): EIP-3009 receiveWithAuthorization with `to = address(this)`.
    ///      FiatTokenV2_2 requires msg.sender == to, so only this contract can redeem the customer's authorization.
    function _pullPayment(address customer, uint256 amount, uint64 deadline, bytes32 nonce, bytes calldata sig)
        internal
    {
        USDC.receiveWithAuthorization(customer, address(this), amount, 0, deadline, nonce, sig);
    }

    // ================================================================================================
    // Views
    // ================================================================================================

    function computeVenueId(address owner, bytes32 salt) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(owner, salt)))));
    }

    function getVenue(address venue) external view returns (Venue memory) {
        return _venues[venue];
    }

    function getTerms(address venue, uint32 version) external view returns (Terms memory) {
        return _terms[venue][version];
    }

    function currentTerms(address venue) external view returns (uint32 version, Terms memory terms) {
        version = _venues[venue].termsVersion;
        terms = _terms[venue][version];
    }

    function isSeedAmbassador(address venue, address account) external view returns (bool) {
        return _seed[venue][account];
    }

    /// @notice True if `account` may sign intros for `venue` (verified customer or seed ambassador).
    function canRefer(address venue, address account) external view returns (bool) {
        return _customers[venue][account].verified || _seed[venue][account];
    }

    function getCustomer(address venue, address customer) external view returns (CustomerState memory) {
        return _customers[venue][customer];
    }

    function introducerOf(address venue, address customer) external view returns (address) {
        return _customers[venue][customer].introducer;
    }

    /// @notice Live-intro slots of (customer, venue), including expired ones not yet reused.
    function getLiveIntros(address venue, address customer) external view returns (LiveIntro[] memory out) {
        uint256 n = _customers[venue][customer].introCount;
        out = new LiveIntro[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = _intros[venue][customer][i];
        }
    }

    function introUseKey(bytes32 introHash, address customer, uint8 linkType) public pure returns (bytes32) {
        return linkType == LINK_PERSONAL ? introHash : keccak256(abi.encode(introHash, customer));
    }

    function isIntroUsed(bytes32 introHash, address customer, uint8 linkType) external view returns (bool) {
        return _introUsed[introUseKey(introHash, customer, linkType)];
    }

    function isOrderSettled(address venue, bytes32 orderId) external view returns (bool) {
        return _settled[venue][orderId];
    }

    function getVenueStats(address venue) external view returns (VenueStats memory) {
        return _venueStats[venue];
    }

    function getAmbassadorStats(address ambassador) external view returns (AmbassadorStats memory) {
        return _ambassadorStats[ambassador];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Full EIP-712 digest of an Intro (== IntroAcceptance.introHash).
    function hashIntro(Intro calldata intro) external view returns (bytes32) {
        return _hashTypedDataV4(VouchHash.intro(intro));
    }

    function hashWeights(Weights calldata weights) external pure returns (bytes32) {
        return VouchHash.weights(weights);
    }

    /// @notice hashStruct(PaymentAuth) = the EIP-3009 nonce the customer signs (D-103).
    function paymentAuthNonce(PaymentAuth calldata auth) external pure returns (bytes32) {
        return VouchHash.paymentAuth(auth);
    }

    /// @notice What `pay` would distribute right now (assuming every transfer succeeds). No signature on the
    ///         order or the USDC authorization is checked; the attributor signature IS checked (it selects the mode).
    function previewPayment(
        address venue,
        address customer,
        bytes32 orderId,
        uint256 amount,
        Weights calldata weights,
        bytes calldata attributorSig,
        bytes32 weightsHash
    ) external view returns (Quote memory q) {
        _venue(venue);
        q.amount = amount;
        if (_customers[venue][customer].verified) {
            q.venueAmount = amount;
            return q;
        }
        Plan memory p = _plan(venue, customer, orderId, amount, weights, attributorSig, weightsHash);
        q.firstPurchase = true;
        q.rewarded = p.rewarded;
        q.weightsMode = p.weightsMode;
        q.rewardPool = p.pool;
        q.referrers = new address[](p.n);
        q.bps = new uint16[](p.n);
        q.termsVersions = new uint32[](p.n);
        q.l1Amounts = new uint256[](p.n);
        q.l2Recipients = new address[](p.n);
        q.l2Amounts = new uint256[](p.n);
        uint256 distributed;
        for (uint256 i; i < p.n; ++i) {
            (uint256 cb, uint256 l1, uint256 l2) = VouchSplit.parts(p.slice[i]);
            q.cashback += cb;
            q.referrers[i] = p.referrers[i];
            q.bps[i] = uint16(p.bps[i]);
            q.termsVersions[i] = p.termsVersion[i];
            q.l1Amounts[i] = l1;
            q.l2Amounts[i] = l2;
            address to = p.l2To[i];
            bool returned = to == address(0) || to == customer;
            q.l2Recipients[i] = returned ? address(0) : to;
            distributed += cb + l1 + (returned ? 0 : l2);
        }
        if (p.rewarded) q.introducer = p.referrers[p.top];
        q.venueAmount = amount - distributed;
    }

    // ================================================================================================
    // Internals — venues
    // ================================================================================================

    function _venue(address venue) internal view returns (Venue storage v) {
        v = _venues[venue];
        if (v.owner == address(0)) revert UnknownVenue();
    }

    function _checkOwnerSig(address owner, bytes32 structHash, uint64 deadline, bytes calldata sig) internal view {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (!SignatureChecker.isValidSignatureNow(owner, _hashTypedDataV4(structHash), sig)) {
            revert InvalidOwnerSignature();
        }
    }

    function _checkKeys(address payout, address signer, address attributor) internal pure {
        if (payout == address(0) || signer == address(0) || attributor == address(0)) revert ZeroAddress();
    }

    function _pushTerms(address venue, Venue storage v, uint16 rewardBps, uint256 minOrder) internal {
        if (rewardBps == 0 || rewardBps > MAX_REWARD_BPS || minOrder > MAX_MIN_ORDER) revert InvalidTerms();
        uint32 version = v.termsVersion + 1;
        v.termsVersion = version;
        _terms[venue][version] =
            Terms({rewardBps: rewardBps, effectiveAt: uint64(block.timestamp), minOrder: uint128(minOrder)});
        emit TermsUpdated(venue, version, rewardBps, minOrder, uint64(block.timestamp));
    }

    /// @dev `version` must be the terms version in force at `issuedAt`: effectiveAt(v) <= issuedAt and the next
    ///      version (if any) became effective after issuedAt. Bounds old-rate exposure to MAX_INTRO_TTL (D-505).
    function _checkTermsInForce(address venue, uint32 version, uint64 issuedAt, uint32 current) internal view {
        if (version == 0 || version > current) revert TermsNotInForce();
        if (_terms[venue][version].effectiveAt > issuedAt) revert TermsNotInForce();
        if (version < current && _terms[venue][version + 1].effectiveAt <= issuedAt) revert TermsNotInForce();
    }

    // ================================================================================================
    // Internals — intros
    // ================================================================================================

    /// @dev Stateless intro checks: window, terms in force, parties, both signatures. Returns the intro digest.
    function _checkIntro(
        Intro calldata intro,
        bytes calldata referrerSig,
        IntroAcceptance calldata acceptance,
        bytes calldata customerSig
    ) internal view returns (bytes32 introHash) {
        Venue storage v = _venue(intro.venue);
        if (intro.linkType > LINK_BROADCAST) revert InvalidLinkType();
        if (
            intro.expiresAt <= intro.issuedAt || intro.expiresAt - intro.issuedAt > MAX_INTRO_TTL
                || intro.issuedAt > block.timestamp + MAX_CLOCK_SKEW
        ) revert InvalidIntroWindow();
        if (block.timestamp > intro.expiresAt) revert IntroExpired();
        if (block.timestamp > acceptance.deadline) revert SignatureExpired();
        _checkTermsInForce(intro.venue, intro.termsVersion, intro.issuedAt, v.termsVersion);
        address customer = acceptance.customer;
        address referrer = intro.referrer;
        if (customer == address(0) || referrer == address(0)) revert ZeroAddress();
        if (customer == referrer) revert SelfReferral();
        introHash = _hashTypedDataV4(VouchHash.intro(intro));
        if (acceptance.introHash != introHash) revert IntroHashMismatch();
        if (!SignatureChecker.isValidSignatureNow(referrer, introHash, referrerSig)) revert InvalidReferrerSignature();
        if (!SignatureChecker.isValidSignatureNow(
                customer, _hashTypedDataV4(VouchHash.introAcceptance(acceptance)), customerSig
            )) revert InvalidCustomerSignature();
    }

    /// @dev Slot choice (D-505): (1) same referrer → replace; (2) else first expired slot → reuse;
    ///      (3) else append if < 5; (4) else evict the oldest acceptedAt (ties → lower index).
    function _storeLiveIntro(address venue, address customer, CustomerState storage cs, LiveIntro memory li) internal {
        LiveIntro[5] storage slots = _intros[venue][customer];
        uint256 n = cs.introCount;
        uint256 idx = type(uint256).max;
        uint8 reason;
        for (uint256 i; i < n; ++i) {
            if (slots[i].referrer == li.referrer) {
                idx = i;
                reason = DROP_REPLACED;
                break;
            }
        }
        if (idx == type(uint256).max) {
            for (uint256 i; i < n; ++i) {
                if (block.timestamp > slots[i].expiresAt) {
                    idx = i;
                    reason = DROP_EXPIRED;
                    break;
                }
            }
        }
        if (idx == type(uint256).max) {
            if (n < MAX_LIVE_INTROS) {
                slots[n] = li;
                cs.introCount = uint8(n + 1);
                return;
            }
            idx = 0;
            for (uint256 i = 1; i < n; ++i) {
                if (slots[i].acceptedAt < slots[idx].acceptedAt) idx = i;
            }
            reason = DROP_EVICTED;
        }
        LiveIntro storage old = slots[idx];
        emit IntroDropped(venue, customer, old.referrer, old.introHash, reason);
        slots[idx] = li;
    }

    // ================================================================================================
    // Internals — pay
    // ================================================================================================

    function _checkOrder(Order calldata order, bytes calldata venueSig, PaymentAuth calldata auth) internal view {
        Venue storage v = _venue(order.venue);
        if (block.timestamp > order.expiresAt) revert OrderExpired();
        if (order.amount == 0 || order.amount > MAX_ORDER_AMOUNT) revert InvalidAmount();
        if (auth.customer == address(0)) revert ZeroAddress();
        if (auth.venue != order.venue || auth.orderId != order.orderId || auth.amount != order.amount) {
            revert AuthMismatch();
        }
        if (block.timestamp >= auth.deadline) revert AuthExpired(); // USDC: valid iff now < validBefore
        if (_settled[order.venue][order.orderId]) revert OrderAlreadySettled();
        if (!SignatureChecker.isValidSignatureNow(v.signer, _hashTypedDataV4(VouchHash.order(order)), venueSig)) {
            revert InvalidVenueSignature();
        }
    }

    /// @dev Live, unexpired intros whose frozen minOrder <= amount, in slot order.
    function _eligible(address venue, address customer, uint256 amount) internal view returns (Eligible memory e) {
        uint256 n = _customers[venue][customer].introCount;
        LiveIntro[5] storage slots = _intros[venue][customer];
        for (uint256 i; i < n; ++i) {
            LiveIntro storage s = slots[i];
            if (block.timestamp > s.expiresAt) continue;
            Terms storage t = _terms[venue][s.termsVersion];
            if (amount < t.minOrder) continue;
            uint256 k = e.k;
            e.referrer[k] = s.referrer;
            e.linkType[k] = s.linkType;
            e.acceptedAt[k] = s.acceptedAt;
            e.termsVersion[k] = s.termsVersion;
            e.rate[k] = t.rewardBps;
            e.k = k + 1;
        }
    }

    /// @dev Builds the reward plan of a FIRST purchase (view). Never reverts on bad weights.
    function _plan(
        address venue,
        address customer,
        bytes32 orderId,
        uint256 amount,
        Weights calldata w,
        bytes calldata attributorSig,
        bytes32 weightsHash
    ) internal view returns (Plan memory p) {
        Eligible memory e = _eligible(venue, customer, amount);
        if (e.k == 0) return p; // plain first purchase: verified, introducer 0
        p.rewarded = true;
        uint8 mode = _applyAttributorWeights(venue, customer, orderId, w, attributorSig, weightsHash, e, p);
        if (mode != WEIGHTS_ATTRIBUTOR) {
            uint256[5] memory fw = VouchSplit.fallbackWeights(e.linkType, e.acceptedAt, e.k, block.timestamp);
            p.n = e.k;
            for (uint256 i; i < e.k; ++i) {
                p.referrers[i] = e.referrer[i];
                p.bps[i] = fw[i];
                p.rate[i] = e.rate[i];
                p.termsVersion[i] = e.termsVersion[i];
            }
        }
        p.weightsMode = mode;
        for (uint256 i; i < p.n; ++i) {
            uint256 s = VouchSplit.slice(amount, p.bps[i], p.rate[i]);
            p.slice[i] = s;
            p.pool += s;
            p.l2To[i] = _customers[venue][p.referrers[i]].introducer;
        }
        p.top = VouchSplit.topIndex(p.bps, p.n);
    }

    /// @dev Returns WEIGHTS_ATTRIBUTOR (and fills p.n/referrers/bps/rate/termsVersion) iff the committed weights are
    ///      well-formed, within bounds, reference only eligible intros, and carry a valid attributor signature.
    function _applyAttributorWeights(
        address venue,
        address customer,
        bytes32 orderId,
        Weights calldata w,
        bytes calldata attributorSig,
        bytes32 weightsHash,
        Eligible memory e,
        Plan memory p
    ) internal view returns (uint8) {
        if (weightsHash == bytes32(0)) return WEIGHTS_FALLBACK_NOT_COMMITTED;
        uint256 n = w.referrers.length;
        if (n == 0 || n > MAX_REFERRERS || n != w.bps.length) return WEIGHTS_FALLBACK_INVALID;
        if (VouchHash.weights(w) != weightsHash) return WEIGHTS_FALLBACK_HASH_MISMATCH;
        if (w.venue != venue || w.customer != customer || w.orderId != orderId) return WEIGHTS_FALLBACK_INVALID;
        uint256 sum;
        uint256 used;
        for (uint256 j; j < n; ++j) {
            uint256 b = w.bps[j];
            if (b == 0 || (n > 1 && b > PER_REFERRER_CAP_BPS)) return WEIGHTS_FALLBACK_INVALID;
            sum += b;
            address r = w.referrers[j];
            uint256 idx = type(uint256).max;
            for (uint256 i; i < e.k; ++i) {
                if (e.referrer[i] == r) {
                    idx = i;
                    break;
                }
            }
            if (idx == type(uint256).max || used & (1 << idx) != 0) return WEIGHTS_FALLBACK_INVALID;
            used |= 1 << idx;
            p.referrers[j] = r;
            p.bps[j] = b;
            p.rate[j] = e.rate[idx];
            p.termsVersion[j] = e.termsVersion[idx];
        }
        if (sum != BPS) return WEIGHTS_FALLBACK_INVALID;
        if (!SignatureChecker.isValidSignatureNow(_venues[venue].attributor, _hashTypedDataV4(weightsHash), attributorSig))
        {
            return WEIGHTS_FALLBACK_BAD_SIGNATURE;
        }
        p.n = n;
        return WEIGHTS_ATTRIBUTOR;
    }

    /// @dev Effects of a first purchase: verified (+ rewarded, introducer, credits). Emits CustomerVerified.
    function _recordFirstPurchase(
        address venue,
        address customer,
        bytes32 orderId,
        CustomerState storage cs,
        VenueStats storage vs,
        Plan memory p
    ) internal {
        cs.verified = true;
        cs.verifiedAt = uint64(block.timestamp);
        vs.verifiedCustomers += 1;
        address introducer;
        if (p.rewarded) {
            cs.rewarded = true;
            introducer = p.referrers[p.top];
            cs.introducer = introducer;
            vs.rewardedCustomers += 1;
            for (uint256 i; i < p.n; ++i) {
                if (p.bps[i] == 0) continue;
                address r = p.referrers[i];
                AmbassadorStats storage a = _ambassadorStats[r];
                a.customersCredited += 1;
                if (!_ambassadorAtVenue[r][venue]) {
                    _ambassadorAtVenue[r][venue] = true;
                    a.venues += 1;
                }
            }
        }
        emit CustomerVerified(venue, customer, introducer, orderId);
    }

    /// @dev Transfers every share (failed recipient transfers → venue, D-506), then the venue payout, then events.
    function _distribute(
        address venue,
        address customer,
        bytes32 orderId,
        uint256 amount,
        Plan memory p
    ) internal {
        Payout[] memory outs = new Payout[](1 + 2 * p.n);
        uint256 m;
        if (p.rewarded) {
            uint256 cashback;
            for (uint256 i; i < p.n; ++i) {
                (uint256 cb,,) = VouchSplit.parts(p.slice[i]);
                cashback += cb;
            }
            m = _send(outs, m, customer, address(0), ROLE_CASHBACK, cashback);
            for (uint256 i; i < p.n; ++i) {
                (, uint256 l1,) = VouchSplit.parts(p.slice[i]);
                m = _send(outs, m, p.referrers[i], p.referrers[i], ROLE_L1, l1);
            }
            for (uint256 i; i < p.n; ++i) {
                (,, uint256 l2) = VouchSplit.parts(p.slice[i]);
                address to = p.l2To[i];
                if (to == address(0)) {
                    m = _record(outs, m, Payout(address(0), p.referrers[i], ROLE_L2, false, RETURN_NO_INTRODUCER, l2));
                } else if (to == customer) {
                    m = _record(outs, m, Payout(to, p.referrers[i], ROLE_L2, false, RETURN_SELF_PAYMENT, l2));
                } else {
                    m = _send(outs, m, to, p.referrers[i], ROLE_L2, l2);
                }
            }
        }

        uint256 paid;
        uint256 returned;
        for (uint256 j; j < m; ++j) {
            Payout memory o = outs[j];
            if (o.paid) {
                paid += o.amount;
                if (o.role != ROLE_CASHBACK) {
                    AmbassadorStats storage a = _ambassadorStats[o.to];
                    if (o.role == ROLE_L1) a.l1Earned += uint128(o.amount);
                    else a.l2Earned += uint128(o.amount);
                }
            } else {
                returned += o.amount;
            }
        }
        uint256 venueAmount = amount - paid;
        VenueStats storage vs = _venueStats[venue];
        vs.rewardsPaid += uint128(paid);
        vs.rewardsReturned += uint128(returned);

        if (venueAmount != 0 && !_tryTransfer(_venues[venue].payout, venueAmount)) revert PayoutTransferFailed();

        emit PaymentSettled(venue, customer, orderId, amount, venueAmount, p.pool, p.first, p.rewarded, p.weightsMode);
        for (uint256 j; j < m; ++j) {
            Payout memory o = outs[j];
            if (o.paid) {
                emit RewardPaid(orderId, o.to, venue, customer, o.role, o.amount, o.via);
            } else {
                emit RewardReturned(orderId, o.to, venue, customer, o.role, o.amount, o.via, o.reason);
            }
        }
    }

    function _send(Payout[] memory outs, uint256 m, address to, address via, uint8 role, uint256 amount)
        internal
        returns (uint256)
    {
        if (amount == 0) return m;
        bool ok = _tryTransfer(to, amount);
        outs[m] = Payout(to, via, role, ok, ok ? 0 : RETURN_TRANSFER_FAILED, amount);
        return m + 1;
    }

    function _record(Payout[] memory outs, uint256 m, Payout memory o) internal pure returns (uint256) {
        if (o.amount == 0) return m;
        outs[m] = o;
        return m + 1;
    }

    /// @dev USDC.transfer via a low-level call: a reverting recipient (e.g. blacklisted) cannot block the payment
    ///      (D-506). A failure caused by running out of gas reverts the whole tx, so a relayer cannot starve
    ///      transfers to redirect shares to the venue (63/64 rule: the callee had all but 1/64 of our gas).
    function _tryTransfer(address to, uint256 amount) internal returns (bool ok) {
        address token = address(USDC);
        bytes memory data = abi.encodeCall(IFiatTokenV2_2.transfer, (to, amount));
        uint256 gasBefore = gasleft();
        bool success;
        assembly ("memory-safe") {
            mstore(0x00, 0)
            success := call(gas(), token, 0, add(data, 0x20), mload(data), 0x00, 0x20)
            ok := and(success, and(gt(returndatasize(), 31), eq(mload(0x00), 1)))
        }
        if (!success && gasleft() <= gasBefore / 63) revert TransferOutOfGas();
    }
}
