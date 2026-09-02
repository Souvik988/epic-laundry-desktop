import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-device-api-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let closeStore: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'device-owner', password: 'StrongDevicePassword!26', tenant: 'DEVICE-API', storeId: 'STORE-DEVICE', businessName: 'Device API Laundry' } });
  assert.equal(boot.statusCode, 200, 'owner bootstrap succeeds');
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };
  closeStore = () => store.close();

  const enrollment = await app.inject({ method: 'POST', url: '/api/marketplace/device/enrollment', headers });
  assert.equal(enrollment.statusCode, 200, 'owner can generate a local device enrollment');
  const enrolled = enrollment.json();
  assert.match(enrolled.deviceId, /^dev_/);
  assert.match(enrolled.publicKey, /BEGIN PUBLIC KEY/);
  assert.match(enrolled.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.equal(enrolled.storage, 'one-time-response-only', 'private key handling is explicitly one-time and not persisted by the API');
  assert.equal(enrolled.activation, 'EXTERNAL_MARKETPLACE_ACTIVATION_REQUIRED', 'production activation is not fabricated');

  const pending = await app.inject({ method: 'PUT', url: '/api/marketplace/device', headers, payload: { deviceId: enrolled.deviceId, vendorId: 'VENDOR-DEVICE', station: 'Counter', publicKey: enrolled.publicKey, credentialRef: 'secure-ref://device-001', capabilities: { marketplaceSync: true }, softwareVersion: 'v4-test' } });
  assert.equal(pending.statusCode, 200, 'owner can persist a pending local device registration');
  assert.equal(pending.json().status, 'Pending');
  const forbiddenActivation = await app.inject({ method: 'PUT', url: '/api/marketplace/device', headers, payload: { deviceId: enrolled.deviceId, vendorId: 'VENDOR-DEVICE', publicKey: enrolled.publicKey, credentialRef: 'secure-ref://device-001', status: 'Registered' } });
  assert.equal(forbiddenActivation.statusCode, 409, 'local API cannot claim production marketplace activation');
  assert.equal(forbiddenActivation.json().code, 'DEVICE_ACTIVATION_REQUIRED');
  const status = await app.inject({ method: 'GET', url: '/api/marketplace/sync/status', headers });
  assert.equal(status.json().configured, false, 'pending devices cannot enable marketplace sync');
  const revoke = await app.inject({ method: 'POST', url: '/api/marketplace/device/revoke', headers, payload: { reason: 'test rotation' } });
  assert.equal(revoke.statusCode, 200, 'owner can revoke the local device identity');
  assert.equal(revoke.json().status, 'Revoked');
  const noAuth = await app.inject({ method: 'POST', url: '/api/marketplace/device/enrollment' });
  assert.equal(noAuth.statusCode, 401, 'device enrollment is never public');
  await app.close();
  console.log('PASS  marketplace device API contract self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
