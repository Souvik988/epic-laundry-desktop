import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-store-migration-'));
const legacyFile = join(tempDir, 'legacy.json');
const sqliteFile = join(tempDir, 'legacy.sqlite');

// Reproduce the first SQLite schema produced before store-level scoping.
const legacy = new Database(sqliteFile);
legacy.exec(`
  CREATE TABLE entity_rows (
    tenant TEXT NOT NULL, id TEXT NOT NULL, entity TEXT NOT NULL, status TEXT NOT NULL,
    version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY (tenant, id)
  );
  CREATE TABLE records (kind TEXT NOT NULL, tenant TEXT NOT NULL, id TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY (kind, tenant, id));
  CREATE TABLE sequences (series TEXT PRIMARY KEY, value INTEGER NOT NULL);
  CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
legacy.prepare('INSERT INTO entity_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('MIGRATE', 'ROW-1', 'party', 'Active', 1, 'legacy', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', JSON.stringify({ name: 'Migrated customer', is_customer: true }));
legacy.close();

process.env.EPIC_DATA_FILE = legacyFile;
process.env.EPIC_DB_FILE = sqliteFile;
let closeStore: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const migrated = store.withStoreScope('MIGRATE', 'STORE-DEFAULT', () => store.getRow('MIGRATE', 'ROW-1'));
  assert.equal(migrated?.data.name, 'Migrated customer', 'legacy SQLite data is available in the default store after migration');
  const hiddenFromOtherStore = store.withStoreScope('MIGRATE', 'STORE-B', () => store.getRow('MIGRATE', 'ROW-1'));
  assert.equal(hiddenFromOtherStore, undefined, 'migrated rows are isolated from other stores');
  const migrations = store.migrationStatus();
  assert.deepEqual(migrations.map((migration) => migration.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 'schema migrations are recorded in monotonically ordered versions');
  assert.equal(migrations.at(-1)?.name, 'normalized-customer-order-projections', 'normalized customer/order projection migration is checksum-tracked');
  assert.ok(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)), 'each migration has a SHA-256 checksum');
  console.log('PASS  legacy SQLite store-scope migration self-test complete');
} finally {
  closeStore?.();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort Windows cleanup */ }
}
