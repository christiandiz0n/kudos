# HUMAN_INPUT — things only the human can do or decide
_Last updated: 2026-11-15T22:00:00-05:00 by ORCHESTRATOR — Phase 0_

Status legend: ⏳ pending · ✅ done · ⏸ deferred · ❌ dropped

| # | Phase | What is needed | Why | Exact steps | Blocking? | Status |
|---|---|---|---|---|---|---|
| 1 | 0 | **Confirm project name** | Display name, repo name, pitch | Pick one from the list below (or your own). I change `APP_NAME` in `packages/shared/src/constants.ts`. | No (placeholder `wom` until then) | ⏳ |
| 2 | 0 | **QuickNode account + Arc Testnet endpoint** | S3 Streams spike and the production RPC; the Streams bounty depends on it | 1. Sign up at https://www.quicknode.com · 2. Create endpoint → chain **Arc** → network **Testnet** · 3. Copy the HTTPS URL · 4. Put it in `/Users/christiandizon/Desktop/ubc-2026/.env` as `ARC_RPC_URL=<url>` (don't paste it in chat) · 5. (If available on your plan) Dashboard → API Keys → create a key with Streams permission → `.env` as `QUICKNODE_STREAMS_API_KEY=<key>` | **Yes** for S3 | ⏳ |
| 3 | 0 | **Fund testnet wallets with USDC** | Deploy (S2), relayer tx (S5), demo payments | At https://faucet.circle.com choose **Arc Testnet** + USDC and request for each address in the **Wallets to fund** list below. The faucet limits each address per ~2 hours, so do deployer + relayer first. | **Yes** for S2/S5 | ⏳ |
| 4 | 0 | **Public HTTPS URL for webhooks** | QuickNode must reach our webhook | Phase 0: **nothing to do**. `cloudflared` is installed and I'll run a quick tunnel (`*.trycloudflare.com`, no account). Phase 2+: need a stable URL, see #8. | No | ✅ (Phase 0) |
| 5 | 0 | **Run spike S6 on your phone** | Confirms camera QR scanning works in mobile Safari/Chrome over HTTPS | I'll give you a tunnel URL. Open `<url>/spike/scan` on your phone, allow the camera, and scan the QR shown on your laptop at `<url>/spike/qr?text=hello`. Report: phone model + browser, whether permission prompted, whether it decoded "hello", and the rough speed. | No (needed before Phase 3) | ⏳ (URL coming) |
| 6 | 0 | **GitHub repo** | Required public repo | Approve the name (default: same as product name), and I'll run `gh repo create <name> --private --source . --push` (you're authenticated as the active gh account). Make it **public** only at submission, with your explicit OK. | No | ⏳ |
| 7 | 4 | **LLM provider + API key** (Tier 3 AI attribution) | Optional AI refinement | Choose provider; put the key in `.env` as `LLM_API_KEY=`, and set `LLM_PROVIDER=`. Or drop Tier 3 AI. | No (deferred to Phase 4) | ⏸ |
| 8 | 2 | **Hosting accounts** | Judges need a deployed app; stable webhook URL | Create (free tiers): **Vercel** (web) and **Railway** or **Render** (api + Postgres). Then run `vercel login` / `railway login` yourself with `! <command>` in this prompt. | No (needed by Phase 2/5) | ⏸ |
| 9 | 0 | **Circle Developer account** (only if S4 picks Circle Modular Wallets) | Passkey smart wallets need a client key | Pending S4 research result. I'll give exact steps if needed. | TBD | ⏳ |

## Name options (#1)
_Filled in the Phase 0 report._

## Wallets to fund (#3)
_Filled in once keys are generated (public addresses only; private keys live in `.env`)._
