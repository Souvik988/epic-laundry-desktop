import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-customer-privacy-api-')); process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite'); let close: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default; const { store } = await import('./kernel/store.js'); const { registerApi } = await import('./api.js'); close = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'privacy-api-owner', password: 'PrivacyApiPassword!26', tenant: 'PRIVACY-API', storeId: 'STORE-PRIVACY-API', businessName: 'Privacy API Laundry' } }); assert.equal(boot.statusCode, 200, 'privacy API owner bootstrap succeeds');
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };
  const created = await app.inject({ method: 'POST', url: '/api/laundry/customers', headers: { ...headers, 'idempotency-key': 'privacy-api-create-1' }, payload: { name: 'API Privacy Customer', phone: '9000000810', email: 'api-private@example.test' } }); assert.equal(created.statusCode, 201, 'privacy API can create a local customer'); const customerId = created.json().id;
  const exported = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}/privacy-export`, headers }); assert.equal(exported.statusCode, 200, 'privacy API exposes a controlled export'); assert.equal(exported.json().data.customer.email, 'api-private@example.test', 'controlled export contains local customer data');
  const request = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/privacy-requests`, headers: { ...headers, 'idempotency-key': 'privacy-api-request-1' }, payload: { type: 'Erasure' } }); assert.equal(request.statusCode, 201, 'privacy API opens an erasure request');
  const complete = await app.inject({ method: 'POST', url: `/api/laundry/privacy-requests/${request.json().id}/complete`, headers: { ...headers, 'idempotency-key': 'privacy-api-complete-1' }, payload: {} }); assert.equal(complete.statusCode, 200, 'owner can complete a privacy request');
  const profile = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}`, headers }); assert.equal(profile.json().customer.name, '[Redacted Customer]', 'API reflects completed erasure without deleting the customer reference');
  const noAuth = await app.inject({ method: 'GET', url: '/api/laundry/privacy-requests' }); assert.equal(noAuth.statusCode, 401, 'privacy request list is authenticated'); await app.close(); console.log('PASS customer privacy export/request/erasure API contract self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
