# V4 current production gap audit

Audit date: 2026-09-02. Baseline inspected: `72767269e83d905c7f484d8ce08ae7d32a27b1bc` on `main`.

| Area | Classification | Evidence / decision |
| --- | --- | --- |
| Local Electron, Fastify and SQLite/WAL | VERIFIED_CURRENT | Existing desktop starts a loopback-only authenticated local server and passes restart/workspace tests. Preserve it. |
| Clean database bootstrap | BUG → fixed in this branch | `test:ops` reproduced `better-sqlite3` parent-directory failure. Store now creates plain-file parent directories and has a first-run/restart regression. |
| Legacy event outbox | PARTIAL | It marks events published before a remote acknowledgement. It remains an internal legacy relay and is not suitable for marketplace delivery. |
| Marketplace edge sync | MISSING | No durable acknowledged sync outbox/inbox, cloud contract, device registration, or online-order projection exists yet. |
| Adjacent platform backend | VERIFIED_REFERENCE | `../Lndry_backend` has customer orders, payment and rider APIs, but its documented model is not a desktop edge-sync contract. Do not call it from desktop until both sides agree a versioned contract. |
| Fixed-scale financial normalization | VERIFIED_CURRENT | Existing money/reconciliation/normalization tests pass. Preserve and extend rather than replace. |
| Tax / invoice compliance | PARTIAL | Current quote tax remains global-rule oriented and supplier defaults exist in desktop launch code. No legal or provider evidence supports production GST/e-invoice claims. |
| Catalogue imagery | BUG → partially fixed | Booking previously inferred visuals from free-text names and defaulted unknown garments to a shirt. V4 stores/uses explicit `visual_key`; assets still require a full contact-sheet audit. |
| Production signing / updates | EXTERNAL_BLOCKER | Windows signing remains disabled for current internal builds; no trusted update feed or production certificate evidence is present. |

The product is **not production-certified**. This document is an evidence record, not a release approval.
