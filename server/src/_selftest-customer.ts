import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-customer-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');
let closeStore: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { bootstrapOwner, signIn } = await import('./modules/auth/auth.js');
  const { laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { registerApi } = await import('./api.js');
  closeStore = () => store.close();
  bootstrapOwner({ username: 'customer-owner', password: 'CustomerOwnerPassword!26', tenant: 'CUSTOMER', storeId: 'STORE-C' });
  const session = signIn('customer-owner', 'CustomerOwnerPassword!26');
  const headers = { cookie: `epic_session=${session.token}`, 'idempotency-key': 'customer-create-001' };
  const app = Fastify(); registerApi(app);
  store.withStoreScope('CUSTOMER', 'STORE-C', () => seedLaundryDefaults('CUSTOMER'));

  const created = await app.inject({ method: 'POST', url: '/api/laundry/customers', headers, payload: { name: 'Meera Das', phone: '+91 90000-40001', email: 'meera@example.test', address: '12 Ledger Lane', openingBalance: 125 } });
  assert.equal(created.statusCode, 201, `customer create succeeds: ${created.body}`);
  assert.equal(created.json().phone, '919000040001', 'customer phone is normalized');
  const duplicate = await app.inject({ method: 'POST', url: '/api/laundry/customers', headers: { ...headers, 'idempotency-key': 'customer-create-002' }, payload: { name: 'Duplicate Meera', phone: '919000040001' } });
  assert.equal(duplicate.statusCode, 400, 'normalized duplicate phones are rejected per branch');
  const customerId = created.json().id;
  let profile = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}`, headers });
  assert.equal(profile.json().metrics.orderBalance, 125, 'opening balance derives from customer ledger');
  const edited = await app.inject({ method: 'PATCH', url: `/api/laundry/customers/${customerId}`, headers, payload: { name: 'Meera D.', address: '99 Reconciled Road' } });
  assert.equal(edited.statusCode, 200, 'customer profile is editable');
  const walletCredit = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/wallet`, headers: { ...headers, 'idempotency-key': 'wallet-credit-001' }, payload: { type: 'Credit', amount: 80, reason: 'Counter wallet deposit' } });
  assert.equal(walletCredit.statusCode, 201, 'wallet credit is posted');
  const walletCreditRetry = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/wallet`, headers: { ...headers, 'idempotency-key': 'wallet-credit-001' }, payload: { type: 'Credit', amount: 80, reason: 'Counter wallet deposit' } });
  assert.equal(walletCreditRetry.statusCode, 201, 'idempotent wallet retry returns its recorded result');
  const walletOverdraw = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/wallet`, headers: { ...headers, 'idempotency-key': 'wallet-debit-overdraw-001' }, payload: { type: 'Debit', amount: 81, reason: 'Must fail' } });
  assert.equal(walletOverdraw.statusCode, 400, 'wallet debit cannot exceed available wallet balance');
  const walletDebit = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/wallet`, headers: { ...headers, 'idempotency-key': 'wallet-debit-001' }, payload: { type: 'Debit', amount: 30, reason: 'Applied to service' } });
  assert.equal(walletDebit.statusCode, 201, 'wallet debit is posted append-only');
  const rewardCredit = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/rewards`, headers: { ...headers, 'idempotency-key': 'reward-credit-001' }, payload: { points: 25, reason: 'EPIC manual goodwill adjustment' } });
  assert.equal(rewardCredit.statusCode, 201, 'manual Epic reward adjustment is auditable');
  const rewardOverdraw = await app.inject({ method: 'POST', url: `/api/laundry/customers/${customerId}/rewards`, headers: { ...headers, 'idempotency-key': 'reward-debit-overdraw-001' }, payload: { points: -26, reason: 'Must fail' } });
  assert.equal(rewardOverdraw.statusCode, 400, 'reward redemption cannot exceed balance');
  profile = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}`, headers });
  assert.equal(profile.json().metrics.walletBalance, 50, 'wallet balance reconciles from append-only entries');
  assert.equal(profile.json().wallet.length, 2, 'idempotent retry does not post a second wallet movement');
  assert.equal(profile.json().metrics.rewardPoints, 25, 'reward points reconcile from append-only entries');
  assert.equal(profile.json().customer.address, '99 Reconciled Road', 'edited address round-trips');
  const catalogue = store.withStoreScope('CUSTOMER', 'STORE-C', () => laundryCatalogue('CUSTOMER'));
  const garment = catalogue.garments.find((entry: any) => entry.name === 'Shirt / T-shirt')!;
  const service = catalogue.services.find((entry: any) => entry.name === 'Steam Iron')!;
  const booked = await app.inject({ method: 'POST', url: '/api/laundry/orders', headers: { ...headers, 'idempotency-key': 'customer-booking-001' }, payload: { customer: { id: customerId }, items: [{ garment: garment.id, service: service.id, qty: 2 }], expectedDeliveryDate: '2026-10-01', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later' } });
  assert.equal(booked.statusCode, 201, `booking posts customer invoice debit: ${booked.body}`);
  const invoiceSearch = await app.inject({ method: 'GET', url: `/api/laundry/customers?search=${encodeURIComponent(booked.json().receipt.invoiceNumber)}`, headers });
  assert.equal(invoiceSearch.json().some((entry: any) => entry.id === customerId && entry.matchedBy === 'invoice'), true, 'customer search resolves invoice number');
  profile = await app.inject({ method: 'GET', url: `/api/laundry/customers/${customerId}`, headers });
  assert.equal(profile.json().ledger.some((entry: any) => entry.entryType === 'Invoice Debit' && entry.referenceId === booked.json().order.id), true, 'booking ledger entry is retained in customer profile');
  assert.equal(store.withStoreScope('CUSTOMER', 'STORE-C', () => store.auditOf('CUSTOMER').some((entry) => entry.action === 'customer:wallet-posted')), true, 'wallet operations are auditable');
  await app.close();
  console.log('PASS  customer ledger, wallet, rewards and invoice-search self-test complete');
} finally {
  closeStore?.();
  try { rmSync(tempDir, { recursive: true, force: true }); } catch (error) { console.error('customer test cleanup failed:', (error as Error).message); }
}
