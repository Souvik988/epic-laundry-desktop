import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-customer-status-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite');
let close: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js');
  const { audit } = await import('./kernel/audit.js');
  const { createMarketplaceOrderRequest, recordMarketplaceIntake, createMarketplaceReassessment } = await import('./modules/marketplace/order-truth.js');
  const { customerFacingOrderStatus, customerStatusMapping, saveCustomerStatusMapping } = await import('./modules/marketplace/customer-status.js');
  close = () => store.close();
  const tenant = 'CUSTOMER-STATUS'; const storeId = 'STORE-STATUS'; const run = <T>(work: () => T) => store.withStoreScope(tenant, storeId, work);
  const requestedAt = '2026-09-01T10:00:00.000Z';
  run(() => createMarketplaceOrderRequest(tenant, 'operator', { externalOrderId: 'EXT-STATUS-1', channel: 'CUSTOMER_APP', estimate: { kg: 2.5 }, customer: { name: 'Private Customer', phone: '+91-9999999999' }, requestedAt }));
  run(() => recordMarketplaceIntake(tenant, 'operator', { externalOrderId: 'EXT-STATUS-1', actual: { kg: 3.4 }, reason: 'physical intake' }));
  run(() => createMarketplaceReassessment(tenant, 'operator', { externalOrderId: 'EXT-STATUS-1', previousAmountPaise: 10000, revisedAmountPaise: 13000, reason: 'weight changed', tolerancePaise: 0 }));
  run(() => audit(tenant, 'operator', 'marketplace:order-projected', { entity: 'marketplace_order_projection', row_id: 'projection-status-1', after: { state: 'IntakeRequired' } }));
  assert.equal(run(() => customerFacingOrderStatus(tenant, 'EXT-STATUS-1').status), 'ApprovalRequired', 'pending reassessment drives customer approval status');
  const configured = run(() => saveCustomerStatusMapping(tenant, 'owner', { Processing: 'QualityCheck' }));
  assert.equal(configured.mapping.Processing, 'QualityCheck', 'mapping is validated and persisted');
  assert.equal(run(() => customerStatusMapping(tenant).source), 'store-configured', 'store mapping survives a read');
  const result = run(() => customerFacingOrderStatus(tenant, 'EXT-STATUS-1'));
  assert.ok(result.timeline.some((event) => event.status === 'Received'), 'timeline contains evidence-backed intake status');
  assert.ok(result.timeline.some((event) => event.status === 'ApprovalRequired'), 'timeline contains evidence-backed approval status');
  assert.equal(JSON.stringify(result).includes('Private Customer'), false, 'customer-facing status response does not echo private customer data');
  assert.equal(JSON.stringify(result).includes('operator'), false, 'customer-facing timeline does not expose internal actors');
  console.log('PASS customer-facing status mapping, event-derived timeline, approval override, and privacy self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
