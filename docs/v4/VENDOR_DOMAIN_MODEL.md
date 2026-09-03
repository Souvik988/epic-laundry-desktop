# Vendor domain model

## Boundary and lifecycle

The marketplace cloud is authoritative for `platform`, marketplace vendor identity, vendor/store assignment, published catalogue mappings, settlement policy and payout state. Epic Laundry Desktop is the local operational node for one tenant/store scope. It may operate in `Local Standalone` mode without any marketplace records.

The normalized target concepts are:

`platform` → `vendor` → `vendor_store` → `vendor_device` → `station`

and, alongside them, `vendor_user`, `vendor_document`, `vendor_tax_profile`, `vendor_service_zone`, `vendor_capability`, `vendor_availability`, and `vendor_settlement_profile`.

The current local implementation provides the store-scoped `marketplace_devices`, `marketplace_store_availability`, and `marketplace_catalogue_mappings` records. Catalogue mappings connect a local garment/service to canonical marketplace category/service IDs and snapshot public pricing, units, turnaround, visibility, approval, and effective dates. A device lifecycle is `Pending` → externally activated `Registered` → `Revoked`; the local API cannot claim the activation transition. `POST /api/marketplace/device/enrollment` creates an Ed25519 keypair for one-time handoff, `PUT /api/marketplace/device` persists local Pending metadata, and `POST /api/marketplace/device/revoke` records an auditable revocation. The private key is not persisted by the server response path; an operator must place it in protected OS storage before any real control-plane integration.

## Data protection and isolation

Bank details and government documents must be references to tokenized/secure provider storage, never plaintext operational records. Vendor/store scope is a mandatory query predicate and must be tested against cross-vendor access. Local store identifiers are never accepted as permission overrides: authenticated session scope and the active store context remain authoritative.

Real vendor onboarding, document verification, settlement profile activation, cloud-issued short-lived machine credentials, key rotation and cross-vendor cloud authorization remain external-contract work and must not be represented as complete by the desktop simulator.
