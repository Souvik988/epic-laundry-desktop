import type { EntityRow } from '../../kernel/types.js';
import { parseMoney } from '../../kernel/money.js';
import { store } from '../../kernel/store.js';
import { calculateCanonicalTax } from './canonical-tax.js';
import { createCanonicalInvoiceSnapshot } from './invoice-snapshot.js';
import { resolveTaxPolicyRule, supplierTaxProfile } from './tax-policy.js';

export function shouldAttemptCanonicalInvoice(tenant: string) {
  return Boolean(supplierTaxProfile(tenant) && store.rowsOf(tenant, 'tax_policy_rule').some((row) => row.status === 'Approved' && row.data?.approvalStatus === 'Approved'));
}

/**
 * Convert a submitted legacy sales/POS invoice into the immutable V4 snapshot.
 *
 * Legacy invoices remain readable for local compatibility, but once a store
 * has a supplier tax profile, tax output must be backed by an approved,
 * effective-dated classification rule. This bridge deliberately fails closed
 * instead of inventing a SAC/HSN, rate, supplier identity, or place of supply.
 */
export function ensureCanonicalInvoiceForLegacy(tenant: string, actor: string, invoiceId: string, sourceOrderId?: string) {
  const invoice = store.getRow(tenant, invoiceId);
  if (!invoice || !['sales_invoice', 'pos_invoice'].includes(invoice.entity) || invoice.status !== 'Submitted') throw new Error('submitted invoice not found');
  const linkedId = String(invoice.data.canonical_snapshot_id || '').trim();
  if (linkedId) {
    const linked = store.getRow(tenant, linkedId);
    if (linked?.entity === 'canonical_invoice_snapshot') return linked;
  }
  const supplier = supplierTaxProfile(tenant);
  if (!supplier) throw new Error('TAX_PROFILE_INCOMPLETE');
  const issuedAt = `${String(invoice.data.posting_date || '').trim()}T00:00:00.000Z`;
  const issuedDate = new Date(issuedAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(invoice.data.posting_date || '')) || Number.isNaN(issuedDate.getTime())) throw new Error('TAX_PROFILE_INCOMPLETE');
  const rawItems = Array.isArray(invoice.data.items) ? invoice.data.items as Array<Record<string, unknown>> : [];
  if (!rawItems.length) throw new Error('TAX_CLASSIFICATION_MISSING');
  const lines = rawItems.map((item, index) => {
    const linkedItem = item.item ? store.getRow(tenant, String(item.item)) : undefined;
    const classificationType = String(item.classificationType || linkedItem?.data?.classificationType || (invoice.entity === 'pos_invoice' ? 'HSN' : 'SAC')) as 'SAC' | 'HSN';
    const supplyType = String(item.supplyType || linkedItem?.data?.supplyType || (invoice.entity === 'pos_invoice' ? 'Product' : 'Service')) as 'Service' | 'Product';
    const classificationCode = String(item.hsn || item.classificationCode || linkedItem?.data?.hsn || '').trim();
    const rule = resolveTaxPolicyRule(tenant, { classificationType, classificationCode, supplyType, asOf: String(invoice.data.posting_date) });
    if (!rule) throw new Error('TAX_CLASSIFICATION_MISSING');
    const quantity = Number(item.qty || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(Math.round(quantity * 1000))) throw new Error('TAX_CLASSIFICATION_MISSING');
    return {
      id: `${invoice.id}:line:${index + 1}`,
      description: String(item.description || linkedItem?.data?.name || item.item || `Laundry service ${index + 1}`).trim().slice(0, 240),
      classificationType: rule.classificationType,
      classificationCode: rule.classificationCode,
      quantityMilli: Math.round(quantity * 1000),
      unit: String(item.unit || linkedItem?.data?.uom || 'Piece').trim().slice(0, 24),
      unitPricePaise: parseMoney(item.rate ?? linkedItem?.data?.rate, `invoice line ${index + 1} rate`),
      taxRateBps: rule.rateBps,
    } as const;
  });
  const placeOfSupplyStateCode = String(invoice.data.place_of_supply || supplier.stateCode).trim();
  const tax = calculateCanonicalTax({ supplierStateCode: supplier.stateCode, placeOfSupplyStateCode, lines });
  const legacyTotalPaise = parseMoney(invoice.data.grand_total, 'legacy invoice total');
  if (tax.totals.totalPaise !== legacyTotalPaise) throw new Error('TAX_RECONCILIATION_FAILED');
  const paidPaise = invoice.entity === 'pos_invoice' ? legacyTotalPaise : store.rowsOf(tenant, 'payment_entry')
    .filter((payment) => payment.status === 'Submitted' && payment.data.payment_type === 'Receive' && String(payment.data.against_sales || '') === invoice.id)
    .reduce((sum, payment) => sum + parseMoney(payment.data.amount, `payment ${payment.id}`), 0);
  const order = sourceOrderId || (invoice.entity === 'sales_invoice' ? store.rowsOf(tenant, 'laundry_order').find((candidate) => String(candidate.data.invoice || '') === invoice.id)?.id : undefined);
  const snapshot = createCanonicalInvoiceSnapshot(tenant, actor, {
    sourceOrderId: order || `${invoice.entity === 'pos_invoice' ? 'pos-invoice' : 'sales-invoice'}:${invoice.id}`,
    issuedAt,
    supplier,
    customer: (() => {
      const customer = invoice.data.customer ? store.getRow(tenant, String(invoice.data.customer)) : undefined;
      return { name: String(customer?.data?.name || 'Customer'), address: String(customer?.data?.address || ''), stateCode: String(customer?.data?.state || invoice.data.place_of_supply || '').trim(), gstin: customer?.data?.gstin ? String(customer.data.gstin).trim() : undefined };
    })(),
    tax,
    paidPaise,
  });
  invoice.data.canonical_snapshot_id = snapshot.id;
  store.updateRow(invoice);
  return snapshot;
}
