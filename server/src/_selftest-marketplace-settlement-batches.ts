import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-settlement-batches-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite');
process.env.EPIC_DATA_FILE = join(dir, 'legacy.json');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let close: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js');
  const { recordMarketplaceSettlement } = await import('./modules/marketplace/settlements.js');
  const { createPayoutAttempt, createSettlementBatch, payoutPayloadHash, recordVerifiedPayoutEvidence, settlementBatch } = await import('./modules/marketplace/settlement-batches.js');
  close = () => store.close();
  const first = { externalOrderId: 'EXT-BATCH-1', policyVersion: 'policy-batch-1', customerCollectedPaise: 10000, vendorServiceGrossPaise: 10000, commissionBps: 1000 };
  const second = { externalOrderId: 'EXT-BATCH-2', policyVersion: 'policy-batch-1', customerCollectedPaise: 6000, vendorServiceGrossPaise: 6000, commissionBps: 1000 };
  const [one, two] = store.withStoreScope('BATCH', 'STORE-DEFAULT', () => [recordMarketplaceSettlement('BATCH', 'owner', first), recordMarketplaceSettlement('BATCH', 'owner', second)]);
  const batch = store.withStoreScope('BATCH', 'STORE-DEFAULT', () => createSettlementBatch('BATCH', 'owner', { batchId: 'BATCH-001', policyVersion: 'policy-batch-1', settlementIds: [one.id, two.id], issuedAt: '2026-09-03T08:00:00.000Z' }));
  assert.equal(batch.data.totalVendorSettlementPaise, 14400, 'batch total is the sum of immutable settlement evidence');
  assert.equal(store.withStoreScope('BATCH', 'STORE-DEFAULT', () => createSettlementBatch('BATCH', 'owner', { batchId: 'BATCH-001', policyVersion: 'policy-batch-1', settlementIds: [one.id, two.id], issuedAt: '2026-09-03T08:00:00.000Z' })).id, batch.id, 'batch preparation is idempotent');
  const attempt = store.withStoreScope('BATCH', 'STORE-DEFAULT', () => createPayoutAttempt('BATCH', 'owner', { attemptId: 'PAYOUT-001', batchId: 'BATCH-001', provider: 'simulator', amountPaise: 14400, idempotencyKey: 'payout-idem-001' }));
  assert.equal(attempt.status, 'PendingProvider', 'payout attempt cannot claim success before provider evidence');
  assert.throws(() => store.withStoreScope('BATCH', 'STORE-DEFAULT', () => recordVerifiedPayoutEvidence('BATCH', 'adapter', { attemptId: 'PAYOUT-001', eventId: 'payout-event-1', provider: 'simulator', providerReference: 'provider-ref-1', status: 'Succeeded', amountPaise: 14399, currency: 'INR', occurredAt: new Date().toISOString(), payloadHash: 'hash-1', signatureVerifiedAt: new Date().toISOString(), adapterVerified: true })), /PAYOUT_PROVIDER_EVIDENCE_MISMATCH/);
  const evidence = { attemptId: 'PAYOUT-001', eventId: 'payout-event-1', provider: 'simulator', providerReference: 'provider-ref-1', status: 'Succeeded' as const, amountPaise: 14400, currency: 'INR' as const, occurredAt: new Date().toISOString(), payloadHash: payoutPayloadHash({ providerReference: 'provider-ref-1', amountPaise: 14400 }), signatureVerifiedAt: new Date().toISOString(), adapterVerified: true as const };
  const completed = store.withStoreScope('BATCH', 'STORE-DEFAULT', () => recordVerifiedPayoutEvidence('BATCH', 'adapter', evidence));
  assert.equal(completed.status, 'Succeeded', 'payout success requires adapter-verified provider evidence');
  assert.equal(store.withStoreScope('BATCH', 'STORE-DEFAULT', () => settlementBatch('BATCH', 'BATCH-001'))?.status, 'Completed', 'batch completes only after provider evidence reconciles the full amount');
  assert.equal(store.withStoreScope('BATCH', 'STORE-DEFAULT', () => recordVerifiedPayoutEvidence('BATCH', 'adapter', evidence)).id, completed.id, 'provider payout event retry is idempotent');
  assert.throws(() => store.withStoreScope('BATCH', 'STORE-DEFAULT', () => recordVerifiedPayoutEvidence('BATCH', 'adapter', { ...evidence, payloadHash: 'different-hash' })), /PAYOUT_EVENT_PAYLOAD_COLLISION/);
  console.log('PASS settlement batch preparation, payout-attempt evidence gate, provider event idempotency, and batch reconciliation self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
