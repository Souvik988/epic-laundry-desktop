import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-payment-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');
let closeStore: (() => void) | undefined;

try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  const { bootstrapOwner, signIn } = await import('./modules/auth/auth.js');
  const { laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  closeStore = () => store.close();

  const owner = bootstrapOwner({ username: 'payment-owner', password: 'PaymentOwnerPassword!26', tenant: 'PAYMENTS', storeId: 'PAYMENTS-MAIN' });
  store.withStoreScope(owner.tenant, owner.storeId, () => seedLaundryDefaults(owner.tenant));
  const catalogue = store.withStoreScope(owner.tenant, owner.storeId, () => laundryCatalogue(owner.tenant));
  const garment = catalogue.garments.find((item: any) => item.name === 'Shirt / T-shirt')!;
  const service = catalogue.services.find((item: any) => item.name === 'Steam Iron')!;
  const session = signIn('payment-owner', 'PaymentOwnerPassword!26');
  const app = Fastify(); registerApi(app);
  const booking = await app.inject({ method: 'POST', url: '/api/laundry/orders', headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-booking-001' }, payload: { customer: { name: 'Payment Customer', phone: '9000000701' }, items: [{ garment: garment.id, service: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-05', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later' } });
  assert.equal(booking.statusCode, 201, `pay-later booking succeeds: ${booking.body}`);
  const orderId = booking.json().order.id;
  const initial = await app.inject({ method: 'GET', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}` } });
  assert.deepEqual({ status: initial.json().status, paid: initial.json().paid, outstanding: initial.json().outstanding }, { status: 'Unpaid', paid: 0, outstanding: 16 }, 'pay-later order starts with an outstanding obligation');
  const first = await app.inject({ method: 'POST', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-001' }, payload: { amount: 6, mode: 'Cash', reference: 'CASH-001' } });
  const duplicate = await app.inject({ method: 'POST', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-001' }, payload: { amount: 6, mode: 'Cash', reference: 'CASH-001' } });
  assert.equal(first.statusCode, 201, `partial payment succeeds: ${first.body}`);
  assert.equal(duplicate.json().payment.id, first.json().payment.id, 'duplicate payment command returns the original payment');
  assert.equal((await app.inject({ method: 'GET', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}` } })).json().status, 'Part Paid', 'partial collection status is derived from allocations');
  const second = await app.inject({ method: 'POST', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-002' }, payload: { amount: 10, mode: 'UPI', reference: 'UPI-002', providerStatus: 'Manual' } });
  assert.equal(second.statusCode, 201, `remaining payment succeeds: ${second.body}`);
  const paid = await app.inject({ method: 'GET', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}` } });
  assert.deepEqual({ status: paid.json().status, paid: paid.json().paid, outstanding: paid.json().outstanding, count: paid.json().payments.length }, { status: 'Paid', paid: 16, outstanding: 0, count: 2 }, 'multiple payment allocations reconcile to a paid invoice');
  const tooMuch = await app.inject({ method: 'POST', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-too-much' }, payload: { amount: 1, mode: 'Cash' } });
  assert.equal(tooMuch.statusCode, 400, 'over-collection is rejected');
  const fakeProvider = await app.inject({ method: 'POST', url: `/api/laundry/orders/${orderId}/payments`, headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-provider-confirmed' }, payload: { amount: 1, mode: 'Cash', providerStatus: 'Confirmed' } });
  assert.equal(fakeProvider.statusCode, 400, 'unconfigured online provider confirmation is rejected');
  const reversed = await app.inject({ method: 'POST', url: `/api/laundry/payments/${first.json().payment.id}/reverse`, headers: { cookie: `epic_session=${session.token}`, 'idempotency-key': 'payment-reversal-001' }, payload: { reason: 'Cash returned to customer' } });
  assert.equal(reversed.statusCode, 200, `payment reversal succeeds: ${reversed.body}`);
  assert.equal(store.withStoreScope(owner.tenant, owner.storeId, () => store.getRow(owner.tenant, first.json().payment.id)?.status), 'Cancelled', 'reversed payment is cancelled in the source ledger');
  assert.deepEqual({ status: reversed.json().status, paid: reversed.json().paid, outstanding: reversed.json().outstanding }, { status: 'Part Paid', paid: 10, outstanding: 6 }, 'reversal reopens only the reversed allocation and preserves history');
  assert.equal(store.withStoreScope(owner.tenant, owner.storeId, () => store.rowsOf(owner.tenant, 'laundry_customer_ledger').some((entry) => entry.data.entry_type === 'Refund' && entry.data.reference_id === first.json().payment.id)), true, 'payment reversal posts a customer ledger adjustment');
  await app.close();
  console.log('PASS  partial, multiple, idempotent and reversible laundry payments self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
