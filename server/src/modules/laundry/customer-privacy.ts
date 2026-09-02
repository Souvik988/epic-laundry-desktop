import { createHash, randomUUID } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { customerProfile, updateLaundryCustomer, type CustomerInput } from './customers.js';

export type CustomerPrivacyRequestType = 'Export' | 'Correction' | 'Erasure';
export type CustomerPrivacyRequestState = 'Open' | 'Completed' | 'Rejected';
type PrivacyRequest = { id: string; customerId: string; type: CustomerPrivacyRequestType; state: CustomerPrivacyRequestState; details: Record<string, unknown>; requestedBy: string; requestedAt: string; completedAt?: string; outcome?: string };

const ENTITY = 'customer_privacy_request';
const now = () => new Date().toISOString();
const text = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);
const requestTypes: CustomerPrivacyRequestType[] = ['Export', 'Correction', 'Erasure'];
const requestStates: CustomerPrivacyRequestState[] = ['Open', 'Completed', 'Rejected'];

function customer(tenant: string, id: string) {
  const row = store.getRow(tenant, text(id, 160));
  if (!row || row.entity !== 'party' || !row.data.is_customer) throw new Error('customer not found');
  return row;
}
function requestFromRow(row: EntityRow): PrivacyRequest {
  return { id: row.id, customerId: text(row.data.customerId, 160), type: text(row.data.type, 30) as CustomerPrivacyRequestType, state: text(row.data.state, 30) as CustomerPrivacyRequestState, details: row.data.details && typeof row.data.details === 'object' ? row.data.details as Record<string, unknown> : {}, requestedBy: text(row.data.requestedBy, 160), requestedAt: text(row.data.requestedAt, 40) || row.created_at, completedAt: text(row.data.completedAt, 40) || undefined, outcome: text(row.data.outcome, 500) || undefined };
}
function requestRow(tenant: string, id: string) {
  const row = store.getRow(tenant, text(id, 160));
  if (!row || row.entity !== ENTITY) throw new Error('PRIVACY_REQUEST_NOT_FOUND');
  return row;
}

export function createCustomerPrivacyRequest(tenant: string, actor: string, input: { customerId: string; type: CustomerPrivacyRequestType; details?: Record<string, unknown> }) {
  customer(tenant, input.customerId);
  if (!requestTypes.includes(input.type)) throw new Error('PRIVACY_REQUEST_TYPE_INVALID');
  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details) ? structuredClone(input.details) : {};
  if (input.type === 'Correction' && !Object.keys(details).length) throw new Error('PRIVACY_CORRECTION_REQUIRED');
  const existing = store.rowsOf(tenant, ENTITY).find((row) => row.data.customerId === input.customerId && row.data.type === input.type && row.data.state === 'Open');
  if (existing) return requestFromRow(existing);
  const timestamp = now();
  const row: EntityRow = { id: `privacy_${randomUUID()}`, entity: ENTITY, tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { customerId: text(input.customerId, 160), type: input.type, state: 'Open', details, requestedBy: actor, requestedAt: timestamp, immutableRequest: true } };
  store.insertRow(row);
  audit(tenant, actor, 'privacy:request-opened', { entity: ENTITY, row_id: row.id, after: { customerId: row.data.customerId, type: input.type, state: 'Open' } });
  return requestFromRow(row);
}

export function listCustomerPrivacyRequests(tenant: string, customerId?: string) {
  const filter = text(customerId, 160);
  return store.rowsOf(tenant, ENTITY).map(requestFromRow).filter((request) => !filter || request.customerId === filter).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function exportCustomerPrivacyData(tenant: string, actor: string, customerId: string) {
  customer(tenant, customerId);
  const profile = customerProfile(tenant, customerId);
  const exportId = `privacy_export_${randomUUID()}`;
  const checksum = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  audit(tenant, actor, 'privacy:customer-exported', { entity: 'party', row_id: customerId, after: { exportId, checksum, purpose: 'data-access-request' } });
  return { exportId, exportedAt: now(), checksum, scope: 'local-vendor-store', data: profile };
}

function activeOrders(tenant: string, customerId: string) {
  return store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.customer === customerId && !['Delivered', 'Cancelled'].includes(String(row.data.state || '')));
}

function scrubCustomer(tenant: string, actor: string, customerId: string) {
  const row = customer(tenant, customerId);
  const beforeHash = createHash('sha256').update(JSON.stringify(row.data)).digest('hex');
  row.data = { ...row.data, name: '[Redacted Customer]', phone: '', email: '', address: '', notes: '', service_preferences: '', preferred_contact: 'None', marketing_consent: false, marketing_consent_at: null, marketing_consent_by: null, privacy_state: 'Erased', privacy_erased_at: now() };
  row.updated_at = now();
  store.updateRow(row);
  for (const address of store.listCustomerAddresses(tenant, customerId).filter((entry) => entry.active)) store.archiveCustomerAddress(tenant, customerId, address.id);
  for (const order of store.rowsOf(tenant, 'laundry_order').filter((candidate) => candidate.data.customer === customerId)) {
    const externalId = text(order.data.external_order_id, 160);
    if (!externalId) continue;
    const projection = store.listMarketplaceOrderProjections(tenant).find((candidate) => candidate.externalOrderId === externalId && candidate.localOrderId === order.id);
    if (projection && ['Completed', 'Cancelled', 'Rejected', 'Expired'].includes(projection.state)) store.saveMarketplaceOrderProjection({ ...projection, customer: {}, pickup: {}, updatedAt: now() });
  }
  audit(tenant, actor, 'privacy:customer-erased', { entity: 'party', row_id: customerId, after: { beforeHash, retainedReferences: true, accountingRowsPreserved: true } });
}

export function completeCustomerPrivacyRequest(tenant: string, actor: string, requestId: string, input: { legalHold?: boolean; outcome?: string }) {
  return store.transaction(() => {
    const row = requestRow(tenant, requestId);
    const request = requestFromRow(row);
    if (!requestStates.includes(request.state)) throw new Error('PRIVACY_REQUEST_STATE_INVALID');
    if (request.state !== 'Open') return request;
    const legalHold = input.legalHold === true;
    const holdReason = text(input.outcome, 500);
    if (request.type === 'Erasure') {
      const active = activeOrders(tenant, request.customerId);
      if (legalHold || active.length) {
        const outcome = legalHold ? holdReason || 'Legal hold prevents erasure.' : 'Active operational relationship prevents erasure until the order lifecycle is complete.';
        row.data = { ...row.data, state: 'Rejected', outcome, completedAt: now() }; row.version += 1; row.updated_at = now(); store.updateRow(row);
        audit(tenant, actor, 'privacy:erasure-rejected', { entity: ENTITY, row_id: row.id, after: { customerId: request.customerId, reason: outcome, activeOrderCount: active.length, legalHold } });
        return requestFromRow(row);
      }
      scrubCustomer(tenant, actor, request.customerId);
    } else if (request.type === 'Correction') {
      const details = request.details as Partial<CustomerInput>;
      updateLaundryCustomer(tenant, actor, request.customerId, details);
    }
    const outcome = request.type === 'Export' ? 'Exported through the controlled data-access endpoint.' : request.type === 'Correction' ? 'Correction applied to the local vendor customer profile.' : 'Personal fields redacted; accounting and operational references retained.';
    row.data = { ...row.data, state: 'Completed', outcome, completedAt: now() }; row.version += 1; row.updated_at = now(); store.updateRow(row);
    audit(tenant, actor, 'privacy:request-completed', { entity: ENTITY, row_id: row.id, after: { customerId: request.customerId, type: request.type, state: 'Completed', outcome } });
    return requestFromRow(row);
  });
}
