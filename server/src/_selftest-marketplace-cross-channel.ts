import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-cross-channel-'));
const databaseFile = join(tempDir, 'nested', 'epic.sqlite');
process.env.EPIC_DATA_FILE = join(tempDir, 'nested', 'legacy.json');
process.env.EPIC_DB_FILE = databaseFile;
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;

let closeStore: (() => void) | undefined;
try {
  const { Store, store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const { bookLaundryOrder, laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { createDeviceEnrollment, actOnMarketplaceOrder, marketplaceSyncStatus, queueMarketplaceEvent, receiveMarketplaceOrder, receiveMarketplacePayment, registerMarketplaceDevice, relayMarketplaceOutbox, materializeMarketplaceOrder } = await import('./modules/marketplace/edge-sync.js');
  const { createMarketplaceReassessment, decideMarketplaceReassessment, recordMarketplaceIntake } = await import('./modules/marketplace/order-truth.js');
  const { saveSupplierTaxProfile } = await import('./modules/gst/tax-policy.js');
  const { MarketplaceIntegrationSimulator } = await import('./modules/marketplace/simulator.js');

  const tenant = 'CROSS-CHANNEL';
  const storeId = 'STORE-A';
  const vendorId = 'VENDOR-A';
  const actor = 'cross-channel-owner';
  const simulator = new MarketplaceIntegrationSimulator();
  const catalogue = store.withStoreScope(tenant, storeId, () => { seedLaundryDefaults(tenant); return laundryCatalogue(tenant); });
  store.withStoreScope(tenant, storeId, () => saveSupplierTaxProfile(tenant, actor, { legalName: 'Cross Channel Laundry Pvt Ltd', tradeName: 'Cross Channel Laundry', address: '12 Lake Road, Kolkata', stateCode: '19', pincode: '700001', registrationStatus: 'Unregistered', einvoiceState: 'NotApplicable' }));
  const garment = catalogue.garments.find((candidate: any) => candidate.unit === 'Piece')!;
  const service = catalogue.services[0]!;
  assert.ok(garment && service, 'the cross-channel fixture has a usable piece-priced catalogue entry');

  const enrollment = store.withStoreScope(tenant, storeId, () => createDeviceEnrollment());
  const device = store.withStoreScope(tenant, storeId, () => registerMarketplaceDevice(tenant, actor, {
    deviceId: enrollment.deviceId, vendorId, station: 'Cross-channel station', publicKey: enrollment.publicKey,
    credentialRef: 'sim://cross-channel/device-token', softwareVersion: '4.0.0-test', status: 'Registered',
  }));

  const orderEnvelope = simulator.enqueueOrder(device.id, {
    tenantId: tenant, vendorId, storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'cross-order-1', externalOrderId: 'APP-ORDER-001',
    eventType: 'marketplace.order.assigned.v1', payload: {
      channel: 'CUSTOMER_APP', state: 'AwaitingAcceptance', orderNumber: 'APP-ORDER-001',
      customer: { name: 'Asha Rao', phone: '9000000101', email: 'asha@example.test' },
      pickup: { address: '12 Lake Road, Kolkata', fulfillmentMode: 'Home Delivery' },
      request: { items: [{ garmentId: garment.id, serviceId: service.id, qty: 2 }], expectedDeliveryDate: '2026-09-10' },
      paymentState: 'Pending', externalCustomerId: 'cust-app-001',
    },
  });
  simulator.enqueueDuplicate(device.id, orderEnvelope, 5);
  simulator.setUnavailable(true); // the cloud has accepted the order, while this edge is offline.
  assert.throws(() => simulator.pull(device.id), /transport outage/, 'offline pull fails without deleting the cloud queue');
  simulator.setUnavailable(false);
  const inboundBatch = simulator.pull(device.id);
  for (const event of inboundBatch) store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, event));
  const projected = store.withStoreScope(tenant, storeId, () => store.getMarketplaceOrderProjection(tenant, 'CUSTOMER_APP', 'APP-ORDER-001'))!;
  assert.equal(projected.sourceVersion, 1, 'offline catch-up creates one current external projection');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.listMarketplaceOrderProjections(tenant).length), 1, 'five inbound retries produce one online queue row');

  const accepted = store.withStoreScope(tenant, storeId, () => actOnMarketplaceOrder(tenant, actor, 'APP-ORDER-001', { action: 'accept' }));
  assert.equal(accepted.materialized?.created, true, 'an accepted complete request materializes into the local booking flow');
  assert.equal(accepted.event.aggregateVersion, 2, 'the outbound acceptance advances the external aggregate version');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.external_order_id === 'APP-ORDER-001').length), 1, 'acceptance creates exactly one local laundry order');
  const replayMaterialization = store.withStoreScope(tenant, storeId, () => materializeMarketplaceOrder(tenant, actor, 'APP-ORDER-001'));
  assert.equal(replayMaterialization.created, false, 'replaying materialization returns the existing linked local order');

  const payment = simulator.enqueuePayment(device.id, { tenantId: tenant, vendorId, storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'cross-payment-1', paymentIntent: 'pi-cross-001', provider: 'simulator', status: 'Captured', amountPaise: 2_000, payload: { providerEventId: 'provider-cross-001' } });
  simulator.enqueueDuplicate(device.id, payment, 5);
  for (const event of simulator.pull(device.id)) store.withStoreScope(tenant, storeId, () => receiveMarketplacePayment(tenant, actor, event));
  assert.equal(store.withStoreScope(tenant, storeId, () => store.rowsOf(tenant, 'provider_payment_event').length), 1, 'duplicate provider callbacks produce one retained payment evidence row');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.rowsOf(tenant, 'payment_entry').some((row) => row.data.reference === 'pi-cross-001')), false, 'provider evidence is not spoofed into a local manual collection');

  const estimateOnly = simulator.enqueueOrder(device.id, {
    tenantId: tenant, vendorId, storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'cross-order-2', externalOrderId: 'WEB-ORDER-002',
    eventType: 'marketplace.order.assigned.v1', payload: { channel: 'WEBSITE', state: 'AwaitingAcceptance', orderNumber: 'WEB-ORDER-002', customer: { name: 'Kabir Sen', phone: '9000000102' }, pickup: { address: '8 Park Street' }, request: { estimatedBags: 2, expectedDeliveryDate: '2026-09-11' } },
  });
  store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, estimateOnly));
  const estimateAccepted = store.withStoreScope(tenant, storeId, () => actOnMarketplaceOrder(tenant, actor, 'WEB-ORDER-002', { action: 'accept' }));
  assert.equal(estimateAccepted.materialized?.reason, 'intake_required', 'bag estimates remain intake-required instead of inventing garment facts');
  const intake = store.withStoreScope(tenant, storeId, () => recordMarketplaceIntake(tenant, actor, { externalOrderId: 'WEB-ORDER-002', actual: { items: [{ garmentId: garment.id, serviceId: service.id, qty: 1 }], bagCount: 1 }, reason: 'Physical intake counted one piece' }));
  const reassessment = store.withStoreScope(tenant, storeId, () => createMarketplaceReassessment(tenant, actor, { externalOrderId: 'WEB-ORDER-002', previousAmountPaise: 100, revisedAmountPaise: 250, reason: 'Actual garment differs from bag estimate', tolerancePaise: 0 }));
  assert.equal(reassessment.data.state, 'PendingApproval', 'material price changes stop for customer approval');
  assert.throws(() => store.withStoreScope(tenant, storeId, () => materializeMarketplaceOrder(tenant, actor, 'WEB-ORDER-002')), /CUSTOMER_APPROVAL_REQUIRED/);
  store.withStoreScope(tenant, storeId, () => decideMarketplaceReassessment(tenant, actor, reassessment.id, 'approve'));
  const materializedAfterApproval = store.withStoreScope(tenant, storeId, () => materializeMarketplaceOrder(tenant, actor, 'WEB-ORDER-002'));
  assert.equal(materializedAfterApproval.created, true, 'approved reassessment unlocks materialization from actual intake');
  assert.ok(intake.id, 'intake evidence remains addressable');

  const outOfOrderV3 = { ...estimateOnly, eventId: 'cross-order-2-v3', aggregateVersion: 3, eventType: 'marketplace.order.status.v1', payload: { ...estimateOnly.payload, state: 'Ready' } };
  assert.equal(store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, outOfOrderV3)).held, true, 'aggregate version gaps are held');
  const rejectEnvelope = simulator.enqueueOrder(device.id, {
    tenantId: tenant, vendorId, storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'cross-order-3', externalOrderId: 'APP-ORDER-003', eventType: 'marketplace.order.assigned.v1', payload: { channel: 'MARKETPLACE', state: 'AwaitingAcceptance', orderNumber: 'APP-ORDER-003', customer: { name: 'Reject Me', phone: '9000000103' }, request: { estimatedBags: 1, expectedDeliveryDate: '2026-09-12' } },
  });
  store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, rejectEnvelope));
  const rejected = store.withStoreScope(tenant, storeId, () => actOnMarketplaceOrder(tenant, actor, 'APP-ORDER-003', { action: 'reject', reason: 'Capacity full for requested slot' }));
  assert.equal(rejected.order.state, 'Rejected', 'vendor rejection retains an explicit reason');
  assert.equal(rejected.event.aggregateVersion, 2, 'vendor rejection uses the next external aggregate version');

  const walkIn = store.withStoreScope(tenant, storeId, () => bookLaundryOrder(tenant, actor, { customer: { name: 'Offline Walk-in', phone: '9000000104' }, items: [{ garment: garment.id, service: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-13', fulfillmentMode: 'Home Delivery' }));
  const walkInOutbound = store.withStoreScope(tenant, storeId, () => queueMarketplaceEvent(tenant, actor, { aggregateType: 'laundry_order', aggregateId: walkIn.order.id, aggregateVersion: 1, eventType: 'store.order.created.v1', payload: { localOrderId: walkIn.order.id, channel: 'COUNTER' } }));
  const relayed = store.withStoreScope(tenant, storeId, () => relayMarketplaceOutbox(tenant, simulator, { now: new Date(Date.now() + 120_000) }));
  assert.ok(relayed.delivered.includes(walkInOutbound.eventId), 'offline walk-in can be queued and durably acknowledged later');
  assert.equal(simulator.deliveryCount(walkInOutbound.eventId), 1, 'outbound delivery has one durable simulator receipt');
  const status = store.withStoreScope(tenant, storeId, () => marketplaceSyncStatus(tenant));
  assert.equal(status.checkpoint?.cursor, '', 'local relay does not fabricate a remote pull cursor');
  assert.equal(store.withStoreScope(tenant, 'STORE-B', () => store.listMarketplaceOrderProjections(tenant).length), 0, 'a second store cannot read this store queue');

  store.close(); closeStore = undefined;
  const restarted = new Store(databaseFile, { skipLegacyImport: true });
  closeStore = () => restarted.close();
  assert.equal(restarted.withStoreScope(tenant, storeId, () => restarted.rowsOf(tenant, 'laundry_order').filter((row) => row.data.external_order_id === 'APP-ORDER-001').length), 1, 'materialized order survives restart');
  assert.equal(restarted.withStoreScope(tenant, storeId, () => restarted.getSyncOutboxEvent(tenant, walkInOutbound.eventId)?.state), 'Acknowledged', 'outbound ACK state survives restart');
  console.log('PASS  cross-channel order intake, retries, offline catch-up, materialization, approval, payment evidence, rejection, walk-in sync, isolation, and restart self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
