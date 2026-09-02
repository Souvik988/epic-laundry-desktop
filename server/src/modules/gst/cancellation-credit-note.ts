import { createRow, submitRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { createCanonicalCreditNoteSnapshot } from './invoice-snapshot.js';
import { ensureCanonicalInvoiceForLegacy } from './legacy-invoice-bridge.js';
import { supplierTaxProfile } from './tax-policy.js';

/**
 * Record a full reversal before the original invoice is cancelled. The
 * legacy credit-note row preserves existing ERP/GSTR projections; when the
 * invoice has V4 evidence, the same immutable tax snapshot is also recorded
 * in the canonical document store. The operation is transaction-safe and is
 * intentionally not used to invent a tax profile for standalone stores.
 */
export function createLaundryCancellationCreditNote(tenant: string, actor: string, invoice: EntityRow, orderId: string, reason: string) {
  if (invoice.entity !== 'sales_invoice' || invoice.status !== 'Submitted') throw new Error('submitted sales invoice not found');
  const existing = store.rowsOf(tenant, 'credit_note').find((row) => row.status !== 'Cancelled' && String(row.data.source_order_id || '') === orderId && String(row.data.reference_invoice || '') === invoice.id);
  if (existing) return existing;
  const items = Array.isArray(invoice.data.items) ? invoice.data.items.map((item: Record<string, unknown>) => ({ ...item, qty: Number(item.qty || 0) })) : [];
  if (!items.length) throw new Error('credit note requires invoice items');
  const creditNote = createRow(tenant, actor, 'credit_note', { reference_invoice: invoice.id, posting_date: String(invoice.data.posting_date || new Date().toISOString().slice(0, 10)), reason: String(reason || '').trim().slice(0, 500), source_order_id: orderId, items });
  const submittedCreditNote = submitRow(tenant, actor, 'credit_note', creditNote.id);

  const profile = supplierTaxProfile(tenant);
  let canonicalInvoice = invoice.data.canonical_snapshot_id ? store.getRow(tenant, String(invoice.data.canonical_snapshot_id)) : undefined;
  if (profile && !canonicalInvoice) canonicalInvoice = ensureCanonicalInvoiceForLegacy(tenant, actor, invoice.id, orderId);
  if (canonicalInvoice?.entity === 'canonical_invoice_snapshot') {
    const customer = store.getRow(tenant, String(invoice.data.customer || ''));
    const canonicalCredit = createCanonicalCreditNoteSnapshot(tenant, actor, {
      sourceOrderId: `credit-note:${orderId}`,
      issuedAt: `${String(invoice.data.posting_date || '').trim()}T00:00:00.000Z`,
      supplier: canonicalInvoice.data.supplier,
      customer: { name: String(customer?.data?.name || canonicalInvoice.data.customer?.name || 'Customer'), address: String(customer?.data?.address || canonicalInvoice.data.customer?.address || ''), stateCode: String(customer?.data?.state || canonicalInvoice.data.customer?.stateCode || ''), gstin: customer?.data?.gstin ? String(customer.data.gstin).trim() : canonicalInvoice.data.customer?.gstin },
      tax: canonicalInvoice.data.tax,
      referenceInvoiceNumber: canonicalInvoice.data.invoiceNumber,
      reason,
    });
    submittedCreditNote.data.canonical_snapshot_id = canonicalCredit.id;
    store.updateRow(submittedCreditNote);
  }
  return submittedCreditNote;
}
