import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-laundry-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');

try {
  const { store } = await import('./kernel/store.js');
  const {
    bookLaundryOrder, createLaundryExpense, importLaundryCustomers, importLaundryPrices, laundryCatalogue, laundryReports, quoteLaundryOrder, seedLaundryDefaults, transitionLaundryOrder,
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

  const expense = createLaundryExpense(tenant, 'test@epic.local', {
    expenseName: 'Steam press repair', expenseDate: '2026-08-29', amount: 1250, paymentReceiver: 'Repair vendor', paymentMode: 'UPI', isTaxPaid: true,
  });
  assert.equal(expense.amount, 1250, 'store expenses persist with their payment metadata');
  assert.equal(store.rowsOf(tenant, 'journal_entry').length, 1, 'an expense posts a balanced journal entry');
  assert.equal(laundryReports(tenant).summary.expenses, 1250, 'reports include the posted store expense');

  const customerImport = importLaundryCustomers(tenant, 'test@epic.local', [
    { name: 'Imported Customer', phone: '9810146062', email: 'imported@example.test', address: 'Import street' },
  ]);
  assert.equal(customerImport.created, 1, 'customer imports create a reusable customer record');
  const priceImport = importLaundryPrices(tenant, 'test@epic.local', [
    { garmentName: 'Imported blazer', categoryName: 'Men\'s Wear', serviceName: 'Dry Cleaning', rate: 450, unit: 'Piece', customerPhone: '9810146062' },
  ]);
  assert.equal(priceImport.created, 1, 'price imports create a scoped garment and service rate');
  assert.equal(laundryCatalogue(tenant).prices.some((price) => price.garmentName === 'Imported blazer' && Number((price as { rate?: number }).rate) === 450), true, 'imported prices are available to the counter catalogue');

  console.log('PASS  laundry vertical slice self-test complete');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
