import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-marketplace-sync-'));
const databaseFile = join(tempDir, 'nested', 'marketplace.sqlite');
process.env.EPIC_DATA_FILE = join(tempDir, 'nested', 'legacy.json');
process.env.EPIC_DB_FILE = databaseFile;
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;

let closeStore: (() => void) | undefined;
try {
  const { Store, store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const { actOnMarketplaceOrder, createDeviceEnrollment, marketplaceSyncStatus, queueMarketplaceEvent, receiveMarketplaceOrder, receiveMarketplacePayment, receiveMarketplaceSettlement, registerMarketplaceDevice, relayMarketplaceOutbox, replayHeldMarketplaceOrder } = await import('./modules/marketplace/edge-sync.js');
  const { MarketplaceIntegrationSimulator } = await import('./modules/marketplace/simulator.js');

  const tenant = 'MARKETPLACE-TEST'; const storeId = 'STORE-A'; const vendorId = 'VENDOR-A'; const actor = 'marketplace-test';
  const simulator = new MarketplaceIntegrationSimulator();
  const enrollment = store.withStoreScope(tenant, storeId, () => createDeviceEnrollment());
  const device = store.withStoreScope(tenant, storeId, () => registerMarketplaceDevice(tenant, actor, {
    deviceId: enrollment.deviceId, vendorId, station: 'Counter-1', publicKey: enrollment.publicKey,
    credentialRef: 'sim://marketplace-test/device-token', capabilities: { marketplaceSync: true }, softwareVersion: '4.0.0-test', status: 'Registered',
  }));
  assert.equal(device.status, 'Registered', 'an enrolled device is explicitly registered before sync is usable');
  assert.match(enrollment.privateKeyPem, /BEGIN PRIVATE KEY/, 'private device material is generated locally for protected storage');

  const outbound = store.withStoreScope(tenant, storeId, () => queueMarketplaceEvent(tenant, actor, {
    aggregateType: 'laundry_order', aggregateId: 'LOCAL-001', aggregateVersion: 1, eventType: 'marketplace.order.created.v1', payload: { localOrderId: 'LOCAL-001' },
  }));
  const base = new Date(Date.now() + 60_000);
  simulator.setUnavailable(true);
  const failed = store.withStoreScope(tenant, storeId, () => relayMarketplaceOutbox(tenant, simulator, { now: base }));
  assert.deepEqual(failed.failed, [outbound.eventId], 'a transport failure keeps the event for retry instead of marking it published');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.getSyncOutboxEvent(tenant, outbound.eventId)?.state), 'Retry', 'failed delivery enters durable Retry state');
  simulator.setUnavailable(false);
  const recovered = store.withStoreScope(tenant, storeId, () => relayMarketplaceOutbox(tenant, simulator, { now: new Date(base.getTime() + 10_000) }));
  assert.deepEqual(recovered.delivered, [outbound.eventId], 'a remote durable receipt acknowledges the retried outbox event');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.getSyncOutboxEvent(tenant, outbound.eventId)?.state), 'Acknowledged', 'only a remote receipt ends delivery');

  const crashWindow = store.withStoreScope(tenant, storeId, () => queueMarketplaceEvent(tenant, actor, {
    aggregateType: 'laundry_order', aggregateId: 'LOCAL-002', aggregateVersion: 1, eventType: 'marketplace.order.created.v1', payload: { localOrderId: 'LOCAL-002' },
  }));
  const leaseStart = new Date(Date.now() + 120_000);
  const leased = store.withStoreScope(tenant, storeId, () => store.leaseSyncOutbox(tenant, device.id, { now: leaseStart.toISOString(), leaseUntil: new Date(leaseStart.getTime() + 1_000).toISOString(), limit: 10, maxAttempts: 8 }));
  const deliveredBeforeCrash = leased.find((event) => event.eventId === crashWindow.eventId)!;
  simulator.deliver(deliveredBeforeCrash); // remote acceptance occurred, but the local process "crashes" before ack persistence.
  const recoveredAfterCrash = store.withStoreScope(tenant, storeId, () => relayMarketplaceOutbox(tenant, simulator, { now: new Date(leaseStart.getTime() + 2_000) }));
  assert.deepEqual(recoveredAfterCrash.delivered, [crashWindow.eventId], 'an expired lease retries the unknown-delivery window');
  assert.equal(simulator.deliveryCount(crashWindow.eventId), 1, 'the simulator deduplicates a replayed event ID after local crash recovery');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.getSyncOutboxEvent(tenant, crashWindow.eventId)?.state), 'Acknowledged', 'replayed acknowledgement is persisted locally');

  const envelope = (eventId: string, version: number, state: string) => ({
    eventId, source: 'marketplace-simulator', tenantId: tenant, vendorId, storeId, deviceId: device.id,
    aggregateType: 'marketplace_order', aggregateId: 'WEB-1001', aggregateVersion: version, eventType: 'marketplace.order.assigned.v1', eventVersion: 1,
    occurredAt: '2026-09-02T12:00:00.000Z', correlationId: 'corr-web-1001',
    payload: { externalOrderId: 'WEB-1001', channel: 'WEBSITE', state, orderNumber: 'WEB-1001', customer: { name: 'Asha Rao' }, request: { estimatedBags: 2 } },
  });
  const v3 = envelope('evt-web-1001-v3', 3, 'PickupScheduled');
  const held = store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, v3));
  assert.equal(held.held, true, 'an out-of-order aggregate event is held without corrupting state');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.getSyncInboxEvent(tenant, v3.eventId)?.applyStatus), 'Held', 'the held event is diagnosable in the durable inbox');
  const v1 = envelope('evt-web-1001-v1', 1, 'AwaitingAcceptance');
  const appliedV1 = store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, v1));
  assert.equal(appliedV1.order?.sourceVersion, 1, 'first inbound order event creates exactly one local projection');
  const v2 = envelope('evt-web-1001-v2', 2, 'Accepted');
  const appliedV2 = store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, v2));
  assert.equal(appliedV2.order?.sourceVersion, 2, 'in-order follow-up advances the projection');
  const replayed = store.withStoreScope(tenant, storeId, () => replayHeldMarketplaceOrder(tenant, actor, v3.eventId));
  assert.equal(replayed.order?.sourceVersion, 3, 'the original held event safely replays once its predecessor exists');
  const duplicate = store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, v3));
  assert.equal(duplicate.duplicate, true, 're-delivering the same external event is idempotent');
  assert.equal(store.withStoreScope(tenant, storeId, () => store.listMarketplaceOrderProjections(tenant).length), 1, 'five-style retry behavior cannot create duplicate local online orders');
  assert.throws(() => store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, { ...v1, payload: { ...v1.payload, orderNumber: 'TAMPERED' } })), /SYNC_EVENT_PAYLOAD_COLLISION/, 'event-ID reuse with changed data is rejected');

  const secondEnvelope = { ...envelope('evt-web-1002-v1', 1, 'AwaitingAcceptance'), aggregateId: 'WEB-1002', payload: { externalOrderId: 'WEB-1002', channel: 'WEBSITE', state: 'AwaitingAcceptance', orderNumber: 'WEB-1002' } };
  store.withStoreScope(tenant, storeId, () => receiveMarketplaceOrder(tenant, actor, secondEnvelope));
  const rejected = store.withStoreScope(tenant, storeId, () => actOnMarketplaceOrder(tenant, actor, 'WEB-1002', { action: 'reject', reason: 'Capacity full for the requested slot' }));
  assert.equal(rejected.order.state, 'Rejected', 'vendor rejection is explicit and retains its operator reason');
  assert.equal(rejected.event.state, 'Pending', 'vendor action produces a separately acknowledged outbound command');

  const paymentEnvelope = simulator.enqueuePayment(device.id, { tenantId: tenant, vendorId, storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'corr-pay-1001', paymentIntent: 'pi-web-1001', provider: 'simulator', status: 'Captured', amountPaise: 12_500, payload: { providerEventId: 'provider-event-web-1001' } });
  assert.throws(() => store.withStoreScope(tenant, storeId, () => receiveMarketplacePayment(tenant, actor, { ...paymentEnvelope, aggregateId: '' })), /SYNC_EVENT_SCHEMA_INVALID/, 'financial envelopes reject missing aggregate identity before inbox application');
  assert.throws(() => store.withStoreScope(tenant, storeId, () => receiveMarketplacePayment(tenant, actor, { ...paymentEnvelope, payload: null as any })), /SYNC_EVENT_SCHEMA_INVALID/, 'financial envelopes reject non-object payloads before inbox application');
  const paymentBatch = simulator.pull(device.id);
  const paymentApplied = store.withStoreScope(tenant, storeId, () => receiveMarketplacePayment(tenant, actor, paymentBatch.find((event) => event.eventId === paymentEnvelope.eventId)!));
  assert.equal(paymentApplied.duplicate, false, 'provider payment event is applied once through the sync inbox');
  assert.equal((paymentApplied.local?.data as any).status, 'Captured', 'captured payment state is retained as provider evidence');
  simulator.enqueueDuplicate(device.id, paymentEnvelope, 5);
  for (const event of simulator.pull(device.id)) store.withStoreScope(tenant, storeId, () => receiveMarketplacePayment(tenant, actor, event));
  assert.equal(store.withStoreScope(tenant, storeId, () => store.rowsOf(tenant, 'provider_payment_event').length), 1, 'duplicate provider event delivery cannot duplicate payment evidence');

  const settlementEnvelope = simulator.enqueueSettlement(device.id, { tenantId: tenant, vendorId, storeId, aggregateVersion: 1, eventVersion: 1, correlationId: 'corr-set-1001', externalOrderId: 'WEB-1001', payload: { policyVersion: 'sim-policy-1', customerCollectedPaise: 12_500, refundPaise: 0, vendorServiceGrossPaise: 10_000, commissionBps: 1_500 } });
  const settlementApplied = store.withStoreScope(tenant, storeId, () => receiveMarketplaceSettlement(tenant, actor, simulator.pull(device.id).find((event) => event.eventId === settlementEnvelope.eventId)!));
  assert.equal(settlementApplied.duplicate, false, 'marketplace settlement event is applied through the durable inbox');
  assert.equal((settlementApplied.local?.data as any).reconciled, true, 'settlement evidence is reconciled before local application');
  simulator.enqueueDuplicate(device.id, settlementEnvelope, 5);
  for (const event of simulator.pull(device.id)) store.withStoreScope(tenant, storeId, () => receiveMarketplaceSettlement(tenant, actor, event));
  assert.equal(store.withStoreScope(tenant, storeId, () => store.rowsOf(tenant, 'marketplace_settlement').length), 1, 'duplicate settlement delivery cannot create a second settlement');

  store.withStoreScope(tenant, storeId, () => store.saveSyncCheckpoint({ tenant, storeId, deviceId: device.id, remoteStream: 'marketplace.orders', cursor: 'cursor-42', lastPullAt: '2026-09-02T12:10:00.000Z', serverTimeOffsetMs: 35, updatedAt: '2026-09-02T12:10:00.000Z' }));
  assert.equal(store.withStoreScope(tenant, storeId, () => store.getSyncCheckpoint(tenant, device.id, 'marketplace.orders')?.cursor), 'cursor-42', 'sync stream cursors are durable per store/device');
  const status = store.withStoreScope(tenant, storeId, () => marketplaceSyncStatus(tenant));
  assert.equal(status.configured, true, 'operator diagnostics distinguish configured marketplace sync');
  assert.equal(status.inbox.conflicts, 0, 'replayed version conflicts leave no actionable conflict count');
  assert.equal(status.inbox.held, 0, 'replayed ordered events clear the actionable held count');
  assert.equal(store.withStoreScope(tenant, 'STORE-B', () => store.listMarketplaceOrderProjections(tenant).length), 0, 'a second store cannot query this store’s marketplace projections');

  store.close(); closeStore = undefined;
  const restarted = new Store(databaseFile, { skipLegacyImport: true });
  closeStore = () => restarted.close();
  assert.equal(restarted.withStoreScope(tenant, storeId, () => restarted.getMarketplaceOrderProjection(tenant, 'WEBSITE', 'WEB-1001')?.sourceVersion), 3, 'online order projection survives process restart');
  assert.equal(restarted.withStoreScope(tenant, storeId, () => restarted.getSyncOutboxEvent(tenant, outbound.eventId)?.state), 'Acknowledged', 'outbox receipt state survives process restart');
  console.log('PASS  marketplace edge sync outbox, inbox, retry, ordering, replay, isolation, and restart self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
