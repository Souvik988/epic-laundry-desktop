# Phase 9 worklog — pickup, delivery, riders and settlement

Status: In progress. Dispatch assignment and item fulfilment are now joined by
a durable rider handover ledger; rider-account isolation and richer task
history remain open.

## Implemented

- Existing rider master, enabled-state validation, pickup/delivery assignment,
  slots and dispatch queues remain server-enforced.
- `laundry_rider_settlement` records rider, amount, method, linked order IDs,
  timestamp, status, reference and notes.
- Settlement updates are audited and support Pending → Handed Over,
  Reconciled or Rejected workflows without deleting history.
- Linked orders are validated to belong to the assigned rider, preventing
  cross-rider collection attribution.
- New Rider settlements UI supports recording handovers and marking them
  reconciled; list data comes from the server settlement ledger.

## Evidence

- `npm run test:laundry` covers settlement creation, rider-order linkage and
  reconciliation history.
- Server typecheck, auth, catalogue, customer, package and migration tests pass.
- Web build passes after adding the settlements route and navigation.

## Remaining gate items

- Authenticated rider-role isolation and assigned-task visual/E2E evidence.
- Real rider collection report aggregation and settlement reconciliation checks.
- OTP/proof-of-delivery/signature behavior remains NEEDS_VERIFICATION and is not
  represented as verified UniClean parity.
