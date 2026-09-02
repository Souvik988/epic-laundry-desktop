import { randomUUID } from 'node:crypto';
import { store, type MarketplaceOrderProjectionRecord } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';
import { queueMarketplaceEvent } from './edge-sync.js';

export type MarketplacePickupTaskState = 'Requested' | 'Scheduled' | 'Assigned' | 'Collected' | 'Failed' | 'Cancelled';
export type MarketplacePickupTask = {
  id: string; tenant: string; storeId: string; externalOrderId: string; projectionId: string; state: MarketplacePickupTaskState;
  scheduledDate?: string; window?: string; address: string; riderId?: string; serviceZone?: string;
  requestedAt: string; updatedAt: string; failureReason?: string;
};

const ENTITY = 'marketplace_pickup_task';
const now = () => new Date().toISOString();
const text = (value: unknown, max = 300) => String(value || '').trim().slice(0, max);
const projectionFor = (tenant: string, externalOrderId: string) => store.listMarketplaceOrderProjections(tenant).find((candidate) => candidate.externalOrderId === externalOrderId);
const taskRowFor = (tenant: string, externalOrderId: string) => store.rowsOf(tenant, ENTITY).find((candidate) => candidate.data.externalOrderId === externalOrderId && candidate.status === 'Active');
const taskFromRow = (row: EntityRow): MarketplacePickupTask => ({ id: row.id, tenant: row.tenant, storeId: store.currentStore(row.tenant), externalOrderId: text(row.data.externalOrderId, 160), projectionId: text(row.data.projectionId, 160), state: text(row.data.state, 30) as MarketplacePickupTaskState, scheduledDate: text(row.data.scheduledDate, 10) || undefined, window: text(row.data.window, 80) || undefined, address: text(row.data.address, 1_000), riderId: text(row.data.riderId, 160) || undefined, serviceZone: text(row.data.serviceZone, 120) || undefined, requestedAt: text(row.data.requestedAt, 40) || row.created_at, updatedAt: text(row.data.updatedAt, 40) || row.updated_at, failureReason: text(row.data.failureReason, 500) || undefined });

function validDate(value: unknown) {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('PICKUP_DATE_INVALID');
  return date;
}

function addressFor(projection: MarketplaceOrderProjectionRecord) {
  const pickup = projection.pickup || {};
  const value = pickup.address ?? pickup.pickupAddress ?? projection.customer?.address;
  const address = typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : '';
  if (!address.trim()) throw new Error('PICKUP_ADDRESS_REQUIRED');
  return text(address, 1_000);
}

function transitionProjection(tenant: string, actor: string, projection: MarketplaceOrderProjectionRecord, state: MarketplaceOrderProjectionRecord['state'], eventType: string, payload: Record<string, unknown>) {
  const updatedAt = now();
  const saved = store.saveMarketplaceOrderProjection({ ...projection, state, sourceVersion: projection.sourceVersion + 1, syncState: 'PendingOutbound', updatedAt });
  const event = queueMarketplaceEvent(tenant, actor, { aggregateType: 'marketplace_order', aggregateId: projection.externalOrderId, aggregateVersion: saved.sourceVersion, eventType, payload: { externalOrderId: projection.externalOrderId, localProjectionId: projection.id, state, ...payload } });
  return { projection: saved, event };
}

export function marketplacePickupTask(tenant: string, externalOrderId: string) {
  const row = taskRowFor(tenant, text(externalOrderId, 160));
  return row ? taskFromRow(row) : null;
}

export function scheduleMarketplacePickup(tenant: string, actor: string, input: { externalOrderId: string; scheduledDate: string; window?: string; riderId?: string; serviceZone?: string }) {
  return store.transaction(() => {
    const externalOrderId = text(input.externalOrderId, 160);
    const projection = projectionFor(tenant, externalOrderId);
    if (!projection) throw new Error('marketplace order not found');
    if (!['Accepted', 'PickupScheduled'].includes(projection.state)) throw new Error('PICKUP_ORDER_NOT_ACCEPTED');
    const existing = taskRowFor(tenant, externalOrderId);
    if (existing) {
      const task = taskFromRow(existing);
      if (['Scheduled', 'Assigned', 'Collected'].includes(task.state)) return { task, projection, event: null, idempotent: true };
    }
    const timestamp = now();
    const scheduledDate = validDate(input.scheduledDate);
    const riderId = text(input.riderId, 160) || undefined;
    const task: EntityRow = existing
      ? { ...existing, version: existing.version + 1, updated_at: timestamp, data: { ...existing.data, scheduledDate, window: text(input.window, 80) || undefined, riderId, serviceZone: text(input.serviceZone, 120) || undefined, state: riderId ? 'Assigned' : 'Scheduled', address: addressFor(projection), updatedAt: timestamp, failureReason: undefined } }
      : { id: `mpt_${randomUUID()}`, entity: ENTITY, tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { externalOrderId, projectionId: projection.id, state: riderId ? 'Assigned' : 'Scheduled', scheduledDate, window: text(input.window, 80) || undefined, address: addressFor(projection), riderId, serviceZone: text(input.serviceZone, 120) || undefined, requestedAt: projection.createdAt, updatedAt: timestamp } };
    if (existing) store.updateRow(task); else store.insertRow(task);
    const transition = transitionProjection(tenant, actor, projection, 'PickupScheduled', 'marketplace.order.pickup-scheduled.v1', { scheduledDate, window: task.data.window, riderId, serviceZone: task.data.serviceZone });
    audit(tenant, actor, 'marketplace:pickup-scheduled', { entity: ENTITY, row_id: task.id, after: { externalOrderId, state: task.data.state, scheduledDate, riderId: riderId || undefined } });
    return { task: taskFromRow(task), projection: transition.projection, event: transition.event, idempotent: false };
  });
}

export function completeMarketplacePickup(tenant: string, actor: string, input: { externalOrderId: string; state: 'Collected' | 'Failed' | 'Cancelled'; reason?: string }) {
  return store.transaction(() => {
    const externalOrderId = text(input.externalOrderId, 160);
    const row = taskRowFor(tenant, externalOrderId);
    if (!row) throw new Error('PICKUP_TASK_NOT_FOUND');
    const task = taskFromRow(row);
    if (task.state === input.state) return { task, projection: projectionFor(tenant, externalOrderId), event: null, idempotent: true };
    if (!['Scheduled', 'Assigned'].includes(task.state)) throw new Error('PICKUP_TASK_NOT_ACTIVE');
    const reason = text(input.reason, 500);
    if (input.state !== 'Collected' && !reason) throw new Error('PICKUP_OUTCOME_REASON_REQUIRED');
    const projection = projectionFor(tenant, externalOrderId);
    if (!projection) throw new Error('marketplace order not found');
    const timestamp = now();
    row.version += 1; row.updated_at = timestamp; row.data.state = input.state; row.data.updatedAt = timestamp; row.data.failureReason = input.state === 'Collected' ? undefined : reason; store.updateRow(row);
    const targetState = input.state === 'Collected' ? 'IntakeRequired' : input.state === 'Cancelled' ? 'Cancelled' : 'PickupScheduled';
    const transition = transitionProjection(tenant, actor, projection, targetState, `marketplace.order.pickup-${input.state.toLowerCase()}.v1`, { reason: reason || undefined, completedAt: timestamp });
    audit(tenant, actor, `marketplace:pickup-${input.state.toLowerCase()}`, { entity: ENTITY, row_id: row.id, after: { externalOrderId, state: input.state, reason: reason || undefined } });
    return { task: taskFromRow(row), projection: transition.projection, event: transition.event, idempotent: false };
  });
}
