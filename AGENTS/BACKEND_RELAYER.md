# BACKEND_RELAYER
_Last updated: 2026-11-18 by BACKEND_RELAYER (Phase 5 pulled forward, session 3: demo seed on the hosted api, D-812..D-814)_

## Mission
Owns the API service: DB schema, auth/session, venue/order/intro/payment endpoints, venue order signing, payment quotes (baseline attribution + attributor signature), the relayer wallet (nonce mgmt, retries, rate limits, max-gas guard, friendly error mapping) and SSE fan-out. Does NOT own contract logic, the Streams webhook/derived-state ingestion (STREAMS_INFRA), or attribution scoring internals (ATTRIBUTION_AI, from Phase 4).

## Owned paths
- `apps/api/**` except `apps/api/src/streams/**`, `apps/api/src/routes/webhooks.ts`, `apps/api/src/webhooks.test.ts`, `apps/api/drizzle-streams/**` (STREAMS_INFRA)
- `apps/api/src/attribution/baseline.ts` (Phase 2 only; ATTRIBUTION_AI takes it in Phase 4)
- `scripts/story/` (story:api CLI)
- `scripts/seed/**` (seed:demo CLI; `.state/` is gitignored) + `docs/evidence/phase-5/seed/**`
- Shared and minimal: `apps/api/src/app.ts` (route registration), `apps/api/src/db/schema.ts` (my tables, below `stream_deliveries`)

## Current status
🟢 **Demo seed done on the hosted api (D-812..D-814).** `seed:demo` created 3 live venues with 13 personas, 42 relayed txs and 16 payments ($59.70), all settled via the live Stream within about 1 s.
- **Venues:** Lena's café `0x9a40C2b1Da073Fea51A63B92f868A78969c56289` (15%), Kiln Bakery `0xDbf2Ffc4fdD279c4D32e99b03B6C6abC2D1fA494` (12%, min $3), Pressed `0x82891F492E93192F1b5cd3cEF48f6C0B56D56b4c` (20%). Dashboards are at `https://vouch-ubc.vercel.app/venue/<addr>`.
- **Canonical pay:** `0x83214e73…f980`. The receipt's USDC Transfer logs give exactly 10.20 / 0.45 / 0.693 / 0.297 / 0.252 (Marco) / 0.108 (Sofia).
- **Spend:** DEPLOYER $12.68, relayer gas $0.243. A re-run is a no-op.
- **Evidence:** `docs/evidence/phase-5/seed/seed-summary.{json,md}`.

🟢 **Phase 3 API additions code-complete (D-811), not deployed yet.** The Orchestrator deploys after Phase 2 Part B.
- `POST/GET /demo/topup`: a capped, once-per-address testnet top-up. It is off unless `DEMO_TOPUP_ENABLED=true`.
- `GET /venues/:venue/payments`: the venue feed.
- `/stats` edges gain `level` + display names.
- api tests 128/128.

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
| `apps/api/src/demo/topup.ts` | `DemoTopup`: eligibility, atomic claim (`demo_topups` conditional upsert + rolling-24 h cap in one statement, in-process serialized), per-IP limiter, funder floor, `budgetExempt` relay job (ERC-20 transfer on USDC), SSE `wallet.topup` | D-811; funder = `TOPUP_PRIVATE_KEY` Relayer or the main relayer (`services.ts` `topupFunder`) |
| `apps/api/src/routes/demo.ts` | `GET/POST /demo/topup` | POST is `spend` route class |
| `apps/api/src/relayer/budget.ts` | `SpendBudget`: hourly/daily windows (global, per user, per venue); reserve → adjust → settle/release; `seed` at boot | D-808; `relay_txs.fee_usdc` |
| `apps/api/src/http/security.ts` | `fastifyOptions` (redacting log serializers, `trustProxy` = 100.64.0.0/10), `applySecurity` (headers + 404 shape), `corsOptions` | D-809; used by `app.ts` |
| `apps/api/src/http/redact.ts` | `scrub` (URLs → `<url>`, tokens), `redactUrl` (`token=[redacted]`) | SEC-2-03/07 |
| `apps/api/src/auth/session.ts` | challenge / verify / token / revoke, `tokenFrom` | D-802 |
| `apps/api/src/attribution/baseline.ts` | `Attributor` interface + `baselineAttributor`, `sharesToBps` | D-805; ATTRIBUTION_AI replaces it in Phase 4 |
| `apps/api/src/ports/streams.ts` | StreamsPort types + `createStubStreamsPort` (tests) + `createLocalBus` | Mirrors `streams/types.ts` |
| `apps/api/src/routes/*.ts` | `api.ts` (plugin, per-IP route-class limiter `routeClass()`, scoped error handler, budget seeding), auth, venues, orders, intros, payments, reads, events (SSE + bus fan-out), views, common | |
| `apps/api/src/sse/hub.ts` | channels `user:<addr>` / `venue:<addr>`; caps (global / per IP / per channel), max age, drops slow consumers, 15 s heartbeat | Hijacked replies set CORS + security headers themselves |
| `apps/api/src/db/schema.ts` + `drizzle/0002_relayer_core.sql` (+ `0003`, `0004_demo_topups`) | my 11 tables (`demo_topups` added, D-811) | `pnpm --filter @vouch/api exec drizzle-kit generate --name …` |
| `apps/api/src/test/*.test.ts` | api (endpoint contract + canonical story on FakeChain), relayer, auth, attribution, sse, errors, topup, feed | `fake-chain.ts` = in-memory Vouch rules; `helpers.ts` = personas / sign-in / signTd |
| `scripts/seed/plan.ts` (+ `plan.test.ts`) | Pure seed plan: venues, personas, ordered steps; `simulatePlan` replays contract rules (D-505/D-508/D-509), `computeSplit` (D-503), `baselineBps`, `planFunding` | Edit the plan here; tests catch rule breaks |
| `scripts/seed/demo-seed.ts` | Runs the plan on the hosted api: chain-checked idempotent steps, retries/pacing, just-in-time funding, canonical Transfer-log check, summary | State in `scripts/seed/.state/` (keys 0600, gitignored) |
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
    - `GET /venues/:venue/stats` (edges + `level`, `fromDisplayName`, `toDisplayName`, D-811)
    - `GET /venues/:venue/payments?limit≤50&before=` → `{venue, payments, nextBefore}` (D-811)
  - **Demo (D-811):**
    - `GET /demo/topup` → `{enabled, eligible, amount, dailyRemaining, reason?, topup}`
    - `POST /demo/topup` (Bearer) → 202 `{status:"pending", amount, txHash, relayId}`; SSE `wallet.topup`
    - `GET /relay/:id`
    - `GET /relayer/status`
  - **SSE:**
    - `GET /events/user/:address?token=` (own address only)
    - `GET /events/venue/:venue` (public)
    - Events: `payment.pending`, `payment.failed`, `payment.settled`, `reward.paid`, `intro.pending`, `intro.failed`, `intro.accepted`, `intro.dropped`, `customer.verified`, `venue.pending`, `venue.failed`, `venue.registered`, `venue.action.pending`, `venue.action.failed`, `terms.updated`, `venue.keys`, `seed.set`.
  - **Dropped from the v0 draft:** `POST /onboarding/topup`. It is replaced by the capped `POST /demo/topup` (D-811).

## Done (rolling, newest first)
- 2026-11-18 — **Demo seed (Phase 5, pulled forward; D-812..D-814).**
  - **What it is:** `scripts/seed/{plan.ts,plan.test.ts,demo-seed.ts}` plus `pnpm --filter @vouch/scripts seed:demo`. The scripts `test` glob now also runs `seed/*.test.ts` (23/23 pass). `.gitignore` gains `scripts/seed/.state/`.
  - **Hosted run:** 3 venues, 10 personas + 3 owners, 42 relayed txs, 16 payments, volume $59.70. Every payment settled via Streams. The canonical split is exact on chain (checked from the Transfer logs, and independently with a raw `eth_getTransactionReceipt`).
  - **Spend:** DEPLOYER $12.68 (topup CLI). $42.28 was recycled from seed venue revenue. Relayer gas $0.243.
  - **Hosted stats:** café 6 verified / 7 payments / 20 edges, Kiln 5/5/12, Pressed 4/4/12.
  - **Re-run:** sends nothing. `pnpm -r typecheck` is clean.
- 2026-11-18 — **Phase 3 API additions (D-811, MSG-083).**
  - **Demo top-up:**
    - `GET/POST /demo/topup`: once per address (PK + conditional upsert; only a `failed` attempt can re-claim), a global rolling-24 h cap, a per-IP grant limit, and a funder floor.
    - The funder is `TOPUP_PRIVATE_KEY` (its own Relayer) or the relayer key through the relayer queue.
    - Top-ups are budget-exempt from D-808, and SSE sends `wallet.topup`.
    - Relayer jobs can now target another contract (`job.to`). The `ChainClient` `simulate`/`estimateGas`/`send` take an optional `to`.
  - **Venue feed:** `GET /venues/:venue/payments` (keyset paging; display names). STREAMS_INFRA's `listPayments` gained an optional `before` (read-only, MSG-089).
  - **Stats:** `/stats` edges gain `level`, `fromDisplayName` and `toDisplayName`.
  - **Tests:** api 128/128 (+12 topup, +4 feed); `pnpm -r typecheck` clean (incl. apps/web at the time).
  - **Curl check:** a key-less local run (scrubbed env, PGlite memory, :4011) confirmed the disabled / 401 / 400 / 404 paths.
- 2026-11-17 — **Security + QE fix pass** (SEC-2-02..13, QE-2-01..09; D-807..D-810).
  - **Spend controls:**
    - spend budget (global / user / venue, hourly + daily; reverts count; persisted via `relay_txs.fee_usdc`; shown in `/relayer/status`);
    - per-kind quotas;
    - pay priority lane + reserved slots;
    - balance floor + ALERT log;
    - minimum order $0.50;
    - re-simulation before replacements.
  - **Request hardening:**
    - per-IP route-class limits;
    - `trustProxy` = Railway range;
    - bearer-only auth (`?token=` on SSE only, no cookie);
    - log/URL redaction;
    - SSE caps + backpressure drop + max age + known venues only;
    - security headers, a standard 404, CORS PATCH;
    - no config disclosure.
  - **Payments state:** atomic intent claim before the pre-simulation (QE-2-01); orders change only on chain-confirmed outcomes.
  - **Contract fixes:** payout/boolean validation, ORDER_EXPIRED at pay, 404s, `/venues` registered-only + paginated, link opens count only the customer's own signed-in opens.
  - **Tests:** api 112/112; `pnpm -r typecheck` clean.
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
- [ ] The seed's owner wallets end with little USDC, because their revenue funded later customers (D-812). Dashboards read Streams stats, so they still look right. If someone demos an owner's own wallet screen, top it up first.
- [ ] After the Orchestrator deploys D-811: set `DEMO_TOPUP_ENABLED=true` on Railway (optionally `TOPUP_PRIVATE_KEY` + fund it). Then run a hosted check: `GET /demo/topup` → `enabled:true`, plus one real top-up to a fresh wallet.
- [ ] N-1: reserve part of the relayer budget for `pay` (cap non-pay kinds at ~50% of the global windows).
- [ ] On Railway: set `RELAYER_PRIVATE_KEY`, `ATTRIBUTOR_PRIVATE_KEY`, `VENUE_SIGNER_PRIVATE_KEY`, `SESSION_SECRET` and `PUBLIC_WEB_URL`. Then run `story:api -- --api https://<railway> --require-settled` (the exit criterion with the live Stream).
- [ ] After deploy: check in the hosted logs that `remoteAddress` is the client (not 100.64.x). If Railway's edge appends its own hop, set `TRUST_PROXY` to a hop count (D-809, UNVERIFIED).
- [ ] Phase 3: TTL cleanup for unbounded tables (link_opens, sessions, relay_txs, payment_intents, orders, owner_actions, intro_links; auth_challenges and stale prepared venues are already pruned).
- [ ] Relayer crash recovery: on boot, reconcile `relay_txs` rows left in `sent` (today the chain-nonce reconcile covers the nonce, but the row status stays `sent`).
- [ ] Staff accounts for order creation (today only the venue owner's session may create orders).
- [ ] Rate limits + the in-flight budget are in-memory (the budget is re-seeded from Postgres at boot): fine for one Railway instance; move to Postgres if we ever scale out.
- [ ] Phase 4: hand `attribution/baseline.ts` to ATTRIBUTION_AI (the `Attributor` interface stays).

## Struggles, open questions, known issues
- **Cookies:** not accepted (SEC-2-09). Bearer only; `?token=` is accepted only on the SSE user route and is redacted from logs.
- **Who verifies signatures:** the FakeChain does not verify signatures. Signature correctness is proven by the off-chain verification in the API plus the live story run.
- **Mixed-clock order status:** `GET /venues/:venue/orders/:orderId` decides "expired" with server time; quotes and pays use chain time.
- **`/me/activity` scope:** it also shows a persona's payments from earlier smoke venues (they are real Streams rows).
- **Demo top-up limits:**
  - **One instance:** the cap is serialized in-process. Two api instances could overshoot the daily cap by one top-up per race; adding an advisory lock would fix that.
  - **Shared IP:** venue Wi-Fi shares one IP, so 5 grants per IP per hour may be too low for a judge table. Raise `DEMO_TOPUP_PER_IP_PER_HOUR` for the demo.
  - **Fake identities:** they are free, so the daily cap ($30) is the real bound.
- **Feed `settledAt`:** null while Streams logs lack `blockTimestamp` (UNVERIFIED live).

## How to run / test this area
```bash
pnpm --filter @vouch/api test                       # node:test, PGlite memory, FakeChain (no RPC)
pnpm --filter @vouch/api typecheck
# own instance (never :4000 / :3000); separate PGlite dir; loads root env via the pnpm script
PORT=4010 DATABASE_URL=pglite://./data/local/pglite-backend-relayer-4010 STREAMS_SPIKE_LOG=off pnpm --filter @vouch/api start
pnpm --filter @vouch/scripts story:api -- --api http://localhost:4010 --fund-from-payout   # ≈ $0.05 relayer gas
pnpm --filter @vouch/scripts story:api -- --api http://localhost:4010 --check-intent <intentId>
pnpm --filter @vouch/scripts seed:demo -- --dry-run         # validate plan, print expected splits + persona addresses (no network writes)
pnpm --filter @vouch/scripts seed:demo                      # hosted api by default; resumable; a re-run is a no-op
pnpm --filter @vouch/scripts seed:demo -- --summary-only    # re-read hosted stats/feeds → docs/evidence/phase-5/seed/
# local "settled" without a Stream (stop the api first: PGlite is single-process):
pnpm --silent --filter @vouch/scripts streams:backfill --db-url pglite://./data/local/pglite-backend-relayer-4010
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md` (D-801..D-806), and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/BACKEND_RELAYER.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
