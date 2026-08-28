# Phase 8 worklog — invoice, mini invoice, tags and print centre

Status: In progress. The first controlled print-centre slice is implemented;
full authenticated visual parity, reprint policy and UPI-QR print verification
remain open.

## Implemented

- Added `/laundry/print-centre` with searchable order selection and a branded
  receipt/tag preview.
- Receipt and physical-unit tag documents are rendered from escaped
  order/customer content and routed through the Electron native print dialog
  (with a browser `window.print()` fallback), so operator data cannot become
  executable markup and desktop printing is not blocked by the external-window
  policy.
- Print centre uses the persisted server receipt and tag snapshots rather than
  recalculating totals in the browser.
- Existing Electron PDF export remains available for the current view.

## Evidence

- Web build passed after the print-centre route was added.
- Server typecheck and laundry/payment/auth regression tests passed.

## Remaining gate items

- Authenticated browser visual checks for receipt, mini-invoice, tag sheet,
  controlled reprint and UPI QR settings.
- Confirm print layouts against the supplied reference evidence without
  copying proprietary assets.
