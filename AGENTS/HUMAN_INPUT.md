# HUMAN_INPUT — things only the human can do or decide
_Last updated: 2026-11-15T23:15:00-05:00 by ORCHESTRATOR — Phase 0_

Status legend: ⏳ pending · ✅ done · ⏸ deferred · ❌ dropped

| # | Phase | What is needed | Why | Exact steps | Blocking? | Status |
|---|---|---|---|---|---|---|
| 1 | 0 | **Generate keys** (one command) | Agents are blocked from touching `.env` by your secret-guard hook (D-004) | In the Claude Code prompt type: `! python3 scripts/setup/gen-env.py`. It writes `.env` (mode 600, gitignored) and prints **public addresses only**. | **Yes** (S2, S5, #2) | ⏳ |
| 2 | 0 | **Fund wallets with testnet USDC** | Deploy (S2), relayer tx (S5), demo payments | https://faucet.circle.com → network **Arc Testnet** → token USDC → paste an address → captcha. Limit 20 USDC / 2 h per address. Fund in this order: **DEPLOYER, RELAYER, SPIKE_USER**, then DEMO_ANA, DEMO_BEN, DEMO_PRIYA. ATTRIBUTOR, VENUE_SIGNER and DEMO_LENA do **not** need funds. Addresses: printed by #1 and saved in `packages/shared/src/wallets.public.json`. | **Yes** (S2/S5) | ⏳ |
| 3 | 0 | **QuickNode account + Streams API key** | S3 live test; the Streams bounty depends on it | 1. Sign up at https://www.quicknode.com (Free plan is enough to start). 2. Dashboard → **API Keys** → create a key with Streams access → add a line `QUICKNODE_STREAMS_API_KEY=<key>` to `.env` (open it in your editor; **don't paste the key in chat**). 3. Optional: create an **Arc Testnet** endpoint and set `ARC_RPC_URL=<url>` in `.env` (the public RPC already works). 4. In QuickNode's pricing/credits calculator, find **credits per block for Arc Testnet, dataset Logs** and tell me the number. This decides Free vs Build ($49) (D-105). 5. **Don't create a Stream yet.** I'll create it via the API once the webhook is up. | **Yes** (S3) | ⏳ |
| 4 | 0 | **Phone test: camera QR (S6) + passkey (S6b)** | Confirms scan-to-pay and the passkey wallet approach (D-104) work on your phone | Tunnel (live while this session runs): **https://definitely-agency-pieces-give.trycloudflare.com**. (a) On the **laptop** open `…/spike/qr?text=hello`. (b) On the **phone** open `…/spike/scan`, allow the camera, point it at the laptop QR. (c) On the **phone** open `…/spike/passkey` → "Run passkey test" → Face ID / fingerprint twice → **screenshot the result list**. Report: phone + browser, scan worked? how fast?, passkey result line (PRF SUPPORTED / NOT SUPPORTED). | No (needed before Phase 3) | ⏳ |
| 5 | 0 | **Confirm project name** | Display name, repo name, pitch | Pick one from the list below or give your own. | No (placeholder `wom`) | ⏳ |
| 6 | 0 | **GitHub repo** | Required public repo | Say "create repo `<name>`" and I'll run `gh repo create <name> --private --source . --push`. I'll make it **public** only at submission, with your explicit OK. | No | ⏳ |
| 7 | 0 | Public HTTPS URL for webhooks / phone | QuickNode must reach our webhook | Done: `cloudflared` is installed and quick tunnels need no account (D-005). | — | ✅ |
| 8 | 2 | **Hosting accounts** | Judges need a deployed app; a stable webhook URL | Create free accounts on **Vercel** (web) and **Railway** or **Render** (api + Postgres), then run `! vercel login` / `! railway login` here. | No (by Phase 2/5) | ⏸ |
| 9 | 4 | **LLM provider + key** (Tier 3 AI attribution) | Optional AI refinement | Choose a provider, then set `LLM_PROVIDER=` and `LLM_API_KEY=` in `.env`. Or drop Tier 3 AI. | No (Phase 4) | ⏸ |
| 10 | 0 | Circle Developer account | Only needed for Circle Modular Wallets | Not needed: D-104 chose a passkey-gated local wallet + our relayer. | — | ❌ |

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
