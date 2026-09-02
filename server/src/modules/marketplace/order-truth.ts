import { randomUUID } from 'node:crypto';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';

export type ReassessmentState = 'PendingApproval' | 'Approved' | 'Rejected' | 'Expired';
const now = () => new Date().toISOString();
function row(tenant: string, actor: string, entity: string, data: Record<string, unknown>, status = 'Active'): EntityRow {
  const timestamp = now(); return { id: `${entity}_${randomUUID()}`, entity, tenant, status, version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { ...data } };
}
function find(tenant: string, entity: string, externalOrderId: string) { return store.rowsOf(tenant, entity).find((candidate) => candidate.data.externalOrderId === externalOrderId); }
export function createMarketplaceOrderRequest(tenant: string, actor: string, input: { externalOrderId: string; channel: string; estimate: Record<string, unknown>; customer?: Record<string, unknown>; requestedAt?: string }) {
  const externalOrderId = String(input.externalOrderId || '').trim(); if (!externalOrderId) throw new Error('external order ID is required');
  const existing = find(tenant, 'marketplace_order_request', externalOrderId); if (existing) return existing;
  const request = row(tenant, actor, 'marketplace_order_request', { externalOrderId, channel: input.channel, estimate: input.estimate, customer: input.customer || {}, requestedAt: input.requestedAt || now(), immutable: true }); store.insertRow(request); audit(tenant, actor, 'marketplace:order-request-recorded', { entity: request.entity, row_id: request.id, after: request.data }); return request;
}
export function recordMarketplaceIntake(tenant: string, actor: string, input: { externalOrderId: string; actual: Record<string, unknown>; reason?: string }) {
  const request = find(tenant, 'marketplace_order_request', input.externalOrderId); if (!request) throw new Error('marketplace order request not found');
  const existing = store.rowsOf(tenant, 'marketplace_intake_assessment').find((candidate) => candidate.data.externalOrderId === input.externalOrderId && candidate.status === 'Active'); if (existing) return existing;
  const assessment = row(tenant, actor, 'marketplace_intake_assessment', { externalOrderId: input.externalOrderId, requestId: request.id, originalEstimate: request.data.estimate, actual: input.actual, reason: input.reason || '', assessedAt: now(), immutable: true }); store.insertRow(assessment); audit(tenant, actor, 'marketplace:intake-assessed', { entity: assessment.entity, row_id: assessment.id, after: assessment.data }); return assessment;
}
export function createMarketplaceReassessment(tenant: string, actor: string, input: { externalOrderId: string; previousAmountPaise: number; revisedAmountPaise: number; reason: string; tolerancePaise?: number }) {
  const intake = store.rowsOf(tenant, 'marketplace_intake_assessment').find((candidate) => candidate.data.externalOrderId === input.externalOrderId && candidate.status === 'Active'); if (!intake) throw new Error('marketplace intake assessment not found');
  if (!Number.isSafeInteger(input.previousAmountPaise) || !Number.isSafeInteger(input.revisedAmountPaise)) throw new Error('reassessment amounts must be integer paise');
  const existing = store.rowsOf(tenant, 'marketplace_reassessment').find((candidate) => candidate.data.externalOrderId === input.externalOrderId && candidate.status === 'Active'); if (existing && existing.data.state === 'PendingApproval') return existing;
  const delta = input.revisedAmountPaise - input.previousAmountPaise; const tolerance = Math.max(0, input.tolerancePaise || 0); const state: ReassessmentState = Math.abs(delta) > tolerance ? 'PendingApproval' : 'Approved';
  const reassessment = row(tenant, actor, 'marketplace_reassessment', { externalOrderId: input.externalOrderId, intakeId: intake.id, previousAmountPaise: input.previousAmountPaise, revisedAmountPaise: input.revisedAmountPaise, deltaPaise: delta, tolerancePaise: tolerance, reason: String(input.reason || '').trim().slice(0, 500), state, createdAt: now(), approvedAt: state === 'Approved' ? now() : undefined, immutable: true }); store.insertRow(reassessment); audit(tenant, actor, 'marketplace:reassessment-created', { entity: reassessment.entity, row_id: reassessment.id, after: reassessment.data }); return reassessment;
}
export function decideMarketplaceReassessment(tenant: string, actor: string, reassessmentId: string, decision: 'approve' | 'reject') {
  const reassessment = store.getRow(tenant, reassessmentId); if (!reassessment || reassessment.entity !== 'marketplace_reassessment') throw new Error('reassessment not found');
  const state = reassessment.data.state as ReassessmentState; if (state === 'Approved' || state === 'Rejected') return reassessment; if (state !== 'PendingApproval') throw new Error('reassessment is not awaiting approval');
  reassessment.data.state = decision === 'approve' ? 'Approved' : 'Rejected'; reassessment.data.decidedBy = actor; reassessment.data.decidedAt = now(); reassessment.version += 1; reassessment.updated_at = now(); store.updateRow(reassessment); audit(tenant, actor, `marketplace:reassessment-${decision}d`, { entity: reassessment.entity, row_id: reassessment.id, after: reassessment.data }); return reassessment;
}
export function marketplaceOrderTruth(tenant: string, externalOrderId: string) { return { request: find(tenant, 'marketplace_order_request', externalOrderId), intake: store.rowsOf(tenant, 'marketplace_intake_assessment').find((candidate) => candidate.data.externalOrderId === externalOrderId), reassessments: store.rowsOf(tenant, 'marketplace_reassessment').filter((candidate) => candidate.data.externalOrderId === externalOrderId) }; }
