# Epic Laundry — Final Product Capability Matrix

| Capability | Status | Evidence / next gate |
|---|---|---|
| Production/demo separation | PARTIAL | Explicit workspace mode and setup controls; complete production install checklist |
| Authenticated desktop bootstrap | VERIFIED | Nonce/HMAC random-port handshake and tests |
| Store isolation and RBAC | VERIFIED | Server guards and cross-store auth tests |
| Orders, pricing, invoices, payments | PARTIAL | Server-authoritative flows and paise reconciliation; historical migration remains |
| Catalogue/import | PARTIAL | Owner-controlled neutral master/import; reference-specific completeness still needs approval |
| Garment identity/tagging | PARTIAL | Durable units, scans, reprints, backfill; real printer/scanner certification remains |
| Production/QC/rewash | PARTIAL | Durable tasks, SLA, claims and correction documents; richer scheduling/customer portal remain |
| Customer 360/packages | PARTIAL | Addresses, preferences, consent, retention and package liability; provider-backed communications remain |
| Pickup/delivery/routes | PARTIAL | Zones, route runs, stop ownership, settlements and analytics; live optimization remains |
| Reporting/analytics | PARTIAL | Pagination, saved views, cursor CSV exports and indexed date predicates; aggregate index-only plans remain |
| Backup/recovery | PARTIAL | Encrypted backups, rollback snapshots and fresh-DB rehearsal; off-device monitoring remains |
| Hardware abstraction | PARTIAL | Truthful capability registry and receipts; vendor adapters need equipment |
| Security/release | PARTIAL | Hardened local boundaries and signing tooling; protected signing/update infrastructure remains |
| CI/testability | VERIFIED (local) | GitHub Actions, SBOM, self-tests, a11y/build/manifest gates |

This matrix is intentionally conservative: a working control is not promoted to production-certified status without deployment evidence.
