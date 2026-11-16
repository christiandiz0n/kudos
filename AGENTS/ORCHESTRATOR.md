# ORCHESTRATOR
_Last updated: 2026-11-15T23:20:00-05:00 by ORCHESTRATOR — Phase 0_

## Mission
Plans each phase, delegates to subagents with self-contained briefs, integrates results, launches independent QE, keeps AGENTS/ files true to the code, maintains HUMAN_INPUT.md, and stops at every phase gate for the human. Does not write most feature code; does not mark a phase done on a builder's word.

## Owned paths
- `AGENTS/README.md`, `AGENTS/ORCHESTRATOR.md`, `AGENTS/HUMAN_INPUT.md`, `AGENTS/PHASE_LOG.md`
- Applies changes to `AGENTS/INTERFACES.md`

## Current status
🟡 at risk (mildly): Phase 0 is PARTIAL. All non-human work is done. S2/S3/S5 testnet runs, the S6 phone test and the QE gate are waiting on HUMAN_INPUT #1–#4.

## Mental model (read this first)
- Phase 0 state: monorepo scaffolded and committed; Arc facts verified (INTERFACES §1); EIP-712/events/API v0 drafted (INTERFACES §3–§7); wallet approach decided (D-104); payment auth = EIP-3009 receiveWithAuthorization (D-103).
- **Secrets:** a PreToolUse hook blocks any agent Bash referencing `.env`. Keys are created by the human running `scripts/setup/gen-env.py` (D-004). Briefs must tell agents never to read `.env`. Public addresses are in `packages/shared/src/wallets.public.json`.
- **Running processes (this session):** web prod server on :3100 (`next start`, started detached) and the cloudflared quick tunnel https://municipality-shade-script-associates.trycloudflare.com → :3100 (harness background task). Port 3000 = an unrelated next-server, don't touch it (D-006).
- Foundry at `~/.foundry/bin` (not on PATH by default).
- When the human finishes #1–#3: run S2 deploy → S5 testnet → start the api + tunnel on :4000 → create the S3 Stream via REST (recipe in research evidence §S3.3) → verify event + backfill → launch the QE subagent to re-run S1–S3 from the docs alone → close Phase 0.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| — | — | — |

## Interfaces consumed / provided
See `AGENTS/INTERFACES.md`. Relevant sections to be filled as they are defined.

## Done (rolling, newest first)
- 2026-11-16 — Phase 1 done (contracts gate PASS; design approval pending). Comms system (D-009). Vouch v2 0x9C50…b95f. S3 switched to dashboard creation (D-011); API on :4000 + tunnel https://rankings-brunette-tubes-patch.trycloudflare.com waiting for the human's stream. **Lesson:** stage only my own paths while agents run (one commit swept in mid-flight agent files). The phone tunnel died after a network change; quick tunnels are fragile.
- 2026-11-16 — Phase 0 continued: renamed to Vouch (D-007); L2 rule D-008; private repo github.com/christiandiz0n/vouch; S2 + S5 PASS on Arc testnet; STREAMS_INFRA built the HMAC webhook, filter, CLI and runbook; ARCHITECT built the top-up script ($1 real proof); QE gate Part A run and its 15 defects fixed or documented; **S3 live blocked: QuickNode key 403.**
- 2026-11-15 23:20 — Phase 0 (partial): AGENTS/ initialized; 2 ARCHITECT agents done (research + scaffold); merged INTERFACES §1; independently re-verified tests + Arc facts; built `/spike/passkey`; wrote + tested `scripts/setup/gen-env.py`; installed cloudflared; tunnel live; HUMAN_INPUT populated.
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] Human: #1 keys, #2 funding, #3 QuickNode key, #4 phone tests, #5 name, #6 repo
- [ ] S2 deploy Hello to Arc testnet + explorer confirm
- [ ] S5 testnet run (real gas cost in USDC)
- [ ] S3 live: Stream (logs, filter on Hello Ping/Split) → tunnel → api webhook stub; backfill from the deploy block
- [ ] Phase 0 QE gate (fresh subagent, instructions only)
- [ ] On "go": Phase 1 = CONTRACTS + UI_DESIGN in parallel; then CONTRACTS_QE

## Struggles, open questions, known issues
- Streams credit budget on the Free plan is uncertain (D-105). We need the Arc multiplier from the human.
- PRF availability on the demo phone is unknown → S6b.
- Proposed L2 rule (introducer = top-weight L1 referrer at first purchase) needs a CONTRACTS decision in Phase 1.
- Quick-tunnel URLs change on restart, so a stable host is needed by Phase 2 (HUMAN #8).

## How to run / test this area
_TBD once code exists._

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.

## Time tracking
| Phase | Target | Used | Notes |
|---|---|---|---|
| 0 | 3–4 h | ~3.5 h (Sun 21:30–23:20 + Mon session) |
| 1 | 6–8 h | ~2.5 h wall-clock (Mon 11:40–14:10 ET, parallel agents) | | Remaining work waits on the human; ~1 h of agent work left after the inputs |
Budget: ~40–50 h to Fri 9:00 AM CST (10:00 AM ET). Next: Phase 1 Mon (6–8 h).
**Comms (D-009):** before working, read `AGENTS/INBOX/ORCHESTRATOR.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
