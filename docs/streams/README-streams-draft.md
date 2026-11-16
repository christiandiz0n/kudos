# DRAFT: README "QuickNode Streams" section

_Draft by STREAMS_INFRA (2026-11-16, Phase 2). DOCS_SUBMISSION owns the final README; copy, trim or restyle freely. Every value here is checked against the repo (D-306, D-307, runbook §P)._

---

## QuickNode Streams: the source of truth for everything that happened

Vouch never trusts its own backend about money. When the relayer submits a payment, the app can show it as *pending*. It only becomes *settled* once **QuickNode Streams** delivers the contract's `PaymentSettled` event. Every number a user sees is rebuilt from Streams events: the split receipt, cashback, the ambassador record, verified customers, live intros, venue terms, and the venue's cost per verified customer.

### The Stream
| Setting | Value |
|---|---|
| Network | Arc Testnet (`arc-testnet`) |
| Dataset | `logs` |
| Start block | `72605845` (the Vouch v3 deploy block), streaming continuously, no end |
| Filter | [`docs/streams/filter-vouch.js`](docs/streams/filter-vouch.js). It keeps logs whose `address` is Vouch `0xF4B641dc628de05336aa983B07D5d181254ff08e` **and** whose topic0 is one of our 10 events. It returns `null` for everything else, so nothing is sent for blocks without Vouch activity. That drops USDC transfers and Arc's EIP-7708 system logs. |
| Events | `VenueRegistered`, `TermsUpdated`, `VenueKeysUpdated`, `SeedAmbassadorSet`, `IntroAccepted`, `IntroDropped`, `CustomerVerified`, `PaymentSettled`, `RewardPaid`, `RewardReturned` |
| Destination | Webhook → `https://api-production-902bc54c.up.railway.app/webhooks/streams` (Fastify on Railway, Postgres) |
| Security | Every delivery is verified with QuickNode's HMAC (`X-QN-Signature` = HMAC-SHA256(token, nonce + timestamp + body)). The check is constant-time and fails closed when no token is configured. |
| Config as data | [`infra/streams/stream-vouch-prod.json`](infra/streams/stream-vouch-prod.json) |

### What happens to a delivery
```
Arc block ─▶ QuickNode Stream (logs + filter-vouch.js) ─▶ POST /webhooks/streams
   1. HMAC verify (401 on a bad signature, 503 if no token is set)
   2. store the raw delivery in stream_deliveries   (answers 500 if this fails → QuickNode retries)
   3. decode the logs with the shared Vouch ABI, then INSERT … ON CONFLICT (txHash, logIndex) DO NOTHING
   4. apply the new events in (block, logIndex) order → venues, terms, intros, verified customers,
      payments, reward lines, venue stats, ambassador records      (one transaction)
   5. publish the new events on the in-process bus → Server-Sent Events to the venue and customer screens
```
- **Idempotent:** QuickNode retries, overlapping batches and replays are no-ops, because the key is `(transactionHash, logIndex)`.
- **Order-independent:** if a batch arrives late, the derived tables are rebuilt from the event log in chain order. The state depends only on *which* events exist, not on when they arrived.
- **Never loses a delivery:** the raw body is stored before we answer 200. An ingestion bug is recorded and retried from the stored delivery. It never forces QuickNode to retry the delivery until the Stream pauses.

### Prove it: replay and backfill give the same state
```bash
pnpm --silent --filter @vouch/scripts streams:verify
```
This builds the derived state three independent ways and compares a SHA-256 over every derived table:
1. **chain backfill:** `eth_getLogs` from the deploy block in ≤10k-block chunks, passed through the *same* filter file, then the same ingest code;
2. **live:** the same blocks delivered as 5-block QuickNode-style batches through the real, HMAC-checked webhook, with every batch sent twice plus one overlapping batch;
3. **replay:** wipe the derived tables, then rebuild them from the stored raw deliveries.

```
chain-backfill   0b0c880dbc314569c80ba1d2df8c569d3072bb6b9c660cbdcf454d7bf45c1f34  (events=48 … payments=6 rewards=22 …)
live (webhook)   0b0c880dbc314569c80ba1d2df8c569d3072bb6b9c660cbdcf454d7bf45c1f34
replay (copy)    0b0c880dbc314569c80ba1d2df8c569d3072bb6b9c660cbdcf454d7bf45c1f34
replay (wipe)    0b0c880dbc314569c80ba1d2df8c569d3072bb6b9c660cbdcf454d7bf45c1f34
rebuild          0b0c880dbc314569c80ba1d2df8c569d3072bb6b9c660cbdcf454d7bf45c1f34
OK: chain-backfill == live == replay == rebuild
```
Against the hosted database (`railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:verify --db`), the check compares what the production Stream actually delivered with a fresh chain backfill over the same blocks.

### The canonical payment, as Streams delivered it
Block `72606074`, tx `0x95cbda97…673e`, Ben pays **$12.00** at Lena's café:

| Event (logIndex) | Meaning | Amount |
|---|---|---|
| `CustomerVerified` (74) | Ben is now a verified customer | — |
| `PaymentSettled` (90) | venue receives | **$10.20** |
| `RewardPaid` (91) role 0 | Ben's welcome cashback | **$0.45** |
| `RewardPaid` (92, 93) role 1 | Ana / Priya, direct referrers | **$0.693 / $0.297** |
| `RewardPaid` (94, 95) role 2 | their introducers | **$0.252 / $0.108** |

`venueAmount + Σ RewardPaid = amount` exactly. The test suite checks these rows (`apps/api/src/streams/ingest.test.ts`).

### Code map
| Path | What |
|---|---|
| `docs/streams/filter-vouch.js` | The filter pasted into the QuickNode dashboard |
| `apps/api/src/routes/webhooks.ts` | HMAC-verified webhook, raw persistence, ingest hook |
| `apps/api/src/streams/` | Decode, idempotent ingest, derived tables (`schema.ts`, migrations in `apps/api/drizzle-streams/`), queries, event bus, determinism hash, backfill |
| `scripts/backfill/streams-derive.ts` | `streams:verify`, `streams:backfill`, `streams:replay`, `streams:hash` |
| `docs/streams/S3-RUNBOOK.md` §P | Exact Stream settings and dashboard "Test filter" expectations |
