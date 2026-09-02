# V4 authority matrix

| Fact | Authority | Edge behavior / conflict rule |
| --- | --- | --- |
| Marketplace customer account, assignment, promotions, provider authorization | Marketplace cloud | Desktop consumes signed/versioned events; it cannot invent success. |
| Physical intake, garment and bag tags, production scans, rack/QC evidence, local cash shift | Vendor desktop edge node | Local operation continues offline and emits durable events after the sync foundation is enabled. |
| Local order and marketplace external IDs | Shared | One local order may have channel links. External links are unique by tenant/store/channel/external ID; never infer source from notes. |
| Customer-facing status | Shared projection | Internal production states map through a configurable customer-status model; customer timeline derives from real events only. |
| Customer invoice and supplier-of-record | NEEDS_LEGAL_VALIDATION | Configuration must explicitly select the issuer. The system must not select vendor or platform automatically. |
| Marketplace payout / withholding / dispute state | Marketplace cloud | Desktop may project records but must not calculate or settle contractual policy independently. |

Never use last-write-wins for financial, tag, identity, consent, invoice, or settlement facts. Events affecting one aggregate require a monotonically increasing aggregate version.
