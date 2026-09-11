# Comparative Operational UX Audit

**Review date:** 2026-09-09
**Purpose:** identify operational UX improvements for Epic Laundry. This is a workflow comparison only. Epic Laundry must not copy MyUniClean source code, imagery, branding, wording, or visual design.

## Evidence and classification

| Area | Classification | Evidence | Finding |
| --- | --- | --- | --- |
| Reference dashboard | `VERIFIED_REFERENCE` | Live authenticated reference dashboard | Strong at a short daily-work triage: collection, requests, pending work, pipeline, attention items, and quick actions. |
| Reference Order & Billing | `VERIFIED_REFERENCE` | Live authenticated reference order screen | Uses a visual catalogue, category/service filters, a persistent selected-order panel, payment choices, and a clear final booking action. |
| Reference Store Orders | `VERIFIED_REFERENCE` | Live authenticated reference screen | Offers direct filters, search, list/grid view switch, pagination and an empty state. |
| Reference Store Expense | `VERIFIED_REFERENCE` | Live authenticated reference screen | Keeps entry, period filters and expense list together. |
| Reference settings / reports | `VERIFIED_REFERENCE` | Live authenticated reference screens | Groups store, pricing, catalogue and operations configuration; report menu is discoverable by business question. |
| Epic route inventory | `EPIC_EXISTING` | `LaundryShell.tsx` navigation and route code | Epic already covers the reference core and additionally covers tags, production, QC, returns, delivery, cash closing, payroll, statutory controls, marketplace sync, settlements and finance setup. |
| Wider reference detail screens | `NEEDS_VERIFICATION` | Not reviewed in this pass | Individual report pages, add-expense form, filters and settings subforms need separate runtime review before making any interaction-specific claim. |

## Changes implemented in this pass

1. **Counter GST default** — a named `GST 18% · Laundry service (SAC 9997)` rule is seeded idempotently into each scoped laundry catalogue. It is selected by default only when the store is configured as GST-registered.
2. **One tax truth between setup and counter** — saving a registered supplier profile enables counter GST and transfers its validated GSTIN; saving an unregistered profile disables counter GST. Both actions are audited.
3. **Explainable counter UI** — booking clearly tells the operator which standard rule is being used and that invoice logic resolves CGST/SGST versus IGST from actual supplier and place-of-supply facts.
4. **Visual booking workspace** — the order desk already follows the productive parts of the reference pattern with visual service chips, image-led garment selection, a persistent basket and a large booking action; it remains original Epic Laundry UI.

## Prioritized Epic improvements

### P0 — retain financial truth

- Keep the standard 18% rate restricted to the standard laundry-service rule; never use it as a blanket rate for products, commissions, logistics or historical invoices.
- Keep GST disabled until a real supplier profile is saved. Missing profile data is a configuration state, not a reason to use demo GSTINs or hidden defaults.
- Show the selected tax rule, rate, taxable value, tax total and final total on the booking summary and canonical invoice.

### P1 — make daily work faster

- Add a compact dashboard triage band for: action required, pickup today, production risk, ready for delivery, cash attention and sync failures. Counts must remain server-authoritative.
- Standardize operational lists around persistent search, date/status filters, deterministic sorting, pagination and a meaningful empty state.
- Keep a single visible primary action on each work screen: book order, record intake, complete QC, dispatch, close cash, or save configuration.
- Make Finance Setup the single entry point for legal entity, supplier tax profile, payroll coverage and readiness, with plain-language status labels.

### P2 — reduce navigation cost without hiding capability

- Keep Epic's richer modules grouped into Operations, Finance & compliance, Customers and Settings; do not flatten them into a long legacy-style menu.
- Add contextual links from Store Orders to Work Card, tags, production, payment, invoice, pickup/delivery and corrections instead of duplicating data entry.
- Organize reports around questions (sales, collections, operating costs, tax, production, riders, customers and marketplace), with a visible date scope and a concise metric summary before detail rows.

## Explicit non-goals

- No MyUniClean logo, palette, assets, screenshots, source code or proprietary behaviour is reused.
- No generic 18% GST is applied to all catalogue records or to an incomplete/legacy entity profile.
- No tax, payment, filing or e-invoice success is represented without its required configuration and external evidence.
