# Vouch

**A pay-per-verified-customer marketing network for local businesses.** Customers pay in USDC on Arc, and the sale itself instantly pays the people whose recommendations brought them in.

> 🚧 Hackathon build in progress (UBC 2026). The full README (architecture, Arc usage, contract addresses, setup, eval results) lands in Phase 6. Sections below are filled in as they're verified.

## QuickNode Streams

Streams is Vouch's **core data source**. Every derived view (wallet activity, venue feed, money graph, ambassador record) is built from contract events delivered by a Stream, not from relayer responses. The DB can be wiped and rebuilt by backfilling the Stream from the deployment block.

| | |
|---|---|
| **Network** | Arc Testnet (`arc-testnet`, chain ID 5042002) |
| **Dataset** | `logs` |
| **Filter** | A JavaScript `main(stream)` that keeps only logs whose `address` is our contract and whose `topic0` is one of our event signatures. It returns `null` otherwise, so nothing is delivered for irrelevant blocks. It also drops Arc's EIP-7708 system `Transfer` logs from `0xffff…fffe`. Source: [`infra/streams/filter-logs.js`](infra/streams/filter-logs.js) (template), rendered per contract with `pnpm --filter @vouch/scripts streams render-filter --contract <addr> --events <sigs>`. |
| **Destination** | Webhook → `POST <api>/webhooks/streams`, compression none. Each delivery is authenticated with QuickNode's HMAC headers (`X-QN-Nonce`, `X-QN-Timestamp`, `X-QN-Signature` = hex HMAC-SHA256(token, nonce + timestamp + body)). Unsigned or tampered requests get `401`, and the endpoint fails closed (`503`) if no token is configured. |
| **Start / backfill** | "Start at specific block #" = the contract's deployment block, run continuously. Latest-block delay 0, because Arc has deterministic finality and no reorgs. |
| **Why** | (1) Push delivery within seconds of settlement drives the live UI. (2) Backfill from the deploy block makes state reproducible and auditable (replay demo). (3) The filter runs server-side at QuickNode, so we only receive our own events. |

**How the Stream is created:** in the **QuickNode dashboard** (Streams → Create Stream wizard), because the Streams REST API isn't available on QuickNode trial plans (D-011). Step-by-step values: [`docs/streams/S3-RUNBOOK.md`](docs/streams/S3-RUNBOOK.md).
- The stream is **paused and resumed manually in the dashboard** to save credits when idle.
- The webhook URL is the API's **stable Railway domain** (`https://<api>.up.railway.app/webhooks/streams`, D-016). The api stores every verified delivery in Postgres (`stream_deliveries`). Deploy steps: [`docs/deploy/RAILWAY.md`](docs/deploy/RAILWAY.md). Cloudflare quick tunnels are used only for phone tests, never for the Stream.
- A CLI for paid plans with REST access (`scripts/streams/streams.ts`: create/pause/activate/set-webhook) is kept in the repo.

_Phase 0 spike target:_ the `Hello` spike contract `0x66cb4392322B2aEDE460A4314cE092E0cc1c2B32` (deploy block 72567874). The production Stream targets the Vouch contract once it is deployed.
