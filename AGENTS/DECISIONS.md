# DECISIONS — append-only log
_Format: `## D-<nnn> — <title>` · Date · Decision · Reason · Alternatives · Who. Never edit past entries; supersede with a new entry._

## D-001 — Monorepo with pnpm workspaces
- **Date:** 2026-11-15
- **Decision:** pnpm workspaces: `contracts/` (Foundry, not a JS workspace), `apps/web`, `apps/api`, `packages/shared`, `scripts`.
- **Reason:** single source of truth for ABIs/EIP-712 types shared by web and api.
- **Alternatives:** separate repos (rejected: drift); Turborepo (unnecessary overhead for solo build).
- **Who:** ORCHESTRATOR (from brief)

## D-002 — Placeholder name `wom`
- **Date:** 2026-11-15
- **Decision:** use `wom` for package/folder names; display name is one constant `APP_NAME` in `packages/shared/src/constants.ts`.
- **Reason:** human has not confirmed a name yet (HUMAN_INPUT #1).
- **Who:** ORCHESTRATOR

## D-003 — Secrets policy
- **Date:** 2026-11-15
- **Decision:** `.gitignore` excludes `.env*` (except `.env.example`) from the first commit. Keys live only in root `.env` / `apps/*/.env.local`. Spec env var names in INTERFACES.md §Env.
- **Who:** ORCHESTRATOR

## D-101 — Arc Testnet network facts (verified)
- **Date:** 2026-11-15
- **Decision:** Use chain ID `5042002`, RPC `https://rpc.testnet.arc.io` (WS `wss://rpc.testnet.arc.io`), explorer `https://explorer.testnet.arc.io` (Blockscout; verify with `--verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/`), faucet `https://faucet.circle.com` (20 USDC / 2 h / address), USDC ERC-20 `0x3600000000000000000000000000000000000000` (6 dec; EIP-712 domain name "USDC", version "2"). Relayer sets `maxFeePerGas >= 20 gwei`. Foundry `evm_version = "prague"`. Finality = 1 block (no reorgs). `eth_getLogs` pages are ≤ 9,999 blocks.
- **Reason:** Live RPC reads + official docs (docs.arc.network now 301-redirects to docs.arc.io). The legacy `rpc.testnet.arc.network` and `testnet.arcscan.app` still work (the explorer redirects), but arc.io hostnames are canonical. Evidence: `docs/evidence/phase-0/research-s1-s3-s4.md` §S1.
- **Alternatives:** keep the legacy arc.network/arcscan.app URLs (viem's built-in `arcTestnet` defaults). Rejected: the arcscan.app API 301s, which can break verifier POSTs.
- **Who:** ARCHITECT-research

## D-102 — USDC decimals rule (18 native vs 6 ERC-20)
- **Date:** 2026-11-15
- **Decision:** All contract/app amounts are 6-decimal ERC-20 base units through `0x3600…`. The payment contract is **non-payable**: no `msg.value`, no `address(this).balance`, no native sends. Native 18-dec values appear only in relayer gas accounting (`eth_getBalance`, `gasUsed*effectiveGasPrice`), converted with `/1e12` (to 6-dec) or `/1e18` (to USDC). The UI shows a single USDC balance. Indexers match only our contract address (or emitter `0x3600…` for USDC), never the system emitter `0xffff…fffe`.
- **Reason:** Verified live: native and ERC-20 are one balance (`balanceOf == floor(getBalance/1e12)`, with sub-micro dust truncated). Every ERC-20 transfer also emits an 18-dec EIP-7708 system Transfer log.
- **Alternatives:** native `msg.value` payments (rejected: 18-dec, requires the user to send a tx with gas, and mixes units).
- **Who:** ARCHITECT-research

## D-103 — Payment authorization via EIP-3009 receiveWithAuthorization
- **Date:** 2026-11-15
- **Decision:** The customer signs USDC's `ReceiveWithAuthorization(from=customer, to=paymentContract, value, validAfter, validBefore, nonce)`, where `nonce = EIP-712 struct hash of our payment params` (order, venue, amount, intro/weights commitment). The relayer calls our contract, which recomputes the nonce and calls `USDC.receiveWithAuthorization`, then splits with `USDC.transfer` atomically. Contract signature checks (intros, etc.) use OZ `SignatureChecker` (ECDSA + ERC-1271).
- **Reason:** Verified live on Arc USDC (`NativeFiatTokenV2_2`): permit, transfer/receive/cancelAuthorization (v,r,s and bytes/ERC-1271 variants) are present, typehashes match, and `receiveWithAuthorization` is payee-only (not front-runnable). It needs one customer signature, uses random nonces (no sequential-nonce blocking), leaves no allowance, needs no customer gas, and is documented by Arc for relayers.
- **Alternatives:** EIP-2612 permit + transferFrom (fallback; sequential nonces, and a separate order signature is still needed); approve + transferFrom (rejected: approve needs a gas-paying user tx).
- **Who:** ARCHITECT-research

## D-104 — Wallet: passkey-gated local EOA + our relayer (not Circle Modular Wallets for Tier 1)
- **Date:** 2026-11-15
- **Decision:** Option B. A browser-generated secp256k1 key is encrypted at rest (AES-GCM, key derived via WebAuthn PRF where available; fallback is a non-extractable WebCrypto key gated by a passkey assertion, labelled as UX gating). The relayer pays all gas. Contracts stay ERC-1271-ready (D-103) so Circle Modular Wallets can be added later (Tier 3, e.g. the venue account).
- **Reason:** Circle Modular Wallets DO support Arc Testnet (MSCA, bundler at `modular-sdk.circle.com/.../arcTestnet`, testnet gas auto-sponsored; SDK `@circle-fin/modular-wallets-core` 1.0.16 pins viem 2.55.11). But MSCA signatures need ERC-1271 and a **deployed** account (no ERC-6492 in USDC), and they add a Console client key + passkey-domain setup and a second (UserOp) submission path. That is too much integration risk for a ~45 h solo budget compared with ECDSA + EIP-3009 from an EOA.
- **Alternatives:** (A) Circle Modular Wallets (deferred); Circle user-controlled wallets (PIN/social, no passkey: rejected); dev-controlled custodial wallets (rejected: custodial).
- **Who:** ARCHITECT-research

## D-105 — QuickNode Streams on Arc Testnet: feasible; dataset `logs`, created late
- **Date:** 2026-11-15
- **Decision:** One Stream: network `arc-testnet`, dataset `logs`, JS filter `main(stream)` that keeps logs where `address == ourContract` and `topic0 ∈ {6 event topics}` and returns `null` otherwise. Webhook destination, compression `none`, `dataset_batch_size: 5` + `elastic_batch_enabled: true`, `fix_block_reorgs: 0`, `start_range` = deploy block. HMAC verification on `X-QN-Signature` = hex HMAC-SHA256(token, nonce+timestamp+body). Dedupe on `(txHash, logIndex)`. Create the stream only after the contract is final, and pause it when idle.
- **Reason:** QuickNode docs list Arc Testnet for all EVM datasets. Filter, webhook, HMAC, start-block backfill, and REST API are all on the Free plan. Arc has no reorgs. Billing is per block processed (~124k Arc blocks/day at a measured 0.70 s), and the Arc multiplier is UNVERIFIED. At 20 credits/block, 5 days of continuous streaming (~12.4M credits) exceeds the Free 10M, so the stream starts late and pauses when idle. If the multiplier is ≥ ~16 or we need ≥ 2 streams, upgrade to Build ($49).
- **Alternatives:** `block_with_receipts` (more data, ~2× cost); QuickNode Webhooks product (pay per match, but the bounty requires Streams).
- **Who:** ARCHITECT-research

## D-201 — Foundry toolchain + Solidity deps via pnpm (no git submodules)
- **Date:** 2026-11-15
- **Decision:** Foundry 1.9.0 (foundryup). `contracts/` created with `forge init --no-git --empty`. OpenZeppelin Contracts **5.6.1** (npm) and forge-std **v1.17.0** (`github:foundry-rs/forge-std#v1.17.0` tarball) are root devDependencies; `foundry.toml` sets `libs = ["../node_modules"]` with remappings `@openzeppelin/contracts/` and `forge-std/`. solc 0.8.30, optimizer 200 runs, `evm_version = "cancun"` (VERIFY S1), fuzz runs 1000, invariant runs 256 / depth 64.
- **Reason:** one `pnpm install` gets every dependency. No submodules in the monorepo and no vendored `lib/`. Versions are pinned in one lockfile.
- **Alternatives:** `forge install` (needs git submodules or a vendored lib/, so more churn); npm `forge-std` package (stale, 1.1.2).
- **Who:** ARCHITECT-scaffold

## D-202 — API framework: Fastify 5 + TypeScript, run with tsx
- **Date:** 2026-11-15
- **Decision:** `apps/api` is a separate long-lived Fastify 5 service, run with `tsx` (no build step). Next route handlers are not used for backend logic.
- **Reason:** SSE connections, relayer nonce management (a single in-process queue) and the Streams webhook all need a persistent process. Serverless route handlers would fight all three.
- **Alternatives:** Next.js route handlers (cold starts, no long-lived SSE, no shared nonce state); Express (slower, weaker typing).
- **Who:** ARCHITECT-scaffold

## D-203 — DB: Drizzle ORM; Postgres in deploy, PGlite locally/tests via DATABASE_URL
- **Date:** 2026-11-15
- **Decision:** Drizzle ORM (pg-core). `DATABASE_URL` picks the driver: `postgres://…` uses postgres-js (hosted Postgres), `pglite://<path>` uses on-disk PGlite (default `./data/local/pglite`, gitignored), and `pglite://memory` is used for tests. drizzle-kit migrations are committed under `apps/api/drizzle/` and applied at boot and by `pnpm --filter @wom/api db:migrate`. Phase 0 only has a trivial `app_meta` table.
- **Reason:** no docker or postgres on this machine. PGlite is real Postgres (WASM), so the same SQL and migrations run locally and in deploy.
- **Alternatives:** SQLite (dialect drift from prod); docker Postgres (not installed); hosted DB for local dev (network dependency).
- **Who:** ARCHITECT-scaffold

## D-204 — @wom/shared consumed as TypeScript source (no build step)
- **Date:** 2026-11-15
- **Decision:** `packages/shared` exports `./src/index.ts` (and `./*` → `./src/*.ts`). Next.js compiles it via `transpilePackages: ["@wom/shared"]`. Node consumers (api, scripts) run through `tsx`. Extensionless relative imports.
- **Reason:** zero build or watch step, instant edits across web/api/scripts, and one source of truth for ABIs and typed data.
- **Alternatives:** tsc build to dist with project references (needs a watch process and can serve stale dist). If the api ever needs plain `node`, bundle it with tsup/esbuild at deploy time.
- **Who:** ARCHITECT-scaffold

## D-205 — QR libraries: jsqr (scan) + qrcode (render)
- **Date:** 2026-11-15
- **Decision:** scanning uses `jsqr@1.4.0` on downscaled `getUserMedia` frames (rear camera, `facingMode: environment`). Rendering uses `qrcode@1.5.4` (`toDataURL`).
- **Reason:** jsqr is pure JS with no wasm or CDN fetch and works on iOS Safari and Android Chrome. It was updated in 2025. `qr-scanner` has been unmaintained since 2022. `barcode-detector` (zxing-wasm) fetches wasm from a CDN by default, which is risky on venue Wi-Fi.
- **Alternatives:** `@zxing/browser` (5.8 MB, heavier); native `BarcodeDetector` (not on iOS Safari).
- **Who:** ARCHITECT-scaffold

## D-206 — Toolchain pins: TypeScript 5.9, viem 2.57.18, Next 16.4.6
- **Date:** 2026-11-15
- **Decision:** TypeScript `^5.9.3` everywhere, not 7.0. viem pinned to `2.57.18`. Next.js 16.4.6 (App Router, Turbopack, `cacheComponents`) with React 19.3 and Tailwind 4.3.
- **Reason:** TS 7 (native) is brand new and Next/eslint tooling targets the TS 5 JS API. viem 2.57.20 was published today and tripped pnpm 11's `minimumReleaseAge` guard; we pin an older release rather than bypass that supply-chain guard.
- **Who:** ARCHITECT-scaffold

## D-207 — Hello spike hardening (S2/S5)
- **Date:** 2026-11-15
- **Decision:** `SplitAuth` includes `address token` (in addition to from/recipientsHash/amountsHash/nonce/deadline), so a relayer can't swap tokens. `pullAndSplit` requires `msg.sender == from`, so nobody can spend another holder's allowance. Nonces come from OZ `Nonces` (sequential).
- **Reason:** the spike's approval to Hello would otherwise be drainable by anyone. The same lesson applies to the main contract: every pull must be bound to a holder signature.
- **Who:** ARCHITECT-scaffold

## D-208 — EIP-712 v0 design: two-step intros, frozen domain name
- **Date:** 2026-11-15
- **Decision:**
  - The referrer signs `Intro`. The customer countersigns `IntroAcceptance{introHash, customer, deadline}`, where `introHash` is the full EIP-712 digest, so it is domain-bound.
  - Personal intros are single-use. Broadcast intros are unique per (introHash, customer).
  - `PaymentAuth` adds an explicit `customer` field.
  - The domain name is the literal `"wom"` (`EIP712_DOMAIN_NAME`), separate from `APP_NAME` and frozen at deploy.
  - Proposed L2 rule: the introducer is the top-weight L1 referrer at the customer's first purchase, emitted in `CustomerVerified`.
- **Reason:** an intro can't be replayed onto another venue or customer, and a rename of the display name won't break signatures.
- **Alternatives:** the referrer names the customer in the Intro (impossible for links shared before the customer has an address).
- **Who:** ARCHITECT-scaffold (draft; CONTRACTS finalizes)

## D-209 — Scaffold aligned to verified S1 (supersedes D-201 evm_version, refines D-208 PaymentAuth)
- **Date:** 2026-11-15
- **Decision:**
  - `foundry.toml` sets `evm_version = "prague"` (was `cancun`) and adds an `[etherscan] arc_testnet` entry pointing at Blockscout (`https://explorer.testnet.arc.io/api/`; use `--verifier blockscout`).
  - `packages/shared/src/chains.ts` holds the D-101 values with VERIFY flags removed: canonical RPC/WS, explorer, USDC `0x3600…` (6 dec), the USDC EIP-712 domain `{USDC, 2}` plus its live DOMAIN_SEPARATOR (unit-tested), `ARC_MIN_MAX_FEE_PER_GAS = 20 gwei`, the EIP-7708 system emitter `0xffff…fffe` (ignore it), and the getLogs range of 9,999.
  - Per D-103, `PaymentAuth` becomes `{customer, venue, orderId, amount, weightsHash, deadline}` with no sequential nonce. Its `hashStruct` is the nonce of USDC `ReceiveWithAuthorization` (to = main contract, validAfter = 0, validBefore = deadline). Helpers: `paymentAuthNonce`, `receiveAuthForPayment`, `weightsStructHash`.
  - The S5 relayer clamps `maxFeePerGas` up to 20 gwei on Arc.
- **Reason:** S1 verified (D-101..D-105). One customer signature binds the whole payment, including the quoted weights.
- **Who:** ARCHITECT-scaffold

## D-004 — Keys generated by a human-run script; agents never read .env
- **Date:** 2026-11-15
- **Decision:** `scripts/setup/gen-env.py` (human runs once) creates root `.env` (mode 600) from `.env.example` with 9 fresh `cast wallet new` keys (deployer, relayer, attributor, venue signer, spike user, 4 demo personas) + random `SESSION_SECRET`, prints public addresses only, and writes `packages/shared/src/wallets.public.json`. Agents must never `cat`/grep `.env`; tooling loads it (forge auto-loads; node via dotenv).
- **Reason:** a PreToolUse secret-read guard hook blocks agent Bash touching `.env` — that's the intended policy, not something to route around.
- **Alternatives:** orchestrator writes `.env` directly (blocked by hook, and it'd put key material through the agent's tool I/O).
- **Who:** ORCHESTRATOR

## D-005 — Public HTTPS during development via cloudflared quick tunnels
- **Date:** 2026-11-15
- **Decision:** `cloudflared` (installed via Homebrew, v2026.11.0) quick tunnels (`*.trycloudflare.com`, no account) for the S6 phone test and the S3 webhook spike. Stable hosted URL (Railway/Render) from Phase 2 for the production Stream, because quick-tunnel URLs change on every restart.
- **Who:** ORCHESTRATOR

## D-006 — Dev web server on port 3100
- **Date:** 2026-11-15
- **Decision:** local web previews/tunnels use port 3100. Port 3000 on the dev machine is occupied by an unrelated long-running next-server, which we leave alone. (`pnpm dev:web` default 3000 will fail/shift — use `-p 3100`.)
- **Who:** ORCHESTRATOR

## D-007 — Product name: Vouch
- **Date:** 2026-11-16
- **Decision:** Display name `APP_NAME = 'Vouch'`; package scope `@vouch/*`; root package `vouch`; main-contract EIP-712 domain name `"Vouch"` (changed before any production deploy, so nothing is invalidated). The Hello spike keeps its own domain `"WomHello"`. GitHub repo `vouch` (private until submission).
- **Reason:** Human chose "Vouch" from the Phase 0 shortlist.
- **Who:** HUMAN (applied by ORCHESTRATOR)

## D-008 — Level-2 introducer rule (approved)
- **Date:** 2026-11-16
- **Decision:** A customer's **introducer** for a venue = the **top-weight L1 referrer** of that customer's **first (rewarded) purchase** at that venue. It is recorded on-chain and emitted as `CustomerVerified.introducer`, and it is **frozen forever** (later purchases or new intros never change it). Ties go deterministically to the lower array index in the submitted weights (CONTRACTS documents the exact rule). If the first purchase had no valid referrer (e.g. a seed ambassador or the venue itself), the introducer is `address(0)`, and any L2 share owed through that customer returns to the venue.
- **Reason:** Approved by the human as proposed by ARCHITECT-scaffold. It is deterministic, cheap (one SSTORE at verification), and needs no off-chain input.
- **Interpretation note:** scoped per (customer, venue), since verification is per venue and only verified customers of a venue can recommend it. Flagged in the Phase 0 report.
- **Who:** HUMAN (applied by ORCHESTRATOR)

## D-401 — Demo wallet top-up tool: deployer-funded, top-up-to-target, abort-not-cap
- **Date:** 2026-11-16
- **Decision:** `scripts/setup/topup-demo.ts` (`pnpm --filter @vouch/scripts topup`) funds demo wallets from the DEPLOYER with plain ERC-20 `transfer` on Arc USDC. Each target is topped up TO `--target` (default $5.00), and wallets at or above target are skipped, so the tool is idempotent. The safety limits (`--reserve`, default $5.00, counting a worst-case gas budget of estimateGas×1.2×maxFeePerGas on Arc, where gas is the same USDC; `--max-total`, default $25.00) **abort the whole run before any send**. They never trim or partially fill the plan. Sends are sequential with explicit nonces and a wait for each receipt, and the run stops at the first failure (exit 3). maxFeePerGas is clamped up to 20 gwei on every chain. On Arc the token is pinned to `0x3600…` (a mismatched `USDC_ADDRESS` is refused). A keyed `ARC_RPC_URL` is never printed.
- **Reason:** The faucet gives each address 20 USDC per 2 h. One funded deployer with a predictable, bounded refill is simpler and safer than faucet runs for each persona. Aborting instead of trimming keeps the plan the human reviewed (dry-run) identical to what gets sent.
- **Alternatives:** Send a fixed amount per run (rejected: not idempotent, drains on repeat). Cap by sending partial amounts up to max-total (rejected: surprising, order-dependent). Native-value sends (rejected: D-102, mixes 18-dec units).
- **Who:** ARCHITECT

## D-301 — Streams webhook auth: QuickNode HMAC, fail closed, verify over decoded raw bytes
- **Date:** 2026-11-16
- **Decision:** `POST /webhooks/streams` checks `X-QN-Signature == hex(HMAC-SHA256(key = utf8(security_token), msg = X-QN-Nonce + X-QN-Timestamp + body))`. The body is the exact request bytes, gunzipped when `Content-Encoding: gzip` or the gzip magic is present (Fastify does not inflate; QuickNode signs the decoded JSON). The signature must be 64 hex chars and is compared with `timingSafeEqual`. Responses: 503 when `STREAMS_WEBHOOK_SECRET` is unset or a `__placeholder__` (fail closed); 401 on missing headers or a bad signature; 400 if gunzip fails; otherwise 200. `X-QN-Timestamp` skew (> 300 s) is only logged, because the unit is unverified. Every POST, rejected ones included, is appended to the NDJSON spike log with `verified`, `reason`, headers, decoded body and a parsed summary.
- **Reason:** Matches the QuickNode guide and its reference server (github.com/quiknode-labs/streams-webhook-validate-signature), re-checked 2026-11-16. Failing closed means a misconfigured api cannot accept forged events. Logging rejects gives S3 the raw material to debug a format mismatch.
- **Alternatives:** Custom-header shared secret (weaker, no body integrity); mTLS only (proves QuickNode, not which stream; per the docs, keep HMAC too).
- **Who:** STREAMS_INFRA

## D-302 — Stream filter delivers an envelope v1 of matched raw logs; decoding stays in the api
- **Date:** 2026-11-16
- **Decision:** `infra/streams/filter-logs.js` (`main(stream)`, dataset `logs`) walks `stream.data` defensively: any array depth ≤ 8, receipt-like `.logs`, and no `{data, metadata}` wrapper. It keeps logs whose lower-cased `address` ∈ ADDRESSES and `topic0` ∈ TOPICS, and returns `null` when nothing matches. Otherwise it returns `{v:1, streamId, network, dataset, batchStart, batchEnd, events:[{event, address, topics, data, blockNumber, blockHash, transactionHash, transactionIndex, logIndex, removed, blockTimestamp?}]}`, with hex numbers converted to JS numbers. The CLI fills ADDRESSES/TOPICS from `--contract` and `--events` (viem `toEventSelector`).
- **Reason:** The docs disagree on nesting (`[block][receipt][log]` in the JSON spec and the REST example, "array of arrays" in prose), so the filter tolerates both. ABI decoding stays in one place (`@vouch/shared` ABI + viem in the api). The batch range in the envelope makes delivery ordering and gaps auditable whether or not QuickNode wraps the body.
- **Who:** STREAMS_INFRA

## D-303 — Stream create defaults (REST) and token handling
- **Date:** 2026-11-16
- **Decision:** `scripts/streams/streams.ts create` sends `network arc-testnet`, `dataset logs`, `filter_language javascript`, `region usa_east`, `start_range <deploy block>`, `end_range -1`, `dataset_batch_size 5`, `elastic_batch_enabled true`, `fix_block_reorgs 0`, `keep_distance_from_tip 0`, webhook `{compression none, headers {}, max_retry 20, retry_interval_sec 1, post_timeout_sec 15}`, `status active|paused`, and `external_id` = `Idempotency-Key` = `vouch-<name>` so retries are safe. `security_token` is **omitted** ("one is generated for you; the stream response includes it", docs). The CLI writes it to the root env file as `STREAMS_WEBHOOK_SECRET` (replace or append, mode preserved, atomic rename) and never prints it. `set-webhook` PATCHes the URL plus the other required webhook attrs and omits `security_token`, which keeps the token. GET/list responses carry the token in clear text, so all CLI output is redacted. The runbook creates the stream **paused**, restarts the api, then activates it.
- **Reason:** Docs: create-stream, update-stream, rest-api ("Batch Size and Elastic Batch": tip streams on sub-second chains need ≥ 5, else 422). `max_retry 20` stops a short api restart from auto-pausing the stream (the default is 3).
- **Who:** STREAMS_INFRA

## D-304 — S3 tooling hardening after the Phase 0 QE gate (QE-01..QE-15)
- **Date:** 2026-11-16
- **Decision:**
  - (a) The envelope event label field stays **`event`** (QE-01). INTERFACES §6 is being aligned by the Orchestrator. All consumers (api `summarize`, viewer, tests) read `event`.
  - (b) Contract targets are **explicit**. `streams:ping --hello|--contract <addr>` takes precedence over `HELLO_ADDRESS` and refuses a zero address or an address with no code. `streams create/test-filter/render-filter` require `--contract` (the `HELLO_ADDRESS` fallback is removed). The canonical spike Hello and deploy block come from **INTERFACES §2**, never `contracts/broadcast/…/run-latest.json`, which re-deploys overwrite (QE-02, QE-04).
  - (c) `STREAMS_SPIKE_LOG` resolves relative to the repo root in both the api (`env.ts`) and the viewer (`spikeLogPath`). The viewer loads the root env file like the api (QE-06).
  - (d) The deliveries viewer shows event names, block ranges and tx hashes **only for verified deliveries**. Rejected or pre-HMAC lines are labelled "unverified body, labels untrusted" and their summary is withheld (QE-07).
  - (e) The filter adds `batchSource: "metadata" | "logs"`. With unwrapped input it derives `batchStart/batchEnd` from min/max `blockNumber` over all input logs. That is a lower bound; the `batch-*` HTTP headers stay authoritative (QE-15).
  - (f) `render-filter` writes its preamble to stderr, so stdout is valid JS (QE-05).
- **Reason:** QE gate findings in `docs/qa/phase-0-qe-gate.md`. Each prevents a silent mismatch: the stream watching one contract while the ping hits another, the viewer reading a different file than the api, or forged labels being shown as evidence.
- **Who:** STREAMS_INFRA

## D-009 — Inter-agent communication: inboxes, registry, handoff packets, gate rule
- **Date:** 2026-11-16
- **Decision:** Per-role inboxes `AGENTS/INBOX/<ROLE>.md` with header `### [MSG-###] <ts> FROM: <role> TO: <role> | type: question/request/fyi/blocker/answer | status: open/answered/closed`. The global counter + open list + log live in `AGENTS/INBOX/_INDEX.md`. All writes go through `scripts/agents/msg.py` (flock-serialized; tested with 8 concurrent sends → unique IDs). `AGENTS/AGENT_REGISTRY.md` maps roles → agent IDs/phase/status. Every agent reads its inbox first, posts instead of guessing, and reports sent/unresolved messages. Producers write handoff packets to consumers' inboxes. QE files bugs to owners' inboxes; owners answer with the fix commit. The Orchestrator relays blockers immediately and routes open messages after each agent returns. **No gate passes with an open blocker.** Phase reports include a Comms section.
- **Reason:** Human requirement (2026-11-16). Parallel agents need a durable, auditable channel; a scripted writer avoids counter races between agents.
- **Alternatives:** hand-edited markdown with manual counters (rejected: races between parallel agents); per-role counters (rejected: the human asked for a global counter).
- **Who:** HUMAN (requirement) / ORCHESTRATOR (implementation)

## D-010 — L2 scope confirmed per (customer, venue); QuickNode key still rejected
- **Date:** 2026-11-16
- **Decision:** The human confirmed D-008's interpretation: the introducer is per (customer, venue). The second QuickNode key also returns 403 on `GET https://api.quicknode.com/streams/rest/v1/streams` with header `x-api-key`. Per the human's instruction, S3 live is stopped (no retries) and escalated. Phase 1 proceeds because it doesn't depend on S3.
- **Who:** HUMAN / ORCHESTRATOR

## D-011 — S3 Stream created via the QuickNode dashboard (REST API unavailable on trial plans)
- **Date:** 2026-11-16
- **Decision:** Create and manage the Stream in the QuickNode dashboard (Create Stream wizard). Network Arc Testnet, dataset Logs, our filter (`infra/streams/filter-logs.js` rendered per contract), start at the contract's deploy block, run continuously, latest-block delay 0, webhook destination `<api>/webhooks/streams`, compression none. The human creates it paused, copies the security token into the root env file as `STREAMS_WEBHOOK_SECRET`, and pauses/resumes it manually in the dashboard. If the dev tunnel URL changes, the human updates the destination URL in the dashboard; it becomes stable after the Phase 5 deploy. The REST CLI (`scripts/streams/streams.ts`) stays in the repo for paid plans.
- **Reason:** The human verified that the Streams REST API returns 403 on trial plans: an Admin key on a brand-new account gets `{"message":"Insufficient permissions","name":"AuthorizationError"}`, and `qn auth login` fails the same way. Both of our earlier 403s (D-010) are explained by this. The wizard works and offers Arc Testnet. The bounty requires a Stream with a filter + webhook destination, which dashboard creation satisfies.
- **Alternatives:** upgrade to a paid plan for REST access (not needed for the bounty); QuickNode Webhooks product (not Streams, doesn't qualify).
- **Who:** HUMAN (finding) / ORCHESTRATOR

## D-601 — Visual direction: warm paper neutrals, ink primary, one green accent reserved for money-to-people (PENDING human approval)
- **Date:** 2026-11-16
- **Decision:** Neutrals are warm "receipt paper" (`canvas #f6f4ef`, `surface #fff`, ink `#1b1915`). Primary buttons are ink-black, not the accent. The single accent is deep green `#17694f` (dark `#4cc39a`), used only for money moving to a person (cashback, rewards, referral flow, success). Amber/brick are status-only. Spending is never shown in red. Light + dark tokens, all text pairs ≥ AA (table in `docs/design/DESIGN_SYSTEM.md`).
- **Reason:** A green CTA would make green mean "button"; keeping it for payouts gives the colour a job ("green = somebody got paid") and keeps the UI calm.
- **Who:** UI_DESIGN

## D-602 — Type: Instrument Sans (variable, next/font), tabular figures via `money` utility
- **Date:** 2026-11-16
- **Decision:** One family, Instrument Sans 400–700 + wdth, via `next/font/google` (`src/design/fonts.ts`, CSS var `--font-instrument`). Every amount uses the `money` utility (`tnum`+`lnum`). Mono is system `ui-monospace`, only for hashes in Details/transparency.
- **Reason:** Precise but warmer and less template-y than Inter/Geist; narrow figures fit large amounts at 390px; real `tnum` (verified in GSUB).
- **Who:** UI_DESIGN

## D-603 — Signature motif: the split receipt (SplitBreakdown) + loupe; money graph edges ∝ √amount
- **Date:** 2026-11-16
- **Decision:** Payments are shown as a perforated receipt: bar (venue share vs reward slice) → loupe magnifying the reward slice into one segment per person → recipient lines. Used in pay sheet, success, venue onboarding, transparency. Money graph: venue edge neutral, reward edges green, width = 2 + k·√(amount/total) so $0.11 stays visible next to $10.20.
- **Who:** UI_DESIGN

## D-604 — Money display rules: bigint in, half-up cents on primary screens, exact on transparency
- **Date:** 2026-11-16
- **Decision:** UI takes USDC base units as `bigint` only. `src/design/money.ts` rounds half-up to cents (via `@vouch/shared` `formatUsd`) for primary screens; `precision="exact"` (e.g. $0.693) only on the transparency page. Positive money-in = `+$0.45` green; money-out = `−$12.00` with U+2212 in ink. Thousands grouped.
- **Note:** Rounded parts can differ from the total by a cent in other stories; the canonical $12.00 story sums exactly at cents too ($10.20/$0.45/$0.69/$0.30/$0.25/$0.11).
- **Who:** UI_DESIGN

## D-605 — Copy: banned technical words on primary screens; Details drawer is the only exception
- **Date:** 2026-11-16
- **Decision:** `apps/web/src/design/COPY.md`. Banned on primary screens: USDC/token/crypto, gas, wallet address/0x…, transaction/hash, sign/signature/countersign, seed/recovery phrase/private key, blockchain/on-chain/smart contract, referral/referrer, testnet (except "Top up (testnet demo)"). Allowed inside `<Details>` (`data-copy-scope="details"`) and on the transparency page. Passkey copy = "Face ID or fingerprint". Enforced by `pnpm --filter web design:shots`.
- **Who:** UI_DESIGN

## D-606 — Design-only placeholders: L2 introducers named Marco (→Ana) and Sofia (→Priya); dev port 3200 for UI_DESIGN
- **Date:** 2026-11-16
- **Decision:** The canonical story leaves the level-2 introducers unnamed; mocks use Marco ($0.25) and Sofia ($0.11). UI_DESIGN's dev server runs on 3200 (3000 unrelated, 3100 = human's phone test build, per D-006 brief).
- **Who:** UI_DESIGN

## D-501 — Venue identity + relayed venue-owner actions
- **Date:** 2026-11-16
- **Decision:** A venue id is `address(uint160(uint256(keccak256(abi.encode(owner, salt)))))` (`computeVenueId`, also in `@vouch/shared`). The id is not a key: `Order/Intro/Weights.venue` carry it. Every owner action (`registerVenue`, `updateTerms`, `setKeys`, `setSeedAmbassador`) has ONE entry point that takes `(…, uint64 deadline, bytes ownerSig)`. If `msg.sender == owner` the signature is ignored. Otherwise anyone (the relayer) may submit it with the owner's EIP-712 signature (`RegisterVenue` / `UpdateTerms` / `SetVenueKeys` / `SetSeedAmbassador`), which consumes `nonces(owner)` (OZ `Nonces`, sequential and shared by the four types). The deadline is inclusive. Signatures go through `SignatureChecker`, so ERC-1271 owners work. There is no ownership transfer.
- **Reason:** users never pay gas, venue owners included. A salt lets one owner run several venues, and lets each demo rehearsal or smoke run use a fresh venue: customers are verified per venue, so a reused venue can't replay the story.
- **Alternatives:** venue == owner address (rejected: one venue per key, and the canonical story can only run once per key); msg.sender only (rejected: the owner would need gas).
- **Who:** CONTRACTS

## D-502 — On-chain fallback attribution rule
- **Date:** 2026-11-16
- **Decision:** Attributor weights are used only if ALL of these hold: `PaymentAuth.weightsHash != 0`, `hashStruct(weights) == weightsHash`, `weights.{venue,customer,orderId}` match, length 1–5 (equal to `bps` length), every bps > 0 and ≤ 8,000 unless single, Σ == 10,000, no duplicates, every referrer holds an *eligible* intro (see D-505), and the venue attributor signed it. Otherwise the fallback applies and the payment never reverts. Fallback over the eligible intros in slot order: `raw_i = linkWeight_i × 2^20 >> floor(age_i / 3 days)`, where personal = 2, broadcast = 1, age = now − acceptedAt and halvings are capped at 10. Then `w_i = floor(raw_i × 10,000 / Σraw)`, and the remainder goes to the most recently accepted intro (ties go to the lower index). Every eligible intro gets w ≥ 1, and the 8,000 cap does not apply to the fallback. `PaymentSettled.weightsMode`: 0 NONE, 1 ATTRIBUTOR, 2 FALLBACK_NOT_COMMITTED, 3 FALLBACK_HASH_MISMATCH, 4 FALLBACK_INVALID, 5 FALLBACK_BAD_SIGNATURE.
- **Reason:** it is deterministic, cheap, and matches the off-chain baseline's link-type weight and 3-day half-life (no opens signal on chain). The customer commits to the weights inside the USDC authorization nonce, so a relayer that swaps weights can only degrade the split to the neutral rule, never block it.
- **Alternatives:** an equal split (ignores the link-type signal); reverting on a hash mismatch (rejected: violates "never revert because of weights").
- **Who:** CONTRACTS

## D-503 — Frozen terms with multiple intros: per-referrer slices
- **Date:** 2026-11-16
- **Decision:** `slice_i = floor(amount × w_i × rewardBps(frozen version of intro_i) / 10,000²)` and `pool = Σ slice_i`. Each slice is split 25/55/20 independently: `floor(slice × 2,500/10,000)` cashback, `floor(slice × 5,500/10,000)` L1 to referrer i, and `floor(slice × 2,000/10,000)` L2 to referrer i's introducer. Cashback is summed into one transfer. The frozen `minOrder` of each intro also applies (D-505).
- **Reason:** each referrer is paid at the rate in force when they shared. Total reward ≤ amount × max frozen rate. Canonical numbers are exact (10,200,000 / 450,000 / 693,000 / 297,000 / 252,000 / 108,000).
- **Alternatives:** one pool at the max or min frozen rate (rejected: one referrer's old terms would change another's pay).
- **Who:** CONTRACTS

## D-504 — Rounding
- **Date:** 2026-11-16
- **Decision:** Every share is floored, as above. The venue receives `amount − Σ(successfully transferred shares)`, which includes per-slice dust (≤ 2 units per referrer) and all returned shares. Σ transfers == amount exactly. Invariant for indexers: `PaymentSettled.venueAmount + Σ RewardPaid.amount == amount`.
- **Who:** CONTRACTS

## D-505 — Intro rules: TTL, terms in force, live-intro cap, eligibility
- **Date:** 2026-11-16
- **Decision:**
  - `expiresAt − issuedAt ∈ (0, 30 days]`. `issuedAt ≤ now + 15 min`.
  - `termsVersion` must be the version in force at `issuedAt`. Old-rate exposure therefore ends ≤ 30 days after any terms change, and a referrer can't pick a superseded, better version. Clients must set `issuedAt` from **chain time** (latest block timestamp).
  - Expiry is inclusive: valid while `now ≤ expiresAt`.
  - Customer ≠ referrer, and the referrer must be verified at the venue or a seed ambassador. A customer who is already verified cannot accept intros.
  - Personal intros are single-use (key = introHash). Broadcast intros are once per customer (key = keccak(introHash, customer)).
  - **≤ 5 live intro slots per (customer, venue), at most one per referrer.** The slot is chosen in this order: same referrer → replace (`IntroDropped` reason 0); else the first expired slot → reuse (reason 1); else append; else evict the oldest `acceptedAt` (reason 2).
  - An intro is **eligible** at payment time iff it is unexpired AND `amount ≥ minOrder` of its frozen version.
  - No `revokeIntro`.
- **Who:** CONTRACTS

## D-506 — Recipient griefing: failed transfers return to the venue; gas starvation reverts
- **Date:** 2026-11-16
- **Decision:** Reward shares are sent with a low-level `USDC.transfer` call. If one fails (e.g. a blacklisted recipient), its share goes to the venue payout and `RewardReturned(reason = TRANSFER_FAILED)` is emitted. If the failure looks like out-of-gas (`gasleft() ≤ gasBefore/63` after the call), the whole tx reverts (`TransferOutOfGas`), so a relayer cannot starve transfers to redirect referrers' shares to the venue (tested by sweeping gas limits). A failing venue payout transfer reverts the payment (`PayoutTransferFailed`). Events are emitted after the transfers, because the outcome decides `RewardPaid` vs `RewardReturned`. Everything that decides who is paid is written before the USDC pull; stats counters are updated after it, under `nonReentrant`.
- **Who:** CONTRACTS

## D-507 — Seed-ambassador bootstrap
- **Date:** 2026-11-16
- **Decision:** The venue owner allowlists addresses with `setSeedAmbassador(venue, a, allowed, …)` (relayable). A seed may sign intros without a prior purchase. A seed has no introducer, so L2 shares through a seed's referrals return to the venue (`RewardReturned` NO_INTRODUCER). Revoking a seed does not cancel intros already accepted. A seed may also be a customer: its first purchase follows the normal rules.
- **Who:** CONTRACTS

## D-508 — L2 details, cycles and self-payment (refines D-008/D-010)
- **Date:** 2026-11-16
- **Decision:**
  - **Introducer.** It is the top-weight L1 of the first rewarded purchase, per (customer, venue). Ties go to the lower index of the weights array actually used: the attributor array order, or slot order under the fallback. It is frozen forever. A first purchase that isn't rewarded leaves the introducer at address(0).
  - **L2 recipient.** `introducerOf(venue, L1_i)`. If that is address(0), the share returns to the venue (NO_INTRODUCER).
  - **Cycles.** If it equals the paying customer (the A→B→A cycle), the share also returns to the venue (SELF_PAYMENT).
  - **One recipient, two roles.** A referrer may receive both L1 and L2 in one payment (e.g. Ana L1 for Ben and L2 via Priya, whom Ana introduced). These are distinct contributions and each is paid once.
- **Who:** CONTRACTS

## D-509 — First-purchase semantics and payment binding
- **Date:** 2026-11-16
- **Decision:**
  - **First purchase.** A customer's FIRST purchase at a venue always verifies them, and it is their only chance at a reward there. With ≥ 1 eligible intro it is rewarded. Otherwise it is a plain payment (e.g. below the frozen minOrder), and later purchases are plain. Clients should warn before a below-minimum first purchase.
  - **Customer signature.** The customer signs ONLY USDC `ReceiveWithAuthorization{from, to: Vouch, value: amount, validAfter: 0, validBefore: auth.deadline, nonce: hashStruct(PaymentAuth)}`. PaymentAuth stays `{customer, venue, orderId, amount, weightsHash, deadline}`. The deadline is exclusive (`now < deadline`), as in USDC.
  - **Where the pull happens.** The USDC pull lives in exactly one internal function, `_pullPayment` (MSG-004).
  - **Order.** `amount` must be in 1…1,000,000e6. Order expiry is inclusive.
  - **No ETH.** The contract is non-payable and has no receive/fallback.
- **Who:** CONTRACTS

## D-510 — Event schema v1, size, deployment
- **Date:** 2026-11-16
- **Decision:**
  - **Events.** Final schema in `IVouch.sol` / INTERFACES §4 (proposal `docs/proposals/interfaces-phase1.md`). Changes vs the v0 draft:
    - `VenueRegistered` adds `salt` and `payout`.
    - `VenueKeysUpdated` adds `payout`.
    - `PaymentSettled` replaces `termsVersion` + `fallbackWeights` with `rewarded` + `uint8 weightsMode`.
    - `RewardPaid` adds `customer`.
    - New events: `IntroDropped` and `RewardReturned`.
  - **Contract size.** Enum-like constants are `internal` to stay under EIP-170 (runtime 23,570 B). Their values are mirrored in `@vouch/shared` `abi/vouchConstants.ts`.
  - **Deployment.** Arc Testnet `0xfEe6CA5a9523715146374FEd857E63DE7DcCb2d3`, block 72580272, Blockscout-verified.
- **Who:** CONTRACTS

## D-511 — Fork tests shim Arc's native-transfer precompile
- **Date:** 2026-11-16
- **Decision:** On a Foundry fork, Arc USDC (`NativeFiatTokenV2_2`) runs for real (payee check, EIP-712 signature, authorization nonces), but its balance move calls the Arc precompile `0x1800…0000` `transfer(from, to, value18)`, which revm lacks. `VouchForkTest` etches a shim there that moves the native balance with `vm.deal`. The fork tests are opt-in: `VOUCH_FORK=true` or `bash scripts/deploy/fork-test.sh`.
- **Who:** CONTRACTS

## D-701 — QE test conventions for contracts (test_BUG_ fail by design; LIMIT/INFO pass)
- **Date:** 2026-11-16
- **Decision:**
  - Tests in `contracts/test/qe/` named `test_BUG_*` assert the EXPECTED (secure) behaviour, so they FAIL until CONTRACTS fixes the matching finding (QE-C-01..03). A plain `forge test` is therefore red until MSG-014/015/016 are resolved.
  - `test_LIMIT_*` and `test_INFO_*` pass and document accepted or known behaviour.
  - Fork tests in `qe/` are opt-in (`VOUCH_FORK=true`), like the builder's.
  - CI/gates should treat "only `test_BUG_*` failing" as "open QE findings", not as a broken build.
- **Reason:** keeps every repro executable and self-verifying. When a fix lands, its test turns green with no QE edit.
- **Who:** CONTRACTS_QE

## D-012 — QE-C-01 fix: bind the submitter in PaymentAuth (keeps invariant 6 as written)
- **Date:** 2026-11-16
- **Decision:** Add `address submitter` to `PaymentAuth` (and therefore to the EIP-3009 nonce). `pay` requires `submitter == address(0) || msg.sender == submitter`. The app always signs with `submitter = RELAYER`. `submitter = 0` ("anyone may submit") is reserved for the documented kill-the-backend path, where front-running is an accepted, documented risk. Invariant 6 is unchanged: an invalid or missing attributor signature still falls back on-chain and never blocks payment.
- **Reason:** CONTRACTS_QE (QE-C-01 / MSG-014) showed that public `pay` calldata can be front-run with a garbage attributor signature or swapped weights, forcing the fallback split (in the demo: Priya 792,000 instead of 198,000 of L1, plus a permanently wrong introducer) while the honest tx reverts. Binding the submitter removes the attacker's ability to submit at all, without changing the human's invariant 6. The alternative (revert when a customer-committed attributor signature is invalid) would have required rewording invariant 6 and needed a human decision.
- **Alternatives:** (a) revert on invalid committed weights (changes invariant 6; deferred to the human); (c) accept the risk (rejected: it corrupts the frozen introducer, which is permanent).
- **Who:** ORCHESTRATOR (default taken to keep the gate moving; flagged to the human, who can override)

## D-512 — D-012 implemented: PaymentAuth.submitter (QE-C-01)
- **Date:** 2026-11-16
- **Decision:**
  - **Type.** `PaymentAuth` gains `address submitter` as its last field: `PaymentAuth(address customer,address venue,bytes32 orderId,uint256 amount,bytes32 weightsHash,uint64 deadline,address submitter)`, typehash `0xf9bd6d8f…7abcba4`. Because the field is in the struct hash, it is also in the EIP-3009 nonce.
  - **Check.** `pay` reverts `UnauthorizedSubmitter()` when `submitter != 0 && msg.sender != submitter`. The check runs LAST in `_checkOrder`, so malformed orders and signatures still report their own errors, and a rejected attempt changes no state.
  - **Unchanged.** Fallback semantics (D-502) and `previewPayment`.
  - **Usage.** The app and the smoke script sign `submitter = RELAYER`.
- **Who:** CONTRACTS (implements ORCHESTRATOR D-012)

## D-513 — Payout guard (QE-C-02)
- **Date:** 2026-11-16
- **Decision:** `_checkKeys` (used by registerVenue and setKeys) rejects `payout == address(this)` and `payout == address(USDC)` with `InvalidPayout()`, in addition to zero addresses. Vouch has no sweep, so either would strand venue shares forever.
- **Who:** CONTRACTS

## D-514 — Zero-amount L1 credits are emitted (QE-C-03)
- **Date:** 2026-11-16
- **Decision:** For every credited L1 referrer (bps > 0) whose L1 share floors to 0, `_distribute` records `RewardPaid(role 1, amount 0, via = referrer)` with no transfer. Other zero shares are still skipped. Ambassador `customersCredited` / `venues` are now rebuildable from events alone. This was the smallest change; an extra per-referrer event would have cost size we don't have (≈540 B headroom).
- **Who:** CONTRACTS

## D-515 — Every owner action consumes the owner nonce (QE-C-04)
- **Date:** 2026-11-16
- **Decision:** `registerVenue`, `updateTerms`, `setKeys` and `setSeedAmbassador` call `_useNonce(owner)` on the direct path too, so a direct action invalidates any outstanding signed action carrying the current nonce. Residual limit: a signature pre-signed for a FUTURE nonce (n+1) becomes valid once n is used. Clients should sign only the current nonce, with short deadlines.
- **Who:** CONTRACTS

## D-516 — Superseded-terms grace window; corrects D-505 (QE-C-05)
- **Date:** 2026-11-16
- **Decision:**
  - **Correction.** D-505's claim that "a referrer can't pick a superseded, better version" was wrong: `issuedAt` is chosen by the referrer and can be back-dated.
  - **New rule.** An intro whose `termsVersion` has been superseded is accepted only while `now ≤ effectiveAt(version + 1) + SUPERSEDED_GRACE` (72 h). The in-force-at-issuedAt check is unchanged.
  - **Effect.** Back-dating reaches old terms only during the 72 h after a terms change. Links legitimately shared before a change also stop being acceptable 72 h after it; the frontend should ask the referrer to re-share. Intros accepted earlier stay frozen (invariant 8).
- **Alternative rejected:** `issuedAt ≥ now − 72h` for all intros, because it would break 7–30-day broadcast links.
- **Who:** CONTRACTS

## D-517 — Gas floor per reward transfer + pinned ordering (QE-C-07); documented limits (QE-C-06, QE-C-08)
- **Date:** 2026-11-16
- **Decision:**
  - **Gas floor and ordering (QE-C-07).**
    - `_tryTransfer` reverts `TransferOutOfGas()` unless `gasleft() ≥ 100,000` before the call. The token frame then always gets ≥ 98k, far above a USDC transfer, so a failure is a genuine refusal. This closes the nested-call false negative of the 63/64 post-check, which is kept as well.
    - `_distribute` ordering is pinned by a comment and by `test_distribute_orderingPinned_*`: all reward transfers, then stats, then the venue payout, then events.
  - **Accepted limits** (no code change; mitigate off-chain):
    - **Personal-intro sniping (QE-C-06):** a personal intro names no customer, so a mempool observer can accept it first.
    - **Submitter-chosen eviction order (QE-C-06):** when 6+ acceptances are pending, whoever submits picks which referrer the 5-slot cap evicts.
    - **Sybil self-referral clusters (QE-C-08):** cost one real purchase per sybil and are capped by rewardBps. Flag them in ATTRIBUTION_AI risk flags.
    - **Orders not bound to a customer (QE-C-08):** a third party paying first is griefing only, since they pay real money. Treat QR orders as single-use.
    - **Gas-burning ERC-1271 attributor (QE-C-08):** needs ~64× gas; this is the venue's own misconfiguration.
  - **Mitigations:** submit `acceptIntro` / `pay` through the relayer (private path where possible) and keep deadlines short.
- **Who:** CONTRACTS

## D-518 — Redeploy v2
- **Date:** 2026-11-16
- **Decision:**
  - **v2.** Arc Testnet `0x9C502fBF77BF31c6e88C92b55D1c67A21491b95f`, block 72584790, tx `0xa74642869c7f787be73598c4ffa590097ad7643af24ec8ade19d625b7265a2ab`, Blockscout-verified. Runtime 24,036 B.
  - **v1 retired.** `0xfEe6…b2d3` (block 72580272) must not be used.
  - **Unchanged.** Event signatures and topic0s; only the address and start block change for Streams.
  - **Builds.** Production builds (`export-abi.sh`, `deploy-vouch.sh`) now pass `--skip test`, so a broken test file can't block deploy or export.
- **Who:** CONTRACTS

## D-702 — QE regression naming after fixes (supersedes the "fails by design" part of D-701 for fixed findings)
- **Date:** 2026-11-16
- **Decision:** after a fix is re-verified, its `test_BUG_*` test is renamed `test_FIXED_*` and must pass. The same applies to a `test_LIMIT_*` whose behaviour was fixed. On v2 (`0x9C50…b95f`) there are no `test_BUG_*` tests, so a red `forge test` now means a regression. Two `test_BUG_*` tests had test-side defects, both raised by CONTRACTS and confirmed by QE: memory aliasing in the swapped-weights repro, and an assertion that described the bug instead of the required property. Both were corrected without weakening the property they check.
- **Who:** CONTRACTS_QE

## D-013 — QE-C-09 residuals: submitter rule is normative; system-address payouts accepted as owner misconfiguration
- **Date:** 2026-11-16
- **Decision:** (1) `PaymentAuth.submitter` MUST be the relayer EOA (or an access-controlled contract). Never a public forwarder or multicall, and never `0` in the app flow. `0` is reserved for the documented kill-the-backend demo. (2) Payouts to `0x1800…`/`0xffff…fffe` are left allowed: the owner burns its own share, nothing stays in Vouch, invariant 1 holds, and a redeploy isn't worth it for this; revisit if a v3 deploy happens for other reasons. (3) The API signs owner actions only at the current `nonces(owner)`. (4) The UI/API prompts referrers to re-issue links after a terms change (72 h grace, D-516). (5) `MIN_TRANSFER_GAS` (100k) is documented against Arc USDC's measured ~74.6k tx gas.
- **Reason:** CONTRACTS_QE v2 re-verification (MSG-038). No invariant broken; these are integration rules for BACKEND_RELAYER/FRONTEND_INTEGRATION.
- **Who:** ORCHESTRATOR

## D-014 — A5: submitter may be the RELAYER or the customer; no `submitter = 0` path (v3, conditional)
- **Date:** 2026-11-16
- **Decision:** The human approved D-012 in principle with a change: a customer's `PaymentAuth` names either the RELAYER (app flow) or the customer themself (kill-the-backend demo: the customer self-submits and pays gas in USDC). The `submitter = 0` "anyone" path is removed, which closes the QE-C-09 front-run gap. Implemented as Vouch **v3**, conditional on fitting under EIP-170 with every invariant green; pipeline CONTRACTS → independent CONTRACTS_QE → redeploy → `@vouch/shared` + INTERFACES update. If it does not fit, D-012 stays as is and the human is told. The production Stream's start block = the final deploy block, so this settles before the Stream is created.
- **Reason:** Human Amendment A5 #1. Note: v2 already accepts `submitter = customer` (the check is `submitter != 0 && msg.sender != submitter`), so v3 only deletes the zero branch and shrinks the bytecode.
- **Supersedes:** the "`0` reserved for kill-the-backend" clause of D-012 and D-013(1).
- **Who:** HUMAN (A5), recorded by ORCHESTRATOR

## D-015 — S3 proof = the production Vouch Stream (no hello-contract Stream)
- **Date:** 2026-11-16
- **Decision:** The hello-contract test Stream (`vouch-s3-hello-spike`) is dropped. The human creates ONE production Stream in the QuickNode dashboard for the final Vouch contract (start block = final deploy block). It is the S3 live proof, and QE Part B verifies against it. The Hello filter and runbook stay as offline/QE artifacts.
- **Reason:** Human Amendment A5 #2: one Stream, fewer credits, no throwaway dashboard work.
- **Supersedes:** ORCHESTRATOR.md "Next up" items 1–2 (hello stream checklist and verification).
- **Who:** HUMAN (A5), recorded by ORCHESTRATOR

## D-016 — Stable API host on Railway before the production Stream (Phase 5 deploy pulled forward)
- **Date:** 2026-11-16
- **Decision:** `apps/api` is deployed to **Railway** (Dockerfile, managed Postgres, fixed `*.up.railway.app` HTTPS domain) before the production Stream is created; the Stream's webhook is `<railway-domain>/webhooks/streams`. Secrets (`STREAMS_WEBHOOK_SECRET`, later relayer keys) are set by the human in Railway → service → Variables, and mirrored in the local `.env`. Quick tunnels (D-005) are now for phone tests only.
- **Reason:** Human Amendment A5 #3: quick tunnels died three times and every death changes the URL. Railway: trial is a one-time $5 credit, no card; services stay on; Postgres is one click. Render's free web services spin down after 15 min idle (about 1 min wake-up), which is bad for webhook deliveries, and its free Postgres expires after 30 days. Fly needs a card.
- **Alternatives:** Render (sleeps), Fly (card), keep tunnels (rejected by the human).
- **Who:** HUMAN (A5) + ORCHESTRATOR (host choice)

## D-017 — Design direction approved (MSG-007)
- **Date:** 2026-11-16
- **Decision:** The human approved UI_DESIGN's six questions: (a) ink-black primary buttons, green reserved for money going to a person (D-601); (b) Instrument Sans (D-602); (c) split-receipt magnifier/loupe motif, kept **lightweight and projector-readable** (D-603); (d) copy "Confirm with Face ID or fingerprint", never "passkey" on primary screens (D-605); (e) placeholder L2 names Marco and Sofia (D-606); (f) hide Next's dev badge (`devIndicators: false`). Also required: fix the cashback self-loop under Ben in the money graph (MSG-008).
- **Reason:** Human Amendment A5 #4. Unblocks Phase 3 hi-fi screens.
- **Who:** HUMAN (A5), recorded by ORCHESTRATOR

## D-519 — v3 submitter rule: `msg.sender == auth.submitter`, nothing else (implements D-014; option (a))
- **Date:** 2026-11-16
- **Decision:**
  - **Check.** `_checkOrder` ends with `if (msg.sender != auth.submitter) revert UnauthorizedSubmitter();`. The v2 zero branch is deleted, so `submitter = 0` can never be paid by anyone (`msg.sender` is never 0). The customer chooses the submitter when signing: the app signs `RELAYER`, and the kill-the-backend demo signs the customer's own address and sends `pay()` from that EOA (gas paid in USDC from the same balance, so the balance must cover `amount` plus the fee).
  - **Unchanged.** The `PaymentAuth` type string and typehash (`0xf9bd6d8f…7abcba4`), the EIP-3009 nonce (= hashStruct(PaymentAuth), D-103), `_pullPayment` (`receiveWithAuthorization(customer, address(this), …)`, so USDC's payee check still sees `msg.sender == Vouch`), the ABI, events and topic0s (`export-abi.sh` output byte-identical). Only the address and deploy block change at redeploy.
  - **Size.** Runtime 24,036 → **23,998 B** (−38). Margin under EIP-170 (24,576): **578 B**.
- **Why (a), not (b) (`msg.sender != submitter && msg.sender != customer`):**
  - (a) is smaller (23,998 B vs 24,042 B for (b)) and simpler: exactly one address can submit, and the signer names it.
  - (b) adds nothing the customer needs. A customer who wants to self-submit already can under (a) by signing `submitter = self`.
  - (b) lets the customer race the relayer on an auth that names the relayer, e.g. with a garbage attributor signature to force the fallback. That gives the customer no new power over attribution, since they could equally sign `weightsHash = 0` or `submitter = self`, and the fallback is deterministic (D-502). But it makes the relayer's tx revert after the backend has already quoted the attributor split, so the backend's view of "what was signed for us" would no longer be authoritative. (a) keeps that contract: an auth naming the relayer can only be settled by the relayer.
  - Neither option opens a third-party path.
- **Tests.**
  - `VouchQeFixes`: the permissive `test_C01_zeroSubmitterAllowsAnyone` is replaced by `test_D519_*`:
    - a zero submitter is refused for an attacker, the relayer and the customer, with no state change;
    - a customer self-submit settles the canonical split exactly (10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108);
    - a third party, the relayer or another referrer cannot submit a self-submit auth;
    - the customer cannot submit a relayer-bound auth (option (a) pin);
    - a signed submitter cannot be downgraded to 0;
    - a fuzz test: any caller other than the named submitter is refused.
  - The invariant handler routes pays across relayer-bound, self-submit and zero-submitter auths and probes a non-submitter on every pay.
  - The fork tests add self-submit and zero-submitter on real Arc USDC.
- **Supersedes:** the `submitter = 0` clause of D-012 / D-512 and D-013(1) (as D-014 directs).
- **Who:** CONTRACTS

## D-305 — Railway deploy config, raw delivery table, PORT (implements D-016)
- **Date:** 2026-11-16
- **Decision:** (a) **PORT:** the api listens on `PORT` (host-injected), then `API_PORT`, then 4000. Empty counts as unset and an invalid port throws. (b) **Raw ingest:** every HMAC-**verified** delivery is inserted into Postgres/PGlite `stream_deliveries` (migration `0001_stream_deliveries`; columns `id, received_at, verified, stream_id, batch_start, batch_end, event_count, bytes, gzip, headers jsonb, summary jsonb, body jsonb, body_text`) **before** the 200. If the insert fails the api answers **500 `persist-failed`** so QuickNode retries: no ack without persistence. Rejected requests (503/401/400) never get a row. D-301 semantics are otherwise unchanged. Stored headers are allow-listed (`content-*`, `user-agent`, `x-qn-nonce`, `x-qn-timestamp`, `stream-*`, `batch-*`), and `x-qn-signature` is not stored. `stream_id`/`batch_*` prefer the headers (QE-15) and fall back to the body envelope. No dedupe (Phase 2 dedupes on `(txHash, logIndex)`). (c) **Logs:** one pino line per request, `msg:"streams delivery"`, with `{verified, status, reason?, bytes}` plus `{rowId, streamId, batchStart, batchEnd, eventCount, eventNames, blocks, shape}` for verified requests only. It never contains the token, signature or body. (d) **NDJSON spike log** stays on locally and is off when `NODE_ENV=production`, unless `STREAMS_SPIKE_LOG` names a path; `STREAMS_SPIKE_LOG=off` disables it anywhere. (e) **Image:** root `Dockerfile` (node:24-slim, corepack pnpm@11.28.6, `pnpm install --frozen-lockfile --prod --filter "@vouch/api..."`, `node --import tsx src/server.ts` as user `node`). `tsx` moved to `@vouch/api` **dependencies** because it is the runtime. `--prod` is required: a filtered install still installs the root importer, whose devDependencies include `forge-std` from codeload.github.com. `.dockerignore` excludes `.env*` (keeps `.env.example`). `railway.json`: DOCKERFILE builder, healthcheck `/health` (120 s), restart `ON_FAILURE` (10). (f) `streams:deliveries --db [--db-url]` reads the table (`DATABASE_PUBLIC_URL` → `DATABASE_URL`, postgres:// or on-disk pglite://), refuses `*.railway.internal` hosts and never prints credentials. (g) `streams render-filter --events vouch` preset = the 10 production events from `@vouch/shared` (no `EIP712DomainChanged`).
- **Reason:** D-016 (stable webhook URL). The container disk is ephemeral, so the hosted record must live in Postgres. Railway injects `PORT`. Acking an unpersisted delivery would lose it silently, because QuickNode only retries on non-2xx.
- **Alternatives:** keep NDJSON on a Railway volume (not queryable, one more resource); a store-everything table including rejects (unauthenticated public writes to the DB, rejected); `pnpm deploy` (needs `injectWorkspacePackages` or `--legacy`; more moving parts than `--prod`); a tsup/esbuild bundle (D-204 says only if plain node is required).
- **Caveat:** Railway marks `railway.json` (Config as Code) deprecated in favour of IaC (`.railway/railway.ts`), with legacy support stated until 2026-12-01. RAILWAY.md says to confirm the healthcheck and restart policy in the service settings. Moving to IaC is a follow-up.
- **Who:** STREAMS_INFRA

## D-703 — QE fork bytecode pin across redeploys; invariant probes must not be rolled back
- **Date:** 2026-11-16
- **Decision:**
  - **Fork bytecode pin.** Each deployed Vouch version is pinned to ITS OWN bytecode, not to the working tree.
    - `test_fork_deployedV2RuntimeEqualsRecordedV2Build` asserts that live `0x9C50…b95f` has runtime keccak `0xae810c8a…6aa4513` (24,036 B), the v2 typehash and the USDC immutable. The hash was recorded after re-running the original `deployCodeTo` equality test against a scratch checkout of the v2 source (HEAD `contracts/src`).
    - `test_fork_deployedV3RuntimeEqualsThisSource` proves live == this source for the address in `VOUCH_V3`. It skips while `VOUCH_V3` is unset and refuses the v2 address.
    - On the next redeploy, the v3 hash gets recorded the same way before the source moves on.
  - **Invariant probes.** In `QeLedgerHandler`, a probe that a correct contract must refuse RETURNS on breach instead of continuing to the honest call. Otherwise the honest call's revert (e.g. `OrderAlreadySettled`) rolls back the recorded violation under `fail_on_revert = false`.
- **Reason:**
  - **Pin.** A source change always breaks a "live == this source" pin for the previous deployment. Re-targeting the pin to the new source would leave the still-live v2 unpinned, and deleting it would lose the deployment proof.
  - **Probes.** The v2 front-run probe had this blind spot. Mutation testing for v3 (v2 rule / option (b) / no check) showed the harness stayed green until it was fixed.
- **Who:** CONTRACTS_QE

## D-520 — Redeploy v3 (final Stream target)
- **Date:** 2026-11-16
- **Decision:**
  - **v3.** Arc Testnet `0xF4B641dc628de05336aa983B07D5d181254ff08e`.
    - Block **72605845**, which is the production Stream's `start_range` (D-015).
    - Tx `0x7a9bd4b1f61888606b91e2a58f6a61efa2761e810216b04730addfead8dc2709`; fee 0.155 USDC.
    - Blockscout-verified.
    - Deployed from commit `5caef11` (D-519 source).
    - Runtime 23,998 B, keccak `0x58517bb04fc9c29faa513490884edb03c918e3656e1785bf7434e5ae330c6795`. QE's `test_fork_deployedV3RuntimeEqualsThisSource` passes (D-703).
  - **Retired.** v2 `0x9C50…b95f` (block 72584790) and v1 `0xfEe6…b2d3` (block 72580272) are listed in `@vouch/shared` `VOUCH_RETIRED_DEPLOYMENTS`. `deploy-vouch.sh` now moves the previous deployment there automatically.
  - **Unchanged.** ABI, events, topic0s, EIP-712 types and the typehash (`export-abi.sh`: 0 diff). Only the address and start block change.
  - **Smoke on v3** (exact 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 both times):
    - Relayed (`submitter = RELAYER`): pay tx `0x95cbda97e7a015b6c105f07cf364b3cc258cc6769cd13a10ce8ae0697280673e`, 409,801 gas.
    - Self-submit (`submitter = Ben`, sent from Ben's EOA, gas in USDC): pay tx `0xfca0e1aeb40f9aa4e8564a60d0ac56817297956b2560d9db9bdc8823aa18c7be`, 371,065 gas. It passed the QE-C-11 pre-flight (`balance ≥ amount + gasLimit × maxFeePerGas`).
  - **Integration rules (QE-C-10 / QE-C-11).** D-519 binds per auth, not per order. A customer may settle a second self-submit auth for the same order first. The relayer treats `OrderAlreadySettled` as terminal and reads the split from events. Self-submit needs the balance pre-flight.
  - **Funding.** Ben's smoke funding came from Lena, the venue payout wallet (new `--fund-from-payout`), not from DEPLOYER, so the deployer keeps its reserve for deploys.
- **Who:** CONTRACTS (Orchestrator-authorized after the CONTRACTS_QE v3 PASS-with-findings)

## D-306 — Phase 2 Streams ingestion: idempotent ev_* derived state, ingest-after-durable, 200 on ingest failure, determinism hash
- **Date:** 2026-11-16
- **Decision:**
  - **Where.** `apps/api/src/streams/` (`decode`, `ingest`, `queries`, `bus`, `hash`, `backfill`, `verify`, `index` = `createStreams(db)`). Derived tables live in `apps/api/src/streams/schema.ts`, all prefixed `ev_`: `ev_events, ev_cursor, ev_ingest_log, ev_venues, ev_terms, ev_seeds, ev_intros, ev_verified, ev_payments, ev_rewards, ev_venue_stats, ev_ambassadors`. They have their own migrations folder `apps/api/drizzle-streams/` (`drizzle-streams.config.ts`) and their own migrations table `drizzle.__drizzle_migrations_streams`. `db.migrate()` applies `apps/api/drizzle` and then `apps/api/drizzle-streams`.
  - **Decode.** Logs are found in any body shape (envelope v1 or raw nesting). A log is kept only when all of these hold: address = Vouch v3 (so USDC `0x3600…` and the EIP-7708 system emitter `0xffff…fffe` are dropped), topic0 ∈ the 10 production topics, `removed` is false, and it decodes strictly with `vouchAbi`. Everything else is counted as ignored. Args are stored JSON-safe: uint as decimal strings, addresses checksummed.
  - **Idempotent and ordered.** Each batch runs in one transaction, serialized in-process and guarded by `pg_advisory_xact_lock`. The insert is `INSERT … ON CONFLICT (tx_hash, log_index) DO NOTHING`, and only new events are applied, in `(blockNumber, logIndex)` order. If a new event sorts before the cursor, the derived tables are wiped and rebuilt from `ev_events` in order. The derived state is therefore a pure function of the set of events: re-deliveries, retries, overlaps and reverse-order batches all converge. Venue stats and ambassador rows are recomputed by SQL aggregate for every touched key in the same transaction.
  - **Webhook.** The raw `stream_deliveries` insert commits first (D-305 unchanged). Ingest then runs in its own transaction. **If ingest fails, the response is still 200**: the failure is recorded in `ev_ingest_log` and retried from the raw table after the next delivery (`retryFailed`) and on boot (`ingestPending`), or by `streams:replay`. A raw-insert failure still returns 500. Each `streams delivery` log line carries `ingest:{ok,newEvents,duplicates,ignored,rebuilt,cursorBlock,events}`.
  - **Bus.** In-process. It publishes after commit, only for events new to `ev_events`, with one `payment.settled` per PaymentSettled that is aggregated with its reward lines. Duplicates, replay, backfill and rebuild publish nothing. Listener exceptions are caught.
  - **Port.** The queries and bus implement BACKEND_RELAYER's StreamsPort (MSG-062, accepted in MSG-063).
  - **Determinism.** `hashDerived` = sha256 over every hashed `ev_*` table, rows sorted by PK and serialized as canonical JSON. It excludes provenance (`source`, `delivery_id`, `ingested_at`), `block_timestamp` (whether Streams logs carry it is UNVERIFIED), `ev_ingest_log`, and the cursor's batch and rebuild counters. The chain backfill uses eth_getLogs in ≤ 10k-block chunks and runs the frozen `docs/streams/filter-vouch.js` in a bare `vm`, so it produces envelope v1 bodies byte-compatible with a live delivery. `streams:verify` asserts chain-backfill == live (signed webhook, 5-block batches, every batch twice, plus an overlap) == replay (copy) == replay (wipe in place) == rebuild.
- **Reason:** the bounty requires that all derived views come from Streams events. Arc has no reorgs. QuickNode only retries on non-2xx, and its retries cannot fix a deterministic ingest bug: they would retry until the Stream auto-pauses (`max_retry`). The raw table already makes every acked delivery durable and replayable. Making state order-independent (rebuild on a late batch) is simpler and stronger than trying to guarantee in-order arrival across retries, replays and backfills, and the event volume (tens to hundreds of logs) makes a full rebuild cheap.
- **Alternatives:** answer 500 on ingest failure (rejected: a poison delivery would pause the Stream, and the raw row already exists, so QuickNode's retry would only duplicate it); ingest inside the raw-insert transaction (rejected: an ingest bug would then block persistence); incremental-only apply that rejects late events (rejected: replaying an earlier failed delivery is a legitimate late batch).
- **Verified:** on real v3 chain data 72605845..72612484 (48 logs), all five paths hash to `0b0c880d…5c1f34`. Both canonical pays give exactly 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108.
- **Who:** STREAMS_INFRA

## D-307 — Production Stream config (v3, dashboard) and its test-filter expectations
- **Date:** 2026-11-16
- **Decision:** ONE Stream (D-015), with these settings:
  - Network: Arc Testnet (`arc-testnet`). Dataset: `logs`.
  - Range: start 72605845, no end, latest-block delay 0, reorg handling off.
  - Filter: `docs/streams/filter-vouch.js`, rendered and committed by the Orchestrator with `--contract 0xF4B641dc628de05336aa983B07D5d181254ff08e --events vouch`. It is frozen.
  - Destination: webhook `https://api-production-902bc54c.up.railway.app/webhooks/streams`, compression none.
  - Token: goes in Railway → api → Variables → `STREAMS_WEBHOOK_SECRET`.
  - The config is mirrored in `infra/streams/stream-vouch-prod.json`.
  - **Test-filter expectations** (runbook §P.1, re-derived from the frozen file on the real blocks):
    - 72606007: `VenueRegistered`@4 and `TermsUpdated`@5 (tx `0x7ecc2161…5ee7`).
    - 72606074: `CustomerVerified`@74, `PaymentSettled`@90, `RewardPaid`@91–95 (tx `0x95cbda97…673e`).
    - 72606174: `CustomerVerified`@53, `PaymentSettled`@69, `RewardPaid`@70–74 (tx `0xfca0e1ae…c7be`).
    - 72606075: `null`.
- **Who:** STREAMS_INFRA (values from ORCHESTRATOR + D-520)

## D-801 — Relayer: one EOA, strictly serialized jobs, chain-reconciled nonces, replace-with-bump, guards before send
- **Date:** 2026-11-16
- **Decision:**
  - **One RELAYER EOA** (`RELAYER_PRIVATE_KEY`) submits every user-signed call. Jobs are **strictly serialized**: one job holds the lock from `eth_call` simulation until its receipt. On Arc (≈0.7 s blocks) that is about 1 tx/s, which is enough for the demo. Each simulation runs on top of the previous tx's state, and at most one nonce is ever in flight.
  - **Nonce manager:** before each job, the local nonce is compared with the chain's `pending` count. If the chain is ahead (the key was used elsewhere), its value is adopted. If the chain is behind (a dropped tx left a gap), the lower nonce is reused. A "nonce too low" error on send triggers a resync and a resend.
  - **Retries:** if no receipt arrives within `RELAYER_RECEIPT_TIMEOUT_MS` (30 s), the job is re-sent at the **same nonce** with maxFee and priority fee × 1.25. This repeats up to `RELAYER_MAX_SEND_ATTEMPTS` (4) times and never goes above `RELAYER_MAX_FEE_GWEI` (200). Transport errors back off and retry; a persistent outage returns `RELAYER_DOWN`.
  - **Checks before anything is sent:**
    - simulation: any revert is TERMINAL and is never retried;
    - a per-job pre-flight, e.g. the customer balance check (QE-C-11);
    - **max-gas guard:** estimate × 1.2 must be ≤ the per-kind cap. Caps: registerVenue 400k, owner actions 200k, acceptIntro 350k, pay 1.2M (worst case ≥ 805k, MSG-040);
    - fees: clamped to ≥ 20 gwei, and refused if above the fee cap;
    - the relayer's own balance must cover gasLimit × maxFee.
  - **Limits:** in-memory per-user (12/min) and global (120/min) relay rate limits, plus a max queue depth (50). The api is a single process (D-202).
  - **Records:** each job is a `relay_txs` row (every replacement hash is kept).
  - **API status:** `submit()` resolves at broadcast. The API then answers `202 {status: "pending", txHash}`; "settled" is never decided by the relayer (D-803).
- **Reason:** Arc has no reorgs and blocks are fast, so serializing removes whole classes of nonce races for little throughput cost. Simulating inside the lock means a dependent job, such as acceptIntro right after registerVenue, never fails against stale state.
- **Alternatives:** pipelined nonces with several txs in flight (more throughput, much harder gap recovery); a nonce pool across multiple relayer keys (deferred until load needs it).
- **Who:** BACKEND_RELAYER

## D-802 — Sign-in: EIP-191 challenge from the browser wallet key → HMAC session token
- **Date:** 2026-11-16
- **Decision:**
  - **Challenge:** `POST /auth/challenge {address}` returns a one-time SIWE-style message (5-minute TTL, stored in `auth_challenges`, rate-limited per IP).
  - **Verify:** `POST /auth/verify {address, challengeId, signature, displayName?, passkeyCredentialId?}` checks the signature with viem `verifyMessage`. The challenge is consumed atomically (`UPDATE … WHERE used_at IS NULL`). The user is upserted.
  - **Token:** `v1.<b64url{sid,sub,exp}>.<b64url HMAC-SHA256(SESSION_SECRET)>`, with a revocable `sessions` row (7-day TTL by default).
  - **Transport:** `Authorization: Bearer`, the `vouch_session` cookie, or `?token=` (SSE only).
  - **Fail closed:** with no `SESSION_SECRET`, sign-in answers 503.
- **Reason:** D-104 puts a passkey-gated local EOA in the browser, so an EIP-191 signature is the natural proof of control and needs no extra WebAuthn server verification for Tier 1. The HMAC token is stateless to check; the DB row exists only for logout.
- **Who:** BACKEND_RELAYER

## D-803 — "Settled" comes only from StreamsPort; QE-C-10 and QE-C-11 handling
- **Date:** 2026-11-16
- **Decision:**
  - **Status vocabulary:** the API's own tables hold relay state only. Orders are `pending → relayed | failed`; payment intents are `quoted → relaying → relayed | failed | already_settled`. "paid" / "settled" fields come only from `StreamsPort.getPayment` (STREAMS_INFRA's `ev_*` tables), so the quote is never shown as the split.
  - **QE-C-10:** an `OrderAlreadySettled` revert (pre-simulation, in-lock simulation, or a reverted receipt with `isOrderSettled == true`) is TERMINAL. The API answers `409 ORDER_ALREADY_PAID`, with `details.settled` taken from Streams, or `waitingOnStreams: true` until it is ingested.
  - **QE-C-11, relayed:** the customer's USDC balance must be ≥ amount. This is checked before relaying and again inside the relayer lock (`402 INSUFFICIENT_BALANCE`, nothing sent).
  - **QE-C-11, self-submit:** a quote with `mode: "self-submit"` (kill-the-backend helper only) needs `balance ≥ amount + 900k × maxFeePerGas` (the fee rounded up to 6 decimals). It returns `submitter = customer`, and the API never relays it.
  - **Submitter:** the API never produces `submitter = 0` (the code asserts it). App quotes always name the RELAYER (D-014/D-519).
- **Who:** BACKEND_RELAYER

## D-804 — Owner actions are two-step at the current `nonces(owner)`; one in flight per owner
- **Date:** 2026-11-16
- **Decision:**
  - **Prepare:** `prepare` reads `nonces(owner)` and chain time and returns the EIP-712 message to sign. The deadline is now + 10 min, so signatures stay short-lived (D-515).
  - **Submit:** `submit` verifies the signature off-chain and re-reads the nonce. If the nonce moved, it answers `409 OWNER_NONCE_STALE` and nothing is relayed. A future nonce is never queued (D-013(3)).
  - **One at a time:** an owner may have only one relayed action in flight (`OWNER_ACTION_PENDING`). A new prepare supersedes older prepared actions.
  - **Registration keys:** registration always uses our VENUE_SIGNER and ATTRIBUTOR addresses as the venue's `signer` / `attributor`. Orders are signed only for venues whose on-chain signer is our key (`VENUE_NOT_MANAGED` otherwise). Weights are signed only when the venue's attributor is our key; otherwise `weightsHash = 0` and the on-chain fallback applies.
- **Who:** BACKEND_RELAYER

## D-805 — Baseline attribution v1 (Phase 2; ATTRIBUTION_AI owns it from Phase 4)
- **Date:** 2026-11-16
- **Decision:**
  - **Score:** `score = linkTypeWeight (personal 2 / broadcast 1) × (1 + 0.25 × opens) × 2^(−(now − acceptedAt)/3 days)`.
    - `now` and `acceptedAt` are chain time, read from `getLiveIntros` (the same clock as the on-chain fallback, D-502).
    - `opens` = opens of the link carrying that introHash by this customer or anonymous visitors. The referrer's own opens are excluded, and opens are capped at 8.
  - **"Who sent you here?":** an answer naming an eligible referrer adds 50% of the total score to that referrer.
  - **Candidates:** only eligible intros: unexpired, and amount ≥ the frozen minOrder.
  - **Bounds:** at most the top 5 scores (kept in slot order); the 8,000 cap is water-filled; largest-remainder rounding (ties go to the lower index); each weight ≥ 1; Σ = 10,000.
  - **Interface:** `Attributor.attribute(AttributionInput) → AttributionResult` in `apps/api/src/attribution/baseline.ts`.
  - **Canonical case:** 3 opens on Ana's personal link and 2 on Priya's broadcast link give 3.5 : 1.5 = **exactly 7,000 / 3,000**. This is what story:api uses.
- **Who:** BACKEND_RELAYER

## D-806 — API errors: stable codes + end-user copy
- **Date:** 2026-11-16
- **Decision:**
  - **Shape:** every error is `{error: {code, message, retryable, details?}}`. `message` is primary-screen copy with no gas/USDC/nonce/hash words (D-605). The frontend switches on `code`.
  - **Mapping:** reverts and USDC revert strings map to codes in `apps/api/src/chain/errors.ts`, for example:
    - OrderExpired → `ORDER_EXPIRED` 410
    - OrderAlreadySettled → `ORDER_ALREADY_PAID` 409
    - "exceeds balance" → `INSUFFICIENT_BALANCE` 402
    - CustomerAlreadyVerified → `ALREADY_REWARDED` 409
    - TermsNotInForce → `LINK_NEEDS_REISSUE` 409
    - relayer unreachable or unconfigured → `RELAYER_DOWN` 503 (retryable)
  - **Amounts:** amounts in requests and responses are decimal strings of base units, or `{baseUnits, display}`.
- **Who:** BACKEND_RELAYER

## D-308 — Webhook: cheap checks before decode, 4 MiB raw / 8 MiB decoded caps (SECURITY_REVIEW P-L3 gzip bomb)
- **Date:** 2026-11-16
- **Decision:**
  - **Order of checks.** In `POST /webhooks/streams` the checks now run in this order:
    1. Secret configured, else 503.
    2. All three `X-QN-*` headers present, else 401.
    3. Decode.
    4. HMAC.
    5. JSON parse, only after the HMAC verifies.
    Nothing is decompressed or parsed for a request that can't verify.
  - **Raw body limit 4 MiB** (was 50 MiB), enforced by Fastify's parser (413 before the handler).
  - **Gunzip cap.** `gunzipSync(raw, { maxOutputLength: 8 MiB })`. Over the cap → **413 `decoded-body-too-large`**. Other gzip errors → 400. Neither is ever a 500, so QuickNode never gets a retry loop out of them. An uncompressed body over 8 MiB is held to the same cap.
  - **Over-cap requests store nothing.** They can't be authenticated (the HMAC covers the decoded bytes), so they are treated like every other unauthenticated reject: one log line, no `stream_deliveries` row (D-305), and no decoded body stored anywhere. The local NDJSON spike log keeps rejected bodies only up to 64 KiB.
- **Reason:**
  - **Sizing from real deliveries.** One envelope event is about 0.9 KB. Blocks 72606070..74 (8 events) = 7,325 B. The whole v3 history as one envelope is about 44 KB. The Hello S3 deliveries were 758 B. The Stream uses compression none (D-307).
  - **4 MiB raw** is about 4,500 Vouch events (≈ 650 canonical pays) in one batch, about 100× our history.
  - **8 MiB decoded** is 2× raw, so anything acceptable uncompressed is also acceptable gzipped.
  - **Measured.** A 512 MiB-inflating bomb without headers now returns 401 in about 3 ms with no gunzip call. With fake headers it returns 413, with RSS growth under 64 MiB.
- **Who:** STREAMS_INFRA (finding: SECURITY_REVIEW)

## D-309 — Webhook replay/retry hygiene (SEC-2-10): per-IP rate limit, raw dedupe, bounded retries, skew still log-only
- **Date:** 2026-11-16
- **Decision:**
  - **(a) Rate limit.** In-process per-IP token bucket, keyed on `req.ip` only (X-Forwarded-For is never parsed; trustProxy is BACKEND_RELAYER's).
    - Burst 600, refill 50 req/s.
    - Implemented as an `onRequest` hook scoped to the webhook plugin, so it runs before the body is read.
    - Over the limit → 429 + `Retry-After`, with one log line per refusal episode.
    - Why this is generous: QuickNode delivers sequentially (it waits for the 2xx), so a backfill burst is a few dozen req/s at most. A 429 is just retried by QuickNode (max_retry 20, interval 1 s).
  - **(b) Raw dedupe.**
    - Key: `ev_delivery_keys`, PK = sha256(stream_id | batch_start | batch_end | decoded body). The table is in `apps/api/drizzle-streams/0001_delivery_keys.sql`, so the shared journal is untouched.
    - A repeat (a replayed signed delivery, or a QuickNode re-send of a stored batch) answers 200 `duplicate: true` and points at the first row, with `repeats` incremented. No new raw row, no re-ingest.
    - Key and row are written in one transaction.
    - The table is raw-layer: never wiped by rebuild/replay and not hashed.
    - Ingest stays idempotent on (tx_hash, log_index).
  - **(c) Bounded work in the request.**
    - The webhook waits at most 5 s (`INGEST_WAIT_MS`) for its own ingest. On timeout it answers 200 (the row is durable) and the ingest continues in the background, serialized.
    - `retryFailed()` no longer runs in the request. It schedules one background pass (only one at a time):
      - at most 5 deliveries per pass;
      - only deliveries with attempts < 5;
      - only once the backoff has elapsed: 10 s × 2^(attempts−1), max 10 min.
    - Deliveries beyond the cap are left to `ingestPending()` (boot, `streams:replay`).
  - **(d) Replay window: still log-only.** `X-QN-Timestamp` skew is logged but never rejected, because the unit (s vs ms) is UNVERIFIED until a live delivery. Rejecting on a wrong guess would drop every real delivery. (b) already makes replays harmless to storage, and (tx_hash, log_index) already made them harmless to state. Revisit once the first live deliveries show the unit: then reject skew > 5 min and keep a short nonce cache.
- **Caveat:** until trustProxy lands, `req.ip` behind Railway's proxy may be the proxy's address, i.e. one shared bucket for everyone. That is still generous for QuickNode, but a flood could then also delay QuickNode (it retries after a 429).
- **Who:** STREAMS_INFRA (finding: SECURITY_REVIEW SEC-2-10)

## D-807 — Only the paying customer's own signed-in link opens feed attribution (SEC-2-05)
- **Date:** 2026-11-17
- **Decision:**
  - **Recording:** `POST /intros/:code/opens` still records logged-out opens. They are kept for analytics: `opener = null`, IP hash, and the response says `countsForAttribution: false`.
  - **Scoring:** the baseline score (D-805) counts **only opens made by the paying customer's own session** on that link. The referrer's own opens are never counted. The cap stays at 8.
  - **Supersedes:** the "anonymous" part of D-805's opens definition.
  - **Canonical case unchanged:** the canonical story opens while signed in as Ben, so weights stay 7,000 / 3,000. A test pins that 10 anonymous opens leave the 2 : 1 link-type split at 6,667 / 3,333.
- **Reason:** an unauthenticated signal must not move money that the ATTRIBUTOR signs. Requiring a session for opens would lose the analytics signal from pre-signup visitors.
- **Who:** BACKEND_RELAYER. Numbered in my D-8xx range; the coordinator asked for "D-5xx", which is CONTRACTS' range.

## D-808 — Relayer spend budget, per-identity quotas, pay lane, balance floor (SEC-2-02, SEC-2-12, QE-2-01)
- **Date:** 2026-11-17
- **Decision:**
  - **Budget:** rolling hourly and daily windows on relayer gas spend, in USDC base units, at three levels: global, per session address, and per venue. A job reserves `gasLimit × maxFeePerGas` before its first send, and a fee bump grows the reservation. At the receipt the reservation becomes the actual `gasUsed × effectiveGasPrice`, **reverts included**. A job that was never broadcast is released.
  - **Defaults:**
    - global: $1.00/h, $5.00/day;
    - per user: $0.20/h, $0.50/day;
    - per venue: $0.50/h, $2.00/day.
  - **Refusals:** an exhausted global budget answers `503 RELAYER_BUDGET_EXHAUSTED`; an exhausted identity budget answers `429 SPEND_QUOTA_EXCEEDED` (`details.scope` = user | venue | kind). Both are retryable and send nothing.
  - **Persistence:** each relay row stores `venue` and `fee_usdc` (migration `0003_relayer_budget`). The last 24 h are re-seeded at boot, so a restart does not reset the budget. `/relayer/status` shows the limit, used and remaining amounts per window.
  - **Per-kind count quotas per user:**
    - registerVenue 3/day;
    - owner actions 20/h;
    - acceptIntro 20/h;
    - pay 30/h.
  - **Pay lane:** the worker always runs a queued `pay` before other kinds, and `RELAYER_PAY_RESERVE` (20) of the 50 queue slots are pay-only.
  - **Balance floor:** a relayer balance below `RELAYER_MIN_BALANCE_USDC` ($2.00) plus the tx's worst-case cost refuses with `RELAYER_UNDERFUNDED`, and logs one `ALERT` line per episode.
  - **Minimum order:** orders the API signs must be ≥ `ORDER_MIN_USDC` ($0.50).
  - **Replacements:** before paying for a fee-bumped replacement, the relayer re-simulates. If the state moved on (e.g. `OrderAlreadySettled`), it stops; that is terminal and the original tx keeps its reservation.
  - **Payment intents:** `quoted → relaying` is a single conditional `UPDATE … WHERE status='quoted' RETURNING` (identical SQL on PGlite and Postgres), done BEFORE the pre-simulation. The loser of a double submit gets `409 PAYMENT_ALREADY_USED` and never writes the row. `already_settled` can only be written on an intent this request claimed.
  - **Shared orders:** an order changes status only on chain-confirmed outcomes of a relayed tx (mined → relayed, reverted → failed). A refused attempt never marks it `failed` (QE-2-09).
- **Reason:** identities are free, so per-address limits alone don't bound spend. The demo wallet holds ~$20, and the canonical story costs ≈ $0.05.
- **Unchanged:** QE-C-10 (OrderAlreadySettled is terminal; the split comes from Streams) and QE-C-11 (balance pre-flights).
- **Who:** BACKEND_RELAYER

## D-809 — Request hardening: route-class limits, client IP behind Railway, token transport, SSE caps, headers, redaction (SEC-2-03/04/06/07/08/09/13)
- **Date:** 2026-11-17
- **Decision:**
  - **Per-IP limits by route class** (per minute; each is an env knob):
    - auth 20 (challenge, verify);
    - **spend** 20 (everything that enqueues a relay job, plus venue registration and metadata writes);
    - write 60;
    - read 300;
    - sse 20 connects.
    - The relayer's per-user and global rates stay on top.
  - **Client IP:** Fastify `trustProxy` defaults to Railway's internal proxy range `100.64.0.0/10`, never blanket `true`. `req.ip` is then the client from X-Forwarded-For, and spoofed leftmost entries are ignored.
    - `TRUST_PROXY` = `off` | a hop count | a CIDR list overrides it.
    - Local dev (peer 127.0.0.1) is unaffected.
    - **UNVERIFIED on Railway:** whether the edge appends any non-100.64 hop to XFF. Check the client IP in the hosted logs after deploy.
  - **Session token transport:** only `Authorization: Bearer` is accepted. Cookies are no longer accepted (SEC-2-09). `?token=` works only on `GET /events/user/:address`, because EventSource can't set headers.
  - **Log redaction:** the request-log serializer writes `token=[redacted]`. The error serializer and relayer logs scrub every URL to `<url>`, so a keyed `ARC_RPC_URL` never reaches a log or a response, and raw error text is never copied into `details`.
  - **SSE limits:**
    - connection caps: global 500, per client IP 8, per channel 100;
    - only known venues get a channel;
    - a slow consumer (`res.write` → false, or over 256 KiB buffered) is dropped;
    - 15 s heartbeat; connections close after 30 min, and the client reconnects.
  - **Security headers** on every response: nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, the CSP `default-src 'none'; frame-ancestors 'none'`, HSTS, COOP, and `cache-control: no-store` by default.
  - **Standard error shape:** unknown routes return the `{error:{code:"NOT_FOUND",…}}` body.
  - **CORS:** allows GET, HEAD, POST, PATCH, DELETE and OPTIONS, with the authorization and content-type headers.
  - **No config disclosure:** errors no longer say which secret is missing. `/relayer/status` exposes one `enabled` flag, with no per-signer detail.
- **Who:** BACKEND_RELAYER

## D-810 — API contract clarifications from the Phase 2 QE gate (QE-2-03..08)
- **Date:** 2026-11-17
- **Decision:**
  - **Payout check:** `payout ∈ {0, Vouch, USDC}` is refused at prepare (`400 INVALID_PAYOUT`), for registerVenue and setKeys, so the owner never signs an unpayable config.
  - **setSeedAmbassador `allowed`:** must be a JSON boolean; anything else gives 400.
  - **"The QR expired":** `ORDER_EXPIRED` at both quote and pay. `PAYMENT_EXPIRED` means only that this signed payment's own window (10 min) ran out while the order is still valid.
  - **`GET /venues`:** lists venues **registered through this API**, status `registered` only, newest first. Paginated with `?limit≤50&offset≤1000` and `nextOffset`. Streams-only venues are served by `GET /venues/:venue`.
  - **Unknown venues:** `GET /venues/:venue/terms` and `/stats` answer `404 UNKNOWN_VENUE` like `GET /venues/:venue`. A venue that exists on chain but isn't ingested yet returns empty data with `waitingOnStreams`.
  - **Money shape:** `GET /intros/:code` `terms.minOrder` uses the standard `{baseUnits, display}` money shape.
  - **Duplicate intro:** `POST /intros` with an already-stored signed intro answers 200 with the same code (201 means newly created).
- **Who:** BACKEND_RELAYER

### D-018 — 2026-11-17 — Railway `TRUST_PROXY=2` (Orchestrator)
Hosted check after 920a042: with the default `100.64.0.0/10`, `req.ip` was Railway's edge (`152.233.47.x`, outside the internal range), so per-IP buckets were still shared. Railway's chain is client → edge → internal proxy → app, so a hop count of 2 is correct. Set `TRUST_PROXY=2` as a non-secret service variable via the CLI. Verified in hosted logs: plain requests and requests with a spoofed leftmost `X-Forwarded-For: 1.2.3.4` both log the real client IP. The code default stays `100.64.0.0/10`, which is safe locally.

### D-019 — 2026-11-18 — Amendment A7: schedule triage (human) + orchestrator implementation choices
- **Decision (human, A7, full text in ORCHESTRATOR_PROMPT.md):** Phase 3 + the visual half of Phase 4 start immediately and merged, without waiting for Part B or a "go". Part B runs in parallel (20-min box once the Stream reaches head; on failure record why and retry at Thursday's QE gate). Schedule: Thu AM web deploy (Vercel) + seed script + bug fixes; Thu PM QE gate on the deployed app + demo choreography; Thu night docs/video script/pitch; Fri AM final checks, repo public (with approval), human submits by 10:00 ET (hard deadline 13:00 ET). **CUT (Tier 3):** AI attribution refinement, eval harness, risk flags, second frontend, friends feed; deterministic baseline attribution stays. HUMAN_INPUT #9 (LLM key) → dropped. Quality rule: cut scope not quality; >50% overrun → stop and propose a cut.
- **Orchestrator choices to implement it:**
  1. **One shared web dev server on :3100** (`next dev`, started by the Orchestrator), because Railway `CORS_ORIGINS` currently allows only `http://localhost:3100` and Next 16 allows one dev server per project dir. Agents never start their own; phone tests now use a tunnel onto this server or the Vercel deploy. Port 3000 still untouched.
  2. **Ownership split for the two UI_DESIGN instances:** UI-customer owns `src/screens/customer/**`, `src/design/**`, and every `src/components/ui/*` except the venue set; UI-venue owns `src/screens/venue/**`, `src/screens/public/**`, and the venue-side components `MoneyGraph`, `Slider`, `Keypad`, `QrCode`, `QRFrame`, `Stat`, plus any new venue-only components. `components/ui/index.ts` is append-only for both. Cross-owner component changes go by inbox request.
  3. **Screens stay props-only**; FRONTEND_INTEGRATION owns `src/app/**` (except `app/design/`), `src/lib/**`, `src/hooks/**`, `src/state/**` and wires against the hosted Railway API + SSE. Prop-contract changes are announced by inbox.
  4. **Demo top-up:** the v1 API dropped `POST /onboarding/topup`; judges joining via QR need funds, so BACKEND_RELAYER adds a capped, once-per-wallet demo top-up endpoint (labelled "testnet demo" in UI). Deployed only after Part B finishes so the hosted api is not redeployed mid-check.
- **Who:** human (A7) + ORCHESTRATOR

## D-811 — Demo top-up endpoint + venue payments feed + stats edge names (A7 / D-019 #4)
- **Date:** 2026-11-18
- **Decision (demo top-up):**
  - **Endpoints:** `GET /demo/topup` (session optional) → `{enabled, eligible, amount, dailyRemaining, reason?, topup}`. `POST /demo/topup` (Bearer; the session's own address; no body) → 202 `{status:"pending", amount, txHash, relayId}`. The transfer is an ERC-20 `transfer(caller, amount)` on USDC `0x3600…0000` (6 dec). It is labelled "testnet demo" in the UI.
  - **Once per address, ever:** table `demo_topups` (PK `address`, migration `0004_demo_topups`). The claim is one conditional upsert: `insert … on conflict (address) do update … where status = 'failed' returning`. Only a `failed` attempt (refused before broadcast, or reverted) may be claimed again. A broadcast tx with no receipt becomes `unknown` and is never re-claimable, so it can't be paid twice.
  - **Global cap:** the sum of non-failed claims in a rolling 24 h must stay ≤ `DEMO_TOPUP_DAILY_USDC`. The check is inside the same INSERT statement, and claims are serialized in-process. That is sufficient for the one Railway instance; scaling out would need an advisory lock.
  - **Per client IP:** `DEMO_TOPUP_PER_IP_PER_HOUR` grants. A refused claim or send is refunded. The route is also in the `spend` route class (20/min/IP).
  - **Funder:**
    - `TOPUP_PRIVATE_KEY` gets its own `Relayer` (its own serialized queue + nonce manager).
    - Otherwise the relayer key is used through the existing relayer queue and nonce manager. Equal keys also reuse the relayer, so there is never a second sender on one key.
    - Jobs are kind `topup`, gas cap 150k, `budgetExempt`. The amount and the gas never count against the D-808 relayer budget, are not gated by it, and are excluded from the boot re-seed. Rates, simulation, fee cap, the relayer's balance floor and the pay lane still apply.
  - **Disabled:** `503 TOPUP_DISABLED` (retryable:false) when `DEMO_TOPUP_ENABLED` ≠ `"true"`, when the amount is 0, when there is no funder key, or when funder balance < amount + `DEMO_TOPUP_FUNDER_FLOOR_USDC`. The balance check is repeated inside the funder's lock right before sending. Falling below the floor logs one `ALERT` line per episode.
  - **New error codes:**
    - `TOPUP_DISABLED` (503, not retryable)
    - `TOPUP_ALREADY_CLAIMED` (409, with `details.topup`)
    - `TOPUP_DAILY_CAP_REACHED` (429, not retryable)
    - `RATE_LIMITED` with `details.scope: "topup_ip"`
  - **SSE:** `wallet.topup` `{address, status: pending|confirmed|failed, amount, txHash, relayId, code?}` on `user:<address>`.
  - **Env (all optional; secret: `TOPUP_PRIVATE_KEY` only):**
    - `DEMO_TOPUP_ENABLED` (default off)
    - `DEMO_TOPUP_USDC` (3.00)
    - `DEMO_TOPUP_DAILY_USDC` (30.00)
    - `DEMO_TOPUP_PER_IP_PER_HOUR` (5)
    - `DEMO_TOPUP_FUNDER_FLOOR_USDC` (5.00)
    - `TOPUP_PRIVATE_KEY` (unset → the relayer key)
- **Decision (venue feed):** `GET /venues/:venue/payments?limit=1..50&before=` (public; default 20). It returns recent settled payments from `ev_payments` / `ev_rewards` only (D-803), newest first by (block, logIndex).
  - **Response:** `{venue, payments, nextBefore, source:"streams"}`.
  - **Item:** `{orderId, txHash, blockNumber, settledAt (ISO from block time, or null), customer:{address, displayName|null}, amount, venueReceived (= venueAmount), cashback, rewards:[{recipient:{address, displayName|null}, level:1|2, amount}], rewardsReturned, firstPurchase, rewarded}`.
  - **Rewards:** paid lines only; returned lines are summed in `rewardsReturned`.
  - **Paging:** keyset. `nextBefore` = `"<block>-<logIndex>"`; a bare block number is accepted too.
  - **Errors:** 404 `UNKNOWN_VENUE` (same rule as `/stats`, QE-2-08); 400 for a bad `limit` / `before`.
  - **STREAMS_INFRA area:** `listPayments` gained an optional `before` filter (read-only, MSG-089).
- **Decision (stats edges):** `GET /venues/:venue/stats` edges keep `{orderId, from, to, role, amount, txHash}` and add `level` (= role), `fromDisplayName` and `toDisplayName` (from `users`, null when unknown).
- **Proposed INTERFACES §5 additions:**
  - **Demo:** `GET /demo/topup` → `{enabled, eligible, amount, dailyRemaining, reason?: TOPUP_DISABLED|UNAUTHENTICATED|TOPUP_ALREADY_CLAIMED|TOPUP_DAILY_CAP_REACHED, topup: null|{status, amount, txHash, relayId, errorCode, claimedAt}}`; `POST /demo/topup` (Bearer) → 202 `{status:"pending", amount, txHash, relayId}` (testnet demo; once per address; capped, D-811).
  - **Reads:** `GET /venues/:venue/payments?limit≤50&before=` → `{venue, payments:[…], nextBefore}`; `/venues/:venue/stats` edges + `level`, `fromDisplayName`, `toDisplayName`.
  - **SSE:** + `wallet.topup`.
  - **Errors:** + `TOPUP_DISABLED` (503), `TOPUP_ALREADY_CLAIMED` (409), `TOPUP_DAILY_CAP_REACHED` (429).
  - Replace "Dropped from the v0 draft: `POST /onboarding/topup`" with "replaced by the capped `POST /demo/topup` (D-811)".
- **Proposed INTERFACES §7 addition:** "**Phase 3 demo top-up (D-811, optional):** `DEMO_TOPUP_ENABLED` (`true` to enable; default off), `DEMO_TOPUP_USDC` (3.00), `DEMO_TOPUP_DAILY_USDC` (30.00, rolling 24 h, global), `DEMO_TOPUP_PER_IP_PER_HOUR` (5), `DEMO_TOPUP_FUNDER_FLOOR_USDC` (5.00, the funder keeps at least this), `TOPUP_PRIVATE_KEY` (**secret**, optional dedicated funder; unset → the relayer key through the relayer queue)."
- **Reason:** judges join with a fresh $0 wallet (D-019 #4). Free identities make once-per-address weak, so the global cap is the real bound ($30/day by default). Keeping the top-up outside the gas budget means a burst of top-ups can't pause payments.
- **Not done:** N-1 (reserve part of the relayer budget for `pay`). It didn't fall out of this work and is still on the backlog.
- **Who:** BACKEND_RELAYER

## D-607 — Split magnifier v1: grouped by role, ≤3 slices, one soft wedge (MSG-044, D-017c)
- **Date:** 2026-11-18
- **Decision:** `SplitBreakdown` magnifies the reward slice into at most three groups (you · the people who recommended it · the people who brought them in), not one segment per person. The loupe is a single soft wedge with no hairlines. The `bar` variant adds a 3-column legend (group name + big amount), and the `receipt` variant keeps one line per person below. Props are unchanged; a new `pending` prop renders the receipt gray with an "Arriving" tag until settlement.
- **Reason:** the human asked for a lightweight, projector-readable magnifier. With per-person segments, Sofia's $0.11 was a 20px sliver. Three slices stay legible at any scale, and the names live in the lines.
- **Who:** UI_DESIGN (customer)

## D-608 — Pay sheet: primary "Confirm with Face ID or fingerprint"; explicit Skip; problems swap the sheet
- **Date:** 2026-11-18
- **Decision:** The pay sheet's one primary button reads "Confirm with Face ID or fingerprint" (aria-label "Pay $12.00 to Lena's café. Confirm with …"). The amount is the display figure above it, and a caption reads "You pay $12.00. No fees." "Who sent you here?" offers recommender chips, "Someone else" and a quiet "Skip" chip (`whoSentYou`: null | id | "other" | "skip"). It only appears when there is money back. Errors don't show as toasts: they replace the sheet content with a `PayProblem` state, each with one way forward. A balance below the amount turns into "insufficient" automatically. Repeat visits show a kind "regular payment" note, not an error.
- **Reason:** D-017(d) copy, one primary per screen (COPY.md), and judges score hidden complexity: every failure reassures "Nothing was charged".
- **Who:** UI_DESIGN (customer)

## D-609 — Pending → settled: gray until the money lands, then green
- **Date:** 2026-11-18
- **Decision:** After relay (202) the success screen shows a quiet ink ring, "Paying Lena's café…", a gray receipt marked "Arriving" and "$0.45 back, on its way". On `payment.settled` (Streams) the mark pops green, the receipt floods green and "Ana and Priya were just thanked" appears. The caller vibrates then. Activity rows use the same rule: pending rows are muted with a "Pending" tag.
- **Reason:** green means somebody got paid (D-601). Turning green before settlement would be a lie that only lasts a few seconds.
- **Who:** UI_DESIGN (customer)

## D-610 — /design catalogue split by owner; design:shots reads it
- **Date:** 2026-11-18
- **Decision:** Customer mocks live in `app/design/_mocks/CustomerMocks.tsx` + `meta.customer.ts`, and `ScreenMock` delegates to them. `design:shots` now parses `_mocks/meta*.ts` instead of a hand-kept list. It takes `DESIGN_WHO` (Customer|Venue|Public) and `DESIGN_OUT` (relative to the repo), and in filtered runs it also reports tap targets under 44px and the first Tab stop's focus ring. `Button size="sm"` and `SegmentedControl` went from 40 to 44px tall.
- **Reason:** two UI instances edit /design at the same time (D-019 #2). Separate files avoid merge collisions, and a parsed list can't drift.
- **Who:** UI_DESIGN (customer)

## D-611 — MoneyGraph v1: flat flow input, tiered deterministic layout, √amount edges, "N more" folding
- **Date:** 2026-11-18
- **Decision:** `MoneyGraph` takes `data = {venue:{id,name}, flows: MoneyFlow[], names?}`.
  - `MoneyFlow = {paymentId, from, to, level: "venue"|"cashback"|1|2, amount}`, which is 1:1 with `/venues/:venue/stats` edges (role 0 → "cashback", 1, 2) plus one `"venue"` flow per payment (customer → venue, venueAmount).
  - Layout is fixed columns with no physics: venue ← customers → recommenders → introducers. Columns run left→right on a projector (1280×720 viewBox) and become rows top→bottom on a phone (360-wide viewBox).
  - People in the highlighted payment take the column of their role in it, so the story always reads in one direction. Everyone else sits in the highest tier they were paid in. Order within a column follows each node's strongest edge into the next tier, to cut crossings.
  - Edge width = 2 + k·√(amount / largest edge) (D-603).
  - The tail folds into one "N more" node per column: 7 per column on a projector, 4 per row on a phone. Highlighted people are always kept.
  - `mode="payment"` draws one payment; `mode="network"` aggregates per (from, to, level) and keeps history pale.
  - Unknown addresses show as "Guest N", never hex.
  - Plain SVG + CSS, no d3. v0 props stay accepted.
- **Reason:** It is deterministic and readable on a projector at 5, 20 and 60 people (screenshots in `docs/evidence/phase-3/design/venue/`), and FRONTEND_INTEGRATION can derive the input straight from the API.
- **Who:** UI_DESIGN (venue)

## D-612 — Cashback is a badge, not a loop; arrival choreography keyed on the payment id (MSG-008/MSG-044)
- **Date:** 2026-11-18
- **Decision:** The customer's cashback renders as a green "+$0.45 back" pill on the customer node: above it on a projector, to the right on a phone (above when the row is crowded). The role-0 self-edge is never drawn.
- **Choreography:** when `live` and `highlightPaymentId` (or `replayKey`) changes, the graph assembles in payout order:
  - 0 ms: the customer pops in.
  - 250 ms: the venue stream draws (650 ms).
  - The cashback badge pops.
  - 700 ms: recommenders, 140 ms apart.
  - Then introducers.
  - Each recipient pings when its money lands. Dashes run toward recipients for about 3 s, then fade (finite, so nothing needs pausing on hidden tabs).
- **Reduced motion:** the final frame, with no draw, dashes or ping.
- **Who:** UI_DESIGN (venue)

## D-613 — Venue dashboard: cost per new customer vs a typical ad; one component, phone <1024px / projector ≥1024px
- **Date:** 2026-11-18
- **Decision:**
  - The hero KPI is "Cost per new customer" (`costPerVerifiedCustomer`), next to an editable "Typical ad cost" ($20.00 default, caller-stored), with one plain line: "$18.48 less per new customer than a typical ad. About 13× less."
  - Feed rows read "Ben paid $12.00 · $1.35 to 4 people who sent Ben · now", with "$10.20 to you" on the right.
  - Live status uses the SSE states live / connecting / reconnecting / offline, with a reassuring note when it's not live.
  - A brand-new venue gets an empty state explaining how it works in three steps.
  - `layout="auto"` switches at 1024px. The projector layout fits 1280×720.
- **Who:** UI_DESIGN (venue)

## D-614 — Counter: $0.50 order floor, explicit processing/refreshing QR states; onboarding drops the loupe for a two-part bar
- **Date:** 2026-11-18
- **Decision:**
  - Order entry: the floor is $0.50 (ORDER_MIN_USDC, D-808), the cap $10,000, max 2 decimals (`applyOrderKey` / `parseOrderEntry`). The note field is optional. The CTA reads "Show code for $12.00".
  - `QRFrameState` adds `processing` (payment.pending: "Payment on its way…") and `refreshing` (new signed order). Expired codes can auto-refresh. Paid shows "Paid $12.00" and who got what.
  - Venue onboarding shows the worked example in big type ("+$1.80 in rewards → $0.45 back to the customer, $1.35 to the people who sent them, you keep $10.20"). A two-part keep/rewards bar replaces SplitBreakdown's loupe, per D-017's "lightweight, projector-readable".
  - The CTA is "Confirm with Face ID or fingerprint". The minimum order must be at least $0.50.
- **Who:** UI_DESIGN (venue)

## D-901 — Web: QR and share links use the page's own origin, not the API's PUBLIC_WEB_URL
- **Date:** 2026-11-18
- **Decision:** The counter encodes `${webOrigin()}/pay?v=<venue>&o=<orderId>`. This is the same shape as the API's `qrPayload`, but the host is the origin the counter page is served from (`NEXT_PUBLIC_WEB_URL` overrides it). Recommendation links are built the same way: `${webOrigin()}/i/<code>`. The in-app scanner (`lib/qr.ts`) accepts any host and routes to the same path on the current origin.
- **Reason:** A phone's native camera then opens the pay sheet on whatever deployment the venue uses (localhost, tunnel or Vercel), with no API redeploy when the web host changes. The API's `PUBLIC_WEB_URL` still defaults to localhost:3100.
- **Who:** FRONTEND_INTEGRATION

## D-902 — Web: D-104 wallet implementation details
- **Date:** 2026-11-18
- **Decision:**
  - **Storage:** one account per browser profile, in IndexedDB (`vouch-wallet`).
  - **Create:** WebAuthn `create` (UV required) with the PRF extension.
    - If PRF output is available (at create, or via one extra assertion), the AES-GCM key is `HKDF-SHA256(PRF)`.
    - Otherwise ("gated"), it is a non-extractable WebCrypto AES key stored in IndexedDB, and every unlock requires a UV assertion first.
    - With no WebAuthn at all ("device"), the key is non-extractable and there is no gesture. This mode is never chosen when a passkey is possible.
  - **Memory:** the decrypted key is held in memory for at most 5 min.
  - **Fresh gesture:** payments, intro creation and acceptance always require a new gesture (`getSigner({fresh:true})`).
  - **Session:** the Bearer token is kept in localStorage (`vouch.session.v1`) and dropped on 401 or when the device account changes.
- **Reason:** This follows D-104 option B. PRF is what the human's phone passed in S6b, and the gated fallback keeps desktop browsers without PRF usable.
- **Who:** FRONTEND_INTEGRATION

## D-903 — Web: client-side payment guard before the one signature
- **Date:** 2026-11-18
- **Decision:** Before signing the quote's `ReceiveWithAuthorization`, the app checks the following. Any mismatch → refuse to sign. The app never rebuilds the message.
  - USDC domain, `from` = me, `to` = the Vouch v3 address, and `value` = `paymentAuth.amount`;
  - venue and orderId equal the scanned ones;
  - `submitter` ≠ 0, ≠ me, and = the relayer address from `/relayer/status`;
  - `nonce == paymentAuthNonce(paymentAuth)`.
- **Reason:** It enforces MSG-041/057 and D-014 on the client, so a compromised or buggy API can't get a self-submit or open-submitter authorization signed.
- **Who:** FRONTEND_INTEGRATION

## D-904 — Web: "settled" only from Streams; SSE first, polling fallback
- **Date:** 2026-11-18
- **Decision:**
  - **Customer:** the 202 from POST /payments shows "pending" (PaymentSuccessScreen `status="pending"`). "Settled" comes only from the user SSE `payment.settled` (matched by orderId) or `GET /payments/:id` status `settled` (polled every 1.5 s, or 3 s while SSE is live).
  - **Venue counter:** `payment.pending` → processing, `payment.settled` → paid, with order polling every 2.5 s across every code issued for that sale.
  - **Auto-renew:** codes last 120 s and auto-renew 4 s before expiry, up to 5 times.
  - **Evidence:** timings go to `window.__vouchTimings` / sessionStorage for the demo evidence.
- **Who:** FRONTEND_INTEGRATION

## D-905 — Web: routes are browser-only shells; viem added to apps/web
- **Date:** 2026-11-18
- **Decision:**
  - **Routes:** every app route is `<Suspense><BrowserOnly>` (`use(browser())`, Next 16 + cacheComponents). The server renders a skeleton; the screen renders where the keys live.
  - **Dependency:** `viem@2.57.18` was added to `apps/web` (already in the lockfile via `@vouch/shared`, same pin as D-206).
  - **Feature detection:** the D-811 endpoints are detected at runtime (`NEXT_PUBLIC_FLAG_* = auto|on|off`; in auto, a 404 means not deployed).
  - **Dashboard history fallback:** until the feed endpoint deploys, the dashboard falls back to the owner's `GET /venues/:v/orders` settled rows.
- **Who:** FRONTEND_INTEGRATION

## D-906 — Web: venue onboarding doesn't wait forever on Streams
- **Date:** 2026-11-18
- **Decision:** After `POST /venues`, the app waits for `venue.registered` (user SSE, from Streams) or `GET /venues/:v` status `registered`. If the registerVenue relay is mined and Streams hasn't confirmed within 15 s, the app goes to the dashboard anyway; the numbers fill in when Streams catches up. Payments are unchanged: "settled" still comes only from Streams (D-904).
- **Reason:** The human may pause the Stream (MSG-108). A mined registerVenue already means the venue exists on chain, so onboarding shouldn't hang.
- **Who:** FRONTEND_INTEGRATION
