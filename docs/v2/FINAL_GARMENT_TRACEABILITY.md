# Epic Laundry — Final Garment Traceability

## Delivered

- Billing quantity is separate from physical identity; kilogram and square-foot lines do not fabricate tags.
- Piece/pair lines can create durable garment units with opaque IDs and store/customer/order linkage.
- Lifecycle states and immutable garment-unit events cover intake, processing, QC, rewash, assembly, rack and dispatch flows.
- Tag codes are collision-checked and reprints are audited with actor/time/reason evidence.
- Rack/bin locations expose occupancy and over-capacity conditions without inventing capacity.
- Reviewed historical piece/pair backfill is atomic, idempotent, and records a `legacy_backfill` event.
- Production queue, QC claims, correction documents and delivery workflows consume the traceability records.

## Evidence

`test:garment-traceability`, `test:garment-backfill`, authenticated E2E, production/QC self-tests and hardware-boundary evidence pass.

## Remaining needs

Real barcode/QR/thermal printer and scanner execution, photo/media retention policy, and certification of a production catalogue/backfill dataset. These are intentionally marked as hardware or deployment verification, not simulated as complete.
