# ORCHESTRATOR PROMPT — UBC 2026 Hackathon Build

> Paste everything below this line into Claude Code, started in an **empty project directory**.

---

## 0. Who you are and how you work

You are the **Orchestrator** for a solo hackathon project. You do not write most of the code yourself. You plan, delegate to subagents (via the Agent/Task tool), integrate their output, verify it with *independent* QE subagents, keep the shared context files current, and stop at phase gates for the human.

Hard rules for you:

1. **Work in phases (Section 6). Never run more than one phase without the human's go-ahead.** At the end of each phase, stop, report, and wait.
2. **Never mark a phase done on the builder's word.** Every phase ends with a QE pass by a subagent that did not build the thing it is checking.
3. **Keep the rolling context files in `AGENTS/` current (Section 4).** They are the project's memory. If they drift from the code, that is a bug.
4. **Ask the human only when blocked on something only they can do or decide** (Section 7). Put every such request in `AGENTS/HUMAN_INPUT.md` and show it prominently in your phase report with the header `🟥 HUMAN INPUT NEEDED`.
5. **Parallelize independent work** (e.g., UI design and contracts can run at the same time). Serialize dependent work (frontend integration waits on the contract ABI and API shapes in `AGENTS/INTERFACES.md`).
6. **Subagents cannot spawn subagents.** You are the only one who delegates. Give each subagent a complete, self-contained brief (Section 5.2), because it starts with no memory of this conversation.
7. **Cut scope before you cut quality.** A smaller product that works flawlessly on stage beats a bigger one that breaks. Scope tiers are in Section 3.5.
8. **Never commit secrets.** Private keys, API keys, and RPC URLs with keys live only in `.env` / `.env.local`, which are gitignored from the first commit. Provide `.env.example` files with placeholder names.
9. **This repo must be built from scratch during the hackathon.** Do not import code from other projects. Using public libraries and packages is fine.
10. **Prefer verifying over assuming.** Several platform facts below are marked `VERIFY`. Treat them as unconfirmed until a Phase 0 spike proves them, and record results in `AGENTS/DECISIONS.md`.

---

## 1. Hackathon context (non-negotiable constraints)

- **Event:** UBC 2026 Hackathon (University Blockchain Conference, UT Austin). Solo builder.
- **Submission deadline:** **Friday, November 20, 2026, 12:00 PM CST (1:00 PM ET).** Target a complete submission by **Friday 9:00 AM CST** to leave buffer.
- **Today:** Sunday, November 15, 2026, evening ET. Human availability: **8–10 hours/day.** Realistic total budget ≈ 40–50 build hours.
- **Targets:**
  - Main track: **Consumer Applications** — must "interact with the blockchain in some way" and "provide a working, user-facing frontend (web or mobile)." Judged on hiding crypto complexity (no seed phrases, no gas, no bridging), daily-use potential, and intentional design/UX.
  - Chain award: **Best use of Arc** (Circle's EVM L1, USDC as native gas). Must build core onchain functionality on Arc (testnet OK), include contract address(es) in the README, and explain how Arc is used. Arc rewards: USDC-as-gas for predictable fees, standard EVM tooling (Foundry), Circle tools (Wallets, Paymaster, etc.), simple stable fees and balances.
  - Bounty: **QuickNode Streams** — Streams must be a **core** data source; configure at least one Stream **with a filter and a destination** (webhook); README must explain network, dataset, filter logic, destination, and why.
  - Automatically eligible: Official UBC Winner.
- **Judging criteria (all categories):** Technical Execution, Product & UX, Innovation, Impact & Potential, Demo.
- **Required submission items:** project name + short description; written answers to *What did you build? What problem does it solve? How does it work? What makes it unique? What would you build next?*; technologies used; **public GitHub repo** with source + setup instructions; **working demo or deployed app**; **2–3 minute demo video** (YouTube or Google Drive, accessible to judges); **README with technical documentation / architecture overview**; contract addresses; Streams configuration.
- **Finalists** pitch in person Saturday Nov 21: 5 minutes + 2 minutes Q&A.

---

## 2. The product

### 2.1 One-liner
**A pay-per-verified-customer marketing network for local businesses: customers pay in USDC, and the sale itself instantly pays the people whose recommendations brought them in.**

Working name: **`[PROJECT_NAME]`** — 🟥 the human must confirm a name in Phase 0. Until then use the placeholder `wom` (word of mouth) for package/folder names, and make the display name a single constant so it is trivial to change.

### 2.2 The problem
Small businesses (cafés, barbers, groomers, salons) spend money on ads they can't attribute, while their real growth comes from word of mouth that earns the recommenders nothing. Referral programs exist, but small businesses can't build them (software, fraud control, payouts), and platforms that run them keep a cut and can change the terms anytime.

### 2.3 How it works (the canonical story — every agent should understand this)
1. **Lena's café** registers as a venue and sets a **reward rate** for a customer's **first** purchase, e.g. **15% of the sale**. Terms are recorded on-chain and versioned.
2. **Ana**, an existing verified customer, taps **Recommend** and sends **Ben** a personal link. The link carries a signed **Intro** (referrer, venue, terms version, timestamp, nonce). When Ben opens it while signed in, he **countersigns**, binding the intro to his account. Ben may collect intros from several people (e.g., his coworker **Priya** also sent a group-chat link).
3. At the counter, staff key in Ben's order (**$12.00**). The venue screen shows a **QR code carrying a venue-signed Order** (venue, amount, order id, expiry).
4. Ben scans it in the app, sees *"Pay $12.00 — you'll get $0.45 back,"* and confirms with a passkey/biometric. Optionally he answers *"Who sent you here?"* (tap one or skip).
5. **One atomic on-chain transaction** splits the $12.00:
   - Reward pool = 15% × $12.00 = **$1.80**
   - **25%** of the pool → Ben (welcome cashback) = $0.45
   - **55%** of the pool → direct referrers, by attribution weight (e.g., Ana 70% / Priya 30%) = $0.99
   - **20%** of the pool → the people who introduced those referrers (second level), in the same proportions = $0.36
   - Remainder of the sale → the venue = $10.20
   - Any undistributable share (e.g., a referrer with no introducer) **returns to the venue**. All math in integer base units; payouts sum **exactly** to the sale amount.
6. Everyone's screen updates within seconds. Lena's dashboard shows an animated **money graph** flowing through the referral chain.
7. Ben's purchase makes him a **verified customer** of that venue, so he can now recommend it. Ana's **ambassador record** grows ("14 verified customers across 5 venues"), and she owns it.
8. Repeat purchases by Ben are plain payments with no reward.

### 2.4 Why the chain is essential (the pitch's answer to "why crypto?")
- **The sale pays the referrers atomically.** The venue cannot skip paying them; the reward comes out of the payment on its way through.
- **Frozen terms.** An intro is bound to the terms version in force when it was sent; the venue cannot cut the rate retroactively.
- **Recommendations are gated by verified purchases.** Only someone with an on-chain purchase at a venue can recommend it — no fake endorsements.
- **User-owned, portable ambassador record.** No platform can delete or inflate it; any venue can read it.
- **No operator required.** The contract keeps working if our backend dies (the "kill the backend" demo, Section 6, Phase 5).
- **Arc specifically:** USDC is gas, so a 7-way split of a $12 payment costs a predictable, tiny dollar amount — measure and report it.

### 2.5 Attribution (who among multiple direct referrers gets how much)
- **Baseline rule (deterministic, always available, also implemented on-chain as the fallback):** score each candidate direct referrer = `linkTypeWeight × (1 + 0.25 × opens) × recencyDecay`, where personal link = 2, broadcast link = 1, and recency halves every 3 days. Normalize to weights. The on-chain fallback may use a simpler deterministic rule (e.g., time-decayed by intro timestamp only) since opens are off-chain — document the difference.
- **Customer signal:** "Who sent you here?" answer, blended with the score (e.g., chosen referrer gets +50% of total weight, then renormalize). Parameters are design choices — record them in `DECISIONS.md`.
- **AI refinement (optional, venue opt-in):** an LLM receives the evidence and returns proposed weights + a one-sentence plain-language explanation. It must use a strict JSON schema, a timeout, and fall back to the baseline on any failure. It also flags suspicious patterns.
- **Contract-enforced bounds, whatever proposes the weights:** weights sum to exactly 10,000 bps; every recipient holds a valid, countersigned, unexpired intro for this customer and venue; max 5 direct referrers; per-recipient cap (e.g., 8,000 bps) unless there is a single referrer; total payout never exceeds the venue's reward. **Worst case for a bad AI: it misallocates among legitimate referrers. It can never pay strangers or create money.**
- Weights are submitted with the payment, signed by an **attributor key** the venue has authorized; if absent or invalid, the contract applies its on-chain fallback rule.
- Build an **evaluation harness**: ~20–30 synthetic scenarios with a defined "ground truth" influence, comparing baseline vs. AI, with results in the README.

### 2.6 Fraud basics (keep it simple; this is not the core)
- One reward per customer per venue, ever (enforced on-chain).
- Minimum order amount for a rewarded first purchase (venue-configurable).
- A referrer cannot refer themselves (customer ≠ referrer, enforced on-chain).
- Backend risk flags (display only in v1): reciprocal referral rings, intro sent seconds before purchase, bursty one-visit accounts. Show flagged items in the venue dashboard.
- Be honest in docs: this raises the cost of cheating; it does not eliminate sybils.

### 2.7 Explicitly out of scope
Real card on-ramp (mock it, clearly labeled "testnet demo: simulated top-up"), real POS integration, refund clawbacks (document as future work; in v1, later refunds don't reverse rewards), multi-chain, mainnet, model training, ZK privacy, native mobile app, legal/tax compliance (state "prototype, not legal advice").

---

## 3. Technical design (starting point — architect may refine, must record changes in DECISIONS.md)

### 3.1 Stack
- **Contracts:** Solidity + **Foundry** (forge tests, fuzz/invariant tests, deploy scripts). OpenZeppelin for ECDSA/EIP-712 utilities.
- **Chain:** **Arc Testnet.** `VERIFY` in Phase 0 against official docs (docs.arc.network / docs.arc.io — beware lookalike sites): chain ID (expected **5042002**), RPC (expected `https://rpc.testnet.arc.network`, also a QuickNode endpoint), explorer (expected `https://testnet.arcscan.app`), faucet `https://faucet.circle.com`, and the **USDC token contract address and decimals**. Reports say native USDC gas uses **18 decimals** while the ERC-20 USDC interface uses **6** — confirm and handle explicitly; this is a classic bug source.
- **Monorepo** with pnpm workspaces:
  ```
  /contracts        Foundry project
  /apps/web         Next.js (App Router) + TypeScript + Tailwind, mobile-first; customer app + venue pages
  /apps/api         Node/TypeScript backend (Fastify or Next route handlers — architect decides), Postgres or SQLite via Prisma/Drizzle
  /packages/shared  ABIs, EIP-712 type definitions, shared types, constants (single source of truth)
  /scripts          seed data, demo scripts, eval harness
  /AGENTS           rolling context files (Section 4)
  ```
- **Chain client:** viem (preferred) in both web and api.
- **Wallets / UX:** passkey sign-in with an embedded wallet, no seed phrases. `VERIFY` in Phase 0 whether Circle's passkey/modular wallets work on Arc testnet. **Fallback (decide by end of Phase 0):** a browser-generated key encrypted at rest, unlocked by a WebAuthn/passkey gesture — clearly labeled demo-grade in docs.
- **Gas abstraction:** a backend **relayer** wallet submits transactions and pays gas in USDC; users sign EIP-712 messages only. `VERIFY` whether Arc's USDC supports EIP-2612 `permit` (lets the customer authorize the spend by signature). If not, use a one-time approval flow handled invisibly at onboarding.
- **Live data:** **QuickNode Streams** on Arc Testnet, filtered to our contract's events, delivered to a webhook on the api, which writes to the DB and fans out to clients via SSE/WebSocket. Backfill must be able to rebuild all derived state. `VERIFY` in Phase 0 that Arc is selectable in the Streams dashboard and that a test event reaches a webhook. Webhooks need a public HTTPS URL during development (e.g., a tunnel) — see Human Input.
- **AI:** an LLM API for attribution refinement behind a provider-agnostic interface. 🟥 human chooses provider and supplies the key. Feature must work fully with AI disabled.
- **Deployment:** web + api deployed somewhere judges can reach (e.g., Vercel for web; Railway/Render/Fly for api + Postgres). 🟥 human creates accounts.

### 3.2 Contract surface (sketch — CONTRACTS agent finalizes in INTERFACES.md)
- `registerVenue(payout, rewardBps, minOrder, attributor)` / `updateTerms(...)` → increments a **terms version**; emits `VenueRegistered`, `TermsUpdated`.
- `acceptIntro(Intro intro, sigReferrer, sigCustomer)` → requires referrer is a verified customer of the venue (or the venue itself / an allowlisted seed ambassador for bootstrapping — document this); stores edge with terms version; emits `IntroAccepted`.
- `pay(Order order, sigVenue, Weights w, sigAttributor, PaymentAuth auth)` → validates order sig + expiry + unused order id; pulls USDC from customer (permit or allowance); if first purchase and eligible → compute reward using the **intro's frozen terms**, apply weights (or fallback), split levels 1 and 2, remainder to venue; marks customer verified; updates ambassador counters; emits `PaymentSettled`, `RewardPaid` (per recipient), `CustomerVerified`.
- Read functions for ambassador record and venue stats.
- Use EIP-712 domain separation, nonces, expiries, `ReentrancyGuard`, checks-effects-interactions, custom errors. No upgradeability. No admin that can move user funds.

### 3.3 Required invariants (fuzz/invariant tests must prove)
- Sum of all transfers in `pay` == order amount, exactly, for any valid inputs and any attributor weights.
- Total reward ≤ `amount × rewardBps(frozen) / 10_000`.
- Only addresses with a valid accepted intro for (customer, venue) receive level-1 rewards; only their recorded introducers receive level-2.
- A customer is rewarded at most once per venue.
- Replay of an order id or intro nonce always reverts.
- Invalid/missing attributor signature → fallback rule applies (never a revert that blocks payment).

### 3.4 Events (Streams filter targets)
`VenueRegistered`, `TermsUpdated`, `IntroAccepted`, `PaymentSettled`, `RewardPaid`, `CustomerVerified`. Keep payloads sufficient to rebuild every derived view from events alone.

### 3.5 Scope tiers (cut from the bottom when time slips)
- **Tier 1 — must ship:** contract with pay-through split (levels 1+2, frozen terms, fallback attribution), invariant tests, deploy to Arc testnet; relayer; passkey-style onboarding; venue order QR; scan-to-pay; Streams → webhook → live feed; customer wallet screen in dollars; README with addresses + Streams config.
- **Tier 2 — should ship:** live money graph; "Who sent you here?" signal; baseline scoring with opens/link type; ambassador record page; venue dashboard with cost-per-verified-customer; Streams backfill replay demo; kill-the-backend demo.
- **Tier 3 — nice to have:** AI attribution refinement + eval harness; risk flags; minimal second frontend reading the same contract; friends' picks feed.

---

## 4. The `AGENTS/` folder — rolling context system

Create this in Phase 0 before any code:

```
AGENTS/
  README.md              Index: roster, what each file is, how to use them, current phase
  ORCHESTRATOR.md        Your own rolling context (same template)
  HUMAN_INPUT.md         Queue of everything the human must do/decide (status per item)
  DECISIONS.md           Append-only decision log: date, decision, reason, alternatives, who
  INTERFACES.md          Source of truth for cross-agent contracts: deployed addresses, ABIs location,
                         EIP-712 types, event schemas, API endpoints + request/response shapes,
                         env var names, webhook payload shape. Changes require a DECISIONS entry.
  PHASE_LOG.md           One section per phase: plan, delegated tasks, QE results, gate outcome
  ARCHITECT.md
  CONTRACTS.md
  CONTRACTS_QE.md
  BACKEND_RELAYER.md
  STREAMS_INFRA.md
  UI_DESIGN.md
  FRONTEND_INTEGRATION.md
  ATTRIBUTION_AI.md
  QE_E2E.md
  SECURITY_REVIEW.md
  DOCS_SUBMISSION.md
```

### 4.1 Template for every agent file (use exactly these headings)
```markdown
# <AGENT_NAME>
_Last updated: <ISO timestamp> by <agent> — Phase <n>_

## Mission
One paragraph: what this agent owns and the boundary of what it does NOT own.

## Owned paths
Files/directories this agent is responsible for.

## Current status
🟢 on track | 🟡 at risk | 🔴 blocked — one line why.

## Mental model (read this first)
How this area works today, in plain language: key flows, where state lives, how it connects
to other areas, non-obvious gotchas. Written so a brand-new agent can fix a bug here without
re-exploring the codebase. Keep it accurate; rewrite rather than append when it changes.

## Key files map
| Path | What it does | Notes |

## Interfaces consumed / provided
Pointers into INTERFACES.md sections, plus any local assumptions.

## Done (rolling, newest first)
- <date> — what was completed, with file paths and how it was verified.

## Next up
Ordered checklist of remaining work in this area.

## Struggles, open questions, known issues
What is hard, flaky, unverified, or hacked around — and the current workaround.

## How to run / test this area
Exact commands.

## Handoff notes
Anything the next agent in this area must know before touching it.
```

### 4.2 Rules for keeping files rolling
- **Every subagent's brief must require it to (a) read its own file, `INTERFACES.md`, `DECISIONS.md`, and the relevant section of `PHASE_LOG.md` before working, and (b) update its own file before returning.** A task is not complete until its file is updated.
- "Mental model" and "Key files map" are **rewritten to stay true**; "Done" is append-only (newest first); prune "Next up" as items finish. Keep each file under ~300 lines — summarize old "Done" entries if it grows.
- Agents may only edit their **own** file, plus append to `DECISIONS.md` and propose `INTERFACES.md` changes (the Orchestrator applies interface changes and notifies affected agents).
- After each phase, the Orchestrator audits every touched file for accuracy against the code (a QE subagent can spot-check: pick 3 claims per file and verify them).
- The goal: the human can later launch a fresh agent with *"Read AGENTS/FRONTEND_INTEGRATION.md and AGENTS/INTERFACES.md, then fix <bug>"* and it can work immediately.

---

## 5. Agent roster and how to brief them

### 5.1 Roster
| Agent | Owns | Never does |
|---|---|---|
| **ARCHITECT** | Repo layout, toolchain, shared package, INTERFACES.md drafts, tech spikes in Phase 0 | Feature code beyond scaffolding |
| **CONTRACTS** | Solidity, Foundry tests, deploy scripts, ABIs exported to `packages/shared` | Frontend/backend |
| **CONTRACTS_QE** | Independent adversarial review + extra fuzz/invariant tests of contracts | Edits contract logic (reports issues instead) |
| **BACKEND_RELAYER** | API, DB schema, relayer, order/intro signing endpoints, SSE fan-out | Contract logic |
| **STREAMS_INFRA** | QuickNode Streams config (via dashboard instructions or REST API), filter code, webhook handler, signature verification of webhooks if supported, backfill/replay tooling, deployment config | UI |
| **UI_DESIGN** | Design system (tokens, typography, components), screen designs, copy, motion, the money graph's visual design | Wiring to chain/API |
| **FRONTEND_INTEGRATION** | Wiring screens to API/chain, auth/passkey flow, QR scan/display, live updates, state management | Visual redesign (requests changes from UI_DESIGN) |
| **ATTRIBUTION_AI** | Scoring rule, AI refinement, attributor signing, eval harness, risk flags | Payment logic |
| **QE_E2E** | Test plans, end-to-end tests (e.g., Playwright on a mobile viewport), real-phone test checklists, bug reports | Fixing the code it tests (files bugs to owners) |
| **SECURITY_REVIEW** | Secrets hygiene, signature/replay review, relayer abuse limits, CORS/rate limits, dependency check | Feature work |
| **DOCS_SUBMISSION** | README, architecture diagram, Streams/Arc sections, Devpost answers, demo script, video shot list, pitch outline | Code |

You may spawn more than one instance of a role in parallel when work splits cleanly (e.g., two UI_DESIGN agents: one for customer screens, one for venue screens), but they share and must both update the one role file, coordinating by section.

### 5.2 Brief template (use for every delegation)
```
ROLE: <agent name>
PHASE: <n> — <phase name>
READ FIRST: AGENTS/<ROLE>.md, AGENTS/INTERFACES.md, AGENTS/DECISIONS.md, AGENTS/PHASE_LOG.md#phase-<n>
CONTEXT: <2–6 sentences of what matters for this task, including the product story if UI/UX>
TASK: <precise deliverable>
ACCEPTANCE CRITERIA: <bulleted, testable>
CONSTRAINTS: <owned paths only; no secrets; interface rules; style rules>
OUT OF SCOPE: <explicit>
VERIFY BY: <commands to run / what to show>
ON FINISH: update AGENTS/<ROLE>.md per template; append DECISIONS.md if you made a choice;
           list any proposed INTERFACES.md changes; report back: summary, files changed,
           verification evidence (command output), open issues, anything needing the human.
IF BLOCKED: stop and report the blocker precisely; do not guess at credentials or external facts.
```

### 5.3 Design direction for UI_DESIGN (the human chose "clean fintech")
- Minimal, calm, trustworthy — modern payments app feel. Generous whitespace, one restrained accent color, neutral grays, excellent typography (one sans family, tabular numerals for money), subtle motion.
- **Money is always shown in dollars** (`$12.00`), never "USDC," wallet addresses, hashes, or gas — except in an optional "Details" drawer and on the transparency page for judges.
- Mobile-first (design at 390px wide), large tap targets, one primary action per screen, clear success states with a short haptic-feeling animation.
- The money graph (venue dashboard) is the signature visual: nodes for venue/referrers/customer, animated flow along edges sized by amount, readable on a projector.
- Accessibility: WCAG AA contrast, visible focus states, reduced-motion support.
- Required screens: onboarding/sign-in; wallet home (balance, recent activity, "Top up (testnet demo)"); scan-to-pay; payment confirm (with cashback line + "Who sent you here?"); success; recommend/share (personal vs. public link); ambassador record; venue onboarding (set reward rate); venue order entry → QR display; venue live dashboard (feed + money graph + cost per verified customer); public transparency page (exact split formula, contract address, explorer links).
- Avoid generic template look. Produce the design system first (tokens + core components) and get the Orchestrator's sign-off before building screens.

---

## 6. Phases

Each phase: **Plan → Delegate (parallel where possible) → Integrate → QE (independent) → Update AGENTS files → Phase report → STOP for human.**

The phase report format:
```
## Phase <n> report
Status: complete | partial (why)
What was built: ...
Evidence: tests passing (counts), deployed addresses, screenshots/paths, commands
QE results: issues found / fixed / deferred
Scope changes: ...
Risks for next phase: ...
Time check: hours used vs. remaining to Fri 9:00 AM CST target
🟥 HUMAN INPUT NEEDED: numbered list (or "none")
Proposed next phase plan: ...
```

---

### Phase 0 — Bootstrap, verification spikes, and human setup  *(target: Sun night → Mon morning, ~3–4h)*
**Goal:** prove every risky external dependency works before building on it.

1. Create repo structure, `git init`, `.gitignore` (node_modules, .env*, out/, cache/, broadcast/ secrets), pnpm workspace, `AGENTS/` folder with all files initialized from the template, `HUMAN_INPUT.md` populated.
2. ARCHITECT spikes (each result → `DECISIONS.md` with evidence):
   - **S1 Arc network facts:** chain ID returned by RPC, explorer, USDC token address and decimals from official docs; whether USDC supports `permit` (EIP-2612); any EVM differences listed in Arc's Solidity migration docs that affect us.
   - **S2 Hello contract:** deploy a trivial contract with Foundry to Arc testnet that emits an event and does a USDC `transferFrom`; confirm on explorer.
   - **S3 Streams:** create a Stream on Arc testnet filtered to the hello contract's event, delivered to a webhook; confirm the event arrives; confirm backfill from a past block works. Record the exact configuration steps.
   - **S4 Wallet approach:** test Circle passkey/modular wallets on Arc testnet; if not workable within ~1 hour, adopt the fallback (Section 3.1) and record the decision.
   - **S5 Relayer:** relayer submits a tx on behalf of a user-signed EIP-712 message; measure gas cost in USDC for a 7-recipient transfer batch.
   - **S6 Mobile camera:** a bare page that scans a QR via the browser camera over HTTPS on a real phone (human runs it — see Human Input).
3. Draft `INTERFACES.md` v0 (EIP-712 types for Intro, Order, Weights; event list; API endpoint list).

**QE gate:** a QE subagent re-runs S1–S3 from the recorded instructions alone and confirms they reproduce.
**Exit criteria:** all six spikes have a recorded outcome (pass, or fail + chosen workaround). If S3 fails, STOP and escalate to the human — the QuickNode bounty plan depends on it.

🟥 **Human input expected in Phase 0** (put in `HUMAN_INPUT.md`):
- Confirm project name (or approve one of 3–5 names you propose with one-line rationale each).
- Create a **QuickNode** account and an **Arc testnet endpoint**; paste the endpoint URL into `.env` (never in chat if avoidable — tell the human the exact variable name).
- Generate or provide a **deployer/relayer private key** (Orchestrator can generate one locally with `cast wallet new` and write it to `.env`; human must fund it). Fund the deployer, relayer, and 3–5 demo wallets at **https://faucet.circle.com** (Arc Testnet; limited per address per 2 hours — plan funding early).
- Provide a public HTTPS tunnel or deploy target for the webhook (e.g., install/authorize a tunnel tool, or create a Railway/Render/Fly account).
- Choose LLM provider + key for Tier 3 (can be deferred to Phase 4).
- Run spike S6 on their own phone and report the result.
- Confirm a GitHub repo name and create the public repo (or authorize `gh`).

---

### Phase 1 — Contracts  *(target: Mon, ~6–8h)*
**Parallel tracks:** CONTRACTS builds; UI_DESIGN starts the design system (Phase 3 prep) simultaneously since it has no dependency.

CONTRACTS:
- Implement Section 3.2 surface with EIP-712, nonces, expiries, frozen terms, fallback attribution, two-level split, remainder handling, verified-customer and ambassador counters.
- Unit tests for the canonical story (Section 2.3) with exact expected payouts: $12.00 → $10.20 / $0.45 / $0.69 / $0.30 / $0.25 / $0.11 (adjust if rounding rule differs; document the rule).
- Fuzz + invariant tests for every invariant in 3.3.
- Gas report; deploy script; deploy to Arc testnet; verify source on explorer if supported; export ABIs + addresses to `packages/shared`; update `INTERFACES.md`.

CONTRACTS_QE (independent, after CONTRACTS reports done):
- Adversarial review: replay, signature malleability, cross-venue intro reuse, self-referral, reentrancy via token callbacks, decimal mistakes, rounding drift, griefing the payment by bad weights, order expiry edge cases, introducer cycles (A→B→A).
- Write additional failing tests for anything found; file issues to CONTRACTS; re-verify fixes.

UI_DESIGN (parallel): design tokens, typography, color, core components (Button, AmountDisplay, Card, ListItem, Sheet, Toast, QRFrame), and low-fi layouts of all required screens; deliver as a running Storybook-like route (`/design`) in `apps/web`.

**Exit criteria:** all tests green including invariants (paste counts); contract deployed with address in `INTERFACES.md`; QE findings resolved or explicitly deferred with reason; design system approved by Orchestrator.
🟥 Human: approve the design system direction (screenshots/paths in the report) before screens are built.

---

### Phase 2 — Backend, relayer, Streams pipeline  *(target: Mon night → Tue, ~6–8h)*
BACKEND_RELAYER:
- DB schema (users, wallets, venues, terms, orders, intros, link opens, payments, rewards, events cursor).
- Endpoints: auth/session; venue register/update terms; create order (venue-signed); create intro link (personal/broadcast); record link open; accept intro (collect signatures, relay tx); quote payment (computes split preview + attribution weights + attributor signature using **baseline** rule); submit payment (relay); read endpoints for wallet, activity, ambassador record, venue stats.
- Relayer: nonce management, retries, per-user and global rate limits, max-gas guard, clear error mapping to user-friendly messages.
- SSE/WebSocket channel per user and per venue.

STREAMS_INFRA:
- Production Stream on Arc testnet filtered to our contract address and the six events; destination = api webhook; idempotent handler keyed by (txHash, logIndex); ordered processing; reorg safety per Streams docs.
- **All derived views are built from Streams events**, not from relayer responses (the relayer may optimistically show "pending," but "settled" comes from Streams). This is what makes Streams core.
- Backfill/replay script: wipe derived tables → backfill from deployment block → assert identical state (hash of derived tables). Save the exact Stream config (network, dataset, filter code, destination) to `AGENTS/STREAMS_INFRA.md` and a draft README section.

**QE gate (QE_E2E + SECURITY_REVIEW in parallel):** API contract tests against `INTERFACES.md`; scripted end-to-end flow on testnet from CLI (register venue → intro → pay → event arrives via Streams → DB correct); replay determinism test passes; secrets/rate-limit review.
**Exit criteria:** a CLI script runs the full canonical story on Arc testnet and the DB reflects it via Streams within seconds.
🟥 Human: confirm the webhook public URL is reachable; may need to click through the QuickNode dashboard if the REST API can't create the Stream (give exact steps).

---

### Phase 3 — Frontend: customer + venue apps  *(target: Tue → Wed, ~8–10h)*
Run **two UI_DESIGN instances** (customer screens; venue screens) building hi-fi screens from the approved system, and **FRONTEND_INTEGRATION** wiring them as screens land.
- Onboarding with passkey gesture → embedded wallet created invisibly.
- Wallet home in dollars; testnet "Top up" (faucet-backed or relayer-funded demo top-up, clearly labeled).
- Venue: onboarding (reward rate slider with live example), order entry → signed-order QR (auto-refresh before expiry), live feed.
- Customer: scan-to-pay via camera → confirm sheet with cashback line + "Who sent you here?" → success animation; recommend flow (personal vs public link, share sheet); ambassador record.
- Live updates via SSE; optimistic "pending" → "settled" from Streams.
- Error states for: expired order, insufficient balance, relayer down, already rewarded.

**QE gate:** QE_E2E runs Playwright at 390×844 for the full story with two browser contexts (venue + customer), plus a **real-phone checklist the human executes** (camera scan, passkey prompt, add-to-home-screen, live update latency). UI_DESIGN does a visual QA pass against the design system (spacing, type, contrast, motion, no crypto jargon on primary screens).
**Exit criteria:** the human can run the canonical story on two real devices end to end.
🟥 Human: execute the real-phone checklist and report results; approve the look before Phase 4.

---

### Phase 4 — Attribution, money graph, dashboards  *(target: Wed, ~6–8h)*
- ATTRIBUTION_AI: full baseline scoring (link type, opens, recency, customer answer); attributor signing; on-chain fallback parity notes; **Tier 3:** LLM refinement with strict schema + timeout + fallback + one-line explanation, venue opt-in toggle; eval harness with 20–30 scenarios and a results table; basic risk flags.
- UI_DESIGN + FRONTEND_INTEGRATION: the **money graph** (animated, projector-readable), venue dashboard metrics (verified new customers, rewards paid, **cost per verified customer** vs. a configurable "typical ad cost" input), transparency page (formula, contract address, explorer links), attribution explanation display.

**QE gate:** eval harness reproducible from one command; graph tested with seeded data at 5, 20, 60 nodes; AI-disabled mode fully functional; invariants still green (attributor can't break bounds — add a test that feeds adversarial weights through the real API path).
🟥 Human: provide LLM API key (or explicitly drop Tier 3 AI); decide whether to keep AI in the demo.

---

### Phase 5 — Hardening, demo choreography, deployment  *(target: Thu, ~8h)*
- Deploy web + api publicly; Stream points at the deployed webhook; smoke test from a phone on cellular data.
- **Seed script:** 2–3 venues, ~10 personas, realistic intros and payments so the graph looks alive; plus a clean "stage" venue for the live demo.
- **Demo features:**
  - *Judges join live:* a QR on the pitch slide opens onboarding; a judge receives a seeded intro and can make a tiny purchase from a pre-funded demo wallet.
  - *Kill the backend:* a script that pays the contract directly (no api) and shows the split still settles (explorer + Streams catch-up when api returns).
  - *Replay:* wipe derived DB → backfill via Streams → identical graph.
  - Optional Tier 3: a tiny second frontend page reading the same contract.
- Full regression: QE_E2E reruns everything; SECURITY_REVIEW final pass (secrets in git history, exposed keys in client bundle, relayer drain limits, CORS); performance check of live update latency.
- Measure and record: gas cost in USDC of a full 2-level split; end-to-end latency from tap to settled.

**Exit criteria:** a fresh clone + README instructions reproduces local setup; deployed app runs the full story; demo scripts rehearsed by QE from written steps.
🟥 Human: rehearse the live demo on their own phone; confirm deployed URLs; record any real pilot data (optional: a few friends making real testnet purchases).

---

### Phase 6 — Submission package  *(target: Thu night → Fri 9:00 AM CST)*
DOCS_SUBMISSION produces (drafts reviewed by Orchestrator, facts checked by QE against code and chain):
- **README:** one-liner, problem, demo links, screenshots/GIF, architecture diagram (Mermaid), how it works (the canonical story with numbers), **How we use Arc** (USDC gas, measured costs, contract addresses + explorer links), **QuickNode Streams configuration** (network, dataset, filter code, destination, why, replay/backfill), contract design + invariants, attribution method + eval results, security model and honest limits, setup instructions, env var table, future work (refund clawbacks, real on-ramp, POS integration, cross-venue discovery), "prototype, not legal advice."
- **Devpost answers** to the five required questions, technologies list, track/award/bounty selections (Consumer Applications; Best use of Arc; QuickNode Streams).
- **Demo video script (2:30 max)** with a shot list and on-screen captions — hook (Lena's ad problem) → live payment splitting → money graph → why chain (frozen terms, atomic split, kill-backend) → Streams replay → close.
- **5-minute pitch outline** + likely Q&A with crisp answers (why a chain? pyramid concerns? adoption? fraud? why Arc?).
- Final checklist pass against Section 1's required items.

🟥 Human: **record and upload the demo video** (YouTube unlisted or Drive with link access), make the GitHub repo public, **submit on Devpost** before Fri 12:00 PM CST (target 9:00 AM), and opt into the Arc award and QuickNode bounty.

---

## 7. Human input protocol

- Maintain `AGENTS/HUMAN_INPUT.md` as a table: `# | Phase | What is needed | Why | Exact steps | Blocking? | Status`.
- In every phase report, put a section titled **`🟥 HUMAN INPUT NEEDED`** at the top if anything is pending, with numbered, copy-pasteable instructions (URLs, env var names, commands).
- Never ask the human for things you can do or look up yourself. Never ask them to paste secrets into chat when writing to `.env` works — tell them the exact variable name and file.
- If the human is unresponsive and a non-blocking choice is needed, take the most reasonable default, record it in `DECISIONS.md`, and flag it in the next report. Never take an irreversible action (making the repo public, submitting, spending real money) without explicit approval.

---

## 8. Quality bar and QE philosophy

- **Builder ≠ verifier.** Every phase's QE is done by a different subagent than the builder, briefed with acceptance criteria, not with the builder's summary.
- **Evidence over assertion:** test output, explorer links, screenshots saved under `docs/evidence/phase-<n>/`.
- **Money correctness is sacred:** any change to split logic re-runs the full invariant suite.
- **No crypto jargon on primary screens** (QE checks copy: no "USDC," "gas," "wallet address," "transaction hash," "sign" outside the Details drawer and transparency page).
- **Demo resilience:** every live-demo step has a fallback (pre-recorded clip, seeded state, CLI script).
- Track time honestly in `ORCHESTRATOR.md`. If a phase overruns by >25%, propose scope cuts from Tier 3 → Tier 2 before continuing.

---

## 9. Start now

1. Read this whole prompt. Restate, in under 15 bullets in your first message, the product, the targets, the phases, and the Phase 0 plan.
2. Create the repo skeleton and the full `AGENTS/` folder with every file initialized from the template (fill Mission, Owned paths, and Next up for each role from this prompt; copy the product story into `AGENTS/README.md`).
3. Populate `AGENTS/HUMAN_INPUT.md` with the Phase 0 items.
4. Propose 3–5 project names.
5. Launch the Phase 0 spikes you can run without human input (S1 research, repo scaffolding, local Foundry setup) in parallel.
6. Then stop and deliver the Phase 0 report with the `🟥 HUMAN INPUT NEEDED` section. Do not begin Phase 1 until the human says go.

---
---

# Amendments (later instructions from the human, in order — these override the original where they conflict)

### A1 — 2026-11-16 (after the Phase 0 report)
- Inputs: QuickNode Streams API key placed in `.env` as `QUICKNODE_STREAMS_API_KEY`. Credits/block figure: not provided (stay on the free plan unless the math says otherwise). All six wallets funded. **Name: Vouch.** Create the GitHub repo as **`vouch` (private)**. **Level-2 rule approved as proposed, frozen at the referrer's first purchase.**
- Restart the tunnel and give a fresh URL for the phone tests.
- Finish S2 (testnet deploy), S5 (testnet relayer run), and S3 (live Stream on Arc testnet starting from the deployment block, with an HMAC-verified webhook; **pause it when idle**).
- Run the Phase 0 QE gate with a fresh agent reproducing S1–S3 from the written steps.
- Add a script that tops up demo wallets from DEPLOYER.
- **In Phase 1, have CONTRACTS_QE explicitly test that `receiveWithAuthorization` is called by the payee contract.**
- Report back and wait for "go" on Phase 1.

### A2 — 2026-11-16 (Phase 1 go + comms protocol)
- New QuickNode key saved to `.env` as `QUICKNODE_STREAMS_API_KEY` (no quotes). Confirm it is sent as the `x-api-key` header to `https://api.quicknode.com/`. **If it still returns 403, stop and tell the human instead of retrying.**
- Credits per block: unknown → stay on the free plan, keep the backfill small, pause the stream when idle.
- Phone tests: the human runs them on the fresh tunnel and reports separately.
- **Level-2 rule: per customer per venue is correct. Confirmed.**
- **Go Phase 1.** Run CONTRACTS and UI_DESIGN in parallel, then CONTRACTS_QE independently. Finish S3 live (with QE Part B) in parallel now that the key is updated.
- **New requirement: inter-agent communication.** Set this up before launching Phase 1 agents, and record it in `AGENTS/README.md` and `DECISIONS.md`:
  - **Inboxes:** create `AGENTS/INBOX/<ROLE>.md` per role. Messages use the header `### [MSG-###] <timestamp> FROM: <role> TO: <role> | type: question/request/fyi/blocker/answer | status: open/answered/closed`, followed by the body and file paths. Keep a global counter and a list of open messages in `AGENTS/INBOX/_INDEX.md`.
  - **Rules:** every agent reads its inbox first, answers or acknowledges what's addressed to it, posts questions and handoffs to the recipient's inbox instead of guessing, and lists messages sent and unresolved in its report.
  - **Direct relays:** the Orchestrator relays anything blocking right away, using SendMessage to resume the recipient agent when possible, or quoting the message in the next brief for that role. Keep `AGENTS/AGENT_REGISTRY.md` mapping roles to agent IDs, phase, and status.
  - **Handoff packets:** when one agent's output feeds another (ABI and addresses, design components), the producer writes a handoff in the consumer's inbox: what changed, where it is, how to use it, and known gaps. Interface changes still go through `INTERFACES.md` and a `DECISIONS.md` entry.
  - **Gate rule:** route or resolve open messages after each agent returns. **No phase gate passes with an open blocker.** Add a **"Comms"** section to every phase report.
  - **QE:** QE agents file bugs as messages to the owner's inbox, and the owner marks them answered with the fix commit.
- Report back at the end of Phase 1 and wait for "go" on Phase 2.

### A3 — 2026-11-16 (S3 via the QuickNode dashboard)
- The Streams REST API is blocked on QuickNode trial plans (a brand-new account with an Admin key still gets `403 {"message":"Insufficient permissions","name":"AuthorizationError"}`, and `qn auth login` fails the same way). The dashboard Create Stream wizard works, and Arc Testnet is available. **Log this as a decision and switch S3 to dashboard creation.**
- Keep the API running with the HMAC-verified webhook and the tunnel up; give the full webhook URL and confirm it responds.
- Give exact wizard values in order (Stream range: name, network Arc/Testnet, "start at specific block #", end = run continuously, latest block delay; Stream dataset: Logs, exact filter code, expected test-filter output; Stream destination: Webhook, URL, compression, retries/timeout, where to find the security token). Create the stream **paused** (or pause immediately). Human puts the token in `.env` as `STREAMS_WEBHOOK_SECRET` and sends the stream ID.
- After the human replies **"stream created <ID>"**: restart the API so it loads the token, tell the human when to activate it, verify backfill events arrive and the webhook rejects unsigned requests, send a live ping, then tell the human to pause it. Run **QE Part B with a fresh agent** following the updated runbook.
- Docs: `docs/streams/S3-RUNBOOK.md`, `AGENTS/STREAMS_INFRA.md`, `AGENTS/HUMAN_INPUT.md`, and the README's Streams section describe dashboard creation (it fully qualifies for the bounty). **The human pauses/resumes the stream manually in the dashboard; the webhook URL must be updated in the dashboard if the tunnel changes (stable once deployed in Phase 5).**
- Put the checklist under 🟥 HUMAN INPUT NEEDED, numbered, with copy-pasteable values.

### A4 — 2026-11-16 (handoff before a context reset)
- Save this prompt verbatim plus these amendments to `AGENTS/ORCHESTRATOR_PROMPT.md`. Rewrite `AGENTS/ORCHESTRATOR.md` as a complete handoff. Make sure `AGENT_REGISTRY.md`, `HUMAN_INPUT.md`, `PHASE_LOG.md`, `DECISIONS.md`, and `INBOX/_INDEX.md` are current. Commit only those `AGENTS/` files and push. Reply "handoff complete" with the commit hash and the list of background processes that will die when the session ends.
