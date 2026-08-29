# Epic Laundry V2 — Release Model

## Current state

Electron Builder creates Windows NSIS and portable artifacts locally. Each
packaging command now writes a sorted SHA-256 `dist/release-manifest.json`
covering every generated release file and provides a verifier command. GitHub
Actions now runs dependency auditing, SBOM generation, server boundary tests,
web build checks and desktop workspace isolation. The repository still has no
signing certificate or provider-backed update feed configuration. Packaged
builds fail closed and do not contact an updater unless an explicit
`EPIC_UPDATE_FEED_URL` points to an HTTPS allow-listed host, so it must not claim
production auto-update safety until that provider is configured and tested.

## Required release gate

1. Clean dependency install and lockfile validation.
2. Type checks, unit/domain/API/migration tests, web build and Electron smoke test.
3. Secret scanning, dependency review, SBOM and license policy checks.
4. Versioned migration compatibility test and backup/restore reconciliation drill.
5. Windows artifact, generated checksums, signing (when a certificate is provided), release
   notes and a manually controlled stable/beta channel.

Code signing, notarization and provider-backed updates are external dependencies;
their architecture can be added without putting credentials into Git.
