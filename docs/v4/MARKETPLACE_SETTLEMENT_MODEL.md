# Marketplace settlement model

Status: **EPIC_EXTENSION / NEEDS_LEGAL_VALIDATION.** Customer invoice data must not double as vendor settlement data.

Versioned policy records explain vendor gross, discounts and promotion funding, commission, payment fees, refunds, recoveries, withholding, adjustments, payout attempts, and final vendor payable. Every settlement line has a source event and policy version. Local settlement batches now aggregate only canonical settlement statements, and payout attempts remain `PendingProvider` until an adapter-verified provider event matches the amount and currency; no local code can mark a payout successful without that evidence. Production formula, tax treatment, payout transport, and legal supplier-of-record policy remain unapproved.
