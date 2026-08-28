# Phase 11 — Reports and statistics overview

## Delivered in this pass

- Added a server-backed `/api/laundry/statistics` query with Today and Last 7 days ranges.
- Added the overview route at `/laundry/statistics`, protected by the orders-read permission.
- Added four responsive visual panels: order lifecycle mix, daily collection, customer frequency, and new-customer acquisition.
- Added refresh and range controls, empty-state handling, INR formatting, accessible chart labels, and a link into the detailed report centre.
- Added fifteen distinct report detail routes under `/laundry/reports/:kind`, each with scoped server rows, date/search filters, print and spreadsheet export controls.
- Corrected report collection totals and daily series to use submitted payment-entry evidence (including partial collections and Bank), and excluded cancelled expenses from operating totals.
- Added regression coverage for all fifteen report kinds and both statistics periods.

## Reconciliation rules

Collections are derived only from submitted `Receive` payment entries linked to the selected laundry invoices. Cancelled/reversed entries are excluded. Order value excludes cancelled orders. Expenses are derived from posted, non-cancelled expense rows. The UI does not invent provider confirmations; UPI/Card/Bank remain operator-recorded evidence until a provider is explicitly configured.

## Remaining gate

Authenticated browser verification of the visual parity against the reference dashboard remains a final Phase 12 activity. Automated typecheck, self-tests, web build and Electron packaging are the local acceptance checks for this phase.
