# Deploying the api to Railway (stable webhook URL)

_Owner: STREAMS_INFRA. Written 2026-11-16 (Phase 1.5, D-305). This file contains no secrets._
_Railway CLI commands checked against docs.railway.com (CLI reference pages for `init`, `add`, `variable`, `up`, `domain`, `logs`, `run`, `redeploy`) on 2026-11-16. The latest CLI release that day was **v5.74.1** (github.com/railwayapp/cli/releases). If `railway <cmd> --help` disagrees with this file, the CLI wins: tell STREAMS_INFRA._

**What gets deployed:** `apps/api` (Fastify + tsx, no build step), built from the root `Dockerfile`, plus a Railway **Postgres** database. The api migrates the DB on boot, listens on `$PORT`, and serves `GET /health` and `POST /webhooks/streams`. Its public URL is a fixed `https://<name>.up.railway.app`, which is where the **production QuickNode Stream** points. Cloudflared quick tunnels are now only for phone tests (S6) and local experiments.

```
QuickNode Stream (Vouch @ Arc Testnet) ──HTTPS──▶ https://<api>.up.railway.app/webhooks/streams
   api: HMAC verify (D-301) ─▶ verified? INSERT stream_deliveries (Postgres) ─▶ 200
                               rejected? 401/503, no row ─▶ one "streams delivery" log line either way
```

Files: `Dockerfile` (node:24-slim, corepack pnpm 11.28.6, `pnpm install --frozen-lockfile --prod --filter "@vouch/api..."`, `node --import tsx src/server.ts`), `.dockerignore` (excludes every `.env*` except `.env.example`), `railway.json` (Dockerfile builder, healthcheck `/health`, restart `ON_FAILURE`).

Roles: **[HUMAN]** steps need the person's browser or account. **[ORCH]** steps are run by the Orchestrator in a terminal at the repo root after the human has logged in. Secrets never pass through chat, the repo or an agent's terminal.

---

## 1. [HUMAN] Account and CLI login (once)

1. Go to https://railway.com, click **Login**, then **Login with GitHub**. The trial gives a one-time **$5 credit** and needs no card.
2. Install the CLI: `brew install railway`, then check it with `railway --version` (expect 5.x).
3. Log in. In the Claude Code prompt, type the command with a leading `!` so it runs in your own shell and the browser flow opens:
   ```
   ! railway login
   ```
   With no browser available, use `railway login --browserless`. Then tell the Orchestrator "railway logged in". `railway whoami` confirms it.

## 2. [ORCH] Create the project, the database and the api service

All of these run from the repo root (`/Users/christiandizon/Desktop/ubc-2026`).

```bash
railway init --name vouch                 # creates the project and links this directory to it
railway add --database postgres           # adds a Postgres service named "Postgres"; it deploys right away
railway add --service api \
  --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --variables 'NODE_ENV=production' \
  --variables 'PORT=8080' \
  --variables 'CORS_ORIGINS=http://localhost:3100'
railway status                            # check: project vouch, service api linked
```
- Keep the **single quotes** around `${{Postgres.DATABASE_URL}}` so the shell doesn't expand it. Railway resolves the reference at deploy time to the Postgres service's private URL (`postgres.railway.internal`). If `railway add --database postgres` named the service differently (check with `railway status` or in the dashboard), use that name inside `${{…}}`.
- `PORT=8080` is pinned so the domain's target port is deterministic. The api reads `PORT`, then `API_PORT`, then defaults to 4000 (`apps/api/src/env.ts`).
- `CORS_ORIGINS` is a comma-separated list. Add the web origin (for example the Vercel URL) when the web app is deployed.
- `API_HOST=0.0.0.0` is already set in the Dockerfile. `NODE_ENV=production` turns off the local NDJSON spike log, so the Postgres table is the record. Set `STREAMS_SPIKE_LOG=<path>` to turn it back on (the container disk is ephemeral).
- **Don't set `STREAMS_WEBHOOK_SECRET` here.** The human sets it in step 4.

To change a non-secret variable later, run `railway variable set KEY=value --service api`. Variable changes are **staged**: they apply on the next deploy.

## 3. [ORCH] Deploy and get the public URL

```bash
railway up --service api --ci             # uploads the repo (respects .gitignore + .railwayignore; skips .git, node_modules), streams build logs, exits
railway domain --service api --port 8080  # generates https://<name>.up.railway.app (one Railway domain per service)
API=https://<name>.up.railway.app         # paste the printed domain
```
`railway up` uploads the working tree, so **uncommitted changes are deployed too**. Use `--detach` to return as soon as the build is queued, then `railway logs --service api --build` to follow it.

Check right away (the secret isn't set yet):
```bash
curl -s $API/health
# → {"ok":true,"app":"Vouch","chainId":5042002,"db":{"kind":"postgres","ok":true},"time":"…"}   ← db.kind MUST be postgres
curl -s -w ' %{http_code}\n' -X POST $API/webhooks/streams -H 'content-type: application/json' -d '{}'
# → {"ok":false,"error":"secret-unset"} 503        (fail closed, D-301)
```
If `db.kind` is `pglite`, `DATABASE_URL` didn't resolve. Fix the reference (step 2) and redeploy. Hand `$API/webhooks/streams` to the human.

**Config-as-code caveat:** Railway marks `railway.json` (Config as Code) as **deprecated** in favour of Infrastructure as Code (`.railway/railway.ts`, `railway config plan|apply`). The docs say existing files keep working "for legacy services until 2026-12-01" and don't say whether a brand-new service reads them. After the first deploy, open **api → Settings** and confirm *Healthcheck Path* = `/health` and *Restart Policy* = On Failure. If they aren't set, set them there by hand. The root `Dockerfile` is picked up regardless ("Railway will always build with a Dockerfile if it finds one"). Moving to IaC is a follow-up.

## 4. [HUMAN] Set the webhook secret (Railway dashboard only)

1. Create the production Stream in the QuickNode dashboard (paused) with destination URL **`<API>/webhooks/streams`**. Copy its **security token**. See `docs/streams/S3-RUNBOOK.md` for the wizard fields.
2. Railway dashboard → project **vouch** → service **api** → **Variables** → **New Variable**: name `STREAMS_WEBHOOK_SECRET`, value = the token → **Add**.
   Optionally use the variable's ⋮ menu → **Seal** so the value can never be read back. Sealing is permanent, and sealed values are hidden from `railway variable list`/`railway run`.
3. Railway shows the change as **staged**. Click **Deploy** to apply it. The service restarts with the token.
4. Tell the Orchestrator "secret set and deployed". Never paste the token in chat.

Later secrets (`RELAYER_PRIVATE_KEY`, `SESSION_SECRET`, …) go in the same way.

## 5. [ORCH] Verify the secret is live

```bash
curl -s -o /dev/null -w 'health %{http_code}\n' $API/health                 # → health 200
curl -s -w ' %{http_code}\n' -X POST $API/webhooks/streams -H 'content-type: application/json' -d '{}'
# → {"ok":false,"error":"missing-signature-headers"} 401      (no longer 503)
curl -s -w ' %{http_code}\n' -X POST $API/webhooks/streams -H 'content-type: application/json' \
  -H 'x-qn-nonce: probe' -H "x-qn-timestamp: $(date +%s)" -H "x-qn-signature: $(printf '0%.0s' {1..64})" -d '{"v":1}'
# → {"ok":false,"error":"bad-signature"} 401
```
Then the human activates the Stream. Verified deliveries show up in the logs (section 6) and in the table (section 7).

---

## 6. Logs

```bash
railway logs --service api                                      # stream live deploy logs (Ctrl-C to stop)
railway logs --service api --lines 100 --filter "streams delivery"   # last 100 delivery lines
railway logs --service api --build                              # build logs
railway logs --service api --latest                             # latest deployment, even if it failed/is building
railway logs --service api --http --path /webhooks/streams      # Railway's HTTP request log for the route
```
Each request to `/webhooks/streams` emits exactly one JSON line with `msg:"streams delivery"`:
```json
{"level":30,"reqId":"req-3","delivery":{"verified":true,"status":200,"bytes":154,"rowId":1,"streamId":"…","batchStart":72584790,"batchEnd":72584794,"eventCount":3,"eventNames":["CustomerVerified","PaymentSettled","RewardPaid"],"blocks":{"from":72584792,"to":72584792},"shape":"envelope:v1"},"msg":"streams delivery"}
{"level":30,"reqId":"req-4","delivery":{"verified":false,"status":401,"reason":"missing-signature-headers","bytes":2},"msg":"streams delivery"}
```
The line never contains the token, the signature or the body. Labels and ranges are logged only for verified requests. `status:500, reason:"persist-failed"` means the HMAC passed but the DB insert failed. QuickNode retries in that case, so nothing is lost while the DB recovers.

## 7. Inspect stored deliveries (`stream_deliveries`)

Every **verified** delivery is one row: `id, received_at, verified, stream_id, batch_start, batch_end, event_count, bytes, gzip, headers (allow-listed, no signature), summary, body (jsonb), body_text`. Rejected requests (401/503/400) never get a row.

From a laptop, the private `DATABASE_URL` (`*.railway.internal`) is unreachable. Use the Postgres **public** URL:
1. [HUMAN or ORCH] Dashboard → **Postgres** → **Settings → Networking → Public Networking** → enable the TCP proxy. This creates `DATABASE_PUBLIC_URL` on the Postgres service. Traffic through the proxy is billed as egress, which is tiny for this.
2. [ORCH]
   ```bash
   railway run --service Postgres -- pnpm --silent --filter @vouch/scripts streams:deliveries --db --last 10 [--body]
   ```
   `railway run` injects the Postgres service's variables. `--db` prefers `DATABASE_PUBLIC_URL` over `DATABASE_URL`, refuses a `*.railway.internal` host with a hint, and never prints credentials. `--db-url <url>` overrides both. Plain `streams:deliveries` (no `--db`) still reads the local NDJSON file.
   With `psql` installed, `railway connect Postgres` opens a SQL shell, e.g. `select id, received_at, stream_id, batch_start, batch_end, event_count from stream_deliveries order by id desc limit 20;`.

## 8. Redeploy, rollback, cost

- **New code:** `railway up --service api --ci` again (or a GitHub-connected deploy, below).
- **Variables changed:** deploy the staged changes in the dashboard, or run `railway redeploy --service api --yes`. That re-runs the latest deployment without uploading code.
- **Restart only:** `railway restart --service api`.
- **Rollback:** dashboard → api → **Deployments** → pick an earlier one → **Redeploy**/**Rollback**.
- **GitHub-connected deploys (optional):** dashboard → api → **Settings → Source → Connect Repo** (installs the Railway GitHub app). Root directory `/` and branch `main`. The Dockerfile and `railway.json` are picked up automatically. Every push to `main` then deploys, so set **Watch Paths** (`apps/api/**`, `packages/shared/**`, `Dockerfile`, `pnpm-lock.yaml`) to skip contract/web-only pushes.
- **Cost:** the api is always on (no sleeping, unlike Render's free tier). Watch the credit in the workspace **Usage** page. **Pause the QuickNode Stream when idle**, because QuickNode bills per block processed whatever Railway does.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Deploy fails the healthcheck | Check `railway logs --service api --latest`. The api must log `Server listening at http://<addr>:8080` (one line per interface). A different port means `PORT` is wrong. A DB error at boot (migration) means `DATABASE_URL` is wrong; the restart policy retries. |
| `/health` shows `db.kind: "pglite"` | `DATABASE_URL` is empty or unresolved. Use `'DATABASE_URL=${{Postgres.DATABASE_URL}}'` with the right service name, then redeploy. |
| Unsigned POST still 503 after step 4 | The variable is staged but not deployed. Click **Deploy**, or run `railway redeploy --service api --yes`. |
| Real deliveries `401 bad-signature` | Railway's token differs from the Stream's (copy/paste or rotation). HUMAN: re-copy it into `STREAMS_WEBHOOK_SECRET` and deploy. |
| Deliveries `500 persist-failed` | DB unreachable or full. Check the Postgres service; QuickNode retries. |
| `streams:deliveries --db` says PRIVATE host | Enable Public Networking on Postgres and use `railway run --service Postgres -- …` (section 7). |
| `railway up` uploads too much | It respects `.gitignore` (so `.env` and `data/local` are never uploaded) and `.railwayignore`. `.dockerignore` additionally keeps `.env*`, `contracts/out|cache`, `broadcast`, `data/`, `.next`, `.git` and `node_modules` out of the image. |
