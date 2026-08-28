# Phase 7 worklog — order work card and fulfilment

Status: In progress. Order detail now combines customer/order context,
delivery evidence, payment ledger and item-level fulfilment controls.

## Implemented

- Immutable `laundry_fulfillment_event` documents record Picked Up, In Process,
  Ready and Delivered quantities per order item.
- Server-side validation rejects missing items, invalid stages, non-positive
  quantities, cancelled-order events and cumulative over-fulfilment.
- Order detail displays the event history and lets authorised staff record a
  progress event with an optional note.
- Existing order-level lifecycle transitions and rider assignment remain
  enforced server-side.
- Order cancellation now requires an explicit reason, reverses submitted
  payment evidence and the linked invoice through append-only reversal/GL
  entries, posts customer ledger adjustments, preserves the order history,
  and emits an auditable operational notification.
- Controlled unpaid-order editing now includes a catalogue-backed item editor:
  authorised operators can add, replace, remove, or re-quantity garment/service
  lines while the server still issues a replacement invoice transactionally.

## Evidence

- `npm run test:laundry` covers event creation, over-quantity rejection, and
  cancellation financial reconciliation.
- Server typecheck and authenticated RBAC regression tests passed.
- Web build passed with the work-card controls.

## Remaining gate items

- Full partial-fulfilment summaries (aggregated pending quantities) and
  authenticated visual/E2E verification remain. Item edits on unpaid orders are
  controlled and create replacement invoices plus ledger adjustments; paid orders
  deliberately require reversal/cancel-and-rebook.
