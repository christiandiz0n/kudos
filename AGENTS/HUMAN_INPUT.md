# HUMAN_INPUT — things only the human can do or decide
_Last updated: 2026-11-16 (session 2) by ORCHESTRATOR — A5 recorded_

Status legend: ⏳ pending · ✅ done · ⏸ deferred · ❌ dropped

| # | Phase | What is needed | Why | Exact steps | Blocking? | Status |
|---|---|---|---|---|---|---|
| 1 | 0 | **Generate keys** (one command) | Agents are blocked from touching `.env` by your secret-guard hook (D-004) | In the Claude Code prompt type: `! python3 scripts/setup/gen-env.py`. It writes `.env` (mode 600, gitignored) and prints **public addresses only**. | **Yes** (S2, S5, #2) | ✅ |
| 2 | 0 | **Fund wallets with testnet USDC** | Deploy (S2), relayer tx (S5), demo payments | https://faucet.circle.com → network **Arc Testnet** → token USDC → paste an address → captcha. Limit 20 USDC / 2 h per address. Fund in this order: **DEPLOYER, RELAYER, SPIKE_USER**, then DEMO_ANA, DEMO_BEN, DEMO_PRIYA. ATTRIBUTOR, VENUE_SIGNER and DEMO_LENA do **not** need funds. Addresses: printed by #1 and saved in `packages/shared/src/wallets.public.json`. | **Yes** (S2/S5) | ✅ (all funded; DEMO_LENA got +$1 from the top-up proof) |
| 3 | 1.5 | **Production Stream (Vouch v3)** (D-011, D-015) | S3 live proof + Phase 2 data pipeline | Created by the human: `vouch-v3-production` (new QuickNode account), Arc Testnet, Logs, from 72605845, batch 1, webhook = Railway `/webhooks/streams`; test-filter outputs matched (72606007, 72606074). Token in Railway Variables + `.env`; unsigned/forged POST → 401 verified by the Orchestrator. Stream ID **`6b792277-2c66-4c0c-a141-4d452cddfdf8`** (resumed from 72606006). Backfill ✅ 18 verified deliveries / 48 events (all 200). **Pause it now**; reactivate during the Phase 2 QE gate for the live-delivery check. | Yes (Phase 2 exit) | 🟡 pause; live check at QE gate |
| 4 | 0 | **Phone test: camera QR (S6) + passkey (S6b)** | Confirms scan-to-pay and the passkey wallet approach (D-104) work on your phone | Tunnel (session 2, live while this session runs): **https://sophisticated-peaceful-further-spray.trycloudflare.com**. (a) On the **laptop** open `https://sophisticated-peaceful-further-spray.trycloudflare.com/spike/qr?text=hello`. (b) On the **phone** open `https://sophisticated-peaceful-further-spray.trycloudflare.com/spike/scan`, allow the camera, point it at the laptop QR. (c) On the **phone** open `https://sophisticated-peaceful-further-spray.trycloudflare.com/spike/passkey` → "Run passkey test" → Face ID / fingerprint twice → **screenshot the result list**. Report: phone + browser, scan worked? how fast?, passkey result line (PRF SUPPORTED / NOT SUPPORTED). | No (needed before Phase 3) | ⏳ |
| 5 | 0 | **Confirm project name** | Display name, repo name, pitch | Pick one from the list below or give your own. | No (placeholder `wom`) | ✅ Vouch (D-007) |
| 6 | 0 | **GitHub repo** | Required public repo | Say "create repo `<name>`" and I'll run `gh repo create <name> --private --source . --push`. I'll make it **public** only at submission, with your explicit OK. | No | ✅ github.com/christiandiz0n/vouch (private) |
| 7 | 0 | Public HTTPS URL for webhooks / phone | QuickNode must reach our webhook | Done: `cloudflared` is installed and quick tunnels need no account (D-005). | — | ✅ |
| 8 | 1.5 | **Railway account** (stable API URL, D-016) | Stable webhook URL | Done: CLI via npm, logged in; project `vouch` (api + Postgres) deployed by the Orchestrator → `https://api-production-902bc54c.up.railway.app` (/health db=postgres). Vercel later (Phase 5). | — | ✅ |
| 9 | 4 | **LLM provider + key** (Tier 3 AI attribution) | Optional AI refinement | Choose a provider, then set `LLM_PROVIDER=` and `LLM_API_KEY=` in `.env`. Or drop Tier 3 AI. | No (Phase 4) | ⏸ |
| 10 | 0 | Circle Developer account | Only needed for Circle Modular Wallets | Not needed: D-104 chose a passkey-gated local wallet + our relayer. | — | ❌ |
| 11 | 1 | **Approve the design direction** (MSG-007) | Gate before Phase 3 hi-fi screens | Answered in A5 #4: all six yes; magnifier lightweight + projector-readable; fix Ben's cashback self-loop. | — | ✅ D-017 (relayed MSG-044) |
| 12 | 1 | **Confirm D-012** | Submitter binding | Answered in A5 #1: approved with a change: submitter = RELAYER or the customer; kill-the-backend = customer self-submit; no `submitter = 0`. v3 in progress (CONTRACTS → CONTRACTS_QE → redeploy), conditional on EIP-170. | — | ✅ D-014 (v3 ⏳) |

## Name options (#5)
| Name | Rationale |
|---|---|
| **Vouch** ⭐ recommended | The product's core act: you can only vouch for a place you've actually bought from, and the vouch pays. Short verb, works in UI ("Vouch for Lena's"). |
| **Regular** | You become a regular, and regulars bring regulars. Warm and local. Reads well as "Regular, the app for local regulars". |
| **Sentby** | The checkout question "Who sent you here?" as a brand. Very clear about attribution. |
| **Passalong** | The payment passes along to the people who passed the word along. Friendly, but longer. |
| **Kickback** | Literal and memorable ("the sale kicks back to who sent you"), but it carries a bribery connotation, which could hurt in a pitch about trust. |

## Wallets to fund (#2)
_Printed by `scripts/setup/gen-env.py`; also in `packages/shared/src/wallets.public.json` once generated._
