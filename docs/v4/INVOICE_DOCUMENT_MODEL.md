# Canonical invoice document model

The target is one immutable invoice snapshot used by A4/thermal renderers, PDF, customer display, tax exports, e-invoice payload, credit/debit notes, payment/refund receipts, and marketplace records. Surfaces must not recompute historical tax independently.

Document types require explicit applicability: Tax Invoice, Bill of Supply, Customer Receipt, Mini Invoice, Credit Note, Debit Note, Payment Receipt, Refund Receipt, Settlement Statement, and platform commission invoice. Garment QR, UPI payment QR, and IRP-signed e-invoice QR are separate labelled artifacts.
