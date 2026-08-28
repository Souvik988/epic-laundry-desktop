# Epic Laundry reference evidence

## Evidence boundary

This document records only evidence observed from the authorised, read-only
UniClean session and the local `Epic-Laundry-Product-Audit.md`. It does not
infer hidden role-specific actions or mutate reference production data.

## Verified reference areas

| Area | Directly observed evidence | Confidence |
|---|---|---|
| Dashboard | Operational cards, action toolbar, current orders and activity-oriented counter layout. | Verified |
| Statistics overview | A 2 x 2 layout: Orders Review donut (Booked/In Process/Delivered/Done, Today), Collection line/area (Week), Customer Frequency donut (Today), New Customer line (Week). | Verified |
| Order work card | Invoice/order identifiers, fulfilment/delivery data, item/payment summary, View Images, Deliver Now, Pay/Collect, Add Wallet, Invoice, Mini Invoice, View Tag, WhatsApp and customer-profile actions. | Verified |
| Garment tags | One printable tag per physical piece; order number, customer, service, garment, `(current / total)`, order date and delivery date. | Verified |
| Settings | Store profile/logo, UPI and QR-on-print, charges, discounts, garment pricing, garments, categories, services, units, staff users and packages. | Verified |
| Customer profile | Revenue, order balance, wallet, reward points, last visit, package and order-status segments. Search supports name, mobile and invoice. | Verified |
| Reports | Fifteen separately navigable reports listed in `MASTER_PARITY_MATRIX.md`; their observed controls and columns are recorded there. | Verified |

## Evidence intentionally not asserted

- Reference password policy, session lifecycle and backend/database design.
- Exact taxes, discount precedence, reward formula and package-expiry rules.
- Hidden roles, entitlement rules, OTP, proof-of-delivery, signature, barcode encoding and payment-provider verification.
- Any action that would have changed reference orders, payments, settings, customer data or messages.

## Original-design rule

Epic Laundry may match verified information architecture and workflows, but
must retain its own branding and use original assets. No UniClean logo, source,
private dataset or unverified behavior is copied.
