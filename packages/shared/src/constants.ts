/**
 * Display name. The ONLY place the product name lives (D-002). Name pending human confirmation.
 * Do NOT derive on-chain identifiers (EIP-712 domain name, contract names) from this at runtime —
 * see EIP712_DOMAIN_NAME in eip712.ts, which is frozen once the main contract is deployed.
 */
export const APP_NAME = 'Vouch' as const;

/** Basis-point denominator. 10_000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000 as const;

/**
 * Split of the venue's reward pool (pool = sale × venue rewardBps).
 * Must sum to BPS_DENOMINATOR. Undistributable shares return to the venue.
 */
export const SPLIT_BPS = {
  /** Welcome cashback to the paying customer. */
  CASHBACK: 2_500,
  /** Direct referrers (level 1), divided by attributed weights. */
  L1: 5_500,
  /** Introducers of the direct referrers (level 2), same proportions. */
  L2: 2_000,
} as const;

/** Max direct referrers that can share one rewarded first purchase. */
export const MAX_REFERRERS = 5 as const;

/** Max weight any single referrer can receive when there is more than one referrer. */
export const PER_REFERRER_CAP_BPS = 8_000 as const;

/** Link types for Intro.linkType (uint8). */
export const LINK_TYPE = {
  PERSONAL: 0,
  BROADCAST: 1,
} as const;
export type LinkType = (typeof LINK_TYPE)[keyof typeof LINK_TYPE];

/** RewardPaid.role (uint8). */
export const REWARD_ROLE = {
  CASHBACK: 0,
  L1: 1,
  L2: 2,
} as const;
export type RewardRole = (typeof REWARD_ROLE)[keyof typeof REWARD_ROLE];

/** Baseline attribution scoring params (README product story). */
export const ATTRIBUTION = {
  LINK_TYPE_WEIGHT: { [LINK_TYPE.PERSONAL]: 2, [LINK_TYPE.BROADCAST]: 1 },
  OPEN_BOOST: 0.25,
  HALF_LIFE_SECONDS: 3 * 24 * 60 * 60,
} as const;

// Compile-time-ish sanity check (also asserted in tests).
const _splitSum: number = SPLIT_BPS.CASHBACK + SPLIT_BPS.L1 + SPLIT_BPS.L2;
if (_splitSum !== BPS_DENOMINATOR) {
  throw new Error(`SPLIT_BPS must sum to ${BPS_DENOMINATOR}, got ${_splitSum}`);
}
