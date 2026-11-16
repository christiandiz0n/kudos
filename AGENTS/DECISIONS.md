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
