# Recording kit (source of truth for the video)

_For the human, Fri 2026-11-20. Times are CST._
_Target ≤ 2:30. Hard max 3:00._
_Works with either UI (current or re-skin)._

A clean screen recording with your voice over it is enough. No editing tricks needed.

---

## 1. What you need

- Mac (laptop) + charger
- Your iPhone + Lightning/USB-C cable
- The repo open in Terminal
- About 30 minutes: 15 setup, 10 dry run, 5 take

---

## 2. Setup: the stage chain is scripted

The venue for the live part is **"Lena's Corner"**.
- Owner: "Lena". Reward: 20%.
- Already set up: Priya → recommended Ana → Ana made a link for Ben.

### 2a. Run the stage script (laptop)

First, a quick check that opens no windows and spends nothing. It should end with READY:

```
node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --verify
```

Then, from the repo root:

```
node e2e/phase5/p4-stage.mjs --base https://vouch-ubc.vercel.app --present
```

It opens 3 windows on the laptop:

| Window | What it shows |
|---|---|
| W1 | Lena's Corner owner. Tab 1: dashboard + money graph. Tab 2: the **counter** keypad (you key the order here) |
| W2 | Ana's wallet, phone size (her "just arrived" toast shows here) |
| W3 | A big QR code of Ana's link, for Ben |

It also prints:
- Ben's link (Ana's recommendation link; tonight's is https://vouch-ubc.vercel.app/i/4gh0y7xmW)
- The projector URL

The windows stay open until you press **Ctrl+C** in the terminal.
W1 is already 1440×900.

If the saved stage is missing, broken, or already used (Ben paid), it rebuilds the chain by itself first:
Priya pays $1 → recommends Ana → Ana pays $2 → Ana makes Ben's link.
The rebuild funds Priya and Ana from the deployer wallet (about $6 of testnet USDC). Wait for "STAGE READY".

Ben's link is a **personal** link: it works for one person only. Once your Ben saves it, it's used.

_If the script fails, see F0 in section 7._

### 2b. Ben = your iPhone (before recording)

1. Ben must be a **fresh** account. If Safari on your iPhone already has a Vouch account from earlier tests, clear it:
   Settings → Apps → Safari → Advanced → Website Data → search "vercel" → delete vouch-ubc.vercel.app.
   (This removes the old test account from that phone. It's testnet only.)
   Don't use a Private tab: Ben's wallet would vanish when the tab closes.
2. Point the iPhone camera at **W3**. Tap the banner. It opens Safari.
   - Camera won't read it? Type or AirDrop Ben's link from the terminal into Safari instead.
3. Sign up as **Ben**: "Continue with Face ID or fingerprint".
4. Tap **"Save Ana's recommendation"**.
5. Go to the wallet. Tap **"Top up (testnet demo)"**. Wait until it shows **$3.00**.
6. Do **not** pay yet. That's the live moment.
7. On the pay screen, wait until the "Who sent you here?" chip shows **Ana** (it says "A friend" for a moment while it loads) before tapping it.

### 2c. Window layout (laptop)

- W1 big, on the left half or more.
- W2 (Ana) on the right.
- QuickTime window with your iPhone (section 4) next to W2.
- Hide W3 after Ben has saved the link (minimize it).

### 2d. Expected live numbers

Ben pays **$2.00** at Lena's Corner (20%):

| Who | Gets |
|---|---|
| Ben (money back) | $0.10 |
| Ana (sent Ben) | $0.22 |
| Priya (brought Ana in) | $0.08 |
| Lena's Corner | $1.60 |
| Total | $2.00 |

Math: pool = 20% × $2.00 = $0.40. Ben 25% = $0.10. Ana 55% = $0.22. Priya 20% = $0.08. Venue gets the rest.

If the screen shows other numbers, say the numbers on screen. Never say numbers that didn't happen.

Name rule: say **"Lena's Corner"** in the live part. Say **"Lena's café"** only over the seeded dashboard shot.

---

## 3. The script (about 2:25)

Device key: **L** = laptop, **P** = iPhone (mirrored on the laptop).

| Time | Say this | On screen | Dev |
|---|---|---|---|
| 0:00–0:12 | "Lena runs a café. She pays for ads she can't measure. Her best customers come from friends who recommend her, and those friends get nothing for it." | W1: Lena's Corner dashboard | L |
| 0:12–0:24 | "Vouch fixes that. Ana has bought here, so she's allowed to recommend it. She sent her friend Ben a link, and Ben saved it." | W3 QR (or W2 Ana's wallet), then Ben's wallet on the iPhone | L → P |
| 0:24–0:34 | "Ben walks in. Lena keys in his order, two dollars, and shows a code." | W1 **tab 2 (counter)**: type 2.00 → "Show code" | L |
| 0:34–0:52 | "Ben scans it. He sees the price, the money he gets back, and who sent him. One Face ID. No wallet setup, no fees." | iPhone camera → pay screen ("You'll get $0.10 back", "Who sent you here?" → Ana) → "Confirm with Face ID or fingerprint" | P |
| 0:52–1:08 | "A second or two later, it's settled. Ben got ten cents back. Ana got twenty-two cents. Priya, who brought Ana in, got eight cents. Lena's Corner kept a dollar sixty." | iPhone success screen; W2 Ana's "just arrived" toast; W1 order shows paid | P + L |
| 1:08–1:18 | "Lena's dashboard shows where the money went and what each new customer cost her. She only pays when a recommended customer actually buys." | W1 **tab 1**: dashboard, money graph | L |
| 1:18–1:36 | "Here's a demo café with more customers: Lena's café. This is Ben's twelve-dollar order. Switch to Everyone, and you see every recommendation that brought someone in." | Lena's café dashboard (seeded). Point at "Ben paid $12.00" in Payments. Then click "Everyone". | L |
| 1:36–1:54 | "That twelve dollars is one transaction on Arc. Twelve in, six payouts out, to the exact cent. The café can't skip the people who sent the customer. The network fee was about one cent, paid in USDC by our relayer." | Explorer: tx 0x83214e73…, token transfers list | L |
| 1:54–2:04 | "The rules are public. Terms freeze when a link is shared, rewards are capped by the venue's rate, and each customer earns a reward only once per venue." | /transparency page, scroll slowly | L |
| 2:04–2:16 | "Every screen is built from a QuickNode Stream. It filters our contract's events on Arc and pushes them to our webhook. A payment only shows as paid once the Stream delivers it." | GitHub README, "QuickNode Streams" section (table + filter) | L |
| 2:16–2:26 | "Vouch. Word of mouth that pays, the moment it works." | iPhone success screen or the app's home page, plus the URL vouch-ubc.vercel.app | L |

Running long? Cut in this order:
1. The transparency shot (1:54–2:04).
2. Shorten the opening line.

Fact notes (so you can say them with confidence):
- The $12.00 tx `0x83214e73…`: 12.00 in; 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 out; six different people/addresses. Fee 494,313 gas × 25 gwei = 0.0124 USDC ("about one cent"). Don't say "less than a cent" for this tx.
- "Less than a cent" is true only for the other canonical tx `0x40147554…` (fee 0.0086 USDC). We don't show it in the video.
- "Pushed in about 0.15 s" is measured (README Streams section). It's fine to say, but not needed.

---

## 4. Capture setup (one person)

### Recommended: one recording of the whole Mac screen

1. Plug the iPhone into the Mac. Unlock it. Tap "Trust" if asked.
2. Open **QuickTime Player** → File → **New Movie Recording**.
3. Click the small arrow next to the red button.
   - Camera: **your iPhone**.
   - Microphone: leave it, then drag the QuickTime volume slider to **zero** (no echo).
4. Your iPhone screen now shows in a window. Don't press record in QuickTime.
5. Arrange: W1, W2, the iPhone window. Explorer, transparency and README tabs ready (section 5).
6. Press **Cmd+Shift+5**.
   - Pick "Record Entire Screen" (simplest) or "Record Selected Portion".
   - Options → Microphone → **MacBook microphone** (built-in).
   - Options → Show Mouse Clicks: on (helps viewers).
7. Click **Record**. Talk as you go.
8. Stop: the stop button in the menu bar, or Cmd+Ctrl+Esc.

Voiceover: record it live in the same take. That's the simplest. If a line goes wrong, pause 2 seconds and say it again; trim later.

### Alternative: two recordings

- iPhone: Control Center → Screen Recording.
- Mac: Cmd+Shift+5 as above.
- Join both in iMovie, side by side. Takes longer. Only if QuickTime mirroring fails.
- Check in the dry run that the Face ID sheet shows up in the iPhone recording.

---

## 5. URLs in order

| # | Shot | URL / where | Dev |
|---|---|---|---|
| 1 | Lena's Corner dashboard | W1 (opened by the script) | L |
| 2 | Ana's link QR | W3 | L |
| 3 | Ben's wallet | https://vouch-ubc.vercel.app/wallet | P |
| 4 | Counter QR | W1 tab 2 (counter) → 2.00 → "Show code" | L |
| 5 | Pay screen | opens from the iPhone camera scan | P |
| 6 | Ana's toast | W2 | L |
| 7 | Seeded Lena's café dashboard | https://vouch-ubc.vercel.app/venue/0x9a40C2b1Da073Fea51A63B92f868A78969c56289 | L |
| 8 | Explorer, the $12.00 tx | https://explorer.testnet.arc.io/tx/0x83214e735269dc32850d18381fb229e8406fdbd5ea0ee4b9f85c1a73f071f980?tab=token_transfers | L |
| 9 | Transparency | https://vouch-ubc.vercel.app/transparency | L |
| 10 | README Streams section | https://github.com/christiandiz0n/vouch#quicknode-streams | L |
| 11 | Close | https://vouch-ubc.vercel.app | L or P |

Shot 7 needs a signed-in browser (any account).
- Easiest: after the live part, paste the URL into **W1's** address bar. W1 is already signed in.
- Or use your normal Mac browser, signed in on vouch-ubc.vercel.app.
- The "Ben paid $12.00" row is visible without scrolling at a 1440×900 window. At 1280×720 it needs a small scroll in Payments.

Shots 8–10: open them as tabs in your normal Mac browser before you start.

---

## 6. Pre-recording checklist

Tick each one.

1. [ ] Browser zoom 100% (Cmd+0) in every window.
2. [ ] Dashboard window at least 1440×900.
3. [ ] Mac: Focus / Do Not Disturb ON.
4. [ ] iPhone: Focus / Do Not Disturb ON.
5. [ ] Notifications off (Slack, Messages, Mail closed).
6. [ ] Close other tabs. Hide the bookmarks bar (Cmd+Shift+B).
7. [ ] Mac on charger. iPhone above 50%.
8. [ ] **Stream is ON.** Check: the stage script's last payment shows as paid (not "Arriving"). Or ask the Orchestrator to confirm a fresh settle.
9. [ ] `--present` windows open, W1 and W2 signed in.
10. [ ] Ben on the iPhone: Ana's recommendation saved, balance $3.00.
11. [ ] Explorer, transparency and README tabs loaded.
12. [ ] **Dry run** everything once, but stop before Ben's final Face ID tap. Ben gets the first-purchase reward only once, so the real payment happens in the take.
13. [ ] QuickTime volume at zero. Mic test: record 5 s with Cmd+Shift+5 and play it back.

---

## 7. If something breaks (fallbacks)

| Problem | Do this |
|---|---|
| F0: stage script missing or fails | Build the chain by hand: VIDEO_SCRIPT.md prep step P4 (three browser profiles, each topped up). Or ask the Orchestrator. |
| iPhone camera won't read W3 or the counter QR | Tap/open the link instead: send Ben's link to the iPhone (AirDrop / Messages). For the counter, copy the pay link from W1 if shown, or retry the scan closer. |
| "Not enough money yet" on the pay screen | Tap "Top up (testnet demo)" on that screen. Wait 2–20 s. Top-up is $3, once per account, from a shared daily pool ($21 left on Thu night). |
| Stays "Arriving" for more than 5 s | The Stream is paused or lagging. The payment is already on chain. Resume the Stream in the QuickNode dashboard ("Continue where it left off"); it then turns paid. Keep recording or redo that part. |
| W1/W2 show a sign-in screen | Ctrl+C and re-run the `--present` command; it rebuilds if needed. |
| Counter code expired | On W1 tab 2, key the amount again and press "Show code". |
| Ana's toast doesn't show | Reload W2. Her balance and activity still show the $0.22. |
| Money graph doesn't animate | Toggle Latest / Everyone, or reload. |
| Explorer slow or down | Show the README "How we use Arc" table instead. |
| Live part fails completely | Use stills: `docs/evidence/phase-3/qe/screens/` (l01–l34, the same flow on the deployed app) and `docs/evidence/phase-5/prod/`. Say: "recorded earlier on the same deployment". |

Need a second take of the payment? Ben gets a reward only once, and Ana's link is single-use. So:
1. Ctrl+C the script, then run the `--present` command again. It sees Ben has paid and builds a fresh stage (new Lena's Corner, new link). This takes a few minutes and about $6 of deployer testnet USDC.
2. Clear Safari's website data on the iPhone again (step 2b.1) and redo 2b with the new link.

---

## 8. Record, trim, upload

1. Record with Cmd+Shift+5 (section 4).
2. The file lands on the Desktop. Open it in **QuickTime Player**.
3. Trim: Edit → Trim (**Cmd+T**). Drag the yellow handles. Click Trim.
4. Export: File → Export As → **1080p**.
5. Check the length: **≤ 2:30** target, never over 3:00.
6. Upload to YouTube:
   - youtube.com → **Create** (camera icon) → **Upload video** → pick the file.
   - Title: "Vouch: word of mouth that pays (UBC 2026)".
   - Audience: "No, it's not made for kids".
   - Visibility: **Unlisted** → Save.
   - Copy the link.
7. Or Google Drive: upload → right-click → Share → General access: **"Anyone with the link"** → Copy link.
8. Open the link in a **private window** (signed out). It must play.
9. Paste the link where `<VIDEO_URL>` appears:
   - `README.md`
   - `docs/submission/DEVPOST.md`
   - the Devpost form (see `SUBMIT_STEPS.md`)
