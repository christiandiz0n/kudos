# DOCS_SUBMISSION
_Last updated: 2026-11-18T23:59:00-05:00 by DOCS_SUBMISSION — Phase 6 (pulled forward, A7), session 3_

## Mission
Owns the submission package: the README (architecture diagram, How we use Arc, QuickNode Streams configuration, contract design + invariants, attribution, security model + honest limits, setup, env table, future work), the Devpost answers, the demo video script + shot list, and the 5-minute pitch outline + Q&A. Does NOT write code.

## Owned paths
- `README.md`
- `docs/submission/**`
- `docs/` (except `docs/qa/`, `docs/security/`, `docs/evidence/`); in practice only `docs/submission/` so far

## Current status
🟢 **All five drafts written, uncommitted** (the Orchestrator commits). The remaining items are human-only: the video URL, the author line, making the repo public, the Devpost opt-ins, and checking that the Mermaid diagram renders on GitHub.

## Mental model (read this first)
- **Facts come from evidence, never from memory.** Every measured number in the README carries an HTML comment `<!-- evidence: … -->` naming its source (a `cast receipt`, a `docs/qa/*` report, or a `docs/evidence/*` file). If you change a number, re-derive it and update the comment.
- **Canonical on-chain proof is tx `0x40147554…ddfcb`** (block 72,890,535, hosted api + live Stream, Part B). It has the exact 12.00 → 10.20 / 0.45 / 0.693 / 0.297 / 0.252 / 0.108 split. In that run the L2 recipients were the story script's "Sam" (Ana's introducer) and Ana (Priya's introducer); the transparency page uses the same names. The seed plan uses Marco and Sofia instead (D-606), so the README says "whoever introduced Ana/Priya".
- **The README screenshots are from the QE run** (a $1.00 order at 20%, "QE Lena's café 03:48"), not the $12 story, and they are captioned that way.
- **Cut items (A7) are never claimed:** AI attribution, eval harness, risk flags, second frontend, friends feed. There is also no in-app kill-the-backend button; self-submit is proven only by tx `0xfca0e1ae…` and the CLI `smoke:canonical -- --self-submit`.
- **The Devpost "What did you build / problem" answers avoid jargon.** Technical terms appear only in "How does it work?" and below.

## Key files map
| Path | What it does | Notes |
|---|---|---|
| `README.md` | Full submission README | Mermaid architecture; Arc gas table; Streams section incl. condensed filter; invariants; limits; setup; env names from `.env.example` |
| `docs/submission/DEVPOST.md` | Name, tagline, 5 answers, tech list, tracks, links, judge quick start | `<VIDEO_URL>`, `<AUTHOR_NAME>` placeholders |
| `docs/submission/VIDEO_SCRIPT.md` | 2:28 script, prep P1–P9, shot list, captions, fallbacks F1–F7 | Live run uses a 20% venue, $2.00 order → $1.60 / $0.10 / $0.22 / $0.08 |
| `docs/submission/PITCH.md` | 5-min outline + 12 Q&A answers | |
| `docs/submission/CHECKLIST.md` | §1 required items with status + human steps | |
| `docs/streams/README-streams-draft.md` | STREAMS_INFRA's draft (MSG-066) | Source for the README Streams section |

## Interfaces consumed / provided
Consumes: INTERFACES §1–§7, D-0xx/D-1xx/D-3xx/D-5xx/D-8xx/D-9xx, `packages/shared/src/deployments.ts`, `docs/streams/filter-vouch.js`, `infra/streams/stream-vouch-prod.json`, `docs/qa/*`, `docs/evidence/phase-2/qe/*`, `docs/evidence/phase-3/qe/*`. Provides: nothing to code.

## Done (rolling, newest first)
- 2026-11-18 (session 3) — Phase 6 drafts, verified against the chain and the evidence:
  - **`cast receipt`** (rpc.testnet.arc.io):
    - `0x40147554…` status 1, block 72,890,535: 375,553 gas × 22.8 gwei = **0.0085626084 USDC**; transfers 12.00 in, 0.45 / 0.693 / 0.297 / 0.252 / 0.108 / 10.20 out.
    - `0x67fd5b7a…` block 72,957,389: 321,489 × 25 gwei = **0.008037225**; 1.00 in, 0.05 / 0.11 / 0.84 out, plus `RewardReturned` 0.04.
    - Self-submit `0xfca0e1ae…` block 72,606,174, from customer `0xb333…2344`: 371,065 × 25 gwei = **0.009276625**.
    - Relayed smoke `0x95cbda97…`: 409,801 gas (not used in the README).
  - **Other chain reads:** `cast codesize` v3 = 23,998; chain-id 5042002; USDC `decimals()` = 6; Blockscout API `is_verified` true (partial).
  - **Live endpoints:** vouch-ubc.vercel.app 200, `/transparency` 200, api `/health` ok db=postgres, unsigned webhook POST → 401, explorer address page 200.
  - **Tests:** `forge test` re-run: 21 suites, 197 passed / 0 failed / 2 skipped.
  - **Docs written:** README rewritten; DEVPOST, VIDEO_SCRIPT, PITCH, CHECKLIST created.
  - **Messages:** acked MSG-066 (→ MSG-130) and MSG-086 (→ MSG-131).
- 2026-11-15 — File initialized by ORCHESTRATOR.

## Next up
- [ ] After the human records the video: replace `<VIDEO_URL>` (README, DEVPOST).
- [ ] The human picks an author/team line → `<AUTHOR_NAME>` in DEVPOST (and optionally the README).
- [ ] After the repo goes public: check on GitHub that the Mermaid diagram renders, the images show, and relative links work.
- [ ] If the seed (BACKEND_RELAYER, `scripts/seed/`) lands with the canonical Lena's café, optionally add its venue link/tx to the README and the video prep.
- [ ] If new measurements arrive (the phone checklist, Thursday's QE on Vercel), update the latency lines with their evidence paths.

## Struggles, open questions, known issues
- **Mermaid not machine-validated:** `npx @mermaid-js/mermaid-cli` was denied by the session's permission classifier. The syntax was reviewed by hand (flowchart LR, quoted labels, `-.->|…|`, cylinder node).
- `infra/streams/stream-vouch-prod.json` names the Stream `vouch-v3-prod`, but the real Stream is `vouch-v3-production` (told STREAMS_INFRA in MSG-130). The README uses the real name.
- The "7-way split" wording in the product story = 7 USDC transfers (1 in, 6 out). The README says "6 payouts" to stay precise.
- The streams:verify hash quoted (`73a460fd…`, 72 events, blocks to 72,622,899) is from the evidence file. Re-running gives a different hash as new txs land; the claim is only that all paths agree.

## How to run / test this area
No build. To re-verify numbers:
```bash
export PATH=$HOME/.foundry/bin:$PATH
cast receipt 0x40147554390c5de5d702a0086a1b144730abca46ff39d2ab642945a7791ddfcb --rpc-url https://rpc.testnet.arc.io --json   # gasUsed × effectiveGasPrice / 1e18
cd contracts && forge test | tail -1
```

## Handoff notes
Read `AGENTS/README.md` (product story), `AGENTS/INTERFACES.md`, `AGENTS/DECISIONS.md`, and your phase section in `AGENTS/PHASE_LOG.md` before working. Update this file before returning. You may only edit this file, append to DECISIONS.md, and propose INTERFACES.md changes in your report.
**Comms (D-009):** before working, read `AGENTS/INBOX/DOCS_SUBMISSION.md` and answer/ack everything open addressed to you; post questions, handoffs and bugs to the recipient's inbox with `python3 scripts/agents/msg.py` instead of guessing; list messages sent + unresolved in your report.
