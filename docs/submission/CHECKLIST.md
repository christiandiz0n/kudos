# Submission checklist: Kudos (UBC 2026)

_Updated Fri 2026-11-20 ~01:00 CST by DOCS_SUBMISSION, per Amendments A8 and A9. All times CST (Austin)._
**Hard deadline: Fri Nov 20, 12:00 PM CST. Target: submitted by 10:00 AM CST.**

Legend: ✅ done · 🟡 drafted, needs a human step or final check · 🟥 HUMAN only · ✂️ cut (A8)

Guides:
- Video: [`RECORDING_KIT.md`](RECORDING_KIT.md) (source of truth; `VIDEO_SCRIPT.md` is the archived draft)
- Devpost text: [`DEVPOST.md`](DEVPOST.md)
- Devpost clicks + final link check: [`SUBMIT_STEPS.md`](SUBMIT_STEPS.md)

## Required submission items

| # | Item | Status | Where / what's left |
|---|---|---|---|
| 1 | Project name + short description | ✅ | `DEVPOST.md` Fields 1–2 (pitch is 161 characters) |
| 2 | Answers: built / problem / how / unique / next | ✅ | `DEVPOST.md` Field 7, mapped in Field 8 |
| 3 | Technologies used | ✅ | `DEVPOST.md` Field 3 |
| 4 | **Public** GitHub repo with source + setup | 🟡 | `gh repo view` says **PUBLIC** (00:45 CST). **Orchestrator:** confirm this was the human's approved step and that the secret scan ran; push the final docs. Setup is in the README "Setup" section. |
| 5 | Working deployed app | ✅ | https://vouch-ubc.vercel.app + api `/health` ok, db=postgres (00:40 CST) |
| 6 | **2–3 min demo video**, viewable by judges | 🟥 | Record per `RECORDING_KIT.md`, upload Unlisted, replace `<VIDEO_URL>` in README + DEVPOST |
| 7 | README with architecture overview | ✅ | Mermaid diagram (render check pending, see below) |
| 8 | Contract address(es) in README | ✅ | v3 `0xF4B6…f08e` (runtime 23,998 bytes, Blockscout verified, re-checked 00:40 CST) |
| 9 | Streams configuration in README | ✅ | "QuickNode Streams" section; `infra/streams/stream-vouch-prod.json` name fixed to `vouch-v3-production` |
| 10 | Author line | ✅ | Christian Dizon, Rutgers University, built solo (README line 5, DEVPOST Field 10) |

## Tracks

| # | Requirement | Status | Where |
|---|---|---|---|
| 11 | Consumer Apps: on-chain + user-facing frontend, crypto hidden | ✅ | Face ID sign-up, dollars only; 0 banned words in the prod regression (`docs/qa/phase-5-prod-regression.md`) |
| 12 | Arc: core on-chain logic + addresses + explanation | ✅ | README "How we use Arc": 4 receipts re-read 2026-11-20 |
| 13 | Streams: filter + webhook, core data source, explained | ✅ | Stream `vouch-v3-production-2` (`e77ce7b6-…030a`; replaced `6b792277-…df8` on 2026-11-20) |
| 14 | Tick Consumer Applications, Best use of Arc, QuickNode Streams on Devpost | 🟥 | `SUBMIT_STEPS.md` step 7 |

## Demo readiness (A8 priority 2)

| # | Item | Status |
|---|---|---|
| 15 | P5-01: Ben's $12.00 visible on Lena's café projector feed | ✅ live on prod (visible at 1440×900; small scroll at 1280×720). Evidence `docs/evidence/phase-5/prod/p5-01/` |
| 16 | P4 stage chain (Lena's Corner, Priya → Ana → Ben) | 🟡 QE agent building `e2e/phase5/p4-stage.mjs` (not in the repo yet at 00:45). Manual fallback: `VIDEO_SCRIPT.md` P4 |
| 17 | 6-step core phone check (replaces the 32-step checklist) | 🟥 Human, on https://vouch-ubc.vercel.app. Steps below. |
| 18 | UI re-skin decision (A9) | 🟥 Human, ~02:30 CST. If shipped, the Orchestrator updates README screenshots. The kit and Devpost text work for either UI. |

**6-step core phone check** (iPhone, Safari, about 5 minutes; it doubles as the recording setup in `RECORDING_KIT.md` §2b):
1. Open a recommendation link (scan W3 or tap the link). The page names the friend and the venue.
2. Sign up with Face ID. The wallet shows in dollars.
3. Save the recommendation.
4. "Top up (testnet demo)" → balance $3.00.
5. Scan the counter QR. The pay screen shows the amount, the money back and "Who sent you here?".
6. Confirm with Face ID → it turns paid within a few seconds, and the dashboard and Ana's wallet update. (This step is the live take in the video.)

## Cut (A8): don't do these, and the docs don't claim them

- ✂️ Kill-the-backend demo. (Self-submit is still described as a capability, with its tx `0xfca0e1ae…`.)
- ✂️ Streams replay demo in the video. (The README keeps the `streams:verify` proof as a script you can run.)
- ✂️ The full 32-step phone checklist (replaced by the 6 steps above).
- ✂️ P5-02 and further polish.

## Human steps, in order (Friday, CST)

1. 🟥 ~02:30: decide on the UI re-skin (A9).
2. 🟥 Make sure the Stream is ON ("Continue where it left off" in the QuickNode dashboard). Keep it on through recording.
3. 🟥 Run the stage script and do the 6-step phone setup (`RECORDING_KIT.md` §2).
4. 🟥 Record, trim, upload (`RECORDING_KIT.md` §3–§8). Target done by ~09:00.
5. 🟥 Fill `<VIDEO_URL>`; the Orchestrator commits and pushes.
6. 🟥 Submit on Devpost (`SUBMIT_STEPS.md`) by **10:00**.
7. 🟥 Final private-window link check (`SUBMIT_STEPS.md`).
8. Keep the Stream, Railway and Vercel running until judging ends. After 06:00 only docs/copy changes or demo-breaking fixes, each verified on prod before and after (A8).

## Orchestrator checks before 10:00

- [ ] Secret scan on HEAD (no keys, no `.env*`, no keyed RPC URLs), since the repo is already public.
- [ ] Push the docs, then open the README on github.com in a private window: 8 images load, relative links work.
- [ ] **Mermaid renders on GitHub** (TODO comment in README "Architecture"; it was never machine-rendered).
- [ ] If the re-skin ships: new README screenshots and Devpost gallery files.
- [ ] Video ≤ 3:00 (target ≤ 2:30), plays signed out.
