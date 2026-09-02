import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-invoice-snapshot-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite'); process.env.EPIC_DATA_FILE = join(dir, 'legacy.json'); process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let close: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); close = () => store.close();
  const { calculateCanonicalTax } = await import('./modules/gst/canonical-tax.js'); const { createCanonicalInvoiceSnapshot } = await import('./modules/gst/invoice-snapshot.js');
  const tax = calculateCanonicalTax({ supplierStateCode: '29', placeOfSupplyStateCode: '29', lines: [{ id: 'svc', description: 'Laundry service', classificationType: 'SAC', classificationCode: '9997', quantityMilli: 1_000, unit: 'piece', unitPricePaise: 10_000, taxRateBps: 1800 }] });
  const input = { sourceOrderId: 'ORDER-INV-1', issuedAt: '2026-04-01T08:00:00.000Z', supplier: { legalName: 'Epic Laundry Private Limited', tradeName: 'Epic Laundry', address: 'Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered' as const, gstin: '29ABCDE1234F1Z5', invoiceSeries: 'EL' }, customer: { name: 'Riya Sen', stateCode: '29' }, tax, paidPaise: 5_000 };
  const row = store.withStoreScope('INV', 'STORE-DEFAULT', () => createCanonicalInvoiceSnapshot('INV', 'owner', input));
  assert.equal(row.data.invoiceNumber, 'EL/FY2026-27/00001'); assert.equal(row.data.documentType, 'TaxInvoice'); assert.equal(row.data.outstandingPaise, tax.totals.totalPaise - 5_000); assert.equal(store.withStoreScope('INV', 'STORE-DEFAULT', () => createCanonicalInvoiceSnapshot('INV', 'owner', input)).id, row.id, 'invoice snapshot creation is idempotent by source order');
  assert.throws(() => store.withStoreScope('INV', 'STORE-DEFAULT', () => createCanonicalInvoiceSnapshot('INV', 'owner', { ...input, sourceOrderId: 'ORDER-INV-2', supplier: { ...input.supplier, gstin: '' } })), /TAX_PROFILE_INCOMPLETE/);
  console.log('PASS canonical immutable invoice snapshot, financial year, and supplier readiness self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
