import { createHash } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';

type SettlementStatement = { id: string; data: { statementNumber: string; settlementId: string; storeId: string; policyVersion: string; vendorSettlementPaise: number; currency: 'INR'; immutable: true } };
type PayoutAttemptState = 'PendingProvider' | 'Submitted' | 'Succeeded' | 'Failed';

function paise(value: unknown, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'positive'} integer paise`);
  return Number(value);
}

function text(value: unknown, label: string, max = 160) {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new Error(`${label} is required`);
  return result;
}

function sameArray(left: unknown, right: unknown) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function statementsFor(tenant: string, settlementIds: string[]) {
  const statements = store.rowsOf(tenant, 'canonical_settlement_statement').filter((candidate) => settlementIds.includes(String(candidate.data.settlementId)));
  if (statements.length !== settlementIds.length) throw new Error('SETTLEMENT_STATEMENT_MISSING');
  return statements as unknown as SettlementStatement[];
}

export function createSettlementBatch(tenant: string, actor: string, input: { batchId: string; policyVersion: string; settlementIds: string[]; issuedAt?: string }) {
  const batchId = text(input.batchId, 'batch ID'); const policyVersion = text(input.policyVersion, 'policy version', 80); const settlementIds = [...new Set((input.settlementIds || []).map((value) => text(value, 'settlement ID')))].slice(0, 100);
  if (!settlementIds.length || settlementIds.length > 100 || settlementIds.length !== (input.settlementIds || []).length) throw new Error('SETTLEMENT_BATCH_INVALID');
  const existing = store.rowsOf(tenant, 'marketplace_settlement_batch').find((candidate) => candidate.data.batchId === batchId);
  if (existing) {
    if (existing.data.policyVersion !== policyVersion || !sameArray(existing.data.settlementIds, settlementIds)) throw new Error('SETTLEMENT_BATCH_ID_COLLISION');
    return existing;
  }
  const statements = statementsFor(tenant, settlementIds);
  if (statements.some((statement) => statement.data.storeId !== store.currentStore(tenant) || statement.data.policyVersion !== policyVersion)) throw new Error('SETTLEMENT_BATCH_INVALID');
  const issuedAt = input.issuedAt || new Date().toISOString(); if (!Number.isFinite(new Date(issuedAt).getTime())) throw new Error('SETTLEMENT_BATCH_INVALID');
  const totalVendorSettlementPaise = statements.reduce((sum, statement) => sum + paise(statement.data.vendorSettlementPaise, 'vendor settlement', true), 0);
  const sequence = store.nextSeq(`settlement-batch:${tenant}:${store.currentStore(tenant)}:${issuedAt.slice(0, 4)}`);
  const batchNumber = `BATCH/${issuedAt.slice(0, 4)}/${String(sequence).padStart(5, '0')}`;
  const timestamp = new Date(issuedAt).toISOString(); const row: EntityRow = { id: `settlement_batch_${batchId}`, entity: 'marketplace_settlement_batch', tenant, status: 'Prepared', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { batchId, batchNumber, storeId: store.currentStore(tenant), policyVersion, settlementIds, statementNumbers: statements.map((statement) => statement.data.statementNumber), totalVendorSettlementPaise, currency: 'INR', state: 'Prepared', immutable: true } };
  store.insertRow(row); audit(tenant, actor, 'marketplace:settlement-batch-prepared', { entity: row.entity, row_id: row.id, after: { batchId, batchNumber, settlementCount: settlementIds.length, totalVendorSettlementPaise, policyVersion } }); return row;
}

export function createPayoutAttempt(tenant: string, actor: string, input: { attemptId: string; batchId: string; provider: string; amountPaise: number; idempotencyKey: string }) {
  const attemptId = text(input.attemptId, 'payout attempt ID'); const batchId = text(input.batchId, 'batch ID'); const provider = text(input.provider, 'payout provider', 80); const idempotencyKey = text(input.idempotencyKey, 'payout idempotency key'); const amountPaise = paise(input.amountPaise, 'payout amount');
  const batch = store.rowsOf(tenant, 'marketplace_settlement_batch').find((candidate) => candidate.data.batchId === batchId); if (!batch) throw new Error('SETTLEMENT_BATCH_NOT_FOUND');
  if (amountPaise > Number(batch.data.totalVendorSettlementPaise)) throw new Error('PAYOUT_ATTEMPT_INVALID');
  const existing = store.rowsOf(tenant, 'marketplace_payout_attempt').find((candidate) => candidate.data.attemptId === attemptId);
  if (existing) { if (existing.data.batchId !== batchId || existing.data.amountPaise !== amountPaise || existing.data.idempotencyKey !== idempotencyKey) throw new Error('PAYOUT_ATTEMPT_ID_COLLISION'); return existing; }
  const timestamp = new Date().toISOString(); const row: EntityRow = { id: `payout_attempt_${attemptId}`, entity: 'marketplace_payout_attempt', tenant, status: 'PendingProvider', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { attemptId, batchId, provider, amountPaise, currency: 'INR', idempotencyKey, state: 'PendingProvider', immutableRequest: true, providerEvidence: null } }; store.insertRow(row); audit(tenant, actor, 'marketplace:payout-attempt-created', { entity: row.entity, row_id: row.id, after: { attemptId, batchId, provider, amountPaise } }); return row;
}

export function recordVerifiedPayoutEvidence(tenant: string, actor: string, input: { attemptId: string; eventId: string; provider: string; providerReference: string; status: 'Succeeded' | 'Failed'; amountPaise: number; currency: 'INR'; occurredAt: string; payloadHash: string; signatureVerifiedAt: string; adapterVerified: true }) {
  const attemptId = text(input.attemptId, 'payout attempt ID'); const eventId = text(input.eventId, 'provider payout event ID'); const provider = text(input.provider, 'payout provider', 80); const providerReference = text(input.providerReference, 'provider payout reference'); const payloadHash = text(input.payloadHash, 'provider payload hash', 128); const signatureVerifiedAt = text(input.signatureVerifiedAt, 'signature verification time', 40);
  if (input.adapterVerified !== true || !['Succeeded', 'Failed'].includes(input.status) || input.currency !== 'INR' || !Number.isSafeInteger(input.amountPaise) || input.amountPaise < 0 || !Number.isFinite(new Date(input.occurredAt).getTime()) || !Number.isFinite(new Date(signatureVerifiedAt).getTime())) throw new Error('PAYOUT_PROVIDER_EVIDENCE_INVALID');
  const attempt = store.rowsOf(tenant, 'marketplace_payout_attempt').find((candidate) => candidate.data.attemptId === attemptId); if (!attempt) throw new Error('PAYOUT_ATTEMPT_NOT_FOUND');
  if (attempt.data.provider !== provider || Number(attempt.data.amountPaise) !== input.amountPaise) throw new Error('PAYOUT_PROVIDER_EVIDENCE_MISMATCH');
  const eventPayload = { eventId, provider, providerReference, status: input.status, amountPaise: input.amountPaise, currency: input.currency, occurredAt: input.occurredAt, payloadHash, signatureVerifiedAt };
  const existing = store.rowsOf(tenant, 'marketplace_payout_provider_event').find((candidate) => candidate.data.eventId === eventId && candidate.data.provider === provider);
  if (existing) { if (existing.data.payloadHash !== payloadHash) throw new Error('PAYOUT_EVENT_PAYLOAD_COLLISION'); return attempt; }
  const timestamp = new Date().toISOString(); store.insertRow({ id: `payout_provider_event_${provider}_${eventId}`, entity: 'marketplace_payout_provider_event', tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { ...eventPayload, immutable: true, receivedAt: timestamp } });
  attempt.version += 1; attempt.status = input.status === 'Succeeded' ? 'Succeeded' : 'Failed'; attempt.updated_at = timestamp; attempt.data = { ...attempt.data, state: attempt.status, providerEvidence: { ...eventPayload, immutable: true } }; store.updateRow(attempt); refreshBatch(tenant, String(attempt.data.batchId)); audit(tenant, actor, 'marketplace:payout-provider-evidence-recorded', { entity: attempt.entity, row_id: attempt.id, after: { attemptId, eventId, provider, status: input.status } }); return attempt;
}

function refreshBatch(tenant: string, batchId: string) {
  const batch = store.rowsOf(tenant, 'marketplace_settlement_batch').find((candidate) => candidate.data.batchId === batchId); if (!batch) return;
  const attempts = store.rowsOf(tenant, 'marketplace_payout_attempt').filter((candidate) => candidate.data.batchId === batchId); const succeeded = attempts.filter((attempt) => attempt.status === 'Succeeded').reduce((sum, attempt) => sum + Number(attempt.data.amountPaise || 0), 0); const total = Number(batch.data.totalVendorSettlementPaise || 0); const state = succeeded >= total ? 'Completed' : succeeded > 0 ? 'PartiallyCompleted' : attempts.length > 0 && attempts.every((attempt) => ['Failed'].includes(attempt.status)) ? 'Failed' : 'Prepared';
  if (batch.data.state !== state) { batch.version += 1; batch.status = state; batch.updated_at = new Date().toISOString(); batch.data = { ...batch.data, state, succeededPaise: succeeded }; store.updateRow(batch); }
}

export function settlementBatch(tenant: string, batchId: string) { return store.rowsOf(tenant, 'marketplace_settlement_batch').find((candidate) => candidate.data.batchId === batchId); }

export function payoutAttempt(tenant: string, attemptId: string) { return store.rowsOf(tenant, 'marketplace_payout_attempt').find((candidate) => candidate.data.attemptId === attemptId); }

export function payoutPayloadHash(payload: unknown) { return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'); }
