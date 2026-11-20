# Vouch copy guide

_Owner: UI_DESIGN. Applies to every customer and venue screen. Checked by `pnpm --filter web design:shots` (banned-words scan of the screen mocks)._

## Voice
- **Warm, plain, short.** Talk like the person behind the counter, not like a bank or a crypto app.
- **Name who and how much.** "Ana got $0.69 for sending you", not "Referral reward distributed".
- **Money is dollars.** `$12.00`, always two decimals on primary screens (`formatMoney` / `<AmountDisplay>` round half-up to cents). Exact sub-cent values (`$0.693`) appear only on the transparency page.
- **Signs:** money in is `+$0.45` (green). Money out is `−$12.00` (ink, true minus). Spending is never red.
- **Sentence case** everywhere. At most one exclamation mark, only on success, and usually none.
- **One primary action per screen**, labelled with a verb + the outcome: "Pay $12.00", "Show code", "Share link", "Start at 15%".
- **Errors say what happened and what to do next**, and reassure about money: "Payment didn't go through. Nothing was charged. Try again."

## Banned on primary screens
Primary screens = everything a customer or venue staff sees in the normal flow. Technical words may appear **only** inside the collapsed `<Details>` drawer (`data-copy-scope="details"`) and on the public **transparency page**.

| Never say | Say instead |
|---|---|
| USDC, token, stablecoin, crypto | dollars, `$12.00` |
| gas, gas fee, network fee | nothing (we cover it). In Details: "Network fee $0.01, paid by Vouch" |
| wallet address, `0x…`, account address | your account, your name |
| transaction, tx, transaction hash | payment, receipt. In Details: "Receipt ID" |
| sign, signature, signed, countersign | confirm, approve, save ("Save Ana's recommendation") |
| seed phrase, recovery phrase, private key | never mention. Passkey = "Face ID or fingerprint" |
| blockchain, on-chain, smart contract, web3 | "public record", "verified". Explain on the transparency page |
| referral, referrer, L1/L2, introducer (on customer screens) | recommendation, "recommended you", "brought Ana in" |
| intro, nonce, terms version, bps | recommendation, "the reward it was made with", "15%" |
| testnet | Only in the label **"Top up (testnet demo)"** and the demo-mode note |
| wallet (as a noun for the crypto object) | balance, account. ("Wallet home" is an internal screen name only) |

"Sign in" / "sign up" are ordinary UI words and allowed, but prefer "Get started" and "I already have an account".

## Approved phrases (canonical story)
| Moment | Copy |
|---|---|
| Onboarding headline | Get money back when a friend sends you somewhere new. (A9; was "Pay local. Thank the friends who sent you.") |
| Passkey CTA | Get started · "Face ID or fingerprint. No passwords, nothing to write down." |
| Invite chip | Ana sent you to Lena's café |
| Friend's link | Ana thinks you'll love Lena's café · **Save Ana's recommendation** |
| Pay sheet | Pay $12.00 · You'll get $0.45 back · "Confirm with Face ID or fingerprint" |
| Who sent you | Who sent you here? _Optional_ · Ana · Priya · Someone else |
| Success | Paid at Lena's café · +$0.45 back to you · "Ana and Priya were just thanked for sending you." |
| Split receipt title | Where your money went |
| Recommend | Personal: "For one friend. Personal recommendations count double." Public: "For a group or your socials." |
| Recommend promise | "When a friend makes their first purchase, you get part of it: about $0.99 on a $12.00 order. Paid the moment they pay." |
| Ambassador | 14 verified customers across 5 venues · "Your record belongs to you and goes wherever you go." |
| Venue reward | Set your reward · "You only pay when a recommendation brings in a new customer who buys." |
| Venue terms | "Recommendations keep the reward they were made with. Changes apply to new ones only." |
| Counter | Show code · Ask the customer to scan with Vouch · Expires in 1:42 · Code expired / New code |
| Dashboard KPI | Cost per new customer $1.80 · "paid only when they buy" |
| Live toast | Ana's recommendation paid off · +$0.69 just arrived |

## Details drawer vocabulary (allowed there)
Network fee (paid by Vouch) · Settles on Arc Testnet · Receipt ID `0x2de2…8214` (truncated middle) · Order ID · Public record. Hashes are mono, truncated, with copy + explorer link in Phase 3.

## Phase 3 customer states (approved copy, D-608/D-609)
| State | Title · body · action |
|---|---|
| Pay primary | **Confirm with Face ID or fingerprint** · "You pay $12.00. No fees." |
| Who sent you | Who sent you here? _Optional_ · Ana · Priya · Someone else · Skip |
| Repeat visit | "Welcome back. Your first-visit thank-you at Lena's café has already been paid, so this one is a regular payment." |
| Code expired | This code has expired · "…Nothing was charged. Ask for a new code and scan again." · Scan a new code |
| Already paid | This order is already paid · "Someone has already paid with this code…" · Scan a new code |
| Not enough money | Not enough money yet · "Your balance is $3.20. Add at least $8.80 to pay $12.00." · Top up (testnet demo) |
| Service down | Payments are paused for a moment · "…Nothing was charged. Try again in a minute." · Try again |
| Failed | Payment didn't go through · "Nothing was charged. Try again, or ask for a new code." |
| Prompt cancelled | Payment not confirmed · "Face ID or fingerprint was cancelled, so nothing was charged." |
| Offline | You're offline · "Connect to Wi-Fi or mobile data to pay. Nothing was charged." |
| Camera denied | Camera is off for Vouch · "That's fine, there are two other ways to pay:" camera app link · type the short link |
| Settling | Paying Lena's café… · "$0.45 back, on its way" · "Thanking Ana and Priya for sending you…" · receipt tag "Arriving" |
| Onboarding line | "Nothing to download, no password, nothing to write down. Your face or fingerprint keeps your account safe." |
| Friend's link | Ana vouched for Lena's café · "Locked in on Nov 18. This reward stays as it is, even if Lena's café changes its rewards later." |
| Locked recommend | Buy once to vouch · "…every recommendation on Vouch comes from a real customer, and friends can trust it." |

## Phase 3 gate fix pass (QE-3-01/03/04, MSG-096/100/101/119)
| State | Title · body · action |
|---|---|
| Link doesn't look right (QE-3-01) | This link doesn't look right · "Part of it may be missing or mistyped, so we can't find the order. Nothing was charged. Scan the code at the counter again, or ask for a new one." · **Scan a new code** · Close. Never "Try again" (the same link can't work). |
| Below the minimum (D-509 warning) | **No money back on this one** · "Orders from $5.00 get money back on a first visit. If you pay $3.00 now, it counts as your first visit to Lena's café, so there's no money back here later." (amber, not a neutral note) |
| Success, no money back | repeat → "Thanks for coming back." · first visit, no recommendation → "Thanks for coming in." + "When a friend recommends a place to you, your first visit there gets money back." · below minimum → "Thanks for coming in." + "First visits from $5.00 get money back at Lena's café. This one was under that." · unknown → "Thanks for coming in." (never assume a repeat) |
| Wallet cashback | Shown once, on the purchase row: "+$0.45 back". No separate "Money back" row. Demo note sits under the top-up button: "Simulated money for this demo. No card needed." |
| Dashboard KPI | New customers · "verified first purchases" (it counts every verified first purchase, recommended or not) |
| Cost vs ad, under a cent | "under $0.01" · "Almost nothing so far: under a cent per new customer, against $20.00 for a typical ad." No "× less" below a cent or above 100× |
| Dashboard, visitor | Rows: "to the venue" (not "to you"); no ad-cost input; "What Lena's café has paid in rewards, on average, for each new customer." |

## A9 customer polish (UI_DESIGN, 2026-11-19)
Blue (`primary`) is for actions, selection and links; green stays reserved for money arriving to a person.
| Moment | Copy |
|---|---|
| Onboarding headline | Get money back when a friend sends you somewhere new. |
| Onboarding body | "Scan to pay at local cafés, barbers and salons. Your first visit gives you money back and thanks the friend who recommended it." |
| Onboarding reassurance (under the button) | "No password, nothing to write down. Your face or fingerprint keeps your account safe." |
| Home | "Your balance" · cashback stays on the purchase row (shown once) as a green "+$0.45 cashback" |
| Home reward rows | "From Ben's first visit to Lena's café" · meta "You recommended it · 2 h ago" or "Via Ana, who you brought in · 2 h ago" |
| Home recommend card | Liked Lena's café? · "A friend gets money back on their first visit. You get paid too." · **Recommend** |
| Pay sheet | "Paying" Lena's café · $12.00 · **You'll get $0.45 back** · "First-visit money back, right after you pay" |
| Success | Primary **Recommend Lena's café**, then "Done" · mini split "Where your money went" · "See who got what" |
| Recommend | "Your friend gets: Money back on their first visit" · "You get: About $0.99 when they spend $12.00. Paid the moment they pay." |
| Recommend, link made | "Your link is ready" · "Share it, or let a friend scan this from your screen." |
