# Epic Laundry — Operator Acceptance Test Report

**Evidence date:** 2026-08-29
**Scope:** local/offline-first desktop workspace, authenticated laundry API,
web renderer, SQLite persistence, recovery tooling, and Windows packaging.

This report is an evidence register, not a claim that external integrations
or release ownership are complete. A workflow is marked **PASS** only where a
repeatable automated check or a directly verifiable artifact exists.

## Acceptance matrix

| ID | Operator scenario | Result | Evidence |
|---|---|---|---|
| OAT-01 | Owner bootstrap creates the requested tenant/store and persists business, operations, and setup progress | PASS | `server/src/_selftest-e2e.ts`; `/api/auth/bootstrap`; `/api/settings/setup-progress` |
| OAT-02 | Sessions are authenticated, role-gated, and store-scoped | PASS | `server/src/_selftest-auth.ts`, `_selftest-e2e.ts`, `_selftest-workspace-mode.ts`; AsyncLocalStorage scope checks |
| OAT-03 | Counter can quote and book a customer order with server-calculated totals | PASS | `_selftest-laundry.ts`, `_selftest-e2e.ts`; `/api/laundry/quote`, `/api/laundry/orders` |
| OAT-04 | Retrying a booking or other mutation cannot duplicate or silently change the command | PASS | Idempotency request-fingerprint checks in `_selftest-auth.ts`, `_selftest-e2e.ts`, `_selftest-restart.ts` |
| OAT-05 | Counter draft survives restart/offline operation and failed commands can be replayed | PASS (local boundary) | `_selftest-restart.ts`; renderer queue with bounded backoff/dead-letter recovery |
| OAT-06 | A held order is owned by one counter, visible to another counter without unsafe resume, and explicitly claimable | PASS | `_selftest-e2e.ts`; `/api/laundry/order-holds`, claim/release routes |
| OAT-07 | Stale counter holds are visible as expired instead of appearing active forever, while an owning counter can renew an unexpired lease | PASS | `_selftest-e2e.ts`; `/api/laundry/order-holds/presence`; `/api/laundry/order-holds/:id/heartbeat`; 15-minute derived lease projection |
| OAT-08 | Garments receive durable units/tags, lifecycle events, locations, and audited reprints | PASS | `_selftest-garment-traceability.ts`; garment-unit and tag APIs |
| OAT-08a | Owner can preview and atomically backfill validated historic piece/pair lines without fabricating weight-based units | PASS (controlled operation) | `_selftest-garment-backfill.ts`; `/api/laundry/garment-backfill` preview/apply |
| OAT-09 | Production work is assigned, started, scheduled, and surfaced with SLA/workload guidance | PASS | `_selftest-e2e.ts`; production workload/schedule APIs and queue UI |
| OAT-09a | Supervisor can inspect completion, exception, and timestamp-derived dwell metrics by station/operator | PASS | `_selftest-e2e.ts`; `/api/laundry/production-supervisor-metrics`; queue “Throughput & dwell” panel |
| OAT-10 | QC decisions (rewash, damaged, missing, release, reject) create auditable correction evidence | PASS | `_selftest-e2e.ts`; quality claims and correction-document workspace |
| OAT-11 | Rack/bin occupancy and configured capacity expose over-capacity conditions | PASS | `_selftest-e2e.ts`; rack profile and occupancy APIs |
| OAT-12 | Pickup/delivery runs enforce rider and stop ownership, duplicate protection, zones, and settlement records | PASS | `_selftest-routes.ts`, `_selftest-e2e.ts`; route analytics and service-zone master |
| OAT-13 | Cash shifts open/close per register with paise arithmetic, variance approval, and immutable close snapshots | PASS | `_selftest-cash-shift.ts`, `_selftest-e2e.ts`; cash-close drill |
| OAT-14 | Payments, refunds, expenses, packages, wallets, and customer ledger entries reconcile | PASS | `_selftest-payment.ts`, `_selftest-package.ts`, `_selftest-reconciliation.ts`, `_selftest-financial-normalization.ts` |
| OAT-15 | Historical financial normalization is previewed, conflict-checked, certified, and recoverable | PASS (controlled operation) | `/api/ops/financial-normalization/*`; durable `financial_normalization_runs`; recovery drill |
| OAT-16 | Customer 360 supports addresses, preferences, consent history, repeat-order context, and retention segmentation | PASS | `_selftest-customer.ts`, `_selftest-e2e.ts`; customer insights/address APIs |
| OAT-17 | Reports paginate, export with bounded limits, queue larger exports, stream row-oriented exports from SQLite cursors, and restore saved views | PASS | report/export E2E checks; `worker_thread_cursor` executor evidence for invoice export; bounded CSV batches; indexed date predicates and `EXPLAIN QUERY PLAN` assertion |
| OAT-18 | Backup verification rejects tampering, restore creates a required rollback snapshot, and fresh-database restore reproduces the scoped dataset | PASS | `desktop/recovery-policy.test.js`, `_selftest-backup-crypto.ts`, `_selftest-recovery-drill.ts`; encrypted backup and restore rehearsal |
| OAT-19 | Support diagnostics and WhatsApp inbound/outbound logs avoid exposing raw message/phone content | PASS | `_selftest-diagnostics.ts`; hashed/length-only inbound and invoice-notification audit/log fields |
| OAT-20 | Hardware actions report evidence-backed status rather than claiming unsupported devices | PASS | `_selftest-hardware.ts`; capability registry and receipt-based health projection |
| OAT-21 | Windows NSIS and portable artifacts are generated and their release manifest verifies; report-worker CSV output uses bounded 256-row file batches | PASS | `desktop/dist/Epic Laundry Setup 0.1.0.exe`, `Epic Laundry 0.1.0.exe`; `npm run verify:manifest` (3,667 entries); `server/src/modules/laundry/report-exports.ts` |
| OAT-22 | Release manifest signing verifies a trusted Ed25519 key and rejects tampered manifests or foreign trust anchors | PASS (implementation boundary) | `desktop/scripts/release-signature.test.mjs`; `npm run test:release-signature` |
| OAT-23 | Static accessibility audit rejects unnamed buttons and unlabeled form controls | PASS (static boundary) | `webapp/scripts/accessibility-audit.mjs`; `webapp npm run audit:a11y`; CI step |
| OAT-24 | Fresh Windows installer refreshes the per-user install, creates a valid Start Menu shortcut, launches the desktop shell, and reaches the authenticated loopback server | PASS (local install boundary) | `desktop/dist/Epic Laundry Setup 0.1.0.exe` silent install; shortcut target resolves to installed `Epic Laundry.exe`; running process served `/api/health` on an authenticated random loopback port |
| OAT-25 | Owner can inspect compatibility-retirement readiness without exposing generic payload contents | PASS (read-only boundary) | `/api/ops/compatibility-audit`; Store Settings “Compatibility retirement readiness” panel; `_selftest-e2e.ts`; entity-level counts, normalized mirror counts, explicit blockers, and payload-redaction assertion |

## Verification commands

The following checks passed for this evidence set:

```text
server: npm run typecheck
server: npm run build
server: full regression sequence (`test:laundry`, `test:auth`, `test:store-migration`, `test:customer`, `test:package`, `test:catalogue`, `test:payment`, `test:ops`, `test:garment-traceability`, `test:garment-backfill`, `test:money`, `test:reconciliation`, `test:cash-shift`, `test:routes`, `test:hardware`, `test:diagnostics`, `test:backup-crypto`, `test:financial-normalization`, `test:e2e`)
server: npm run test:e2e
server: npm run test:store-migration
server: npm run test:recovery-drill
webapp: npm run build
desktop: npm run dist:win
desktop: npm run test:recovery-policy
desktop: npm run verify:manifest
desktop: npm run test:release-signature
webapp: npm run audit:a11y
desktop: local NSIS install/shortcut/launch smoke; `/api/health` returned `status: ok`
```

## Release blockers still open

These are intentionally not marked as passed because the local repository
cannot provide the required external evidence:

1. Protected production Ed25519 key custody, Authenticode signing certificate,
   and a trusted, provider-backed update channel. The signing implementation
   is tested locally but no production key is stored or configured here.
2. Monitored off-device backup retention with documented RPO/RTO ownership.
3. Complete historical migration of compatibility JSON into entity-specific
   constrained tables, followed by retirement of mutable compatibility fields.
4. Certified scanner, scale, thermal-tag, cash-drawer, RFID, and live device
   health adapters.
5. Provider-backed customer communications, portal delivery, live route
   telemetry, corporate accounts, and contract pricing.
6. Index-only plans for aggregate very-large-dataset reports, manual
   screen-reader/keyboard review beyond static checks, renderer keyboard E2E,
   and crash telemetry.

Until those items have real evidence, Epic Laundry should be treated as a
strong local production candidate with explicit integration/release gates,
not as a fully signed enterprise deployment.
