import type { Address, Hex } from 'viem';

/**
 * StreamsPort: the read + bus API that BACKEND_RELAYER codes against (MSG-062, accepted in MSG-063).
 * Structurally identical to `apps/api/src/ports/streams.ts` (BACKEND_RELAYER); fields marked "extra" are additions.
 * Amounts are bigint base units (6-dec USDC), addresses checksummed, hashes lowercase hex, times unix seconds.
 * Everything here is read from the ev_* tables, which are built ONLY from Streams-delivered Vouch logs.
 */

export interface RewardLine {
  orderId: Hex;
  venue: Address;
  customer: Address;
  /** 0 CASHBACK | 1 L1 | 2 L2 */
  role: 0 | 1 | 2;
  /** RewardPaid.recipient, or RewardReturned.intendedRecipient (0x0 for NO_INTRODUCER). */
  recipient: Address;
  amount: bigint;
  viaReferrer: Address;
  returned: boolean;
  returnReason: number | null;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number | null;
}

export interface SettledPayment {
  venue: Address;
  customer: Address;
  orderId: Hex;
  amount: bigint;
  venueAmount: bigint;
  rewardPool: bigint;
  firstPurchase: boolean;
  rewarded: boolean;
  weightsMode: number;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number | null;
  /** RewardPaid + RewardReturned of this order, in log order. */
  lines: RewardLine[];
}

export interface IntroAcceptedRow {
  venue: Address;
  referrer: Address;
  customer: Address;
  introHash: Hex;
  termsVersion: number;
  linkType: number;
  expiresAt: bigint;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number | null;
  /** Not dropped (IntroDropped). Expiry is NOT applied: compare expiresAt with chain time. */
  live: boolean;
}

export interface VenueTermsRow {
  termsVersion: number;
  rewardBps: number;
  minOrder: bigint;
  effectiveAt: bigint;
}

export interface VenueOnchain {
  venue: Address;
  owner: Address;
  salt: Hex;
  payout: Address;
  signer: Address;
  attributor: Address;
  metadataURI: string;
  /** Ascending by version. */
  terms: VenueTermsRow[];
  /** Currently allowed seed ambassadors. */
  seeds: Address[];
  registeredTx: Hex;
  blockNumber: bigint;
}

export interface MoneyEdge {
  orderId: Hex;
  /** role 0/1: the paying customer; role 2: viaReferrer (the L1 whose introducer is paid). */
  from: Address;
  to: Address;
  role: 0 | 1 | 2;
  amount: bigint;
  txHash: Hex;
}

export interface VenueStats {
  venue: Address;
  verifiedCustomers: number;
  rewardedPurchases: number;
  payments: number;
  gross: bigint;
  rewardsPaid: bigint;
  rewardsReturned: bigint;
  /** RewardPaid lines only (returned shares go to the venue: no edge). Amount-0 L1 lines included. */
  edges: MoneyEdge[];
  /** extra: Σ PaymentSettled.venueAmount */
  venueReceived: bigint;
  /** extra: Σ RewardPaid by role (cashback + l1 + l2 == rewardsPaid). Cost per verified customer = rewardsPaid / verifiedCustomers. */
  cashbackPaid: bigint;
  l1Paid: bigint;
  l2Paid: bigint;
  /** extra: distinct customers whose first purchase was rewarded. */
  rewardedCustomers: number;
}

export interface AmbassadorRecord {
  address: Address;
  customersCredited: number;
  venues: Address[];
  l1Earned: bigint;
  l2Earned: bigint;
  cashbackEarned: bigint;
  /** Newest first, capped at 50. */
  lines: RewardLine[];
}

export interface StreamsCursor {
  lastBlock: bigint | null;
  lastIngestAt: string | null;
  /** extra */
  lastLogIndex: number | null;
  /** extra: number of Vouch events in ev_events. */
  events: number;
}

export interface StreamsQueries {
  getPayment(venue: Address, orderId: Hex): Promise<SettledPayment | null>;
  getPaymentByTx(txHash: Hex): Promise<SettledPayment | null>;
  /** Newest first. */
  listPayments(filter: { venue?: Address; customer?: Address; limit?: number }): Promise<SettledPayment[]>;
  /** Newest first. */
  listRewardLines(filter: { recipient?: Address; venue?: Address; limit?: number }): Promise<RewardLine[]>;
  listIntrosAccepted(filter: { venue?: Address; customer?: Address; referrer?: Address; limit?: number }): Promise<IntroAcceptedRow[]>;
  getVenue(venue: Address): Promise<VenueOnchain | null>;
  getVenueStats(venue: Address): Promise<VenueStats>;
  getAmbassador(address: Address): Promise<AmbassadorRecord>;
  isVerified(venue: Address, customer: Address): Promise<boolean>;
  cursor(): Promise<StreamsCursor>;
}

/** Published AFTER the ingest transaction commits, only for events NEW to ev_events (never for duplicates, replay or backfill). */
export type IngestedEvent =
  | { type: 'payment.settled'; payment: SettledPayment }
  | { type: 'intro.accepted'; intro: IntroAcceptedRow }
  | { type: 'intro.dropped'; venue: Address; customer: Address; referrer: Address; introHash: Hex; reason: number; txHash: Hex; logIndex: number }
  | { type: 'customer.verified'; venue: Address; customer: Address; introducer: Address; orderId: Hex; txHash: Hex; logIndex: number }
  | { type: 'venue.registered'; venue: Address; owner: Address; txHash: Hex }
  | { type: 'terms.updated'; venue: Address; terms: VenueTermsRow; txHash: Hex }
  | { type: 'venue.keys'; venue: Address; payout: Address; signer: Address; attributor: Address; txHash: Hex }
  | { type: 'seed.set'; venue: Address; ambassador: Address; allowed: boolean; txHash: Hex };

export interface StreamsBus {
  /** Returns an unsubscribe function. Listener exceptions are caught and logged; they never affect ingestion. */
  subscribe(listener: (e: IngestedEvent) => void): () => void;
}

export interface StreamsPort extends StreamsQueries {
  bus: StreamsBus;
}
