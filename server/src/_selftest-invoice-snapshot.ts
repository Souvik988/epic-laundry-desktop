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
  const { createRow, submitRow } = await import('./kernel/entity-service.js');
  const { approveTaxPolicyRule, createTaxPolicyRule, saveSupplierTaxProfile } = await import('./modules/gst/tax-policy.js');
  const { ensureCanonicalInvoiceForLegacy } = await import('./modules/gst/legacy-invoice-bridge.js'); const { bookLaundryOrder, laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { generateIrnForInvoice } = await import('./modules/gst/irn-service.js');
  const tax = calculateCanonicalTax({ supplierStateCode: '29', placeOfSupplyStateCode: '29', lines: [{ id: 'svc', description: 'Laundry service', classificationType: 'SAC', classificationCode: '9997', quantityMilli: 1_000, unit: 'piece', unitPricePaise: 10_000, taxRateBps: 1800 }] });
  const input = { sourceOrderId: 'ORDER-INV-1', issuedAt: '2026-04-01T08:00:00.000Z', supplier: { legalName: 'Epic Laundry Private Limited', tradeName: 'Epic Laundry', address: 'Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered' as const, gstin: '29ABCDE1234F1Z5', invoiceSeries: 'EL' }, customer: { name: 'Riya & Sen', stateCode: '29' }, tax, paidPaise: 5_000 };
  const row = store.withStoreScope('INV', 'STORE-DEFAULT', () => createCanonicalInvoiceSnapshot('INV', 'owner', input));
  assert.equal(row.data.invoiceNumber, 'EL/FY2026-27/00001'); assert.equal(row.data.documentType, 'TaxInvoice'); assert.equal(row.data.outstandingPaise, tax.totals.totalPaise - 5_000); assert.equal(store.withStoreScope('INV', 'STORE-DEFAULT', () => createCanonicalInvoiceSnapshot('INV', 'owner', input)).id, row.id, 'invoice snapshot creation is idempotent by source order');
  const { renderCanonicalTaxInvoice } = await import('./modules/gst/canonical-invoice-print.js'); const html = renderCanonicalTaxInvoice(row.data as any); assert.match(html, /TAX INVOICE/); assert.match(html, /Riya &amp; Sen/); assert.match(html, /SAC\/9997/); assert.match(html, /No IRP evidence is claimed/); assert.doesNotMatch(html, /<script>/i);
  assert.throws(() => store.withStoreScope('INV', 'STORE-DEFAULT', () => createCanonicalInvoiceSnapshot('INV', 'owner', { ...input, sourceOrderId: 'ORDER-INV-2', supplier: { ...input.supplier, gstin: '' } })), /TAX_PROFILE_INCOMPLETE/);
  const bridged = store.withStoreScope('BRIDGE', 'STORE-DEFAULT', () => {
    saveSupplierTaxProfile('BRIDGE', 'owner', { legalName: 'Bridge Laundry Private Limited', address: 'Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered', gstin: '29ABCDE1234F1Z5', invoiceSeries: 'BR', einvoiceState: 'NotApplicable' });
    const rule = createTaxPolicyRule('BRIDGE', 'owner', { classificationType: 'SAC', classificationCode: '9997', description: 'Laundry service', supplyType: 'Service', rateBps: 1800, validFrom: '2026-04-01', validTo: '2027-03-31', sourceNote: 'Self-test approved fixture', version: '2026.1' });
    approveTaxPolicyRule('BRIDGE', 'owner', rule.id);
    const party = createRow('BRIDGE', 'owner', 'party', { name: 'Bridge customer', phone: '9000000101', state: '29', is_customer: true });
    const invoice = submitRow('BRIDGE', 'owner', 'sales_invoice', createRow('BRIDGE', 'owner', 'sales_invoice', { customer: party.id, posting_date: '2026-09-02', place_of_supply: '29', currency: 'INR', items: [{ item: 'LAUNDRY-SERVICE', qty: 1, rate: 100, gst_rate: 18, hsn: '9997', unit: 'Piece', description: 'Laundry service' }] }).id);
    const snapshot = ensureCanonicalInvoiceForLegacy('BRIDGE', 'owner', invoice.id, 'BRIDGE-ORDER-1');
    seedLaundryDefaults('BRIDGE');
    const catalogue = laundryCatalogue('BRIDGE');
    const booked = bookLaundryOrder('BRIDGE', 'owner', { customer: { id: party.id }, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], taxRate: 18, expectedDeliveryDate: '2026-09-05', fulfillmentMode: 'Pickup Order' });
    return { invoice: store.getRow('BRIDGE', invoice.id)!, snapshot, booked };
  });
  assert.equal(bridged.snapshot.data.sourceOrderId, 'BRIDGE-ORDER-1', 'legacy invoice bridge preserves the explicit operational order identity');
  assert.equal(bridged.snapshot.data.invoiceNumber, 'BR/FY2026-27/00001', 'configured booking bridge issues the configured financial-year invoice series');
  assert.equal(bridged.snapshot.data.tax.totals.totalPaise, 11_800, 'legacy invoice bridge preserves fixed-scale tax totals');
  assert.equal(bridged.invoice.data.canonical_snapshot_id, bridged.snapshot.id, 'legacy invoice records its immutable canonical snapshot link');
  assert.match(String(bridged.booked.order.invoiceNumber), /^BR\/FY2026-27\/00002$/, 'configured laundry booking exposes the canonical financial-year invoice number');
  const bookedRow = store.withStoreScope('BRIDGE', 'STORE-DEFAULT', () => store.getRow('BRIDGE', bridged.booked.order.id)!);
  assert.ok(bookedRow.data.canonical_invoice_snapshot_id, 'configured laundry booking links its order to the canonical snapshot');
  await assert.rejects(() => store.withStoreScope('BRIDGE', 'STORE-DEFAULT', () => generateIrnForInvoice('BRIDGE', bridged.invoice.id)), /EINVOICE_NOT_APPLICABLE/, 'IRN generation rejects a supplier configured as not applicable');
  store.withStoreScope('BRIDGE', 'STORE-DEFAULT', () => saveSupplierTaxProfile('BRIDGE', 'owner', { legalName: 'Bridge Laundry Private Limited', address: 'Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered', gstin: '29ABCDE1234F1Z5', invoiceSeries: 'BR', einvoiceState: 'Sandbox' }));
  const sandboxIrn = await store.withStoreScope('BRIDGE', 'STORE-DEFAULT', () => generateIrnForInvoice('BRIDGE', bridged.invoice.id));
  assert.equal(sandboxIrn.environment, 'sandbox', 'sandbox IRN evidence is explicitly environment-labeled');
  assert.equal(store.withStoreScope('BRIDGE', 'STORE-DEFAULT', () => store.getRow('BRIDGE', bridged.invoice.id)?.data.einvoice_status), 'SANDBOX_GENERATED', 'sandbox IRN status cannot masquerade as production generated');
  console.log('PASS canonical immutable invoice snapshot, financial year, and supplier readiness self-test complete');
} finally { close?.(); rmSync(dir, { recursive: true, force: true }); }
