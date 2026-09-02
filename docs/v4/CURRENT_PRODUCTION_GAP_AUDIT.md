# V4 current production gap audit

Audit date: 2026-09-02. Current local baseline inspected: `82ad459` on local `main`, with an uncommitted catalogue-media correction in progress. Remote `origin/main` remains `72767269e83d905c7f484d8ce08ae7d32a27b1bc`; no remote write has been performed.

| Area | Classification | Evidence / decision |
| --- | --- | --- |
| Local Electron, Fastify and SQLite/WAL | VERIFIED_CURRENT | Existing desktop starts a loopback-only authenticated local server and passes restart/workspace tests. Preserve it. |
| Clean database bootstrap | BUG → fixed in this branch | `test:ops` reproduced `better-sqlite3` parent-directory failure. Store now creates plain-file parent directories and has a first-run/restart regression. |
| Legacy event outbox | PARTIAL | It marks events published before a remote acknowledgement. It remains an internal legacy relay and is not suitable for marketplace delivery. |
| Marketplace edge sync | PARTIAL / EPIC_EXTENSION | Durable acknowledged outbox/inbox, device registration, checkpoints, retry/dead-letter states, local simulator, ordered projection and cross-channel self-tests now exist. A real signed cloud transport and remote contract are still unavailable. |
| Adjacent platform backend | VERIFIED_REFERENCE | `../Lndry_backend` has customer orders, payment and rider APIs, but its documented model is not a desktop edge-sync contract. Do not call it from desktop until both sides agree a versioned contract. |
| Fixed-scale financial normalization | VERIFIED_CURRENT | Existing money/reconciliation/normalization tests pass. Preserve and extend rather than replace. |
| Tax / invoice compliance | PARTIAL / NEEDS_LEGAL_VALIDATION | Fixed-scale line-level tax, effective-dated policy, supplier profile/readiness, immutable canonical snapshot and no-fake-QR print route exist. Legacy booking/print paths still require migration to the canonical snapshot; no legal/provider evidence supports production GST/e-invoice claims. Marketplace materialization now fails explicitly when the supplier profile is incomplete. |
| Catalogue imagery | BUG → partially fixed | Booking previously inferred visuals from free-text names and defaulted unknown garments to a shirt. V4 now uses explicit visual keys, corrected six wrong active mappings, generated a complete contact sheet, and emits derivative-budget warnings. Legacy oversized assets and several generic Indian/accessory mappings still require review. |
| Online Orders operator surface | EPIC_EXTENSION / PARTIAL | Runtime-inspected queue cockpit now exposes source, request, payment, sync, acceptance/rejection, physical intake entry and materialization controls. Queue visibility is available to `orders.read`; mutations remain `orders.edit`-protected with a clear read-only state. Customer timeline, pickup scheduling and richer work-card integration remain. |
| Production signing / updates | EXTERNAL_BLOCKER | Windows signing remains disabled for current internal builds; no trusted update feed or production certificate evidence is present. |

The product is **not production-certified**. This document is an evidence record, not a release approval.
