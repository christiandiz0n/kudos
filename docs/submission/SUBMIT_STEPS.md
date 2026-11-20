# Submitting on Devpost, click by click

_For the human, Fri 2026-11-20. Times are CST. Target: submitted by **10:00 AM**. Hard deadline: **12:00 PM**._
_Paste-able text lives in [`DEVPOST.md`](DEVPOST.md) (Field 1 to Field 10)._

Devpost's form layout changes between hackathons. Steps marked **(check)** are what Devpost usually shows; if your screen differs, match by the field's name, not its position. Don't guess custom questions: use the "if the form asks X" table in step 6.

---

## Before you start (about 5 minutes)

1. The video is uploaded and plays in a private window (see `RECORDING_KIT.md` §8).
2. `<VIDEO_URL>` is replaced in `README.md` and `docs/submission/DEVPOST.md` (the author line, Christian Dizon, is already filled in). Ask the Orchestrator to commit and push.
3. The repo is public. (It answered as **public** at 00:45 CST, checked with `gh repo view`.) Open https://github.com/christiandiz0n/vouch in a private window: the README must show.
4. Have `DEVPOST.md` open on GitHub (Raw view for Field 7) on the laptop.
5. Have the image files ready on the laptop (Field 6 table).

---

## Steps

1. Go to https://devpost.com and **Log in**.
2. Open the hackathon page: Devpost top bar → your profile → **My hackathons** (check) → **UBC 2026 Hackathon**. Or use the link from the organizers' email/Discord.
3. Click **"Enter a submission"**. If you already started one, click **"Manage project"** / **"Edit project"** (check) instead.
4. **Project overview** page (check):
   - **Project name** → paste Field 1 (`Vouch`).
   - **Elevator pitch** → paste Field 2 (161 characters, under the 200 limit).
   - Click **Save & continue**.
5. **Project details** page (check):
   - **About the project** → paste Field 7 (copy it from the Raw view so the headings stay).
   - **Built with** → type the Field 3 tags one by one. Pick Devpost's suggestion when it shows one; otherwise press Enter to add it as typed.
   - **"Try it out" links** → add each Field 4 link. Use "Add another link" for each one. The first two (app, GitHub) matter most.
   - **Image gallery** → upload the Field 6 files in order. The first one becomes the thumbnail. Add the captions if there is a caption box.
   - **Video demo link** → paste your video URL (Field 5).
   - Click **Save & continue**.
6. **Additional info** page (the hackathon's own questions; check each one):

   | If the form asks… | Paste / do |
   |---|---|
   | What did you build? | Field 8 row 1 (from Field 7) |
   | What problem does it solve? | Field 8 row 2 |
   | How does it work? | Field 8 row 3 |
   | What makes it unique? | Field 8 row 4 |
   | What would you build next? | Field 8 row 5 |
   | Technologies used | Field 3 |
   | GitHub / code repository URL | https://github.com/christiandiz0n/vouch |
   | Demo / deployed app URL | https://vouch-ubc.vercel.app |
   | Video URL | your video link |
   | Contract address | `0xF4B641dc628de05336aa983B07D5d181254ff08e` (Arc Testnet, chain 5042002) |
   | Stream ID or Streams details | `vouch-v3-production`, ID `6b792277-2c66-4c0c-a141-4d452cddfdf8`; details in the README "QuickNode Streams" section |
   | Why it qualifies for Arc / QuickNode | Field 9 justification text |
   | School / university | Rutgers University |
   | Team members | Solo (just you) |
   | Anything else not listed here | Skip it if optional. If required and unclear, ask the Orchestrator before you guess. |

7. **Prizes / tracks** (often a list of checkboxes on the same page or the next one, check). Tick exactly:
   - [ ] **Consumer Applications**
   - [ ] **Best use of Arc**
   - [ ] **QuickNode Streams**
   - Official UBC Winner is automatic; tick it only if it's listed as an option.
8. **Team**: make sure you're listed as the only member. Your Devpost profile name should match `Christian Dizon`.
9. **Submit** page (check):
   - Tick the required boxes (usually "I have read and agree to the official rules / terms and conditions").
   - Click **Submit project**.
10. Confirm it worked:
    - The project page should say it was **submitted** to UBC 2026 (check: a "Submitted to" line or a badge).
    - The hackathon's **My projects** / **Manage project** should show it as submitted, not draft.
    - Open the public project link in a private window. The video, images and links should show.
11. You can still **edit** the submission until the 12:00 PM deadline. Edits after submitting don't need a re-submit, but click Save.

---

## Final link check (private window, after pushing)

Open a private/incognito window (signed out of GitHub and Google). Check each one.

| # | Link | Expected |
|---|---|---|
| 1 | https://github.com/christiandiz0n/vouch | Repo page loads signed out, README shows |
| 2 | README images (scroll the README on GitHub) | 8 images load: 2 large dashboards, 3 phone shots, 3 payment-flow shots. No broken image icons |
| 3 | README "Architecture" section | A rendered diagram (boxes and arrows), not a code block or an error |
| 4 | README links to `docs/streams/filter-vouch.js` and `infra/streams/stream-vouch-prod.json` | Files open on GitHub |
| 5 | https://vouch-ubc.vercel.app | App home page loads |
| 6 | https://vouch-ubc.vercel.app/transparency | The "how payments split" page loads without signing in |
| 7 | https://api-production-902bc54c.up.railway.app/health | `{"ok":true,…,"db":{"kind":"postgres","ok":true}}` |
| 8 | https://explorer.testnet.arc.io/tx/0x83214e735269dc32850d18381fb229e8406fdbd5ea0ee4b9f85c1a73f071f980 | Success; token transfers 12.00 in, 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 out |
| 9 | https://explorer.testnet.arc.io/tx/0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb | Success; same six amounts out |
| 10 | https://explorer.testnet.arc.io/tx/0xfca0e1aeb40f9aa4e8564a60d0ac56817297956b2560d9db9bdc8823aa18c7be | Success; "From" is `0xb333…2344` (the customer, not the relayer) |
| 11 | https://explorer.testnet.arc.io/address/0xF4B641dc628de05336aa983B07D5d181254ff08e | Contract page, verified source |
| 12 | Your video link | Plays signed out, length ≤ 3:00 |
| 13 | The Devpost project page | Shows video, images, links; says submitted |

All of 5–11 were checked by DOCS_SUBMISSION at about 00:45 CST and returned 200 with the expected content. Items 2–3 can only be checked after the docs are pushed.

---

## If something is broken at 9:45

Submit first, fix after. Edits are allowed until 12:00 PM.

| Problem | What to do |
|---|---|
| Video still processing on YouTube | Submit with the link anyway; it works once processing ends. Recheck at 10:15. |
| Video upload failed | Upload to Google Drive instead ("Anyone with the link") and use that link. |
| No video at all yet | Submit everything else now (the form usually allows saving without it), then record a short take from `RECORDING_KIT.md` and add the link before 12:00. |
| README images broken | Ask the Orchestrator to check paths and push. Not a blocker for submitting. |
| Mermaid diagram doesn't render | Not a blocker. The Orchestrator can simplify it after you submit. |
| App or api down | Submit anyway. Tell the Orchestrator. The video and the explorer transactions still show it working. |
| Explorer down | Not a blocker. The README has the same numbers. |
| A Devpost field you don't understand | Leave optional ones empty. For required ones, ask the Orchestrator; don't guess. |
| Character limit hit on the pitch | Use the 147-character alternative in `DEVPOST.md` Field 2. |
| Devpost itself is down | Screenshot the error with the time, keep retrying, and contact the organizers through their official channel before 12:00. |
