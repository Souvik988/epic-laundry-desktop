# Canonical invoice document model

Status: **PARTIAL / NEEDS_LEGAL_VALIDATION.** Configured-store laundry
bookings now create one immutable canonical snapshot and link it to the
operational order. The legacy tax-print endpoint resolves through that
snapshot and fails closed when supplier profile or effective classification
evidence is missing. Full laundry cancellation and controlled supersession now
create a submitted legacy credit note first, avoid double-reversing the invoice,
and link an immutable canonical credit-note snapshot when V4 tax evidence is
available. Provider IRN evidence and legal approval remain outside this bridge.

The target is one immutable invoice snapshot used by A4/thermal renderers, PDF, customer display, tax exports, e-invoice payload, credit/debit notes, payment/refund receipts, and marketplace records. Surfaces must not recompute historical tax independently.

Document types require explicit applicability: Tax Invoice, Bill of Supply, Customer Receipt, Mini Invoice, Credit Note, Debit Note, Payment Receipt, Refund Receipt, Settlement Statement, and platform commission invoice. Garment QR, UPI payment QR, and IRP-signed e-invoice QR are separate labelled artifacts.
