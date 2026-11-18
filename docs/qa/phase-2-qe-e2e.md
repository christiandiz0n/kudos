# Phase 2 QE gate (QE_E2E): backend, relayer, Streams pipeline

_QE_E2E, 2026-11-17 UTC. Target: HEAD `6e8ad48` (Vouch v3 `0xF4B641dc628de05336aa983B07D5d181254ff08e`, Arc Testnet 5042002). Evidence is in `docs/evidence/phase-2/qe/`. Harnesses are in `scripts/qa/`. Everything was checked against INTERFACES §2–§7 and DECISIONS. Builder reports were not used._

## Part A verdict: **PASS-with-findings**. READY FOR PART B.

| # | Acceptance item | Result |
|---|---|---|
| 1 | API matches INTERFACES §5 (happy path + key errors) | **PASS-with-findings**: 157 live checks. One Medium (QE-2-01) and several Low/Info contract gaps, filed (MSG-075, MSG-076). |
| 2 | Determinism: chain-backfill == live == replay == rebuild | **PASS**. The reference hash `0b0c880d…5c1f34` (to 72612484, 48 events) reproduced; `73a460fd…ed04870` at head 72622899 (72 events). Independent re-derivation matches the derived rows exactly. |
| 3 | Hosted derived state == chain | **PASS**: 73/73 checks over 72605845..72624473 (72 events, 3 venues). See note on the range. |
| 4 | Webhook rejects unsigned/forged | **PASS**: 11/11 hosted probes. |
| 5 | Story through the api exact on chain, settled via Streams (local) | **PASS**: exact 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 on chain. `--check-intent` reports settled from streams with the same split after `streams:backfill`. |

### Working-tree caveat
While Part A ran, other agents started editing `apps/api` in this checkout (uncommitted D-808/D-809 and SEC-2-01 fixes). The files changed between 02:03:26 and 02:05:57 UTC; `git status` shows them.
- **Ran on clean HEAD 6e8ad48 code** (api instance A started 02:01:5x): the api unit tests (78/78), both `streams:verify` runs, the noauth matrix, `story:api`, and `api-contract main`.
- **Ran on the working tree**:
  - `api-contract settled` and `story:api --check-intent` (api restarted about 02:15). These only touch route files with no diff vs HEAD: `payments.ts`, `orders.ts`, `venues.ts`, `reads.ts`, `views.ts`, `streams/queries.ts`.
  - `api-contract guards` (max-gas + rate limit). `relayer/relayer.ts` and `config.ts` had uncommitted changes then. At HEAD, the same guards are covered by `relayer.test.ts`, which passed at 01:4x. Re-run `guards` on the next commit (Part B).
  - The local gzip probe. Its result shows the in-progress SEC-2-01 fix, not HEAD.
- The independent checks (`independent-derive.mjs`) use neither tree's code.

## 1. API contract tests (INTERFACES §5, D-801..D-806)
Harness: `scripts/qa/api-contract.ts`. It drives a live local api (`127.0.0.1:4030`, `pglite://<scratch>`, real Arc testnet, the api's own RELAYER / VENUE_SIGNER / ATTRIBUTOR keys) using only throwaway QE wallets: O (owner), C (customer, $0.20 from `topup`), U (unfunded), X (bystander).

| Phase | Checks | Result | Evidence |
|---|---|---|---|
| noauth: 23 auth-required routes without a token, the public reads, auth flow, validation | 54 | 53 ok, 1 FAIL (`?token=` = SEC-2-03) | `api-contract-noauth.txt` |
| main: venue register, orders, quotes, QE-C-10, QE-C-11, intros, owner actions, expiry, double submit | 89 | 83 ok, 6 FAIL: QE-2-01/03/04/05, plus 2 harness-accounting misses (the referrer's own open used 1 of the 10 per-IP opens, so 9 anonymous were recorded; not a product defect) | `api-contract-main.txt` |
| settled (after `streams:backfill` into the api DB) | 8 | 8 ok | `api-contract-settled.txt` |
| guards (api with `RELAYER_MAX_GAS_PAY=100000`, `RELAYER_RATE_PER_USER_PER_MIN=2`) | 6 | 6 ok | `api-contract-guards.txt` |

Behaviour confirmed:
- **Auth required:** every authed route answers `401 UNAUTHENTICATED` with the D-806 shape `{error:{code,message,retryable}}`. Also:
  - a challenge replay → 401;
  - a challenge signed by the wrong key → `400 INVALID_SIGNATURE`;
  - a tampered token payload → 401;
  - logout revokes the token → 401;
  - SSE to someone else's channel → 403.
- **Expired order:** a quote after expiry → `410 ORDER_EXPIRED`. A pay of a fresh quote after the order expired → `410 PAYMENT_EXPIRED` (QE-2-06), with nothing sent. The public order status reads `expired`.
- **Insufficient balance (QE-C-11, relayed):**
  - The quote answers 200 with `canAfford:false` and warning `insufficient_balance`.
  - `POST /payments` → `402 INSUFFICIENT_BALANCE` with `{balance:"0", needed, shortfall}`. Relayer nonce unchanged. The intent stays `quoted`, so it can be retried.
- **Self-submit (QE-C-11):** for `amount ≤ balance < amount + 900k × maxFee`, the relayed quote gives `canAfford` true and the self-submit quote gives `402` with `details.selfSubmit`. A self-submit quote names `submitter = customer`, and `POST /payments` refuses it with 400.
- **OrderAlreadySettled → 409 terminal (QE-C-10):** C settled the order with a self-submit auth from its own EOA (`0x2ddeb2f7…7cec`). Then `POST /payments` with C's relayed intent for the same order gives:
  - `409 ORDER_ALREADY_PAID`, `retryable:false`, `waitingOnStreams:true`, nothing sent. A repeat gives 409 again.
  - `GET /payments/:id` → `relayStatus:"already_settled"`, `status:"pending"`.
  - After Streams ingestion: `status:"settled"`, with the split taken from events (venue 10000, no lines) and `details.settled` populated on a re-quote.
- **Submitter never 0:** every relayed quote names `RELAYER` and every self-submit quote names the customer. The code asserts it too.
- **Rate limits:**
  - per-user: the 3rd relay in a minute gets `429 RATE_LIMITED` with `retryAfterMs`;
  - link opens: 10 per IP per code per minute;
  - challenge: 30 per IP per minute (code review).
  - On Railway, IP keys are the rotating `100.64.0.x` proxy hops (SEC-2-04).
- **Max-gas guard:** a pay estimate of 303k × 1.2 against a cap of 100k → `422 GAS_TOO_HIGH {kind:"pay", gasLimit, cap}`. Relayer nonce unchanged.
- **Shapes:**
  - the §5 shapes hold for `POST /venues/prepare`, `POST /venues` 202, orders 201, quote, payments 202, `GET /payments/:id`, `/relay/:id`, `/me/wallet`, `/me/activity`, `/intros*`, owner actions, `/relayer/status`, `/health`;
  - `GET /events/venue/:v` is a public `text/event-stream`.

### Findings (API)
| ID | Sev | Finding | Owner / msg |
|---|---|---|---|
| QE-2-01 | **Medium** | A concurrent double `POST /payments` on one intent returns 202 + 409, and the losing duplicate rewrites the PAID intent to `already_settled` / `ORDER_ALREADY_PAID`. The payment then disappears from `/me/activity` and `/me/wallet` `pending` until Streams catches up, and the duplicate spends a second rate token and a second simulation. The cause is a non-atomic `quoted → relaying` claim in `routes/payments.ts`. | BACKEND_RELAYER, MSG-075 |
| QE-2-03 | Low | `POST /venues/prepare` accepts `payout` = Vouch or USDC. It is refused only at relay simulation, after the owner has signed. | BACKEND_RELAYER, MSG-076 |
| QE-2-04 | Low | `setSeedAmbassador {allowed:"true"}` (a string) silently prepares `allowed:false`, a revocation. | MSG-076 |
| QE-2-05 | Low | `GET /intros/:code` `terms.minOrder` is `{baseUnits}` with no `display`. | MSG-076 |
| QE-2-06 | Info | An expired QR at pay time answers `PAYMENT_EXPIRED`, where D-806 implies `ORDER_EXPIRED`. Both are 410. | MSG-076 |
| QE-2-07 | Low | `GET /venues` lists only API-registered venues. Hosted it answers `[]` while 3 venues are served by `/venues/:v`. | MSG-076 |
| QE-2-08 | Info | Unknown venue: `/venues/:v` answers 404, while `/terms` and `/stats` answer 200 with empty data. | MSG-076 |
| QE-2-09 | Info | GAS_TOO_HIGH and other nothing-sent failures mark the order `failed` even though it is still payable. | MSG-076 |
| QE-2-02 | Low (docs) | INTERFACES §3 has a second "Full typehashes" block that still lists PaymentAuth `0x83204ea1…b253`, the pre-D-012 type without `submitter`. Correct value: `0xf9bd6d8f…7abcba4` (re-derived). Delete the stale block. | Proposed INTERFACES change (Orchestrator) |
| SEC-2-01/03/04/05 | (SECURITY_REVIEW) | Reproduced independently and not re-filed: `?token=` accepted on `/auth/session` and full URLs in Railway logs; `req.ip` = `100.64.0.x` hops; anonymous opens counted (10); gunzip before auth at HEAD, which the working tree now fixes (local probe: unsigned → 401 with no inflation; forged → 413). | SECURITY_REVIEW |

## 2. Streams determinism
- `pnpm --filter @vouch/scripts streams:verify` (real chain, 72605845..72622899, 72 logs, 43 signed POSTs, all 200): every path gives `73a460fdab9b24e3d876108c38c371450e7261dd704b7bc99392be633ed04870`. Evidence: `streams-verify.txt`.
- The same with `--to 72612484` (48 logs) reproduces the D-306 / runbook §P.3 reference `0b0c880dbc314569c80ba1d2df8c569d3072bb6b9c660cbdcf454d7bf45c1f34` on every path. Evidence: `streams-verify-to-72612484.txt`.
- **Independent check** (`scripts/qa/independent-derive.mjs`): no api code and no Streams filter.
  - Event signatures are typed in from §4, and all 10 topic0s match the table. Raw `eth_getLogs` is decoded with viem.
  - The model is built from the §4 "rebuild" table.
  - Result: conservation (`venueAmount + ΣRewardPaid == amount`) and dust ≤ 2 per referrer hold for every payment. On-chain `getVenueStats` / `getAmbassadorStats`, read via `eth_call` at the same block, equal the model for every venue and ambassador, at both 72606174 and head.
  - Canonical pay `0x95cbda97…673e` from its raw receipt:
    - event order `CustomerVerified@74, PaymentSettled@90, RewardPaid@91..95` (cashback → L1 → L2);
    - amount 12,000,000 / venue 10,200,000 / pool 1,800,000, weightsMode 1;
    - RewardPaid 450,000 / 693,000 / 297,000 / 252,000 / 108,000;
    - the **USDC `Transfer` logs** match exactly: customer → Vouch 12.00, Vouch → each recipient = its RewardPaid amount, Vouch → payout = 10.20, Σ out = 12.00;
    - L2 `viaReferrer` = the matching L1.
  - That pay's `ev_payments` / `ev_rewards` rows in a `streams:backfill` PGlite DB equal the receipt field for field.
  - Evidence: `independent-derive-head.txt`, `independent-split-vs-derived-rows.txt`. The self-submit pay `0xfca0e1ae…c7be` gives the same result.

## 3. Hosted derived state vs chain (read-only)
- Venues come from VenueRegistered logs: `0xf315D0B0…2005`, `0x88Da03C2…52Cf`, `0x374E084A…8b89`.
- Compared per venue: `/venues/:v` (config, terms history, seeds), `/venues/:v/terms`, and `/venues/:v/stats` (counts, gross, rewardsPaid/Returned, venueReceived, byRole, costPerVerifiedCustomer, every money-graph edge).
- Compared per address: `/ambassadors/:a` (customersCredited, venues, earned by role, the 50 most recent lines).
- **Over 72605845..72624473 (72 events): 73/73 equal.** Evidence: `hosted-vs-chain-head.txt`.
- **Range note:** the brief says the Stream delivered up to 72606174, but the hosted DB also holds the third venue, registered at block **72613566** (`0x19988756…d443`), and its 24 later events. A comparison limited to ≤ 72606174 matches both venue reads and all 4 on-chain stat reads, but the hosted ambassadors include the later venue (expected; `hosted-vs-chain-72606174.txt`). So the Stream (or an earlier deployment) delivered past 72606174. Hosted == chain over everything up to head before this QE run. Update the brief/runbook figure.
- Not possible without Postgres public networking (declined): a hosted `streams:verify --db` hash or a cursor read. `/me/activity`, which carries the cursor, needs a session, and the hosted api has no `SESSION_SECRET` yet.

## 4. Webhook on the hosted api (INTERFACES §6)
`bash scripts/qa/webhook-probes.sh https://api-production-902bc54c.up.railway.app`: 11 single requests, no load. Evidence: `webhook-probes-hosted.txt`.

| Probe | Expected | Got |
|---|---|---|
| no `X-QN-*` headers / nonce+ts without a signature | 401 missing-signature-headers | 401, 401 |
| forged signature: zeros, non-hex, a fake PaymentSettled envelope, a valid gzip body, text/plain, an empty body | 401 bad-signature | 401 ×6 |
| `Content-Encoding: gzip` + garbage, headers present | 400 body-decode-failed | 400 |
| gzip garbage, no headers | 401 | 401 |
| GET | 404 | 404 |

The Railway log lines (`webhook-probes-hosted-railway-logs.txt`) show `verified:false`, with status, reason and bytes only: no body, no labels. The hosted state was unchanged afterwards (the forged PaymentSettled was not ingested). The gzip bomb was NOT sent to the hosted api (SEC-2-01).

## 5. Local end-to-end story through the api
`pnpm --filter @vouch/scripts story:api -- --api http://127.0.0.1:4030 --fund-from-payout`: **STORY ON-CHAIN OK** (`story-api-local.txt`).
- New venue `0xBAd7D0083f590C0C36638DA86237d00c9b2dbDbb`, 9 relayed txs plus 1 funding tx (hashes in `txs-and-gas.txt`).
- Canonical pay `0x8f2ea5c0fe009ef083b5048bdc43f8508f6fbd94895527d77f0c4edfc8617168` (block 72625160):
  - baseline weights 7000/3000;
  - PaymentAuth.submitter = RELAYER, and `pay()` was sent by the relayer;
  - RewardPaid `C:Ben:450000 L1:Ana:693000 L1:Priya:297000 L2:Sam:252000 L2:Ana:108000`;
  - balance deltas Lena +10.20, Ben −11.55, Ana +0.801, Priya +0.297, Sam +0.252.
- With no Stream on the local api, it reported "WAITING ON STREAMS", as designed.
- Then:
  1. Stop the api.
  2. `streams:backfill -- --db-url pglite://<that DB>` → 101 events, hash `e9bde4e5…80ee`.
  3. Restart the api.
  4. `story:api -- --check-intent 7b3cee64-377a-4168-a2f3-5e1edd12c887 --require-settled` → **status settled · source streams · block 72625160**, `cashback:Ben:0.45 · referrer:Ana:0.693 · referrer:Priya:0.297 · introducer:Sam:0.252 · introducer:Ana:0.108`, venue $10.20 (`story-api-local-check-intent.txt`).
- The independent receipt check of this pay also passes against chain, USDC transfers and the derived rows (`independent-story-pay-vs-derived.txt`).

**Spend:** about 0.054 USDC gas in total (relayer 0.0476). Also $0.20 moved from the deployer to the QE customer wallet (about $0.176 left there). Details: `txs-and-gas.txt`.

## READY FOR PART B: what QE needs
1. The **hosted relayer enabled**: on Railway, the api has `RELAYER_PRIVATE_KEY`, `ATTRIBUTOR_PRIVATE_KEY`, `VENUE_SIGNER_PRIVATE_KEY` and `SESSION_SECRET` set. `GET /relayer/status` must show `enabled:true` with both signers. The relayer key has about 19.67 USDC.
2. The **production Stream `vouch-v3-production` ACTIVE**, delivering to `/webhooks/streams`.
3. Ideally, the D-808/D-809/SEC-2-01 working-tree changes committed and deployed first, so Part B tests one known build. Tell QE the deployed commit.
4. Then QE will:
   - run `story:api -- --api https://api-production-902bc54c.up.railway.app --fund-from-payout --require-settled` and measure relay-receipt → derived row (`GET /payments/:id` settled, plus SSE `payment.settled` on `/events/venue/:v`);
   - check `railway logs --service api --filter "streams delivery"` for `verified:true`, `ingest.newEvents > 0`;
   - re-run `independent-derive.mjs --hosted … --onchain` over the new range;
   - re-run `api-contract guards`;
   - then ask the Orchestrator to have the human **pause** the Stream.

## Reproduce
```bash
pnpm --filter @vouch/api test
pnpm --silent --filter @vouch/scripts streams:verify [-- --to 72612484]
node scripts/qa/independent-derive.mjs --onchain --tx 0x95cbda97e7a015b6c105f07cf364b3cc258cc6769cd13a10ce8ae0697280673e [--to N] [--hosted https://api-production-902bc54c.up.railway.app] [--pglite <dir>]
bash scripts/qa/webhook-probes.sh https://api-production-902bc54c.up.railway.app
PORT=4030 API_HOST=127.0.0.1 DATABASE_URL=pglite://<scratch>/db STREAMS_SPIKE_LOG=off pnpm --filter @vouch/api start
scripts/node_modules/.bin/tsx scripts/qa/api-contract.ts setup|noauth|main|guards|settled --api http://127.0.0.1:4030 --state <scratch>/qe-state.json
pnpm --filter @vouch/scripts story:api -- --api http://127.0.0.1:4030 --fund-from-payout
```

## Part B (hosted), attempt 1 (2026-11-18): **NOT RUN: readiness timed out**
- **Target:** the deployed commit `920a042` (HEAD `cf547f3`, docs only). `TRUST_PROXY=2` (D-018).
- **Readiness poll:** every 30 s, 17:05:22Z..17:30:10Z (50 polls, the full 25 min). Evidence: `part-b-readiness-poll.txt`.
  - (a) `GET /relayer/status` showed `enabled:false, reachable:null, lowBalance:null` on every poll. The relayer secrets never reached the hosted api.
  - (b) `railway logs … --filter "streams delivery"` showed 0 `verified:true` lines. The newest lines are QE's 401 probes from 2026-11-17. The Stream never delivered.
- **Not done** (each needs both conditions): hosted `story:api --require-settled`, tap→settled latency, the delivery-log check, and the hosted vs chain re-compare. **No hosted transactions were sent, and there was no spend.** The 15-minute time box never started.
- **Done meanwhile: `guards` on the deployed code** (local api on 127.0.0.1:4032, clean `920a042` code, `pglite://memory`). **7/7 PASS**. Evidence: `part-b-guards-local.txt`.
  - The relayer key was the unfunded throwaway QE key X (`RELAYER_PRIVATE_KEY` set inline, overriding the env file), so nothing could ever be broadcast. X's nonce stayed 0, and the real relayer key was never loaded.
  - Settings: `RELAYER_MAX_GAS_PAY=100000`, `RELAYER_RATE_PER_USER_PER_MIN=2`, `ORDER_MIN_USDC=0.01`.
  - **QE-2-01 re-test PASS:** a concurrent duplicate `POST /payments` now gets `409 PAYMENT_ALREADY_USED` at the intent claim, and it uses no rate token.
  - Max-gas guard: `422 GAS_TOO_HIGH` (gasLimit 303,102 > cap 100,000) twice. Then `429 RATE_LIMITED` with `retryAfterMs`. Nothing was sent.
- **Ready to resume.** The wrapper `scripts/qa/story-latency.mjs` runs `story:api` against the hosted api and timestamps every line. Once `registerVenue` has mined, it opens the public SSE channel `/events/venue/:venue`. It records the `payment.settled` arrival time against the pay tx's block time, writing to `part-b-story-latency.ndjson`.

## Part B (hosted), attempt 2 (2026-11-18 17:51–18:20Z): **PASS-with-findings**
_Target: Railway deployment `ce50f9ff` (created 17:43:05Z, after the secrets were applied; code `920a042` per D-018 / attempt 1; Railway metadata carries no commit hash). Relayer `enabled:true, reachable:true, lowBalance:false`, balance 19.6706 at the start. Stream `vouch-v3-production` (`6b792277-…df8`), activated "Continue where it left off" at ~17:40Z._

| # | Acceptance item | Result |
|---|---|---|
| 1 | Canonical story through the hosted api, exact on chain | **PASS**: `STORY OK (on-chain + settled in DB via Streams)`. Pay `0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb` (block 72890535). Venue 10.20 / cashback 0.45 / L1 0.693 + 0.297 / L2 0.252 + 0.108, re-derived independently from the raw receipt and USDC `Transfer` logs. |
| 2 | Settled via the live Stream | **PASS**: verified delivery of block 72890535 (`newEvents` 7, `events` 141). `GET /payments/:id` → `settled`, `source streams`. |
| 3 | tap→settled latency | **About 0.3 s after the relay receipt; 1.0 s after the 202.** SSE `payment.settled` came +0.144 s after the receipt and +0.81 s after block time. `GET /payments/:id` settled at +0.296 s. |
| 4 | Delivery logs: verified, `ingest.newEvents > 0` | **PASS**: 28/28 `streams delivery` lines on `ce50f9ff` are `verified:true`, status 200, each with `newEvents ≥ 1` and `duplicates 0`. None are unverified. |
| 5 | Hosted DB == chain (`independent-derive --hosted --onchain`) | **PASS**: 177 ok, 0 FAIL over 72605845..72890596 (141 logs, 9 venues). The receipt check of the canonical pay passes. |
| 6 | Completeness (the 2 QuickNode dashboard errors) | **No events missing.** The 2 errors were retried or predate the data. Chain has 141 Vouch logs, and hosted ingested 141 (`ingest.events` 141 at the last delivery). Every venue and ambassador read equals the chain. |
| 7 | `api-contract guards` against hosted | **Not run (by design).** That mode needs an api started with `RELAYER_MAX_GAS_PAY=100000` and `RATE_PER_USER_PER_MIN=2`. On hosted's production caps it would broadcast real relayed pays (and $0.01 orders fall below hosted `ORDER_MIN_USDC` 0.50) instead of hitting the guards. The guards passed 7/7 on the same `920a042` code in attempt 1 (`part-b-guards-local.txt`). |

### Readiness and time box
- **Last on-chain Vouch event before activation:** block **72625258**, from `eth_getLogs` in 10k windows. That was 101 logs.
- **Catch-up reached it:** hosted verified that delivery at 17:46:59Z server time (`ingest.events` 101, equal to the chain's 101).
- **Gap estimate:** 261,877 empty blocks, at a net ~148 blocks/s. That gave an ETA of about 18:16:30Z.
- **Actual T0:** the Stream was at head earlier. Its first live delivery was block 72889670 at **18:08:58Z**, when head was 72889564 at 18:08:08. So **T0 = 18:08:58Z**.
- **Within the box:** the story ran 18:15:49–18:16:16Z and the hosted-vs-chain compare finished at 18:17:29Z, both inside the 20-min box.
- Evidence: `part-b-readiness-attempt2.txt`.
- **Other traffic:** someone else used the hosted api during the window. Venues `0x4b4917…d8f4`, `0xf57ad2…66ea` and `0xE5e387…7588` ("Shots café 18:16", owner `0xD4f504…b201`) appeared at 18:08–18:16Z, and the relayer spent about 0.030 USDC before the story. Hosted == chain covers their events too. No interference: the relayer queue serialized everything.

### Latency (`part-b-latency-summary.txt`)
| Step (UTC) | t | vs relay receipt | vs block time (18:16:15, 1 s resolution) |
|---|---|---|---|
| `POST /payments` → 202 | 18:16:14.793 | −0.874 s | |
| Relay receipt seen | 18:16:15.667 | 0 | |
| Delivery of block 72890535 logged (server) | 18:16:15.814 | +0.147 s | +0.81 s |
| SSE `payment.settled` | 18:16:15.811 | +0.144 s | +0.81 s |
| `GET /payments/:id` → settled | 18:16:15.963 | +0.296 s | +0.96 s |

- **The other 8 story txs:** each delivery was logged within −0.32..+0.39 s of the story's receipt line (mixed clocks).
- **The `GET /payments/:id` figure is pessimistic.** The story's first poll comes after its on-chain checks, so the settle time it prints ("after 0.1s") is measured from that poll.

### Findings
| ID | Sev | Finding | Owner / msg |
|---|---|---|---|
| QE-2-10 | Info | **SEC-2-10 / D-309(d) is still unverified.** The `streams delivery` log line does not include the `X-QN-Timestamp` value or its unit. The only place the unit is logged is the skew warning, which fires only when \|skew\| > 300 s, and there were 0 such lines across 28 live and catch-up deliveries. What this does show: under the digit-count rule (≤11 digits = s, ≥12 = ms), the header is the current wall-clock time and not the block time. During the catch-up, blocks were ~2 days old and still produced no skew line. The unit itself (s vs ms) is not observable from the logs. Fix: add `ts.unit` / `skewSec` to the delivery line, or read `timestamp.unit` from the spike log / raw row. | STREAMS_INFRA (msg below) |
| — | Note | The QuickNode catch-up ran faster than 150 blocks/s. About 264k blocks took ≤ 22 min, so more than ~200 blocks/s. | — |

### Re-checks on hosted (read-only)
- **QE-2-08:** fixed. `/venues/:unknown`, `/terms` and `/stats` all answer `404 UNKNOWN_VENUE`.
- **QE-2-05:** fixed. `GET /intros/:code` `terms.minOrder` = `{baseUnits:"1000000", display:"1.00"}`.
- **QE-2-07:** `GET /venues` lists API-registered venues, as D-810 documents.
- **QE-2-03/04/06/09:** not re-tested on hosted. Each needs owner-signed prepares or orders. Carry to Thursday.

**Spend:** relayer gas 0.04443949 USDC for 9 txs (balance 19.640411 → 19.595972). Lena also moved +$11.55 to Ben (`0x9e43d7e6…cdb0`). That is a demo-wallet transfer; the net returns to Lena through the venue split, minus cashback and rewards.

**Evidence:** `part-b-readiness-attempt2.txt`, `part-b-story-latency.txt` / `.ndjson`, `part-b-railway-deliveries.txt`, `part-b-latency-summary.txt`, `part-b-hosted-vs-chain-pre.txt` (pre-story: 105/105, 101 events), `part-b-hosted-vs-chain.txt` + `part-b-independent-model.json` (post-story: 177/177, 141 events).

**Phase 2 gate verdict (QE): PASS-with-findings.** The Stream can be paused.
