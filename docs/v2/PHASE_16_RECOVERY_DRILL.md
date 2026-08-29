# V2 Phase 16 — Fresh-database recovery drill

**Status:** DELIVERED as a local, repeatable recovery test.

## Delivered

- Added `server npm run test:recovery-drill`.
- The drill boots a fresh packaged server, completes first-run setup, creates a
  cash-paid order, captures the versioned workspace backup, stops the process,
  replaces the active database with a clean database, restores the envelope,
  and verifies the order plus canonical financial entries are present.
- The restore path remains workspace-bound and checksum-verified; the test uses
  only the server's internal owner boundary and temporary files.
- Restore clears ephemeral idempotency-command records for the target store,
  preventing a pre-restore key from returning a response that no longer matches
  the restored data. E2E verifies that an old key creates fresh post-restore work.
- Added non-mutating plaintext and encrypted restore verification endpoints. The
  desktop restore flow verifies checksum, workspace binding, decryption and
  payload shape before showing the destructive confirmation or writing a
  pre-restore safety snapshot.
- Rolling auto-backups can be directed to an owner-selected OS folder (for
  example, an encrypted removable or network-backed destination) with isolated
  production/demo namespaces.
- The owner settings surface exposes a read-only health signal for the latest
  rolling snapshot, encryption, destination writability and age; unavailable,
  empty or stale destinations are visible as unhealthy rather than silently
  presented as complete.
- Every scheduled automatic snapshot is immediately passed through the
  authenticated non-mutating restore verifier and a fresh-database rehearsal.
  The rehearsal restores the validated envelope into a brand-new temporary
  SQLite file, compares durable record counts, computes a redacted SHA-256
  digest, and removes the temporary database. A redacted
  `recovery-rehearsal.json` record stores the verified snapshot name, timestamp,
  safe row counts and isolated-database result; the owner settings surface also
  supports an explicit latest-snapshot verification.
- Scoped snapshots also include the certified `financial_normalization_runs`
  ledger (including wallet-backfill counts), and the fresh-database rehearsal
  compares those evidence rows alongside operational and financial records.
- CI runs this drill alongside encrypted-backup and restart persistence tests.

Interactive plain and encrypted restores fail closed if the required
pre-restore rollback snapshot cannot be written; replacement never begins
without a successful safety snapshot. This policy is covered by the
dependency-free desktop recovery-policy self-test.

## Evidence

| Check | Result |
|---|---|
| `server npm run test:recovery-drill` | PASS — fresh database restore preserves operational and financial truth. |
| `server npm run test:backup-crypto` | PASS — AES-GCM round-trip and tamper rejection. |
| `server npm run test:restart` | PASS — process restart preserves SQLite state. |
| `server npm run test:e2e` | PASS — valid backups verify without mutation and tampered payloads fail before restore. |

## Remaining boundary

This proves local recovery mechanics and a scheduled fresh-database integrity
rehearsal. Production operations still require monitored off-device encrypted
retention, artifact signing, and documented RPO/RTO ownership.
