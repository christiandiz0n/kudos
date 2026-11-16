# BACKEND_RELAYER
_Last updated: 2026-11-16 by BACKEND_RELAYER (Phase 2)_

## Mission
Owns the API service: DB schema, auth/session, venue/order/intro/payment endpoints, venue order signing, payment quotes (baseline attribution + attributor signature), the relayer wallet (nonce mgmt, retries, rate limits, max-gas guard, friendly error mapping) and SSE fan-out. Does NOT own contract logic, the Streams webhook/derived-state ingestion (STREAMS_INFRA), or attribution scoring internals (ATTRIBUTION_AI, from Phase 4).

## Owned paths
- `apps/api/**` except `apps/api/src/streams/**`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/webhooks.test.ts`, `apps/api/drizzle-streams/**` (STREAMS_INFRA)
- `apps/api/src/attribution/baseline.ts` (Phase 2 only; ATTRIBUTION_AI takes it in Phase 4)
- `scripts/story/` (story:api CLI)
- Shared and minimal: `apps/api/src/app.ts` (route registration), `apps/api/src/db/schema.ts` (my tables, below `stream_deliveries`)

## Current status
🟢 **Phase 2 code complete.**
- `story:api` ran the canonical story on Arc testnet through the API: 9 relayed txs, exact $12 split, relayer gas $0.048.
- The local run reported "settled" as "waiting on Streams", because a local instance gets no webhook deliveries. Reading the same DB after STREAMS_INFRA's chain backfill showed `settled` with the exact split.
- **Not yet done:** a live-Stream "settled" check against the Railway api. That needs the relayer keys + SESSION_SECRET set on Railway and the production Stream active.

## Mental model (read this first)
```
browser wallet key (passkey-gated EOA, D-104)            apps/api (Fastify, one process)
  sign EIP-191 challenge ───────────── POST /auth/* ───▶ Sessions (HMAC token + sessions row)
  sign typed data the API prepares ─── POST …/prepare ─▶ reads chain (nonces, currentTerms, chain time) → typed data
  send signature back ──────────────── POST …         ─▶ verify sig off-chain → pre-checks → Relayer.submit()
                                                            │ (serialized: simulate → preflight → estimate ≤ cap → fees
                                                            │  → nonce → send → wait receipt / replace +25%)
                                                            ▼
                                                      Arc: Vouch v3 (RELAYER = msg.sender = auth.submitter)
                                                            │ logs
  SSE /events/user|venue  ◀── "pending"/"failed" (relay) ───┤
                          ◀── "settled" (StreamsPort.bus) ◀─ QuickNode Stream → /webhooks/streams → ev_* (STREAMS_INFRA)
  GET reads ──────────────────────────────────────────────▶ StreamsPort queries (ev_*)  + chain (wallet balance)
```
- **Two kinds of state.**
  - **My tables (relay state only):** `users, auth_challenges, sessions, venues_meta, owner_actions, orders, intro_links, link_opens, payment_intents, relay_txs` (migration `drizzle/0002_relayer_core.sql`).
  - **Everything "settled"** (paid orders, splits, verified customers, on-chain terms, stats, ambassador records) is read through `StreamsPort` (`ports/streams.ts`; implemented by STREAMS_INFRA's `createStreams`, MSG-062/063).
  - The `/payments/:id` status is `pending` until `getPayment()` returns a row.
- **Venue onboarding.**
  - Registration always sets the venue's `signer` / `attributor` to our VENUE_SIGNER / ATTRIBUTOR keys. Payout defaults to the owner.
  - Owner actions (registerVenue, updateTerms, setKeys, setSeedAmbassador) are two-step and only at the current `nonces(owner)`. A moved nonce gives `OWNER_NONCE_STALE`. One action in flight per owner (D-804).
- **Quote.**
  - Inputs: the live intros from chain (`getLiveIntros`) plus link opens from my DB, scored by baseline v1 (D-805).
  - Weights are signed by ATTRIBUTOR, then run through `previewPayment`.
  - `PaymentAuth.submitter` is the RELAYER (`mode: self-submit` → the customer; never 0).
  - The customer signs the USDC `ReceiveWithAuthorization`; its nonce = hashStruct(PaymentAuth).
- **Pay.**
  - The API first verifies the signature, checks balance ≥ amount (QE-C-11) and pre-simulates.
  - `OrderAlreadySettled` is terminal (409, split from Streams, QE-C-10).
  - Otherwise it relays and answers `202 pending`.
- **Relayer (D-801).**
  - One job at a time, so there is never more than one nonce in flight.
  - A gap or external use is reconciled against the chain's `pending` count.
  - Every revert is terminal; transport errors are retried.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `apps/api/src/app.ts` (shared) | `buildApp(overrides, {logger, api})` → registers `apiRoutes` with `createApiDeps(db, streams, opts.api)` | `opts.api` lets tests inject `chain`, `cfg`, `streams`, `attributor`, `relayerOptions` |
| `apps/api/src/config.ts` | `loadApiConfig()`: keys, SESSION_SECRET, gas caps, fee cap, retry/limit knobs | Placeholders count as unset (→ 503s, fail closed) |
| `apps/api/src/services.ts` | `createApiDeps`, `createSigners` (Order / Weights signing), `dbRelayStore` | |
| `apps/api/src/chain/client.ts` | `ChainClient` (narrow reads + relayer primitives), `createViemChainClient`, `decodeRevert` | Swap in a fake for tests |
| `apps/api/src/chain/errors.ts` | revert → code (`revertCode`), send-error classification | D-806 |
| `apps/api/src/relayer/relayer.ts` | `Relayer` (queue, `NonceManager`, simulate / pre-flight / gas guard / fees / replacement), `clampFees` | D-801 |
| `apps/api/src/relayer/preflight.ts` | QE-C-11 balance checks (relayed; self-submit amount + fee) | |
| `apps/api/src/relayer/rate-limit.ts` | sliding-window `RateLimiter` | in-memory |
| `apps/api/src/auth/session.ts` | challenge / verify / token / revoke, `tokenFrom` | D-802 |
| `apps/api/src/attribution/baseline.ts` | `Attributor` interface + `baselineAttributor`, `sharesToBps` | D-805; ATTRIBUTION_AI replaces it in Phase 4 |
| `apps/api/src/ports/streams.ts` | StreamsPort types + `createStubStreamsPort` (tests) + `createLocalBus` | Mirrors `streams/types.ts` |
| `apps/api/src/routes/*.ts` | `api.ts` (plugin + scoped error handler), auth, venues, orders, intros, payments, reads, events (SSE + bus fan-out), views, common | |
| `apps/api/src/sse/hub.ts` | channels `user:<addr>` / `venue:<addr>`, 15 s heartbeat | Hijacked replies echo the allowed CORS origin themselves |
| `apps/api/src/db/schema.ts` + `drizzle/0002_relayer_core.sql` | my 10 tables | `pnpm --filter @vouch/api exec drizzle-kit generate --name …` |
| `apps/api/src/test/*.test.ts` | api (endpoint contract + canonical story on FakeChain), relayer, auth, attribution, sse, errors | `fake-chain.ts` = in-memory Vouch rules; `helpers.ts` = personas / sign-in / signTd |
| `scripts/story/story-api.ts` | Phase 2 exit driver: canonical story on Arc through the API; `--check-intent <id>` re-checks settled | `pnpm --filter @vouch/scripts story:api` |

## Interfaces consumed / provided
- **Consumes:**
  - `@vouch/shared` (ABI, typed data, deployments, money).
  - `StreamsPort` from STREAMS_INFRA (`createStreams`; queries + `bus`).
  - Vouch v3 reads: `previewPayment`, `getLiveIntros`, `getTerms`, `nonces`, …
- **Provides (proposed INTERFACES §5, also in my Phase 2 report):**
  - **Conventions:** amounts are base-unit strings or `{baseUnits, display}`. Errors are `{error: {code, message, retryable, details?}}`. Auth is `Authorization: Bearer <token>`. Typed data comes back as `{domain, types, primaryType, message}` with uint fields as decimal strings; convert them to BigInt before signing.
  - **Auth:**
    - `POST /auth/challenge {address}` → `{challengeId, message, expiresAt}`
    - `POST /auth/verify {address, challengeId, signature, displayName?, passkeyCredentialId?}` → `{token, expiresAt, user}`
    - `GET /auth/session`
    - `POST /auth/logout`
    - `PATCH /me {displayName}`
  - **Venues:**
    - `POST /venues/prepare {name, rewardBps, minOrder, payout?, description?, slug?}` → `{venue, slug, typedData}`
    - `POST /venues {venue, signature}` → 202 `{venue, status: "pending", txHash, relayId}`
    - `GET /venues`
    - `GET /venues/:venue`
    - `PATCH /venues/:venue`
    - `GET /venues/:venue/terms`
  - **Owner actions:**
    - `POST /venues/:venue/actions {kind: updateTerms|setKeys|setSeedAmbassador, …}` → `{actionId, typedData}`
    - `POST /venues/:venue/actions/:id {signature}` → 202
    - `GET /venues/:venue/actions/:id`
  - **Orders:**
    - `POST /venues/:venue/orders {amount, ttlSeconds?, label?}` → 201 `{order, signature, qrPayload, …}`
    - `GET /venues/:venue/orders` (owner)
    - `GET /venues/:venue/orders/:orderId` (public; `status: pending|relayed|failed|expired|paid`, `settled`)
  - **Intros:**
    - `POST /intros/prepare {venue, linkType, ttlDays?}` → `{intro, typedData}`
    - `POST /intros {intro, signature, note?}` → 201 `{code, url, introHash}`
    - `GET /intros/:code`, which includes `status: active|expired|needs_reissue` and `reissueBy`
    - `POST /intros/:code/opens`
    - `POST /intros/:code/accept/prepare` → `{acceptance, typedData}`
    - `POST /intros/:code/accept {acceptance, signature}` → 202
    - `GET /me/links`
  - **Payments:**
    - `POST /payments/quote {venue, orderId, whoSentYou?, mode?}` → `{intentId, quote, attribution, weights, weightsSignature, paymentAuth, typedData, balance, canAfford, warnings}`
    - `POST /payments {intentId, signature}` → 202 `{intentId, status: "pending", txHash, relayId}`
    - `GET /payments/:intentId` (`status: pending|settled|failed`, `settled` from Streams)
  - **Reads:**
    - `GET /me/wallet`
    - `GET /me/activity`
    - `GET /ambassadors/:address`
    - `GET /venues/:venue/stats`
    - `GET /relay/:id`
    - `GET /relayer/status`
  - **SSE:**
    - `GET /events/user/:address?token=` (own address only)
    - `GET /events/venue/:venue` (public)
    - Events: `payment.pending`, `payment.failed`, `payment.settled`, `reward.paid`, `intro.pending`, `intro.failed`, `intro.accepted`, `intro.dropped`, `customer.verified`, `venue.pending`, `venue.failed`, `venue.registered`, `venue.action.pending`, `venue.action.failed`, `terms.updated`, `venue.keys`, `seed.set`.
  - **Dropped from the v0 draft:** `POST /onboarding/topup` (the CLI exists).

## Done (rolling, newest first)
- 2026-11-16 — **Phase 2.**
  - **Delivered:**
    - schema + migration 0002;
    - auth (D-802);
    - venues + owner actions (D-804);
    - orders (VENUE_SIGNER);
    - intro links / opens / accept with re-issue flags (D-516);
    - quote with baseline attribution (D-805) and ATTRIBUTOR-signed weights;
    - relayed pay with the QE-C-10/QE-C-11 handling (D-803);
    - relayer (D-801);
    - read endpoints over StreamsPort;
    - SSE and bus fan-out;
    - friendly errors (D-806);
    - `story:api` CLI.
  - **Tests:** api 78/78 (44 mine + STREAMS_INFRA's), shared 10, scripts 13; `pnpm -r typecheck` clean.
  - **Live run:** `story:api` on Arc. Canonical pay `0x4660d5bb…da06`, exact 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108, weightsMode 1, relayer gas $0.0477 for 9 txs.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] On Railway: set `RELAYER_PRIVATE_KEY`, `ATTRIBUTOR_PRIVATE_KEY`, `VENUE_SIGNER_PRIVATE_KEY`, `SESSION_SECRET` and `PUBLIC_WEB_URL`. Then run `story:api -- --api https://<railway> --require-settled` (the exit criterion with the live Stream).
- [ ] Relayer crash recovery: on boot, reconcile `relay_txs` rows left in `sent` (today the chain-nonce reconcile covers the nonce, but the row status stays `sent`).
- [ ] Staff accounts for order creation (today only the venue owner's session may create orders).
- [ ] Rate limits are in-memory: fine for one Railway instance; move to Postgres if we ever scale out.
- [ ] Phase 4: hand `attribution/baseline.ts` to ATTRIBUTION_AI (the `Attributor` interface stays).

## Struggles, open questions, known issues
- **Cookies:** the token is accepted as a cookie, but the API never sets one. A cross-site cookie (web origin ≠ Railway domain) would need `SameSite=None; Secure`. Bearer is the supported path.
- **Who verifies signatures:** the FakeChain does not verify signatures. Signature correctness is proven by the off-chain verification in the API plus the live story run.
- **Mixed-clock order status:** `GET /venues/:venue/orders/:orderId` decides "expired" with server time; quotes and pays use chain time.
- **`/me/activity` scope:** it also shows a persona's payments from earlier smoke venues (they are real Streams rows).

## How to run / test this area
```bash
pnpm --filter @vouch/api test                       # node:test, PGlite memory, FakeChain (no RPC)
pnpm --filter @vouch/api typecheck
# own instance (never :4000 / :3000); separate PGlite dir; loads root env via the pnpm script
PORT=4010 DATABASE_URL=pglite://./data/local/pglite-backend-relayer-4010 STREAMS_SPIKE_LOG=off pnpm --filter @vouch/api start
pnpm --filter @vouch/scripts story:api -- --api http://localhost:4010 --fund-from-payout   # ≈ $0.05 relayer gas
pnpm --filter @vouch/scripts story:api -- --api http://localhost:4010 --check-intent <intentId>
# local "settled" without a Stream (stop the api first: PGlite is single-process):
pnpm --silent --filter @vouch/scripts streams:backfill --db-url pglite://./data/local/pglite-backend-relayer-4010
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-801..D-806), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/BACKEND_RELAYER.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
