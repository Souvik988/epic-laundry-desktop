import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-laundry-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');
let closeStore: (() => void) | undefined;

try {
  const { store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const { createLaundryRegressionFixture } = await import('./testing/laundry-regression-fixture.js');
  const { laundryBusinessDate } = await import('./modules/laundry/dates.js');
  const {
    assignLaundryOrder, bookLaundryOrder, cancelLaundryExpense, cancelLaundryOrder, createLaundryExpense, createLaundryRider, editLaundryExpense, editLaundryOrder, importLaundryCustomers, importLaundryPrices, laundryCatalogue, laundryDashboard, laundryDispatch, laundryReportDetail, laundryReports, laundryStatistics, listLaundryRiderSettlements, quoteLaundryOrder, recordLaundryFulfillment, saveLaundryRiderSettlement, scanLaundryGarment, seedLaundryDefaults, transitionLaundryOrder,
  } = await import('./modules/laundry/domain.js');

  const tenant = 'TEST';
  assert.equal(laundryBusinessDate(new Date('2026-08-27T19:00:00.000Z'), 'Asia/Kolkata'), '2026-08-28', 'laundry business dates follow the configured local timezone');
  seedLaundryDefaults(tenant);
  const catalogue = laundryCatalogue(tenant);
  assert.equal(catalogue.garments.length, 32, 'default laundry catalogue persists the expanded garment master');
  assert.equal(catalogue.services.length, 4, 'default laundry catalogue persists services');

  const shirt = catalogue.garments.find((garment: any) => garment.name === 'Shirt / T-shirt')!;
  assert.equal(shirt.photo, '/ui/app/garments/lndry-folded-shirt-v3.png', 'the default shirt uses the current Lndry-branded garment image');
  const steamIron = catalogue.services.find((service: any) => service.name === 'Steam Iron')!;
  const quote = quoteLaundryOrder(tenant, {
    items: [{ garment: shirt.id, service: steamIron.id, qty: 2 }], charges: 10, discounts: 5, taxRate: 5,
  });
  assert.equal(quote.subtotal, 32, 'price matrix selects the garment/service rate');
  assert.equal(quote.grandTotal, 38.85, 'charges, discounts and tax calculate precisely');

  const result = bookLaundryOrder(tenant, 'test@epic.local', {
    customer: { name: 'Asha Verma', phone: '98765 43210', address: '12 Lndry Lane' },
    items: [{ garment: shirt.id, service: steamIron.id, qty: 2 }],
    expectedDeliveryDate: '2026-08-30', fulfillmentMode: 'Home Delivery',
    paymentMode: 'UPI', charges: 10, discounts: 5, taxRate: 5, photoPaths: 'data:image/png;base64,aA==',
  });
  assert.equal(result.order.state, 'Booked', 'booking creates a persisted laundry order');
  assert.equal(result.order.paymentStatus, 'Paid', 'UPI booking creates and submits a payment entry');
  assert.equal(result.receipt.grandTotal, 38.85, 'receipt uses authoritative quoted totals');
  assert.equal(result.order.deliveryAddress, '12 Lndry Lane', 'booking snapshots the delivery address on the work card');
  assert.equal(result.order.photoPaths, 'data:image/png;base64,aA==', 'booking persists the bounded garment photo attachment');
  const fulfillment = recordLaundryFulfillment(tenant, 'test@epic.local', result.order.id, { itemIndex: 0, stage: 'Picked Up', quantity: 1, note: 'Counter intake' });
  assert.equal(fulfillment.quantity, 1, 'item-level fulfilment records fractional-safe quantity events');
  assert.throws(() => recordLaundryFulfillment(tenant, 'test@epic.local', result.order.id, { itemIndex: 0, stage: 'Picked Up', quantity: 2 }), /exceeds ordered quantity/, 'item-level fulfilment prevents over-delivery');
  assert.equal(result.tags.length, 2, 'one tag is generated per piece');
  assert.deepEqual(result.tags.map((tag) => [tag.sequence, tag.total]), [[1, 2], [2, 2]], 'tags carry an explicit unit sequence');
  assert.equal(result.tags[0].customer, 'Asha Verma', 'tags carry the customer name');
  assert.equal(result.tags[0].orderDate, result.order.orderDate, 'tags carry the order date');
  assert.equal(store.rowsOf(tenant, 'sales_invoice').length, 1, 'booking posts a real sales invoice');
  assert.equal(store.rowsOf(tenant, 'payment_entry').length, 1, 'booking persists payment evidence');

  transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'In Process');
  assert.throws(() => transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Ready'), /assembly incomplete/, 'final Ready transition blocks incomplete tracked-piece assembly');
  for (const unit of result.garmentUnits) {
    for (const nextState of ['Sorted', 'Processing', 'QC', 'Assembly', 'Racked'] as const) {
      scanLaundryGarment(tenant, 'test@epic.local', { tagCode: unit.tagCode, nextState, location: nextState === 'Racked' ? `RACK-TEST-${unit.sequence}` : `${nextState} station`, note: 'Assembly safety fixture' });
    }
  }
  transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Ready');
  assert.throws(() => transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Out for Delivery'), /assign a delivery rider/, 'delivery cannot be dispatched without a rider');
  const rider = createLaundryRider(tenant, 'test@epic.local', { name: 'Mohan Rider', phone: '9000000002' });
  const assigned = assignLaundryOrder(tenant, 'test@epic.local', result.order.id, { stage: 'delivery', riderId: rider.id, slot: '4:00 PM - 6:00 PM' });
  assert.equal(assigned.deliveryRider?.name, 'Mohan Rider', 'delivery assignment persists on the order');
  const settlement = saveLaundryRiderSettlement(tenant, 'test@epic.local', { rider: rider.id, amount: 20, method: 'Cash', orderIds: [result.order.id] });
  assert.equal(settlement.status, 'Pending', 'rider collection settlement records an outstanding handover');
  saveLaundryRiderSettlement(tenant, 'test@epic.local', { status: 'Handed Over', reference: 'HAND-001' }, settlement.id);
  const reconciled = saveLaundryRiderSettlement(tenant, 'test@epic.local', { status: 'Reconciled' }, settlement.id);
  assert.equal(reconciled.status, 'Reconciled', 'rider settlement history supports reconciliation');
  assert.throws(() => saveLaundryRiderSettlement(tenant, 'test@epic.local', { amount: 25 }, settlement.id), /immutable/, 'reconciled rider settlements cannot be edited in place');
  assert.equal(listLaundryRiderSettlements(tenant, { rider: rider.id }).length, 1, 'rider settlement history is queryable by rider');
  assert.equal(laundryDispatch(tenant).deliveries.length, 1, 'ready orders appear in the delivery dispatch queue');
  transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Out for Delivery');
  const delivered = transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Delivered');
  assert.equal(delivered.state, 'Delivered', 'valid lifecycle transitions are enforced and persisted');
  assert.throws(() => transitionLaundryOrder(tenant, 'test@epic.local', result.order.id, 'Booked'), /cannot move/, 'terminal orders cannot return to booking');

  const editable = bookLaundryOrder(tenant, 'test@epic.local', {
    customer: { name: 'Editable Customer', phone: '98765 43212' },
    items: [{ garment: shirt.id, service: steamIron.id, qty: 1 }], expectedDeliveryDate: '2026-08-31', fulfillmentMode: 'Pickup Order', paymentMode: 'Pay Later',
  });
  const originalEditableInvoice = String(store.getRow(tenant, editable.order.id)?.data.invoice || '');
  const edited = editLaundryOrder(tenant, 'test@epic.local', editable.order.id, {
    items: [{ garment: shirt.id, service: steamIron.id, qty: 2 }], expectedDeliveryDate: '2026-09-01', fulfillmentMode: 'Pickup Order', charges: 0, discounts: 0, taxRate: 5,
  });
  assert.equal(edited.itemCount, 2, 'controlled order edit recalculates item quantity');
  assert.equal(edited.grandTotal, 33.6, 'controlled order edit recalculates the authoritative total');
  assert.equal(store.getRow(tenant, originalEditableInvoice)?.status, 'Cancelled', 'controlled edit preserves the original invoice as cancelled history');
  assert.equal(store.getRow(tenant, edited.invoiceNumber || '')?.status, 'Submitted', 'controlled edit creates a submitted replacement invoice');

  const cancellable = bookLaundryOrder(tenant, 'test@epic.local', {
    customer: { name: 'Cancellation Customer', phone: '98765 43211' },
    items: [{ garment: shirt.id, service: steamIron.id, qty: 1 }], expectedDeliveryDate: '2026-08-31', fulfillmentMode: 'Pickup Order', paymentMode: 'Cash', taxRate: 5,
  });
  const dashboardBeforeCancellation = laundryDashboard(tenant);
  const growthBeforeCancellation = laundryReportDetail(tenant, 'growth').rows[0] as { tax: number };
  const cancelledOrder = cancelLaundryOrder(tenant, 'test@epic.local', cancellable.order.id, 'Customer requested cancellation');
  const cancellableInvoiceId = String(store.getRow(tenant, cancellable.order.id)?.data.invoice || '');
  assert.equal(cancelledOrder.state, 'Cancelled', 'order cancellation requires a reason and persists terminal state');
  assert.equal(store.getRow(tenant, cancellable.order.id)?.status, 'Cancelled', 'cancelled order remains in history');
  assert.equal(store.getRow(tenant, cancellable.receipt.invoiceNumber)?.status, 'Cancelled', 'cancellation reverses the linked invoice');
  assert.equal(store.rowsOf(tenant, 'payment_entry').some((row) => row.status === 'Cancelled' && row.data.against_sales === cancellableInvoiceId), true, 'cancellation reverses submitted payment evidence against the invoice');
  assert.equal(store.rowsOf(tenant, 'laundry_customer_ledger').some((row) => row.data.entry_type === 'Adjustment' && String(row.data.reason).includes('Invoice reversal')), true, 'cancellation posts a customer invoice reversal adjustment');

  const expense = createLaundryExpense(tenant, 'test@epic.local', {
    expenseName: 'Steam press repair', expenseDate: '2026-08-29', amount: 1250, paymentReceiver: 'Repair vendor', paymentMode: 'UPI', isTaxPaid: true,
  });
  assert.equal(expense.amount, 1250, 'store expenses persist with their payment metadata');
  assert.equal(store.rowsOf(tenant, 'journal_entry').length, 1, 'an expense posts a balanced journal entry');
  const editedExpense = editLaundryExpense(tenant, 'test@epic.local', expense.id, {
    expenseName: 'Steam press repair', expenseDate: '2026-08-29', amount: 1350, paymentReceiver: 'Repair vendor', paymentMode: 'UPI', isTaxPaid: true,
  }, 'Corrected vendor invoice');
  assert.equal(editedExpense.amount, 1350, 'controlled expense edit replaces the authoritative amount');
  assert.equal(store.rowsOf(tenant, 'journal_entry').filter((row) => row.status === 'Submitted').length, 1, 'controlled expense edit leaves one submitted journal');
  assert.equal(store.rowsOf(tenant, 'journal_entry').filter((row) => row.status === 'Cancelled').length, 1, 'controlled expense edit preserves the original journal as cancelled history');
  const report = laundryReports(tenant);
  assert.equal(report.summary.expenses, 1350, 'reports include the edited posted store expense');
  assert.equal(report.trend.length, 7, 'reports expose a seven-day trend by default');
  assert.equal(report.fulfillmentBreakdown.some((row) => row.mode === 'Home Delivery' && row.count >= 1), true, 'reports group fulfilment modes');
  assert.equal(report.topGarments[0]?.name, 'Shirt / T-shirt', 'reports rank processed garments');
  const reportKinds = ['invoice', 'collection', 'order', 'consolidated-invoices', 'customer', 'customer-package', 'customer-list', 'growth', 'discount', 'expense', 'balance', 'pickup', 'rider-delivery', 'rider-collection', 'warehouse-user-work'] as const;
  for (const kind of reportKinds) assert.equal(laundryReportDetail(tenant, kind).kind, kind, `${kind} report has a distinct server-backed query`);
  const todayStats = laundryStatistics(tenant, 'today');
  const weekStats = laundryStatistics(tenant, 'week');
  const lifetimeStats = laundryStatistics(tenant, 'lifetime');
  assert.equal(todayStats.from, todayStats.to, 'today statistics use a single-day range');
  assert.equal(todayStats.ordersReview.breakdown.reduce((sum: number, row: { count: number }) => sum + row.count, 0), todayStats.ordersReview.total, 'statistics lifecycle buckets reconcile to the active-order total');
  assert.equal(weekStats.collection.daily.length, 7, 'week statistics expose seven collection points');
  assert.equal(weekStats.newCustomer.daily.length, 7, 'week statistics expose seven acquisition points');
  assert.equal(lifetimeStats.period, 'lifetime', 'lifetime statistics preserve the requested range');
  assert.equal(lifetimeStats.revenue.total >= weekStats.revenue.total, true, 'lifetime revenue includes the active historical range');
  const cancelledExpense = cancelLaundryExpense(tenant, 'test@epic.local', expense.id, 'Duplicate entry corrected');
  assert.equal(cancelledExpense.status, 'Cancelled', 'expense cancellation preserves the record with a controlled status');
  const postCancellationReport = laundryReports(tenant);
  assert.equal(postCancellationReport.summary.expenses, 0, 'cancelled expenses are excluded from operating totals');
  assert.equal(postCancellationReport.paymentBreakdown.find((row) => row.paymentMode === 'Cash')?.count, 0, 'cancelled orders are excluded from payment mix totals');
  const dashboardAfterCancellation = laundryDashboard(tenant);
  assert.equal(Math.round((dashboardBeforeCancellation.kpis.todayRevenue - dashboardAfterCancellation.kpis.todayRevenue) * 100) / 100, cancellable.order.grandTotal, 'dashboard today revenue excludes cancelled orders');
  assert.equal(laundryReportDetail(tenant, 'balance').rows.some((row: any) => row.orderNumber === cancellable.order.orderNumber), false, 'balance report excludes cancelled orders from receivables');
  const growthAfterCancellation = laundryReportDetail(tenant, 'growth').rows[0] as { tax: number };
  assert.equal(Math.round((growthBeforeCancellation.tax - growthAfterCancellation.tax) * 100) / 100, cancellable.order.taxAmount, 'growth tax excludes cancelled orders');

  const customerImport = importLaundryCustomers(tenant, 'test@epic.local', [
    { name: 'Imported Customer', phone: '9810146062', email: 'imported@example.test', address: 'Import street' },
  ]);
  assert.equal(customerImport.created, 1, 'customer imports create a reusable customer record');
  const priceImport = importLaundryPrices(tenant, 'test@epic.local', [
    { garmentName: 'Imported blazer', categoryName: 'Men\'s Wear', serviceName: 'Dry Cleaning', rate: 450, unit: 'Piece', customerPhone: '9810146062' },
  ]);
  assert.equal(priceImport.created, 1, 'price imports create a scoped garment and service rate');
  assert.equal(laundryCatalogue(tenant).prices.some((price) => price.garmentName === 'Imported blazer' && Number((price as { rate?: number }).rate) === 450), true, 'imported prices are available to the counter catalogue');

  const regressionFixture = createLaundryRegressionFixture('FIXTURE');
  assert.equal(regressionFixture.paid.order.paymentStatus, 'Paid', 'repeatable fixture includes a paid order');
  assert.equal(regressionFixture.unpaid.order.paymentStatus, 'Unpaid', 'repeatable fixture includes an unpaid order');
  assert.ok(regressionFixture.rider.id, 'repeatable fixture includes a rider');
  assert.equal(regressionFixture.expense.amount, 250, 'repeatable fixture includes an expense');

  const atomicTenant = 'ATOMIC';
  seedLaundryDefaults(atomicTenant);
  const atomicCatalogue = laundryCatalogue(atomicTenant);
  const atomicGarment = atomicCatalogue.garments.find((garment: any) => garment.name === 'Shirt / T-shirt')!;
  const atomicService = atomicCatalogue.services.find((service: any) => service.name === 'Steam Iron')!;
  process.env.EPIC_TEST_BOOKING_FAIL_AT = 'after-invoice';
  assert.throws(() => bookLaundryOrder(atomicTenant, 'test@epic.local', {
    customer: { name: 'Atomic rollback', phone: '9000000111' },
    items: [{ garment: atomicGarment.id, service: atomicService.id, qty: 1 }],
    expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash',
  }), /forced booking failure/, 'forced mid-booking failure is surfaced');
  delete process.env.EPIC_TEST_BOOKING_FAIL_AT;
  assert.equal(store.rowsOf(atomicTenant, 'sales_invoice').length, 0, 'atomic booking rollback leaves no invoice');
  assert.equal(store.rowsOf(atomicTenant, 'payment_entry').length, 0, 'atomic booking rollback leaves no payment');
  assert.equal(store.rowsOf(atomicTenant, 'laundry_order').length, 0, 'atomic booking rollback leaves no order');

  console.log('PASS  laundry vertical slice self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
