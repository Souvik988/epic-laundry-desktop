import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-api-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let closeStore: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { createDeviceEnrollment, receiveMarketplaceOrder, registerMarketplaceDevice } = await import('./modules/marketplace/edge-sync.js');
  closeStore = () => store.close();
  const app = Fastify(); registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'marketplace-owner', password: 'StrongMarketplacePassword!26', tenant: 'MKT-API', storeId: 'STORE-API', businessName: 'Marketplace API Laundry' } });
  assert.equal(boot.statusCode, 200, 'owner bootstrap succeeds for marketplace API contract test');
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0] };
  const tenant = 'MKT-API'; const storeId = 'STORE-API'; const enrollment = store.withStoreScope(tenant, storeId, () => createDeviceEnrollment());
  const device = store.withStoreScope(tenant, storeId, () => registerMarketplaceDevice(tenant, 'marketplace-owner', { deviceId: enrollment.deviceId, vendorId: 'VENDOR-API', publicKey: enrollment.publicKey, credentialRef: 'sim://marketplace-api', status: 'Registered' }));
  const incoming = {
    eventId: 'marketplace-api-order-001', source: 'simulator', tenantId: tenant, vendorId: 'VENDOR-API', storeId, deviceId: device.id,
    aggregateType: 'marketplace_order', aggregateId: 'EXT-API-001', aggregateVersion: 1, eventType: 'marketplace.order.assigned.v1', eventVersion: 1, occurredAt: new Date().toISOString(),
    payload: { externalOrderId: 'EXT-API-001', channel: 'CUSTOMER_APP', state: 'AwaitingAcceptance', orderNumber: 'APP-001', customer: { name: 'Kavya Nair' } },
  };
  store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, 'marketplace-owner', incoming));
  const status = await app.inject({ method: 'GET', url: '/api/marketplace/sync/status', headers });
  assert.equal(status.statusCode, 200, 'owner can inspect marketplace sync diagnostics');
  assert.equal(status.json().configured, true, 'diagnostics identify a registered marketplace device');
  const availabilityBefore = await app.inject({ method: 'GET', url: '/api/marketplace/availability', headers });
  assert.equal(availabilityBefore.json().state, 'NotConfigured', 'marketplace availability starts explicitly unconfigured');
  const availabilitySave = await app.inject({ method: 'PUT', url: '/api/marketplace/availability', headers: { ...headers, 'idempotency-key': 'marketplace-api-availability-001' }, payload: { state: 'Open', serviceZones: ['Central'], capacity: { orders: 40, bags: 80, kg: 250, stops: 30 }, capabilities: { pickup: true, delivery: true, express: false }, staleAfterMinutes: 45, leadTimeMinutes: 120 } });
  assert.equal(availabilitySave.statusCode, 200, 'owner can persist an explicit marketplace availability projection');
  assert.equal(availabilitySave.json().state, 'Open', 'availability preserves the configured store state');
  const orders = await app.inject({ method: 'GET', url: '/api/marketplace/orders?state=AwaitingAcceptance&limit=20', headers });
  assert.equal(orders.statusCode, 200, 'authenticated operator can load the online order queue');
  assert.equal(orders.json().items.length, 1, 'queue returns the store-scoped external order once');
  store.withStoreScope(tenant, storeId, () => store.insertRow({ id: 'LOCAL-API-ORDER-001', entity: 'laundry_order', tenant, status: 'Booked', version: 1, created_by: 'marketplace-owner', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), data: { name: 'LOCAL-API-ORDER-001', state: 'Booked' } }));
  const link = await app.inject({ method: 'POST', url: '/api/marketplace/orders/EXT-API-001/link', headers: { ...headers, 'idempotency-key': 'marketplace-api-link-001' }, payload: { localOrderId: 'LOCAL-API-ORDER-001' } });
  assert.equal(link.statusCode, 200, 'operator can explicitly bind an online projection to a physical local order');
  assert.equal(link.json().projection.localOrderId, 'LOCAL-API-ORDER-001', 'projection stores the stable local operational identity');
  const intake = await app.inject({ method: 'POST', url: '/api/marketplace/orders/EXT-API-001/intake', headers: { ...headers, 'idempotency-key': 'marketplace-api-intake-001' }, payload: { actual: { pieces: 6 }, reason: 'physical count at counter' } });
  assert.equal(intake.statusCode, 200, 'operator can record physical intake separately from the online request');
  const reassessment = await app.inject({ method: 'POST', url: '/api/marketplace/orders/EXT-API-001/reassessment', headers: { ...headers, 'idempotency-key': 'marketplace-api-reassessment-001' }, payload: { previousAmountPaise: 10000, revisedAmountPaise: 12500, tolerancePaise: 100, reason: 'actual pieces differ from estimate' } });
  assert.equal(reassessment.json().data.state, 'PendingApproval', 'material reassessment is blocked pending customer approval');
  const approval = await app.inject({ method: 'POST', url: `/api/marketplace/reassessments/${reassessment.json().id}/approve`, headers: { ...headers, 'idempotency-key': 'marketplace-api-approval-001' }, payload: {} });
  assert.equal(approval.json().data.state, 'Approved', 'approval route records the final reassessment decision');
  const accept = await app.inject({ method: 'POST', url: '/api/marketplace/orders/EXT-API-001/accept', headers: { ...headers, 'idempotency-key': 'marketplace-api-accept-001' }, payload: {} });
  assert.equal(accept.statusCode, 200, 'operator can accept an awaiting marketplace order');
  assert.equal(accept.json().order.state, 'Accepted', 'accepted action updates the local operational projection');
  const acceptedRetry = await app.inject({ method: 'POST', url: '/api/marketplace/orders/EXT-API-001/accept', headers: { ...headers, 'idempotency-key': 'marketplace-api-accept-001' }, payload: {} });
  assert.equal(acceptedRetry.json().event.eventId, accept.json().event.eventId, 'operator command retry returns the original durable outbound event');
  const settlement = await app.inject({ method: 'POST', url: '/api/marketplace/settlements', headers: { ...headers, 'idempotency-key': 'marketplace-api-settlement-001' }, payload: { externalOrderId: 'EXT-API-001', policyVersion: 'policy-api-2026-01', customerCollectedPaise: 10000, vendorServiceGrossPaise: 9000, commissionBps: 1000 } });
  assert.equal(settlement.statusCode, 201, 'operator can persist a reconciled marketplace settlement');
  const statement = await app.inject({ method: 'GET', url: '/api/marketplace/settlements/EXT-API-001/statement/print', headers });
  assert.equal(statement.statusCode, 200, 'operator can print the canonical marketplace settlement statement');
  assert.match(statement.body, /Marketplace Settlement Statement/, 'settlement statement renderer is exposed through the operator API');
  assert.match(statement.body, /not a customer tax invoice/, 'settlement statement clearly disclaims tax-invoice/provider-success semantics');
  const noAuth = await app.inject({ method: 'GET', url: '/api/marketplace/orders' });
  assert.equal(noAuth.statusCode, 401, 'online order queue is never exposed without an authenticated local session');
  await app.close();
  console.log('PASS  marketplace operator API contract self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
