# Epic Laundry — Final Test Report

**Run date:** 2026-08-29

## Passing suites

Server typecheck and authenticated E2E pass. The following domain suites pass: laundry, auth, store migration, entity normalization, customer, package, catalogue, payment, money, reconciliation, cash shift, routes, hardware, diagnostics, encrypted backup, financial normalization, garment traceability, and garment backfill. Desktop workspace isolation, recovery-policy and release-signature tests pass. Web accessibility audit and production build pass. High-severity dependency audits pass with zero vulnerabilities for server, webapp, and desktop.

## Packaging/runtime evidence

- Windows NSIS and portable targets build locally.
- Manifest verification passes with 3,677 release checksum entries.
- Per-user install creates `Epic Laundry.lnk` targeting the installed executable.
- Installed shell opens as `Epic Laundry — Counter Desk`.
- Bundled server responds on an OS-assigned loopback port with `{"status":"ok"}`.
- Scoped backup/restore rehearsal preserves normalized customer and order projections.

## Test limitations

Automated tests are local self-tests, not a substitute for manual screen-reader/keyboard review, packaged Electron E2E, real hardware, provider callbacks, production-scale benchmark fixtures, or an off-device restore drill owned by operations.
