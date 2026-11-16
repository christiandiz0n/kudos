# AGENTS/ — rolling project memory
_Last updated: 2026-11-15T21:30:00-05:00 by ORCHESTRATOR — Phase 0_

**Current phase:** Phase 0 — Bootstrap, verification spikes, human setup
**Display name:** **Vouch** (`APP_NAME` in `packages/shared/src/constants.ts`; package scope `@vouch/*`; D-007)
**Deadline:** submit by Fri Nov 20, 2026 12:00 PM CST (target 9:00 AM CST)

## How to use this folder
- Every agent: before working, read **your role file**, `INTERFACES.md`, `DECISIONS.md`, and your phase section of `PHASE_LOG.md`. Before returning, **update your role file** (template headings, unchanged).
- "Mental model" and "Key files map" are rewritten to stay true. "Done" is append-only, newest first. Prune "Next up". Keep files under ~300 lines.
- Agents edit only their own file, append to `DECISIONS.md`, and *propose* `INTERFACES.md` changes. The Orchestrator applies interface changes.
- Fresh agent, cold start: *"Read AGENTS/<ROLE>.md and AGENTS/INTERFACES.md, then fix <bug>."*

## Files
| File | Purpose |
|---|---|
| `README.md` | This index + product story |
| `ORCHESTRATOR.md` | Orchestrator's rolling context + time tracking |
| `HUMAN_INPUT.md` | Queue of everything only the human can do/decide |
| `DECISIONS.md` | Append-only decision log |
| `INTERFACES.md` | Source of truth: addresses, ABIs, EIP-712 types, events, API, env vars, webhook payload |
| `PHASE_LOG.md` | Per-phase plan, delegations, QE results, gate outcome |
| `<ROLE>.md` | One per agent role (below) |

## Roster
| Agent | Owns | Never does |
|---|---|---|
| ARCHITECT | Repo layout, toolchain, `packages/shared`, INTERFACES drafts, Phase 0 spikes | Feature code beyond scaffolding |
| CONTRACTS | Solidity, Foundry tests, deploy scripts, ABI export | Frontend/backend |
| CONTRACTS_QE | Adversarial review + extra fuzz/invariant tests | Edits contract logic |
| BACKEND_RELAYER | API, DB, relayer, signing endpoints, SSE | Contract logic |
| STREAMS_INFRA | Streams config, filter, webhook, backfill, deploy config | UI |
| UI_DESIGN | Design system, screens, copy, motion, money graph visuals | Wiring to chain/API |
| FRONTEND_INTEGRATION | Wiring screens, passkey flow, QR, live updates | Visual redesign |
| ATTRIBUTION_AI | Scoring, AI refinement, attributor signing, eval, risk flags | Payment logic |
| QE_E2E | Test plans, E2E, phone checklists, bug reports | Fixing code it tests |
| SECURITY_REVIEW | Secrets, signatures/replay, relayer limits, CORS | Feature work |
| DOCS_SUBMISSION | README, diagrams, Devpost, demo script, pitch | Code |

## Repo layout
```
/contracts        Foundry project
/apps/web         Next.js (App Router) + TS + Tailwind, mobile-first (customer + venue)
/apps/api         Node/TS backend + DB
/packages/shared  ABIs, EIP-712 types, shared types, constants (single source of truth)
/scripts          seed, demo, spikes, eval harness
/docs             architecture, evidence/phase-<n>/, qa/, security/
/AGENTS           this folder
```

---

## Product story (canonical — every agent should know this)

**One-liner:** A pay-per-verified-customer marketing network for local businesses: customers pay in USDC, and the sale itself instantly pays the people whose recommendations brought them in.

**Problem:** Small businesses spend on ads they can't attribute, while their real growth comes from word of mouth that earns recommenders nothing. Referral programs exist, but small businesses can't build them (software, fraud control, payouts), and platforms that run them take a cut and can change terms anytime.

**How it works:**
1. **Lena's café** registers as a venue and sets a reward rate for a customer's **first** purchase, e.g. **15% of the sale**. Terms are on-chain and versioned.
2. **Ana**, an existing verified customer, taps **Recommend** and sends **Ben** a personal link carrying a signed **Intro** (referrer, venue, terms version, timestamp, nonce). Ben opens it while signed in and **countersigns**, binding the intro to him. Ben may hold intros from several people (coworker **Priya** sent a group-chat link).
3. At the counter, staff key in Ben's order (**$12.00**). The venue screen shows a QR with a **venue-signed Order** (venue, amount, order id, expiry).
4. Ben scans, sees *"Pay $12.00 — you'll get $0.45 back,"* confirms with a passkey. Optionally answers *"Who sent you here?"*
5. **One atomic transaction** splits $12.00:
   - Reward pool = 15% × $12.00 = **$1.80**
   - 25% of pool → Ben (welcome cashback) = **$0.45**
   - 55% of pool → direct referrers by weight (Ana 70% / Priya 30%) = **$0.99** → Ana $0.693, Priya $0.297
   - 20% of pool → the referrers' introducers (level 2), same proportions = **$0.36**
   - Remainder → venue = **$10.20**
   - Undistributable shares (e.g. referrer with no introducer) **return to the venue**. Integer base units; payouts sum **exactly** to the sale.
6. Everyone's screen updates within seconds; Lena's dashboard animates a **money graph** through the referral chain.
7. Ben is now a **verified customer** and can recommend the venue. Ana's **ambassador record** grows; she owns it.
8. Repeat purchases by Ben are plain payments, no reward.

**Why the chain is essential:** atomic pay-through (venue can't skip referrers); frozen terms per intro; recommendations gated by verified on-chain purchases; user-owned portable ambassador record; no operator required ("kill the backend" demo); on Arc, USDC is gas → a 7-way split of $12 costs a tiny, predictable dollar amount.

**Attribution:** baseline score = `linkTypeWeight × (1 + 0.25 × opens) × recencyDecay` (personal = 2, broadcast = 1, half-life 3 days), blended with the customer's "Who sent you here?" answer; optional AI refinement (venue opt-in) with strict schema + fallback. **Contract bounds regardless of proposer:** weights sum to 10,000 bps; every recipient holds a valid countersigned unexpired intro for this customer+venue; max 5 direct referrers; per-recipient cap 8,000 bps unless single; total ≤ venue reward. Weights are signed by the venue's authorized attributor key; invalid/missing → on-chain fallback rule.

**Fraud basics:** one reward per customer per venue ever; minimum order for rewarded first purchase; no self-referral; backend risk flags (display only).

**Out of scope:** real on-ramp (mocked, labeled "testnet demo: simulated top-up"), real POS, refund clawbacks, multi-chain, mainnet, model training, ZK, native app, legal/tax.

**Targets:** Consumer Applications track · Best use of Arc · QuickNode Streams bounty. Judged on Technical Execution, Product & UX, Innovation, Impact, Demo.

## Scope tiers (cut from the bottom)
- **Tier 1:** contract (L1+L2 split, frozen terms, fallback attribution), invariant tests, Arc deploy; relayer; passkey-style onboarding; venue order QR; scan-to-pay; Streams → webhook → live feed; wallet in dollars; README with addresses + Streams config.
- **Tier 2:** money graph; "Who sent you here?"; baseline scoring with opens/link type; ambassador record; venue dashboard with cost-per-verified-customer; backfill replay demo; kill-the-backend demo.
- **Tier 3:** AI refinement + eval harness; risk flags; second frontend; friends' picks feed.
