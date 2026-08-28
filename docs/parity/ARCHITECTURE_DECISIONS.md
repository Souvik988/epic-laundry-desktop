# Architecture decisions

## ADR-001: Preserve the Electron-local Fastify shape

**Decision:** Retain Electron as the desktop shell and Fastify as the local
domain/API layer. React remains a renderer only.

**Reason:** This preserves the existing offline workflow and keeps financial
authority out of the UI.

## ADR-002: Replace JSON as authoritative storage in Phase 2

**Decision:** Introduce a repository/unit-of-work boundary backed by a local
transactional SQLite database, with explicit migration from existing Epic JSON
data.

**Reason:** Booking, payments, wallets, refunds and audit events require
atomic commits and durable constraints. JSON remains migration/back-up input,
not the long-term financial source of truth.

## ADR-003: Server-derived identity and store scope

**Decision:** Remove the renderer-shipped fallback API key and process-global
actor/tenant model in Phase 2. The server derives identity, tenant and store
from an authenticated session and membership.

**Reason:** UI hiding cannot be authorization. This is a prerequisite for
multi-store isolation and auditable actions.

## ADR-004: Immutable financial history

**Decision:** Payments, wallet changes, package usage, refunds and
cancellations are append-only ledger/adjustment events. Historic booked price
snapshots are never overwritten by master-data edits.

**Reason:** Enables reconciliation and makes reports/customer balances
consistent with order history.

## ADR-005: Reference evidence versus Epic extensions

**Decision:** Verified reference behavior is tracked separately from unknown
behavior. Necessary original features are marked **Epic extension** rather
than claimed as UniClean parity.

**Reason:** Prevents invention and protects the reference system's IP.

## ADR-006: Price-rule provenance and governed counter adjustments

**Decision:** A quote selects an active server-side price rule and retains its
identifier beside the immutable rate snapshot. Charge, discount and tax masters
are selected by ID and calculated on the server.

**Reason:** Changing a catalogue rule must never silently rewrite booked orders
or let the React renderer become a financial authority. The exact UniClean tax
and discount precedence was not observed, so Epic's calculation order remains
documented as an **EPIC_EXTENSION** until verified.

## ADR-007: Local garment attachment safety

**Decision:** Curated generated visuals use local application paths. Owner
uploads are limited to PNG/JPEG/WebP image data under 1 MB and are validated in
both renderer and server; remote image URLs are rejected.

**Reason:** This supplies the observed garment-image capability without turning
the local desktop server into an arbitrary remote-file proxy or storing
unbounded binary input.
