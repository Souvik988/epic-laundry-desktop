# Legacy ERP Surface Decision

Status: `VERIFIED_CURRENT` — 2026-09-03

## Finding

The installed desktop menu exposed old static pages such as `manufacturing.html`,
`projects.html`, `accounting.html`, and `gst.html`. Those pages used the old
"Epic BOS" name and a separate blue ERP visual system. They did not operate on
the Laundry Desk's authenticated local order, garment, payment, invoice, or
store lifecycle.

This created a misleading product boundary: a counter operator could leave
Epic Laundry from a core menu and land in an unrelated prototype UI.

## Decision

The desktop menu now routes Operations and Finance & Compliance exclusively to
the authenticated Laundry Desk. The generic prototype pages remain unmodified
in the packaged compatibility assets, but are no longer product navigation or
an application route.

### Operations is now

- store orders;
- production queue;
- garment and container tracking;
- quality and correction work;
- pickup, delivery, and route runs;
- canonical print documents.

### Finance & Compliance is now

- cash closing;
- recorded store expenses;
- rider settlements;
- canonical invoices and receipts;
- reports;
- tax and invoice configuration;
- controlled correction documents.

## Authority and scope

The existing generic ERP APIs and metadata are preserved rather than deleted.
They are not represented as integrated Laundry Desk capabilities because there
is no evidence that their records share the V4 order, store, tax, or invoice
authority. A future reintroduction requires a documented mapping, ownership
rule, migrations, and cross-channel tests; styling alone is insufficient.

## Visual-system correction

The active desk now bundles Manrope locally and uses it for body, display, and
previously serif-labelled headings. Noto Sans Devanagari is bundled as the
offline script fallback for Hindi names. This removes the OS-dependent Aptos /
Palatino mix and keeps dense Indian-currency and operational text consistent
offline.
