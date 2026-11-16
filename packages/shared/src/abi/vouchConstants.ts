/**
 * Vouch contract enums + limits (hand-written; mirror of the `public constant`s in contracts/src/Vouch.sol).
 * Shares the meaning of REWARD_ROLE / LINK_TYPE in ../constants.ts. D-501..D-510.
 */

/** PaymentSettled.weightsMode — how the L1 weights of a rewarded first purchase were chosen. */
export const WEIGHTS_MODE = {
  /** Not a rewarded purchase (repeat purchase, or first purchase without an eligible intro). */
  NONE: 0,
  /** Attributor-signed weights committed by the customer (PaymentAuth.weightsHash) were valid and used. */
  ATTRIBUTOR: 1,
  /** Fallback: the customer committed weightsHash = 0. */
  FALLBACK_NOT_COMMITTED: 2,
  /** Fallback: submitted weights do not hash to the committed weightsHash (relayer swapped them). */
  FALLBACK_HASH_MISMATCH: 3,
  /** Fallback: weights out of bounds / wrong venue-customer-order / referrer without an eligible intro. */
  FALLBACK_INVALID: 4,
  /** Fallback: the attributor signature is invalid. */
  FALLBACK_BAD_SIGNATURE: 5,
} as const;

/** RewardReturned.reason — why a share went to the venue payout instead of its intended recipient. */
export const RETURN_REASON = {
  NO_INTRODUCER: 0,
  SELF_PAYMENT: 1,
  TRANSFER_FAILED: 2,
} as const;

/** IntroDropped.reason — why a live intro left the customer's slots. */
export const INTRO_DROP_REASON = {
  REPLACED: 0,
  EXPIRED: 1,
  EVICTED: 2,
} as const;

export const VOUCH_LIMITS = {
  MAX_REWARD_BPS: 5_000,
  MAX_MIN_ORDER: 10_000_000_000n, // $10,000 (6-dec)
  MAX_ORDER_AMOUNT: 1_000_000_000_000n, // $1,000,000 (6-dec)
  MAX_REFERRERS: 5,
  PER_REFERRER_CAP_BPS: 8_000,
  MAX_LIVE_INTROS: 5,
  MAX_INTRO_TTL_SECONDS: 30 * 24 * 60 * 60,
  MAX_CLOCK_SKEW_SECONDS: 15 * 60,
  FALLBACK_HALF_LIFE_SECONDS: 3 * 24 * 60 * 60,
  FALLBACK_MAX_HALVINGS: 10,
} as const;
