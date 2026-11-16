# Phase 0 QE gate: S1–S3 reproduction from written instructions (Part A)

_QE_E2E, independent verifier (built none of this). Run 2026-11-16 15:10–15:17 UTC. Raw outputs: `docs/evidence/phase-0/qe/`._
_Secrets: no command read or printed the root env file or any key. Scripts loaded it themselves. Testnet spend: **0.01764372 USDC** (DEPLOYER `0x5eD3…1111` 18.981266483933771022 → 18.963622763932888836), cap $0.05._

## Verdicts

| Spike | Verdict | One-line reason |
|---|---|---|
| **S1** Arc facts | **PASS** | Every live-marked INTERFACES §1 row reproduced with independent cast/curl calls; the research scripts re-run clean. Small wording/evidence nits only. |
| **S2** Hello deploy + ping | **PASS-with-defects** | `bash scripts/spikes/s2-deploy.sh` deployed a fresh Hello and pinged on the first try, confirmed on RPC + Blockscout. The original deployment and the S5 split reproduce exactly as logged. The ARCHITECT.md direct-forge instructions don't work, and the script overwrites the broadcast file the S3 runbook cites. |
| **S3** Streams (offline) | **PASS-with-defects** | Tests 10/10 + 9/9. Dry-run OK. A real server returned 200/401/401 (+400 gzip) on real-log payloads. The filter keeps Ping/Split and nulls unrelated logs in both shapes. Doc/contract mismatches below (1 major in INTERFACES §6, 1 major runbook gap). Live part blocked on the API key (403, as expected). |

## Defects (filed, not fixed)

| ID | Sev | Where | Defect | Evidence |
|---|---|---|---|---|
| QE-01 | **major** | `AGENTS/INTERFACES.md:141` vs `infra/streams/filter-logs.js:56` | INTERFACES §6 says each envelope event carries **`eventName`**, but the filter emits **`event`** (as D-302 and the viewer expect). INTERFACES is the source of truth for Phase 2 ingestion, so a consumer coding to it would read `undefined`. | `s3-deliveries.txt` (`--body` shows `"event":"Ping"`) |
| QE-02 | **major** | `docs/streams/S3-RUNBOOK.md:19,25,115`, `scripts/streams/ping.ts:15` | Step 8 (`streams:ping`, the S3 pass criterion) sends to `HELLO_ADDRESS` from the root env file only. There's no CLI override, and no runbook step sets or checks that variable. `s2-deploy.sh` prints `HELLO_ADDRESS` but doesn't persist it, and agents can't inspect the env file. If it's unset, step 8 throws. If it's stale, e.g. after a redeploy like QE's `0xc628…1906`, the ping lands on a contract the stream doesn't watch, so no delivery arrives and S3 fails for a reason the runbook doesn't name. Suggest `streams:ping --hello <addr>` and/or a step that echoes the target address before sending. | code read; QE redeploy exists |
| QE-03 | minor | `AGENTS/ARCHITECT.md:81,118` | The documented S2 command `cd contracts && forge script script/spikes/DeployHello.s.sol --rpc-url arc_testnet --broadcast` fails with `environment variable ARC_RPC_URL not found`: forge run from `contracts/` doesn't load the root env file, which contradicts the "forge auto-loads .env" note at :118. "How to run" doesn't mention `scripts/spikes/s2-deploy.sh` (the only working path), and S2 is still listed as pending. | `qe/s2-architect-forge-path.txt` |
| QE-04 | minor | `scripts/spikes/s2-deploy.sh` ↔ `docs/streams/S3-RUNBOOK.md:15` | Re-running S2 as written overwrites `contracts/broadcast/DeployHello.s.sol/5042002/run-latest.json`, which the runbook cites as the source of deploy block 72567874. It now describes QE's deploy (`0xc628…1906`, block 72569134). The original is intact in `run-1794841028197.json` and in `qe/s2-original-run-latest.json.bak`. Cite the timestamped file or INTERFACES §2 instead. | `s2-deploy-qe.log` |
| QE-05 | minor | `scripts/streams/streams.ts:198-203` | `render-filter` writes the `contracts:` / topic preamble to **stdout** with the JS, so its output isn't runnable or pasteable (`SyntaxError: Unexpected identifier 'Ping'`). The runbook calls it "print the rendered filter JS". Send the preamble to stderr. | `s3-filter-real-logs.txt` line 1 |
| QE-06 | minor | `scripts/package.json:12` | `streams:deliveries` has no `--env-file-if-exists`, but the api does. If `STREAMS_SPIKE_LOG` is set only in the root env file, the api writes to that path and the viewer reads the default path. Works when the variable is set inline or with `--file` (verified). | `s3-deliveries.txt` |
| QE-07 | minor | `scripts/streams/show-deliveries.ts:85` | The viewer prints the sender-supplied `event` label even for REJECTED deliveries: the tampered body showed `events=Pong`. Spike-only, but Phase 2 should derive names from topic0 and only for verified bodies. | `s3-deliveries.txt` |
| QE-08 | minor | `scripts/spikes/s5-relayer.ts:79`, `docs/evidence/phase-0/s5-testnet.log` | The S5 "7 recipients" split had **one 0-value transfer**. At $1.20 the remainder recipient gets 0, so on-chain there are 7 `0x3600` Transfer logs (one = 0), but only 6 token transfers in Blockscout and 6 system logs. The 354,515 gas therefore isn't the cost of 7 funded cold recipients, and the log's "delivered across 7 recipients" overstates it. | `s2-verify.txt` §S5 |
| QE-09 | minor | `AGENTS/PHASE_LOG.md:29,32` | Stale status: S2/S5 still say "waits on funded deployer/funding", but both ran on testnet (`s2-deploy.log`, `s5-testnet.log`). The testnet S5 gas (354,515 ≈ $0.00709) isn't recorded next to the anvil figure. | — |
| QE-10 | minor | `AGENTS/INTERFACES.md:21` | The row "txs with maxFeePerGas < 20 gwei are dropped" sits under "✅ live", but its only evidence is docs (research S1.6). The 20 gwei base-fee floor itself is live-reproduced. QE didn't send an underpriced tx (would need a key). | — |
| QE-11 | minor | `AGENTS/INTERFACES.md:24` vs `:86`, `DECISIONS.md:24` | getLogs cap wording differs: "≤ 10,000 blocks per call" (§1) vs "pages ≤ 9,999 blocks" (§4/D-101). Live: 10,000 inclusive blocks OK, 10,001 → `-32012`. 9,999 is a safe page size, but say whether it means `to-from` or an inclusive count. | `s1-live.txt`, `s1-live-2.txt` |
| QE-12 | minor (cosmetic) | `docs/streams/S3-RUNBOOK.md:105` | The example batch `72567878..72567882` can't occur with `--start 72567874` and batch size 5 (aligned batches give `72567879..72567883`) unless elastic batching re-cuts it. Don't treat the example as a pass criterion. | — |
| QE-13 | info | Blockscout | The unverified original Hello's Split log is auto-decoded by Blockscout as an unrelated `Split(address indexed user, address indexed fromAccount, …collateralAmount, debtAmount)`. Verifying `0x66cb…2B32` fixes the display. QE verified its own fresh Hello with the documented flags (passed). | `s2-verify.txt`, `s1-verify-contract.txt` |
| QE-14 | info | RPC | `rpc.testnet.arc.io` returns **HTTP 403** to Python `urllib`'s default User-Agent (curl, node fetch and cast are fine). A gotcha for any Python tooling. | `s1-live-2.txt` |
| QE-15 | info | `infra/streams/filter-logs.js` / D-302 | With an unwrapped input (no `metadata`), the envelope has no `streamId/network/dataset` and `batchStart/End = null`. The batch range is then only auditable via the `batch-*` headers. D-302's "whether or not QuickNode wraps the body" holds only with the headers. | `s3-filter-real-logs.txt` |

No **blockers**. Nothing in the written steps required a secret in chat or reading the env file.

---

## S1: Arc network facts (INTERFACES §1)

Scripts: `qe/s1-live.sh` → `qe/s1-live.txt`, follow-up `qe/s1-live-2.txt`, research re-run `qe/s1-research-scripts-rerun.txt`.

| Row | Command (QE, independent) | Expected (docs) | Observed | Verdict |
|---|---|---|---|---|
| Chain ID | `cast chain-id` on canonical, legacy, QN public; raw `eth_chainId`, `net_version` | 5042002 / 0x4cef52 | 5042002 on all three; `0x4cef52`; net_version `5042002` | REPRODUCED |
| Canonical RPC + WS, open CORS | `cast chain-id --rpc-url wss://rpc.testnet.arc.io`; OPTIONS preflight | works, no key, open CORS | WS → 5042002; `access-control-allow-origin` echoes origin, methods GET/POST/OPTIONS | REPRODUCED |
| Legacy RPC alias | `cast chain-id/block-number --rpc-url https://rpc.testnet.arc.network` | still serves 5042002 | 5042002, same head as canonical (72569029) | REPRODUCED |
| QuickNode public endpoint | `cast chain-id --rpc-url https://rpc.quicknode.testnet.arc.io` | 0x4cef52, no key | 5042002 | REPRODUCED (keyed `ARC_RPC_URL` not tested) |
| Explorer + redirect | curl explorer, `testnet.arcscan.app/` and `/api?…` | Blockscout 200; arcscan 301 → arc.io | 200; both arcscan URLs `301 location: https://explorer.testnet.arc.io/…`; Etherscan-style `/api?module=block&action=eth_block_number` → `0x45350c8` | REPRODUCED |
| Explorer verify flags (docs row) | `forge verify-contract <QE Hello> src/spikes/Hello.sol:Hello --chain-id 5042002 --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ --watch` | "docs, not yet exercised" | `Pass - Verified`; Blockscout name `Hello`, solc 0.8.30, evm prague | **now exercised: PASS** |
| USDC address / proxy → impl | `cast codesize`, `cast storage` zos impl slot, `cast call implementation()`, Blockscout v2 | proxy 1,798 B → `0xc6ad…3ca6` `NativeFiatTokenV2_2` | 1798 B; slot → `0xc6ad664a…3ca6`; impl 23,659 B; Blockscout `NativeFiatTokenV2_2`, v0.6.12, verified 2026-08-18 | REPRODUCED |
| name / symbol / decimals / version | `cast call 0x3600… name()(string)` etc. | "USDC" / "USDC" / 6 / "2" | "USDC" / "USDC" / 6 / "2" | REPRODUCED |
| DOMAIN_SEPARATOR | live call + `cast keccak(abi.encode(typehash, keccak("USDC"), keccak("2"), 5042002, 0x3600…))` | `0x361191…c6b0`; no `eip712Domain()` | live = computed = `0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0`; `eip712Domain()` reverts | REPRODUCED |
| EIP-2612 permit | PUSH4 scan of impl bytecode via `cast sig` | v,r,s + bytes variants present | `0xd505accf` PRESENT, `0x9fd5a6cf` PRESENT; `PERMIT_TYPEHASH` live = computed | REPRODUCED |
| EIP-3009 | same scan + typehash calls | transfer/receive/cancel, v,r,s + bytes | `e3ee160e`, `cf092995`, `ef55bec6`, `88b7ab63`, `5a049a70`, **`b7b72899` (cancel bytes variant, not scanned by research)**, `e94a0102` all PRESENT; RECEIVE/TRANSFER typehashes MATCH | REPRODUCED |
| Native 18 ↔ ERC-20 6 (1e12) | `cast balance` vs `balanceOf` at the same block for **all 9** addresses in `wallets.public.json` | `balanceOf = floor(native/1e12)` | equal=True for all 9 (e.g. DEPLOYER native 18981266483933771022 → 18981266; dust 483933771022) | REPRODUCED |
| Block time / finality | ts(head) − ts(head−10000) | ~0.70 s | 0.6975 s (s1b.mjs also 0.6975 s). Finality: docs only, not testable | REPRODUCED |
| Base-fee floor / gas limit | `eth_getBlockByNumber`, `eth_feeHistory(20)` | 20 gwei min, 30M gas limit | baseFee 20,000,000,000; extraData `0x00000004a817c800` = 20e9; feeHistory {20.0} gwei; gasLimit 30,000,000; mixHash 0. ("<20 gwei dropped": docs-only, QE-10) | REPRODUCED |
| getLogs range cap | `eth_getLogs` span tests at head and research's `0x1..0x2712` | ≤ 10,000 blocks | 10,001 blocks → `-32012 requested range too large`; 10,000 and 9,999 OK; `0x1..0x2712` → -32012, `0x1..0x2710` OK (first attempt hit `-32005 rate limit`, retried) | REPRODUCED (wording: QE-11) |
| EntryPoint v0.7 / Multicall3 / Permit2 | `cast codesize` | code present | 16,035 / 3,808 / 9,152 bytes | REPRODUCED |
| Research scripts | `node docs/evidence/phase-0/research-s1/{s1,s1b,s1c}.mjs`, `keccak.mjs` | run with Node 24, no install | all exit 0; DOMAIN_SEPARATOR MATCH; all selectors as documented; typehashes MATCH; 1e12 check true on a fresh live sender | REPRODUCED |

Not live-claimed, so not re-derived: faucet, EVM baseline, Streams network id (docs rows). Drift since research: `eth_gasPrice` is now 20 gwei (research saw 25). Not an INTERFACES claim.

## S2: Hello deploy + ping (and original + S5 confirmation)

Evidence: `qe/s2-deploy-qe.log`, `qe/s2-verify.sh/.txt`, `qe/s2-cast-logs.sh/.txt`, `qe/s2-forge-test-typecheck.txt`, `qe/s2-original-run-latest.json.bak`.

| Step | Command | Expected (docs) | Observed | Verdict |
|---|---|---|---|---|
| Documented forge path (ARCHITECT.md:81) | `cd contracts && forge script script/spikes/DeployHello.s.sol --rpc-url arc_testnet` (simulation, no broadcast) | deploys | `Error: environment variable ARC_RPC_URL not found` | **DIFFERS** (QE-03) |
| Fresh deploy + ping | `bash scripts/spikes/s2-deploy.sh` (repo root) | prints HELLO_ADDRESS / DEPLOY_TX / DEPLOY_BLOCK / PING_TX, < $0.02 | `HELLO_ADDRESS=0xc6282732b1852726F73D7Cea98cE6D03f9021906`, `DEPLOY_TX=0xe96198ef…a4d2`, `DEPLOY_BLOCK=72569134`, `PING_TX=0xe68b5e3f…1ff1` block 72569138 gasUsed 23,208 status 0x1. Deploy 858,978 gas = 0.01717956 USDC + ping 0.00046416 = **0.01764372 USDC** | REPRODUCED |
| Fresh deploy on explorer | Blockscout `/api/v2/addresses/<addr>`, `/transactions/<tx>`, `/logs` | contract + Ping visible | is_contract, creator DEPLOYER, creation tx matches; deploy tx `ok/success` block 72569134; ping tx method `ping`, 1 log topic0 `0x20aede85…` | REPRODUCED |
| Fresh Ping via `cast logs` | `cast logs --address 0xc628…1906 --from-block 72569134` | one Ping | Ping block 72569138, logIndex 5, from DEPLOYER, tag `'s2-ping'`, has `blockTimestamp` | REPRODUCED |
| Original deploy (INTERFACES §2) | `cast receipt 0x382fa022…0f93`, Blockscout | `0x66cb…2B32`, block 72567874 | status 0x1, block **72567874**, contractAddress `0x66cb4392…2b32`, code 3,670 B (identical to fresh), Blockscout creation tx matches | REPRODUCED |
| Original Ping (s2-deploy.log) | `cast receipt 0x6a6ad1c2…a3d0`, `cast logs` | block 72567880, gas 23,208, fee 0.00057496 | block 72567880, gasUsed 23,208, effGasPrice 24,774,046,250, fee 0.000574956 USDC; Ping logIndex 4 | REPRODUCED |
| S5 split tx status / Split event | `cast receipt 0x2de25bf8…8214` (decoded) | success; Split recipients=7 total $1.20, relayer `0x3eAF…8daD` | status 0x1, block 72567926, from relayer; Split(token 0x3600, from SPIKE_USER `0xaaf8…4ec9`, relayer `0x3eaf…8dad`, recipientCount 7, total 1,200,000) | REPRODUCED |
| S5: 7 transfers summing to total | USDC `0x3600` Transfer logs in the receipt | 7 transfers, sum $1.20 | 7 logs: 1,020,000 + 45,000 + 69,300 + 29,700 + 25,200 + 10,800 + **0** = 1,200,000. Blockscout lists 6 token transfers, and there are 6 system `0xffff…fffe` logs (sum 1.2e18) | REPRODUCED (with QE-08) |
| S5 gas / fee | receipt + Blockscout | gasUsed 354,515, 20 gwei, fee 7,090,300,000,000,000 wei = 0.0070903 USDC | identical on RPC and Blockscout; tx type 2, maxFee 24 gwei, priority 0 | REPRODUCED |
| S5 approve tx | `cast receipt 0x28c1a98a…b24e` | gasUsed 55,786, fee 0.00111572 | identical | REPRODUCED |
| Hello unit tests | `pnpm test:contracts` | 11 green | 11 passed, 0 failed | REPRODUCED |
| Typecheck | `pnpm -r typecheck` | clean | shared, scripts, web, api: Done | REPRODUCED |

## S3: Streams, offline part

Evidence: `qe/s3-tests.txt`, `qe/s3-cli-dryrun.txt`, `qe/rendered-filter-hello.js`, `qe/arc-logs-block-{72567880,72567881,72567926}.json` (real `eth_getLogs`), `qe/filter-harness.mjs` → `qe/s3-filter-real-logs.txt`, `qe/hmac-e2e.mjs` → `qe/s3-hmac-e2e.txt` + `qe/s3-hmac-e2e.ndjson`, `qe/s3-deliveries.txt`, `qe/s3-streams-list.txt`.

| Step | Command | Expected (docs) | Observed | Verdict |
|---|---|---|---|---|
| API webhook tests | `pnpm --filter @vouch/api test` | 10/10 | 10 pass, 0 fail | REPRODUCED |
| Filter/env/redaction tests | `pnpm --filter @vouch/scripts test` | 9/9 | 9 pass, 0 fail | REPRODUCED |
| Create dry-run | `streams create --name s3-hello-spike --contract 0x66cb…2b32 --events hello --start 72567874 --webhook https://qe-placeholder.trycloudflare.com --status paused --dry-run` | request body + decoded filter, no key used | exit 0, no API call; body matches D-303 (arc-testnet, logs, start 72567874, batch 5, elastic, reorgs 0, webhook `…/webhooks/streams`, max_retry 20, paused, external_id `vouch-s3-hello-spike`); topic0s match INTERFACES §4; backlog 1,437 blocks | REPRODUCED |
| `render-filter` | `streams render-filter --contract … --events hello` | "print the rendered filter JS" | JS printed with a non-JS preamble on stdout (SyntaxError as-is) | DIFFERS (QE-05) |
| Filter on REAL logs: 3-deep nested `{data:[block][receipt][log], metadata}` | `node qe/filter-harness.mjs` (vm context, no require) | keeps Ping/Split | Ping block (6 real logs) → `[Ping]` tx `0x6a6ad1c2…`, logIndex 4, blockTimestamp 1794841034; Split block (20 real logs) → `[Split]` tx `0x2de25bf8…` logIndex 19; both → `[Ping, Split]` | REPRODUCED |
| Filter on REAL logs: unwrapped (`[block][log]`, `[block][receipt][log]`) | same | keeps Ping/Split | `[Ping]`, `[Split]`; envelope metadata absent (QE-15) | REPRODUCED |
| Filter: unrelated logs → null | same | `null` | USDC `0x3600` Transfers only → null; `0xffff…fffe` system logs only (wrapped and unwrapped) → null; block 72567881 (12 foreign logs) → null; Hello address with a non-Hello topic0 → null | REPRODUCED (10/10 cases) |
| Real server start | `STREAMS_WEBHOOK_SECRET=qe-test-secret API_PORT=4020 API_HOST=127.0.0.1 DATABASE_URL=pglite://memory STREAMS_SPIKE_LOG=<scratch> pnpm --filter @vouch/api start` | listens; inline env overrides the file | listening on 127.0.0.1:4020; `/health` → `{"ok":true,"app":"Vouch","chainId":5042002,…}`. The inline secret took effect (signed request verified) | REPRODUCED. QE added `DATABASE_URL=pglite://memory` + loopback host to avoid touching the shared on-disk DB |
| Runbook step-3 unsigned POST | `curl -X POST …/webhooks/streams -d '{}'` | 401 once the secret is set | 401 | REPRODUCED |
| (a) correctly signed | HMAC per INTERFACES §6 over the filter envelope of the real Ping log | 200 | 200 `{"ok":true,"bytes":758,"logs":1}` | REPRODUCED |
| (b) tampered body | `"Ping"`→`"Pong"`, original signature | 401 | 401 `bad-signature` | REPRODUCED |
| (c) missing headers | no X-QN-*, and signature-only missing | 401 | 401 `missing-signature-headers` (both) | REPRODUCED |
| extra | wrong secret / uppercase hex / gzip / 13-digit ms ts / bad gzip | 401 / 200 / 200 / 200 / 400 | 401 / 200 / 200 / 200 (unit ms) / 400 `body-decode-failed` | REPRODUCED |
| NDJSON + viewer | `STREAMS_SPIKE_LOG=<scratch> pnpm --silent --filter @vouch/scripts streams:deliveries --last 20`; also `--file <scratch> --verified-only --body` | VERIFIED line with event name and tx | `VERIFIED … shape=envelope:v1 logs=1 blocks=72567880..72567880 events=Ping` + `tx 0x6a6ad1c21d288b0eec21559da434b3a6a991406bc45ac69c024c4a2aa344a3d0`; batch 72567878..72567882 from headers; rejects labelled with reason. Both the env var and `--file` work. The secret string does not appear in the NDJSON (grep count 0) | REPRODUCED (QE-06, QE-07) |
| Server stopped | TaskStop + `lsof :4020` | none left running | port free, PID gone | done |
| `streams list` (one allowed call) | `pnpm --silent --filter @vouch/scripts streams list` | key being replaced | `HTTP 403 … AuthenticationError; Provided key is incorrect or malformed` | as expected (BLOCKED for Part B) |

### Runbook review (`docs/streams/S3-RUNBOOK.md`)
- Prerequisites are mostly complete (pnpm install, cloudflared, Node ≥ 22, repo root). Missing: a step that **confirms or sets `HELLO_ADDRESS`** before step 8 (QE-02), and a note that port 4000 must be free (`API_PORT` overrides it).
- Ordering is sound: create **paused** → restart api → activate. Step 6's "503 → 401" check is a good gate (QE confirmed 401 with the secret set).
- No step asks for a secret in chat. Step 1 correctly routes a bad key to the human.
- §0 cites `run-latest.json` for the deploy block. That file now reflects QE's redeploy (QE-04). The hard-coded values in the runbook are still correct for `0x66cb…2b32`.
- The §7 example batch range is illustrative only (QE-12).
- Step 8's pass criterion depends on QE-02.

## Part B (pending a valid QuickNode key + live stream)
Steps 1–2 (`streams list`, `test-filter` on blocks 72567880/72567881), 4 (tunnel), 5–7 (create paused → restart → activate → backfill deliveries for Ping @72567880 and Split @72567926), 8 (fresh `streams:ping`, VERIFIED delivery, latency), 9 (pause). Then record the 5 UNVERIFIED items (timestamp unit, body shape, `blockTimestamp`, content-encoding, header names). Before step 8 the Orchestrator/human must confirm `HELLO_ADDRESS` in the root env file is `0x66cb4392322b2aede460a4314ce092e0cc1c2b32` (or the stream contract), per QE-02.
