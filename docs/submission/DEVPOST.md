# Devpost submission: Vouch

_Draft by DOCS_SUBMISSION, 2026-11-18. Paste each section into the matching Devpost field. Every number is from on-chain receipts or QA evidence (sources are in HTML comments, which Devpost doesn't need). Fill in the `<…>` placeholders before submitting._

---

## Project name
**Vouch**

## Tagline (short description, ≤ 200 characters)
Local shops pay only for customers who actually show up and buy. The purchase itself instantly thanks the friends who recommended the shop.

_Alternative:_ Word of mouth that pays: one tap at the counter pays the café, gives the new customer money back, and thanks the friends who sent them.

---

## What did you build?
Vouch is a phone app for local businesses and their customers that turns a recommendation into a reward the moment it works.

A café sets a reward for a new customer's first purchase, for example 15%. Ana, a regular, taps **Recommend** and texts Ben a link. When Ben comes in, the barista keys in his $12.00 order and shows a QR code. Ben scans it and sees *"You'll get $0.45 back,"* answers an optional *"Who sent you here?"*, and confirms with Face ID. In about a second and a half, the café gets $10.20, Ben gets $0.45 back, Ana and a second friend share $0.99, and the people who originally brought *them* in share $0.36. Everyone's screen updates live, and the café's dashboard animates the money flowing through the chain of recommendations.

It's live at https://vouch-ubc.vercel.app. Customers get a balance in dollars, scan-to-pay, a recommend-and-share flow, and an ambassador record. Venues get onboarding with a reward slider, an order keypad with a QR code, and a live dashboard with the money graph, cost per new customer and a payments feed. A public transparency page explains exactly how every payment splits.

## What problem does it solve?
Small businesses spend money on ads they can't measure, while most of their real growth comes from word of mouth that pays the recommender nothing. Referral programs could fix that, but a café can't build one: it needs software, fraud checks and payouts. The platforms that offer them take a cut and can change the rules at any time.

With Vouch, a business pays **only for verified new customers**, and only when they buy. In our live test, the café's cost per new customer was $0.08, shown on the dashboard next to what a typical ad would cost. The people who brought the customer in are paid instantly, out of the payment itself, so nobody has to chase anyone for a payout.

## How does it work?
- **One payment, split instantly.** The customer approves one payment with Face ID. A smart contract on **Arc** (Circle's blockchain, where the dollar stablecoin USDC is also the fee token) receives it and pays everyone in the same transaction. A full two-level split of $12.00 cost **$0.0086** in network fees, paid by our relay, so the customer pays nothing extra. <!-- evidence: cast receipt 0x40147554…ddfcb: 375,553 gas × 22.8 gwei = 0.0085626 USDC -->
- **The customer never sees crypto.** There are no seed phrases, no gas and no bridging. A key is created on the phone and protected by the phone's passkey. The customer signs a single authorization for the exact amount, which our relayer submits. The relayer can't change the amount or who gets paid.
- **Rules nobody can bend.** The contract enforces that only real, verified customers can recommend a venue, that each referral is paid at the rate in force when the link was shared, that each customer earns a reward at a venue at most once, and that the payouts always add up to exactly the sale.
- **Live updates from QuickNode Streams.** A Stream watches the contract's events on Arc, filters them down to Vouch's 10 event types, and pushes them to our HMAC-verified webhook. Our database and every screen are built from those events. A payment only shows as "paid" once the Stream confirms it. Measured: the payment reached our server **0.15 s** after the transaction confirmed, and the whole flow from tap to settled took **1.35 to 1.45 s**. Replaying the Stream from the deploy block rebuilds exactly the same state, hash for hash. <!-- evidence: docs/evidence/phase-2/qe/part-b-latency-summary.txt (+0.147 s); docs/qa/phase-3-qe-gate.md (1.35/1.45 s); docs/evidence/phase-2/qe/streams-verify.txt -->
- **Who gets credit.** When several friends recommended you, a transparent formula weighs personal links over group links, how often you opened each link, and how recent it was. You can also tap "who sent you here". The contract enforces hard bounds whatever the weights are, and it has its own fallback rule.

## What makes it unique?
- **The sale pays the referrers.** It's not a promise or a points balance. The reward leaves inside the same payment, so the venue can't skip it, and the referrer doesn't need to trust anyone.
- **Pay-per-verified-customer marketing.** Only someone who actually bought at a venue can recommend it, which rules out fake reviews and paid endorsements from people who never visited.
- **Frozen terms.** A link shared at 15% pays 15%, even if the venue lowers its rate tomorrow.
- **Two levels, bounded.** The person who brought in your recommender also gets a small share (20% of the reward pool). The total is capped by the venue's rate, and there's no recruiting or buy-in. It's still marketing spend on real purchases, not a pyramid.
- **No operator required.** If our backend disappears, a customer can submit the payment themselves and pay the tiny fee in dollars. We've proven this on chain.
- **The data is provably honest.** Every number on screen can be rebuilt from the blockchain through the Stream, and it gives the same hash.

## What would you build next?
1. Point-of-sale integration, so orders come from the till instead of a keypad.
2. A real card on-ramp and payouts to a bank, replacing today's testnet top-up.
3. A refund window that reverses rewards before they settle.
4. Smart-account wallets with recovery (Circle Modular Wallets) in place of the per-browser key.
5. Cross-venue discovery: a portable ambassador record that lets businesses invite proven recommenders.
6. Fraud signals (referral rings, suspicious timing) and AI-assisted attribution, kept inside the same on-chain bounds and measured against the baseline.
7. A pilot with a few cafés in one neighborhood, then an audit and mainnet.

---

## Built with (technologies)
Arc Testnet · USDC (EIP-3009 `receiveWithAuthorization`) · Solidity 0.8.30 · Foundry (forge, cast, fuzz, invariant and fork tests) · OpenZeppelin Contracts 5 · EIP-712 · QuickNode Streams (Logs dataset, JavaScript filter, webhook destination) · TypeScript · viem · Next.js 16 · React 19 · Tailwind CSS 4 · WebAuthn passkeys (PRF) · Web Crypto · Fastify 5 · Drizzle ORM · PostgreSQL · PGlite · Server-Sent Events · Railway · Vercel · Blockscout · Playwright · jsQR / qrcode · pnpm workspaces

## Track, award and bounty selections
- [x] **Consumer Applications** (main track)
- [x] **Best use of Arc** (chain award): contract addresses and "How we use Arc" are in the README
- [x] **QuickNode Streams** (bounty): network, dataset, filter, destination and rationale are in the README "QuickNode Streams" section
- (automatic) Official UBC Winner eligibility

## Links
| Field | Value |
|---|---|
| Live app | https://vouch-ubc.vercel.app |
| GitHub repository | https://github.com/christiandiz0n/vouch _(make it public before submitting)_ |
| Demo video | `<VIDEO_URL>` (YouTube unlisted or Google Drive, "anyone with the link") |
| Contract (Arc Testnet explorer) | https://explorer.testnet.arc.io/address/0xF4B641dc628de05336aa983B07D5d181254ff08e |
| Canonical $12.00 split transaction | https://explorer.testnet.arc.io/tx/0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb |
| How payments split | https://vouch-ubc.vercel.app/transparency |
| Team | `<AUTHOR_NAME>` (solo) |

## Judges' quick start (optional "Try it" field)
1. Open https://vouch-ubc.vercel.app on your phone and tap through onboarding. It uses Face ID or a fingerprint, and you won't need a password.
2. Use the **Top up (testnet demo)** button to get $3 of test money (once per phone).
3. Scan the QR code on the venue screen we show you, then confirm. Watch the dashboard update live.
4. Tap **Recommend** to make your own link and send it to the judge next to you.

_This is a testnet prototype. No real money moves._
