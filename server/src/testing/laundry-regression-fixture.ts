import {
  bookLaundryOrder,
  createLaundryExpense,
  createLaundryRider,
  laundryCatalogue,
  seedLaundryDefaults,
} from '../modules/laundry/domain.js';

/**
 * A deterministic, non-production fixture for laundry regression checks.
 * It intentionally exercises paid and unpaid orders, a rider and an expense
 * without depending on any customer data from a live store.
 */
export function createLaundryRegressionFixture(tenant: string, actor = 'fixture@epic.local') {
  seedLaundryDefaults(tenant);
  const catalogue = laundryCatalogue(tenant);
  const garment = catalogue.garments.find((item) => item.name === 'Shirt / T-shirt');
  const service = catalogue.services.find((item) => item.name === 'Steam Iron');
  if (!garment || !service) throw new Error('laundry fixture catalogue is incomplete');

  const paid = bookLaundryOrder(tenant, actor, {
    customer: { name: 'Fixture Paid Customer', phone: '9000000101', address: 'Fixture Lane' },
    items: [{ garment: garment.id, service: service.id, qty: 2 }],
    expectedDeliveryDate: '2026-09-01',
    fulfillmentMode: 'Home Delivery',
    paymentMode: 'Cash',
  });
  const unpaid = bookLaundryOrder(tenant, actor, {
    customer: { name: 'Fixture Unpaid Customer', phone: '9000000102', address: 'Fixture Avenue' },
    items: [{ garment: garment.id, service: service.id, qty: 1 }],
    expectedDeliveryDate: '2026-09-02',
    fulfillmentMode: 'Pickup Order',
    paymentMode: 'Pay Later',
  });
  const rider = createLaundryRider(tenant, actor, { name: 'Fixture Rider', phone: '9000000199' });
  const expense = createLaundryExpense(tenant, actor, {
    expenseName: 'Fixture detergent',
    expenseDate: '2026-08-30',
    amount: 250,
    paymentReceiver: 'Fixture supplier',
    paymentMode: 'Cash',
    isTaxPaid: false,
  });

  return { catalogue, paid, unpaid, rider, expense };
}
