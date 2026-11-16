# S3 runbook: live QuickNode Stream on Arc testnet → verified webhook (dashboard-created)

_Owner: STREAMS_INFRA. Rewritten 2026-11-16 for dashboard creation (D-011). Updated 2026-11-16 for D-015 (one production Stream, no Hello Stream) and D-016/D-305 (webhook = the Railway URL). This file contains no secrets._

> **What changed (D-015, D-016):** there is **one** Stream, the **production Vouch Stream**, and it is the S3 live proof. Its webhook is the **stable Railway URL** `https://<api>.up.railway.app/webhooks/streams` (deploy: `docs/deploy/RAILWAY.md`), **not** a quick tunnel. Quick tunnels are for phone tests only (D-005). On Railway, verified deliveries are stored in Postgres `stream_deliveries`, so read them with `streams:deliveries --db` (§P). The Hello sections below (§0–H5b) are kept as the offline/QE reference: the Hello filter tests remain the proof of the payload shape. Their stream is **not created**. Where they say `$API`, use the same Railway URL.

## P. Production Stream (Vouch): values

| Item | Value |
|---|---|
| Contract | **Final Vouch address: TBD after the v3 redeploy (D-014).** Take it from `VOUCH_ARC_TESTNET.address` in `@vouch/shared` / `AGENTS/INTERFACES.md` §2. v1 `0xfEe6…b2d3` and v2 `0x9C50…b95f` are retired for the Stream unless the Orchestrator says v2 is final. |
| Start block | **TBD = the final deploy block** (`VOUCH_ARC_TESTNET` / INTERFACES §2) |
| Events | the 10 production events (MSG-010 / `VOUCH_EVENT_TOPICS`), preset `--events vouch` (excludes the never-emitted `EIP712DomainChanged`) |
| Filter | `pnpm --silent --filter @vouch/scripts streams render-filter --contract $VOUCH --events vouch > docs/streams/filter-vouch.js` (stdout = pure JS; topic list on stderr) |
| Webhook | `$API/webhooks/streams` with `API=https://<api>.up.railway.app` (RAILWAY.md §3) |
| Secret | HUMAN pastes the Stream's security token into **Railway → api → Variables → `STREAMS_WEBHOOK_SECRET`** and deploys the staged change (RAILWAY.md §4). Mirror it in the local root env file only if the local api must also verify. |
| Read deliveries | `railway logs --service api --filter "streams delivery"` and `railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:deliveries --db --last 10` (RAILWAY.md §6–7) |

Order: RAILWAY.md §1–3 (api live, `/health` → `db.kind: postgres`, unsigned POST → 503) → render the filter → wizard H1–H3 with the values above (start = final deploy block; filter tests on blocks containing known Vouch txs, e.g. the canonical pay tx's block) → H4, but the token goes to Railway Variables (RAILWAY.md §4) → RAILWAY.md §5 (unsigned → 401) → H5a activate → watch the backfill with `--db` (§A6 expectations, Vouch events instead of Ping/Split) → a fresh pay tx → pause when idle (H5b).

---

## Hello reference run (offline/QE artifact; superseded for live use by §P)

**Goal (original S3):** one QuickNode Stream (Arc Testnet, dataset **Logs**, our JS filter) delivers Hello `Ping`/`Split` events to `apps/api` at `$API` (the Railway URL; originally a quick tunnel). Every delivery is HMAC-verified and recorded (Railway: `stream_deliveries`; local api: also `data/local/streams-spike.ndjson`). The stream is paused afterwards.

**Why the dashboard:** the Streams REST API is not available on QuickNode trial plans. A brand-new account's Admin key gets `403 {"message":"Insufficient permissions","name":"AuthorizationError"}`, and `qn auth login` fails the same way. The dashboard **Create Stream** wizard works and offers Arc Testnet. The bounty needs a Stream with a filter and a webhook destination, and a dashboard-created stream qualifies.
**So the HUMAN creates, activates and pauses the stream in the dashboard.** The CLI subcommands `create`, `pause`, `activate`, `set-webhook`, `get`, `list`, `sync-secret` and `test-filter` need REST access. They are kept for paid plans and are **not used in this runbook**.

**Billing:** Streams bills **every block processed**, whether or not the filter matches. Arc makes about 1.4 blocks/s (~124k/day). The trial allows 1 active stream. **Pause as soon as S3 passes** (step H5).

Roles: **[AGENT]** steps run in a terminal. **[HUMAN]** steps happen in the QuickNode dashboard (https://dashboard.quicknode.com/streams) or the root env file.

---

## 0. Facts and prerequisites

| Item | Value |
|---|---|
| Hello (canonical S3 spike; **source of truth: `AGENTS/INTERFACES.md` §2**) | `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32`, deploy tx `0x382fa022…0f93`, **deploy block `72567874`**. Never take it from `contracts/broadcast/…/run-latest.json` (re-deploys overwrite it), and never trust the env's `HELLO_ADDRESS`. |
| Known Hello events (backfill targets) | `Ping` in block **72567880**: tx `0x6a6ad1c21d288b0eec21559da434b3a6a991406bc45ac69c024c4a2aa344a3d0`, logIndex **4**. `Split` in block **72567926**: tx `0x2de25bf814b182b183ddc7657a0a20962b4c9688d5616f9c5e72f5b96f688214`, logIndex **19**. Block **72567881** has no Hello event. |
| topic0 | `Ping(address,bytes32,uint256)` = `0x20aede85…0ca55` · `Split(address,address,address,uint256,uint256)` = `0x42fb8796…68cd9` |
| Rendered filter | `docs/streams/filter-hello-s3.js`, rendered from `infra/streams/filter-logs.js` for the canonical Hello and both events |
| Webhook route | `POST $API/webhooks/streams` (Railway; locally the api listens on `$PORT`/`API_PORT`/4000) |
| Secret / env vars | `STREAMS_WEBHOOK_SECRET` (the HUMAN pastes the stream's security token into Railway → api → Variables, RAILWAY.md §4; root env file only for a local api), `SPIKE_USER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` (funded, used by `streams:ping`) |

Rules:
- **Agents never open, print or grep the root env file.** Every agent command loads it through a pnpm script (`tsx --env-file-if-exists=…`, D-004).
- **The security token is never pasted into chat.** Only the HUMAN handles it, in the dashboard and the env file. The stream ID is not secret.

Tools: `pnpm install` done, Node ≥ 22, the Railway CLI logged in (RAILWAY.md §1). Run agent commands from the **repo root**. Shell variables used below:
```bash
HELLO=0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32   # AGENTS/INTERFACES.md §2
DEPLOY_BLOCK=72567874                              # AGENTS/INTERFACES.md §2
```

---

## A1. [AGENT] Deploy the api to Railway

Follow `docs/deploy/RAILWAY.md` §2–3 (`railway up --service api --ci`, `railway domain --service api --port 8080`).

## A2. [AGENT] Set the public base URL

```bash
API=https://<name>.up.railway.app     # the domain from `railway domain`; it does not change across deploys
```
_Local-only fallback (phone tests / offline debugging, never the production Stream):_ `pnpm --filter @vouch/api start` plus `cloudflared tunnel --no-autoupdate --url http://localhost:4000`, then `API=https://<random>.trycloudflare.com`. That URL changes every time cloudflared restarts.

## A3. [AGENT] Check the public route before the stream exists

```bash
curl -s -o /dev/null -w 'health %{http_code}\n' $API/health                    # → 200
curl -s -w ' %{http_code}\n' -X POST $API/webhooks/streams -H 'content-type: application/json' -d '{}'
# → {"ok":false,"error":"secret-unset"} 503   (STREAMS_WEBHOOK_SECRET unset/placeholder: fail closed)
#   {"ok":false,"error":"missing-signature-headers"} 401   if a token is already configured
```
`/health` must also show `"db":{"kind":"postgres",…}` on Railway. If `curl` says `Could not resolve host` (brand-new hostname), your local DNS may have cached NXDOMAIN. Wait 30–60 s, or check with `dig @1.1.1.1 <host>`. QuickNode is not affected.

## A4. [AGENT] Provide the filter file

`docs/streams/filter-hello-s3.js` already exists for the canonical Hello. To re-render it and confirm it's current:
```bash
pnpm --silent --filter @vouch/scripts streams render-filter --contract $HELLO --events hello > docs/streams/filter-hello-s3.js
node --check docs/streams/filter-hello-s3.js && grep -n 'const ADDRESSES' docs/streams/filter-hello-s3.js
# → const ADDRESSES = ["0x66cb4392322b2aede460a4314ce092e0cc1c2b32"];
```
`render-filter` makes no API call. Stdout is pure JS; the address and topic summary goes to stderr. Give the HUMAN the file path and `$API/webhooks/streams`.

---

## H1. [HUMAN] Dashboard wizard: Stream range

Dashboard → Streams → **Create Stream**:
- Name: `vouch-s3-hello-spike`
- Chain **Arc**, network **Testnet**
- Start: **"start at specific block #" = `72567874`** (Hello deploy block, INTERFACES §2)
- End: **run continuously**
- Latest block delay: **0** (Arc has deterministic finality, no reorgs)
- Reorg handling: off (not on trial anyway)
- If the wizard shows a batch size, use **5** with **elastic batch on** (Arc has sub-second blocks).

## H2. [HUMAN] Stream dataset + filter

- Dataset: **Logs**
- Filter: paste the full contents of `docs/streams/filter-hello-s3.js`. If the editor has a language selector, choose JavaScript.
- **Test filter** on these blocks (record the outputs: they are the first live proof of the payload shape):

| Block | Expected result |
|---|---|
| `72567880` | envelope `{v:1, …, events:[ one event: "Ping", transactionHash 0x6a6ad1c2…a3d0, logIndex 4 ]}` |
| `72567926` | one `event: "Split"`, transactionHash `0x2de25bf8…8214`, logIndex 19 |
| `72567881` | `null` (nothing delivered) |

If a test does not match, stop and send the output to the Orchestrator. Don't create the stream.
- If there is an "include metadata in payload" style option, leave the default. The filter handles both shapes.

## H3. [HUMAN] Stream destination

- Destination: **Webhook**, URL **`<API>/webhooks/streams`** (the agent provides it)
- Compression: **none**
- Keep the default retries and timeout. If the fields exist, set **max retries 20, retry interval 1 s, timeout 15 s**, so a short api restart doesn't auto-pause the stream.
- The **security token** is shown in the destination settings. Don't share it.
- If there is a "Check connection" / test-delivery button, a 503 or 401 there is expected, because the api doesn't have the token yet.

## H4. [HUMAN] Create PAUSED, save the token, report the ID

1. Create the stream **paused**. If there is no paused option, create it and **pause it immediately**.
2. In **Railway → api → Variables → New Variable**, set `STREAMS_WEBHOOK_SECRET=<token>`, then click **Deploy** for the staged change (RAILWAY.md §4). Use the root env file only for a local api. The agent must not do this.
3. Send the Orchestrator: the **stream ID**, "token saved", and the filter-test outputs from H2. Never send the token.

## A5. [AGENT] Check the api has loaded the token

On Railway, the HUMAN's **Deploy** of the staged variable restarts the api (otherwise run `railway redeploy --service api --yes`). For a local api, press Ctrl-C and rerun `pnpm --filter @vouch/api start`. Then:
```bash
# unsigned → 401 (no longer 503)
curl -s -w ' %{http_code}\n' -X POST $API/webhooks/streams -H 'content-type: application/json' -d '{}'
# → {"ok":false,"error":"missing-signature-headers"} 401
# forged/tampered signature → 401
curl -s -w ' %{http_code}\n' -X POST $API/webhooks/streams -H 'content-type: application/json' \
  -H 'x-qn-nonce: qe' -H "x-qn-timestamp: $(date +%s)" -H "x-qn-signature: $(printf '0%.0s' {1..64})" \
  -d '{"v":1,"events":[{"event":"Ping"}]}'
# → {"ok":false,"error":"bad-signature"} 401
```
Then tell the Orchestrator/HUMAN: "api has the token, ready to activate".

## H5a. [HUMAN] Activate the stream (when told)

Dashboard → the stream → **Activate / Resume**.

## A6. [AGENT] Watch the backfill

```bash
railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:deliveries --db --last 10   # Railway (stored rows = VERIFIED only)
pnpm --silent --filter @vouch/scripts streams:deliveries --last 10                                          # local api (NDJSON, accepted + rejected)
```
Within seconds to a few minutes the stream processes blocks 72567874 → tip. Expected (the batch range is illustrative and not a pass criterion: aligned 5-block batches from 72567874 would be `72567879..72567883`, and elastic batching may re-cut them):
```
<time>  VERIFIED  bytes=…
  qn: stream=<id> batch=<start>..<end> ts=<10-digit?> (skew …s, unit s)
  shape=envelope:v1 logs=1 blocks=72567880..72567880 events=Ping
  tx 0x6a6ad1c21d288b0eec21559da434b3a6a991406bc45ac69c024c4a2aa344a3d0
```
plus a VERIFIED `Split` delivery for tx `0x2de25bf8…8214` (block 72567926). Batches without a Hello event deliver nothing, because the filter returns `null`. In the NDJSON (local api), the two A5 probes appear as `REJECTED (401 …) — unverified body, labels untrusted`. That is expected, and their contents are not shown as fact. On Railway they get no row and show up only as `"verified":false,"status":401` lines in `railway logs`.

## A7. [AGENT] Send a fresh live event

```bash
pnpm --silent --filter @vouch/scripts streams:ping --hello $HELLO
# → target=0x66cb…2B32 (from --hello)  sender=…  PING_TX=0x…  PING_BLOCK=…  status=success pingLogs=1
railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:deliveries --db --last 3
```
`target=` must equal `$HELLO`, the contract the filter watches. The script refuses a zero address or an address with no code. Note the latency: delivery `receivedAt` minus the block time.

## H5b. [HUMAN] Pause (do not skip)

After the agent reports A7 VERIFIED: Dashboard → the stream → **Pause**. Confirm the status shows paused. Leave the stream paused, not deleted. The Railway api keeps running (it's cheap). Stop any local api/tunnel.

---

## Pass criteria (all required)

1. H2 filter tests: 72567880 → one `Ping` (logIndex 4), 72567926 → one `Split` (logIndex 19), 72567881 → `null`.
2. `stream_deliveries` (`--db`) or the NDJSON shows **VERIFIED** backfilled deliveries for the Ping (tx `0x6a6ad1c2…a3d0`) and the Split (tx `0x2de25bf8…8214`).
3. Unsigned POST → 401 and tampered/forged-signature POST → 401 (A5). Before the token was loaded, 503 (A3).
4. The fresh `streams:ping` delivery is **VERIFIED**, its `tx` equals `PING_TX`, and its block range contains `PING_BLOCK`.
5. The stream is **paused** afterwards (dashboard status).

## Reading the deliveries

**Railway (`stream_deliveries`, D-305):** one row per VERIFIED delivery (`id, received_at, verified, stream_id, batch_start, batch_end, event_count, bytes, gzip, headers, summary, body, body_text`). `batch_*` comes from the `batch-*` headers when present, else from the body. Read it with `streams:deliveries --db` (RAILWAY.md §7). Every request, rejected ones included, also logs one `streams delivery` line (`railway logs`). With `NODE_ENV=production`, the NDJSON log is off.

**Local api: NDJSON (`data/local/streams-spike.ndjson`, gitignored)**

One JSON line per POST, accepted or rejected:
`{receivedAt, verified, status, reason?, method, url, headers, bytes, gzip, timestamp:{unit,skewSec}, body, rawBodyBase64?, summary:{logCount, blockRange, txHashes, topic0s, eventNames, batch, shape}}`

- `pnpm --silent --filter @vouch/scripts streams:deliveries [--last N] [--verified-only] [--body] [--file <path>]` prints a readable digest. It reads `STREAMS_SPIKE_LOG` from the root env file exactly like the api, with relative paths resolved against the repo root.
- Only VERIFIED lines show event names, block ranges and tx hashes. Rejected or pre-HMAC lines are labelled "unverified body, labels untrusted" and their summary is withheld.
- `reason` is one of `secret-unset` (503), `missing-signature-headers` (401), `bad-signature` (401), `body-decode-failed` (400).
- Headers are stored lower-cased. The QuickNode metadata headers (`stream-id`, `batch-start-range`, …) and `x-qn-nonce/x-qn-timestamp/x-qn-signature` are recorded. None of them is secret.

**Record these UNVERIFIED items from the first verified delivery** (`--body` helps). Put them in the S3 evidence and in `AGENTS/STREAMS_INFRA.md`:
1. `x-qn-timestamp` format: 10 digits = seconds, 13 = ms (`timestamp.unit`).
2. Body shape: `summary.shape` = `envelope:v1` means the delivered body is exactly the filter's return value. `data:…` means QuickNode wrapped it.
3. `blockTimestamp` present in events?
4. `content-encoding` header (expected absent: compression none).
5. The `stream-*` / `batch-*` header names actually sent. Compare `batchSource` in the body (`metadata` vs `logs`) with the `batch-*` headers.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deliveries `REJECTED (503 secret-unset)` | The token isn't loaded. On Railway, the staged variable wasn't deployed (click **Deploy** or `railway redeploy --service api --yes`). Locally, restart the api (A5). |
| `REJECTED (401 bad-signature)` on real deliveries | The api's token differs from the stream's (rotated, or a copy/paste error). HUMAN: re-copy the token from the destination settings into `STREAMS_WEBHOOK_SECRET` (Railway Variables → Deploy). If it persists, keep the NDJSON line and report it: the signature scheme differs from the docs. |
| Stream auto-paused | QuickNode pauses after the configured number of failed retries. Fix the cause, then the HUMAN resumes it in the dashboard. |
| Webhook URL changed | It shouldn't: the Stream points at the fixed Railway domain (D-016). Only a quick tunnel (local fallback) changes URL on restart. Never point the production Stream at a tunnel. If the Railway domain is ever regenerated, the HUMAN updates the destination URL in the dashboard. `streams set-webhook` needs the REST API (paid plans only). |
| `curl: Could not resolve host …` | Local DNS may briefly cache NXDOMAIN for a brand-new hostname (`*.up.railway.app` or `*.trycloudflare.com`). Wait 30–60 s or use `dig @1.1.1.1`. QuickNode is unaffected. |
| Deliveries `500 persist-failed` (Railway logs) | HMAC passed but the Postgres insert failed. QuickNode retries. Check the Postgres service. |
| Filter test output differs from H2 | Don't create the stream. Send the output to STREAMS_INFRA: it is evidence of the real payload nesting. |
| No deliveries, but the dashboard shows blocks processed | The filter matched nothing. Check that the pasted filter has `ADDRESSES = ["0x66cb…2b32"]` and that the ping went to `$HELLO`. |
| Port 4000 busy (local api) | `API_PORT=<port> pnpm --filter @vouch/api start` (`PORT` also works and wins) and point cloudflared at that port. |

## CLI reference

Works without the REST API (used here):
- `pnpm --silent --filter @vouch/scripts streams render-filter --contract … --events …` (stdout = pure JS)
- `pnpm --silent --filter @vouch/scripts streams:deliveries …` (NDJSON) · `… streams:deliveries --db [--db-url <url>] …` (`stream_deliveries`; URL from `--db-url`, `DATABASE_PUBLIC_URL` or `DATABASE_URL`)
- `pnpm --silent --filter @vouch/scripts streams render-filter --contract <VOUCH> --events vouch` (production preset)
- `pnpm --silent --filter @vouch/scripts streams:ping --hello <addr>` (sends one real tx)
- `pnpm --silent --filter @vouch/scripts streams create … --dry-run` (prints the REST request body; no call)

Need the Streams REST API (**paid plans only**; trial keys get 403): `streams list | get | create | pause | activate | delete --yes | set-webhook | sync-secret | test-filter | enabled-count`.
