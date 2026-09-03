import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-customer-links-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let closeStore: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { bootstrapOwner, signIn } = await import('./modules/auth/auth.js');
  const { registerApi } = await import('./api.js');
  const { seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  closeStore = () => store.close();
  bootstrapOwner({ username: 'customer-link-owner', password: 'CustomerLinkPassword!26', tenant: 'CUSTOMER-LINKS', storeId: 'STORE-LINKS' });
  const session = signIn('customer-link-owner', 'CustomerLinkPassword!26');
  const headers = { cookie: `epic_session=${session.token}` };
  const app = Fastify(); registerApi(app);
  store.withStoreScope('CUSTOMER-LINKS', 'STORE-LINKS', () => seedLaundryDefaults('CUSTOMER-LINKS'));

  const created = await app.inject({ method: 'POST', url: '/api/laundry/customers', headers: { ...headers, 'idempotency-key': 'customer-link-create-001' }, payload: { name: 'Asha Link', phone: '+91 90000-40101', email: 'asha-link@example.test' } });
  assert.equal(created.statusCode, 201, `customer creation succeeds: ${created.body}`);
  const customerId = created.json().id;
  const payload = { customerId, channel: 'CUSTOMER_APP', externalCustomerId: 'app-customer-8842' };
  const linked = await app.inject({ method: 'POST', url: '/api/marketplace/customer-links', headers: { ...headers, 'idempotency-key': 'customer-link-001' }, payload });
  assert.equal(linked.statusCode, 201, `explicit account linking succeeds: ${linked.body}`);
  assert.equal(linked.json().status, 'Active');
  const retry = await app.inject({ method: 'POST', url: '/api/marketplace/customer-links', headers: { ...headers, 'idempotency-key': 'customer-link-001' }, payload });
  assert.equal(retry.statusCode, 201); assert.equal(retry.json().id, linked.json().id, 'link command retry is idempotent');
  const list = await app.inject({ method: 'GET', url: `/api/marketplace/customer-links?customerId=${customerId}`, headers });
  assert.equal(list.statusCode, 200); assert.equal(list.json().length, 1, 'links are returned only for the requested customer');

  const second = await app.inject({ method: 'POST', url: '/api/laundry/customers', headers: { ...headers, 'idempotency-key': 'customer-link-create-002' }, payload: { name: 'Ravi Link', phone: '+91 90000-40102' } });
  assert.equal(second.statusCode, 201);
  const collision = await app.inject({ method: 'POST', url: '/api/marketplace/customer-links', headers: { ...headers, 'idempotency-key': 'customer-link-collision' }, payload: { ...payload, customerId: second.json().id } });
  assert.equal(collision.statusCode, 409, 'one external account cannot be linked to two local customers');
  assert.equal(collision.json().code, 'MARKETPLACE_CUSTOMER_ALREADY_LINKED');

  store.withStoreScope('CUSTOMER-LINKS', 'STORE-LINKS', () => {
    store.saveOrderExternalLink({ id: 'oel-customer-link', tenant: 'CUSTOMER-LINKS', storeId: 'STORE-LINKS', channel: 'CUSTOMER_APP', externalOrderId: 'app-order-8842', externalCustomerId: 'app-customer-8842', sourceRevision: 1, createdAt: new Date().toISOString() });
    store.saveMarketplaceOrderProjection({ id: 'mko-customer-link', tenant: 'CUSTOMER-LINKS', storeId: 'STORE-LINKS', vendorId: 'vendor-links', channel: 'CUSTOMER_APP', externalOrderId: 'app-order-8842', sourceVersion: 1, state: 'Processing', orderNumber: 'APP-8842', customer: { name: 'Asha Link' }, pickup: {}, request: {}, paymentState: 'Captured', preferences: '', notes: '', syncState: 'Current', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
  const profile = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}`, headers });
  assert.equal(profile.statusCode, 200); assert.equal(profile.json().marketplace.links[0].externalCustomerId, 'app-customer-8842', 'Customer 360 exposes explicit external identity links');
  assert.deepEqual(profile.json().marketplace.orders.map((order: any) => order.externalOrderId), ['app-order-8842'], 'Customer 360 projects only orders resolved through an active explicit link');

  const revoked = await app.inject({ method: 'POST', url: `/api/marketplace/customer-links/${linked.json().id}/revoke`, headers: { ...headers, 'idempotency-key': 'customer-link-revoke-001' }, payload: {} });
  assert.equal(revoked.statusCode, 200); assert.equal(revoked.json().status, 'Revoked');
  const profileAfterRevoke = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}`, headers });
  assert.equal(profileAfterRevoke.json().marketplace.links[0].status, 'Revoked'); assert.equal(profileAfterRevoke.json().marketplace.orders.length, 0, 'revoked identity links stop projecting marketplace orders');
  assert.equal(store.withStoreScope('CUSTOMER-LINKS', 'STORE-OTHER', () => store.listMarketplaceCustomerLinks('CUSTOMER-LINKS').length), 0, 'links remain store isolated');
  const noAuth = await app.inject({ method: 'GET', url: '/api/marketplace/customer-links' });
  assert.equal(noAuth.statusCode, 401, 'customer identity links are never public from the desktop edge');
  await app.close();
  console.log('PASS marketplace customer identity links, Customer 360 projection, collision protection, revocation, idempotency, and scope self-test complete');
} finally {
  closeStore?.();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch (error) { console.error('customer link test cleanup failed:', (error as Error).message); }
}
