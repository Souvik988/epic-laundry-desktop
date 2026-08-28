# Phase 12 — UI parity, hardening, migration and packaging

## Delivered so far

- Added branch-scoped backup and restore primitives to the persistence layer.
- Restricted backup/restore APIs to authenticated owners and validated all snapshot collections before replacement.
- Added a safety backup before restore and rolling automatic backups on Electron quit.
- Added Store Settings backup/restore controls with a browser-safe fallback message when the native Electron bridge is unavailable.
- Added regression coverage proving a branch backup excludes another branch, restore removes post-snapshot rows, preserves another branch, and rejects malformed payloads.
- Added a process-level `test:restart` harness that starts the compiled server,
  creates an order through the loopback API, verifies the port is offline after
  termination, restarts against the same SQLite file, and confirms the order
  survives.
- Added an authenticated `test:e2e` scenario covering owner bootstrap,
  catalogue load, booking idempotency, partial payment, partial fulfilment,
  statistics, collection report, reasoned cancellation and backup.
- Refreshed the packaged Electron application after the statistics/reporting pass.
- Replaced the default Electron executable icon with `desktop/icon.ico`, a
  cropped original Lndry mark derived from the supplied brand asset; NSIS and
  portable outputs now package the branded icon.
- Regenerated the folded-shirt catalogue visual with the supplied Lndry mark on
  the care tag and as a small chest embroidery. The approved asset remains at
  `webapp/public/garments/lndry-folded-shirt-v2.png` (mirrored under
  `server/public/app/garments/`) and is a real transparent RGBA PNG.
- Replaced the shell's generic “E” badges and browser favicon with the supplied
  Lndry mark. The shared generated-visual rule is documented in
  `docs/brand/GENERATED_VISUALS.md` so future raster artwork uses the same brand
  treatment.
- Replaced the authentication gate's generic shield with the same Lndry mark and
  visually inspected the first-run screen against the local app (no browser
  console warnings/errors). Authenticated page screenshots remain pending an
  action-authorized sign-in session.
- Remediated high-severity dependency findings: Fastify/static and CORS were
  upgraded to the Fastify 5-compatible patched line, and the unmaintained
  vulnerable `xlsx` package is now resolved through the maintained `@e965/xlsx`
  fork while preserving the existing import/export API. Server and web audits
  now report zero production vulnerabilities. React Router was upgraded to the
  supported 7.18 line and the declarative route surface continues to compile.
  Vite was upgraded to 8.2.2 with the React plugin on its supported 6.1 line;
  the config now resolves paths through `import.meta.url` without build warnings.
- Hardened the local runtime boundary: the server binds to loopback (`127.0.0.1`)
  by default and CORS is disabled unless an explicit comma-separated
  `EPIC_CORS_ORIGIN` allowlist is supplied. The rebuilt NSIS and portable
  packages were smoke-launched; the bundled health endpoint returned HTTP 200
  and the first-run branded owner screen rendered in the Electron window. The
  NSIS package was then installed to the per-user Epic Laundry directory and
  the expected Start Menu shortcut was recreated successfully.
- Closed a desktop print dead-path: receipt and tag printing now uses a bounded
  native Electron IPC print window instead of relying on a denied popup window;
  browser-served builds retain a direct print fallback.
- Added `FINAL_SYSTEM_AUDIT.md`, a current-state reassessment that maps the
  baseline audit requirements to implementation and test evidence while keeping
  authenticated visual and unobserved reference semantics explicitly open.
- Added an explicit accessible sign-out control to the laundry shell and fixed
  bodyless POST requests so logout reaches the server without an empty JSON-body
  error. A disposable authenticated browser smoke then loaded all fifteen
  laundry routes and confirmed return to the sign-in gate; the installed app was
  repackaged and reinstalled with this fix.
- Added a centralized 401 signal in the API client so session expiry clears
  credential fields and returns the renderer to the sign-in gate instead of
  leaving stale operational data visible. The isolated browser fixture verified
  the expiry message, and the Windows package was rebuilt and reinstalled again.
- Regenerated the branded folded-shirt visual once more from the supplied Lndry
  mark, replaced the web and packaged server copies, rebuilt the web bundle and
  Windows installer, and verified the installed RGBA asset hash matches the
  source (`F51096B6396CFF3D7699EC085D03370BC078159399E2B84F84A498E014A2F020`).
- Closed the remaining garment-tag detail gap: every physical-unit tag now
  includes a stable order/line/unit number, explicit `sequence / total`, and
  customer, garment, service, order-date and due-date fields. Browser and
  native Electron print output now render the supplied Lndry mark in the
  header; laundry self-test, authenticated E2E, production build, package and
  installed smoke checks were rerun afterward.
- Added a staff-safe `/api/laundry/print-settings` read endpoint and wired Print
  Centre to honor the owner-configured business logo/contact details and opt-in
  UPI QR toggle without weakening owner-only settings mutation permissions.
- Tightened the browser `window.print()` fallback so only the active receipt/tag
  dialog is printable (the native Electron IPC path remains self-contained),
  rebuilt the production bundle without unresolved-asset warnings, refreshed the
  installed server resources, and relaunched the packaged app. Installed bundle
  hash matches the fresh build and the loopback health endpoint returned HTTP 200.
- Wrapped laundry expense journal and expense-row creation in one store transaction
  so an accounting write cannot partially commit if a later persistence step fails;
  typecheck and the complete server self-test set pass after the change.
- Made first-run owner bootstrap atomic under SQLite and removed the historical
  `dev-key-change-me` literal from browser-delivered legacy compatibility pages;
  those pages now fail closed behind session authentication instead of shipping a
  reusable bearer-equivalent secret. Rebuilt and refreshed the installed package.
- Regenerated the folded-shirt visual again from the supplied Lndry mark. The new
  transparent `lndry-folded-shirt-v3.png` is the active catalogue visual, mirrored
  into the packaged server assets; the prior branded revision remains retained for
  rollback and audit history. The new binary was visually reviewed and hashes
  identically in web and server copies (`923A03BEA59C311029D7B68004742B28F7AD9FF3978B399428722D5D37989223`).
- The first generated revision was rejected during asset QA because its
  checkerboard was baked into an RGB background. A targeted background-extraction
  pass replaced it with a genuine RGBA alpha channel before packaging.
- Re-verified the newly supplied `Lndry Delivery File.zip` brand pack (official
  mark and `#664cf0` purple) against the active shirt visual. Two additional
  generation passes were rejected because the renderer again baked a checkerboard
  into RGB pixels; no invalid output was promoted.
- Hardened order lifecycle writes: `transitionLaundryOrder` and
  `assignLaundryOrder` now run inside SQLite transactions so the order mutation
  and its audit/outbox side effects remain atomic on failure.
- Routed rider-settlement status updates through the shared API client so the
  control inherits centralized 401/session-expiry handling and consistent API
  error parsing.
- Reconciled the dashboard's `todayRevenue` KPI with reports and trend charts by
  excluding cancelled orders; the laundry self-test now asserts the cancellation
  delta exactly.
- Made rider settlement creation idempotent at the API boundary and locked
  reconciled/rejected settlements against in-place financial edits. Regression
  coverage now exercises duplicate HTTP submission and terminal immutability.
- Centralized laundry business-date handling in the configured local timezone
  (`EPIC_TIME_ZONE`, default `Asia/Kolkata`) and removed UTC-shifted date-input
  defaults from booking and expense forms. A midnight-boundary regression check
  covers the server-side date key.
- Reconciled statistics and reporting aggregates: cancelled orders are excluded
  from active overview totals and payment mix, while the four UniClean-style
  overview buckets explicitly aggregate Epic lifecycle states (`Picked Up`/
  `In Process` and `Ready`/`Out for Delivery`). Regression coverage now asserts
  the bucket sum equals the displayed active-order total.
- Reconciled the growth-report tax subtotal with the active-order revenue
  subtotal so cancelled orders cannot inflate tax or the derived amount before
  tax; the laundry self-test now verifies the cancellation delta.
- Added approved branded visual coverage for every seeded garment (trouser,
  saree, kurti, blanket, bed sheet, mixed clothes and shoe pair) with genuine
  alpha transparency and non-white colorways; the catalogue visual picker now
  exposes the complete local set.
- Added a deterministic first-run laundry demo seed with eight customers,
  varied order dates, payment modes and lifecycle states so the overview charts,
  dispatch queues, order list and customer-frequency cards are populated on a
  fresh install.
- Made generated garment tags visible directly in the order work card, in
  addition to the existing branded print-centre tag sheet.
- Rebuilt the Overview screen as the primary post-Dashboard destination. It now
  exposes Today, Last 7 days and Lifetime ranges, six KPI cards, a combined
  revenue/collection/order trend, lifecycle and customer-frequency donuts,
  acquisition and receipts trends, service-demand ranking, and daily throughput.
  The Lifetime range is backed by the full active order history rather than a
  presentation-only toggle.
- Rebuilt the Windows NSIS and portable artifacts after the Overview upgrade,
  silently removed the prior installation, installed the refreshed build, and
  verified the installed app's loopback health endpoint returns HTTP 200.

## Integrity decisions

The legacy `records` schema stores branch scope separately from its historical key shape, so scoped restore deletes and rewrites only the active tenant/store scope. Global sequence values are never moved backwards by a branch restore. Session identities are intentionally retained outside the operational snapshot so a restore cannot strand the owner account.

## Remaining acceptance gate

Authenticated browser screenshots and cross-role interaction checks still require an action-authorized login session in the reference/application browser. The repository-side typechecks, regression tests, web build, Electron packaging, compiled restart/offline test, and packaged loopback health smoke are passing; only the authenticated visual/cross-role gate remains explicitly tracked rather than inferred.
