# Kudos: 5-minute finalist pitch and Q&A

_Draft by DOCS_SUBMISSION, 2026-11-18. Saturday, Nov 21: 5 min pitch + 2 min Q&A. Every number here is measured. Sources are in the README; key ones are repeated in the comments._

## Setup on stage
- Projector: the stage venue dashboard at https://vouch-ubc.vercel.app (1280×720 or larger).
- Your phone as the counter, or the laptop counter tab. One or two judges join with their own phones via QR (in-app $3 testnet top-up).
- **The Stream must be ACTIVE** (resume it ~10 minutes before). Have the backup clip from `VIDEO_SCRIPT.md` loaded.

## Outline (5:00)

| Time | Beat | What to say (key lines) | What's on screen |
|---|---|---|---|
| 0:00–0:35 | **Hook** | "Lena runs a café. She pays for ads she can't measure. Meanwhile her best customers come from friends who recommended her, and those friends get nothing. Referral programs exist, but a café can't build one, and the platforms that run them take a cut and change the rules." | Title slide, then the empty dashboard |
| 0:35–1:00 | **The idea** | "Kudos is pay-per-verified-customer marketing. The venue sets a reward for a new customer's first purchase. When a referred customer pays, **the payment itself** pays the people who sent them, in the same instant." | Transparency page: the $12 example |
| 1:00–2:30 | **Live demo** | Judge scans the QR → onboarding with Face ID → top-up (testnet demo) → pays. Then a recommended judge pays and the referrer's phone lights up. "No seed phrase, no gas, no wallet. The customer sees dollars and Face ID." | Phones + projector money graph |
| 2:30–3:15 | **Why a chain** | Four lines: (1) **atomic split**, so the venue can't skip the referrers; (2) **frozen terms**, so the rate on a shared link can't be cut afterwards; (3) **verified-purchase gating**, so only real customers can recommend; (4) **no operator needed**, since a customer can submit the payment themselves. | Explorer: the $12 tx with 7 transfers; the self-submit tx with **From** = the customer |
| 3:15–3:45 | **Why Arc** | "USDC is the gas. A six-recipient split of $12 cost **$0.0086**, in dollars, predictable, paid by our relay. The customer signs one EIP-3009 authorization for the exact amount. Our relayer can't change who gets paid." | README "How we use Arc" table |
| 3:45–4:20 | **Why Streams** | "We never trust our own backend about money. A payment is 'paid' only when QuickNode Streams delivers the contract event. It's filtered at QuickNode to our 10 events and pushed to an HMAC-verified webhook **0.15 s** after the receipt, about **1.4 s from tap to settled**. Replay the Stream from the deploy block and you get **the same database, hash for hash**." | `streams:verify` output |
| 4:20–4:45 | **Rigor** | "197 contract tests: fuzz, invariants, and fork tests against real Arc USDC. Three rounds of independent adversarial contract review, a security review, and end-to-end QE on the deployed app. I'll tell you what's cut and what the limits are: sybils, a demo-grade wallet, testnet only." | README invariants and limits |
| 4:45–5:00 | **Close** | "Word of mouth already sells. Kudos makes it pay, the moment it works. Next: a POS integration and a pilot with three cafés on one street." | Logo + URL |

<!-- evidence: fee 0.0085626 USDC from cast receipt 0x40147554…ddfcb; +0.147 s docs/evidence/phase-2/qe/part-b-latency-summary.txt; 1.35/1.45 s docs/qa/phase-3-qe-gate.md; 197 tests forge re-run 2026-11-18 -->

**If the live demo fails:** say "this is the run from Wednesday night on the same deployment" and play the backup clip. Then go straight to the explorer tx, which is on chain no matter what.

---

## Likely Q&A (crisp answers)

**Why does this need a blockchain? Couldn't Stripe do it?**
Stripe could move the money, but the venue would control the rules. On Kudos, three things can't be done off-chain without trusting the venue or us. First, the referrers are paid *out of the payment itself*, atomically, so nobody can skip them. Second, terms are frozen per link, so a venue can't cut the rate after you shared it. Third, the right to recommend is gated by an on-chain purchase, and your ambassador record is yours, readable by any venue. And it keeps working if our company disappears: a customer can submit the payment directly.

**Isn't this a pyramid scheme?**
No. Nobody pays to join, and nobody earns from recruiting. Every dollar of reward comes from a real purchase of a real product, and it's capped by the venue's chosen rate (15% in our example). It goes only two levels deep: the second level gets 20% of that capped pool, only for a customer's first purchase, once per customer per venue. It's a marketing budget the venue spends only when a new customer actually buys, closer to a referral bonus than to multi-level marketing.

**Why would venues adopt it?**
Because they pay only for results. In our test the cost per new customer was $0.08, shown on the dashboard right next to what an ad would cost. Setup is a name, a reward slider and a QR code, and the payouts happen automatically. There's no software to build and no payouts to chase. The real path to adoption is POS integration and a neighborhood pilot. Today's version is a phone and a QR code.

**What about fraud and sybils?**
The contract enforces the basics: one reward per customer per venue, ever; no self-referral; a minimum order for a rewarded purchase; and only verified buyers can recommend. Weights can only move money among people who hold valid intros. They can't pay strangers. What we don't prevent: someone using a second identity to collect their own referral. Each fake identity still costs a real purchase, and the gain is capped by the venue's rate. Risk flags were planned and cut for time. We say so in the README.

**Why Arc?**
USDC is the gas, so fees are in dollars and predictable: under a cent for a six-way split ($0.0086 measured). Customers and venues see one currency. USDC on Arc supports EIP-3009 `receiveWithAuthorization`, which gives us a gasless, front-run-safe, one-signature payment. Finality is deterministic with sub-second blocks, so "settled" really means settled. And it's standard EVM, so Foundry and viem just work.

**Why Streams instead of polling the chain?**
Streams pushes our filtered events to us within about 0.15 s, so there's no polling loop, no wasted calls, and nothing to tune. The filter runs at QuickNode, so we receive only our contract's 10 events. And because a Stream can backfill from the deploy block, our whole database is reproducible: backfill, live delivery and replay give the same hash. That's how we can say every number on screen is provably from the chain.

**What happens if your backend dies?**
Money already paid is safe: it's on chain and in people's balances. New payments can still be made, because the contract lets a customer submit their own payment and pay the sub-cent fee in USDC. We've shown this on chain (tx `0xfca0e1ae…`, sent from the customer's address). In this build that path runs from a script, not an in-app button. The data can be rebuilt by replaying the Stream.

**What about privacy?**
On a public chain, addresses and amounts are visible. Names aren't: display names live only in our database, and screens show first names. A production version could use fresh per-venue addresses so purchases aren't linkable across venues. Kudos doesn't ask for an email or phone number: sign-in is a first name plus Face ID or a fingerprint.

**How do you decide who gets credit when several people recommended you?**
A transparent, deterministic formula weighs personal links over group links, the number of times you opened the link, and how recent it was. A "Who sent you here?" tap adds a boost. The contract caps any one person at 80% when there are several referrers, and falls back to its own rule if the weights are missing or invalid. AI attribution was in the plan, and we cut it to keep the core solid.

**Is the wallet secure?**
It's demo-grade, and we say so. The key is created in the browser and encrypted with a key derived from your passkey. There's no recovery yet. The production path is a smart-account wallet with passkeys and recovery (Circle Modular Wallets on Arc), which we evaluated and deferred.

**What about refunds?**
Not handled yet: a refund doesn't claw back rewards. The design for that is a short settlement window before rewards are released. It's first on the roadmap after POS.

**Is it legal? Taxes?**
It's a prototype on testnet, not legal or tax advice. Referral rewards are a known category (think referral bonuses), but a real launch needs jurisdiction-specific review.
