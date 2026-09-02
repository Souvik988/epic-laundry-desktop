# Canonical invoice document model

Status: **PARTIAL / NEEDS_LEGAL_VALIDATION.** Configured-store laundry
bookings and configured POS invoices now create one immutable canonical snapshot
and link it to the originating operational record. POS defaults to Product/HSN
only when its catalogue line does not explicitly declare a service/SAC mapping;
the legacy tax-print endpoint resolves through that snapshot and fails closed
when supplier profile or effective classification evidence is missing. Full laundry cancellation and controlled supersession now
create a submitted legacy credit note first, avoid double-reversing the invoice,
and link an immutable canonical credit-note snapshot when V4 tax evidence is
available. Provider IRN evidence and legal approval remain outside this bridge.

The target is one immutable invoice snapshot used by A4/thermal renderers, PDF, customer display, tax exports, e-invoice payload, credit/debit notes, payment/refund receipts, and marketplace records. Surfaces must not recompute historical tax independently. Marketplace reconciliation has a separate immutable settlement-statement snapshot and renderer; it is deliberately not treated as a customer invoice or payout success artifact.

Document types require explicit applicability: Tax Invoice, Bill of Supply, Customer Receipt, Mini Invoice, Credit Note, Debit Note, Payment Receipt, Refund Receipt, Settlement Statement, and platform commission invoice. Local collections and controlled reversals now create immutable Payment Receipt/Refund Receipt snapshots linked to the canonical invoice, with a shared escaped HTML renderer; provider-backed marketplace receipts remain evidence-gated. Garment QR, UPI payment QR, and IRP-signed e-invoice QR are separate labelled artifacts.
