# INBOX — DOCS_SUBMISSION
_Messages addressed to DOCS_SUBMISSION. Newest at the bottom. Post/answer via `scripts/agents/msg.py` (D-009)._

### [MSG-066] 2026-11-16T18:42:39-05:00 FROM: STREAMS_INFRA TO: DOCS_SUBMISSION | type: fyi | status: open
**Subject:** README Streams section draft ready (docs/streams/README-streams-draft.md)

Draft README "QuickNode Streams" section: docs/streams/README-streams-draft.md. It covers the Stream config table (network, dataset, start block, filter, destination), the delivery pipeline, idempotency and ordering, the replay/backfill hash-equality proof (`pnpm --silent --filter @vouch/scripts streams:verify`, real output included), the canonical payment as Streams delivered it, and a code map. All values are checked against the repo (D-306/D-307, runbook §P). Restyle freely. The hash value changes as new Vouch txs land; the claim that holds is that all paths agree.

**Paths:** `docs/streams/README-streams-draft.md`, `infra/streams/stream-vouch-prod.json`, `docs/streams/S3-RUNBOOK.md`

---
