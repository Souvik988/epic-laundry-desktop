import { randomUUID } from 'node:crypto';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';

export type TaxPolicyStatus = 'Draft' | 'Approved' | 'Retired';
export type TaxPolicyRule = { id: string; classificationType: 'SAC' | 'HSN'; classificationCode: string; description: string; supplyType: 'Service' | 'Product'; rateBps: number; validFrom: string; validTo?: string; sourceNote: string; version: string; approvalStatus: TaxPolicyStatus; approvedBy?: string; approvedAt?: string; createdAt: string };
export type SupplierTaxProfileRecord = { id: string; legalName: string; tradeName?: string; address: string; stateCode: string; pincode: string; registrationStatus: 'Registered' | 'Unregistered'; gstin?: string; invoiceSeries?: string; einvoiceState: 'NotApplicable' | 'NotConfigured' | 'Sandbox' | 'Ready' | 'Pending' | 'Generated' | 'Failed' | 'Cancelled' | 'TimeRestricted'; updatedAt: string; updatedBy: string };

const dateOnly = (value: unknown, label: string) => { const text = String(value || '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) throw new Error(`${label} must be a valid date`); return text; };
const text = (value: unknown, label: string, max: number, minimum = 1) => { const result = String(value || '').trim(); if (result.length < minimum || result.length > max) throw new Error(`${label} is invalid`); return result; };
function rangeOverlaps(a: TaxPolicyRule, b: TaxPolicyRule) { const aEnd = a.validTo || '9999-12-31'; const bEnd = b.validTo || '9999-12-31'; return a.validFrom <= bEnd && b.validFrom <= aEnd; }
function fromRow(row: EntityRow): TaxPolicyRule { return row.data as unknown as TaxPolicyRule; }
function profileFromRow(row: EntityRow): SupplierTaxProfileRecord { return row.data as unknown as SupplierTaxProfileRecord; }

function normalizeRule(input: Partial<TaxPolicyRule>): Omit<TaxPolicyRule, 'id' | 'createdAt' | 'approvalStatus' | 'approvedBy' | 'approvedAt'> {
  const classificationType = input.classificationType;
  const classificationCode = text(input.classificationCode, 'classification code', 20);
  const rateBps = Number(input.rateBps);
  if (!['SAC', 'HSN'].includes(String(classificationType)) || !/^[A-Za-z0-9.-]{2,20}$/.test(classificationCode) || !['Service', 'Product'].includes(String(input.supplyType)) || !Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new Error('TAX_CLASSIFICATION_MISSING');
  const validFrom = dateOnly(input.validFrom, 'validFrom'); const validTo = input.validTo ? dateOnly(input.validTo, 'validTo') : undefined; if (validTo && validTo < validFrom) throw new Error('tax rule validity range is invalid');
  return { classificationType: classificationType as 'SAC' | 'HSN', classificationCode, description: text(input.description, 'description', 240), supplyType: input.supplyType as 'Service' | 'Product', rateBps, validFrom, validTo, sourceNote: text(input.sourceNote, 'source note', 1_000, 3), version: text(input.version, 'version', 80) };
}

export function listTaxPolicyRules(tenant: string, asOf?: string) {
  const date = asOf ? dateOnly(asOf, 'asOf') : undefined;
  return store.rowsOf(tenant, 'tax_policy_rule').map(fromRow).filter((rule) => !date || (rule.validFrom <= date && (!rule.validTo || rule.validTo >= date))).sort((a, b) => `${b.validFrom}:${b.classificationCode}:${b.version}`.localeCompare(`${a.validFrom}:${a.classificationCode}:${a.version}`));
}
export function createTaxPolicyRule(tenant: string, actor: string, input: Partial<TaxPolicyRule>) {
  const normalized = normalizeRule(input); const existing = store.rowsOf(tenant, 'tax_policy_rule').map(fromRow).filter((rule) => rule.approvalStatus !== 'Retired' && rule.classificationType === normalized.classificationType && rule.classificationCode === normalized.classificationCode && rule.supplyType === normalized.supplyType);
  if (existing.some((rule) => rangeOverlaps(rule, normalized as TaxPolicyRule))) throw new Error('TAX_RULE_OVERLAP');
  const timestamp = new Date().toISOString(); const rule: TaxPolicyRule = { ...normalized, id: `tax_policy_${randomUUID()}`, approvalStatus: 'Draft', createdAt: timestamp };
  const row: EntityRow = { id: rule.id, entity: 'tax_policy_rule', tenant, status: 'Draft', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: rule }; store.insertRow(row); audit(tenant, actor, 'gst:tax-policy-rule-created', { entity: row.entity, row_id: row.id, after: rule }); return row;
}
export function approveTaxPolicyRule(tenant: string, actor: string, id: string) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'tax_policy_rule') throw new Error('tax policy rule not found'); const rule = fromRow(row); if (rule.approvalStatus === 'Retired') throw new Error('retired tax policy rule cannot be approved');
  const competing = store.rowsOf(tenant, 'tax_policy_rule').map(fromRow).filter((candidate) => candidate.id !== id && candidate.approvalStatus === 'Approved' && candidate.classificationType === rule.classificationType && candidate.classificationCode === rule.classificationCode && candidate.supplyType === rule.supplyType);
  if (competing.some((candidate) => rangeOverlaps(candidate, rule))) throw new Error('TAX_RULE_OVERLAP');
  const timestamp = new Date().toISOString(); row.data = { ...rule, approvalStatus: 'Approved', approvedBy: actor, approvedAt: timestamp }; row.status = 'Approved'; row.version += 1; row.updated_at = timestamp; store.updateRow(row); audit(tenant, actor, 'gst:tax-policy-rule-approved', { entity: row.entity, row_id: row.id, after: row.data }); return row;
}
export function retireTaxPolicyRule(tenant: string, actor: string, id: string) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'tax_policy_rule') throw new Error('tax policy rule not found'); const timestamp = new Date().toISOString(); row.data = { ...fromRow(row), approvalStatus: 'Retired', retiredBy: actor, retiredAt: timestamp }; row.status = 'Retired'; row.version += 1; row.updated_at = timestamp; store.updateRow(row); audit(tenant, actor, 'gst:tax-policy-rule-retired', { entity: row.entity, row_id: row.id, after: { approvalStatus: 'Retired' } }); return row;
}
export function resolveTaxPolicyRule(tenant: string, input: { classificationType: 'SAC' | 'HSN'; classificationCode: string; supplyType: 'Service' | 'Product'; asOf?: string }) {
  const candidates = listTaxPolicyRules(tenant, input.asOf).filter((rule) => rule.approvalStatus === 'Approved' && rule.classificationType === input.classificationType && rule.classificationCode === input.classificationCode && rule.supplyType === input.supplyType); if (candidates.length > 1) throw new Error('TAX_RULE_AMBIGUITY'); return candidates[0];
}

function normalizeProfile(input: Partial<SupplierTaxProfileRecord>) {
  const registrationStatus = input.registrationStatus;
  const legalName = text(input.legalName, 'legal name', 240); const address = text(input.address, 'address', 1_000); const stateCode = text(input.stateCode, 'state code', 2); const pincode = text(input.pincode, 'pincode', 6); const gstin = input.gstin ? String(input.gstin).trim().toUpperCase() : undefined;
  if (!/^\d{2}$/.test(stateCode) || !/^\d{6}$/.test(pincode) || !['Registered', 'Unregistered'].includes(String(registrationStatus)) || (registrationStatus === 'Registered' && !/^\d{2}[A-Z0-9]{13}$/.test(gstin || ''))) throw new Error('TAX_PROFILE_INCOMPLETE');
  const einvoiceState = input.einvoiceState || 'NotConfigured'; if (!['NotApplicable', 'NotConfigured', 'Sandbox', 'Ready', 'Pending', 'Generated', 'Failed', 'Cancelled', 'TimeRestricted'].includes(einvoiceState)) throw new Error('EINVOICE_STATE_INVALID');
  return { legalName, tradeName: input.tradeName ? String(input.tradeName).trim().slice(0, 240) : undefined, address, stateCode, pincode, registrationStatus: registrationStatus as 'Registered' | 'Unregistered', gstin, invoiceSeries: input.invoiceSeries ? String(input.invoiceSeries).trim().slice(0, 80) : undefined, einvoiceState };
}
export function supplierTaxProfile(tenant: string) { const row = store.rowsOf(tenant, 'supplier_tax_profile')[0]; return row ? profileFromRow(row) : undefined; }
export function saveSupplierTaxProfile(tenant: string, actor: string, input: Partial<SupplierTaxProfileRecord>) {
  const normalized = normalizeProfile(input); const existing = store.rowsOf(tenant, 'supplier_tax_profile')[0]; const timestamp = new Date().toISOString(); const record: SupplierTaxProfileRecord = { id: existing?.id || `supplier_tax_profile_${store.currentStore(tenant)}`, ...normalized, updatedAt: timestamp, updatedBy: actor }; const row: EntityRow = existing ? { ...existing, status: 'Active', version: existing.version + 1, updated_at: timestamp, data: record } : { id: record.id, entity: 'supplier_tax_profile', tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: record }; store.updateRow(row); audit(tenant, actor, 'gst:supplier-tax-profile-saved', { entity: row.entity, row_id: row.id, after: { legalName: record.legalName, stateCode: record.stateCode, registrationStatus: record.registrationStatus, gstinPresent: Boolean(record.gstin), einvoiceState: record.einvoiceState } }); return row;
}
export function taxReadiness(tenant: string) { const profile = supplierTaxProfile(tenant); if (!profile) return { ready: false, code: 'TAX_PROFILE_INCOMPLETE', profile: null }; return { ready: true, code: null, profile: { ...profile, gstin: profile.gstin ? '[configured]' : undefined } }; }
