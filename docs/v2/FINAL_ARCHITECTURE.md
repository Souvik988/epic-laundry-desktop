# Epic Laundry — Final Architecture

## Runtime topology

Electron main process starts the bundled Fastify server on an OS-assigned loopback port. A high-entropy secret and nonce are exchanged through an authenticated startup handshake before the renderer loads. The renderer talks to the server through the preload bridge and never receives Node.js authority.

## Bounded contexts

- **Workspace/auth:** tenant/store scope, sessions, roles, staff, branch membership.
- **Counter:** catalogue, customer lookup, booking, pricing, drafts/holds, invoices and payments.
- **Traceability:** garment units, opaque tags, scans, lifecycle events, reprints, rack/bin locations.
- **Production/QC:** station tasks, assignment, SLA queue, rewash, claims, correction documents.
- **Delivery:** riders, service zones, route runs, ordered stops, collections and settlements.
- **Finance:** paise journal, financial documents, customer ledger, wallets, packages, expenses and cash shifts.
- **Reporting:** bounded pages, saved views, cursor-backed row exports and aggregate statistics.
- **Operations:** diagnostics, encrypted backups, recovery rehearsal, migration evidence and hardware receipts.

## Persistence model

SQLite is the local transactional authority with WAL, foreign keys, ordered checksummed migrations through v16, store-scoped indexes, constrained financial tables, normalized customer/order projections with fixed-scale order items, immutable close snapshots, and audited idempotency/hold ownership. Generic entity rows remain a compatibility layer for mature domains during migration. New normalized financial, customer/order and physical-garment records are preferred by operational reads where available.

## Migration rule

The owner-only compatibility-retirement audit is read-only and payload-free. Customer/order normalization now creates deterministic source-hash projections through resumable bounded batches and records durable run evidence. Any future cutover must create a rollback snapshot, reconcile source-to-target rows, establish dual-write coverage, and retire compatibility fields only after zero unresolved rows and an owner-approved certificate. No current code path silently deletes history.

## Failure model

Retry-sensitive commands use idempotency fingerprints; offline commands use a durable queue with backoff/dead-letter handling; financial operations use integer paise and append-safe mirrors; restore verifies integrity before mutation and creates a rollback snapshot; external integrations record evidence rather than claiming success from an unverified request.

## Scale boundary

Date predicates have SQLite expression indexes and row-oriented exports stream through SQLite iterators with bounded CSV writes. Aggregate statistics and some grouped reports still require index-only/query-plan work before very-large multi-year datasets are certified.
