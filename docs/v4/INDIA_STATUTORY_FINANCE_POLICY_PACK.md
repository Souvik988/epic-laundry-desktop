# India statutory finance policy pack — 03 September 2026

This implementation creates a tenant-scoped, effective-dated regulatory policy registry. It separates verified rules from business and establishment facts so a rate cannot silently enable a filing, payment, or liability.

## Implemented policy baseline

| Policy | Status | Activation gate |
| --- | --- | --- |
| Income-tax Act 2025 TDS transition / section 393 | `VERIFIED_CURRENT_STATUTE` | Transaction classification and timing |
| Resident contractor TDS baseline | `VERIFIED_CURRENT_RATE` | Payee type, threshold and PAN state |
| Laundry SAC 9997 / 18% | `VERIFIED_CURRENT_RATE` | Supplier profile and place-of-supply resolution |
| Salary new-regime TY 2026–27 slabs | `VERIFIED_CURRENT_RATE` | Employee declaration / high-income review |
| Common wages 50% rule | `VERIFIED_CURRENT_STATUTE` | Component classification |
| EPF 12% baseline | `ESTABLISHMENT_CONFIGURATION_REQUIRED` | EPF coverage/rate category/membership |
| ESIC 3.25% + 0.75% baseline | `ESTABLISHMENT_CONFIGURATION_REQUIRED` | ESIC coverage / wage exception |
| Professional tax | `STATE_RULE_REQUIRED` | Work state and effective state policy |
| Marketplace supplier model | `BUSINESS_MODEL_SIGNOFF_REQUIRED` | Executed contracts |
| Gig-worker social security | `AWAITING_NOTIFICATION` | Applicable central notification |

## Authoritative implementation constraints

- Every policy has a stable policy key, effective start, source, verification date and version.
- Historical transactions must snapshot their resolved policy version before a monetary posting is allowed.
- The payroll preview uses paise integers, separates statutory wages from gross earnings, calculates a configured new-regime projection, and validates the wage-deduction cap.
- A preview is not a payslip, statutory payment, return, challan, filing, IRN or acknowledgement.
- The current release does **not** mark any TDS/TCS/GST/EPF/ESI/PT liability as paid or filed without evidence.

## Primary source provenance

- [Income Tax Department TDS transition](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)
- [Income Tax Department AY 2026–27 slab guidance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr-2/itr-2-faqs)
- [CBIC GST rate schedule](https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html)
- [Ministry of Labour wages FAQs](https://labour.gov.in/sites/default/files/faqs_on_labour_codes.pdf)
- [EPFO contribution-rate guidance](https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/ContributionRate.pdf)
- [ESIC coverage and contribution guide](https://esic.gov.in/attachments/publicationfile/79b91f03d8b280e6dc6da3537617ef26.pdf)

The next implementation slice connects these policies to versioned payroll runs, supplier/payee classification, expense withholding, invoice tax snapshots, marketplace settlements, and the compliance calendar. Those actions remain blocked until the entity, establishment, state, and marketplace facts identified by the readiness screen are configured.
