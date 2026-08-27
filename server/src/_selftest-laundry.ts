import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-laundry-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');

try {
  const { store } = await import('./kernel/store.js');
  const {
    bookLaundryOrder, laundryCatalogue, quoteLaundryOrder, seedLaundryDefaults, transitionLaundryOrder,
  } = await import('./modules/laundry/domain.js');

  const tenant = 'TEST';
  seedLaundryDefaults(tenant);
  const catalogue = laundryCatalogue(tenant);
  assert.equal(catalogue.garments.length, 8, 'default laundry catalogue persists garments');
  assert.equal(catalogue.services.length, 4, 'default laundry catalogue persists services');

  const shirt = catalogue.garments.find((garment: any) => garment.name === 'Shirt / T-shirt')!;
  const steamIron = catalogue.services.find((service: any) => service.name === 'Steam Iron')!;
  const quote = quoteLaundryOrder(tenant, {
    items: [{ garment: shirt.id, service: steamIron.id, qty: 2 }], charges: 10, discounts: 5, taxRate: 5,
  });
  assert.equal(quote.subtotal, 32, 'price matrix selects the garment/service rate');
  assert.equal(quote.grandTotal, 38.85, 'charges, discounts and tax calculate precisely');

  const result = bookLaundryOrder(tenant, 'test@epic.local', {
    customer: { name: 'Asha Verma', phone: '98765 43210' },
    items: [{ garment: shirt.id, service: steamIron.id, qty: 2 }],
    expectedDeliveryDate: '2026-08-30', fulfillmentMode: 'Home Delivery',
    paymentMode: 'UPI', charges: 10, discounts: 5, taxRate: 5,
  });
  assert.equal(result.order.state, 'Booked', 'booking creates a persisted laundry order');
  assert.equal(result.order.paymentStatus, 'Paid', 'UPI booking creates and submits a payment entry');
  assert.equal(result.receipt.grandTotal, 38.85, 'receipt uses authoritative quoted totals');
  assert.equal(result.tags.length, 2, 'one tag is generated per piece');
  assert.equal(store.rowsOf(tenant, 'sales_invoice').length, 1, 'booking posts a real sales invoice');
  assert.equal(store.rowsOf(tenant, 'payment_entry').length, 1, 'booking persists payment evidence');

  transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'In Process');
  transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Ready');
  transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Out for Delivery');
  const delivered = transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Delivered');
  assert.equal(delivered.state, 'Delivered', 'valid lifecycle transitions are enforced and persisted');
  assert.throws(() => transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Booked'), /cannot move/, 'terminal orders cannot return to booking');

  console.log('PASS  laundry vertical slice self-test complete');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
