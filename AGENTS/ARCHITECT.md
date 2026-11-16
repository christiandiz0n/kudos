# ARCHITECT
_Last updated: 2026-11-16 by ARCHITECT (topup tooling) — Phase 0_

## Mission
Owns the repo layout, toolchain, pnpm workspace, the `packages/shared` package (single source of truth for ABIs, EIP-712 types, constants), draft versions of INTERFACES.md, and all Phase 0 technical spikes (S1–S6). Does NOT write feature code beyond scaffolding, contract business logic, API endpoints, or UI.

## Owned paths
- Root config: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example` files
- `packages/shared/` (structure + constants; ABIs are exported into it by CONTRACTS)
- `contracts/src/spikes/`, `contracts/script/spikes/`, `scripts/spikes/`
- Drafts of `AGENTS/INTERFACES.md` (Orchestrator applies)

## Current status
🟢 on track. S1, S2, S4 and S5 are done on Arc testnet. S3 live is blocked on a valid QuickNode key (HUMAN #3). S6 is waiting on the phone run.

## Mental model (read this first)
- **pnpm monorepo** (root `wom`). Workspaces: `apps/web`, `apps/api`, `packages/shared`, `scripts`. `contracts/` is Foundry and *not* a JS workspace, but its Solidity deps (OZ 5.6.1, forge-std v1.17.0) come from the **root `node_modules`** via remappings (D-201). One `pnpm install` sets up everything.
- **`@vouch/shared` is consumed as TS source, with no build step (D-204).**
  - Next.js compiles it via `transpilePackages`. api and scripts run through `tsx`.
  - It holds every cross-cutting fact: `constants.ts` (APP_NAME, split bps, caps), `chains.ts` (verified Arc facts, D-101), `eip712.ts` (typed-data defs + helpers), `money.ts` (bigint USDC helpers), `abi.ts` (spike ABI; CONTRACTS adds production ABIs).
  - If a value appears in two places, it belongs here.
- **Money is always bigint base units.**
  - USDC ERC-20 has 6 decimals. Arc native gas has 18 decimals but is the same balance. Only relayer gas accounting ever sees 18-dec values (D-102).
  - The relayer must send `maxFeePerGas >= 20 gwei` on Arc (`ARC_MIN_MAX_FEE_PER_GAS`).
- **Payments (D-103).**
  - The customer signs one USDC EIP-3009 `ReceiveWithAuthorization` whose `nonce = hashStruct(PaymentAuth)`.
  - The main contract recomputes the nonce, pulls the funds, then splits atomically. No approve is involved.
  - The Hello spike still uses approve + transferFrom with its own `SplitAuth`; that was enough to prove the relayer pattern and gas.
- **api** is a long-lived Fastify 5 service (D-202).
  - DB is Drizzle with `DATABASE_URL`-switched drivers (D-203): `postgres://` in deploy, `pglite://./data/local/pglite` locally, `pglite://memory` in tests.
  - Migrations live in `apps/api/drizzle/` and run at boot.
  - The `/webhooks/streams` stub logs raw bodies to `data/local/streams-spike.ndjson` for S3.
- **web** is Next 16.4 (App Router, Turbopack, `cacheComponents`, Tailwind 4).
  - The bundled docs at `apps/web/node_modules/next/dist/docs/` are authoritative; APIs differ from older Next.
  - Client hooks like `useSearchParams` need a `<Suspense>` boundary.
  - S6 pages are `/spike/scan` (jsqr + getUserMedia) and `/spike/qr`.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `package.json` / `pnpm-workspace.yaml` | Root scripts (`build`, `test`, `test:contracts`, `dev:web`, `dev:api`, `lint`, `typecheck`, `spike:s5:local`) and the workspace list | `allowBuilds`: only esbuild runs install scripts |
| `tsconfig.base.json` | Strict TS base (ES2022, Bundler resolution, `noUncheckedIndexedAccess`) | web keeps its own Next tsconfig (target ES2022 for bigint) |
| `.env.example` | All env var NAMES with placeholders | Mirrors INTERFACES §7. Never create `.env` here |
| `packages/shared/src/chains.ts` | Arc chain (viem `defineChain`), USDC address/decimals/EIP-712 domain, fee floor, system emitter | Verified S1 (D-101). Edit facts only here |
| `packages/shared/src/eip712.ts` | Domain + Intro/IntroAcceptance/Order/Weights/PaymentAuth/ReceiveWithAuthorization types; `paymentAuthNonce`, `receiveAuthForPayment`, `introDigest`; Hello `SplitAuth` | v0 DRAFT; CONTRACTS must match the typehash strings |
| `packages/shared/src/money.ts` | `parseUsdc`/`formatUsdc`/`formatUsd`/`mulBps`/native→USDC | Rejects floats and excess precision |
| `packages/shared/src/*.test.ts` | node:test via tsx. Includes a check that the USDC domain reproduces the live DOMAIN_SEPARATOR | `pnpm --filter @vouch/shared test` |
| `contracts/foundry.toml` | solc 0.8.30, prague, optimizer 200, fuzz 1000, invariant 256×64, `arc_testnet` rpc + Blockscout verifier entry | Remaps to `../node_modules` |
| `contracts/src/spikes/Hello.sol` | S2/S5 spike: `ping`, `pullAndSplit` (caller must be `from`), `relayedSplit` (EIP-712 SplitAuth with token bound, OZ Nonces) | NOT production |
| `contracts/src/spikes/MockUSDC.sol` | 6-dec open-mint ERC20 for local tests and anvil | Test only |
| `contracts/test/spikes/Hello.t.sol` | 11 tests incl. 7-way exact sum, replay, wrong signer, tamper, expiry, fuzz | |
| `contracts/script/spikes/DeployHello.s.sol` | Deploys Hello (and optionally MockUSDC); reads `DEPLOYER_PRIVATE_KEY` | Run it via `scripts/spikes/s2-deploy.sh` (that wrapper loads the root env; bare forge from `contracts/` does not, QE-03) |
| `scripts/spikes/s5-relayer.ts` | viem: user signs SplitAuth, relayer submits 7-way split, prints gas and fee in USDC; clamps the Arc fee floor | Env-driven; works for anvil and Arc |
| `scripts/spikes/s5-local.sh` | anvil → deploy → fund → run s5-relayer → kill anvil | Uses anvil's public dev mnemonic, port 8546 |
| `scripts/setup/topup-demo.ts` | Deployer → demo wallets USDC top-up to `--target` (skips funded wallets); `--reserve`/`--max-total` abort before any send; `--dry-run`, `--only`, `--to`, `--include-relayer` | D-401. `pnpm --filter @vouch/scripts topup`. Exit 0 ok / 1 config / 2 safety abort / 3 send failure |
| `scripts/setup/topup-local.sh` | anvil + MockUSDC proof of topup: dry-run, partial top-up, skip, re-run, reserve abort, max-total abort, ad-hoc, bad input (24 asserts) | Port 8547, anvil public mnemonic |
| `apps/api/src/app.ts` | Fastify `buildApp()`: CORS, `/health`, webhook plugin, DB migrate on boot | `server.ts` listens; `app.test.ts` uses inject |
| `apps/api/src/db/index.ts` | `createDb(DATABASE_URL)` → postgres-js or PGlite + Drizzle migrator | `schema.ts` holds only `app_meta` for now |
| `apps/api/src/routes/webhooks.ts` | `POST /webhooks/streams` raw-body NDJSON logger (S3) | HMAC verification is added by STREAMS_INFRA (D-105) |
| `apps/web/src/app/spike/scan/Scanner.tsx` | Rear camera + jsqr live decode, permission/insecure/no-camera states | |
| `apps/web/src/app/spike/qr/QrRender.tsx` | `?text=` → QR via `qrcode` | Default text is about the size of a signed order |
| `docs/evidence/phase-0/scaffold.md` | Command outputs for this phase | |

## Interfaces consumed / provided
- Provided: INTERFACES §3 EIP-712, §4 events (+ topic0), §5 API list, §6 webhook stub, §7 env vars (v0 DRAFT, CONTRACTS/BACKEND finalize). Code mirror: `packages/shared/src/eip712.ts`.
- Consumed: §1 Network (verified by ARCHITECT-research and merged by the Orchestrator).

## Done (rolling, newest first)
- 2026-11-16: Built the `topup` tool (D-401). Local proof: 24/24 asserts. Testnet: dry run OK. A real $1.00 deployer → DEMO_LENA transfer, tx `0xa3ba5c891eec4eea9a85b444dc3d655e60ff3f8ac132cabc07fe6d8d6a188ecd`, paid 0.000979 USDC gas at 24 gwei. Deployer went $19.982245 → $18.981266. All 4 personas plus SPIKE_USER already held ≥ $18.
- 2026-11-15: Aligned the scaffold to verified S1 (D-209): canonical arc.io URLs, USDC domain, 20 gwei fee clamp, `prague`, Blockscout verifier, EIP-3009 PaymentAuth design in shared + INTERFACES §3.
- 2026-11-15: Drafted INTERFACES §3–§7 v0 (Intro + IntroAcceptance two-step, Order, Weights, PaymentAuth; 7 events with topic0; ~25 endpoints; env table).
- 2026-11-15: S6 pages `/spike/scan` + `/spike/qr` built (`next build` green). The phone test is pending the human.
- 2026-11-15: S5 proven locally on anvil. A 7-recipient relayed split costs 234,686 gasUsed (≈ 0.0047 USDC at Arc's 20 gwei floor) and sums exactly.
- 2026-11-15: S2 Hello spike plus 11 Foundry tests green. Gas-report max for 7-way `relayedSplit` is 254,586.
- 2026-11-15: Monorepo scaffold done: pnpm workspace, `@vouch/shared`, Foundry (1.9.0) + OZ via npm, Fastify api + Drizzle/PGlite, Next 16 web (D-201..D-208).
- 2026-11-15: File initialized by ORCHESTRATOR.

## Next up
- [x] S1 Arc network facts: VERIFIED (D-101..D-103, INTERFACES §1, evidence `docs/evidence/phase-0/research-s1-s3-s4.md`). Orchestrator independently re-checked chainId/decimals/DOMAIN_SEPARATOR with `cast`.
- [x] S4 Wallet approach: decided option B, a passkey-gated local EOA plus our relayer (D-104). PRF support on the demo phone is still to be confirmed in S6.
- [x] S2: `bash scripts/spikes/s2-deploy.sh` (loads the root env itself, deploys, pings, prints the deploy block). Canonical Hello `0x66cb…2B32` @ 72567874 (INTERFACES §2). The QE gate reproduced it with a fresh deploy and Blockscout-verified it. Note: re-running overwrites `contracts/broadcast/.../run-latest.json` (QE-04), so INTERFACES §2 is the record of truth.
- [ ] S3 QuickNode Stream → webhook → event received; backfill from past block works. Desk research done, feasible (D-105). Recipe in the research evidence §S3.3. Needs the human's QuickNode API key. Public URL: `cloudflared tunnel --url http://localhost:4000` (quick tunnel, no account).
- [x] S5 testnet: `HELLO_ADDRESS=0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32 SPLIT_TOTAL_USD=1.20 pnpm --filter @vouch/scripts s5:relayer`. Tx `0x2de25bf8…8214`: 354,515 gas, $0.0070903 paid by the relayer, exact sum. Caveat QE-08: one of the 7 recipient amounts was 0 (rounding remainder in `s5-relayer.ts:79`), so this is effectively a 6-funded-recipient figure. Phase 1 measures the real contract.
- [ ] S6 human runs `/spike/scan` on a phone (see "How to run")
- [ ] Optional: an S5b spike exercising EIP-3009 `receiveWithAuthorization` on Arc USDC (D-103), since only the approve path is proven

## Struggles, open questions, known issues
- `~/.foundry/bin` is not on PATH by default. Scripts add it; interactive shells need `export PATH="$PATH:$HOME/.foundry/bin"`.
- pnpm 11's `minimumReleaseAge` rejects packages published within the last day (viem 2.57.20 was released today), so we pinned 2.57.18. Do not add `minimumReleaseAgeExclude` casually.
- A stale `apps/web/tsconfig.tsbuildinfo` once produced phantom "BigInt target < ES2020" errors. Fix with `rm apps/web/tsconfig.tsbuildinfo`.
- A heredoc containing regex/`rm`-like text tripped the Bash safety check; use the Write tool for source files.
- Remaining forge lint notes on Hello (`block-timestamp`, `reentrancy-events`) are acceptable for the spike. The main contract should emit before external calls, or document why not.
- Proposed rule for CONTRACTS to confirm: the L2 parent is the top-weight L1 referrer at first purchase (`CustomerVerified.introducer`).
- The api runs TS via `tsx` in prod too. If the host requires plain `node`, add a tsup/esbuild bundle step.

## How to run / test this area
```bash
export PATH="$PATH:$HOME/.foundry/bin"
pnpm install                         # all JS deps + OZ/forge-std for Foundry
pnpm typecheck                       # tsc in shared, scripts, api, web (next typegen first)
pnpm lint                            # eslint (web)
pnpm -r --if-present run test        # shared (node:test) + api (fastify inject, in-memory PGlite)
pnpm test:contracts                  # cd contracts && forge test
(cd contracts && forge test --gas-report)
pnpm spike:s5:local                  # anvil e2e relayer spike (prints fee in USDC)
bash scripts/spikes/s2-deploy.sh     # S2 on Arc testnet (DEPLOYER; spends ~$0.01)
pnpm --filter web build
pnpm dev:api                         # Fastify on :4000 (PGlite at data/local/pglite); curl localhost:4000/health
pnpm dev:web                         # Next on :3000
pnpm --filter web dev:https          # LAN alternative (self-signed cert; iOS often refuses camera)
# Preferred S6 / public HTTPS: build, then `cd apps/web && node node_modules/next/dist/bin/next start -p 3100`
#   + `cloudflared tunnel --no-autoupdate --url http://localhost:3100` → https://<random>.trycloudflare.com
# NOTE: port 3000 on this machine is used by an unrelated long-running next-server; don't kill it.
python3 scripts/setup/gen-env.py     # HUMAN runs once: creates .env with fresh keys, prints addresses only
pnpm --filter @vouch/scripts topup --dry-run            # plan: top demo wallets up to $5 from DEPLOYER
pnpm --filter @vouch/scripts topup [--only DEMO_LENA --target 1.00] [--include-relayer] [--to 0x..] [--reserve 5] [--max-total 25]
bash scripts/setup/topup-local.sh    # anvil + MockUSDC proof of all topup cases
# NOTE: a PreToolUse hook blocks agents from any Bash that references .env. Agents never read .env;
#   tools load it themselves (forge auto-loads .env; node scripts use dotenv). Public addresses: packages/shared/src/wallets.public.json
pnpm --filter @vouch/api db:generate   # after editing apps/api/src/db/schema.ts
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/ARCHITECT.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
