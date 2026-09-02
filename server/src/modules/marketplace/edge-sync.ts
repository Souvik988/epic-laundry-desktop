import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { store, type MarketplaceChannel, type MarketplaceDeviceRecord, type MarketplaceOrderProjectionRecord, type MarketplaceOrderState, type SyncInboxRecord, type SyncOutboxRecord } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { createMarketplaceOrderRequest } from './order-truth.js';

export const SYNC_VERSION = 1;
export const MARKETPLACE_ORDER_STATES = ['AwaitingAcceptance', 'Accepted', 'Rejected', 'Expired', 'PickupScheduled', 'IntakeRequired', 'CustomerApprovalRequired', 'Processing', 'Ready', 'DeliveryScheduled', 'Completed', 'Cancelled'] as const;

export type DeviceEnrollment = { deviceId: string; publicKey: string; privateKeyPem: string };
export type DeviceRegistrationInput = { vendorId: string; station?: string; capabilities?: Record<string, boolean>; softwareVersion?: string; credentialRef?: string; publicKey?: string; status?: MarketplaceDeviceRecord['status'] };
export type MarketplaceEnvelope = {
  eventId: string; source: string; tenantId: string; vendorId: string; storeId: string; deviceId: string;
  aggregateType: string; aggregateId: string; aggregateVersion: number; eventType: string; eventVersion: number;
  occurredAt: string; correlationId?: string; payload: Record<string, unknown>;
};
export type MarketplaceOrderInput = {
  externalOrderId: string; orderNumber: string; channel: MarketplaceChannel; state: MarketplaceOrderState;
  customer?: Record<string, unknown>; pickup?: Record<string, unknown>; request?: Record<string, unknown>;
  paymentState?: string; assignmentAt?: string; acceptanceDeadline?: string; preferences?: string; notes?: string;
};
export type SyncTransport = { deliver: (event: SyncOutboxRecord) => { receiptId: string } };

const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const payloadHash = (payload: Record<string, unknown>) => createHash('sha256').update(canonicalize(payload)).digest('hex');
function requireRegisteredDevice(tenant: string) {
  const device = store.getMarketplaceDevice(tenant);
  if (!device || device.status !== 'Registered' || !device.vendorId || !device.publicKey || !device.credentialRef) throw new Error('SYNC_NOT_CONFIGURED');
  return device;
}
function assertTarget(tenant: string, envelope: MarketplaceEnvelope, device: MarketplaceDeviceRecord) {
  const storeId = store.currentStore(tenant);
  if (envelope.tenantId !== tenant || envelope.storeId !== storeId || envelope.vendorId !== device.vendorId || envelope.deviceId !== device.id) throw new Error('SYNC_TARGET_MISMATCH');
}
function backoff(eventId: string, attempt: number, now: Date) {
  const exponent = Math.max(0, Math.min(10, attempt - 1));
  const base = Math.min(15 * 60_000, 1_000 * (2 ** exponent));
  const jitter = Number.parseInt(createHash('sha256').update(eventId).digest('hex').slice(0, 4), 16) % 501;
  return new Date(now.getTime() + base + jitter).toISOString();
}

/** A device keypair is generated locally; callers must place privateKeyPem into platform secure storage. */
export function createDeviceEnrollment(): DeviceEnrollment {
  const keys = generateKeyPairSync('ed25519');
  return { deviceId: `dev_${randomUUID()}`, publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}
export function registerMarketplaceDevice(tenant: string, actor: string, input: DeviceRegistrationInput & { deviceId?: string }) {
  const now = new Date().toISOString();
  const existing = store.getMarketplaceDevice(tenant);
  const vendorId = clean(input.vendorId, 120);
  if (!vendorId) throw new Error('vendor ID is required');
  const status = input.status || 'Pending';
  if (!['NotConfigured', 'Pending', 'Registered', 'Revoked'].includes(status)) throw new Error('invalid marketplace device status');
  const publicKey = clean(input.publicKey || existing?.publicKey, 10_000);
  const credentialRef = clean(input.credentialRef || existing?.credentialRef, 500);
  if (status === 'Registered' && (!publicKey || !credentialRef)) throw new Error('registered marketplace devices require a public key and protected credential reference');
  const device: MarketplaceDeviceRecord = {
    id: clean(input.deviceId || existing?.id || `dev_${randomUUID()}`, 160), tenant, storeId: store.currentStore(tenant), vendorId,
    station: clean(input.station ?? existing?.station, 120), status, publicKey, credentialRef,
    capabilities: input.capabilities || existing?.capabilities || { marketplaceSync: true }, softwareVersion: clean(input.softwareVersion || existing?.softwareVersion, 80),
    activatedAt: status === 'Registered' ? existing?.activatedAt || now : undefined, lastSeenAt: existing?.lastSeenAt, revokedAt: status === 'Revoked' ? now : undefined,
    rotationRequired: status === 'Revoked', createdAt: existing?.createdAt || now, updatedAt: now,
  };
  const saved = store.saveMarketplaceDevice(device);
  audit(tenant, actor, 'marketplace:device-registered', { entity: 'marketplace_device', row_id: saved.id, after: { vendorId: saved.vendorId, station: saved.station, status: saved.status, capabilities: saved.capabilities } });
  return saved;
}
export function queueMarketplaceEvent(tenant: string, actor: string, input: { aggregateType: string; aggregateId: string; aggregateVersion: number; eventType: string; eventVersion?: number; payload: Record<string, unknown>; correlationId?: string }) {
  const device = requireRegisteredDevice(tenant); const now = new Date().toISOString();
  const aggregateType = clean(input.aggregateType, 120); const aggregateId = clean(input.aggregateId, 160); const eventType = clean(input.eventType, 160);
  if (!aggregateType || !aggregateId || !eventType || !Number.isSafeInteger(input.aggregateVersion) || input.aggregateVersion < 1) throw new Error('invalid marketplace event identity');
  const sequence = store.nextSeq(`sync:${tenant}:${store.currentStore(tenant)}:${device.id}:${aggregateType}:${aggregateId}`);
  const event: SyncOutboxRecord = { eventId: randomUUID(), tenant, vendorId: device.vendorId, storeId: store.currentStore(tenant), deviceId: device.id, aggregateType, aggregateId, aggregateVersion: input.aggregateVersion, eventType, eventVersion: input.eventVersion || SYNC_VERSION, payload: object(input.payload), createdAt: now, sequence, state: 'Pending', attemptCount: 0, nextAttemptAt: now, correlationId: clean(input.correlationId || randomUUID(), 160) };
  store.appendSyncOutbox(event);
  audit(tenant, actor, 'marketplace:sync-event-queued', { entity: 'sync_outbox', row_id: event.eventId, after: { aggregateType, aggregateId, aggregateVersion: event.aggregateVersion, eventType, sequence } });
  return event;
}
export function relayMarketplaceOutbox(tenant: string, transport: SyncTransport, options: { now?: Date; leaseMs?: number; limit?: number; maxAttempts?: number } = {}) {
  const device = requireRegisteredDevice(tenant); const now = options.now || new Date(); const leaseMs = Math.max(1_000, Math.min(300_000, options.leaseMs || 30_000)); const maxAttempts = Math.max(1, Math.min(100, options.maxAttempts || 8));
  const leased = store.leaseSyncOutbox(tenant, device.id, { now: now.toISOString(), leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), limit: options.limit || 25, maxAttempts });
  const delivered: string[] = []; const failed: string[] = [];
  for (const event of leased) {
    try {
      const receipt = transport.deliver(event);
      if (!receipt || !clean(receipt.receiptId, 200)) throw new Error('remote response omitted durable receipt ID');
      store.acknowledgeSyncOutbox(tenant, event.eventId, receipt.receiptId, new Date().toISOString()); delivered.push(event.eventId);
    } catch (error) {
      store.retrySyncOutbox(tenant, event.eventId, { nextAttemptAt: backoff(event.eventId, event.attemptCount, now), error: error instanceof Error ? error.message : 'sync delivery failed', maxAttempts }); failed.push(event.eventId);
    }
  }
  const checkpoint = store.getSyncCheckpoint(tenant, device.id, 'marketplace.events') || {
    tenant,
    storeId: store.currentStore(tenant),
    deviceId: device.id,
    remoteStream: 'marketplace.events',
    cursor: '',
    lastPullAt: undefined,
    lastPushAt: undefined,
    lastHeartbeatAt: undefined,
    serverTimeOffsetMs: undefined,
    error: undefined,
    updatedAt: now.toISOString(),
  };
  store.saveSyncCheckpoint({ ...checkpoint, lastPushAt: delivered.length ? new Date().toISOString() : checkpoint.lastPushAt, error: failed.length ? `${failed.length} event(s) pending retry` : undefined, updatedAt: new Date().toISOString() });
  return { delivered, failed, leased: leased.map((event) => event.eventId) };
}
type ValidatedMarketplaceOrder = { payload: Record<string, unknown>; externalOrderId: string; channel: MarketplaceChannel; state: MarketplaceOrderState };
function validateMarketplaceOrderEnvelope(envelope: MarketplaceEnvelope): ValidatedMarketplaceOrder {
  if (envelope.aggregateType !== 'marketplace_order' || !envelope.eventType.startsWith('marketplace.order.')) throw new Error('unsupported marketplace event');
  const payload = object(envelope.payload); const externalOrderId = clean(payload.externalOrderId || envelope.aggregateId, 160); const channel = clean(payload.channel || 'MARKETPLACE', 40) as MarketplaceChannel; const state = clean(payload.state || 'AwaitingAcceptance', 80) as MarketplaceOrderState;
  if (!clean(envelope.eventId, 160) || !clean(envelope.source, 120) || !Number.isSafeInteger(envelope.aggregateVersion) || envelope.aggregateVersion < 1 || !Number.isSafeInteger(envelope.eventVersion) || envelope.eventVersion < 1 || !externalOrderId || externalOrderId !== envelope.aggregateId || !['CUSTOMER_APP', 'WEBSITE', 'VENDOR_APP', 'MARKETPLACE', 'ADMIN'].includes(channel) || !MARKETPLACE_ORDER_STATES.includes(state)) throw new Error('invalid marketplace order event payload');
  return { payload, externalOrderId, channel, state };
}
function applyMarketplaceOrderEnvelope(tenant: string, actor: string, envelope: MarketplaceEnvelope, input: ValidatedMarketplaceOrder) {
  const { payload, externalOrderId, channel, state } = input;
  const now = new Date().toISOString();
  const current = store.getMarketplaceOrderProjection(tenant, channel, externalOrderId);
  const expectedVersion = current ? current.sourceVersion + 1 : 1;
  if (envelope.aggregateVersion !== expectedVersion) {
    store.updateSyncInbox(tenant, envelope.eventId, { applyStatus: 'Held', error: envelope.aggregateVersion < expectedVersion ? 'EXTERNAL_ORDER_VERSION_STALE' : 'EXTERNAL_ORDER_VERSION_GAP' });
    return { duplicate: false, held: true, order: current || null };
  }
  const projection: MarketplaceOrderProjectionRecord = { id: current?.id || `mko_${randomUUID()}`, tenant, storeId: store.currentStore(tenant), vendorId: envelope.vendorId, channel, externalOrderId, sourceVersion: envelope.aggregateVersion, state, orderNumber: clean(payload.orderNumber || current?.orderNumber || externalOrderId, 120), customer: object(payload.customer), pickup: object(payload.pickup), request: object(payload.request), paymentState: clean(payload.paymentState || current?.paymentState || 'Unknown', 80), assignmentAt: clean(payload.assignmentAt || current?.assignmentAt, 40) || undefined, acceptanceDeadline: clean(payload.acceptanceDeadline || current?.acceptanceDeadline, 40) || undefined, preferences: clean(payload.preferences || current?.preferences, 2_000), notes: clean(payload.notes || current?.notes, 4_000), syncState: 'Current', localOrderId: current?.localOrderId, createdAt: current?.createdAt || now, updatedAt: now };
  const saved = store.saveMarketplaceOrderProjection(projection);
  createMarketplaceOrderRequest(tenant, actor, { externalOrderId, channel, estimate: projection.request, customer: projection.customer, requestedAt: envelope.occurredAt });
  store.saveOrderExternalLink({ id: current ? store.getOrderExternalLink(tenant, channel, externalOrderId)?.id || `oel_${randomUUID()}` : `oel_${randomUUID()}`, tenant, storeId: store.currentStore(tenant), localOrderId: saved.localOrderId, channel, externalOrderId, externalCustomerId: clean(payload.externalCustomerId, 160) || undefined, externalStoreId: envelope.storeId, externalVendorId: envelope.vendorId, sourceRevision: envelope.aggregateVersion, createdAt: now, lastSyncedAt: now });
  store.updateSyncInbox(tenant, envelope.eventId, { applyStatus: 'Applied', appliedAt: now, localAggregateType: 'marketplace_order_projection', localId: saved.id });
  audit(tenant, actor, 'marketplace:order-projected', { entity: 'marketplace_order_projection', row_id: saved.id, after: { externalOrderId, sourceVersion: saved.sourceVersion, state: saved.state } });
  return { duplicate: false, held: false, order: saved };
}
export function receiveMarketplaceOrder(tenant: string, actor: string, envelope: MarketplaceEnvelope) {
  const device = requireRegisteredDevice(tenant); assertTarget(tenant, envelope, device);
  const input = validateMarketplaceOrderEnvelope(envelope); const now = new Date().toISOString();
  const inbox: SyncInboxRecord = { eventId: clean(envelope.eventId, 160), source: clean(envelope.source, 120), tenant, vendorId: envelope.vendorId, storeId: store.currentStore(tenant), deviceId: device.id, aggregateType: envelope.aggregateType, aggregateId: envelope.aggregateId, aggregateVersion: envelope.aggregateVersion, eventType: envelope.eventType, eventVersion: envelope.eventVersion, payloadHash: payloadHash(input.payload), payload: input.payload, receivedAt: now, applyStatus: 'Received', correlationId: clean(envelope.correlationId || envelope.eventId, 160) };
  return store.transaction(() => {
    const received = store.receiveSyncInbox(inbox);
    if (received.duplicate) return { duplicate: true, held: received.record.applyStatus === 'Held', order: store.getMarketplaceOrderProjection(tenant, input.channel, input.externalOrderId) || null };
    return applyMarketplaceOrderEnvelope(tenant, actor, envelope, input);
  });
}
export function replayHeldMarketplaceOrder(tenant: string, actor: string, eventId: string) {
  const device = requireRegisteredDevice(tenant);
  return store.transaction(() => {
    const held = store.getSyncInboxEvent(tenant, eventId);
    if (!held) throw new Error('sync inbox event not found');
    if (held.applyStatus !== 'Held') throw new Error('sync inbox event is not held');
    const envelope: MarketplaceEnvelope = { eventId: held.eventId, source: held.source, tenantId: held.tenant, vendorId: held.vendorId, storeId: held.storeId, deviceId: held.deviceId, aggregateType: held.aggregateType, aggregateId: held.aggregateId, aggregateVersion: held.aggregateVersion, eventType: held.eventType, eventVersion: held.eventVersion, occurredAt: held.receivedAt, correlationId: held.correlationId, payload: held.payload };
    assertTarget(tenant, envelope, device);
    return applyMarketplaceOrderEnvelope(tenant, actor, envelope, validateMarketplaceOrderEnvelope(envelope));
  });
}
export function actOnMarketplaceOrder(tenant: string, actor: string, externalOrderId: string, input: { action: 'accept' | 'reject'; reason?: string }) {
  const device = requireRegisteredDevice(tenant); const order = store.getMarketplaceOrderProjection(tenant, 'MARKETPLACE', externalOrderId) || ['CUSTOMER_APP', 'WEBSITE', 'VENDOR_APP', 'ADMIN'].map((channel) => store.getMarketplaceOrderProjection(tenant, channel as MarketplaceChannel, externalOrderId)).find(Boolean);
  if (!order) throw new Error('marketplace order not found');
  if (order.state !== 'AwaitingAcceptance') throw new Error('ONLINE_ORDER_NOT_AWAITING_ACCEPTANCE');
  const reason = clean(input.reason, 500);
  if (input.action === 'reject' && !reason) throw new Error('rejection reason is required');
  const now = new Date().toISOString(); const next: MarketplaceOrderProjectionRecord = { ...order, state: input.action === 'accept' ? 'Accepted' : 'Rejected', notes: input.action === 'reject' ? `${order.notes}${order.notes ? '\n' : ''}Rejected: ${reason}` : order.notes, updatedAt: now, syncState: 'PendingOutbound' };
  const saved = store.saveMarketplaceOrderProjection(next);
  const event = queueMarketplaceEvent(tenant, actor, { aggregateType: 'marketplace_order', aggregateId: order.externalOrderId, aggregateVersion: order.sourceVersion, eventType: input.action === 'accept' ? 'marketplace.order.accepted.v1' : 'marketplace.order.rejected.v1', payload: { externalOrderId: order.externalOrderId, localProjectionId: order.id, reason: reason || undefined, actedAt: now, vendorId: device.vendorId } });
  return { order: saved, event };
}
export function linkMarketplaceOrderToLocalOrder(tenant: string, actor: string, externalOrderId: string, localOrderId: string) {
  const order = ['MARKETPLACE', 'CUSTOMER_APP', 'WEBSITE', 'VENDOR_APP', 'ADMIN'].map((channel) => store.getMarketplaceOrderProjection(tenant, channel as MarketplaceChannel, externalOrderId)).find(Boolean);
  if (!order) throw new Error('marketplace order not found');
  const local = store.getRow(tenant, String(localOrderId || '').trim());
  if (!local || local.entity !== 'laundry_order') throw new Error('local laundry order not found');
  const conflicting = store.listOrderExternalLinks(tenant, local.id).find((link) => link.externalOrderId !== externalOrderId);
  if (conflicting) throw new Error('EXTERNAL_ORDER_ALREADY_LINKED');
  const now = new Date().toISOString();
  const saved = store.saveMarketplaceOrderProjection({ ...order, localOrderId: local.id, updatedAt: now });
  const externalLink = store.saveOrderExternalLink({ id: store.getOrderExternalLink(tenant, order.channel, externalOrderId)?.id || `oel_${randomUUID()}`, tenant, storeId: store.currentStore(tenant), localOrderId: local.id, channel: order.channel, externalOrderId, externalStoreId: order.storeId, externalVendorId: order.vendorId, sourceRevision: order.sourceVersion, createdAt: now, lastSyncedAt: now });
  audit(tenant, actor, 'marketplace:order-linked-to-local-order', { entity: 'marketplace_order_projection', row_id: order.id, after: { externalOrderId, localOrderId: local.id, channel: order.channel } });
  return { projection: saved, localOrder: local, externalLink };
}
export function marketplaceSyncStatus(tenant: string) {
  const device = store.getMarketplaceDevice(tenant); const outbox = store.syncOutboxCounts(tenant); const inbox = store.syncInboxCounts(tenant); const checkpoint = device ? store.getSyncCheckpoint(tenant, device.id, 'marketplace.events') : undefined;
  return { version: SYNC_VERSION, configured: Boolean(device?.status === 'Registered'), device: device ? { id: device.id, vendorId: device.vendorId, storeId: device.storeId, station: device.station, status: device.status, lastSeenAt: device.lastSeenAt, rotationRequired: device.rotationRequired } : null, checkpoint: checkpoint ? { remoteStream: checkpoint.remoteStream, cursor: checkpoint.cursor, lastPullAt: checkpoint.lastPullAt, lastPushAt: checkpoint.lastPushAt, lastHeartbeatAt: checkpoint.lastHeartbeatAt, serverTimeOffsetMs: checkpoint.serverTimeOffsetMs, error: checkpoint.error, updatedAt: checkpoint.updatedAt } : null, outbox: { pending: outbox.Pending, inFlight: outbox.InFlight, retry: outbox.Retry, acknowledged: outbox.Acknowledged, deadLetter: outbox.DeadLetter }, inbox: { received: inbox.Received, held: inbox.Held, failed: inbox.Failed }, onlineOrders: store.marketplaceOrderProjectionCount(tenant) };
}
