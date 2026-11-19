# Submission checklist: Vouch (UBC 2026)

_Checked against `AGENTS/ORCHESTRATOR_PROMPT.md` §1, §6 Phase 6 and Amendment A7, by DOCS_SUBMISSION on 2026-11-18 (Wed, late night ET)._
**Deadline: Fri Nov 20, 1:00 PM ET (12:00 PM CST). Target: submit by 10:00 AM ET.**

Legend: ✅ done · 🟡 drafted, needs a human step or final check · 🟥 HUMAN only · ⬜ not started

## Required submission items (§1)

| # | Item | Status | Where it lives / what's left |
|---|---|---|---|
| 1 | Project name + short description | ✅ | `docs/submission/DEVPOST.md` → "Project name", "Tagline" |
| 2 | Written answer: *What did you build?* | ✅ | `DEVPOST.md` |
| 3 | Written answer: *What problem does it solve?* | ✅ | `DEVPOST.md` |
| 4 | Written answer: *How does it work?* | ✅ | `DEVPOST.md` |
| 5 | Written answer: *What makes it unique?* | ✅ | `DEVPOST.md` |
| 6 | Written answer: *What would you build next?* | ✅ | `DEVPOST.md` |
| 7 | Technologies used | ✅ | `DEVPOST.md` → "Built with" |
| 8 | **Public** GitHub repo with source + setup instructions | 🟥 | Repo `github.com/christiandiz0n/vouch` is **private**. Setup is in the README "Setup" section. **Human:** approve making it public on Friday (`gh repo edit christiandiz0n/vouch --visibility public --accept-visibility-change-consequences`), then open it logged out to confirm. Commit and push all docs first. |
| 9 | Working demo / deployed app | ✅ | https://vouch-ubc.vercel.app (web) + https://api-production-902bc54c.up.railway.app (api). Both answered 200 on 2026-11-18, `/health` db=postgres. The Phase 3 gate PASSED with a live two-device story. **Human:** the 32-step real-phone checklist (`docs/qa/phase-3-phone-checklist.md`) is still pending. |
| 10 | **2–3 minute demo video** (YouTube or Drive, accessible to judges) | 🟥 | Script + shot list + captions + fallbacks: `docs/submission/VIDEO_SCRIPT.md`. **Human:** record and upload (YouTube unlisted, or Drive "anyone with the link"), check it plays in a logged-out browser, then replace `<VIDEO_URL>` in `README.md` and `DEVPOST.md`. |
| 11 | README with technical documentation / architecture overview | ✅ | `README.md`: Mermaid architecture, how it works, contract design + invariants, attribution, security + limits, setup, env names, future work |
| 12 | Contract address(es) in the README | ✅ | README → "Contract addresses" (v3 `0xF4B6…f08e`, USDC, relayer, retired v1/v2) with explorer links |
| 13 | Streams configuration in the README | ✅ | README → "QuickNode Streams": network, dataset, range, filter code, destination, security, why, idempotency, replay proof, latency |

## Track / award / bounty requirements

| # | Requirement | Status | Where |
|---|---|---|---|
| 14 | Consumer Apps: interacts with the blockchain + a user-facing frontend | ✅ | Live web app; every payment is an Arc transaction |
| 15 | Consumer Apps: hides crypto complexity (no seed phrases, gas or bridging) | ✅ | Face ID onboarding, dollars only; QE copy audit: 0 banned words on 65 screens (`docs/qa/phase-3-qe-gate.md`) |
| 16 | Arc: core on-chain functionality on Arc | ✅ | `Vouch.sol` on Arc Testnet; README "How we use Arc" |
| 17 | Arc: contract addresses + explanation of Arc usage in the README | ✅ | README; measured gas: 375,553 gas = 0.0085626 USDC for the canonical split |
| 18 | Streams: at least one Stream with a filter and a destination (webhook) | ✅ | `vouch-v3-production` (`6b792277-…df8`), Logs + JS filter → HMAC webhook on Railway |
| 19 | Streams is a **core** data source | ✅ | "Settled" and every derived view come only from Streams (D-803, D-904); README section |
| 20 | Streams: README explains network, dataset, filter logic, destination, why | ✅ | README table + filter code + "Why Streams" |
| 21 | Opt into the Arc award and QuickNode bounty on Devpost | 🟥 | **Human:** tick Consumer Applications, Best use of Arc and QuickNode Streams in the Devpost form (`DEVPOST.md` → "Track, award and bounty selections") |

## Phase 6 extras (§6)

| # | Item | Status | Where |
|---|---|---|---|
| 22 | Screenshots in the README | ✅ | 4 images from `docs/evidence/phase-3/qe/screens/` (l05, l20, l23, l28) |
| 23 | Measured costs | ✅ | README "How we use Arc" (3 receipts, re-read with `cast receipt`) |
| 24 | Attribution method + eval results | 🟡 | The baseline method is documented. **The eval harness was CUT (A7)**, so there are no eval results. The README says so plainly. |
| 25 | Env var table | ✅ | README (names only, from `.env.example`) |
| 26 | "Prototype, not legal advice" | ✅ | README top + bottom, `PITCH.md` Q&A |
| 27 | 5-minute pitch outline + Q&A | ✅ | `docs/submission/PITCH.md` (finalists pitch Sat Nov 21) |
| 28 | Cut features stated plainly | ✅ | README "What was cut" |

## Human steps, in order (Friday morning)

1. 🟥 **Resume the Stream** before any rehearsal or recording ("Continue where it left off"). Pause it again afterwards if credits matter.
2. 🟥 Run the real-phone checklist on https://vouch-ubc.vercel.app (`docs/qa/phase-3-phone-checklist.md`).
3. 🟥 Record the video from `VIDEO_SCRIPT.md` and upload it. Paste the URL into `README.md` and `DEVPOST.md` (search for `<VIDEO_URL>`).
4. 🟥 Decide the author line: replace `<AUTHOR_NAME>` in `DEVPOST.md` (README currently says "Built solo", with no name).
5. 🟥 Approve **making the repo public**, after the final secret scan by the Orchestrator. Then open the README on GitHub logged out and check that the images and Mermaid render.
6. 🟥 Submit on Devpost: paste the fields from `DEVPOST.md`, add the links, tick the three tracks, upload a cover image (e.g. `l28-venue-dashboard-owner-1280.png`), and submit **by 10:00 AM ET** (hard deadline 1:00 PM ET).
7. Keep the Stream, Railway and Vercel running until judging is over.

## Pre-submit verification (Orchestrator / QE)

- [ ] `git grep` secret scan on HEAD (no private keys, no `.env*`, no keyed RPC URLs). The README and docs contain only public addresses.
- [ ] README links resolve on GitHub (relative image paths, `docs/streams/filter-vouch.js`, `infra/streams/stream-vouch-prod.json`, `docs/qa/*`).
- [ ] The Mermaid block renders on GitHub. It was reviewed by hand but not machine-rendered: `npx @mermaid-js/mermaid-cli` was blocked in this session.
- [ ] Spot-check the README numbers against the chain (`cast receipt` of the three txs in the Arc table).
- [ ] The video is ≤ 3:00 (target ≤ 2:30) and viewable logged out.
