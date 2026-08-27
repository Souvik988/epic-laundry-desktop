# Laundry desktop parity matrix

This document records the read-only audit of the authenticated UniClean store dashboard and the
capability cross-walk to `Lndry_backend`. It is a clean-room product plan: the desktop app follows
observable workflows and information architecture, while retaining its own implementation and
original visual assets.

## Reference surface audited

| Surface | Observed workflow and controls | Desktop status |
| --- | --- | --- |
| Dashboard / Overview | Package expiry banner, collection/order/pending KPIs, booking → delivery → delivered pipeline, attention queues, quick actions, business overview and next-delivery hint | Present; add trend and mix charts in phase 1 |
| Laundry POS / Order & Billing | Customer search/create, pickup/home/express modes, expected date, category and service chips, garment search/cards, quantity controls, selected basket, charge/discount/tax controls, delivery date, payment mode (pay later/cash/online), photos, booking, receipt/tag flow | Present as order booking vertical slice; receipt/tag action surface to expand |
| Store Orders | Phone/order/customer filters, more filters (status/user/date range), PDF/Excel/print/refresh, grid/list switch, eligible bulk-delivery selection, invoice/customer/phone/order/delivery/amount/source/status/actions table, history and invoice/detail views | Present; add view-mode parity and bulk delivery in phase 2 |
| Store Expense | Add expense form (name/date/amount/receiver/invoice/tax), date range/search, PDF/Excel/print/refresh, grid/list | Present; add tax-aware summary and export in phase 2 |
| Imports | Customer and garment-price Excel templates, strict header/data-row guidance, upload, not-imported correction loop | Present; add row-level validation/download in phase 2 |
| Reports | Invoice, collection, order, consolidated invoice, customer, customer package, customer list, growth, discount, expense, balance, pickup, rider delivery, rider collection, warehouse user work (locked in reference); date/report-by filters, export/print, tables and charts | Local reports are a combined operational report; add tabs and trend/mix charts in phase 1 |
| Settings | Store profile/logo/address/preferences; UPI/QR; store charges; discounts; garment pricing; garments; categories; services; service units; store users; packages | Local catalogue is read-only; CRUD/settings parity is phase 3 |

## Backend capability cross-walk

`Lndry_backend` is a unified Fastify/PostgreSQL/Redis service. Its active route families include
authentication/users/customers, service categories and garment rates, quotes, orders/payments,
addresses/maps, rider delivery and pickup slots, shops/vendors/staff, vendor orders/riders,
notifications, reviews, themes/tabs, coupons/payment offers, uploads, shop transactions and
financials, shop reports, and admin dashboard/analytics/orders/products/customers/riders/team,
activity logs, finance and settings. Archived modules include cart, wallet, wishlist, scheduled
orders, bulk orders, product families, and shop finance.

The desktop currently uses a local, auditable document store with equivalent laundry entities:
categories, services, garments, price rules, customers, orders, order items, riders, expenses and
journal entries. The local API keeps authoritative totals, lifecycle transitions, assignment guards,
imports, audit events and report derivation in the server layer.

## Phased execution plan

### Phase 1 — owner dashboard and reporting intelligence

1. Extend the laundry dashboard response with a date-series revenue/collection trend, fulfilment
   mix, top garments/services and a compact ageing/outstanding view.
2. Render those series as accessible inline charts (no remote chart dependency), while retaining
   the UniClean-style KPI/pipeline/attention hierarchy.
3. Add report tabs for invoice, collection, order/service, customer, growth, discount, expense and
   balance views using the same date range and export affordances.

### Phase 2 — floor operations parity

1. Add order list grid/list view, bulk delivery selection, invoice/history/tag preview, and explicit
   payment/fulfilment badges.
2. Add tax-aware expense summaries, printable exports, and import validation with downloadable
   rejected rows.
3. Add pickup/delivery/rider report views backed by dispatch assignments.

### Phase 3 — settings and catalogue parity

1. Add safe CRUD for categories, services, garments, units and price rules with soft-delete and
   duplicate-name guards.
2. Add store profile, charges, discounts, package limits and staff settings to the desktop shell.
3. Add permissions and audit history for settings changes.

### Phase 4 — unified backend adapter

1. Introduce an opt-in backend adapter that maps the local domain contracts to the unified backend
   route families without changing the offline desktop default.
2. Add health/auth configuration, retry boundaries and tenant/shop scoping.
3. Verify the full flow against a non-production backend environment before any production switch.

## Guardrails

- The UniClean reference is used read-only for behavior and visual observation; no orders, settings,
  messages, uploads or payments are changed there.
- Do not copy proprietary source code, customer data, logos or private assets into this repository.
- Every phase must pass server self-tests, TypeScript/build checks and an Electron packaging smoke test.
