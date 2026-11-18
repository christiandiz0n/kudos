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
| Onboarding headline | Pay local. Thank the friends who sent you. |
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
