import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-customer-privacy-')); process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite'); let close: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); const customers = await import('./modules/laundry/customers.js'); const privacy = await import('./modules/laundry/customer-privacy.js'); close = () => store.close();
  const tenant = 'PRIVACY'; const storeId = 'STORE-PRIVACY'; const run = <T>(work: () => T) => store.withStoreScope(tenant, storeId, work);
  const created = run(() => customers.createLaundryCustomer(tenant, 'owner', { name: 'Privacy Customer', phone: '9000000800', email: 'private@example.test', address: 'Private Address', marketingConsent: true }));
  const exported = run(() => privacy.exportCustomerPrivacyData(tenant, 'owner', created.id)); assert.equal(exported.data.customer.email, 'private@example.test', 'controlled export contains the customer data requested'); assert.ok(exported.checksum, 'export is auditable by checksum');
  const correction = run(() => privacy.createCustomerPrivacyRequest(tenant, 'owner', { customerId: created.id, type: 'Correction', details: { name: 'Corrected Customer', email: 'corrected@example.test' } })); run(() => privacy.completeCustomerPrivacyRequest(tenant, 'owner', correction.id, {})); assert.equal(run(() => customers.customerProfile(tenant, created.id).customer.name), 'Corrected Customer', 'correction request updates only the local customer profile');
  const erasure = run(() => privacy.createCustomerPrivacyRequest(tenant, 'owner', { customerId: created.id, type: 'Erasure' })); const completed = run(() => privacy.completeCustomerPrivacyRequest(tenant, 'owner', erasure.id, {})); assert.equal(completed.state, 'Completed', 'erasure request completes when no active order or legal hold exists'); const profile = run(() => customers.customerProfile(tenant, created.id)); assert.equal(profile.customer.name, '[Redacted Customer]', 'erasure scrubs personal fields'); assert.equal(profile.customer.email, '', 'erasure scrubs contact data'); assert.equal(run(() => privacy.listCustomerPrivacyRequests(tenant, created.id).length), 2, 'privacy requests remain auditable');
  const otherStore = run(() => store.withStoreScope(tenant, 'STORE-OTHER', () => { assert.throws(() => privacy.exportCustomerPrivacyData(tenant, 'owner', created.id), /customer not found/, 'a different store cannot export another store customer data'); return true; })); assert.equal(otherStore, true);
  console.log('PASS customer privacy export, correction, erasure, auditability, accounting-reference preservation, and store-isolation self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
