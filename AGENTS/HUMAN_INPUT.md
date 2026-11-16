# HUMAN_INPUT — things only the human can do or decide
_Last updated: 2026-11-16 by ORCHESTRATOR — Phase 0_

Status legend: ⏳ pending · ✅ done · ⏸ deferred · ❌ dropped

| # | Phase | What is needed | Why | Exact steps | Blocking? | Status |
|---|---|---|---|---|---|---|
| 1 | 0 | **Generate keys** (one command) | Agents are blocked from touching `.env` by your secret-guard hook (D-004) | In the Claude Code prompt type: `! python3 scripts/setup/gen-env.py`. It writes `.env` (mode 600, gitignored) and prints **public addresses only**. | **Yes** (S2, S5, #2) | ✅ |
| 2 | 0 | **Fund wallets with testnet USDC** | Deploy (S2), relayer tx (S5), demo payments | https://faucet.circle.com → network **Arc Testnet** → token USDC → paste an address → captcha. Limit 20 USDC / 2 h per address. Fund in this order: **DEPLOYER, RELAYER, SPIKE_USER**, then DEMO_ANA, DEMO_BEN, DEMO_PRIYA. ATTRIBUTOR, VENUE_SIGNER and DEMO_LENA do **not** need funds. Addresses: printed by #1 and saved in `packages/shared/src/wallets.public.json`. | **Yes** (S2/S5) | ✅ (all funded; DEMO_LENA got +$1 from the top-up proof) |
| 3 | 0 | **Replace the QuickNode API key**: the current one is REJECTED | S3 live + QE gate Part B | QuickNode returns `403 AuthenticationError: Provided key is incorrect or malformed` for the key in `QUICKNODE_STREAMS_API_KEY` (35 chars, `QN_` prefix, no whitespace, so it is well formed; a made-up key gets the same 403). Likely causes: a key deleted or regenerated after copying, a key from a different account/team, or a copy that is a different key type. Fix: dashboard → **API Keys** → **Add API key** → enable **Streams** → copy it → replace the value in `.env` → tell me "key updated". I verify with the read-only `pnpm --filter @vouch/scripts streams list`. Also, the credits-per-block figure came through as "[X]", so please send the actual number. | **Yes** (S3) | ⏳ |
| 4 | 0 | **Phone test: camera QR (S6) + passkey (S6b)** | Confirms scan-to-pay and the passkey wallet approach (D-104) work on your phone | Tunnel (live while this session runs): **https://chronicles-york-magazine-sept.trycloudflare.com**. (a) On the **laptop** open `…/spike/qr?text=hello`. (b) On the **phone** open `…/spike/scan`, allow the camera, point it at the laptop QR. (c) On the **phone** open `…/spike/passkey` → "Run passkey test" → Face ID / fingerprint twice → **screenshot the result list**. Report: phone + browser, scan worked? how fast?, passkey result line (PRF SUPPORTED / NOT SUPPORTED). | No (needed before Phase 3) | ⏳ |
| 5 | 0 | **Confirm project name** | Display name, repo name, pitch | Pick one from the list below or give your own. | No (placeholder `wom`) | ✅ Vouch (D-007) |
| 6 | 0 | **GitHub repo** | Required public repo | Say "create repo `<name>`" and I'll run `gh repo create <name> --private --source . --push`. I'll make it **public** only at submission, with your explicit OK. | No | ✅ github.com/christiandiz0n/vouch (private) |
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
