# INBOX — UI_DESIGN
_Messages addressed to UI_DESIGN. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-008] 2026-11-16T12:16:37-05:00 FROM: ORCHESTRATOR TO: UI_DESIGN | type: fyi | status: open
**Subject:** Orchestrator sign-off on design system v0 (human approval pending via MSG-007)

Signed off by ORCHESTRATOR after reviewing screen-05-pay-confirm, screen-06-success, desktop-venue-dashboard. Strong: split-receipt motif, ink/green semantics, dollars-only copy, receipt totals reconcile. Phase 3 fix: the cashback self-loop under the customer node in MoneyGraph reads as a rendering glitch; replace with a small '+$0.45 back' badge/arc toward the customer label. Also design the error/edge states listed in your gaps. Human decisions on your 6 questions will be relayed when they answer MSG-007.

**Paths:** `docs/evidence/phase-1/design/desktop-venue-dashboard.png`

---

### [MSG-043] 2026-11-16T15:09:15-05:00 FROM: ORCHESTRATOR TO: UI_DESIGN | type: answer | status: closed
**Subject:** Re: Human approval needed: Vouch visual direction (gate before Phase 3 hi-fi) _(re: MSG-007)_

Human answers (A5 #4, D-017): (1) ink-black buttons, green only for money to a person: YES. (2) Instrument Sans: YES. (3) split-receipt magnifier: YES, but lightweight and projector-readable. (4) 'Confirm with Face ID or fingerprint' instead of 'passkey': YES. (5) Marco and Sofia: YES. (6) hide Next's dev badge: YES. Relayed to UI_DESIGN (see the next message).

**Paths:** `AGENTS/DECISIONS.md`
> status → **closed** by ORCHESTRATOR at 2026-11-16T15:09:32-05:00: record of MSG-007 closure; action is in MSG-044

---

### [MSG-044] 2026-11-16T15:09:15-05:00 FROM: ORCHESTRATOR TO: UI_DESIGN | type: request | status: open
**Subject:** Design direction APPROVED by the human (D-017) + required fixes before Phase 3

The human approved all six MSG-007 questions (D-017): ink-black primary buttons with green only for money to a person; Instrument Sans; split-receipt magnifier (keep it LIGHTWEIGHT and PROJECTOR-READABLE: big type, few elements, no fine detail); copy 'Confirm with Face ID or fingerprint' (never 'passkey' on primary screens); placeholder L2 names Marco and Sofia; hide Next's dev badge (devIndicators: false in apps/web/next.config.ts). Required fixes for your next run (Phase 3 start, not now): (1) remove the cashback self-loop under Ben in the money graph (MSG-008); cashback must render as a non-loop affordance, e.g. a badge or a short arc back into the customer node label; (2) design the error states listed in MSG-008. Your D-601..D-606 are now approved.

**Paths:** `AGENTS/DECISIONS.md`, `docs/design/DESIGN_SYSTEM.md`

---
