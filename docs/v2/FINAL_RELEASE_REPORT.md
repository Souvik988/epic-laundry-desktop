# Epic Laundry — Final Release Report

## Artifact status

The current Windows artifact is locally built with Electron 44.0.0 and electron-builder 26.15.3, manifest-verified, installed per-user and launched. The bundled server runtime includes its production dependencies (including Fastify and native better-sqlite3), migration 16 customer/order projection code, owner-visible entity migration controls, and `/api/health` returned HTTP 200 from the installed app. `npm audit --audit-level=high` reports zero vulnerabilities. The generated manifest provides SHA-256 integrity coverage; Ed25519 signing and verification tooling is present and tested.

## Release blockers

1. Production Authenticode and installer/update signing require protected certificate/key custody.
2. A trusted update origin, release channels, rollback policy and update telemetry are not configured.
3. Entity-specific historical migration and compatibility-field retirement are not certified.
4. Off-device backup retention and RPO/RTO ownership are not operationally assigned.
5. Scanner, scale, thermal printer, cash drawer, RFID and messaging/payment providers need real equipment/credentials.

Until these are closed, label the bundle **controlled/local deployment**, not a fully signed enterprise release.
