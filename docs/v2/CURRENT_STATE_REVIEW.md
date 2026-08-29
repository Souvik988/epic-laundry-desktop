# Epic Laundry V2 — Current-State Review

**Reviewed:** 29 August 2026
**Baseline:** working tree after the V2 implementation/evidence pass (uncommitted)
**Method:** source inspection, self-test execution, package/build verification and the prior evidence-backed UniClean parity reports. This is not a claim that unobserved UniClean behavior has been verified.

The operator-facing evidence register is maintained in
`docs/v2/OPERATOR_ACCEPTANCE_TEST_REPORT.md`.

## Executive assessment

Epic Laundry is an offline Electron application with a React renderer, a loopback
Fastify service, SQLite persistence, authenticated sessions, branch scopes, an
operational laundry catalogue/order flow, customer records, payments, packages,
dispatch, settlements, print surfaces and analytics. The current tree adds
workspace separation, migration checksums, fixed-scale financial paths, garment
traceability, offline replay, recovery preflight, off-device snapshot selection,
support diagnostics and production-floor workload telemetry. It is still **not
yet production ready** against the V2 completion gate because signing,
provider-backed update trust, certified hardware, complete historical financial
backfill, scheduled recovery rehearsal/RPO-RTO ownership and several advanced
operations remain open.

## Verified implementation inventory

| Capability | Classification | Evidence | Current assessment |
|---|---|---|---|
| Desktop-local app | EPIC_EXISTING | `desktop/main.js`, `desktop/package.json` | Electron runs a local Fastify child process and serves the app on loopback. |
| Authenticated local users | EPIC_EXISTING | `server/src/modules/auth/auth.ts`, `server/src/api.ts` | Scrypt password hashing, session hashes, expiry, sign-out and store membership are implemented. |
| Branch scoping | EPIC_EXISTING | `server/src/kernel/store.ts`, auth module | Store scope is carried through requests and has regression coverage. |
| SQLite persistence | PARTIAL | `server/src/kernel/store.ts`, `server/src/modules/ops/compatibility-audit.ts`, `server/src/modules/ops/entity-normalization.ts` | WAL/foreign keys, ordered checksummed migrations through v16 (including normalized customer/order projections with fixed-scale order items, audited migration runs, POS-hold ownership, normalized cash-shift close snapshots, report-date expression indexes, durable financial-normalization evidence, and wallet-row evidence counts) and constrained store-scoped financial tables exist; owner-only preflight/apply endpoints make migration progress, source hashes and validation failures measurable without deleting compatibility rows. Mature catalogue/package/operations entities remain compatibility JSON until their own cutover is certified. |
| Booking and payments | PARTIAL | `server/src/modules/laundry/domain.ts`, `payments.ts`, `reconciliation.ts`, `server/src/modules/ops/entity-normalization.ts` | Server-authoritative order/payment flows, integer-paise persistence and reconciliation checks exist; customer/order projections can now be backfilled in resumable, hash-checked batches, while operational dual-write and final compatibility-field retirement remain. |
| Counter POS holds | PARTIAL | `server/src/modules/laundry/holds.ts`, `/api/laundry/order-holds`, `/api/laundry/order-holds/presence`, `LaundryBooking.tsx` | Online holds are store-scoped, idempotent and auditable with explicit lifecycle states; renderer fallback remains local when the server is unavailable. Repeat-last-order restoration is now validated against the active branch catalogue, Customer 360 exposes editable contact/service preferences plus a deterministic consent-aware lifecycle insights panel, the booking desk provides Ctrl/Cmd+Enter and Ctrl/Cmd+Shift+H counter shortcuts, and the Care Package desk surfaces contract/collection/outstanding/allowance liability with immutable partial-balance collection; server-held drafts now carry audited counter ownership with explicit claim/release transfer, a derived 15-minute lease/presence signal, and cross-counter E2E coverage. |
| UniClean-derived catalogue import | PARTIAL / EPIC_EXTENSION | `LaundryImport.tsx`, `LaundryCatalogueImport.tsx`, `importLaundryCatalogue` and catalogue self-tests | Customer/price spreadsheets plus an owner-only all-or-nothing JSON master-catalogue merge are available; reference-specific completeness and per-store approval/versioning remain to be proven. |
| Branded desktop UX | PARTIAL / EPIC_EXISTING | `webapp/src`, generated visual manifest, `webapp/scripts/accessibility-audit.mjs` | Functional role-aware UI with original Lndry assets; the laundry shell now has role-filtered Ctrl/Cmd+K command search plus an accessible Search control, overview/production selectors expose assistive pressed-state semantics, and the deterministic TSX accessibility audit passes in CI. Grouped domain navigation, manual screen-reader/keyboard review, and broader component coverage remain. |
| Analytics and reports | PARTIAL | `LaundryStatistics.tsx`, reports routes, route analytics, `report-exports.ts`, `report-export-worker.ts`, `report-views.ts` | Existing management views are useful; report-specific routes provide bounded pagination, canonical financial reads, a capped authenticated export-all path (5,000 rows), production station-load telemetry, quality rewash/claim telemetry, cash-close reconciliation analytics, store/rider-scoped route workload coverage, a durable store-scoped background CSV export queue executed in a dedicated worker thread with status, expiry and authenticated download, SQLite-cursor streaming for row-oriented invoice/balance/pickup/delivery/customer/package exports, bounded 256-row CSV file writes, actor-owned/shared saved report views that restore filters, and dedicated SQLite expression indexes for order/payment/expense/customer report dates with E2E planner evidence; index-only plans for aggregate reports and broader reconciled drill-down totals remain. |
| Packaging | PARTIAL | Electron Builder configuration, `desktop/scripts/release-signature.mjs` | Windows NSIS and portable targets build locally; an Ed25519 manifest signing/verification path and tamper/trust tests now exist, but protected signing keys, Authenticode, verified update origin and release automation are not configured. |

## High-risk gaps discovered from source

1. **Release trust and deployment ownership — High.** CI/SBOM, startup handshakes,
   diagnostics, local packaging, and a generated/verifiable SHA-256 release
   manifest are present, but signed artifacts, trusted update origin, release
   credentials and crash telemetry are not configured.
2. **Historical normalization — High.** New financial writes use constrained
   integer paise and guarded backfill previews; certified backfill runs are now
   durably recorded with reconciliation evidence, and customers/orders have a
   hash-checked resumable relational projection path. Remaining entities,
   complete historical coverage, dual-write evidence and compatibility-field
   retirement remain.
3. **Recovery operations — High.** Encrypted/off-device snapshots, preflight
   verification and a scheduled fresh-database rehearsal into an isolated
   temporary SQLite file pass locally; off-device monitoring, artifact signing
   and documented RPO/RTO ownership remain.
4. **Production operations — High.** Durable task/QC workflows, audited operator
   assignment from the floor queue, owner-configured station targets, derived
   utilization telemetry, branch-scoped lowest-load workload guidance,
   forward due-date schedule with an explicit undated-work exception bucket,
   supervised bounded workload assignment,
   per-register cash-close equation drill,
   owner-configured rack/bin capacity and occupancy, branded audited
   customer-correction printing, and receipt-based per-device health evidence
   exist; richer slot assignment, customer portal delivery, live health polling
   and certified hardware adapters remain. Automatic calendar mutation is not
   enabled without explicit scheduling rules.
5. **Scale and advanced operations — Medium/High.** Cursor-backed row exports and
   indexed large-report plans now cover the highest-volume export path; aggregate
   index-only plans, multi-counter audited holds/shortcuts, live route optimization,
   B2B contracts, manual accessibility review and cloud coordination remain. Rider route
   isolation is now implemented for explicitly linked rider accounts, with
   target-branch validation and persisted session reconstruction coverage.

## V2 approach

V2 preserves the current offline-first architecture and progressively moves
critical laundromat facts to constrained, versioned tables. Every phase must have
migration safety, server-side authorization, explicit reference classification,
automated evidence and an operator-facing verification pass.

See [WORLD_CLASS_GAP_MATRIX.md](WORLD_CLASS_GAP_MATRIX.md) for the prioritized
program and the companion architecture, domain, security, release and UX records.
