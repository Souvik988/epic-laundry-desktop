import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-clean-db-bootstrap-'));
const databaseFile = join(tempDir, 'fresh', 'workspace', 'epic.sqlite');
process.env.EPIC_DB_FILE = databaseFile;
process.env.EPIC_DATA_FILE = join(tempDir, 'fresh', 'workspace', 'legacy.json');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;

let closeStore: (() => void) | undefined;
try {
  assert.equal(existsSync(join(tempDir, 'fresh')), false, 'test starts with no database parent directory');
  const { Store, store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  assert.equal(existsSync(databaseFile), true, 'first Store instantiation creates the configured database path');
  assert.ok(store.migrationStatus().length >= 26, 'first Store instantiation applies schema migrations');

  store.close();
  closeStore = undefined;
  const restarted = new Store(databaseFile, { skipLegacyImport: true });
  closeStore = () => restarted.close();
  assert.ok(restarted.migrationStatus().length >= 26, 'database restarts with the applied schema');
  console.log('Clean database bootstrap regression passed.');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
