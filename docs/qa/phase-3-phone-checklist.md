# Phase 3: real-phone checklist (human)

_Owner: QE_E2E. Written 2026-11-18. Production URL (final, D-020): https://vouch-ubc.vercel.app. Rehearse only on this URL; passkeys are bound to it._

## Before you start
- **Origin.** `https://vouch-ubc.vercel.app` must be listed in Railway `CORS_ORIGINS`. Passkeys are bound to the host name, so accounts made on `localhost:3100` or a tunnel won't work here.
  - Check: open `https://vouch-ubc.vercel.app/transparency` on the laptop. It should load with no "Payments are paused" banner.
- **Stream.** The QuickNode Stream must be **active**; otherwise payments stay "Arriving" forever. `curl -s https://api-production-902bc54c.up.railway.app/relayer/status` should show `"enabled":true`.
- **Devices:**
  - **Phone A (customer):** an iPhone with Face ID, Safari, iOS 17 or later. Use a fresh profile: Settings → Safari → Clear History and Website Data.
  - **Phone B (venue):** an Android phone with a fingerprint sensor (Chrome), or a laptop browser. A second phone is better.
  - **Optional phone C:** a friend, for the recommendation step.
- **Demo top-ups:** each new account may claim one $3 top-up. There is a global cap of $30 per 24 h, and other testers share it. If you get "used up for today", ask the Orchestrator for a CLI top-up.
- Keep orders small ($0.50 to $1.00).

Mark each box **P** (pass) or **F** (fail). For every F, add a note and a screenshot.

## 1. Venue setup (phone B)
| # | Step | Expected | P/F |
|---|---|---|---|
| 1.1 | Open `https://vouch-ubc.vercel.app/venue`. Type a first name and tap **Continue with Face ID or fingerprint**. | The OS biometric prompt appears (fingerprint or Face ID sheet), not a password box. After you confirm, "Set up your place" opens. | ☐ |
| 1.2 | Enter a venue name. Drag the reward slider to 20%. Set the minimum first order to $0.50. | The worked example updates as you drag (rewards, "Back to the customer", "You keep"). Nothing overlaps the minimum field: scroll if needed and note any overlap. No words like USDC, wallet, sign or blockchain appear. | ☐ |
| 1.3 | Tap **Confirm with Face ID or fingerprint**. | The biometric prompt appears again, then the dashboard opens within about 3 s (Stream active), or within 15–20 s if the Stream is slow. The dashboard shows the "Live" pill. | ☐ |
| 1.4 | **Take an order** → key in 1.00 → **Show code for $1.00**. | A big QR with a draining ring and a countdown starting near 2:00. | ☐ |

## 2. Scan with the phone's native camera (phone A)
| # | Step | Expected | P/F |
|---|---|---|---|
| 2.1 | Open the iOS **Camera** app (not Vouch) and point it at the venue QR. | A yellow link chip shows `https://vouch-ubc.vercel.app/pay?...`. Tapping it opens Safari on the Vouch pay screen with the venue name and $1.00. | ☐ |
| 2.2 | Type a first name and tap **Continue with Face ID or fingerprint**. | The Face ID prompt appears. No password or "save password" dialog. The account is created in place and you stay on the payment. | ☐ |
| 2.3 | The sheet says **Not enough money yet**. Tap **Top up (testnet demo)**. | Within about 5 s the sheet becomes **Confirm with Face ID or fingerprint**, "You pay $1.00. No fees." | ☐ |
| 2.4 | Tap **Confirm with Face ID or fingerprint**. Start a stopwatch at the tap. | The Face ID prompt appears. Then you see "Paying <venue>…" with a gray receipt marked "Arriving". | ☐ |
| 2.5 | Wait. | The green check "Paid at <venue>" appears within **5 s** of the tap. Record the time: ______ s. | ☐ |
| 2.6 | Look at phone B (the counter). | The QR flips to **Paid** within **5 s** of the tap. Record the time: ______ s. | ☐ |
| 2.7 | Phone B: tap back to the dashboard. | Payments shows "<name> paid $1.00"; the money graph and "Cost per new customer" are updated without a reload. | ☐ |

## 3. Scan with the in-app scanner (phone A)
| # | Step | Expected | P/F |
|---|---|---|---|
| 3.1 | Phone B: new order of $0.50 → show the code. Phone A: wallet → **Scan to pay**. | iOS asks for camera permission once. Allow it. A live viewfinder appears with corner guides. | ☐ |
| 3.2 | Point it at the QR. | It recognizes the code in under 2 s and opens the pay sheet for $0.50. The sheet should say this is a regular payment (no money back on a repeat visit). | ☐ |
| 3.3 | Close the sheet without paying. Then Settings → Safari → Camera → Deny, and open **Scan to pay** again. | "Camera is off for Vouch", with the two other ways to pay (camera app; type the short link). Nothing crashes. Re-allow the camera afterwards. | ☐ |
| 3.4 | Wait for the code on phone B to expire (2 min, or cancel it), then open the old link on phone A. | "This code has expired · Nothing was charged" → **Scan a new code**. | ☐ |

## 4. Recommendation loop (phones A and C)
| # | Step | Expected | P/F |
|---|---|---|---|
| 4.1 | Phone A: after paying, tap **Recommend <venue>** → **Make my link** → share it to phone C (Messages, WhatsApp). | The Face ID prompt appears. The share sheet opens with a `https://vouch-ubc.vercel.app/i/<code>` link. | ☐ |
| 4.2 | Phone C: open the link. | "<A's name> thinks you'll love <venue>" (or similar), with the onboarding inline. | ☐ |
| 4.3 | Phone C: create an account (Face ID or fingerprint) → **Save <A>'s recommendation**. | The biometric prompt appears, then "saved" within about 3 s. | ☐ |
| 4.4 | Phone C: wallet → **Top up (testnet demo)**. Phone B: new order of $1.00. Phone C: scan it. | The pay sheet shows money back, plus **Who sent you here?** with A's name and Skip. | ☐ |
| 4.5 | Phone C: pick A → confirm with Face ID or fingerprint. Keep phone A on its wallet screen. | Phone C turns green within 5 s, and the receipt names A as thanked. Phone A gets a "just arrived" toast within about 5 s. Phone B's money graph animates C → A. | ☐ |

## 5. Add to Home Screen
| # | Step | Expected | P/F |
|---|---|---|---|
| 5.1 | Phone A, Safari: Share → **Add to Home Screen**. | A Vouch icon and name are offered (not a blank screenshot icon). | ☐ |
| 5.2 | Open Vouch from the home-screen icon. | It opens the wallet. You are still signed in, or one Face ID prompt says "Welcome back". It is the same account and balance (the home-screen app shares Safari's storage on iOS 17+; if it doesn't, note it). | ☐ |
| 5.3 | Android (phone B), Chrome ⋮ → **Add to Home screen** / Install. | Same as 5.1–5.2. | ☐ |

## 6. Offline / airplane mode
| # | Step | Expected | P/F |
|---|---|---|---|
| 6.1 | Phone B: show a new code. Phone A: open the pay sheet. Then turn on **airplane mode** and tap **Confirm with Face ID or fingerprint**. | "You're offline · Connect to Wi-Fi or mobile data to pay. Nothing was charged." Nothing is charged: the balance is unchanged when you go back online. | ☐ |
| 6.2 | Turn airplane mode off and tap **Try again**. | The pay sheet comes back and the payment completes normally. | ☐ |
| 6.3 | Phone B: airplane mode on for 20 s while on the dashboard, then off. | The pill shows "reconnecting/offline" with a calm note, then returns to **Live**. A payment made meanwhile appears after the reconnect. | ☐ |
| 6.4 | Phone A: airplane mode on just **after** tapping confirm (while "Arriving"). Turn it off after 10 s. | The screen still turns green once back online, or shows "Still confirming". There is never a second charge. | ☐ |

## 7. Face ID / fingerprint edge cases
| # | Step | Expected | P/F |
|---|---|---|---|
| 7.1 | On the pay sheet, tap confirm, then **Cancel** the Face ID prompt. | "Payment not confirmed · Face ID or fingerprint was cancelled, so nothing was charged." **Try again** works. | ☐ |
| 7.2 | Close Safari completely, reopen `https://vouch-ubc.vercel.app/wallet`. | "Welcome back, <name>". One biometric prompt opens the account. | ☐ |

## 8. Copy and look (all phones)
| # | Check | Expected | P/F |
|---|---|---|---|
| 8.1 | Primary screens seen above | No "USDC, token, crypto, gas, wallet address, 0x…, transaction, hash, sign/signature, blockchain, on-chain, referral, passkey, testnet". The only exception is "Top up (testnet demo)". These words may appear only in "Receipt details" and on the transparency page. | ☐ |
| 8.2 | Amounts | Always `$x.xx` (two decimals). No long numbers or hex. | ☐ |
| 8.3 | Thumb reach | Every button is easy to hit with a thumb. No text overlaps at the phone's default text size. Try once with the largest Dynamic Type size too. | ☐ |

**Result:** ____ / 32 pass. Tester: ______ · Date/time: ______ · Phones/OS: ______ · `https://vouch-ubc.vercel.app`: ______
