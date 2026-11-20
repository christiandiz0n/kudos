# Devpost submission: Kudos (final, copy-paste ready)

_DOCS_SUBMISSION, Fri 2026-11-20 ~01:00 CST. Fields are in the order the task lists them; the step-by-step clicking guide is [`SUBMIT_STEPS.md`](SUBMIT_STEPS.md)._

**How to copy:** each field's text sits between "COPY FROM HERE" and "END". On a phone, open this file on GitHub and long-press to select. For the long "About the project" field, copy from the **Raw** view (GitHub → "Raw" button) so the `##` headings and `**bold**` survive; Devpost's About field accepts Markdown.

Placeholder to replace before pasting: `<VIDEO_URL>` (your video link) (search this file for it).

Every number below was checked on chain (`cast receipt`) or against the live api on 2026-11-20.

---

## Field 1: Project name

COPY FROM HERE

Kudos

END

---

## Field 2: Elevator pitch / tagline (limit 200 characters)

COPY FROM HERE

Local shops pay only for customers who actually buy. One tap at the counter pays the shop, gives the new customer money back, and pays the friends who sent them.

END

_161 characters (counted). Shorter alternative, 147 characters:_ Word of mouth that pays. A local shop pays only when a recommended customer buys, and that one payment instantly rewards the friends who sent them.

---

## Field 3: Built with (type each tag, press Enter or comma after each)

COPY FROM HERE

arc, usdc, solidity, foundry, openzeppelin, eip-712, eip-3009, quicknode, quicknode-streams, typescript, viem, next.js, react, tailwindcss, webauthn, passkeys, fastify, drizzle, postgresql, pglite, server-sent-events, railway, vercel, blockscout, playwright, pnpm

END

---

## Field 4: "Try it out" links (one per line; Devpost has an "add another link" button)

COPY FROM HERE

https://vouch-ubc.vercel.app

https://github.com/christiandiz0n/vouch

https://vouch-ubc.vercel.app/transparency

https://explorer.testnet.arc.io/tx/0x83214e735269dc32850d18381fb229e8406fdbd5ea0ee4b9f85c1a73f071f980

END

---

## Field 5: Video demo link

COPY FROM HERE

<VIDEO_URL>

END

YouTube (Unlisted) or Google Drive ("Anyone with the link"). Check that it plays in a private window first.

---

## Field 6: Image gallery (upload these files from the repo)

Devpost suggests a 3:2 ratio, JPG/PNG/GIF, up to 5 MB each. The first image becomes the thumbnail. All files exist in the repo.

| Order | File | Caption to type |
|---|---|---|
| 1 (thumbnail) | `docs/evidence/phase-5/prod/p5-01/lena-dashboard-1440x900.png` | Venue dashboard on a projector: cost per new customer, money graph, live payments |
| 2 | `docs/evidence/phase-5/prod/screens/p-lena-everyone-1280.png` | "Everyone" view: every recommendation that brought a paying customer |
| 3 | `docs/evidence/phase-3/qe/screens/l20-ben-pay-confirm.png` | Pay sheet: what you pay, what you get back, who sent you |
| 4 | `docs/evidence/phase-3/qe/screens/l23-ben-settled.png` | Paid, with the split receipt |
| 5 | `docs/evidence/phase-5/prod/screens/p-record-ana-390.png` | A recommender's public record |
| 6 | `docs/evidence/phase-5/prod/chromium/screens/s02-transparency.png` | The public page that explains every split |

If the blue UI re-skin ships to production, swap in the new screenshots the Orchestrator adds (A9).

---

## Field 7: About the project (Markdown)

Copy from the Raw view. This answers the hackathon's five questions inside Devpost's standard sections; section headers name the question they answer.

COPY FROM HERE

## Inspiration

Small businesses like cafés, barbers and salons spend money on ads they can't measure. Most of their real growth comes from word of mouth, and the friend who did the recommending gets nothing. Referral programs could fix that, but a café can't build one: it needs software, fraud checks and payouts, and the platforms that offer them take a cut and can change the rules at any time.

## What it does

**What did you build?** Kudos is a phone app for local businesses and their customers that pays a recommendation at the moment it works.

A café sets a reward for a new customer's first purchase, for example 15%. Ana, a regular, taps **Recommend** and texts her friend Ben a link. When Ben comes in, the barista keys in his $12.00 order and shows a QR code. Ben scans it, sees "You'll get $0.45 back", can answer an optional "Who sent you here?", and confirms with Face ID. One payment then splits: the café gets $10.20, Ben gets $0.45 back, Ana and Priya (the two friends who recommended the café to him) get $0.693 and $0.297, and the two people who first brought Ana and Priya in get $0.252 and $0.108. Everyone's screen updates live, and the café's dashboard shows where the money went.

It's live at https://vouch-ubc.vercel.app. Customers get a balance in dollars, scan-to-pay, a recommend-and-share flow, and a public record of who they've brought in. Venues get a setup screen with a reward slider, an order keypad that shows a QR code, and a live dashboard with a money graph, the cost per new customer, and a payments feed. A public page explains exactly how every payment splits.

**What problem does it solve?** A business pays **only for new customers who actually buy**, and the people who sent them are paid instantly, out of the payment itself, so nobody has to chase a payout. In our demo data, Lena's café has 6 new customers from recommendations and has paid $3.71 in rewards in total: $0.62 per new customer. The owner's dashboard puts that next to what an ad would cost.

## How we built it

**How does it work?**

- **One payment, split instantly.** The customer approves one payment with Face ID. A smart contract on **Arc** (Circle's blockchain, where the dollar stablecoin USDC is also the fee token) receives it and pays everyone in the same transaction, to the exact cent. The $12.00 split above is transaction `0x83214e73…` on the Arc Testnet explorer: 12.00 in, six payouts out, to six different people. Its network fee was about one cent ($0.0124), paid by our relayer in USDC, so the customer pays nothing extra.
- **The customer never sees crypto.** No seed phrases, no gas, no bridging. A key is created on the phone and protected by the phone's passkey. The customer signs one USDC authorization (EIP-3009) for the exact amount, which our relayer submits. The relayer can't change the amount or who gets paid.
- **Rules the contract enforces.** Only verified customers (people who bought there) can recommend a venue. Each referral pays at the rate in force when the link was shared. Each customer earns a reward at a venue at most once. Payouts always add up to exactly the sale.
- **QuickNode Streams as the source of truth.** A Stream on Arc Testnet (Logs dataset) runs a JavaScript filter that keeps only our contract's 10 event types and pushes them to an HMAC-verified webhook on our API. Our database and every screen are built from those events, and a payment only shows as paid once the Stream delivers it. Measured: the Stream delivered the payment's block 0.15 s after our relayer saw the receipt, and tap-to-settled on the deployed app took 1.35 to 1.45 s. Replaying the Stream data from the deploy block rebuilds exactly the same database, hash for hash.
- **Who gets credit.** When several friends recommended you, a simple published formula weighs personal links over group links, how often you opened each link, and how recent it was. You can also tap "Who sent you here?". The contract enforces hard limits whatever the weights are, and has its own fallback rule.

Stack: Solidity 0.8.30 with Foundry and OpenZeppelin (197 tests passing, including fuzz, invariant and fork tests against real Arc USDC); a Fastify API with Postgres on Railway; a Next.js web app on Vercel; viem; WebAuthn passkeys.

## Challenges we ran into

- The QuickNode Streams REST API isn't available on trial plans, so the production Stream was created in the dashboard and its configuration is kept in the repo as data.
- Making "paid" trustworthy: the app never takes the relayer's word. A payment shows as pending until the Stream delivers the on-chain event, and deliveries are idempotent so retries and replays can't double-count.
- Fitting the full rule set (frozen terms, two levels, caps, single-use signatures, customer self-submit) into one contract under the 24 KB size limit.
- Passkeys are tied to a domain, which shaped how we deployed and tested on real phones.

## Accomplishments that we're proud of

- A real two-level referral split, settled in one transaction for about a cent, that a customer approves with Face ID and never sees as crypto.
- Every number on screen can be rebuilt from the chain through the Stream.
- The payment doesn't depend on us: a customer can sign the payment for themselves and submit it directly, paying the fee in USDC. This path has run on chain (transaction `0xfca0e1ae…`).
- Independent review at each stage: adversarial contract QA, a security review of the API and webhook, and end-to-end tests on the deployed app.

## What we learned

- Using a dollar stablecoin as the gas token makes a payment's cost a dollar figure a business can plan around.
- Pushed, filtered events (Streams) make a much simpler and more honest backend than polling: one code path for live data, backfill and replay.
- Most of the work in a consumer payments app is copy and error states, not the contract.

## What makes Kudos unique

**What makes it unique?**

- **The sale pays the referrers.** Not a promise or a points balance: the reward leaves inside the same payment, so the venue can't skip it.
- **Pay per verified customer.** Only someone who bought at a venue can recommend it.
- **Frozen terms.** A link shared at 15% pays 15%, even if the venue lowers its rate later.
- **Two levels, bounded.** The person who brought in your recommender gets a small share (20% of the reward pool). The total is capped by the venue's rate, and there's no buy-in or recruiting.
- **Works without us.** The customer can submit the payment themselves.

## What's next for Kudos

**What would you build next?**

1. Point-of-sale integration, so orders come from the till instead of a keypad.
2. A real card on-ramp and payouts to a bank, replacing today's testnet top-up.
3. A refund window that reverses rewards before they settle.
4. Smart-account wallets with recovery (Circle Modular Wallets) in place of the per-browser key.
5. A portable recommender record that lets other businesses invite proven recommenders.
6. Fraud signals (referral rings, suspicious timing), kept inside the same on-chain limits.
7. A pilot with a few cafés in one neighborhood, then an audit and mainnet.

This is a testnet prototype. No real money moves.

END

---

## Field 8: Hackathon questions (only if the form has separate boxes for them)

If the form asks these separately, paste the matching paragraph from Field 7:

| Form question | Paste this part of Field 7 |
|---|---|
| What did you build? | "What it does" → the **What did you build?** paragraphs (up to "A public page explains…") |
| What problem does it solve? | "What it does" → the **What problem does it solve?** paragraph, plus "Inspiration" |
| How does it work? | "How we built it" → all bullets |
| What makes it unique? | "What makes Kudos unique" → all bullets |
| What would you build next? | "What's next for Kudos" → the numbered list |

---

## Field 9: Tracks, awards and bounties (tick these)

- **Consumer Applications** (main track)
- **Best use of Arc** (chain award)
- **QuickNode Streams** (bounty)

If the form asks for a short justification:

COPY FROM HERE

Arc: every payment is one Arc transaction that receives USDC with an EIP-3009 authorization and pays all recipients in the same call; gas is paid in USDC (about a cent per two-level split). Contract 0xF4B641dc628de05336aa983B07D5d181254ff08e on Arc Testnet; the README section "How we use Arc" has the addresses and measured fees.

QuickNode Streams: Stream vouch-v3-production-2 (ID e77ce7b6-6642-4cd5-9894-7bb8de5c030a) on Arc Testnet, Logs dataset, a JavaScript filter that keeps only our contract's 10 events, and an HMAC-verified webhook destination. It is the app's only source for "paid" and for every number on screen. The README section "QuickNode Streams" has the configuration, the filter code and why we use it.

END

---

## Field 10: Team / author

COPY FROM HERE

Christian Dizon, Rutgers University, built solo.

END

If Devpost asks for teammates, there are none: submit as a solo team.
