import { randomUUID } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { store, type MarketplaceCatalogueApprovalStatus, type MarketplaceCatalogueMappingRecord } from '../../kernel/store.js';

const UNITS = new Set(['Piece', 'Kilogram', 'Pair', 'Square Foot']);
const STATUSES = new Set<MarketplaceCatalogueApprovalStatus>(['Draft', 'PendingReview', 'Approved', 'Rejected', 'Retired']);
const text = (value: unknown, label: string, max: number) => { const result = String(value || '').trim(); if (!result || result.length > max) throw new Error(`${label} is required and must be at most ${max} characters`); return result; };
const date = (value: unknown, label: string) => { const result = text(value, label, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new Error(`${label} must be an ISO date`); return result; };
const integer = (value: unknown, label: string, minimum = 0) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum) throw new Error(`${label} must be an integer >= ${minimum}`); return result; };

export type MarketplaceCatalogueMappingInput = {
  id?: string; vendorId: string; garmentId: string; serviceId: string; marketplaceCategoryId: string; marketplaceServiceId: string;
  publicName: string; publicDescription?: string; pricePaise: number; pricingUnit: string; minQuantityMilli?: number; turnaroundMinutes?: number;
  expressEligible?: boolean; marketplaceVisible?: boolean; version?: number; effectiveFrom: string; effectiveUntil?: string; approvalStatus?: MarketplaceCatalogueApprovalStatus;
};

function ensureLocalActive(tenant: string, id: string, entity: string, label: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== entity || row.data.active === false) throw new Error(`${label} is not an active local catalogue record`);
}

export function saveMarketplaceCatalogueMapping(tenant: string, actor: string, input: MarketplaceCatalogueMappingInput) {
  const vendorId = text(input.vendorId, 'vendor ID', 120); const garmentId = text(input.garmentId, 'garment ID', 160); const serviceId = text(input.serviceId, 'service ID', 160);
  ensureLocalActive(tenant, garmentId, 'laundry_garment', 'garment'); ensureLocalActive(tenant, serviceId, 'laundry_service', 'service');
  const effectiveFrom = date(input.effectiveFrom, 'effective from'); const effectiveUntil = input.effectiveUntil ? date(input.effectiveUntil, 'effective until') : undefined;
  if (effectiveUntil && effectiveUntil <= effectiveFrom) throw new Error('effective until must be after effective from');
  const approvalStatus = input.approvalStatus || 'Draft'; if (!STATUSES.has(approvalStatus)) throw new Error('invalid marketplace catalogue approval status');
  const pricingUnit = text(input.pricingUnit, 'pricing unit', 40); if (!UNITS.has(pricingUnit)) throw new Error('unsupported marketplace pricing unit');
  const now = new Date().toISOString(); const existing = input.id ? store.getMarketplaceCatalogueMapping(tenant, input.id) : undefined;
  if (existing && (existing.vendorId !== vendorId || existing.garmentId !== garmentId || existing.serviceId !== serviceId)) throw new Error('MARKETPLACE_CATALOGUE_ID_COLLISION');
  const record: MarketplaceCatalogueMappingRecord = {
    id: text(input.id || `mcm_${randomUUID()}`, 'mapping ID', 160), tenant, storeId: store.currentStore(tenant), vendorId, garmentId, serviceId,
    marketplaceCategoryId: text(input.marketplaceCategoryId, 'marketplace category ID', 160), marketplaceServiceId: text(input.marketplaceServiceId, 'marketplace service ID', 160),
    publicName: text(input.publicName, 'public name', 240), publicDescription: String(input.publicDescription || '').trim().slice(0, 1000), pricePaise: integer(input.pricePaise, 'price paise'),
    pricingUnit, minQuantityMilli: integer(input.minQuantityMilli ?? 1000, 'minimum quantity', 1), turnaroundMinutes: integer(input.turnaroundMinutes ?? 0, 'turnaround minutes'),
    expressEligible: input.expressEligible === true, marketplaceVisible: input.marketplaceVisible === true, version: integer(input.version ?? (existing?.version || 1), 'version', 1), effectiveFrom, effectiveUntil,
    approvalStatus, createdAt: existing?.createdAt || now, updatedAt: now, updatedBy: actor,
  };
  const saved = store.saveMarketplaceCatalogueMapping(record);
  audit(tenant, actor, existing ? 'marketplace:catalogue-mapping-updated' : 'marketplace:catalogue-mapping-created', { entity: 'marketplace_catalogue_mapping', row_id: saved.id, after: { vendorId, garmentId, serviceId, marketplaceCategoryId: saved.marketplaceCategoryId, marketplaceServiceId: saved.marketplaceServiceId, version: saved.version, approvalStatus: saved.approvalStatus, marketplaceVisible: saved.marketplaceVisible } });
  return saved;
}

export function listMarketplaceCatalogueMappings(tenant: string, options: { vendorId?: string; visibleOnly?: boolean } = {}) {
  return store.listMarketplaceCatalogueMappings(tenant, options);
}
