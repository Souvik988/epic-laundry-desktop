import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-tax-policy-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite');
process.env.EPIC_DATA_FILE = join(dir, 'legacy.json');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let close: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js');
  const { approveTaxPolicyRule, createTaxPolicyRule, listTaxPolicyRules, resolveTaxPolicyRule, saveSupplierTaxProfile, supplierTaxProfile, taxReadiness } = await import('./modules/gst/tax-policy.js');
  close = () => store.close();
  const tenant = 'TAX-POLICY';
  const draft = store.withStoreScope(tenant, 'STORE-TAX', () => createTaxPolicyRule(tenant, 'owner', { classificationType: 'SAC', classificationCode: '9997', description: 'Laundry service', supplyType: 'Service', rateBps: 1800, validFrom: '2026-04-01', validTo: '2027-03-31', sourceNote: 'Accountant review ticket TAX-001', version: '2026.1' }));
  assert.equal(draft.status, 'Draft');
  const approved = store.withStoreScope(tenant, 'STORE-TAX', () => approveTaxPolicyRule(tenant, 'owner', draft.id));
  assert.equal(approved.data.approvalStatus, 'Approved');
  assert.equal(store.withStoreScope(tenant, 'STORE-TAX', () => resolveTaxPolicyRule(tenant, { classificationType: 'SAC', classificationCode: '9997', supplyType: 'Service', asOf: '2026-09-02' })?.rateBps), 1800, 'approved effective-dated rule resolves by transaction date');
  assert.equal(store.withStoreScope(tenant, 'STORE-TAX', () => listTaxPolicyRules(tenant, '2025-09-02')).length, 0, 'future rule is not active before its effective date');
  assert.throws(() => store.withStoreScope(tenant, 'STORE-TAX', () => createTaxPolicyRule(tenant, 'owner', { classificationType: 'SAC', classificationCode: '9997', description: 'Overlapping laundry service', supplyType: 'Service', rateBps: 1200, validFrom: '2026-06-01', validTo: '2027-01-01', sourceNote: 'overlap', version: 'bad' })), /TAX_RULE_OVERLAP/);
  const profile = store.withStoreScope(tenant, 'STORE-TAX', () => saveSupplierTaxProfile(tenant, 'owner', { legalName: 'Epic Laundry Private Limited', tradeName: 'Epic Laundry', address: 'Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered', gstin: '29ABCDE1234F1Z5', invoiceSeries: 'EL', einvoiceState: 'NotConfigured' }));
  assert.equal((profile.data as any).registrationStatus, 'Registered');
  assert.equal(store.withStoreScope(tenant, 'STORE-TAX', () => supplierTaxProfile(tenant))?.gstin, '29ABCDE1234F1Z5');
  assert.equal(store.withStoreScope(tenant, 'STORE-TAX', () => taxReadiness(tenant)).ready, true, 'complete persisted supplier profile passes readiness');
  assert.throws(() => store.withStoreScope(tenant, 'STORE-TAX', () => saveSupplierTaxProfile(tenant, 'owner', { legalName: 'Incomplete', address: 'Kolkata', stateCode: '29', pincode: '700001', registrationStatus: 'Registered', gstin: '' })), /TAX_PROFILE_INCOMPLETE/);
  console.log('PASS effective-dated tax policy approval, overlap protection, supplier profile, and readiness self-test complete');
} finally {
  close?.();
  rmSync(dir, { recursive: true, force: true });
}
