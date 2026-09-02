# India tax-compliance architecture

Status: **PARTIAL / NEEDS_LEGAL_VALIDATION.** Existing fixed-scale money is retained, but current tax setup is not an approved India production tax engine.

V4 requires line-level immutable tax snapshots (classification, SAC/HSN, taxable value, CGST/SGST/IGST/cess, rounding), effective-dated accountant-approved rules, supplier/store tax profiles, explicit place-of-supply evidence/override audit, and Indian financial-year invoice series. The readiness gate now requires an effective approved classification for registered suppliers; unregistered stores can remain operational with an explicit unregistered profile and e-invoice `NotApplicable` state. Production entry-point invoice/posting paths resolve the supplier state only from that persisted profile and return `TAX_PROFILE_INCOMPLETE` when it is missing. The isolated demo workspace and direct test harnesses retain an explicit compatibility fallback; the desktop no longer injects state 29 into the production server environment.

GST applicability, e-invoice thresholds, reporting windows, marketplace TCS/TDS, supplier-of-record, and GSP behavior must be verified against current official sources and approved by the business's CA/legal counsel before activation. Sandbox data and placeholder QR codes must never be represented as production IRN evidence.
