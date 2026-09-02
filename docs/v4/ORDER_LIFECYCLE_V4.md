# Order lifecycle V4

An online request, intake assessment, operational order, and final invoice are distinct records. The original request is immutable; physical intake records differences and can require customer approval before an amount changes.

Customer-facing states are derived projections such as Received, Cleaning, Quality Check, Ready, and Out for Delivery. They are not a direct dump of internal sorting/QC/rewash/rack states.

After intake, a marketplace order uses the existing production, garment, bag, QC, assembly, rack, route, and delivery workflows. Source, payment, approval, and settlement rules remain attached rather than creating a separate production path.
