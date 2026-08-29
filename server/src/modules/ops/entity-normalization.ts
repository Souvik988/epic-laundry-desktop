import { createHash, randomUUID } from 'node:crypto';
import { parseMoney } from '../../kernel/money.js';
import { store, type CompatibilityMigrationRun, type NormalizedCustomerRecord, type NormalizedOrderItemRecord, type NormalizedOrderRecord } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';

export const ENTITY_NORMALIZATION_ENTITIES = ['party', 'laundry_order'] as const;
export type EntityNormalizationEntity = typeof ENTITY_NORMALIZATION_ENTITIES[number];

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const hash = (value: unknown) => createHash('sha256').update(stable(value), 'utf8').digest('hex');
const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const asText = (value: unknown, max = 2000) => String(value ?? '').trim().slice(0, max);
const quantityMilli = (value: unknown) => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('quantity must be positive');
  const scaled = Math.round(quantity * 1000);
  if (!Number.isSafeInteger(scaled) || scaled <= 0 || Math.abs(quantity - scaled / 1000) > 0.000001) throw new Error('quantity exceeds the supported 0.001 precision');
  return scaled;
};

function sourceRows(tenant: string, entity: EntityNormalizationEntity) {
  return store.rowsOf(tenant, entity).filter((row) => entity !== 'party' || row.data.is_customer === true).sort((a, b) => a.id.localeCompare(b.id));
}
function sourceFingerprint(rows: EntityRow[]) {
  return hash(rows.map((row) => ({ id: row.id, version: row.version, updatedAt: row.updated_at })));
}
function customerProjection(row: EntityRow): NormalizedCustomerRecord {
  const name = asText(row.data.name, 160);
  const phone = digits(row.data.phone);
  if (!name) throw new Error('customer name is missing');
  if (phone.length < 6 || phone.length > 15) throw new Error('customer phone is invalid');
  const projection = {
    id: row.id, tenant: row.tenant, storeId: store.currentStore(row.tenant), name, phone,
    email: asText(row.data.email, 240), address: asText(row.data.address, 500), notes: asText(row.data.notes, 2000),
    preferredContact: asText(row.data.preferred_contact || 'Phone', 40), servicePreferences: asText(row.data.service_preferences, 500),
    marketingConsent: row.data.marketing_consent === true, sourceVersion: row.version, sourceUpdatedAt: row.updated_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  } satisfies Omit<NormalizedCustomerRecord, 'sourceHash'>;
  return { ...projection, sourceHash: hash(projection) };
}
function orderProjection(row: EntityRow, customers: Set<string>): NormalizedOrderRecord {
  const customerId = asText(row.data.customer, 120);
  if (!customerId || !customers.has(customerId)) throw new Error('order references a customer that is not normalized');
  const items = Array.isArray(row.data.items) ? row.data.items : [];
  if (!items.length) throw new Error('order has no items');
  const projectedItems: NormalizedOrderItemRecord[] = items.map((raw: any, itemIndex: number) => {
    const garmentId = asText(raw?.garment, 160); const serviceId = asText(raw?.service, 160); const unit = asText(raw?.unit || 'Piece', 40);
    if (!garmentId || !serviceId) throw new Error(`order item ${itemIndex + 1} is missing garment or service`);
    const qty = quantityMilli(raw?.qty);
    const ratePaise = parseMoney(raw?.rate ?? 0, `order item ${itemIndex + 1} rate`, { allowZero: true });
    const amountPaise = parseMoney(raw?.amount ?? (qty / 1000) * (ratePaise / 100), `order item ${itemIndex + 1} amount`, { allowZero: true });
    const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { id: `${row.id}:item:${itemIndex}`, tenant: row.tenant, storeId: store.currentStore(row.tenant), orderId: row.id, itemIndex, garmentId, serviceId, unit, quantityMilli: qty, ratePaise, amountPaise, data };
  });
  const grandTotalPaise = parseMoney(row.data.grand_total ?? 0, `order ${row.id} total`, { allowZero: true });
  const projection = {
    id: row.id, tenant: row.tenant, storeId: store.currentStore(row.tenant), customerId, orderNumber: asText(row.data.name || row.id, 120),
    state: asText(row.data.state || row.status, 60), orderDate: asText(row.data.order_date || row.created_at, 40), expectedDeliveryDate: asText(row.data.expected_delivery_date || '', 40),
    fulfillmentMode: asText(row.data.fulfillment_mode || '', 80), grandTotalPaise, paymentStatus: asText(row.data.payment_status || 'Unpaid', 40), data: row.data,
    sourceVersion: row.version, sourceUpdatedAt: row.updated_at, createdAt: row.created_at, updatedAt: row.updated_at, items: projectedItems,
  } satisfies Omit<NormalizedOrderRecord, 'sourceHash'>;
  return { ...projection, sourceHash: hash(projection) };
}

function emptyRun(tenant: string, entity: EntityNormalizationEntity, actor: string, total: number, fingerprint: string): CompatibilityMigrationRun {
  const now = new Date().toISOString();
  return { id: `compat:${entity}:${randomUUID()}`, tenant, storeId: store.currentStore(tenant), entity, status: 'running', cursor: 0, total, applied: 0, invalid: 0, conflicts: 0, sourceHash: fingerprint, actor, startedAt: now, updatedAt: now };
}

export function previewEntityNormalization(tenant: string, entity: EntityNormalizationEntity) {
  const rows = sourceRows(tenant, entity);
  const fingerprint = sourceFingerprint(rows);
  const customers = new Set(store.listNormalizedCustomers(tenant).map((customer) => customer.id));
  const issues: Array<{ sourceId: string; message: string }> = [];
  const sourceHashes = new Set<string>();
  const phoneOwners = new Map<string, string>();
  let valid = 0;
  for (const row of rows) {
    try {
      const projection = entity === 'party' ? customerProjection(row) : orderProjection(row, customers);
      if (sourceHashes.has(projection.sourceHash)) throw new Error('duplicate source projection hash');
      sourceHashes.add(projection.sourceHash);
      if (entity === 'party') {
        const customer = projection as NormalizedCustomerRecord;
        const prior = phoneOwners.get(customer.phone);
        if (prior && prior !== projection.id) throw new Error(`duplicate customer phone conflicts with ${prior}`);
        phoneOwners.set(customer.phone, customer.id);
      }
      valid += 1;
    } catch (error: any) { issues.push({ sourceId: row.id, message: String(error?.message || 'invalid source row') }); }
  }
  const normalizedCount = entity === 'party' ? store.listNormalizedCustomers(tenant).length : store.listNormalizedOrders(tenant).length;
  const latest = store.latestCompatibilityMigrationRun(tenant, entity);
  return { format: 'epic-laundry-entity-normalization-preview', version: 1, entity, sourceCount: rows.length, normalizedCount, valid, invalid: issues.length, issues: issues.slice(0, 200), sourceHash: fingerprint, latestRun: latest, readyToApply: issues.length === 0 && (!latest || latest.sourceHash === fingerprint || latest.status !== 'running') };
}

export function applyEntityNormalization(tenant: string, actor: string, entity: EntityNormalizationEntity, requestedBatchSize = 250) {
  const batchSize = Math.max(1, Math.min(1000, Math.trunc(Number(requestedBatchSize) || 250)));
  return store.transaction(() => {
    const rows = sourceRows(tenant, entity);
    const fingerprint = sourceFingerprint(rows);
    let run = store.latestCompatibilityMigrationRun(tenant, entity);
    if (run && run.status === 'completed' && run.sourceHash === fingerprint) return { ...run, done: true };
    if (!run || run.status !== 'running' || run.sourceHash !== fingerprint) { run = emptyRun(tenant, entity, actor, rows.length, fingerprint); store.appendCompatibilityMigrationRun(run); }
    if (run.cursor > rows.length) throw new Error('compatibility migration cursor is beyond the current source set');
    if (run.status === 'completed') return { ...run, done: true };
    const normalizedCustomers = new Set(store.listNormalizedCustomers(tenant).map((customer) => customer.id));
    const existing = new Map((entity === 'party' ? store.listNormalizedCustomers(tenant) : store.listNormalizedOrders(tenant)).map((row) => [row.id, row]));
    const end = Math.min(rows.length, run.cursor + batchSize);
    for (let index = run.cursor; index < end; index += 1) {
      const row = rows[index];
      try {
        const projection = entity === 'party' ? customerProjection(row) : orderProjection(row, normalizedCustomers);
        const prior = existing.get(projection.id) as any;
        if (!prior || prior.sourceHash !== projection.sourceHash) {
          if (entity === 'party') { store.upsertNormalizedCustomer(projection as NormalizedCustomerRecord); normalizedCustomers.add(projection.id); }
          else store.upsertNormalizedOrder(projection as NormalizedOrderRecord);
          run.applied += 1;
        }
      } catch (error: any) { run.invalid += 1; }
      run.cursor = index + 1;
    }
    if (run.cursor >= rows.length) { run.status = run.invalid === 0 && run.conflicts === 0 ? 'completed' : 'failed'; run.completedAt = new Date().toISOString(); }
    run.updatedAt = new Date().toISOString();
    if (run.status === 'failed') run.error = 'one or more source rows failed validation; resolve source data and start a new run';
    store.updateCompatibilityMigrationRun(run);
    audit(tenant, actor, 'ops:entity-normalization', { after: { runId: run.id, entity, cursor: run.cursor, total: run.total, applied: run.applied, invalid: run.invalid, status: run.status } });
    return { ...run, done: run.status === 'completed' };
  });
}
