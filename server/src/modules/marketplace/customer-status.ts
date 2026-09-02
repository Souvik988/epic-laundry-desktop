import { randomUUID } from 'node:crypto';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';
import type { MarketplaceOrderState } from '../../kernel/store.js';
import { marketplaceOrderTruth } from './order-truth.js';

export const CUSTOMER_FACING_STATUSES = [
  'AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning',
  'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled',
] as const;
export type CustomerFacingStatus = typeof CUSTOMER_FACING_STATUSES[number];
export type CustomerStatusMapping = Record<MarketplaceOrderState, CustomerFacingStatus>;

const DEFAULT_MAPPING: CustomerStatusMapping = {
  AwaitingAcceptance: 'AwaitingAcceptance',
  Accepted: 'Accepted',
  Rejected: 'Cancelled',
  Expired: 'Cancelled',
  PickupScheduled: 'PickupScheduled',
  IntakeRequired: 'Received',
  CustomerApprovalRequired: 'ApprovalRequired',
  Processing: 'Cleaning',
  Ready: 'Ready',
  DeliveryScheduled: 'OutForDelivery',
  Completed: 'Delivered',
  Cancelled: 'Cancelled',
};

const LOCAL_STATUS_MAP: Record<string, CustomerFacingStatus> = {
  Booked: 'Accepted',
  'Picked Up': 'Received',
  'In Process': 'Cleaning',
  Ready: 'Ready',
  'Out for Delivery': 'OutForDelivery',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
};
const LABELS: Record<CustomerFacingStatus, string> = {
  AwaitingAcceptance: 'Awaiting acceptance',
  Accepted: 'Accepted',
  PickupScheduled: 'Pickup scheduled',
  Received: 'Received',
  Cleaning: 'Cleaning',
  QualityCheck: 'Quality check',
  Ready: 'Ready',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  ApprovalRequired: 'Approval required',
  Cancelled: 'Cancelled',
};

const MARKETPLACE_STATUS_ENTITY = 'marketplace_customer_status_mapping';
const now = () => new Date().toISOString();
const text = (value: unknown, max = 160) => String(value || '').trim().slice(0, max);
const isCustomerStatus = (value: unknown): value is CustomerFacingStatus => CUSTOMER_FACING_STATUSES.includes(value as CustomerFacingStatus);
const isMarketplaceState = (value: unknown): value is MarketplaceOrderState => Object.prototype.hasOwnProperty.call(DEFAULT_MAPPING, String(value));

function mappingRow(tenant: string) {
  return store.rowsOf(tenant, MARKETPLACE_STATUS_ENTITY).find((candidate) => candidate.status === 'Active');
}

function normalizeMapping(value: unknown): CustomerStatusMapping {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const mapping = { ...DEFAULT_MAPPING };
  for (const state of Object.keys(DEFAULT_MAPPING) as MarketplaceOrderState[]) {
    if (input[state] !== undefined && isCustomerStatus(input[state])) mapping[state] = input[state];
  }
  return mapping;
}

export function customerStatusMapping(tenant: string) {
  const row = mappingRow(tenant);
  const data = row?.data || {};
  return {
    version: Number(data.version || 1),
    mapping: normalizeMapping(data.mapping),
    updatedAt: text(data.updatedAt, 40) || undefined,
    updatedBy: text(data.updatedBy, 160) || undefined,
    source: row ? 'store-configured' as const : 'system-default' as const,
  };
}

export function saveCustomerStatusMapping(tenant: string, actor: string, input: Record<string, unknown>) {
  const invalid = Object.entries(input).find(([state, value]) => !isMarketplaceState(state) || !isCustomerStatus(value));
  if (invalid) throw new Error('CUSTOMER_STATUS_MAPPING_INVALID');
  const previous = mappingRow(tenant);
  const timestamp = now();
  const data = { version: Number(previous?.data.version || 1) + 1, mapping: normalizeMapping({ ...customerStatusMapping(tenant).mapping, ...input }), updatedAt: timestamp, updatedBy: actor, immutableHistory: true };
  const row: EntityRow = previous
    ? { ...previous, version: previous.version + 1, updated_at: timestamp, data }
    : { id: `mcs_mapping_${store.currentStore(tenant)}_${randomUUID()}`, entity: MARKETPLACE_STATUS_ENTITY, tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data };
  if (previous) store.updateRow(row); else store.insertRow(row);
  audit(tenant, actor, 'marketplace:customer-status-mapping-updated', { entity: MARKETPLACE_STATUS_ENTITY, row_id: row.id, after: { version: data.version, mapping: data.mapping } });
  return customerStatusMapping(tenant);
}

type TimelineEvent = { eventId: string; at: string; status: CustomerFacingStatus; label: string; source: 'marketplace' | 'store' | 'customer-approval' };

function addEvent(events: TimelineEvent[], eventId: string, at: unknown, status: CustomerFacingStatus, source: TimelineEvent['source']) {
  const timestamp = text(at, 40);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return;
  events.push({ eventId: text(eventId, 200) || `status_${randomUUID()}`, at: timestamp, status, label: LABELS[status], source });
}

function projectionFor(tenant: string, externalOrderId: string) {
  return store.listMarketplaceOrderProjections(tenant).find((candidate) => candidate.externalOrderId === externalOrderId);
}

function deriveTimeline(tenant: string, externalOrderId: string, mapping: CustomerStatusMapping) {
  const truth = marketplaceOrderTruth(tenant, externalOrderId);
  const projection = projectionFor(tenant, externalOrderId);
  const events: TimelineEvent[] = [];
  const audits = store.auditOf(tenant);
  const request = truth.request;
  if (request) addEvent(events, `request:${request.id}`, request.data.requestedAt || request.created_at, mapping.AwaitingAcceptance, 'marketplace');
  for (const entry of audits) {
    if (entry.action === 'marketplace:order-projected' && entry.row_id === projection?.id) {
      const state = entry.after && typeof entry.after === 'object' ? (entry.after as Record<string, unknown>).state : undefined;
      if (isMarketplaceState(state)) addEvent(events, entry.id, entry.ts, mapping[state], 'marketplace');
    }
    if (entry.action === 'marketplace:order-accepted' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) addEvent(events, entry.id, entry.ts, mapping.Accepted, 'marketplace');
    if (entry.action === 'marketplace:order-rejected' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) addEvent(events, entry.id, entry.ts, mapping.Rejected, 'marketplace');
    if (entry.action === 'marketplace:intake-assessed' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) addEvent(events, entry.id, entry.ts, mapping.IntakeRequired, 'store');
    if (entry.action === 'marketplace:pickup-scheduled' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) addEvent(events, entry.id, entry.ts, mapping.PickupScheduled, 'store');
    if (entry.action === 'marketplace:pickup-collected' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) addEvent(events, entry.id, entry.ts, mapping.IntakeRequired, 'store');
    if (entry.action === 'marketplace:pickup-cancelled' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) addEvent(events, entry.id, entry.ts, mapping.Cancelled, 'store');
    if (entry.action === 'marketplace:reassessment-created' && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) {
      const state = String((entry.after as Record<string, unknown>).state || 'PendingApproval');
      addEvent(events, entry.id, entry.ts, state === 'PendingApproval' ? 'ApprovalRequired' : mapping.IntakeRequired, 'customer-approval');
    }
    if ((entry.action === 'marketplace:reassessment-approved' || entry.action === 'marketplace:reassessment-rejected') && entry.after && typeof entry.after === 'object' && (entry.after as Record<string, unknown>).externalOrderId === externalOrderId) {
      const state = entry.action.endsWith('approved') ? 'Received' : 'Cancelled';
      addEvent(events, entry.id, entry.ts, state, 'customer-approval');
    }
    if (entry.action === 'laundry:transition' && entry.entity === 'laundry_order' && truth.request && projection?.localOrderId === entry.row_id) {
      const after = entry.after && typeof entry.after === 'object' ? entry.after as Record<string, unknown> : {};
      const localStatus = LOCAL_STATUS_MAP[String(after.state || '')];
      if (localStatus) addEvent(events, entry.id, entry.ts, localStatus, 'store');
    }
  }
  const deduped = new Map<string, TimelineEvent>();
  for (const event of events) deduped.set(`${event.at}|${event.status}`, event);
  return [...deduped.values()].sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId));
}

export function customerFacingOrderStatus(tenant: string, externalOrderId: string) {
  const id = text(externalOrderId, 160);
  if (!id) throw new Error('external order ID is required');
  const projection = projectionFor(tenant, id);
  const truth = marketplaceOrderTruth(tenant, id);
  if (!projection && !truth.request) throw new Error('marketplace order not found');
  const config = customerStatusMapping(tenant);
  const latestReassessment = truth.reassessments.at(-1);
  const pendingApproval = latestReassessment?.data.state === 'PendingApproval';
  const local = projection?.localOrderId ? store.getRow(tenant, projection.localOrderId) : undefined;
  const localState = local?.entity === 'laundry_order' ? LOCAL_STATUS_MAP[String(local.data.state || '')] : undefined;
  const pickupTask = store.rowsOf(tenant, 'marketplace_pickup_task').find((candidate) => candidate.status === 'Active' && candidate.data.externalOrderId === id);
  const pickupState = String(pickupTask?.data.state || '');
  const pickupStatus = pickupState === 'Collected' ? config.mapping.IntakeRequired : ['Scheduled', 'Assigned', 'Failed'].includes(pickupState) ? config.mapping.PickupScheduled : pickupState === 'Cancelled' ? config.mapping.Cancelled : undefined;
  const currentStatus = pendingApproval ? 'ApprovalRequired' : pickupStatus || localState || (projection ? config.mapping[projection.state] : undefined);
  if (!currentStatus) throw new Error('CUSTOMER_STATUS_NOT_AVAILABLE');
  return {
    externalOrderId: id,
    channel: projection?.channel || String(truth.request?.data.channel || 'UNKNOWN'),
    status: currentStatus,
    label: LABELS[currentStatus],
    evidence: { projectionVersion: projection?.sourceVersion, localOrderId: local?.id, reassessmentId: latestReassessment?.id, timelineDerivedFromEvents: true },
    timeline: deriveTimeline(tenant, id, config.mapping),
    mappingVersion: config.version,
  };
}
