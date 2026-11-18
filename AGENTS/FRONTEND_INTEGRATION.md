# FRONTEND_INTEGRATION
_Last updated: 2026-11-18T13:30:00-05:00 by FRONTEND_INTEGRATION (session 3, Phase 3 + visual Phase 4 wiring)_

## Mission
Owns wiring the web app: auth/passkey onboarding and embedded wallet, EIP-712 signing in the client, QR display (venue) and camera scan (customer), API calls, SSE live updates (pending → settled), state management, error states. Does NOT do visual redesign — requests changes from UI_DESIGN.

## Owned paths
- `apps/web/src/app/` route files (except `app/design/`)
- `apps/web/src/lib/`, `apps/web/src/hooks/`, `apps/web/src/state/`
- `apps/web/scripts/phase3-*`, `apps/web/next.config.*`, `apps/web/package.json` (small deps)

## Current status
🟢 Milestones A–E done on the hosted api + shared dev server :3100. Customer spine, venue spine, referral loop and transparency are live; the error states are wired; evidence is in `docs/evidence/phase-3/`.
- **D-811 is live (MSG-108)** and verified in-app: the demo top-up from the pay sheet funded a fresh wallet in 2.9 s (`0x515cc6b8…a3f9`), and that wallet's pay `0x48b6322e…166b` settled +0.96 s via SSE.
- `pnpm --filter web build` passes, typecheck is clean, and lint is clean for my files.

## Mental model (read this first)
```
 browser (one account per device)                                     hosted api (Railway)
 ┌───────────────────────────────────────┐
 │ lib/wallet.ts  D-104 passkey wallet   │  secp256k1 key, AES-GCM encrypted in IndexedDB
 │   prf:   key = HKDF(WebAuthn PRF)     │  ← preferred (needs Face ID / fingerprint to decrypt)
 │   gated: non-extractable AES key +    │  ← fallback when PRF is unavailable
 │          passkey assertion first      │
 │   getSigner({fresh}) → viem account   │  cached 5 min in memory; payments/intros always fresh
 ├───────────────────────────────────────┤
 │ lib/auth.ts  challenge → personal_sign → verify → state/session.ts (Bearer token in localStorage)
 │ lib/api.ts   typed client + ApiError(code) → friendlyError (COPY.md tone)       ──► REST
 │ lib/sign.ts  typedData JSON → BigInt uints → signTypedData;                      
 │              assertSafePaymentTypedData: from=me, to=Vouch, value=amount,        
 │              submitter = RELAYER (never 0 / never me), nonce = hash(PaymentAuth) 
 │ hooks/useLiveEvents  EventSource /events/user/:addr?token= | /events/venue/:v   ◄── SSE
 └───────────────────────────────────────┘
 pay:   order(public) → quote → [guard] → Face ID → sign RWA → POST /payments (202 = "pending", optimistic)
        → "settled" ONLY from Streams: user SSE payment.settled (orderId match) | poll GET /payments/:id
 venue: counter POST orders (ttl 120 s, auto-renew 4 s before expiry ×5) → QR = <this origin>/pay?v=&o=
        → processing on payment.pending, paid on payment.settled (venue SSE) | poll GET order
```
- **Routes are client-only.** Every `page.tsx` is `<ClientPage>` (Suspense + `use(browser())`, Next 16 + cacheComponents), so the server renders a skeleton and the screen renders in the browser (keys, session and IndexedDB live there).
- **`AccountGate`** wraps signed-in routes. It onboards in place (a scanned `/pay` link or a friend's `/i/<code>` keeps its context), unlocks an existing device account ("Welcome back"), then renders children with `{address, name}`.
- **Screens are props-only** (UI_DESIGN). Routes only adapt API JSON → props (`lib/views.ts`). Primary screens never show addresses: names come from `/ambassadors/:addr` displayName (`lib/names.ts`), with "A friend" as the fallback.
- **QR / share links use the page's own origin** (`webOrigin()`, overridable by `NEXT_PUBLIC_WEB_URL`), not the API's `PUBLIC_WEB_URL`. Same `/pay?v=&o=` shape as `qrPayload`, so the phone's native camera opens the pay sheet on whatever host the counter runs (D-901).

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `src/lib/config.ts` | `API_URL` (NEXT_PUBLIC_API_URL, default Railway), `FLAGS` (auto/on/off), `webOrigin()` | public values only |
| `src/lib/wallet.ts` | D-104 wallet: create/unlock/lock/delete, PRF → HKDF → AES-GCM, gated + device fallbacks | `WalletError` codes: CANCELLED, NOT_SUPPORTED, … |
| `src/lib/auth.ts` | signIn / createAccount / ensureSession / logout / forgetDevice | D-802 |
| `src/lib/api.ts` | typed endpoints, `ApiError`, `friendlyError`, `waitRelay`, `money()` | shapes from apps/api routes + MSG-088 |
| `src/lib/sign.ts` | `toViemTypedData`, `signTypedDataJson`, `assertSafePaymentTypedData` | MSG-041/057, D-014 |
| `src/lib/views.ts` | quote/settled → SplitPart[], activity → ActivityItem[], payments → VenuePaymentItem + MoneyFlow | |
| `src/lib/names.ts`, `qr.ts`, `topup.ts`, `timings.ts`, `venueStore.ts`, `nav.ts` | names cache, scan parser, demo top-up, evidence timings, last venue, safe `next` | |
| `src/state/session.ts`, `state/wallet.ts` | session external store (useSyncExternalStore), device-wallet loader | |
| `src/hooks/useLiveEvents.ts`, `useToasts.tsx`, `useCountdown.ts` | SSE with reconnect/backoff + status, toast queue, countdown | |
| `src/app/_components/*` | `ClientPage`, `BrowserOnly`, `RouteLoading`, `AccountGate` (+`Onboarding`, unlock), `Record` | |
| `src/app/**/page.tsx` + `*Flow.tsx` | routes (table below) | |
| `scripts/phase3-e2e.ts` | live two/three-context run (venue, Ben, Cara) on :3100 + hosted api, CLI top-up | writes e2e-*.json + e2e/*.png |
| `scripts/phase3-shots.ts` | every route/state at 390×844 (+ interception-forced errors) | writes screens/*.png + index.json |

## Routes
| Route | Screen(s) | Data |
|---|---|---|
| `/` | SignInScreen (+ "I run a venue") → `/wallet` when signed in | `?next=` (safe relative only) |
| `/wallet` | WalletHomeScreen | /me/wallet, /me/activity, /ambassadors/me, /me/links (re-issue toast), user SSE, demo top-up |
| `/scan` | ScanScreen (jsQR, paste fallback) | → `/pay?…` or `/i/<code>` |
| `/pay?v=&o=` | PayConfirmSheet → PaymentSuccessScreen(pending→settled) | order, venue, quote, pay, user SSE + polling |
| `/recommend?venue=` | RecommendScreen (locked if not verified) | /intros/prepare → sign → /intros, share/copy |
| `/i/[code]` | SignInScreen(invite) → IntroLandingScreen(state) | /intros/:code, opens, accept/prepare → sign → accept, user SSE |
| `/me`, `/a/[address]` | AmbassadorScreen (owner / visitor) | /ambassadors/:addr |
| `/venue` | → `/venue/<v>` or `/venue/new` | /auth/session venues |
| `/venue/new` | VenueOnboardingScreen(status) | /venues/prepare → sign → /venues → venue.registered / poll |
| `/venue/[venue]` | VenueDashboardScreen (phone; projector ≥1024 px) | stats + edges, /venues/:v/payments (flag) or owner /orders, venue SSE |
| `/venue/[venue]/counter` | OrderEntryScreen → OrderQRScreen | /orders (ttl 120 s), venue SSE + order polling |
| `/transparency[?venue=]` | TransparencyScreen | VOUCH_ARC_TESTNET + venue terms |
| `/spike/*` | untouched S6 spikes | |

## Interfaces consumed / provided
- Consumes INTERFACES §3 (typed data; never `submitter = 0`) and §5 (all endpoints + SSE), plus MSG-088 (D-811: `/demo/topup`, `/venues/:v/payments`, edge display names), feature-detected (404 → fallback).
- Provides nothing to other roles. Proposed env (for `.env.example`, see report): `NEXT_PUBLIC_API_URL=https://api-production-902bc54c.up.railway.app`, optional `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_FLAG_DEMO_TOPUP`, `NEXT_PUBLIC_FLAG_VENUE_PAYMENTS` (auto|on|off).

## Done (rolling, newest first)
- 2026-11-18 — **Phase 3 wiring.**
  - **A:** customer spine with the D-104 wallet, sign-in, pay with guard, pending → settled. First live run: pay `0xb72fedff…3594`, settled via SSE 1.19 s after the 202.
  - **B:** venue onboarding, counter with auto-renewing QR and processing/paid, dashboard (stats, history, money graph, cost vs ad, projector layout).
  - **C:** recommend/share, intro landing with every state, records, wallet activity, demo top-up behind a flag.
  - **D:** transparency page and landing.
  - **E:** `phase3-e2e.ts` + `phase3-shots.ts` (60 PNGs).
  - **Final evidence run** (`docs/evidence/phase-3/e2e-2026-11-18T18-21-31-010Z.json`):
    - venue `0xC6CF…319c`, registered in 1.9 s;
    - Ben $0.50: pay `0x6ad99748364d3a7feb41823dbb37c58b1fdd3369b2de1b90b6913a0719f65be8`, relay 0.49 s, settled +0.77 s via SSE, venue "paid" 3.8 s after the tap;
    - Cara accepted Ben's personal link in 1.9 s, then paid $0.50: `0xc898e244377b341b47fe126e0c6ebbbc2f5526915f58b51fb06342de8d86695f`, relay 0.62 s, settled +0.88 s (venue $0.44, Cara +$0.02, Ben +$0.04).
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] If the Stream was paused during the last shots run (MSG-114), re-run `phase3-shots.ts` once it is resumed so the dashboard numbers are live.
- [ ] Apply UI follow-ups once they land: success `noReward` copy, the D-509 below-minimum warning, a pay backdrop (MSG-100/101).
- [ ] Vercel (Thursday): set `NEXT_PUBLIC_API_URL`; add the Vercel origin to Railway `CORS_ORIGINS`; check passkeys on the real domain (rpId = host).
- [ ] Phone run on real Face ID / fingerprint (the virtual authenticator proves the code path, not the platform UX).

## Struggles, open questions, known issues
- **Accounts are per device (D-104).** "I already have an account" works only where the account was created; elsewhere it explains that. No recovery or export (Tier 1 scope).
- **Token storage.** The Bearer token lives in localStorage, so XSS could read it. The private key never does: it is decrypted only in memory after a gesture. The token appears in the SSE URL by design (D-809); the API redacts it in logs.
- **Without the feed endpoint**, the dashboard history comes from the owner's own `GET /venues/:v/orders` settled rows. A non-owner sees stats + edges but an empty "Latest" graph (no venue flow). This resolves itself when `/venues/:v/payments` deploys.
- **Streams paused/lagging:** payments correctly stay "Arriving" (pending). Venue onboarding continues to the dashboard 15 s after the registerVenue relay is mined even without `venue.registered` (D-906).
- **Dev StrictMode** double-runs effects, so `/pay` creates two quote intents in dev (harmless; production makes one).
- **Phones can't reach `localhost:3100`**, and Railway CORS allows only that origin. A phone test needs a tunnel origin added to `CORS_ORIGINS` (human/Orchestrator), or Thursday's Vercel deploy.
- **Display names are not unique.** "Who sent you here?" chips map by address id, so two "Ana"s are still distinct.

## How to run / test this area
```bash
# shared dev server is the Orchestrator's (http://localhost:3100) — never start another
pnpm --filter web typecheck && pnpm --filter web lint
node --no-warnings apps/web/scripts/phase3-e2e.ts            # live: venue + Ben (in-app $3 demo top-up) + Cara (CLI $0.55); --fund-mode cli, --no-referral

node --no-warnings apps/web/scripts/phase3-shots.ts          # every route/state → docs/evidence/phase-3/screens/
# fund a test wallet by hand:
pnpm --filter @vouch/scripts topup --to 0x<addr> --target 1.00 --max-total 5
```

### Manual two-device runbook (venue tab + customer tab)
1. Two separate browser profiles on the laptop (e.g. Chrome normal + Chrome guest, or Chrome + Safari). Each has its own IndexedDB, so each is one "device". Use Touch ID / the platform passkey when prompted.
2. **Venue:** open `http://localhost:3100/venue` → first name "Lena" → Continue with Face ID → name + reward + minimum ($0.50) → Confirm. The dashboard opens after ~2 s (venue.registered via Streams).
3. **Venue:** Take an order → key `0.50` → Show code. The QR shows a draining ring and auto-renews.
4. **Customer:** open the QR's URL (or `/scan` and point the webcam at the code; the `data-qr-payload` attribute has the URL) → first name "Ben" → Continue. The sheet says "Not enough money yet". Fund it: `pnpm --filter @vouch/scripts topup --to <address from localStorage vouch.session.v1> --target 0.55`. Reload, or press Top up once D-811 is live.
5. **Customer:** Confirm with Face ID → "Arriving" (pending) → green check (settled). **Venue:** the QR flips to Paid. Expect ~1 s relay, ~1 s to settled, ~4 s to the venue screen.
6. **Referral:** Ben → Recommend → Make my link → copy. Third profile "Cara" opens the link → Save Ben's recommendation. Venue makes a new $0.50 code → Cara pays. The receipt shows Ben thanked; Ben's wallet gets "+$0.04 just arrived"; the dashboard graph animates Cara → Ben.
7. Record the tx hashes from each receipt's Details (or `window.__vouchTimings` / sessionStorage `vouch.timings`).

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md` (§3, §5), `AGENTS/DECISIONS.md` (D-104, D-801..D-811, D-901..D-905), and your phase section in `AGENTS/PHASE_LOG.md` before working. Next.js here is 16 with `cacheComponents`: read `node_modules/next/dist/docs/` before touching routing. Keep screens props-only; ask UI_DESIGN (customer vs venue instance, D-019 #2) for visual changes. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/FRONTEND_INTEGRATION.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
