// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IVouch} from "../interfaces/IVouch.sol";

/// @title VouchHash — EIP-712 type strings and struct hashes (hashStruct, no domain).
/// @dev The quoted type strings below are extracted verbatim by `contracts/script/export-abi.sh` into
///      `packages/shared/src/abi/vouch.ts` (VOUCH_TYPE_STRINGS) and compared with the viem definitions in
///      `packages/shared/src/eip712.ts` by `eip712.test.ts`. Keep one `keccak256("…")` literal per line.
///      Arrays are hashed as keccak256(abi.encodePacked(T[])) (each element padded to 32 bytes), strings as
///      keccak256(bytes(s)) — exactly what viem's hashStruct does.
library VouchHash {
    // forgefmt: disable-start
    bytes32 internal constant INTRO_TYPEHASH = keccak256("Intro(address venue,address referrer,uint32 termsVersion,uint8 linkType,uint64 issuedAt,uint64 expiresAt,bytes32 nonce)");
    bytes32 internal constant INTRO_ACCEPTANCE_TYPEHASH = keccak256("IntroAcceptance(bytes32 introHash,address customer,uint64 deadline)");
    bytes32 internal constant ORDER_TYPEHASH = keccak256("Order(address venue,bytes32 orderId,uint256 amount,uint64 expiresAt)");
    bytes32 internal constant WEIGHTS_TYPEHASH = keccak256("Weights(address venue,address customer,bytes32 orderId,address[] referrers,uint16[] bps)");
    bytes32 internal constant PAYMENT_AUTH_TYPEHASH = keccak256("PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline)");
    bytes32 internal constant REGISTER_VENUE_TYPEHASH = keccak256("RegisterVenue(address owner,bytes32 salt,address payout,address signer,address attributor,uint16 rewardBps,uint256 minOrder,string metadataURI,uint256 nonce,uint64 deadline)");
    bytes32 internal constant UPDATE_TERMS_TYPEHASH = keccak256("UpdateTerms(address venue,uint16 rewardBps,uint256 minOrder,uint256 nonce,uint64 deadline)");
    bytes32 internal constant SET_VENUE_KEYS_TYPEHASH = keccak256("SetVenueKeys(address venue,address payout,address signer,address attributor,uint256 nonce,uint64 deadline)");
    bytes32 internal constant SET_SEED_AMBASSADOR_TYPEHASH = keccak256("SetSeedAmbassador(address venue,address ambassador,bool allowed,uint256 nonce,uint64 deadline)");
    // forgefmt: disable-end

    function intro(IVouch.Intro calldata i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTRO_TYPEHASH, i.venue, i.referrer, i.termsVersion, i.linkType, i.issuedAt, i.expiresAt, i.nonce
            )
        );
    }

    function introAcceptance(IVouch.IntroAcceptance calldata a) internal pure returns (bytes32) {
        return keccak256(abi.encode(INTRO_ACCEPTANCE_TYPEHASH, a.introHash, a.customer, a.deadline));
    }

    function order(IVouch.Order calldata o) internal pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, o.venue, o.orderId, o.amount, o.expiresAt));
    }

    function weights(IVouch.Weights calldata w) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                WEIGHTS_TYPEHASH,
                w.venue,
                w.customer,
                w.orderId,
                keccak256(abi.encodePacked(w.referrers)),
                keccak256(abi.encodePacked(w.bps))
            )
        );
    }

    function paymentAuth(IVouch.PaymentAuth calldata p) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(PAYMENT_AUTH_TYPEHASH, p.customer, p.venue, p.orderId, p.amount, p.weightsHash, p.deadline)
        );
    }

    function registerVenue(
        address owner,
        bytes32 salt,
        IVouch.VenueConfig calldata c,
        uint256 nonce,
        uint64 deadline
    ) internal pure returns (bytes32) {
        // Split into two abi.encode calls (all words are static, so the concatenation equals one abi.encode).
        return keccak256(
            bytes.concat(
                abi.encode(REGISTER_VENUE_TYPEHASH, owner, salt, c.payout, c.signer, c.attributor),
                abi.encode(c.rewardBps, c.minOrder, keccak256(bytes(c.metadataURI)), nonce, deadline)
            )
        );
    }

    function updateTerms(address venue, uint16 rewardBps, uint256 minOrder, uint256 nonce, uint64 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(UPDATE_TERMS_TYPEHASH, venue, rewardBps, minOrder, nonce, deadline));
    }

    function setVenueKeys(
        address venue,
        address payout,
        address signer,
        address attributor,
        uint256 nonce,
        uint64 deadline
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(SET_VENUE_KEYS_TYPEHASH, venue, payout, signer, attributor, nonce, deadline));
    }

    function setSeedAmbassador(address venue, address ambassador, bool allowed, uint256 nonce, uint64 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(SET_SEED_AMBASSADOR_TYPEHASH, venue, ambassador, allowed, nonce, deadline));
    }
}
