# Performance report

Audit date: 2026-09-03. The local benchmark is disposable and runs against a fresh SQLite database; it never writes benchmark data into the repository or the production app-data path.

## Full local fixture

Command: `npm run benchmark:v4-performance` with `V4_BENCH_CUSTOMERS=100000` and `V4_BENCH_ORDERS=500000`.

| Measurement | Result |
| --- | ---: |
| Customers seeded | 100,000 |
| Orders seeded | 500,000 |
| Seed time | 47 s |
| First order page (50 rows) | 164.59 ms |
| Deep order page 10,000 (50 rows) | 396.26 ms |
| Customer-name search | 5,070.48 ms |
| Search result count | 5 |

The page query plan selected `entity_rows_laundry_order_page_sort`, added by migration 30. Migration 31 also indexes the order-to-customer JSON reference. The benchmark validates bounded SQL pagination and deterministic deep paging, but the customer-name search result is not acceptable as a release-performance pass and remains a High performance finding for operator lookup.

## Scope limits

This fixture uses minimal synthetic entity rows. It does not prove startup time, tag scanning, garment traceability, reports, PDF/printing, React virtualization, cloud catch-up, or hardware performance. Those remain `NEEDS_VERIFICATION`; no cloud-scale or hardware performance claim is made.

V4 performance status: **NEEDS_VERIFICATION**.
