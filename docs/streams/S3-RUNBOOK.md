# S3 runbook: live QuickNode Stream on Arc testnet → verified webhook

_Owner: STREAMS_INFRA. Written 2026-11-16. This file is enough to reproduce S3 from scratch. It contains no secrets._

**Goal:** one QuickNode Stream (`arc-testnet`, dataset `logs`, our JS filter) delivers Hello `Ping`/`Split` events to `apps/api` through a cloudflared quick tunnel. Every delivery is HMAC-verified and recorded in `data/local/streams-spike.ndjson`. The stream is then paused.

**Billing:** Streams bills **every block processed**, whether or not the filter matches. Arc makes about 1.4 blocks/s (~124k/day). The Free plan allows 1 active stream. **Pause the stream as soon as S3 passes** (step 9).

---

## 0. Facts and prerequisites

| Item | Value |
|---|---|
| Hello (S2 deploy) | `0x66cb4392322b2aede460a4314ce092e0cc1c2b32`, deploy tx `0x382fa022…0f93`, **deploy block `72567874`** (from `contracts/broadcast/DeployHello.s.sol/5042002/run-latest.json`) |
| Known Hello events | `Ping` in block **72567880** (tx `0x6a6ad1c2…a3d0`), `Split` in block **72567926** (tx `0x2de25bf8…8214`) |
| topic0 | `Ping(address,bytes32,uint256)` = `0x20aede85…0ca55` · `Split(address,address,address,uint256,uint256)` = `0x42fb8796…68cd9` (`--events hello` computes both from `@vouch/shared` `helloAbi`) |
| Webhook route | `POST /webhooks/streams` on the api (port 4000) |
| Root env vars used | `QUICKNODE_STREAMS_API_KEY` (Console API key with Streams enabled, `QN_…`), `STREAMS_WEBHOOK_SECRET` (written by the CLI), `HELLO_ADDRESS`, `SPIKE_USER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` (funded, for `streams:ping`) |

Rules: **never open, print or grep the root env file.** Every command below loads it through a pnpm script (`tsx --env-file-if-exists=…`, D-004). The CLI never prints the API key or the security token.

Tools: `pnpm install` done, `cloudflared` on PATH (`brew install cloudflared`), Node ≥ 22. Run every command from the **repo root**.

If you redeploy Hello, replace the address and deploy block everywhere below. `bash scripts/spikes/s2-deploy.sh` prints `HELLO_ADDRESS` and `DEPLOY_BLOCK`.

---

## 1. Check the API key (read-only)

```bash
pnpm --silent --filter @vouch/scripts streams list
```
Expected: `https://api.quicknode.com/streams/rest/v1 — 0 stream(s)` (or the existing S3 stream).

- `HTTP 403 … AuthenticationError; Provided key is incorrect or malformed`: QuickNode does not recognize the key. Run `pnpm --silent --filter @vouch/scripts streams key-info` to see its shape (length and charset only). A valid key is `QN_` + 32 chars. **Stop and ask the human** to create a new key: Dashboard → API Keys → Add API key, with the **Streams** application enabled. Then put it in the root env file as `QUICKNODE_STREAMS_API_KEY`.
- `missing … QUICKNODE_STREAMS_API_KEY`: the variable is unset or still the `__placeholder__`.

## 2. (Optional, recommended) Test the filter against a real block (creates nothing)

```bash
pnpm --silent --filter @vouch/scripts streams test-filter --contract 0x66cb4392322b2aede460a4314ce092e0cc1c2b32 --events hello --block 72567880
pnpm --silent --filter @vouch/scripts streams test-filter --contract 0x66cb4392322b2aede460a4314ce092e0cc1c2b32 --events hello --block 72567881
```
Expected: block 72567880 gives `result: { v: 1, …, events: [ { event: "Ping", blockNumber: 72567880, transactionHash: "0x6a6ad1c2…", … } ] }`. Block 72567881 gives `result: null`.
**Record the exact output.** It is the first live proof of the `logs` payload nesting on Arc.

## 3. Terminal A: start the api on :4000

```bash
pnpm --filter @vouch/api start
```
Check in another shell:
```bash
curl -s localhost:4000/health
# → {"ok":true,"app":"Vouch","chainId":5042002,...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4000/webhooks/streams -H 'content-type: application/json' -d '{}'
# → 503 while STREAMS_WEBHOOK_SECRET is unset/placeholder (fail closed), 401 once it is set (no signature)
```

## 4. Terminal B: open the public tunnel

```bash
cloudflared tunnel --no-autoupdate --url http://localhost:4000
```
Copy the printed `https://<random>.trycloudflare.com` URL; call it `$TUNNEL`. Check it:
```bash
TUNNEL=https://<random>.trycloudflare.com
curl -s $TUNNEL/health
```
Leave terminals A and B running.

## 5. Create the stream **paused**, starting at the deploy block

Create it paused so that no delivery reaches the api before it has loaded the new token.
```bash
pnpm --silent --filter @vouch/scripts streams create \
  --name s3-hello-spike \
  --contract 0x66cb4392322b2aede460a4314ce092e0cc1c2b32 \
  --events hello \
  --start 72567874 \
  --webhook $TUNNEL \
  --status paused
```
- Run it once with `--dry-run` first if you want to see the exact request body and the decoded filter. The API key is not used for a dry run.
- The output shows `arc tip …; backlog … blocks`. Every backlog block is billed. If the backlog is large (≫ 10k blocks), consider `--start <recent block just before a ping>` instead, and say so in the report.
- Expected output lines: `created (HTTP 201)`, a stream line with `status=paused … dest=webhook:$TUNNEL/webhooks/streams token=set(N chars)`, **`security token saved (N chars) as STREAMS_WEBHOOK_SECRET in the root env file`**, and `STREAM_ID=<uuid>`. Set `ID=<uuid>` in your shell.
- Re-running with the same `--name` is safe: `external_id`/`Idempotency-Key` = `vouch-s3-hello-spike` returns the existing stream (HTTP 200) and creates nothing.
- If it prints `! no security token in the create response`, run `pnpm --silent --filter @vouch/scripts streams sync-secret $ID`.

## 6. Restart the api so it loads the token

In terminal A, press Ctrl-C, then run `pnpm --filter @vouch/api start` again. The tunnel does not need restarting.
Check: the unsigned `curl … -X POST localhost:4000/webhooks/streams …` from step 3 now returns **401**, not 503.

## 7. Activate and watch the backfill

```bash
pnpm --silent --filter @vouch/scripts streams activate $ID
pnpm --silent --filter @vouch/scripts streams:deliveries --last 10
```
Within seconds to a few minutes the backfill passes blocks 72567880 and 72567926. Expected deliveries:
```
<time>  VERIFIED  bytes=…
  qn: stream=<uuid> batch=72567878..72567882 ts=<10-digit?> (skew …s, unit s)
  shape=envelope:v1 logs=1 blocks=72567880..72567880 events=Ping
  tx 0x6a6ad1c21d288b0eec21559da434b3a6a991406bc45ac69c024c4a2aa344a3d0
```
plus a `Split` delivery for tx `0x2de25bf8…`. Batches with no Hello event deliver nothing, because the filter returns `null`.
`streams get $ID` shows `sequence` (the last delivered block) catching up to the tip.

## 8. Trigger a fresh event and confirm a live delivery

```bash
pnpm --silent --filter @vouch/scripts streams:ping
# → PING_TX=0x…  PING_BLOCK=…  status=success pingLogs=1
pnpm --silent --filter @vouch/scripts streams:deliveries --last 3
```
**Pass criteria for S3:** a delivery line marked `VERIFIED` whose `tx` equals `PING_TX` and whose block range contains `PING_BLOCK`, `events=Ping`. Note the latency: delivery `receivedAt` minus the block time.

## 9. Pause (do not skip)

```bash
pnpm --silent --filter @vouch/scripts streams pause $ID
pnpm --silent --filter @vouch/scripts streams list      # → status=paused
```
Then stop terminals A and B (Ctrl-C). Leave the stream paused, not deleted. Phase 2 reuses or recreates it. `streams delete $ID --yes` exists, but only the Orchestrator decides that.

---

## Reading the NDJSON (`data/local/streams-spike.ndjson`, gitignored)

One JSON line per POST, accepted or rejected:
`{receivedAt, verified, status, reason?, method, url, headers, bytes, gzip, timestamp:{unit,skewSec}, body, rawBodyBase64?, summary:{logCount, blockRange, txHashes, topic0s, eventNames, batch, shape}}`

- `pnpm --silent --filter @vouch/scripts streams:deliveries [--last N] [--verified-only] [--body]` prints a readable digest.
- `reason` is one of `secret-unset` (503), `missing-signature-headers` (401), `bad-signature` (401), `body-decode-failed` (400).
- Headers are stored lower-cased (Node). The QuickNode metadata headers (`stream-id`, `batch-start-range`, …) and `x-qn-nonce/x-qn-timestamp/x-qn-signature` are all there. None of them is secret.

**Record these UNVERIFIED items from the first verified delivery** (copy into the S3 evidence and the STREAMS_INFRA struggles list):
1. `x-qn-timestamp` format: 10 digits = seconds, 13 = ms (`timestamp.unit` in the record).
2. Body shape: `summary.shape` = `envelope:v1` means the delivered body is exactly our filter's return value. `data:…` means QuickNode wrapped it in `{data, metadata}`.
3. Whether `blockTimestamp` is present in the events (`--body`).
4. `content-encoding` header (expected absent: compression `none`).
5. The `stream-*` / `batch-*` header names actually sent.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deliveries `REJECTED 503 secret-unset` | The api was started before the token was saved. Restart it (step 6). |
| `REJECTED 401 bad-signature` | The token in the env differs from the stream's (rotated in the dashboard?). Run `streams sync-secret $ID`, then restart the api. If it persists, keep the NDJSON line and report it: the signature scheme differs from the docs. |
| Stream auto-paused | QuickNode pauses after `max_retry` (20) failed retries. Fix the cause, then run `streams activate $ID`. |
| Tunnel restarted (new URL) | `pnpm --silent --filter @vouch/scripts streams set-webhook $ID https://<new>.trycloudflare.com`. This keeps the token. If the API rotates the token anyway, the CLI saves the new one: restart the api. |
| `HTTP 422` on create | Batch size below 5 on a tip stream (Arc has sub-second blocks), or a schema change. The message is printed. |
| `HTTP 403 AuthenticationError` | See step 1. |
| No deliveries but `sequence` advances | The filter matched nothing. Re-check `--contract` and `--events` with `streams test-filter` on the ping block. |

## CLI reference

`pnpm --silent --filter @vouch/scripts streams <cmd>`: `list` · `get <id> [--show-filter]` · `create … [--dry-run]` · `pause <id>` · `activate <id>` · `delete <id> --yes` · `set-webhook <id> <url> [--dry-run]` · `sync-secret <id>` · `test-filter --contract … --events … --block <n>` · `render-filter --contract … --events …` · `enabled-count` · `key-info`. Running it with no command prints the help.
