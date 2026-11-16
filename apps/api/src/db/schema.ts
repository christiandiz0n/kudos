import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Phase 0: a single trivial table proving migrations run on both PGlite (local/tests) and Postgres
 * (deploy). BACKEND_RELAYER owns the real schema (Phase 2).
 */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Phase 1.5 (D-305): raw ingest of every HMAC-VERIFIED QuickNode Streams delivery, written before the 200 is sent.
 * Rejected requests (401/503/400) never get a row. This is the hosted, inspectable record; Phase 2 derives
 * decoded/idempotent tables from it (or from a replay). Not deduplicated: QuickNode retries may appear twice.
 */
export const streamDeliveries = pgTable(
  'stream_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    verified: boolean('verified').notNull(),
    /** `stream-id` header, else the envelope's `streamId`. */
    streamId: text('stream_id'),
    /** `batch-start-range`/`batch-end-range` headers (authoritative, QE-15), else the body's batch range. */
    batchStart: bigint('batch_start', { mode: 'number' }),
    batchEnd: bigint('batch_end', { mode: 'number' }),
    /** Logs found in the body (`summary.logCount`). */
    eventCount: integer('event_count').notNull().default(0),
    /** Request bytes as received (before gunzip). */
    bytes: integer('bytes').notNull(),
    gzip: boolean('gzip').notNull().default(false),
    /** Allow-listed non-secret headers: content-*, user-agent, x-qn-nonce, x-qn-timestamp, stream-*, batch-*. Never x-qn-signature. */
    headers: jsonb('headers').$type<Record<string, string>>().notNull(),
    /** Parsed digest (shape, eventNames, txHashes, topic0s, blockRange, batch). */
    summary: jsonb('summary'),
    /** Decoded JSON body; null when the body is not JSON (then `body_text` holds it). */
    body: jsonb('body'),
    bodyText: text('body_text'),
  },
  (t) => [index('stream_deliveries_received_at_idx').on(t.receivedAt), index('stream_deliveries_stream_batch_idx').on(t.streamId, t.batchStart)],
);

// =====================================================================================================================
// BACKEND_RELAYER (Phase 2). Off-chain app state only: users/sessions, venue metadata, signed orders/intros, link
// opens, payment intents and relay transactions. NOTHING event-derived lives here: "settled", verified customers,
// on-chain terms, rewards and stats come from STREAMS_INFRA's ev_* tables (apps/api/src/streams/schema.ts).
// Addresses are stored checksummed; amounts as bigint base units (6-dec USDC fits int8); uint256 nonces as text.
// =====================================================================================================================

/** One row per wallet (the passkey-gated browser EOA, D-104). */
export const users = pgTable('users', {
  address: text('address').primaryKey(),
  displayName: text('display_name'),
  passkeyCredentialId: text('passkey_credential_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One-time sign-in challenges (EIP-191 message signed by the wallet key). */
export const authChallenges = pgTable('auth_challenges', {
  id: text('id').primaryKey(),
  address: text('address').notNull(),
  message: text('message').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Sessions. The bearer token is HMAC(SESSION_SECRET) over {sid, sub, exp}; the row allows revocation (logout). */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    address: text('address').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_address_idx').on(t.address)],
);

/**
 * Venue metadata (UI fields + what we asked the owner to sign). On-chain config/terms are derived by STREAMS_INFRA;
 * the reward fields here are the values from the registration form (display/defaults only).
 */
export const venuesMeta = pgTable(
  'venues_meta',
  {
    venue: text('venue').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    salt: text('salt').notNull(),
    payout: text('payout').notNull(),
    signer: text('signer').notNull(),
    attributor: text('attributor').notNull(),
    rewardBps: integer('reward_bps').notNull(),
    minOrder: bigint('min_order', { mode: 'bigint' }).notNull(),
    metadataUri: text('metadata_uri').notNull(),
    /** prepared → relaying → registered | failed */
    status: text('status').notNull().default('prepared'),
    /** The RegisterVenue message (bigints as strings) the owner signed. */
    typedMessage: jsonb('typed_message').notNull(),
    ownerNonce: text('owner_nonce').notNull(),
    deadline: bigint('deadline', { mode: 'bigint' }).notNull(),
    relayTxId: text('relay_tx_id'),
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('venues_meta_owner_idx').on(t.owner)],
);

/** Relayed owner actions other than registration (updateTerms, setKeys, setSeedAmbassador), each at the CURRENT nonces(owner) (D-013(3)). */
export const ownerActions = pgTable(
  'owner_actions',
  {
    id: text('id').primaryKey(),
    venue: text('venue').notNull(),
    owner: text('owner').notNull(),
    kind: text('kind').notNull(),
    typedMessage: jsonb('typed_message').notNull(),
    ownerNonce: text('owner_nonce').notNull(),
    deadline: bigint('deadline', { mode: 'bigint' }).notNull(),
    /** prepared → relaying → relayed | failed | superseded */
    status: text('status').notNull().default('prepared'),
    signature: text('signature'),
    relayTxId: text('relay_tx_id'),
    txHash: text('tx_hash'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('owner_actions_owner_idx').on(t.owner, t.status)],
);

/** Venue-signed orders (the QR). orderId is unique per venue only. Status is the RELAY view; "paid" comes from Streams. */
export const orders = pgTable(
  'orders',
  {
    venue: text('venue').notNull(),
    orderId: text('order_id').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'bigint' }).notNull(),
    signature: text('signature').notNull(),
    /** pending → relayed | failed */
    status: text('status').notNull().default('pending'),
    label: text('label'),
    createdBy: text('created_by').notNull(),
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.venue, t.orderId] })],
);

/** Referrer-signed intro links (personal / broadcast). `code` is the short public link id. */
export const introLinks = pgTable(
  'intro_links',
  {
    code: text('code').primaryKey(),
    venue: text('venue').notNull(),
    referrer: text('referrer').notNull(),
    /** 0 personal, 1 broadcast */
    linkType: integer('link_type').notNull(),
    termsVersion: integer('terms_version').notNull(),
    issuedAt: bigint('issued_at', { mode: 'bigint' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'bigint' }).notNull(),
    nonce: text('nonce').notNull(),
    signature: text('signature').notNull(),
    introHash: text('intro_hash').notNull().unique(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('intro_links_referrer_idx').on(t.referrer), index('intro_links_venue_idx').on(t.venue)],
);

/** Link opens (attribution signal). opener = session address when signed in. IP is stored hashed. */
export const linkOpens = pgTable(
  'link_opens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    code: text('code').notNull(),
    opener: text('opener'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('link_opens_code_idx').on(t.code)],
);

/** A quote the customer may sign, and what happened when it was submitted. Never the source of the settled split. */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: text('id').primaryKey(),
    venue: text('venue').notNull(),
    orderId: text('order_id').notNull(),
    customer: text('customer').notNull(),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    /** previewPayment result (bigints as strings) */
    quote: jsonb('quote').notNull(),
    weights: jsonb('weights').notNull(),
    weightsSig: text('weights_sig').notNull(),
    weightsHash: text('weights_hash').notNull(),
    attribution: jsonb('attribution'),
    /** PaymentAuth (bigints as strings) */
    auth: jsonb('auth').notNull(),
    submitter: text('submitter').notNull(),
    deadline: bigint('deadline', { mode: 'bigint' }).notNull(),
    /** quoted → relaying → relayed | failed | already_settled */
    status: text('status').notNull().default('quoted'),
    relayTxId: text('relay_tx_id'),
    txHash: text('tx_hash'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payment_intents_order_idx').on(t.venue, t.orderId), index('payment_intents_customer_idx').on(t.customer)],
);

/** Every relayed transaction (one row per job; `hashes` lists fee-bumped replacements). */
export const relayTxs = pgTable(
  'relay_txs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    ref: text('ref').notNull(),
    userAddress: text('user_address').notNull(),
    /** queued → sent → mined | reverted | failed */
    status: text('status').notNull(),
    nonce: integer('nonce'),
    hash: text('hash'),
    hashes: jsonb('hashes').$type<string[]>().notNull().default([]),
    attempts: integer('attempts').notNull().default(0),
    gasLimit: bigint('gas_limit', { mode: 'bigint' }),
    maxFeePerGas: text('max_fee_per_gas'),
    gasUsed: bigint('gas_used', { mode: 'bigint' }),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    errorCode: text('error_code'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('relay_txs_ref_idx').on(t.ref), index('relay_txs_status_idx').on(t.status)],
);
