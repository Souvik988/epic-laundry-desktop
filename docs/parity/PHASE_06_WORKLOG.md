# Phase 6 worklog — POS/order billing and complete payments

Status: In progress. The authoritative payment engine and operator collection
surface are implemented; authenticated visual/E2E evidence and final
cross-phase reconciliation are still required before the phase gate can pass.

## Implemented

- Pay-later orders expose a durable payment summary with total, paid,
  outstanding, status, invoice linkage and allocation history.
- Collection supports Cash, UPI, Card and Bank, optional receipt/reference and
  notes, multiple partial allocations, exact outstanding limits and idempotent
  command keys.
- Reversal requires an explicit reason, cancels the source payment document,
  records provider status/reason metadata, posts a customer Refund ledger
  adjustment and reopens only the reversed allocation.
- Invoice payment status is derived from submitted Receive allocations and no
  longer mutates the invoice lifecycle to Paid during payment posting.
- The order work card now provides server-backed collection, allocation history
  and reversal controls. UPI/Card remain explicitly manual-safe until a real
  provider is configured; no online confirmation is fabricated.

## Evidence

- `npm run typecheck` — passed.
- `npm run test:payment` — passed: pay-later, partial, multiple, idempotent,
  over-collection rejection, reversal and customer-ledger refund.
- `npm run test:catalogue`, `npm run test:laundry`, and `npm run test:auth` —
  passed after payment changes.
- `npm run test:store-migration`, `npm run test:customer`, and
  `npm run test:package` — passed for regression coverage.
- `npm run build` from `webapp` — passed; the generated UI is copied into the
  local server public bundle.
- `npm run pack` from `desktop` — passed and refreshed `dist/win-unpacked`.
- Local browser smoke loaded the generated first-run screen and all static UI
  assets successfully. Authenticated workflow visual evidence is intentionally
  pending because entering credentials into a browser requires action-time user
  confirmation.

## Remaining gate items

- Authenticated browser visual/E2E smoke of POS collection, multiple payments,
  reversal and reload/offline restart.
- The POS now captures a delivery address and bounded garment photo attachment;
  add the authenticated visual/E2E evidence for those persisted fields.
- The next work-card slice also records immutable item-level fulfilment events
  with stage and quantity validation; the event API is covered by the laundry
  regression test and is surfaced in the order detail panel.
- Validate financial reconciliation against reports after the report phase.
