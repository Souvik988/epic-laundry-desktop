# V2 Phase 5 — Garment identity and tag traceability

**Status:** PARTIAL — the durable unit and tag lifecycle foundation is shipped;
production hardware and historic-order migration remain explicit follow-up work.

## Delivered

- Piece and pair lines create one durable `garment_units` record per physical
  unit at booking. Kilogram and square-foot lines remain quantity-based and do
  not fabricate physical garments.
- Each unit receives an opaque store-scoped code (`GU-…`) that contains no
  customer PII. A reprint retires the active code and issues a new tag code.
- Scans resolve only within the authenticated tenant/store scope. State changes
  are constrained by an explicit lifecycle (`Intake → Sorted → Processing → QC
  → Rewash/Assembly → Racked → Dispatched → Delivered`) with Missing, Damaged,
  and Cancelled terminal exception states.
- Every create, scan, transition, and reprint appends an immutable event row.
  Reprints require an operator reason and retain previous/new code, station,
  actor, and timestamp.
- API contracts are available at `/api/laundry/garment-units`, including list,
  detail, scan, and reprint operations. Access is authenticated and role
  scoped; counter and processing staff receive only the required permissions.
- The desktop desk includes a Garment tracking page for scan/inspect, state
  movement, location, condition, and audit history.
- Owners can preview and apply a bounded historic-order backfill. It creates
  only validated Piece/Pair units, preserves the order's known lifecycle state,
  records a `legacy_backfill` event, excludes measured weight/area lines, and
  is atomic and idempotent.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:garment-traceability` | PASS — unit counts, non-piece policy, valid/invalid transitions, unknown tags, and reprint history. |
| `server npm run test:garment-backfill` | PASS — reviewed preview, physical-line filtering, lifecycle preservation, audit event, and idempotent retry. |
| `server npm run test:laundry` | PASS — existing tag and order behavior remains compatible. |
| `server npm run test:e2e` | PASS — authenticated booking, payments, fulfillment, reporting, and backup workflow. |
| `server npm run typecheck` | PASS |
| `webapp npm run build` | PASS |

## Remaining work before calling this production-complete

- Add barcode/QR rendering and printer adapters with a print-job receipt; the
  current API returns safe codes but does not claim a hardware print succeeded.
- Execute the controlled backfill preview against the real production dataset
  after owner review; no migration command should run blindly on production.
- Add package/bag-level identities for weight and area services when operators
  explicitly create a bag, preserving the distinction between measured
  quantity and physical custody.
