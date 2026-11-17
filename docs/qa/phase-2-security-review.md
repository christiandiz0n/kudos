# Phase 2 security review: relayer API and Streams ingestion

_Reviewer: SECURITY_REVIEW (independent, built none of this). Reviewed 2026-11-16, repo HEAD `6e8ad48`, hosted api `api-production-902bc54c.up.railway.app` (relayer, session and signer secrets not set yet)._
_Scope: `apps/api/**`, the `packages/shared` deps, `Dockerfile`, `.dockerignore`, `.gitignore`, `railway.json`, the full git history, and one request per check against public endpoints. Heavy probes were run only against a local api. No product code was changed and nothing was deployed. No chain transactions were sent. `.env` was never read._
_Evidence: `docs/evidence/phase-2/security/`._

## Verdict after re-verification (2026-11-17, HEAD `aab31f2`, fixes in `920a042`): **PASS-with-notes**

- Both Highs are FIXED, and so are all four Mediums.
- SEC-2-10 is PARTIAL: the replay window stays log-only on purpose (D-309d) until the timestamp unit is confirmed.
- Residual notes are listed under "Re-verification" at the end of this file. None of them blocks the gate.
- **It is safe for the human to set `RELAYER_PRIVATE_KEY` on Railway now**, under the conditions listed in that section.

## Original verdict (2026-11-16, HEAD `6e8ad48`): BLOCKED pending fixes

- Two High findings were open:
  - SEC-2-01 is reachable in production today.
  - SEC-2-02 must be fixed before the relayer key is set on Railway.
- The coordinator has already routed all fixes to STREAMS_INFRA and BACKEND_RELAYER, so this review sends no MSGs.
- Re-verification happens after the fixes are committed and redeployed, under the same rules: one request per check against hosted, heavy probes local only.

## High

### SEC-2-01 (High): webhook decodes the body before authentication; body and inflation size are unbounded
- **Class:** resource exhaustion on an unauthenticated endpoint (decompression and buffering before auth).
- **Where:** `apps/api/src/routes/webhooks.ts`
  - `:181` buffers bodies up to 50 MiB.
  - `:64-68` inflates gzip with no output cap.
  - `:201-205` decodes before the secret, header and signature checks at `:209-223`.
  - `:234-241` turns unverified bodies into strings and parses them as JSON.
- **Impact:** one small unauthenticated request can drive api memory into the GB range. On Railway that means an OOM restart: the whole api goes down, webhook deliveries are interrupted, and the Stream may auto-pause. The local api went from 70 MB to 1.6 GB RSS. This was not tested against hosted.
- **Required fix:**
  1. Reject before reading the body when the secret is unset, a header is missing, or the signature is malformed.
  2. Inflate asynchronously with an output cap of a few MiB, and answer 413 when it is exceeded.
  3. Lower `bodyLimit` to a few MiB.
  4. Do not stringify or parse unverified bodies.
  5. Add a regression test.
- **Evidence:** `local-probe-gzip-bomb.txt`.

### SEC-2-02 (High): relayer gas spend is not bounded and one global lane serves every job kind
- **Class:** missing spend budget and abuse controls on a sponsored-gas relayer (Sybil-able quota).
- **Where:**
  - `apps/api/src/relayer/relayer.ts:156-166`: the limits are per session address per minute, one global limiter and one queue.
  - `apps/api/src/config.ts:58-65,81-85`: the defaults.
  - `apps/api/src/routes/orders.ts:28`: orders down to 1 base unit.
  - `apps/api/src/routes/venues.ts:72-162`: no registration quota.
- **Impact:**
  - Identities cost nothing, so per-address limits don't bound total spend.
  - There is no daily or global gas budget and no circuit breaker. The relayer balance can run down to `RELAYER_UNDERFUNDED`.
  - One actor can fill the shared global limit and queue, so honest payments get `RELAYER_BUSY`.
  - Testnet funds only, but it takes the demo down.
- **Required fix:**
  1. Persisted per-address and global daily gas budgets with a circuit breaker.
  2. Per-kind quotas (venue registration, owner actions, intro accepts).
  3. A separate, reserved lane for `pay`, so other kinds cannot starve it.
  4. A minimum amount for relayed orders, or excluding self-dealing.
  5. Reverted relays count against the user's budget.
  6. A low-balance floor and alert.
- **Evidence:** code review (cited lines); `hosted-probes.txt` H7 confirms the relayer is currently disabled.

## Medium

### SEC-2-03 (Medium): session bearer token is accepted in the URL on every route and logged
- **Class:** credential in the URL, retained in logs.
- **Where:**
  - `apps/api/src/auth/session.ts:155-164`: `tokenFrom` accepts `?token=` on all routes, not only SSE.
  - `apps/api/src/app.ts:27`: the default request logger records the full URL with its query string.
- **Impact:** 7-day session tokens end up in Railway logs, and anyone with log access can replay them until logout. Confirmed in production with a fake token.
- **Required fix:**
  1. Accept the query token only on `GET /events/user/:address`, or replace it with a short-lived single-use SSE ticket.
  2. Strip the query string in the request log serializer.
- **Evidence:** `railway-log-excerpts.txt` (R2), `local-probes-1.txt` (P-L1).

### SEC-2-04 (Medium): IP-based limits key on the Railway proxy hop, not the client
- **Class:** wrong client identity behind a reverse proxy.
- **Where:**
  - `apps/api/src/routes/common.ts:32-34`: `ipKey(req.ip)`, with `trustProxy` off in `app.ts:27`.
  - Callers: `routes/auth.ts:12,17` (challenge limit) and `routes/intros.ts:55,151` (opens limit).
- **Impact:** `req.ip` is one of 21 internal `100.64.0.x` hops. One client spreads across many buckets, and every user shares the same ones, so sign-in throttling is weak and easy to exhaust for everyone. It can't be spoofed through `X-Forwarded-For` today.
- **Required fix:**
  1. Trust only Railway's proxy range (not `trustProxy: true`), so the real client IP is used.
  2. Add a test that a spoofed leftmost XFF entry is ignored.
- **Evidence:** `railway-log-excerpts.txt` (R1), `local-probes-1.txt` (P-L2).

### SEC-2-05 (Medium): logged-out link opens feed the attribution score the ATTRIBUTOR signs
- **Class:** an unauthenticated signal influences signed money weights.
- **Where:**
  - `apps/api/src/routes/intros.ts:148-157`: the open endpoint, where self-opens are excluded only when signed in.
  - `apps/api/src/routes/intros.ts:226-232`: `opensFor` counts every anonymous open.
- **Impact:** a referrer can push their own link to the open cap, up to 3× their score, and shift referral payouts away from other referrers.
- **Required fix:** score only opens by the paying customer's own authenticated session or a device token bound to it. Drop anonymous opens from scoring or cap them at 1.
- **Evidence:** code review (cited lines).

### SEC-2-06 (Medium): public SSE has no connection caps and no backpressure
- **Class:** connection and memory exhaustion.
- **Where:**
  - `apps/api/src/routes/events.ts:84-88`: the public venue stream accepts any address.
  - `apps/api/src/sse/hub.ts:33-59`: no global, per-channel or per-client cap; `write` ignores backpressure.
- **Impact:** an unauthenticated client can hold enough connections to exhaust sockets or memory and degrade the api for everyone.
- **Required fix:**
  1. Global, per-client (after SEC-2-04) and per-channel caps.
  2. Only known venues get a channel.
  3. Drop slow consumers, and add an idle timeout.
- **Evidence:** `hosted-probes.txt` (H14: the stream opens with no auth).

## Low

### SEC-2-07 (Low): RPC URL can leak through raw error messages
- **Class:** secret in an error string.
- **Where:**
  - `apps/api/src/relayer/relayer.ts:295` logs the first 200 characters of the error.
  - `apps/api/src/relayer/relayer.ts:347` puts the first 200 characters of the error into `details.reason`.
  - `apps/api/src/routes/api.ts:28,34`: `details` is returned to the client, and unhandled errors are logged in full.
- **Impact:** viem error messages include the RPC URL. That's harmless with the public RPC, but it becomes Medium once a keyed QuickNode `ARC_RPC_URL` is configured.
- **Required fix:**
  1. Never copy raw error messages into `details`.
  2. Redact URLs in the log serializers.
- **Evidence:** code review.

### SEC-2-08 (Low): error responses reveal config state and bypass the error model
- **Class:** information disclosure.
- **Where:**
  - `apps/api/src/auth/session.ts:78` and `apps/api/src/services.ts:57,61` return reasons like "SESSION_SECRET not set".
  - The webhook's unhandled 500 returns an internal runtime message.
  - The default 404 body doesn't follow the `{error:{…}}` shape.
- **Impact:** minor reconnaissance value. No stack traces were seen.
- **Required fix:**
  1. Keep reasons in logs only.
  2. Add a custom not-found handler and a webhook error handler.
- **Evidence:** `hosted-probes.txt` (H8, H10), `local-probe-gzip-bomb.txt`.

### SEC-2-09 (Low): session cookie accepted but never set (latent CSRF)
- **Class:** latent cross-site request forgery.
- **Where:** `apps/api/src/auth/session.ts:159-161`.
- **Impact:** nothing today. If a cookie is ever set, simple cross-site POSTs such as logout would be authenticated.
- **Required fix:**
  1. Remove the cookie path.
  2. If a cookie is added later, make it `HttpOnly; Secure; SameSite`, with an Origin or custom-header check on state-changing routes.
- **Evidence:** code review.

### SEC-2-10 (Low): webhook replay and retry hygiene
- **Class:** replay and unbounded work.
- **Where:**
  - `apps/api/src/routes/webhooks.ts:226-229` only logs timestamp skew.
  - `apps/api/src/streams/deliveries.ts:74-78` never dedupes raw rows.
  - `apps/api/src/streams/index.ts:175-215`: `retryFailed` has no attempt cap and runs inside the webhook request.
  - There is no webhook rate limit.
- **Impact:**
  - A leaked signed delivery can be replayed indefinitely. Derived state stays correct thanks to the `(tx_hash, log_index)` dedupe, but storage grows.
  - Poison rows add latency to every delivery, which leads to QuickNode timeouts and duplicate rows.
  - D-306 (200 on ingest failure) is otherwise sound.
- **Required fix:**
  1. Dedupe raw rows on a body hash plus batch range.
  2. Enforce the skew window once the timestamp unit is verified.
  3. Cap retries with backoff, and run them after responding.
- **Evidence:** code review.

### SEC-2-11 (Low): unbounded row growth and list pollution
- **Class:** resource abuse and data integrity.
- **Where:**
  - `apps/api/src/auth/session.ts:82-90`: `auth_challenges` for any address, never cleaned up.
  - `apps/api/src/routes/venues.ts:72-119`: prepared venues hold slugs forever.
  - `apps/api/src/routes/intros.ts:87-123`: creating an intro doesn't check `canRefer` or that the venue exists.
  - `link_opens` rows.
  - `apps/api/src/routes/venues.ts:187-190`: the public venue list is the 100 newest, including `relaying`.
- **Impact:** DB growth, and a junk flood can push real venues out of the list.
- **Required fix:**
  1. TTL cleanup.
  2. Per-user quotas.
  3. Validation at create time.
  4. Release slugs after the signing deadline.
  5. List only registered venues.
- **Evidence:** code review.

### SEC-2-12 (Low): relayer pays for some reverts; third parties can downgrade order status
- **Class:** griefing.
- **Where:**
  - `apps/api/src/routes/payments.ts:202-235`: the intent status check isn't atomic, but the simulation inside the lock prevents a double spend.
  - `apps/api/src/routes/payments.ts:253,272`: any customer's failed attempt marks the shared order `failed`.
- **Impact:**
  - State changes between simulation and inclusion can make a relayed tx revert, and the relayer pays for it.
  - A stranger who can see an order's QR can make it show `failed` while it is still payable.
- **Required fix:**
  1. Track failure per intent, not per order.
  2. Count reverts against the user's budget (SEC-2-02).
  3. Use an atomic `quoted → relaying` transition.
- **Evidence:** code review.

### SEC-2-13 (Low): no security headers; CORS methods incomplete
- **Class:** hardening and a functional gap.
- **Where:**
  - `apps/api/src/app.ts:31`: CORS registered with default methods.
  - No header hook.
- **Impact:**
  - No HSTS, `X-Content-Type-Options` or `Referrer-Policy`, which matters for SEC-2-03.
  - Preflights allow only GET/HEAD/POST, so browser calls to `PATCH /me` and `PATCH /venues/:venue` will fail.
- **Required fix:**
  1. Add minimal security headers.
  2. Add `PATCH` to the CORS methods.
- **Evidence:** `hosted-probes.txt` (H1, H16).

## Info and clean areas

### SEC-2-14 (Info): secrets, history, image and dependencies are clean
- **Git history:** 27 commits and 7 unreachable blobs. 474 unique 64-hex strings were checked by deriving their addresses: 0 match `wallets.public.json`, and 0 are default anvil keys. No keyed RPC URLs or API tokens. Evidence: `git-history-scan.txt`, `git-history-key-scan.json`.
- **`.env`:** never committed; `.env.example` is the only env-like file in history. `.gitignore` and `.dockerignore` both exclude `.env*`.
- **Image:** runs as `node`. Only `apps/api` and `packages/shared` are copied, with env files excluded.
- **Production logs:** apart from SEC-2-03, the sampled lines contain no keys, signatures or authorization headers. Evidence: `railway-log-excerpts.txt`.
- **Dependencies:**
  - Production: `pnpm audit --prod` finds 0 vulnerabilities. Evidence: `pnpm-audit-prod.json`, `pnpm-audit-prod-workspace.json`.
  - Dev only, not in the image: 2 moderate (esbuild via drizzle-kit, minimatch via the web eslint). Evidence: `pnpm-audit-all.json`.

### SEC-2-15 (Info): verified-correct controls
- **Sign-in challenge:** single-use through an atomic `used_at IS NULL` update, with a 5-minute expiry. Challenges are stored per environment, so they can't be replayed across environments.
- **Address handling:** addresses are normalized with checksummed `getAddress`, and comparisons are case-insensitive.
- **Session token:** HMAC-SHA256 with `timingSafeEqual` and a length check. Expiry is covered by the MAC. A session row must exist and not be revoked, and logout revokes it.
- **Unauthenticated access:** every authed route returns 401 without a token, and a forged token is refused. Evidence: `hosted-probes.txt` H5, H6.
- **CORS:** a preflight from a foreign origin gets no allow-origin header (H2). The SSE manual origin echo follows the same allow-list.
- **Owner actions:** signed at the current `nonces(owner)` over a server-stored message, refused when the nonce is stale, one in flight per owner, and simulated inside the relayer lock.
- **Orders:** signed only for venues whose on-chain owner is the session and whose signer is our key.
- **Weights:** bound to (venue, customer, orderId) and committed through `weightsHash` in the PaymentAuth. They can't be replayed across orders.
- **Submitter:** never 0 (asserted). The relayed path refuses intents whose submitter isn't the relayer.
- **QE-C-10:** handled as final in the pre-simulation, the in-lock simulation and the receipt path.
- **QE-C-11:** the balance is checked before relaying and again inside the lock.
- **Relayer safety checks:** simulation before every send, reverts final, a max-gas cap per kind, a fee cap and a check of the relayer's own balance.
- **Webhook authentication:**
  - HMAC over the decoded bytes, a 64-hex format check and `timingSafeEqual`.
  - Fails closed with 503 when the secret is unset.
  - The stored header allow-list leaves out the signature.
  - Only verified deliveries are persisted.
- **Size limits on regular JSON routes:** a 20 KB header gets 431 and a 1.2 MB body gets 413 (H11, H12).

### SEC-2-16 (Info): design notes (no fix required for Phase 2)
- **Steering attribution:** a customer can shift weights among eligible referrers with "Who sent you here?", by design. Re-quoting the same order yields several signed weight sets to pick from. Optional: reuse the first intent's weights per (customer, order).
- **`/relayer/status`:** public, and exposes the relayer balance and queue depth. That's all public on-chain, but it makes drain progress easy to watch.
- **Challenge URI:** the challenge message's URI field comes from `PUBLIC_WEB_URL`, which defaults to `http://localhost:3100` on Railway. Set the real web origin.
- **Trust in the feed:** "settled" state trusts the HMAC'd Streams feed without a chain cross-check, so compromising the webhook secret would forge paid status. Seal the Railway variable.
- **Spike log:** the local-only NDJSON spike log records raw headers (keep it off on hosts).
- **Public venue SSE:** publishes `payment.pending` with the customer address and amount before inclusion.

## Re-verification (2026-11-17)

_Code: `920a042` (D-308, D-309, D-807..D-810), reviewed as a diff against `a6b1296`. Railway setting `TRUST_PROXY=2` (D-018)._
_Hosted checks: one request each. Heavy probes ran only against a local api on :4040 on the current tree, with throwaway unfunded dummy keys. No chain tx was sent._

**Evidence:**
- `reverify-local-webhook.txt`
- `reverify-local-api.txt`
- `reverify-hosted-probes.txt` (includes the read-only Railway log check)
- `reverify-unit-tests.txt` (108 / 109 pass; the one failure is an environment flake, see Notes)

| ID | Verdict | How it was verified |
|---|---|---|
| SEC-2-01 | **FIXED** | Code: secret and header checks run before any decode; 4 MiB raw limit; 8 MiB inflate cap; unverified bodies are never parsed. Locally, a 1 GiB-inflating body without headers → 401 in 3 ms; with placeholder headers → 413 `decoded-body-too-large`; a 5 MB raw body → 413. RSS stayed flat (+2 MB). Hosted V2/V3 (tiny bodies) → 401. |
| SEC-2-02 | **FIXED** | Code and unit tests. Budget: hourly and daily windows, global / per user / per venue, reserved at worst case and settled to the actual fee, reverts included, seeded from `relay_txs` at boot. Per-kind quotas; pay-first worker; 20 pay-only queue slots; $2 balance floor with an ALERT log; $0.50 minimum order; re-simulation before any fee bump. Defaults cap total relayer spend at $1/h and $5/day. Locally, `/relayer/status` reports the budget with dummy keys; hosted V10 shows the same limits. |
| SEC-2-03 | **FIXED** | Locally, a valid token as `?token=` on `/me/wallet` → 401; on the SSE user route → 200; 0 log lines contain the token; the URL is logged as `token=[redacted]`. Hosted V4 is logged as `token=[redacted]`. |
| SEC-2-04 | **FIXED** | Hosted V5/V6: a plain request and one with a spoofed leftmost XFF both log the same real client address. It is not the spoofed value, not `100.64/10` and not the Railway edge. Locally, an untrusted peer's XFF is ignored. |
| SEC-2-05 | **FIXED** | Code (`opensFor` counts only the paying customer's own signed-in opens and never the referrer's) plus a unit test (10 anonymous opens leave the weights unchanged). |
| SEC-2-06 | **FIXED** | Locally, the 9th concurrent connection from one client → 429 and an unknown venue → 404; hosted V12 → 404. Code: global, per-client and per-channel caps, a slow-consumer drop and a 30-min max age. |
| SEC-2-07 | **FIXED** | Code: URLs and tokens are scrubbed from logs and error text, and raw errors are never copied into `details`. Unit test "logs never carry the RPC URL". |
| SEC-2-08 | **FIXED** | Hosted V7 returns the standard 404 body; V11 returns a 503 with no reason given; V10 shows one `enabled` flag and no signer details. |
| SEC-2-09 | **FIXED** | Locally, a valid token in the `vouch_session` cookie → 401. |
| SEC-2-10 | **PARTIAL** | Fixed: a per-IP limiter runs before the body is read, raw rows are deduped on a body hash plus batch range, and retries run in the background with ≤ 5 attempts and backoff. Still open: timestamp skew is only logged, so a captured signed delivery stays replayable. The replay is harmless to state and storage because of the dedupe, and the window was kept open on purpose (D-309d). Low. Close it once the timestamp unit is confirmed. |
| SEC-2-11 | **FIXED** | Code: challenges are cleaned up; prepared venues release their slug after the deadline; intro create checks the venue and `canRefer`; `GET /venues` lists registered venues only and is paginated. |
| SEC-2-12 | **FIXED** | Code and unit tests: the `quoted → relaying` claim is atomic; refusals never touch the shared order; reverts count against the budget; the relayer re-simulates before paying for a replacement. |
| SEC-2-13 | **FIXED** | Hosted V1 shows nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a CSP, HSTS, COOP and `no-store`. V8 preflight allows PATCH; V9 foreign origin is still refused. |

### Residual notes (non-blocking)
- **N-1 (Low), budget starvation.** The global budget is one pool shared by every job kind. The pay lane reserves queue slots, not budget. Free identities could use non-pay kinds such as `acceptIntro`, which needs no USDC, to exhaust the global hourly or daily budget and pause payments until the window rolls. Money loss is bounded at $5/day, so this is an availability issue only. Suggestion: reserve a share of the global budget for `pay`, e.g. cap non-pay kinds at 50%. Owner: BACKEND_RELAYER.
- **N-2 (Info), webhook buffering.** The per-IP webhook bucket (burst 600) still allows many concurrent 4 MiB raw uploads from one client. Memory per request is bounded; concurrency is not. Real deliveries are a few KB. Suggestion: a lower burst (e.g. 50) and/or a 1 MiB raw cap. The parser's 413 uses the default Fastify body. Owner: STREAMS_INFRA.
- **N-3 (Info), `TRUST_PROXY=2` is required on Railway.** The code default (`100.64.0.0/10`) resolves to the edge address there. If the variable is removed, per-IP limits fall back to shared buckets. Spoofing still fails in that case, so it degrades availability only. Suggestion: log the effective trustProxy mode at boot.
- **N-4 (Low), shared order status.** A relayed pay that reverts on chain still sets the shared order to `failed` (reverted → failed), and any customer who can see the QR can submit one. The order stays payable; only the displayed status is wrong. Suggestion: derive order display from Streams and per-intent state.
- **N-5 (Info), test runner flake.** In the full parallel test run, `ingest.test.ts` crashed once with a V8/WASM fatal error inside PGlite (`Check failed: end > addr`). The file passes 16/16 on its own. This is environmental, not a product defect. QE may want `--test-concurrency=1` for the PGlite suites.

### Is it safe to set `RELAYER_PRIVATE_KEY` on Railway now? **Yes, under these conditions**
1. **Funding:** fund the relayer only with testnet USDC sized to the budget (≈ $5–20). The defaults cap spend at $1/h and $5/day. Keep them unless the human raises them on purpose.
2. **Proxy setting:** keep `TRUST_PROXY=2` on the api service.
3. **Other secrets:** set `ATTRIBUTOR_PRIVATE_KEY`, `VENUE_SIGNER_PRIVATE_KEY` and `SESSION_SECRET` the same way, as dashboard variables (sealed if possible) that never pass through chat or the repo. `/relayer/status` reports `enabled: true` only when all three relay keys are present.
4. **After setting them:**
   - check `/relayer/status` once: `enabled: true`, budget at its limits, `lowBalance: false`;
   - watch for the `ALERT relayer balance below floor` log line.
