import { bigint, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Phase 2 derived state, built ONLY from Vouch logs delivered by QuickNode Streams (or the byte-compatible chain
 * backfill / raw replay). Owner: STREAMS_INFRA. Own migrations folder `apps/api/drizzle-streams/` and own migrations
 * table `drizzle.__drizzle_migrations_streams` (see drizzle-streams.config.ts), so BACKEND_RELAYER's `apps/api/drizzle`
 * journal is never touched. Every table is prefixed `ev_`.
 *
 * Conventions: addresses in derived tables are EIP-55 checksummed (as viem decodes them); `ev_events.address` and all
 * hashes are lowercase hex. uint256 amounts are `numeric(78,0)` (strings in JS, exact sums in SQL). Block numbers and
 * timestamps fit in a JS number (`bigint` mode number).
 *
 * `ev_events` is the idempotency ledger: PK (tx_hash, log_index). Everything else is a pure function of `ev_events`
 * applied in (block_number, log_index) order and can be wiped and rebuilt (`rebuildDerived`).
 */

const uint = (name: string) => numeric(name, { precision: 78, scale: 0 });

/** Every accepted Vouch log, decoded. The ingestion idempotency key is (tx_hash, log_index). */
export const evEvents = pgTable(
  'ev_events',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockHash: text('block_hash'),
    txIndex: integer('tx_index'),
    /** Lowercase emitter (always a watched Vouch address). */
    address: text('address').notNull(),
    event: text('event').notNull(),
    topic0: text('topic0').notNull(),
    /** Decoded args: addresses checksummed, uint/int as decimal strings, bytes as hex. */
    args: jsonb('args').$type<Record<string, string | number | boolean>>().notNull(),
    topics: jsonb('topics').$type<string[]>().notNull(),
    data: text('data').notNull(),
    /** Unix seconds when the delivered log carries `blockTimestamp`, else null. NOT part of the determinism hash. */
    blockTimestamp: bigint('block_timestamp', { mode: 'number' }),
    /** Provenance (not hashed): 'stream' | 'replay' | 'backfill'. */
    source: text('source').notNull(),
    deliveryId: bigint('delivery_id', { mode: 'number' }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] }), index('ev_events_order_idx').on(t.blockNumber, t.logIndex)],
);

/** Single row (id = 'vouch'): the highest (block, logIndex) applied + counters. */
export const evCursor = pgTable('ev_cursor', {
  id: text('id').primaryKey(),
  lastBlock: bigint('last_block', { mode: 'number' }),
  lastLogIndex: integer('last_log_index'),
  events: integer('events').notNull().default(0),
  /** Highest batch end seen in a delivery/backfill envelope (not hashed: QuickNode and backfill batch differently). */
  lastBatchEnd: bigint('last_batch_end', { mode: 'number' }),
  rebuilds: integer('rebuilds').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per stream_deliveries row we tried to ingest (no FK: derived tables must stay wipeable). Not hashed. */
export const evIngestLog = pgTable('ev_ingest_log', {
  deliveryId: bigint('delivery_id', { mode: 'number' }).primaryKey(),
  status: text('status').notNull(), // 'ok' | 'failed'
  logs: integer('logs').notNull().default(0),
  newEvents: integer('new_events').notNull().default(0),
  duplicates: integer('duplicates').notNull().default(0),
  ignored: integer('ignored').notNull().default(0),
  error: text('error'),
  attempts: integer('attempts').notNull().default(1),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/** Venue config: VenueRegistered + VenueKeysUpdated + latest TermsUpdated. */
export const evVenues = pgTable('ev_venues', {
  venue: text('venue').primaryKey(),
  owner: text('owner').notNull(),
  salt: text('salt').notNull(),
  payout: text('payout').notNull(),
  signer: text('signer').notNull(),
  attributor: text('attributor').notNull(),
  metadataUri: text('metadata_uri').notNull(),
  termsVersion: integer('terms_version'),
  rewardBps: integer('reward_bps'),
  minOrder: uint('min_order'),
  registeredTx: text('registered_tx').notNull(),
  registeredBlock: bigint('registered_block', { mode: 'number' }).notNull(),
  keysTx: text('keys_tx'),
});

/** Terms history: one row per TermsUpdated. */
export const evTerms = pgTable(
  'ev_terms',
  {
    venue: text('venue').notNull(),
    termsVersion: integer('terms_version').notNull(),
    rewardBps: integer('reward_bps').notNull(),
    minOrder: uint('min_order').notNull(),
    effectiveAt: bigint('effective_at', { mode: 'number' }).notNull(),
    txHash: text('tx_hash').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.venue, t.termsVersion] })],
);

/** Seed ambassadors: latest SeedAmbassadorSet per (venue, ambassador). */
export const evSeeds = pgTable(
  'ev_seeds',
  {
    venue: text('venue').notNull(),
    ambassador: text('ambassador').notNull(),
    allowed: boolean('allowed').notNull(),
    txHash: text('tx_hash').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.venue, t.ambassador] })],
);

/** IntroAccepted rows (keyed by the accepting log); IntroDropped marks the matching live row dropped. */
export const evIntros = pgTable(
  'ev_intros',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    venue: text('venue').notNull(),
    referrer: text('referrer').notNull(),
    customer: text('customer').notNull(),
    introHash: text('intro_hash').notNull(),
    termsVersion: integer('terms_version').notNull(),
    linkType: integer('link_type').notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockTimestamp: bigint('block_timestamp', { mode: 'number' }),
    live: boolean('live').notNull().default(true),
    droppedReason: integer('dropped_reason'),
    droppedTx: text('dropped_tx'),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] }), index('ev_intros_vc_idx').on(t.venue, t.customer), index('ev_intros_referrer_idx').on(t.referrer)],
);

/** Verified customers: one CustomerVerified per (venue, customer), with the frozen introducer (L2 parent). */
export const evVerified = pgTable(
  'ev_verified',
  {
    venue: text('venue').notNull(),
    customer: text('customer').notNull(),
    introducer: text('introducer').notNull(),
    orderId: text('order_id').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockTimestamp: bigint('block_timestamp', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.venue, t.customer] })],
);

/** Settled payments: one PaymentSettled per (venue, orderId). */
export const evPayments = pgTable(
  'ev_payments',
  {
    venue: text('venue').notNull(),
    orderId: text('order_id').notNull(),
    customer: text('customer').notNull(),
    amount: uint('amount').notNull(),
    venueAmount: uint('venue_amount').notNull(),
    rewardPool: uint('reward_pool').notNull(),
    firstPurchase: boolean('first_purchase').notNull(),
    rewarded: boolean('rewarded').notNull(),
    weightsMode: integer('weights_mode').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockTimestamp: bigint('block_timestamp', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.venue, t.orderId] }), index('ev_payments_tx_idx').on(t.txHash), index('ev_payments_customer_idx').on(t.customer)],
);

/** Split lines: RewardPaid (returned = false) and RewardReturned (returned = true, recipient = intendedRecipient). */
export const evRewards = pgTable(
  'ev_rewards',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    orderId: text('order_id').notNull(),
    venue: text('venue').notNull(),
    customer: text('customer').notNull(),
    recipient: text('recipient').notNull(),
    role: integer('role').notNull(),
    amount: uint('amount').notNull(),
    viaReferrer: text('via_referrer').notNull(),
    returned: boolean('returned').notNull(),
    returnReason: integer('return_reason'),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockTimestamp: bigint('block_timestamp', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] }), index('ev_rewards_recipient_idx').on(t.recipient), index('ev_rewards_order_idx').on(t.venue, t.orderId)],
);

/** Per-venue aggregates (recomputed from ev_payments/ev_rewards/ev_verified for each touched venue). */
export const evVenueStats = pgTable('ev_venue_stats', {
  venue: text('venue').primaryKey(),
  verifiedCustomers: integer('verified_customers').notNull(),
  payments: integer('payments').notNull(),
  rewardedPayments: integer('rewarded_payments').notNull(),
  gross: uint('gross').notNull(),
  venueReceived: uint('venue_received').notNull(),
  rewardsPaid: uint('rewards_paid').notNull(),
  rewardsReturned: uint('rewards_returned').notNull(),
  cashbackPaid: uint('cashback_paid').notNull(),
  l1Paid: uint('l1_paid').notNull(),
  l2Paid: uint('l2_paid').notNull(),
});

/** Ambassador record per (address, venue) (recomputed from ev_rewards for each touched pair). */
export const evAmbassadors = pgTable(
  'ev_ambassadors',
  {
    address: text('address').notNull(),
    venue: text('venue').notNull(),
    /** Distinct orders with an L1 credit: RewardPaid role 1, plus RewardReturned role 1 reason TRANSFER_FAILED (INTERFACES §4 ¹). */
    customersCredited: integer('customers_credited').notNull(),
    l1Earned: uint('l1_earned').notNull(),
    l2Earned: uint('l2_earned').notNull(),
    cashbackEarned: uint('cashback_earned').notNull(),
  },
  (t) => [primaryKey({ columns: [t.address, t.venue] })],
);

/**
 * RAW-layer dedupe for `stream_deliveries` (SEC-2-10b, D-309). key = sha256(stream_id | batch_start | batch_end |
 * decoded body). A replayed signed delivery (or a QuickNode retry of a batch we already stored) maps to the first row
 * instead of adding one. This is NOT derived state: wipeAll/rebuild never touch it, and it is not hashed.
 * It lives in this migrations folder so the shared apps/api/drizzle journal is not touched.
 */
export const evDeliveryKeys = pgTable('ev_delivery_keys', {
  key: text('key').primaryKey(),
  deliveryId: bigint('delivery_id', { mode: 'number' }).notNull(),
  repeats: integer('repeats').notNull().default(0),
  firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
  lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
});
