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
