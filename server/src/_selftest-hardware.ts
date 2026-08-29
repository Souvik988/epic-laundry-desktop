import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-hardware-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json'); process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite'); process.env.EPIC_LEGACY_JSON_FILE = join(tempDir, 'legacy.json');
let closeStore: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); closeStore = () => store.close();
  const { hardwareCapabilities, hardwareStatus, listHardwareReceipts, recordHardwareReceipt } = await import('./modules/laundry/hardware.js');
  const tenant = 'HARDWARE'; store.withStoreScope(tenant, 'STORE-DEFAULT', () => undefined);
  const capabilities = hardwareCapabilities();
  assert.equal(capabilities.find((item) => item.kind === 'receipt-printer')?.status, 'available', 'native print adapter is reported available');
  assert.equal(capabilities.find((item) => item.kind === 'weighing-scale')?.status, 'not_configured', 'unconfigured scale is not reported as available');
  assert.throws(() => store.withStoreScope(tenant, 'STORE-DEFAULT', () => recordHardwareReceipt(tenant, 'operator', { kind: 'receipt-printer', operation: 'print', status: 'Completed', device: 'electron-system-dialog', evidence: 'ok' })), /concrete evidence/, 'completed receipt requires concrete evidence');
  const receipt = store.withStoreScope(tenant, 'STORE-DEFAULT', () => recordHardwareReceipt(tenant, 'operator', { kind: 'receipt-printer', operation: 'print', status: 'Completed', device: 'electron-system-dialog', sourceEntity: 'laundry_order', sourceId: 'LND-1', evidence: 'Electron print callback reported success' }));
  assert.match(receipt.evidenceHash, /^[a-f0-9]{64}$/, 'hardware receipt stores evidence hash');
  assert.equal(store.withStoreScope(tenant, 'STORE-DEFAULT', () => listHardwareReceipts(tenant)).length, 1, 'hardware receipt is retained for support audit');
  const status = store.withStoreScope(tenant, 'STORE-DEFAULT', () => hardwareStatus(tenant));
  assert.equal(status.find((item) => item.kind === 'receipt-printer')?.health, 'evidence_seen', 'hardware status exposes receipt evidence');
  assert.equal(status.find((item) => item.kind === 'weighing-scale')?.health, 'not_configured', 'hardware status keeps unconfigured devices truthful');
  console.log('PASS  hardware capability truthfulness and print receipt evidence self-test complete');
} finally { closeStore?.(); rmSync(tempDir, { recursive: true, force: true }); }
