/**
 * StreamsPort — the consumer-defined interface BACKEND_RELAYER reads "settled" state through (MSG-062).
 * STREAMS_INFRA implements it over its Streams-derived tables (apps/api/src/streams/**) and an in-process bus that
 * publishes AFTER derived rows are committed. Rule (Phase 2): every "settled" fact the API reports comes from here,
 * never from relayer responses or quotes (QE-C-10).
 *
 * Until STREAMS_INFRA's implementation is wired in `app.ts`, `createStubStreamsPort()` is used: empty reads and a
 * local bus, so the API runs and reports "pending" / "waiting on Streams".
 */
import { EventEmitter } from 'node:events';
import type { Address, Hex } from 'viem';

export interface RewardLine {
  orderId: Hex;
  venue: Address;
  customer: Address;
  /** 0 CASHBACK | 1 L1 | 2 L2 */
  role: 0 | 1 | 2;
  /** RewardPaid.recipient, or RewardReturned.intendedRecipient */
  recipient: Address;
  amount: bigint;
  viaReferrer: Address;
  returned: boolean;
  /** RewardReturned.reason (0 NO_INTRODUCER, 1 SELF_PAYMENT, 2 TRANSFER_FAILED), null for RewardPaid */
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
  /** RewardPaid / RewardReturned of the same tx, in log order. */
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
  /** false once an IntroDropped for it was ingested */
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
  /** ascending by termsVersion */
  terms: VenueTermsRow[];
  seeds: Address[];
  registeredTx: Hex;
  blockNumber: bigint;
}

export interface MoneyEdge {
  orderId: Hex;
  /** customer (cashback/L1) or viaReferrer (L2) */
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
  edges: MoneyEdge[];
}

export interface AmbassadorRecord {
  address: Address;
  customersCredited: number;
  venues: Address[];
  l1Earned: bigint;
  l2Earned: bigint;
  cashbackEarned: bigint;
  /** newest first, capped */
  lines: RewardLine[];
}

export interface StreamsCursor {
  lastBlock: bigint | null;
  lastIngestAt: string | null;
}

export interface StreamsQueries {
  getPayment(venue: Address, orderId: Hex): Promise<SettledPayment | null>;
  getPaymentByTx(txHash: Hex): Promise<SettledPayment | null>;
  listPayments(filter: { venue?: Address; customer?: Address; limit?: number }): Promise<SettledPayment[]>;
  listRewardLines(filter: { recipient?: Address; venue?: Address; limit?: number }): Promise<RewardLine[]>;
  listIntrosAccepted(filter: { venue?: Address; customer?: Address; referrer?: Address; limit?: number }): Promise<IntroAcceptedRow[]>;
  getVenue(venue: Address): Promise<VenueOnchain | null>;
  getVenueStats(venue: Address): Promise<VenueStats>;
  getAmbassador(address: Address): Promise<AmbassadorRecord>;
  isVerified(venue: Address, customer: Address): Promise<boolean>;
  cursor(): Promise<StreamsCursor>;
}

/** Published after the derived rows are committed. One `payment.settled` per pay tx, aggregated with its lines. */
export type IngestedEvent = (
  | { type: 'payment.settled'; payment: SettledPayment }
  | { type: 'intro.accepted'; intro: IntroAcceptedRow }
  | { type: 'intro.dropped'; venue: Address; customer: Address; referrer: Address; introHash: Hex; reason: number; txHash: Hex; logIndex: number }
  | { type: 'customer.verified'; venue: Address; customer: Address; introducer: Address; orderId: Hex; txHash: Hex; logIndex: number }
  | { type: 'venue.registered'; venue: Address; owner: Address; txHash: Hex }
  | { type: 'terms.updated'; venue: Address; terms: VenueTermsRow; txHash: Hex }
  | { type: 'venue.keys'; venue: Address; payout: Address; signer: Address; attributor: Address; txHash: Hex }
  | { type: 'seed.set'; venue: Address; ambassador: Address; allowed: boolean; txHash: Hex }
) & { replay?: boolean };

export interface StreamsBus {
  subscribe(listener: (e: IngestedEvent) => void): () => void;
}

export interface StreamsPort extends StreamsQueries {
  bus: StreamsBus;
  /** true for the stub (lets endpoints say "waiting on Streams" explicitly). */
  readonly stub?: boolean;
}

/** Local bus helper (also handy for STREAMS_INFRA): listener errors never reach the publisher. */
export function createLocalBus(): StreamsBus & { publish(e: IngestedEvent): void } {
  const ee = new EventEmitter();
  ee.setMaxListeners(0);
  return {
    subscribe(listener) {
      const wrapped = (e: IngestedEvent) => {
        try {
          listener(e);
        } catch {
          /* a consumer bug must not break ingestion */
        }
      };
      ee.on('event', wrapped);
      return () => ee.off('event', wrapped);
    },
    publish(e) {
      ee.emit('event', e);
    },
  };
}

/** In-memory stub: empty derived state; tests push rows/events through `publish` / `putPayment`. */
export function createStubStreamsPort(): StreamsPort & {
  publish(e: IngestedEvent): void;
  putPayment(p: SettledPayment): void;
} {
  const bus = createLocalBus();
  const payments: SettledPayment[] = [];
  const lc = (a: string) => a.toLowerCase();
  const allLines = () => payments.flatMap((p) => p.lines);
  return {
    stub: true,
    bus,
    publish: bus.publish,
    putPayment(p) {
      payments.unshift(p);
    },
    async getPayment(venue, orderId) {
      return payments.find((p) => lc(p.venue) === lc(venue) && lc(p.orderId) === lc(orderId)) ?? null;
    },
    async getPaymentByTx(txHash) {
      return payments.find((p) => lc(p.txHash) === lc(txHash)) ?? null;
    },
    async listPayments(f) {
      return payments
        .filter((p) => (!f.venue || lc(p.venue) === lc(f.venue)) && (!f.customer || lc(p.customer) === lc(f.customer)))
        .slice(0, f.limit ?? 50);
    },
    async listRewardLines(f) {
      return allLines()
        .filter((l) => (!f.recipient || lc(l.recipient) === lc(f.recipient)) && (!f.venue || lc(l.venue) === lc(f.venue)))
        .slice(0, f.limit ?? 50);
    },
    async listIntrosAccepted() {
      return [];
    },
    async getVenue() {
      return null;
    },
    async getVenueStats(venue) {
      const ps = payments.filter((p) => lc(p.venue) === lc(venue));
      const lines = ps.flatMap((p) => p.lines);
      return {
        venue,
        verifiedCustomers: ps.filter((p) => p.firstPurchase).length,
        rewardedPurchases: ps.filter((p) => p.rewarded).length,
        payments: ps.length,
        gross: ps.reduce((s, p) => s + p.amount, 0n),
        rewardsPaid: lines.filter((l) => !l.returned).reduce((s, l) => s + l.amount, 0n),
        rewardsReturned: lines.filter((l) => l.returned).reduce((s, l) => s + l.amount, 0n),
        edges: [],
      };
    },
    async getAmbassador(address) {
      const mine = allLines().filter((l) => lc(l.recipient) === lc(address) && !l.returned);
      const sum = (role: number) => mine.filter((l) => l.role === role).reduce((s, l) => s + l.amount, 0n);
      const credited = new Set(mine.filter((l) => l.role === 1).map((l) => `${lc(l.venue)}:${lc(l.orderId)}`));
      return {
        address,
        customersCredited: credited.size,
        venues: [...new Set(mine.filter((l) => l.role === 1).map((l) => l.venue))],
        l1Earned: sum(1),
        l2Earned: sum(2),
        cashbackEarned: sum(0),
        lines: mine.slice(0, 50),
      };
    },
    async isVerified(venue, customer) {
      return payments.some((p) => lc(p.venue) === lc(venue) && lc(p.customer) === lc(customer));
    },
    async cursor() {
      return { lastBlock: null, lastIngestAt: null };
    },
  };
}
