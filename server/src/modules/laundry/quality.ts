import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import { scanLaundryGarment } from './domain.js';

export const QUALITY_CATEGORIES = ['Stain', 'Damage', 'Missing', 'Rewash', 'Other'] as const;
export const QUALITY_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const QUALITY_STATUSES = ['Open', 'Under Review', 'Resolved', 'Rejected'] as const;
export const QUALITY_DECISIONS = ['Rewash', 'Damaged', 'Missing', 'Release', 'Reject'] as const;
type QualityCategory = typeof QUALITY_CATEGORIES[number];
type QualitySeverity = typeof QUALITY_SEVERITIES[number];
type QualityDecision = typeof QUALITY_DECISIONS[number];

function text(value: unknown, max: number) { return String(value || '').trim().slice(0, max); }

function correctionFor(tenant: string, claimId: string) {
  return store.rowsOf(tenant, 'laundry_customer_correction').find((row) => row.data.claim === claimId);
}

function customerMessage(decision: QualityDecision) {
  const base: Record<QualityDecision, string> = {
    Rewash: 'Our quality team identified an issue and has sent this garment back for rewash before release.',
    Damaged: 'Our quality team recorded a damage exception for this garment and will contact you with the next resolution step.',
    Missing: 'Our quality team recorded that this garment could not be located and will contact you with the next resolution step.',
    Release: 'Our quality team completed its review and released this garment for the next fulfilment step.',
    Reject: 'Our quality team reviewed this claim and closed it without changing the garment lifecycle.',
  };
  return base[decision];
}

function issueCustomerCorrection(tenant: string, actor: string, claim: ReturnType<typeof store.rowsOf>[number], unit: NonNullable<ReturnType<typeof store.getGarmentUnit>>, decision: QualityDecision, note: string) {
  const existing = correctionFor(tenant, claim.id);
  if (existing) return existing;
  if (!unit.customerId) throw new Error('garment unit has no customer for correction document');
  const now = new Date().toISOString();
  const summary = `Quality exception ${claim.data.category || 'Other'} resolved as ${decision}`;
  const row = createRow(tenant, actor, 'laundry_customer_correction', {
    customer: unit.customerId, order: unit.orderId, claim: claim.id, garment_unit: unit.id,
    decision, status: 'Issued', summary, customer_message: customerMessage(decision), issued_at: now, issued_by: actor,
  });
  audit(tenant, actor, 'laundry:customer-correction-issued', { entity: row.entity, row_id: row.id, after: { claimId: claim.id, orderId: unit.orderId, garmentUnitId: unit.id, decision, status: 'Issued' } });
  return row;
}

function presentClaim(tenant: string, row: ReturnType<typeof store.rowsOf>[number]) {
  const unit = store.getGarmentUnit(tenant, text(row.data.garment_unit, 120));
  const order = unit ? store.getRow(tenant, unit.orderId) : undefined;
  const garment = unit ? store.getRow(tenant, unit.garmentId) : undefined;
  const correction = correctionFor(tenant, row.id);
  return {
    id: row.id, unitId: text(row.data.garment_unit, 120), tagCode: unit?.activeTagCode || '', orderId: text(row.data.order, 120),
    orderNumber: order?.data.name || unit?.orderId || '', garment: garment?.data.name || unit?.garmentId || '', state: unit?.state || '',
    category: text(row.data.category, 40), severity: text(row.data.severity, 20), status: text(row.data.status, 30),
    description: text(row.data.description, 1000), openedAt: text(row.data.opened_at, 40), openedBy: text(row.data.opened_by, 160),
    resolvedAt: row.data.resolved_at || null, resolvedBy: row.data.resolved_by || null, decision: row.data.decision || null,
    resolutionNote: row.data.resolution_note || '', createdAt: row.created_at, updatedAt: row.updated_at,
    correction: correction ? { id: correction.id, status: correction.data.status, summary: correction.data.summary, customerMessage: correction.data.customer_message, issuedAt: correction.data.issued_at } : null,
  };
}

export function listQualityClaims(tenant: string, filters: { status?: string; unitId?: string } = {}) {
  return store.rowsOf(tenant, 'laundry_quality_claim')
    .filter((row) => (!filters.status || row.data.status === filters.status) && (!filters.unitId || row.data.garment_unit === filters.unitId))
    .map((row) => presentClaim(tenant, row))
    .sort((a, b) => (['Open', 'Under Review'].includes(a.status) ? 0 : 1) - (['Open', 'Under Review'].includes(b.status) ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
}

export function listCustomerCorrections(tenant: string, filters: { orderId?: string; claimId?: string } = {}) {
  return store.rowsOf(tenant, 'laundry_customer_correction')
    .filter((row) => (!filters.orderId || row.data.order === filters.orderId) && (!filters.claimId || row.data.claim === filters.claimId))
    .map((row) => ({
      id: row.id, customerId: text(row.data.customer, 120), orderId: text(row.data.order, 120), claimId: text(row.data.claim, 120),
      garmentUnitId: text(row.data.garment_unit, 120), decision: text(row.data.decision, 20), status: text(row.data.status, 20),
      summary: text(row.data.summary, 500), customerMessage: text(row.data.customer_message, 1600), issuedAt: text(row.data.issued_at, 40), issuedBy: text(row.data.issued_by, 160),
    }))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/** Derived quality telemetry for the floor dashboard. Counts come only from
 * durable claim/correction rows; no throughput or savings are inferred. */
export function qualityAnalytics(tenant: string) {
  const claims = store.rowsOf(tenant, 'laundry_quality_claim');
  const corrections = store.rowsOf(tenant, 'laundry_customer_correction');
  const byCategory: Record<string, number> = {};
  const byDecision: Record<string, number> = {};
  let resolvedClaims = 0;
  let rejectedClaims = 0;
  let resolutionHoursTotal = 0;
  let resolutionSamples = 0;
  for (const claim of claims) {
    const category = text(claim.data.category, 40) || 'Other';
    byCategory[category] = (byCategory[category] || 0) + 1;
    const decision = text(claim.data.decision, 20);
    if (decision) byDecision[decision] = (byDecision[decision] || 0) + 1;
    if (claim.data.status === 'Resolved' || claim.data.status === 'Rejected') {
      resolvedClaims += 1;
      if (claim.data.status === 'Rejected') rejectedClaims += 1;
      const opened = Date.parse(String(claim.data.opened_at || ''));
      const resolved = Date.parse(String(claim.data.resolved_at || ''));
      if (Number.isFinite(opened) && Number.isFinite(resolved) && resolved >= opened) { resolutionHoursTotal += (resolved - opened) / 3600000; resolutionSamples += 1; }
    }
  }
  const rewashClaims = claims.filter((claim) => claim.data.category === 'Rewash' || claim.data.decision === 'Rewash').length;
  return {
    generatedAt: new Date().toISOString(), totalClaims: claims.length,
    openClaims: claims.filter((claim) => ['Open', 'Under Review'].includes(String(claim.data.status))).length,
    resolvedClaims, rejectedClaims, rewashClaims, correctionDocuments: corrections.length,
    averageResolutionHours: resolutionSamples ? Math.round((resolutionHoursTotal / resolutionSamples) * 10) / 10 : null,
    byCategory, byDecision,
  };
}

export function openQualityClaim(tenant: string, actor: string, input: { garmentUnitId?: string; category?: string; severity?: string; description?: string }) {
  const unitId = text(input.garmentUnitId, 120);
  const unit = store.getGarmentUnit(tenant, unitId);
  if (!unit) throw new Error('garment unit was not found');
  const category = text(input.category, 40) as QualityCategory;
  if (!QUALITY_CATEGORIES.includes(category)) throw new Error('unknown quality claim category');
  const severity = text(input.severity || 'Medium', 20) as QualitySeverity;
  if (!QUALITY_SEVERITIES.includes(severity)) throw new Error('unknown quality claim severity');
  const description = text(input.description, 1000);
  if (description.length < 3) throw new Error('quality claim description is required');
  const existing = store.rowsOf(tenant, 'laundry_quality_claim').find((row) => row.data.garment_unit === unit.id && ['Open', 'Under Review'].includes(String(row.data.status)));
  if (existing) throw new Error('this garment already has an open quality claim');
  const now = new Date().toISOString();
  const row = createRow(tenant, actor, 'laundry_quality_claim', { garment_unit: unit.id, order: unit.orderId, category, severity, status: 'Open', description, opened_at: now, opened_by: actor });
  audit(tenant, actor, 'laundry:quality-claim-opened', { entity: row.entity, row_id: row.id, after: { garmentUnitId: unit.id, category, severity, description } });
  return presentClaim(tenant, row);
}

export function resolveQualityClaim(tenant: string, actor: string, id: string, decisionInput: string, noteInput: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== 'laundry_quality_claim') throw new Error('quality claim not found');
  if (!['Open', 'Under Review'].includes(String(row.data.status))) throw new Error('quality claim is already closed');
  const decision = text(decisionInput, 20) as QualityDecision;
  if (!QUALITY_DECISIONS.includes(decision)) throw new Error('unknown quality claim decision');
  const note = text(noteInput, 1000);
  if (note.length < 3) throw new Error('resolution note is required');
  const unit = store.getGarmentUnit(tenant, text(row.data.garment_unit, 120));
  if (!unit) throw new Error('garment unit was not found');
  if (decision === 'Rewash' || decision === 'Damaged' || decision === 'Missing') {
    scanLaundryGarment(tenant, actor, { tagCode: unit.activeTagCode, nextState: decision, note });
  }
  const now = new Date().toISOString();
  row.data.status = decision === 'Reject' ? 'Rejected' : 'Resolved'; row.data.decision = decision; row.data.resolved_at = now; row.data.resolved_by = actor; row.data.resolution_note = note; row.updated_at = now; store.updateRow(row);
  issueCustomerCorrection(tenant, actor, row, unit, decision, note);
  audit(tenant, actor, 'laundry:quality-claim-resolved', { entity: row.entity, row_id: row.id, after: { decision, note, status: row.data.status, unitId: unit.id } });
  return presentClaim(tenant, row);
}
