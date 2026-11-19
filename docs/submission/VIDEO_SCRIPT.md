# Demo video script: Vouch (target 2:20, hard max 2:30)

_Draft by DOCS_SUBMISSION, 2026-11-18. Upload as YouTube unlisted or Google Drive "anyone with the link", then put the URL into `docs/submission/DEVPOST.md` and the README (`<VIDEO_URL>`)._

**Arc of the story:** Lena's ad problem → a live payment splits → the money graph on the projector → why a chain → Streams → close.

---

## Before you record (about 20 minutes of prep)

| # | Prep step | Why |
|---|---|---|
| P1 | **Resume the Stream** in the QuickNode dashboard ("Continue where it left off"). Wait until a fresh test payment shows as settled. | Without the Stream, payments stay "Arriving" (pending). |
| P2 | Use **only https://vouch-ubc.vercel.app** (passkeys are bound to it). | The other Vercel domain is deliberately blocked by CORS. |
| P3 | **Laptop (projector view):** create a stage venue, e.g. "Lena's café", with a **20% reward** and a $0.50 minimum. Leave its dashboard open full-screen at 1280×720 or larger. | 20% makes a $2.00 order split into clean cents. |
| P4 | **Build a two-level chain before recording** (three browser profiles or phones, each using its in-app **Top up (testnet demo)** for $3): (a) **Priya** pays a $1.00 order (a plain first purchase verifies her). (b) Priya → Recommend → send the link to **Ana**. Ana opens it, saves it, and pays $2.00 (Priya is thanked). (c) Ana → Recommend → **Make my link**. Keep that link for Ben. | Ben's live payment then pays both levels: Ana (direct) and Priya (Ana's introducer). |
| P5 | **Ben's phone:** fresh account, opened Ana's link and tapped "Save Ana's recommendation", topped up $3. Don't pay yet. | This is the live moment. |
| P6 | **Ana's phone** on her wallet screen, next to Ben's, so her "just arrived" toast is visible. | Shows the referrer getting paid live. |
| P7 | Browser tabs ready: the **explorer** for the canonical tx (`https://explorer.testnet.arc.io/tx/0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb`) and for the self-submit tx (`…/tx/0xfca0e1aeb40f9aa4e8564a60d0ac56817297956b2560d9db9bdc8823aa18c7be`), plus `https://vouch-ubc.vercel.app/transparency`. | The "why chain" shots. |
| P8 | Terminal with `pnpm --silent --filter @vouch/scripts streams:verify` **already run**, output on screen. It reads the chain from the deploy block, so run it before recording rather than live. | The Streams replay shot. |
| P9 | Do a full dry run once. Record the backup clips (F-clips below) during the dry run. | Fallbacks. |

**Expected live numbers for Ben's $2.00 at 20%:** reward pool $0.40 → Ben **$0.10** back · Ana **$0.22** · Priya **$0.08** · café **$1.60**. Sum $2.00. If your setup differs, caption the numbers that actually appear on screen. Never caption numbers that didn't happen.

---

## Script

| Time | Shot (screen / device / action) | Voice-over | On-screen caption |
|---|---|---|---|
| **0:00–0:14** | Close-up of a café counter or a stock-style shot of the laptop dashboard, empty. | "Lena runs a café. She spends money on ads she can't measure, but her best customers come from friends telling friends, and those friends get nothing for it." | **Ads you can't measure. Word of mouth that pays nobody.** |
| **0:14–0:24** | Ana's phone: the venue card → **Recommend** → **Make my link** → share sheet. | "Vouch fixes that. Ana loves Lena's café, so she sends Ben a link. Only real customers can recommend a place: Ana has to have bought here first." | **Only verified customers can recommend** |
| **0:24–0:34** | Laptop: **Take an order** → key **2.00** → **Show code**. The QR appears with its countdown ring. | "Ben walks in. Lena keys in his order and shows a code." | **$2.00 order → signed QR code** |
| **0:34–0:52** | Ben's phone: scan → the pay sheet shows **"You'll get $0.10 back"** and **Who sent you here?** → tap **Ana** → **Confirm with Face ID or fingerprint**. | "Ben scans it. He sees what he pays, the money he'll get back, and he can say who sent him. One Face ID, no wallet setup, no fees." | **One tap. Face ID. No seed phrase, no gas.** |
| **0:52–1:06** | Split screen: Ben's phone goes from "Arriving" (gray) to the **green check** and split receipt. Ana's phone shows the **"just arrived"** toast. The laptop counter flips to **Paid**. | "In about a second and a half it's settled. Ben got ten cents back, Ana was paid twenty-two cents, and Priya, who brought Ana in, got eight. The café got the rest." | **Settled in ~1.4 s · Café $1.60 · Ben $0.10 · Ana $0.22 · Priya $0.08** |
| **1:06–1:22** | Laptop dashboard (projector): the **money graph** animates café → Ben → Ana → Priya. Then point at **Cost per new customer** next to "Typical ad cost". | "Lena's dashboard shows exactly where the money went, and what each new customer cost her. She pays only when a referred customer actually buys." | **Pay per verified customer, not per click** |
| **1:22–1:40** | Explorer: the canonical **$12.00** tx `0x40147554…`. Scroll the token transfers: 12.00 in, then 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 out. | "Under the hood it's one transaction on Arc. The payment comes in and the split goes out together, to the exact cent, and the café can't skip the people who sent the customer. On Arc the fee is paid in dollars: this whole split cost less than one cent." | **One atomic split on Arc · fee $0.0086, paid in USDC** |
| **1:40–1:52** | `/transparency` page: the formula, then the venue's terms version. | "The terms are frozen when a link is shared, so a venue can't cut the rate afterwards. And every reward is capped by the venue's own rate." | **Frozen terms · capped rewards · one reward per customer** |
| **1:52–2:00** | Explorer: the self-submit tx `0xfca0e1ae…`. Highlight that **From** is the customer, not our relayer. | "And if our servers disappeared tomorrow, a customer can still submit the payment themselves. No operator needed." | **Works without us: the customer can self-submit** |
| **2:00–2:16** | Terminal: `streams:verify` output, five identical hashes and **OK**. Then cut to the README's Streams table. | "Every screen is built from QuickNode Streams. A filtered stream of our contract's events is pushed to our webhook in about 0.15 seconds. Replay it from the start and you rebuild exactly the same state, hash for hash." | **QuickNode Streams: pushed in ~0.15 s · replay = same hash** |
| **2:16–2:28** | Back to the phones side by side, then the Vouch logo + URL. | "Vouch: word of mouth that pays, the moment it works." | **vouch-ubc.vercel.app · Arc Testnet · QuickNode Streams** |

Total ≈ 2:28. If you run long, cut the 1:40–1:52 transparency shot first (keep its caption over the explorer shot), then shorten the hook.

---

## Fallback for each live step

| Live step | If it fails during recording | Fallback footage |
|---|---|---|
| Ana makes a link (0:14) | The share sheet is slow or the link fails | **F1:** dry-run clip, or QE stills `docs/evidence/phase-3/qe/screens/l14-ana-recommend.png` → `l15-ana-recommend-link.png` |
| Counter QR (0:24) | The QR doesn't appear, or an error shows | Retry once. Otherwise **F2:** dry-run clip, or `l05-counter-qr-100.png` |
| Ben scans and confirms (0:34) | The camera won't focus | Tap the QR link on the laptop to open the pay sheet (the same URL the code holds). Otherwise **F3:** dry-run clip, or `l20-ben-pay-confirm.png` → `l21-ben-picked-ana.png` |
| "Not enough money yet" | Ben's top-up didn't land | Tap **Top up (testnet demo)** in the sheet ($3, about 1–4 s), or run `pnpm --filter @vouch/scripts topup --to <Ben's address> --target 3` from the laptop |
| Settled (0:52) | It stays "Arriving" for more than 5 s | The Stream is paused or lagging. Check the dashboard and resume it. The payment is already on chain, so it settles as soon as the Stream delivers. Otherwise **F4:** dry-run clip, or `l22-ben-pending.png` → `l23-ben-settled.png` + `l25-ana-wallet-reward-toast.png` |
| Money graph (1:06) | The graph doesn't animate | Toggle **Latest / Everyone**, or reload (the state comes from the database). Otherwise **F5:** `l26-projector-money-graph-1280.png` / `l28-venue-dashboard-owner-1280.png` |
| Explorer (1:22, 1:52) | The explorer is slow or down | **F6:** screenshots of the tx pages captured during prep. The numbers are also in the README "How we use Arc" table. |
| `streams:verify` (2:00) | It's slow, or the RPC errors | **F7:** show `docs/evidence/phase-2/qe/streams-verify.txt` (same five hashes, `OK`) |
| The whole live flow | The hosted api or relayer is down | The independent QE run's stills `l01`–`l34` (`docs/evidence/phase-3/qe/screens/`) tell the full story, and `pnpm --filter @vouch/scripts story:api` reproduces it against any api. Say on screen: "recorded earlier on the same deployment". |

**Honesty rules for the video:** every number on screen must come from the run being shown, or from the cited canonical tx. Don't claim AI attribution, risk flags, or an in-app "kill the backend" button. Self-submit is shown via its on-chain transaction only.
