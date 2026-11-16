// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IVouch — types, events and errors of the Vouch referral-payment contract.
/// @notice Source of truth for AGENTS/INTERFACES.md §3 (EIP-712) and §4 (events). Field order of the signed structs
///         defines the EIP-712 type strings in `libraries/VouchHash.sol`; keep `packages/shared/src/eip712.ts` identical.
interface IVouch {
    // ------------------------------------------------------------------------------------------------
    // Signed messages (EIP-712, domain {name:"Vouch", version:"1", chainId, verifyingContract})
    // ------------------------------------------------------------------------------------------------

    /// @notice Signed by the REFERRER. linkType 0 = personal (single-use), 1 = broadcast (once per customer).
    struct Intro {
        address venue;
        address referrer;
        uint32 termsVersion;
        uint8 linkType;
        uint64 issuedAt;
        uint64 expiresAt;
        bytes32 nonce;
    }

    /// @notice Countersigned by the CUSTOMER. `introHash` = full EIP-712 digest of the Intro.
    struct IntroAcceptance {
        bytes32 introHash;
        address customer;
        uint64 deadline;
    }

    /// @notice Signed by the venue's SIGNER key. `amount` in USDC base units (6 decimals).
    struct Order {
        address venue;
        bytes32 orderId;
        uint256 amount;
        uint64 expiresAt;
    }

    /// @notice Signed by the venue's ATTRIBUTOR key. bps sum to 10,000.
    struct Weights {
        address venue;
        address customer;
        bytes32 orderId;
        address[] referrers;
        uint16[] bps;
    }

    /// @notice Not signed directly: hashStruct(PaymentAuth) is the nonce of the customer's USDC
    ///         ReceiveWithAuthorization (D-103). weightsHash = hashStruct(Weights) or bytes32(0) for the fallback.
    ///         submitter = the only address allowed to call pay() with it (the app's relayer), or 0 = anyone (D-012).
    struct PaymentAuth {
        address customer;
        address venue;
        bytes32 orderId;
        uint256 amount;
        bytes32 weightsHash;
        uint64 deadline;
        address submitter;
    }

    /// @notice Venue configuration passed to `registerVenue` (owner-signed as `RegisterVenue` when relayed).
    struct VenueConfig {
        address payout;
        address signer;
        address attributor;
        uint16 rewardBps;
        uint256 minOrder;
        string metadataURI;
    }

    // ------------------------------------------------------------------------------------------------
    // Stored records (returned by views)
    // ------------------------------------------------------------------------------------------------

    struct Venue {
        address owner;
        uint32 termsVersion; // current (latest) version; versions 1..termsVersion are stored forever
        uint64 registeredAt;
        address payout;
        address signer;
        address attributor;
    }

    struct Terms {
        uint16 rewardBps;
        uint64 effectiveAt;
        uint128 minOrder;
    }

    struct LiveIntro {
        address referrer;
        uint32 termsVersion;
        uint8 linkType;
        uint64 acceptedAt;
        uint64 expiresAt;
        bytes32 introHash;
    }

    struct CustomerState {
        bool verified; // made >= 1 purchase at this venue (may now refer it)
        bool rewarded; // its first purchase paid a reward (at most once per customer per venue, ever)
        uint8 introCount; // number of used live-intro slots (<= MAX_LIVE_INTROS)
        address introducer; // L2 parent (D-008): top-weight L1 referrer of the first purchase, or 0
        uint64 verifiedAt;
    }

    struct AmbassadorStats {
        uint64 customersCredited; // distinct (customer, venue) first purchases where this address was an L1 referrer
        uint32 venues; // distinct venues where this address was credited as an L1 referrer
        uint128 l1Earned; // USDC base units actually transferred as L1
        uint128 l2Earned; // USDC base units actually transferred as L2
    }

    struct VenueStats {
        uint64 verifiedCustomers;
        uint64 rewardedCustomers;
        uint128 grossVolume; // Σ payment amounts
        uint128 rewardsPaid; // Σ cashback + L1 + L2 actually transferred
        uint128 rewardsReturned; // Σ shares returned to the venue (no introducer / self-payment / failed transfer)
    }

    /// @notice Result of `previewPayment` (what `pay` would do if every transfer succeeds).
    struct Quote {
        bool firstPurchase;
        bool rewarded;
        uint8 weightsMode;
        uint256 amount;
        uint256 rewardPool;
        uint256 cashback;
        uint256 venueAmount;
        address introducer;
        address[] referrers;
        uint16[] bps;
        uint32[] termsVersions;
        uint256[] l1Amounts;
        address[] l2Recipients; // address(0) = that share returns to the venue
        uint256[] l2Amounts;
    }

    // ------------------------------------------------------------------------------------------------
    // Events (AGENTS/INTERFACES.md §4) — the DB is rebuildable from these alone.
    // ------------------------------------------------------------------------------------------------

    event VenueRegistered(
        address indexed venue,
        address indexed owner,
        bytes32 salt,
        address payout,
        address signer,
        address attributor,
        string metadataURI
    );
    event TermsUpdated(
        address indexed venue, uint32 indexed termsVersion, uint16 rewardBps, uint256 minOrder, uint64 effectiveAt
    );
    event VenueKeysUpdated(address indexed venue, address payout, address signer, address attributor);
    event SeedAmbassadorSet(address indexed venue, address indexed ambassador, bool allowed);
    event IntroAccepted(
        address indexed venue,
        address indexed referrer,
        address indexed customer,
        bytes32 introHash,
        uint32 termsVersion,
        uint8 linkType,
        uint64 expiresAt
    );
    /// @notice A live intro left the customer's (≤5) slots: reason 0 = replaced by a newer intro from the same
    ///         referrer, 1 = its (expired) slot was reused, 2 = evicted as the oldest when all 5 slots were live.
    event IntroDropped(
        address indexed venue, address indexed customer, address indexed referrer, bytes32 introHash, uint8 reason
    );
    event CustomerVerified(address indexed venue, address indexed customer, address indexed introducer, bytes32 orderId);
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
    /// @notice role 0 = CASHBACK (viaReferrer = 0), 1 = L1 (viaReferrer = recipient), 2 = L2 (viaReferrer = the L1
    ///         referrer whose introducer is paid).
    event RewardPaid(
        bytes32 indexed orderId,
        address indexed recipient,
        address indexed venue,
        address customer,
        uint8 role,
        uint256 amount,
        address viaReferrer
    );
    /// @notice A share that went to the venue payout instead: reason 0 = NO_INTRODUCER (intendedRecipient = 0),
    ///         1 = SELF_PAYMENT (L2 introducer is the paying customer), 2 = TRANSFER_FAILED (e.g. USDC blacklist).
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

    // ------------------------------------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------------------------------------

    error ZeroAddress();
    error UnknownVenue();
    error VenueAlreadyRegistered();
    error InvalidTerms();
    error SignatureExpired();
    error InvalidOwnerSignature();
    error InvalidReferrerSignature();
    error InvalidCustomerSignature();
    error InvalidVenueSignature();
    error InvalidLinkType();
    error InvalidIntroWindow();
    error IntroExpired();
    error TermsNotInForce();
    error IntroHashMismatch();
    error SelfReferral();
    error ReferrerNotEligible();
    error CustomerAlreadyVerified();
    error IntroAlreadyUsed();
    error OrderExpired();
    error OrderAlreadySettled();
    error InvalidAmount();
    error AuthMismatch();
    error AuthExpired();
    error UnauthorizedSubmitter();
    error InvalidPayout();
    error PayoutTransferFailed();
    error TransferOutOfGas();
}
