# Demo Data V4 — Installed Workspace Fixture

## Purpose

The demo workspace is intentionally populated so that operational, finance, tax, quality, returns, marketplace and reporting screens have meaningful data at first launch. This is a visual and workflow fixture, not production evidence.

## Safety

The seed runs only when `EPIC_WORKSPACE_MODE=demo` for tenant `T1`. It uses the `demo_data_v4_1` marker and deterministic source references, so restarting the app does not duplicate records. Production mode does not receive generated demo data.

## Evidence boundary

Prepared statutory returns, sandbox e-invoice state, pending sync events and demo settlement evidence are visibly demo/control-plane fixtures. They do not mean that a government return, IRN, payment-provider capture or payout occurred. Real PAN/TAN/GST, state policies, provider credentials and external filing evidence remain user-configured.

## Installed verification

The current installed database was checked after reinstall:

| Fixture | Count |
| --- | ---: |
| Laundry orders | 60 |
| Canonical invoice snapshots | 52 |
| Expenses | 24 |
| TDS transactions | 18 |
| TCS transactions | 20 |
| Prepared returns | 8 |
| Quality claims | 8 |
| Return cases | 6 |
| Marketplace projections | 12 |
| Marketplace settlements | 6 |
| Marketplace cash collections | 2 |
| Route runs | 1 |

The local server health endpoint returned `ok` after launch, and the clean temporary-workspace restart test returned identical counts before and after restart.
