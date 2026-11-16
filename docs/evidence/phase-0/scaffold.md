# Phase 0 — scaffold evidence (ARCHITECT-scaffold)
_2026-11-15. Machine: macOS arm64, node v24.13.0, pnpm 11.28.6. Hostnames/LAN IPs redacted._

## Toolchain
```
$ ~/.foundry/bin/forge --version
forge Version: 1.9.0
Commit SHA: 6056c5845d34205a83cf7108042adb137325c9df
Build Timestamp: 2026-11-02T20:16:54.701302000Z (1793650614)
Build Profile: dist
```
Installed with `curl -L https://foundry.paradigm.xyz | bash && ~/.foundry/bin/foundryup` (binaries attestation-verified). Note: `~/.foundry/bin` is not on the default PATH, so add `export PATH="$PATH:$HOME/.foundry/bin"`.

## forge test (evm_version = prague, solc 0.8.30)
```
$ cd contracts && forge test -vv
Ran 11 tests for test/spikes/Hello.t.sol:HelloTest
[PASS] testFuzz_pullAndSplit_conservesValue(uint64[7]) (runs: 1000, μ: 255628, ~: 259739)
[PASS] test_ecdsa_recoverMatchesVmAddr() (gas: 11257)
[PASS] test_ping_emitsEvent() (gas: 36311)
[PASS] test_pullAndSplit_revertsIfCallerNotFrom() (gas: 62690)
[PASS] test_pullAndSplit_sevenRecipients_sumsExactly() (gas: 382721)
[PASS] test_relayedSplit_expired_reverts() (gas: 90022)
[PASS] test_relayedSplit_lengthMismatch_reverts() (gas: 108950)
[PASS] test_relayedSplit_replay_reverts() (gas: 349942)
[PASS] test_relayedSplit_tamperedAmounts_reverts() (gas: 109527)
[PASS] test_relayedSplit_validSig_succeeds() (gas: 339629)
[PASS] test_relayedSplit_wrongSigner_reverts() (gas: 108219)
Suite result: ok. 11 passed; 0 failed; 0 skipped
```

## Gas report (Hello)
```
$ forge test --gas-report
| src/spikes/Hello.sol:Hello Contract |                 |        |        |        |         |
| Deployment Cost                     | Deployment Size |        |        |        |         |
|                              858978 |            4549 |        |        |        |         |
| Function Name                       | Min             | Avg    | Median | Max    | # Calls |
| ping                                |           23232 |  23232 |  23232 |  23232 |       1 |
| pullAndSplit                        |           33650 | 218018 | 222650 | 224174 |     259 |
| relayedSplit                        |           37670 | 108475 |  57489 | 254586 |       7 |
```
- **7-recipient relayed split (fresh recipients): 254,586 gas** (gas-report max, execution gas in the test harness).
- **The same as a real tx on anvil: `gasUsed = 234,686`** (receipt, includes intrinsic and calldata gas; see S5 below).
- Projection at Arc's 20 gwei minimum base fee: 234,686 × 20 gwei = **≈ 0.0047 USDC** per 7-way split (the floor; real cost depends on live base fee and is still to be measured on testnet).

## S5 — relayer submits a user-signed EIP-712 split (local anvil)
```
$ bash scripts/spikes/s5-local.sh
== starting anvil on :8546
chainId: 31337
== deploying MockUSDC + Hello (forge script)
HELLO_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
USDC_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
user USDC balance (6-dec base units): 1000000000 [1e9]
== running relayer spike (tsx)
chainId            31337 (local)
hello              0x5FbDB2315678afecb367f032d93F642f64180aa3
token              0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512  decimals=6
user (signer)      0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
relayer (gas)      0x70997970C51812dc3A010C7d01b50e0d17dc79C8
split total        $12.00 -> 7 recipients, sum=$12.00
approve            tx=0xb108…0594 status=success gasUsed=46678 fee=0.000082902913462972 USDC (paid by user, one-time)
signed SplitAuth   nonce=0 deadline=1794800363
--- relayedSplit result ---
tx                 0x95f1…b991
status             success  block=4
Split event        recipients=7 total=$12.00 relayer=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
user debited       $12.00 (ERC-20, 6-dec)
delivered          $12.00 across 7 recipients (exact=true)
gasUsed            234686
effectiveGasPrice  1679354090 native-wei (18-dec) = 0.00000000167935409 USDC/gas
fee (native)       394120893965740 native-wei (18-dec)
fee in USDC        0.00039412089396574 USDC  (~0.000395 USDC rounded up to 6-dec base units) — paid by relayer
relayer balance Δ  0.00039412089396574 (native, cross-check)
== anvil stopped
```
(Anvil keys come from anvil's public default mnemonic and are local only. On anvil the native token is ETH; the "USDC" label assumes Arc semantics, D-102.)

## JS workspace
```
$ pnpm install            -> Done (lockfile committed)
$ pnpm -r typecheck
packages/shared typecheck: Done
scripts typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
$ pnpm lint               -> eslint clean (web)
$ pnpm --filter web build
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /spike/qr
└ ○ /spike/scan
$ pnpm -r test
✔ USDC EIP-712 domain constants reproduce the live Arc DOMAIN_SEPARATOR (S1)
✔ PaymentAuth typehash + struct hash match Solidity keccak256(abi.encode(TYPEHASH, ...))
✔ array hashes equal keccak256(abi.encodePacked(T[]))
✔ parseUsdc / formatUsdc / formatUsd / native gas -> USDC / product-story split   (shared: 7 pass)
✔ GET /health and POST /webhooks/streams (in-memory PGlite)                       (api: 1 pass)
$ next start + curl:  /  -> 200 <h1>wom</h1> (APP_NAME from @wom/shared) · /spike/scan -> 200 · /spike/qr?text=hi -> 200
```

## API (Fastify + PGlite)
```
$ pnpm --filter @wom/api db:migrate
[db] migrations applied (pglite)

$ API_PORT=4010 pnpm --filter @wom/api start
{"level":30,"msg":"Server listening at http://127.0.0.1:4010"}

$ curl -s localhost:4010/health
{"ok":true,"app":"wom","chainId":5042002,"db":{"kind":"pglite","ok":true},"time":"2026-11-16T03:24:48.518Z"}

$ curl -s -i -X POST localhost:4010/webhooks/streams -H 'content-type: application/json' -H 'x-qn-test: spike' \
    -d '{"data":[{"block":"0x1","logs":[]}]}'
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
{"ok":true,"bytes":36}

$ tail -1 data/local/streams-spike.ndjson
{"receivedAt":"2026-11-16T03:24:48.526Z","method":"POST","url":"/webhooks/streams","headers":{"host":"localhost:4010","user-agent":"curl/8.7.1","accept":"*/*","content-type":"application/json","x-qn-test":"spike","content-length":"36"},"bytes":36,"body":"{\"data\":[{\"block\":\"0x1\",\"logs\":[]}]}"}
```

## S6 (camera) — needs the human on a phone
- `pnpm --filter web dev:https` (self-signed HTTPS on 0.0.0.0:3000). Open `https://<laptop-LAN-IP>:3000/spike/scan` on the phone and accept the cert warning.
- An HTTPS tunnel also works (`*.trycloudflare.com` / `*.ngrok-free.app` are in `allowedDevOrigins`).
- On the laptop open `/spike/qr?text=hello` (or the default ~200-char sample order payload) and scan it with the phone.
- Record: device/browser, permission prompt behaviour, time-to-decode, and whether the rear camera was picked.
