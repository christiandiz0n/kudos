# HUMAN_INPUT — things only the human can do or decide
_Last updated: 2026-11-16 ~14:00 ET by ORCHESTRATOR (handoff before a context reset)_

Status legend: ⏳ pending · ✅ done · ⏸ deferred · ❌ dropped

| # | Phase | What is needed | Why | Exact steps | Blocking? | Status |
|---|---|---|---|---|---|---|
| 1 | 0 | **Generate keys** (one command) | Agents are blocked from touching `.env` by your secret-guard hook (D-004) | In the Claude Code prompt type: `! python3 scripts/setup/gen-env.py`. It writes `.env` (mode 600, gitignored) and prints **public addresses only**. | **Yes** (S2, S5, #2) | ✅ |
| 2 | 0 | **Fund wallets with testnet USDC** | Deploy (S2), relayer tx (S5), demo payments | https://faucet.circle.com → network **Arc Testnet** → token USDC → paste an address → captcha. Limit 20 USDC / 2 h per address. Fund in this order: **DEPLOYER, RELAYER, SPIKE_USER**, then DEMO_ANA, DEMO_BEN, DEMO_PRIYA. ATTRIBUTOR, VENUE_SIGNER and DEMO_LENA do **not** need funds. Addresses: printed by #1 and saved in `packages/shared/src/wallets.public.json`. | **Yes** (S2/S5) | ✅ (all funded; DEMO_LENA got +$1 from the top-up proof) |
| 3 | 0 | **Create the S3 Stream in the QuickNode dashboard** (D-011: REST API unavailable on trial plans) | S3 live + QE Part B (Streams bounty) | ⚠️ **The webhook URL given earlier (`rankings-brunette-tubes-patch…`) is DEAD** (the quick tunnel expired after a network change); wait for the new URL from the next orchestrator session. Then follow the numbered checklist in the latest Orchestrator report / `docs/streams/S3-RUNBOOK.md` (wizard values, filter `docs/streams/filter-hello-s3.js`, webhook URL). Create it **paused**, put the token in `.env` as `STREAMS_WEBHOOK_SECRET=`, reply "stream created <ID>". You pause/resume it in the dashboard; update the webhook URL there if the tunnel changes (stable after the Phase 5 deploy). | **Yes** (S3 only) | ⏳ |
| 4 | 0 | **Phone test: camera QR (S6) + passkey (S6b)** | Confirms scan-to-pay and the passkey wallet approach (D-104) work on your phone | Tunnel (live while this session runs): **<new tunnel URL from the next session; the previous ones are dead>**. (a) On the **laptop** open `…/spike/qr?text=hello`. (b) On the **phone** open `…/spike/scan`, allow the camera, point it at the laptop QR. (c) On the **phone** open `…/spike/passkey` → "Run passkey test" → Face ID / fingerprint twice → **screenshot the result list**. Report: phone + browser, scan worked? how fast?, passkey result line (PRF SUPPORTED / NOT SUPPORTED). | No (needed before Phase 3) | ⏳ |
| 5 | 0 | **Confirm project name** | Display name, repo name, pitch | Pick one from the list below or give your own. | No (placeholder `wom`) | ✅ Vouch (D-007) |
| 6 | 0 | **GitHub repo** | Required public repo | Say "create repo `<name>`" and I'll run `gh repo create <name> --private --source . --push`. I'll make it **public** only at submission, with your explicit OK. | No | ✅ github.com/christiandiz0n/vouch (private) |
| 7 | 0 | Public HTTPS URL for webhooks / phone | QuickNode must reach our webhook | Done: `cloudflared` is installed and quick tunnels need no account (D-005). | — | ✅ |
| 8 | 2 | **Hosting accounts** | Judges need a deployed app; a stable webhook URL | Create free accounts on **Vercel** (web) and **Railway** or **Render** (api + Postgres), then run `! vercel login` / `! railway login` here. | **Recommended now**: quick tunnels keep dying; a stable api URL is needed for the production Stream | ⏸ |
| 9 | 4 | **LLM provider + key** (Tier 3 AI attribution) | Optional AI refinement | Choose a provider, then set `LLM_PROVIDER=` and `LLM_API_KEY=` in `.env`. Or drop Tier 3 AI. | No (Phase 4) | ⏸ |
| 10 | 0 | Circle Developer account | Only needed for Circle Modular Wallets | Not needed: D-104 chose a passkey-gated local wallet + our relayer. | — | ❌ |

| 11 | 1 | **Approve the design direction** (MSG-007) | Gate before Phase 3 hi-fi screens | Review `docs/evidence/phase-1/design/` or open `<new web tunnel URL>/design` on your phone. Answer UI_DESIGN's 6 questions: (1) ink-black buttons with green reserved for money? (2) Instrument Sans? (3) split-receipt + loupe motif? (4) "Face ID or fingerprint" copy instead of "passkey"? (5) placeholder L2 names Marco/Sofia? (6) hide Next's dev badge (`devIndicators: false`)? | Yes (Phase 3) | ⏳ |
| 12 | 1 | **Confirm D-012** (QE-C-01 fix: payment bound to the relayer as submitter; `submitter = 0` only for the kill-the-backend demo, where front-running is a documented risk) | Orchestrator default; keeps your invariant 6 verbatim | Reply "D-012 ok", or ask for the alternative (revert when committed attributor weights are invalid, which needs invariant 6 reworded). | No | ⏳ |

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
