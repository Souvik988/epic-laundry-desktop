import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-diagnostics-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json'); process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite'); process.env.EPIC_LEGACY_JSON_FILE = join(tempDir, 'legacy.json');
let closeStore: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); closeStore = () => store.close();
  const { buildDiagnostics } = await import('./modules/ops/diagnostics.js');
  const result = store.withStoreScope('DIAGNOSTICS', 'STORE-DEFAULT', () => buildDiagnostics('DIAGNOSTICS', 'STORE-DEFAULT'));
  assert.equal(result.format, 'epic-laundry-diagnostics');
  assert.equal(result.workspace.tenant, 'DIAGNOSTICS');
  assert.deepEqual(result.redaction, { customerData: 'excluded', credentials: 'excluded', sessionTokens: 'excluded', databasePath: 'excluded', financialAmounts: 'excluded' });
  assert.ok(result.migrations.length >= 4 && result.migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum)), 'diagnostics includes checksummed migrations');
  assert.equal(JSON.stringify(result).includes('password'), false, 'diagnostics never includes password material');
  console.log('PASS  redacted support diagnostics self-test complete');
} finally { closeStore?.(); try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort Windows cleanup */ } }
