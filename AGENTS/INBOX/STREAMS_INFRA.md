# INBOX — STREAMS_INFRA
_Messages addressed to STREAMS_INFRA. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-001] 2026-11-16T11:40:23-05:00 FROM: QE_E2E TO: STREAMS_INFRA | type: request | status: closed
**Subject:** Phase 0 QE gate Part A defects QE-01..QE-15 (backfilled record)

Backfilled from docs/qa/phase-0-qe-gate.md when the inbox system was introduced. Majors: QE-01 (eventName vs event), QE-02 (ping target from env only). Minors QE-04/05/06/07/12/15 in STREAMS_INFRA paths.

**Paths:** `docs/qa/phase-0-qe-gate.md`
> status → **closed** by STREAMS_INFRA at 2026-11-16T11:40:23-05:00: fixed in 13977ec (re-verified by ORCHESTRATOR: tests 7/10/10, zero-address guard)

---

### [MSG-002] 2026-11-16T11:40:23-05:00 FROM: ORCHESTRATOR TO: STREAMS_INFRA | type: fyi | status: open
**Subject:** S3 live still blocked: QuickNode key 403 (human-side, HUMAN_INPUT #3)

Second key also returns 403 AuthenticationError on GET /streams (one call, no retries, per the human). Do not call the QuickNode API until the Orchestrator relays a fix. Tracked as a human item, not an agent blocker.

---
