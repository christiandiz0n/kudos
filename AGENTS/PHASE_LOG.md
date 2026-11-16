# PHASE_LOG

## Phase 0
_Bootstrap, verification spikes, human setup — started 2026-11-15 ~21:30 ET, target ~3–4h_

### Plan
1. Repo skeleton, git, `.gitignore`, pnpm workspace, `AGENTS/` initialized, `HUMAN_INPUT.md` populated. (ORCHESTRATOR)
2. Spikes:
   - **S1** Arc network facts — desk research + live RPC reads (no key needed). (ARCHITECT/research)
   - **S2** Hello contract — write + local tests now; deploy needs funded key (human).
   - **S3** Streams — desk research now (Arc availability, filter function format, webhook payload, backfill); live test needs QuickNode account + public URL (human).
   - **S4** Wallet approach — desk research on Circle Modular Wallets / passkeys on Arc testnet; decide or adopt fallback.
   - **S5** Relayer — script written now; run needs funded relayer key.
   - **S6** Mobile camera — bare HTTPS page; human runs on phone.
3. INTERFACES.md v0 draft.

### Delegated tasks
| Task | Agent | Status |
|---|---|---|
| S1 Arc facts + S3/S4 research | ARCHITECT (research instance) | ✅ done: D-101..D-105, `docs/evidence/phase-0/research-s1-s3-s4.md` |
| Scaffold workspace + Foundry + Hello + S5 local + S6 pages + INTERFACES v0 | ARCHITECT (scaffold instance) | ✅ done: commit `0cf41c5`, D-201..D-209, `docs/evidence/phase-0/scaffold.md` |
| S6b passkey/PRF probe page `/spike/passkey` | ORCHESTRATOR (small spike) | ✅ built; phone run pending the human |
| Key generation script `scripts/setup/gen-env.py` | ORCHESTRATOR | ✅ tested on a throwaway copy; the human runs it (D-004) |

### Spike outcomes
| Spike | Outcome |
|---|---|
| S1 Arc facts | ✅ PASS, all verified live/docs. Surprises: canonical domains are now arc.io; block time ~0.70 s; base-fee floor 20 gwei. USDC `0x3600…` supports permit **and** EIP-3009 → D-103 |
| S2 Hello contract | 🟡 code + 11 tests green locally; **testnet deploy waits on funded deployer** (HUMAN #1–2) |
| S3 Streams | 🟡 desk research PASS (Arc Testnet supported, filter + webhook + HMAC + backfill on Free plan); **live test waits on QuickNode key** (HUMAN #3). Risk: credit budget (D-105) |
| S4 Wallet | ✅ DECIDED: option B, passkey-gated local EOA + relayer (D-104). Circle Modular Wallets work on Arc but need ERC-1271/deployed accounts → deferred |
| S5 Relayer | 🟡 PASS on anvil: 7-recipient relayed split 234,686 gas ≈ $0.0047 at the 20 gwei floor; **testnet run waits on funding** |
| S6 Camera + S6b passkey | 🟡 pages live over HTTPS tunnel; **phone run waits on the human** (HUMAN #4) |

### QE results
- Orchestrator independent spot-check (not the builder): `forge test` 11/11, `pnpm -r typecheck` clean; `cast chain-id` = 5042002; USDC `decimals()` = 6; `DOMAIN_SEPARATOR` = `0x3611…c6b0` (matches the research).
- **Formal QE gate (fresh QE subagent re-runs S1–S3 from the recorded instructions alone): deferred** until S2/S3 are live on testnet. It runs right after the human completes #1–#3.

### Gate outcome
**PARTIAL.** Everything that doesn't need the human is done. S2/S3/S5 testnet runs + S6 phone + the QE gate are pending human input. Phase 1 must not start until the human says go.
