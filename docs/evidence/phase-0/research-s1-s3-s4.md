# Phase 0 research: S1 (Arc facts), S3 (QuickNode Streams desk research), S4 (wallet approach)

_Author: ARCHITECT (research instance). Run 2026-11-15 ~22:10–23:30 ET (2026-11-16 03:13–04:30 UTC). Read-only RPC calls only: no accounts, keys, or transactions._

Status legend:
- **VERIFIED-LIVE**: confirmed by an RPC/HTTP call I ran (raw output below)
- **VERIFIED-DOCS**: stated in official docs (URL given) but not exercised live
- **UNVERIFIED**: could not confirm. Needs a human account or a later spike
- **CONTRADICTED**: differs from what the brief expected

Re-run kit: the scripts and raw outputs are in `docs/evidence/phase-0/research-s1/` (`keccak.mjs` is a dependency-free keccak-256 used offline; self-test included). Run with `node docs/evidence/phase-0/research-s1/s1.mjs` (Node 24, no npm install).

---

## 0. Sources and domain notes (anti-phishing)

| Source | Notes |
|---|---|
| `https://docs.arc.network/...` | **Returns 301 to `https://docs.arc.io/...`** (verified: `curl -sI https://docs.arc.network/arc/references/connect-to-arc` gives `location: https://docs.arc.io/arc/references/connect-to-arc`). `https://arc.network` also returns 301 to `https://www.arc.io/`. So **arc.io is the current official Arc domain** (redirected from the official arc.network). All Arc doc citations below use docs.arc.io. |
| `https://docs.arc.io/llms.txt` | Official doc index (Mintlify). The pages were fetched as `.md` (e.g. `https://docs.arc.io/arc/references/evm-differences.md`). |
| `https://developers.circle.com/llms.txt` + `.md` pages | Circle developer docs (wallets, paymaster, gas station). |
| `https://faucet.circle.com` | Circle faucet. |
| `https://www.quicknode.com/docs/streams/llms.txt` + `.md` pages, `https://www.quicknode.com/pricing.md`, `https://api.quicknode.com/streams/rest/openapi.json` | QuickNode official docs. |
| `https://explorer.testnet.arc.io` | Blockscout explorer linked from the Arc docs. |
| `https://registry.npmjs.org`, `https://unpkg.com` | Used only to read package versions and viem's `arcTestnet` chain definition. |

Arc pages used: `arc/references/connect-to-arc`, `arc/references/rpc-endpoints`, `arc/references/evm-differences`, `arc/references/gas-and-fees`, `arc/references/contract-addresses`, `arc/references/usdc-system-events`, `arc/tutorials/deploy-on-arc`, `arc/tutorials/install-arc-foundry`, `arc/tutorials/porting-contracts-to-arc`, `arc/concepts/deterministic-finality`, `integrate/wallets/transaction-lifecycle`, `arc/tools/node-providers`, `arc/tools/account-abstraction`, `arc/tools/data-indexers`, `integrate/relayers-and-paymasters`, `integrate/relayers-and-paymasters/eip-3009-relayer`, `integrate/relayers-and-paymasters/deploy-a-paymaster` (all under `https://docs.arc.io/`, with `.md` appended).

---

## S1 — Arc network facts

### S1.1 Chain ID, RPC, block number, gas price, block time

**Chain ID = 5042002 (0x4cef52): VERIFIED-LIVE.** It matches the brief.

**Official testnet RPC is `https://rpc.testnet.arc.io` (WS `wss://rpc.testnet.arc.io`): VERIFIED-DOCS + LIVE.** The brief expected `https://rpc.testnet.arc.network`, so the canonical name is **CONTRADICTED**. The old hostname still works and returns the same chain (live). viem's built-in `arcTestnet` (viem 2.55.11) still lists `rpc.testnet.arc.network` and `testnet.arcscan.app`. Both still resolve, but new config should use the arc.io names.

Source: https://docs.arc.io/arc/references/connect-to-arc.md (Testnet tab: Chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, WS `wss://rpc.testnet.arc.io`, Explorer `explorer.testnet.arc.io`), https://docs.arc.io/arc/references/rpc-endpoints.md.

Command (run first against the legacy hostname):
```bash
for m in eth_chainId eth_blockNumber eth_gasPrice net_version web3_clientVersion; do
  curl -s -X POST https://rpc.testnet.arc.network -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$m\",\"params\":[]}"; echo; done
```
Raw output (2026-11-16T03:13:02Z):
```
== eth_chainId        {"jsonrpc":"2.0","id":1,"result":"0x4cef52"}          -> 5042002
== eth_blockNumber    {"jsonrpc":"2.0","id":1,"result":"0x4526141"}         -> 72,507,713
== eth_gasPrice       {"jsonrpc":"2.0","id":1,"result":"0x5d21dba00"}       -> 25,000,000,000 wei = 25 gwei
== net_version        {"jsonrpc":"2.0","id":1,"result":"5042002"}
== web3_clientVersion {"jsonrpc":"2.0","id":1,"result":"arc/v1"}
```
Same `eth_chainId` against the doc-canonical hosts:
```bash
curl -s -X POST https://rpc.testnet.arc.io           -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl -s -X POST https://rpc.quicknode.testnet.arc.io -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```
```
{"jsonrpc":"2.0","id":1,"result":"0x4cef52"}
{"jsonrpc":"2.0","id":1,"result":"0x4cef52"}
```

Block time, base fee, extraData, and fee history: `node docs/evidence/phase-0/research-s1/s1b.mjs` (raw output in `research-s1/s1b_out.txt`):
```
eth_blockNumber = 72507913
block 72507911 timestamp 1794798918 2026-11-16T03:15:18.000Z baseFeePerGas 20000000000 wei ( 20 gwei ) gasLimit 30000000 extraData 0x00000004a817c800 mixHash(prevrandao) 0x0000000000000000000000000000000000000000000000000000000000000000 txs 5
block 72497911 timestamp 1794791949 2026-11-16T01:19:09.000Z
avg block time over 10000 blocks = 0.6969 s
extraData as uint64 (next base fee, wei) = 20000000000
eth_gasPrice = 25000000000 wei = 25 gwei
eth_feeHistory baseFeePerGas = 20gwei,20gwei,20gwei,20gwei,20gwei,20gwei gasUsedRatio = 0.0073,0.0161,0.0094,0.0030,0.0016
```
Decoded:
- **Block time ≈ 0.70 s (VERIFIED-LIVE**, average over 10,000 blocks). The docs say "~0.5 s" and "~2 blocks/s", so the live chain is a bit slower than documented. That means about **124k blocks/day** (this matters for Streams billing, see S3).
- **Base fee = 20 gwei, the protocol floor (VERIFIED-LIVE).** The next block's base fee is in the parent header `extraData` as a uint64: `0x00000004a817c800` = 20e9 wei (this matches the docs). `eth_gasPrice` returns 25 gwei. Blocks are nearly empty (gasUsedRatio < 2%). The per-block gas limit is 30,000,000.
- **PREVRANDAO (`mixHash`) = 0 (VERIFIED-LIVE)**, as the docs say.

### S1.2 Block explorer and contract verification

- **Explorer: `https://explorer.testnet.arc.io` (Blockscout): VERIFIED-LIVE.** The page title is "Arc Testnet blockchain explorer … | Blockscout".
- **`https://testnet.arcscan.app` returns 301 to `https://explorer.testnet.arc.io/`.** The brief's URL is still reachable, but it is no longer canonical, so the expectation is **CONTRADICTED**. `testnet.arcscan.app/api?...` also redirects with a 301. **Use the arc.io API URL directly** for `forge verify-contract`, because verifiers may not re-POST through a redirect.
- **Etherscan-compatible API works (VERIFIED-LIVE):** `curl 'https://explorer.testnet.arc.io/api?module=block&action=eth_block_number'` returns `{"jsonrpc":"2.0","result": "0x4526213","id": 1}`. Blockscout v2 API: `GET /api/v2/smart-contracts/<addr>` returned the verified USDC implementation (see S1.4).
- **Source verification: VERIFIED-DOCS** (https://docs.arc.io/arc/tutorials/deploy-on-arc.md §5.2):
  ```bash
  arc-forge verify-contract $ADDR src/X.sol:X \
    --chain-id 5042002 --verifier blockscout \
    --verifier-url https://explorer.testnet.arc.io/api/ \
    [--constructor-args $(arc-cast abi-encode "constructor(...)" ...)]
  ```
  Manual UI: https://explorer.testnet.arc.io/contract-verification. Stock `forge` should accept the same flags (it is the same Foundry verifier), but nobody has run it yet. S2 will exercise it.
- Gas tracker: https://explorer.testnet.arc.io/gas-tracker.

### S1.3 Faucet

**VERIFIED-DOCS (faucet page).** `https://faucet.circle.com` lists **Arc Testnet** and offers USDC, EURC, and cirBTC. It needs no account and is protected by reCAPTCHA.
- Page text: "Limit: One request per pairing of asset and test network every 2 hours."
- Faucet FAQ: "Developers can request **20 USDC** on testnet **every 2 hours, per address, and per blockchain**."
- What this means for us: each address gets about 20 USDC every 2 hours. The relayer and each demo persona need separate addresses. A human has to fill the captcha, so no automated top-up is possible. The relayer can fund demo personas with plain USDC transfers.

### S1.4 USDC token: address, metadata, EIP-712 domain, permit, EIP-3009

**Address `0x3600000000000000000000000000000000000000` (same on mainnet and testnet): VERIFIED-DOCS + LIVE.** Source: https://docs.arc.io/arc/references/contract-addresses.md ("USDC … Optional ERC-20 interface for interacting with the native USDC balance. Uses 6 decimals.").

Live `eth_call`s (`curl -s -X POST https://rpc.testnet.arc.io -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x3600000000000000000000000000000000000000","data":"<selector>"},"latest"]}'`):

| Call | Raw result | Decoded |
|---|---|---|
| `name()` 0x06fdde03 | `0x…20` `0x…04` `5553444300…` | **"USDC"** |
| `symbol()` 0x95d89b41 | same as name | **"USDC"** |
| `decimals()` 0x313ce567 | `0x…0006` | **6** |
| `version()` 0x54fd4d50 | `0x…20` `0x…01` `3200…` | **"2"** |
| `DOMAIN_SEPARATOR()` 0x3644e515 | `0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0` | matches the computed value (below) |
| `nonces(0x…01)` 0x7ecebe00 | `0x…00` | 0 (function exists) |
| `eip712Domain()` 0x84b0196e | `{"code":3,"message":"execution reverted"}` | **ERC-5267 not implemented.** Hardcode the domain. |
| `totalSupply()` 0x18160ddd | `0x…042bdfda4a06f0dd` | 300,579,928,788.103389 USDC (6-dec; testnet supply) |
| `authorizationState(0x…01, 0x0)` 0xe94a0102 | `0x…00` | false (EIP-3009 state getter exists) |

**USDC EIP-712 domain: VERIFIED-LIVE** (`node research-s1/s1.mjs`, output in `s1_out.txt`):
```
# Expected DOMAIN_SEPARATOR for {name:"USDC",version:"2",chainId:5042002,verifyingContract:USDC}
computed = 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0
live     = 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0 MATCH
```
This also matches https://docs.arc.io/integrate/relayers-and-paymasters/eip-3009-relayer.md (`name: "USDC"`, `version: "2"`). **Note:** the name is "USDC", **not** "USD Coin" as on some other chains.

**Token is a proxy, not a precompile: VERIFIED-LIVE.** The bytecode at 0x3600… is 1,798 bytes (`FiatTokenProxy`: selectors `upgradeTo`, `upgradeToAndCall`, `implementation`, `changeAdmin`, `admin`). Storage slots:
```
slot keccak("org.zeppelinos.proxy.implementation") 0x7050c9e0…f8c3 -> 0x…c6ad664ac6679f4ce74e10e91449c93ec1ae3ca6  (implementation)
slot 0x10d6a54a…390b (zos admin)                                   -> 0x…49f78af090f1f98e7184b7f61f1f1a8a8064b40d  (proxy admin)
EIP-1967 impl slot 0x360894a1…2bbc                                   -> 0x0
```
The implementation `0xc6ad664ac6679f4ce74e10e91449c93ec1ae3ca6` is 23,659 bytes. **It is verified on Blockscout as `NativeFiatTokenV2_2`** (solc v0.6.12, evm istanbul, verified 2026-08-18). Its native-balance link is in `INativeCoinAuthority`/`INativeCoinControl`, which back onto the native-coin precompile. Per the docs, native mint/burn/transfer run through that precompile.

**Selector scan of the implementation bytecode (PUSH4 operands)**: VERIFIED-LIVE (`s1_out.txt`):
```
permit                                   0xd505accf PRESENT
transferWithAuthorization                0xe3ee160e PRESENT
receiveWithAuthorization                 0xef55bec6 PRESENT
transferWithAuthorization(bytes sig)     0xcf092995 PRESENT
receiveWithAuthorization(bytes sig)      0x88b7ab63 PRESENT
permit(bytes sig)                        0x9fd5a6cf PRESENT
cancelAuthorization                      0x5a049a70 PRESENT
authorizationState                       0xe94a0102 PRESENT
nonces                                   0x7ecebe00 PRESENT
DOMAIN_SEPARATOR                         0x3644e515 PRESENT
eip712Domain                             0x84b0196e absent
```
**Typehashes, live vs expected** (`node research-s1/s1c.mjs`, output in `s1c_out.txt`), all **MATCH**:
```
RECEIVE_WITH_AUTHORIZATION_TYPEHASH  0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8
TRANSFER_WITH_AUTHORIZATION_TYPEHASH 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267
PERMIT_TYPEHASH                      0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9
```
**Verified source facts** (Blockscout `/api/v2/smart-contracts/0xc6ad…3ca6`, files `contracts/v2/EIP3009.sol` and `contracts/util/SignatureChecker.sol`):
- `_receiveWithAuthorization` has `require(to == msg.sender, "FiatTokenV2: caller must be the payee")`. **Only the payee contract can submit a receive-authorization**, so it cannot be front-run.
- The `bytes signature` variants use `SignatureChecker.isValidSignatureNow`. For EOAs that means ECRecover, and for contract signers it means `isValidERC1271SignatureNow`. **ERC-1271 smart-account signers are accepted by USDC permit and EIP-3009** when the bytes variant is used. This needs a **deployed** account: there is no ERC-6492 support, because `isContract(signer)` gates the path.

**Conclusion: EIP-2612 permit, EIP-3009 transfer/receive/cancel, and ERC-1271 are all supported: VERIFIED-LIVE.** The docs officially endorse a gasless relayer path: https://docs.arc.io/integrate/relayers-and-paymasters/eip-3009-relayer.md ("A typical `transferWithAuthorization` uses about 65,000 gas units").

### S1.5 Decimals: native 18 vs ERC-20 6

**They are one balance with two views. VERIFIED-LIVE + DOCS.** I picked a live sender from block 72507911 (tx `0x4b1c153d…ba40`):
```
eth_getBalance(0x51f11819d19a688c67b42a62ddcc5bbd4f8e591f) = 11553028895604309201 (18-dec) = 11.553028895604309 USDC
USDC.balanceOf(0x51f11819d19a688c67b42a62ddcc5bbd4f8e591f) = 11553028 (6-dec)            = 11.553028 USDC
native / 1e12 = 11553028  equals balanceOf? true  remainder (sub-6dp dust, wei) = 895604309201
```
The docs (https://docs.arc.io/arc/references/evm-differences.md §"USDC as the native gas token", https://docs.arc.io/arc/references/usdc-system-events.md) say:
- One underlying balance. The native interface uses 18 decimals and the ERC-20 interface at 0x3600… uses 6 decimals. `balanceOf = floor(native / 1e12)`. The ERC-20 view **truncates** sub-micro-USDC dust, so "a zero `balanceOf` doesn't mean the native balance is zero."
- Gas is charged in 18-decimal native units (`gasUsed × effectiveGasPrice` = wei of USDC).
- `msg.value` is in 18-decimal units. "Don't mix `msg.value` with `USDC.balanceOf()`… raw values are off by 10¹²."
- An ERC-20 `transfer`/`transferFrom` emits **two** `Transfer` logs: one from `0x3600…` (6-dec) and one from the system emitter `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` (18-dec, EIP-7708). A plain native send emits only the system log. Gas deductions emit no log.
- Native value transfers to `address(0)` revert. Transfers to or from blocklisted addresses revert (and still consume gas).
- The docs recommend relying solely on the ERC-20 interface for app balances and transfers.

**What our code must do (proposed rule, D-102):**
1. **Contract:** all accounting in **6-decimal ERC-20 base units** through `IERC20(0x3600…)`. Make the contract **non-payable**: no `msg.value`, no `address(this).balance`, and no native sends. Payouts use `USDC.transfer` (6-dec). Integer split math sums exactly to `amount` in 6-dec units.
2. **App/API:** display amounts with `formatUnits(x, 6)`. Show one USDC balance, not two rows. Read user balances with `balanceOf` (6-dec). The truncated dust (<$0.000001) does not matter to users.
3. **Relayer/ops only:** the relayer gas balance is `eth_getBalance` (18-dec). Fees are `gasUsed*effectiveGasPrice/1e18` USDC (or `/1e12` to get 6-dec units). Never compare an 18-dec value to a 6-dec value without converting.
4. **Indexing:** the Streams filter matches on **our contract address** only, so the USDC double logs never reach us. If we ever index USDC Transfers, match emitter `0x3600…` only (6-dec) and ignore the `0xffff…fffe` system emitter.

### S1.6 EVM differences that affect a Foundry + OpenZeppelin (ECDSA/EIP712/ReentrancyGuard) contract

Source: https://docs.arc.io/arc/references/evm-differences.md, https://docs.arc.io/arc/references/gas-and-fees.md, https://docs.arc.io/arc/tutorials/porting-contracts-to-arc.md, https://docs.arc.io/arc/concepts/deterministic-finality.md. All **VERIFIED-DOCS** unless noted.

| Topic | Arc behaviour | Impact on us |
|---|---|---|
| EVM baseline | **Osaka** hard fork, including EIP-7702, plus EIP-7708 (Amsterdam) ahead of upstream | Every opcode solc emits for `cancun`/`prague`/`osaka` is available (PUSH0, MCOPY, TSTORE/TLOAD). OZ `ECDSA`, `EIP712`, `ReentrancyGuard`, `ReentrancyGuardTransient`, and `SignatureChecker` all work. |
| Recommended `evm_version` | Not stated in the docs | **Recommendation (mine, not docs): `evm_version = "prague"`** with solc ≥0.8.24 (OZ 5.x). It is a strict subset of Osaka and avoids leading-edge solc/osaka defaults. `cancun` is also safe. |
| PREVRANDAO | Always `0` (VERIFIED-LIVE: mixHash = 0) | Don't use it for anything. We have no randomness needs. |
| EIP-4788 beacon root | Reads return empty | N/A |
| Blob txs (type-3) | Rejected | N/A. Relayer sends type-2 (EIP-1559) txs. |
| `block.timestamp` | Non-decreasing, **not** strictly increasing. Sub-second blocks can share a second. | Expiry checks (`block.timestamp <= expiry`) are fine. Never assume unique timestamps. Order by block number + log index. |
| Finality | Deterministic, final on inclusion, **no reorgs** | Relayer and webhook can act after 1 block. Streams reorg handling is unnecessary (good, because the Free plan lacks it). |
| Fee market | EIP-1559 + EWMA. **Min base fee 20 gwei**, max 20,000 gwei. Base fee goes to the proposer (not burned). Txs with `maxFeePerGas` < 20 gwei are **silently dropped**. | Relayer must set `maxFeePerGas ≥ 20 gwei` (e.g. `max(2×baseFee, 25 gwei)`) and `maxPriorityFeePerGas` of 0–1 gwei. |
| Gas units | 18-decimal native USDC. Target is about $0.001 per ERC-20 transfer. | At 20 gwei, 1M gas = 0.02 USDC. A 7-recipient split at maybe 300–400k gas would be about $0.006–0.008. **Estimate only. S5 measures it.** |
| `msg.value` | 18-decimal native USDC | Non-payable contract (D-102). |
| Value transfer rules | Sends of value to `address(0)` revert. Sends to or from blocklisted addresses revert (and burn gas). Sending to a self-destructed account reverts. | A blocklisted recipient would revert the **whole** atomic split. That is acceptable on testnet. Validate that recipients are non-zero (we need that anyway). |
| SELFDESTRUCT | EIP-6780 plus native rules | Don't use it. |
| `eth_getLogs` | Public RPC limit: **10,000 blocks per call** (VERIFIED-LIVE: `{"code":-32012,"message":"requested range too large"}` for 0x1–0x2712) | At ~0.7 s/block that is about 2 h per page. Backend catch-up code must page in chunks of 9,999 blocks or fewer, or rely on Streams backfill. |
| Load-balanced RPC | Error `-32014` near the head, from a backend lag | Retry with backoff. |
| Logs | `eth_getLogs` results include `blockTimestamp` (VERIFIED-LIVE sample below) | Handy for the feed. Not guaranteed in Streams payloads (UNVERIFIED). |
| Local simulation | Standard `anvil` runs a stock EVM. The docs recommend **Arc Foundry** (`arc-forge`, `arc-cast`, `arc-anvil --network arc`, `arc-forge test --network arc`). Binaries are at github.com/circlefin/arc-foundry/releases (macOS Apple Silicon is supported, and this machine is `arm64`). | Unit tests with a mock USDC are fine in stock forge. Fork and integration tests should use `arc-anvil` or the live testnet. A mock USDC needs `receiveWithAuthorization` if we adopt D-103. |
| Predeploys | Multicall3 `0xcA11…CA11`, Permit2 `0x0000…8BA3`, Create2 factory `0x4e59…956C`, **EntryPoint v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032`** (code present: 16,035 bytes, VERIFIED-LIVE), Memo, Multicall3From | |

Sample live log (`eth_getLogs` on 0x3600…, 196 blocks, 825 logs):
```json
{"address":"0x3600000000000000000000000000000000000000","topics":["0xddf252ad…b3ef","0x…5794a828…24d6","0x…d61be29f…aadc"],
 "data":"0x…cb","blockHash":"0x7f5b09cb…4949","blockNumber":"0x45262ee","blockTimestamp":"0x6afa75e9",
 "transactionHash":"0xb6925b32…536e","transactionIndex":"0x0","logIndex":"0x2","removed":false}
```

### S1.7 QuickNode on Arc testnet

- **QuickNode is an official Arc node provider: VERIFIED-DOCS** (https://docs.arc.io/arc/tools/node-providers.md, https://docs.arc.io/arc/references/rpc-endpoints.md). The docs list `https://rpc.quicknode.testnet.arc.io` / `wss://rpc.quicknode.testnet.arc.io`. Live `eth_chainId` against it returned `0x4cef52` **without a key (VERIFIED-LIVE)**. A plain GET returns `404 {"error":"not found"}`, which is normal for a JSON-RPC endpoint.
- **QuickNode Streams supports Arc Testnet with every EVM dataset except Validator Activity: VERIFIED-DOCS** (https://www.quicknode.com/docs/streams/supported-chains.md: `| Arc | Testnet | ✅ Block | ✅ Block with Receipts | ✅ Transactions | ✅ Logs | ✅ Receipts | ✅ Traces(trace_block) | ✅ Traces(debug_trace) | ✅ … | ❌ Validator Activity |`). The **network id is `arc-testnet`** (VERIFIED-DOCS: `<option value=arc-testnet>Arc Testnet` in the calculator on https://www.quicknode.com/docs/streams/billing).
- **Account-keyed QuickNode Arc Testnet endpoint (`ARC_RPC_URL`): UNVERIFIED.** It needs the human's account. Product page: https://www.quicknode.com/chains/arc.

### S1 ready-to-paste table for AGENTS/INTERFACES.md §1 Network

```markdown
## 1. Network (Arc Testnet)
_Status: VERIFIED 2026-11-15 by ARCHITECT-research (S1). Evidence: docs/evidence/phase-0/research-s1-s3-s4.md. Decisions D-101..D-105._
| Key | Value | Verified? |
|---|---|---|
| Chain ID | `5042002` (hex `0x4cef52`) | ✅ live |
| Public RPC (canonical) | `https://rpc.testnet.arc.io` · WS `wss://rpc.testnet.arc.io` (open CORS, no key) | ✅ live |
| Legacy RPC alias | `https://rpc.testnet.arc.network` (still serves 5042002; viem `arcTestnet` default) | ✅ live |
| QuickNode RPC | env `ARC_RPC_URL` (keyed, needs account). Public partner endpoint `https://rpc.quicknode.testnet.arc.io` | ✅ public / ❌ keyed |
| Explorer | `https://explorer.testnet.arc.io` (Blockscout). `testnet.arcscan.app` 301-redirects here | ✅ live |
| Explorer API / verify | `--verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ --chain-id 5042002` | ✅ docs (not yet exercised) |
| Faucet | `https://faucet.circle.com`: 20 USDC / 2 h / address / chain, captcha, no login | ✅ docs |
| USDC (ERC-20) address | `0x3600000000000000000000000000000000000000` (FiatTokenProxy → `NativeFiatTokenV2_2` impl `0xc6ad664ac6679f4ce74e10e91449c93ec1ae3ca6`) | ✅ live |
| USDC ERC-20 decimals | `6` | ✅ live |
| Native gas decimals | `18` (same balance; `balanceOf = floor(native/1e12)`) | ✅ live |
| USDC EIP-712 domain | name `"USDC"`, version `"2"`, chainId 5042002, verifyingContract 0x3600…; `DOMAIN_SEPARATOR = 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0`; no `eip712Domain()` | ✅ live |
| EIP-2612 permit | Supported (`permit` v,r,s + bytes/ERC-1271 variant) | ✅ live |
| EIP-3009 | Supported: `transferWithAuthorization`, `receiveWithAuthorization` (payee-only), `cancelAuthorization`, v,r,s + bytes/ERC-1271 variants | ✅ live |
| Block time / finality | ~0.70 s measured (docs ~0.5 s); deterministic finality, no reorgs | ✅ live / docs |
| Gas pricing | EIP-1559+EWMA; min base fee 20 gwei (txs with maxFeePerGas < 20 gwei are dropped); gas limit 30M/block | ✅ live |
| EVM | Osaka baseline; PREVRANDAO = 0; Foundry `evm_version = "prague"` recommended | ✅ docs |
| eth_getLogs range | ≤ 10,000 blocks per call (public RPC) | ✅ live |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ✅ live |
| Multicall3 / Permit2 | `0xcA11bde05977b3631167028862bE2a173976CA11` / `0x000000000022D473030F116dDEE9F6B43aC78BA3` | ✅ live |
| Streams network id | `arc-testnet` (all EVM datasets supported) | ✅ docs |
```

---

## S3 — QuickNode Streams (desk research; the live test needs an account)

Sources: https://www.quicknode.com/docs/streams/supported-chains.md, …/data-sources.md, …/data-sources/ethereum-evm.md, …/filters.md, …/destinations/webhooks.md, …/backfilling.md, …/reorg-handling.md, …/rest-api.md, …/rest-api/create-stream.md, …/rest-api/test-filter.md, …/billing.md, https://www.quicknode.com/pricing.md, https://www.quicknode.com/docs/platform/platform-api-rate-limits.md, https://www.quicknode.com/guides/quicknode-products/streams/validating-incoming-streams-webhook-messages.md.

### S3.1 Facts

| Item | Finding | Status |
|---|---|---|
| Arc Testnet supported | Yes. All EVM datasets except Validator Activity. Network id `arc-testnet`. | VERIFIED-DOCS |
| Datasets | `block`, `block_with_receipts`, `transactions`, `logs`, `receipts`, traces (`debug_trace`, `trace_block`), and combined variants | VERIFIED-DOCS |
| Best dataset for "our contract's 6 events" | **`logs`**. `data` is an array (per block) of arrays of standard log objects (`address`, `topics[]`, `data`, `blockNumber`, `blockHash`, `transactionHash`, `transactionIndex`, `logIndex`, `removed`). The docs' JSON spec and the REST example filter nest them **three deep** (`data[block][receipt][log]`), while the prose says "array of arrays", so the filter should flatten defensively. Fallback: `receipts` (gives tx status/from) or `block_with_receipts` (gives block timestamp; ~2× the `block` cost). | VERIFIED-DOCS (shape ambiguity noted) |
| Filter language and signature | JS: **`function main(stream)`**, which must be named `main` (the parameter name is arbitrary). The input object is `{ data, metadata }`. Return an object, array, or string to deliver, or **`null` to skip delivery**. `async function main` is allowed for `qnLib.*` KV calls. Sandbox: no `require`/`import`/network/`fs`/`eval`. Helpers: `decodeEVMReceipts(receipts, abis)` (receipts datasets), `console.log` (Logs tab). Go: `func Filter(qn *qn.QNContext, payload Payload) interface{}`. | VERIFIED-DOCS |
| Credits vs filter | **You are billed per block processed, whatever the filter returns.** Filtering does not reduce credits. You are not charged for failed deliveries. | VERIFIED-DOCS |
| Metadata | `metadata`: `batch_start_range`, `batch_end_range`, `data_size_bytes`, `blocks_reorged`, `reorgs`, `dataset`, `network`, `start_range`, `end_range`, `keep_distance_from_tip`, `stream_id`, `stream_name`, `stream_region`. The same values are also sent as HTTP headers: `Stream-Id`, `Stream-Name`, `Stream-Region`, `Stream-Network`, `Stream-Dataset`, `Stream-Start-Range`, `Stream-End-Range`, `Stream-Keep-Distance-From-Tip`, `Batch-Start-Range`, `Batch-End-Range`, `Batch-Data-Size-Bytes`, `Batch-Reorgs`, `Batch-Blocks-Reorged`. **Open question:** when a filter is set, is the delivered body exactly the filter's return value, or wrapped with metadata? Return our own envelope that includes the batch range so either way works. | VERIFIED-DOCS / UNVERIFIED (body wrapping) |
| Webhook delivery | POST, `Content-Type: application/json`. **Sequential**: the next batch waits until your endpoint returns **2xx**. Settings: timeout (default 30 s; REST `post_timeout_sec`), retry interval (default 1 s; `retry_interval_sec`), "pause stream after N failed retries" (default 3; `max_retry`), custom headers, security token, mTLS, private CA. Source IP is `141.148.40.227`. | VERIFIED-DOCS |
| Compression | `none` or `gzip` (`Content-Encoding: gzip`). **The pricing table shows "Data compression" as not on the Free plan.** Use `none`. | VERIFIED-DOCS |
| Batch size | `dataset_batch_size`. **Tip streams on chains with sub-second block times (Arc) must use ≥ 5** (otherwise 422), or the plan max if lower. Set `elastic_batch_enabled: true` so partial batches deliver immediately at the tip. | VERIFIED-DOCS |
| **Webhook auth (HMAC)** | Headers **`X-QN-Nonce`**, **`X-QN-Timestamp`**, **`X-QN-Signature`**. Signature = **hex(HMAC-SHA256(key = security_token, msg = nonce + timestamp + payload))**, where payload is the **decoded (uncompressed) UTF-8 JSON body string**. Compare in constant time. The security token is generated on create (≥ 32 chars if you supply one), shown in the dashboard Settings tab and in the REST create response (`destination_attributes.security_token`), and rotatable. Optional mTLS (CN=quicknode.com) and IP allowlisting. | VERIFIED-DOCS |
| Start block / backfill | `start_range` = block number (omit for latest). `end_range` = block number (omit or `-1` for continuous). "Start from Genesis or a specific block height" is also in the dashboard. **A backfill that continues to the tip is one stream with `start_range` = deploy block and no `end_range`.** Test a small range first. | VERIFIED-DOCS |
| Reorgs | Optional "Restream on reorg" (`fix_block_reorgs: 1`), **paid plans only**. "Latest block delay" (`keep_distance_from_tip`). The metadata carries `reorgs`/`blocks_reorged`. **Arc has deterministic finality (no reorgs)**, so use `fix_block_reorgs: 0` and `keep_distance_from_tip: 0`. Still dedupe on `(txHash, logIndex)` because retries can re-deliver. | VERIFIED-DOCS |
| REST API | Base `https://api.quicknode.com/streams/rest/v1`, header **`x-api-key: <key>`** (Dashboard → API Keys → Add, with the Streams app enabled). Endpoints: `POST /streams`, `GET /streams`, `GET/PATCH/DELETE /streams/{id}`, `POST /streams/{id}/pause`, `POST /streams/{id}/activate`, `GET /streams/enabled_count`, `POST /streams/test_filter`. `filter_function` is **base64-encoded JS**. `external_id`/`Idempotency-Key` give safe retries. The `qn` CLI also exists (`qn stream test-filter …`). Rate limit on Free is 3 req/s sustained (burst 6), shared with other platform APIs. OpenAPI: https://api.quicknode.com/streams/rest/openapi.json | VERIFIED-DOCS |
| Free plan (Free trial) | $0, **1 month**, **10M API credits** (no overage), 15 RPS, **1 active stream**, 1 destination per stream, webhook destinations ✓, filters ✓, KV ✓, logs ✓. **No** compression, **no** reorg handling, **no** traces, no Admin API. Streams and RPC share one credit pool. | VERIFIED-DOCS |
| Build plan | $49/mo, 80M credits, 10 active streams, compression, reorg handling | VERIFIED-DOCS |
| **Credit multiplier for Arc Testnet + logs** | The calculator is client-rendered (its default example is Ethereum *Block* = 20 credits/block), so the static docs do not give the Arc-specific number. | **UNVERIFIED. The human must read the calculator while signed in.** |

### S3.2 Feasibility and the one real risk (credits)

Streams is **feasible**: the network is supported, `logs` + JS filter + webhook + HMAC + start-block backfill are all available on the Free plan.

**Budget risk:** Arc testnet produces **~124k blocks/day** (0.70 s blocks). Credits = blocks processed × multiplier, whatever the filter returns. From now (Nov 15) to the deadline (Nov 20) is about 5 days ≈ 620k blocks.
- Multiplier 20 (the Ethereum-Block example): ~12.4M credits. **That exceeds the Free 10M** if the stream runs continuously the whole time.
- Multiplier ≤ 16: fits within 10M.

Mitigations, cheapest first:
1. **Create the stream late.** Start it with `start_range` = our contract's deploy block once the contract is final (Phase 2/3), not now.
2. **Pause** it when not developing or demoing. On resume, choose "resume from latest" to skip paying for the gap, or let it catch up only when needed.
3. Use the **public Circle RPC** for all app/relayer RPC so QuickNode credits go only to Streams.
4. If the multiplier turns out ≥ ~16 or we need more than 1 stream (e.g. a separate backfill-replay demo stream), upgrade to **Build ($49)**: 80M credits and 10 streams. Note the "backfill replay demo" (Tier 2) on Free means pausing the live stream, then PATCHing or recreating it with an older `start_range`.

### S3.3 Streams setup recipe (draft)

**Inputs needed:** `CONTRACT` (deployed address, lowercase), `DEPLOY_BLOCK`, the 6 event signatures from INTERFACES §4 (still pending), and a public HTTPS URL for `apps/api` (for example `https://<tunnel-or-host>/webhooks/quicknode`).

**Compute topic0s** (in `packages/shared`, once the ABI exists; viem):
```ts
import { toEventSelector } from 'viem';
// e.g. toEventSelector('PaymentSettled(bytes32,address,address,uint256)')
// Prefer: for each ABI item of type 'event' -> toEventSelector(item)
```

**Filter function (JS, dataset `logs`)**: paste into the dashboard editor, or base64 it for REST:
```js
// Stream: arc-testnet / logs. Keeps only our contract's 6 event types; skips empty batches.
const CONTRACT = '0x0000000000000000000000000000000000000000'; // TODO: deployed address (lowercase)
const TOPICS = {
  // TODO: replace with toEventSelector(...) outputs from packages/shared
  '0x<topic0-VenueRegistered>': 'VenueRegistered',
  '0x<topic0-TermsUpdated>': 'TermsUpdated',
  '0x<topic0-IntroAccepted>': 'IntroAccepted',
  '0x<topic0-PaymentSettled>': 'PaymentSettled',
  '0x<topic0-RewardPaid>': 'RewardPaid',
  '0x<topic0-CustomerVerified>': 'CustomerVerified',
};

function collectLogs(node, out) {
  // Docs show data as [block][receipt][log] in examples and "array of arrays" in prose; flatten defensively.
  if (Array.isArray(node)) { for (const x of node) collectLogs(x, out); return; }
  if (node && typeof node === 'object' && Array.isArray(node.topics)) out.push(node);
}
const hexToNum = (h) => (typeof h === 'string' ? parseInt(h, 16) : (h ?? null));

function main(stream) {
  const logs = [];
  collectLogs(stream.data, logs);
  const events = [];
  for (const log of logs) {
    if (!log.address || log.address.toLowerCase() !== CONTRACT) continue;
    const t0 = (log.topics[0] || '').toLowerCase();
    const name = TOPICS[t0];
    if (!name) continue;
    events.push({
      event: name,
      address: log.address.toLowerCase(),
      topics: log.topics,
      data: log.data,
      blockNumber: hexToNum(log.blockNumber),
      blockHash: log.blockHash,
      blockTimestamp: hexToNum(log.blockTimestamp), // may be undefined in Streams payloads (unverified)
      txHash: log.transactionHash,
      txIndex: hexToNum(log.transactionIndex),
      logIndex: hexToNum(log.logIndex),
      removed: !!log.removed,
    });
  }
  if (events.length === 0) return null; // skip delivery (credits are still consumed)
  const m = stream.metadata || {};
  return {
    v: 1,
    streamId: m.stream_id, network: m.network, dataset: m.dataset,
    batchStart: m.batch_start_range, batchEnd: m.batch_end_range,
    events,
  };
}
```
Decode `topics`/`data` in `apps/api` with viem `decodeEventLog({ abi, topics, data })` using the shared ABI. The filter stays dumb, and the ABI stays in one place (packages/shared). Idempotency key: `(txHash, logIndex)`.

**Option A: Dashboard (human, about 10 min):** labels from the docs. The exact UI wording may differ.
1. https://dashboard.quicknode.com/streams → **Create Stream**.
2. Chain **Arc**, network **Testnet**. Dataset **Logs**.
3. Range: start = **block number `DEPLOY_BLOCK`** (or "Latest" for the first smoke test). End = none (continuous). Batch size **5**, Elastic batch **on**. Latest-block delay 0. Restream on reorg off (not on Free anyway).
4. Filter: paste the JS above. **Run test** against a block that contains one of our events (a block number from the S2 deploy tx or an S5 payment tx). Check that the output is non-null. Check that a block without our events returns null.
5. Destination **Webhook**: URL = `https://<public-host>/webhooks/quicknode`, compression **None**, timeout 10–30 s, retry interval 1 s, **Pause stream after** set higher than the default 3 (e.g. 20) so a short API restart doesn't pause the stream. Click **Check Connection**.
6. Copy the **Security token** (Settings tab) into `apps/api/.env.local` as `QN_STREAM_SECURITY_TOKEN` (name to be confirmed in INTERFACES §7). Create the stream.
7. Record the stream id, start block, filter, and a screenshot for README/bounty evidence.

**Option B: REST** (human creates an API key: Dashboard → API Keys → Add API Key → enable Streams):
```bash
FILTER_B64=$(base64 < filter.js | tr -d '\n')
curl -X POST "https://api.quicknode.com/streams/rest/v1/streams" \
  -H "x-api-key: $QN_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: wom-arc-testnet-events-v1" \
  -d "{
    \"name\": \"wom-arc-testnet-events\",
    \"external_id\": \"wom-arc-testnet-events-v1\",
    \"network\": \"arc-testnet\",
    \"dataset\": \"logs\",
    \"region\": \"usa_east\",
    \"start_range\": $DEPLOY_BLOCK,
    \"dataset_batch_size\": 5,
    \"elastic_batch_enabled\": true,
    \"fix_block_reorgs\": 0,
    \"keep_distance_from_tip\": 0,
    \"filter_function\": \"$FILTER_B64\",
    \"destination\": \"webhook\",
    \"destination_attributes\": {
      \"url\": \"https://<public-host>/webhooks/quicknode\",
      \"compression\": \"none\",
      \"max_retry\": 20,
      \"retry_interval_sec\": 1,
      \"post_timeout_sec\": 15
    },
    \"status\": \"active\"
  }"
# Response includes "id" and destination_attributes.security_token. Store both.
# Test a filter first (no stream needed):
curl -X POST "https://api.quicknode.com/streams/rest/v1/streams/test_filter" \
  -H "x-api-key: $QN_API_KEY" -H "Content-Type: application/json" \
  -d "{\"network\":\"arc-testnet\",\"dataset\":\"logs\",\"filter_function\":\"$FILTER_B64\",\"block\":\"$SOME_BLOCK_WITH_OUR_EVENT\"}"
# Pause / resume: POST /streams/{id}/pause , POST /streams/{id}/activate
```

**Webhook verification sketch (apps/api, Node/TS)**: verify against the **raw decoded body string**, before JSON parsing:
```ts
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export function verifyQuickNode(
  rawBody: Buffer, headers: Record<string, string | string[] | undefined>, token: string,
): boolean {
  const h = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
  const nonce = h('x-qn-nonce'), ts = h('x-qn-timestamp'), sig = h('x-qn-signature');
  if (!nonce || !ts || !sig) return false;
  // HMAC is over the UNCOMPRESSED JSON. Only gunzip if your framework did not already inflate it
  // (express/body-parser raw() auto-inflates even though Content-Encoding: gzip remains).
  const isGz = rawBody.length > 2 && rawBody[0] === 0x1f && rawBody[1] === 0x8b;
  const payload = (isGz ? zlib.gunzipSync(rawBody) : rawBody).toString('utf8');
  const expected = crypto.createHmac('sha256', Buffer.from(token)).update(nonce + ts + payload).digest('hex');
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(sig, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
  // TODO (live test): log X-QN-Timestamp format; then add a freshness window (e.g. ±5 min) and nonce replay cache.
}
// Handler: 401 if invalid; else upsert events keyed by (txHash, logIndex) and return 200 FAST
// (deliveries are sequential and the stream pauses after max_retry failures). Do heavy work async.
```

### S3.4 Still UNVERIFIED (needs the live test after the human creates an account)
1. The Arc Testnet + `logs` credit multiplier (calculator, signed in).
2. Exact `logs` payload nesting on Arc, and whether `blockTimestamp` is included.
3. Whether a filtered delivery body is the raw return value or wrapped in `{data, metadata}`.
4. The `X-QN-Timestamp` format (seconds vs ms) and its exact header casing.
5. The Free plan's maximum `dataset_batch_size` (must allow ≥ 5 or the plan max).
6. That the REST API works on the Free plan with a Streams-scoped key. Rate limits list a "Free" row (3 rps), which suggests yes. The pricing page lists "Admin API: Free —", but that may refer to endpoint management only.

---

## S4 — Wallet approach (time-boxed to about 1 h)

### S4.1 Findings

| Item | Finding | Status / source |
|---|---|---|
| Circle Modular Wallets on Arc Testnet | **Supported**: `Arc (ARC / ARC-TESTNET) … Modular: MSCA`. The quickstart itself uses Arc Testnet: `toModularTransport(\`${clientUrl}/arcTestnet\`, clientKey)`, `arcTestnet` from `viem/chains`. | VERIFIED-DOCS: https://developers.circle.com/wallets/supported-blockchains.md, https://developers.circle.com/wallets/modular/create-a-modular-wallet.md |
| Passkeys | WebAuthn passkey is the signer (`toPasskeyTransport`, `toWebAuthnCredential({mode: Register/Login})`, `toWebAuthnAccount`, `toCircleSmartAccount`). There are no seed phrases. Optional recovery key. | VERIFIED-DOCS |
| SDK | **`@circle-fin/modular-wallets-core` 1.0.16** (latest on npm, published 2026-09-16). Deps: **`viem` pinned `2.55.11`**, `web3` 4.16.0, `webauthn-p256` 0.0.5. viem latest is 2.57.20, so expect version-skew friction with wagmi/viem in `apps/web`. | VERIFIED (npm registry) |
| Credentials | Circle Console account → **Client Key** (Console → Keys → Create a key → Client Key) + **passkey domain** that matches the web domain (Console → Wallets → Modular Wallets → Passkey). Client URL `https://modular-sdk.circle.com/v1/rpc/w3s/buidl`. | VERIFIED-DOCS |
| Bundler on Arc | Circle's bundler through `toModularTransport(.../arcTestnet)` + viem `createBundlerClient`. EntryPoint v0.7 is deployed on Arc. | VERIFIED-DOCS / EntryPoint VERIFIED-LIVE |
| Gas sponsorship | `paymaster: true` on `sendUserOperation`. "**Testnet usage is sponsored automatically.** For mainnet, configure a policy in the Circle Console." Gas Station supports **Arc Testnet** for user- and developer-controlled wallets. Gas Station paymaster on Arc is `0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25`. | VERIFIED-DOCS: https://developers.circle.com/wallets/modular/transfer-tokens.md, https://developers.circle.com/wallets/gas-station.md, …/gas-station/contract-addresses.md |
| Circle Paymaster (user pays gas in USDC) | **Not listed for Arc** (v0.7: Arbitrum, Base; v0.8: Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, Unichain). Not needed: on Arc a funded account already pays gas in USDC. | VERIFIED-DOCS: https://developers.circle.com/paymaster.md |
| Dev-controlled / user-controlled wallets | Arc supported (EOA, SCA). User-controlled = PIN/social/email OTP (no passkey). Dev-controlled = custodial (we hold the entity secret). | VERIFIED-DOCS |
| MSCA signatures | Verified via **ERC-1271** `isValidSignature` on the MSCA. The SDK's `verifyMessage`/`verifyTypedData` path goes through viem. | VERIFIED-DOCS: https://developers.circle.com/wallets/modular/sign-and-verify-messages.md |
| Other Arc AA providers | Alchemy, Biconomy, Dynamic, MetaMask Embedded, Para, Pimlico, Privy, Thirdweb, Turnkey, ZeroDev, Crossmint, Circle | VERIFIED-DOCS: https://docs.arc.io/arc/tools/account-abstraction.md |

### S4.2 The ERC-1271 tradeoff, stated explicitly
- Our contract must verify **customer** signatures (the Intro countersign and the payment authorization), and possibly **referrer** signatures (Intro).
- **EOA (option B):** OZ `ECDSA.recover` over an EIP-712 digest. It is simple, cheap, and well-tested. It also works with USDC EIP-3009 v,r,s directly.
- **MSCA (option A):** signatures are WebAuthn/P-256 wrapped in Circle's format. On-chain verification has to go through **ERC-1271** on the account (OZ `SignatureChecker`), and **the account must already be deployed**: no ERC-6492 in USDC's SignatureChecker (verified source), and plain OZ SignatureChecker doesn't do 6492 either. So every new customer (Ben) would first need a deploy UserOp (sponsored, but it adds a step and latency) before their first Intro countersign or payment can be verified on-chain. USDC EIP-3009 **does** accept 1271 via the `bytes` variant (verified), so payments themselves can work. Gas for 1271 + P-256 verification is higher, though cheap on Arc. Testing needs real passkeys or a 1271 mock.
- In architecture terms, option A also pulls user-submitted **UserOps** through Circle's bundler into the design, next to (or instead of) our relayer. That gives two submission paths to build, test, and explain.

### S4.3 Recommendation

**Decision: (B), with the door kept open for (A).** Use a browser-generated secp256k1 EOA, encrypted at rest and unlocked by a passkey gesture, with our relayer paying all gas. Write contract signature checks with **OZ `SignatureChecker`** (ECDSA for EOAs, ERC-1271 for contracts) so a Circle MSCA could be swapped in later without contract changes, if Tier 1 finishes early.

Reasons:
1. **Determinism within a ~45 h budget.** B needs no third-party account, client key, domain allow-listing, or SDK version pinning. It is pure WebCrypto + viem (`privateKeyToAccount`, `signTypedData`). Estimate: ~4–6 h including UX. A is likely 8–12 h+ (Console setup, passkey domain for localhost and the phone's HTTPS host, the viem 2.55.11 pin vs wagmi, MSCA deploy-before-verify, 1271 paths in contract + tests, bundler status polling), and it carries unknown-unknowns.
2. **Fits the contract and relayer design.** EIP-712 + ECDSA + EIP-3009 (v,r,s) works out of the box and is officially documented for Arc relayers. One submission path (our relayer).
3. **Same user-visible promise.** "Sign in with a passkey, no seed phrase, no gas." The key never leaves the device unencrypted.
4. **Arc-native story still holds:** the relayer pays gas in USDC, and costs are tiny and predictable.

Proposed B design (for FRONTEND_INTEGRATION / SECURITY_REVIEW):
- On first sign-up: `navigator.credentials.create()` with the **PRF extension** (`extensions: { prf: { eval: { first: salt } } }`). Derive an AES-GCM-256 key with HKDF from the PRF output. Generate the secp256k1 key with viem `generatePrivateKey()`. Store `{credentialId, iv, ciphertext, address}` in IndexedDB. Every unlock is `navigator.credentials.get()` with the same PRF salt → decrypt in memory → sign → drop.
- **Fallback when PRF is unavailable** (PRF support varies by platform/browser and is UNVERIFIED for the demo phone): store the key wrapped by a **non-extractable** WebCrypto AES-GCM key kept in IndexedDB, and gate unlock behind a passkey assertion. This is UX gating only, not cryptographic binding, and must be labelled as such (testnet demo).
- Loss of device = loss of wallet (acceptable for testnet; note it in the README). Optional "export key" or "recovery code" is out of scope.

Risks:
- PRF support on the human's phone/browser (S6 should test `getClientExtensionResults().prf.enabled`).
- Judges may favour "real" AA. Mitigations: mention in the README that Circle Modular Wallets support Arc Testnet and that the contract is ERC-1271-ready. Optionally use Circle Modular Wallets for the **venue** account only in Tier 3.
- A browser-held key is weaker than a secure-enclave passkey signer. That is acceptable for a testnet demo, and SECURITY_REVIEW should document it.

### S4.4 Payment-authorization recommendation (permit vs EIP-3009 vs approve)

**Recommend EIP-3009 `receiveWithAuthorization`, called by our payment contract, with `nonce = EIP-712 hash of our payment struct`.**
- The customer signs **one** EIP-712 message in USDC's domain: `ReceiveWithAuthorization(from=customer, to=ourContract, value=amount, validAfter, validBefore, nonce)`. Here `nonce = keccak256(abi.encode(PAYMENT_TYPEHASH, orderId, venue, amount, introSetHash/weightsHash, …))`. The relayer calls `ourContract.pay(order, venueSig, attributorSig, …, v, r, s)`. Our contract recomputes `nonce` from the params and calls `USDC.receiveWithAuthorization(...)`. USDC checks the signature and **pulls the funds into our contract**. Our contract then splits them with `USDC.transfer` in the same tx.
- Why this is the best fit:
  - It binds the transfer to the exact order: changing any param changes the nonce, so the signature fails.
  - **Payee-only** (`to == msg.sender`), so it cannot be front-run or redirected.
  - **Random nonces**, unlike permit's sequential nonces, so parallel or abandoned payments don't block each other.
  - **No lingering allowance.**
  - The customer needs no gas.
  - It is officially documented for Arc, live-verified here, and ~65k gas for the USDC part.
- `permit` + `transferFrom`: also works (two calls). The signature only binds spender and value, so our own order signature is still required. Permit nonces are sequential (one in flight at a time per user), and the allowance has to be consumed exactly. It is the second choice.
- Plain `approve` + `transferFrom`: rejected. `approve` is a user-sent tx that needs gas (the user would need USDC for gas and a tx flow). That defeats "no gas". (EIP-7702 could work around it, but adds complexity.)
- If option A is ever adopted: the same flow works through the `bytes`-signature overload `receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)` (0x88b7ab63), which accepts ERC-1271 for a **deployed** MSCA.

---

## Human steps (in order)
1. **QuickNode (bounty):** sign up at https://www.quicknode.com/signup (Free trial: 1 month, 10M credits). (a) Open https://www.quicknode.com/docs/streams/billing while signed in, choose Network **Arc Testnet** and Dataset **Logs**, and report the **credits/block multiplier**. (b) Optionally create an Arc Testnet endpoint and put its URL in `ARC_RPC_URL`. (c) Create an API key with Streams scope (Dashboard → API Keys) if we want REST/CLI stream creation, stored in `.env` as `QN_API_KEY`. **Don't create the Stream yet.** Wait for the contract deploy block and the public webhook URL (Phase 2/3), so you don't burn credits.
2. **Circle faucet:** after S2/S5 generate the deployer/relayer addresses, request 20 USDC per address at https://faucet.circle.com (Arc Testnet, captcha, every 2 h).
3. **Arc Foundry (optional but recommended by the Arc docs):** download the macOS arm64 release from https://github.com/circlefin/arc-foundry/releases and install it as `arc-forge`, `arc-cast`, `arc-anvil` (`~/.local/bin`). Stock Foundry is fine for unit tests.
4. **Circle Console: not needed** under the S4 recommendation (B). Only needed if we later add Modular Wallets (client key + passkey domain).
5. **Phone (S6):** check WebAuthn PRF support in the demo browser.
