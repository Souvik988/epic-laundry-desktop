import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import type { CanonicalTaxSnapshot } from './canonical-tax.js';

export type SupplierTaxProfile = { legalName: string; tradeName?: string; address: string; stateCode: string; pincode: string; registrationStatus: 'Registered' | 'Unregistered'; gstin?: string; invoiceSeries?: string };
export type CanonicalInvoiceSnapshot = { invoiceNumber: string; documentType: 'TaxInvoice' | 'BillOfSupply' | 'CreditNote' | 'DebitNote'; issuedAt: string; financialYear: string; sourceOrderId: string; supplier: SupplierTaxProfile; customer: { name: string; address?: string; stateCode?: string; gstin?: string }; tax: CanonicalTaxSnapshot; paidPaise: number; outstandingPaise: number; referenceInvoiceNumber?: string; reason?: string; immutable: true };
function fy(date: Date) { const year = date.getUTCFullYear(); const start = date.getUTCMonth() >= 3 ? year : year - 1; return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`; }
function profile(input: SupplierTaxProfile) { if (!input || !String(input.legalName || '').trim() || !String(input.address || '').trim() || !/^\d{2}$/.test(String(input.stateCode || '')) || !/^\d{6}$/.test(String(input.pincode || '')) || !['Registered', 'Unregistered'].includes(input.registrationStatus) || (input.registrationStatus === 'Registered' && !/^\d{2}[A-Z0-9]{13}$/i.test(String(input.gstin || '')))) throw new Error('TAX_PROFILE_INCOMPLETE'); return { ...input, legalName: input.legalName.trim(), address: input.address.trim(), stateCode: input.stateCode.trim(), pincode: input.pincode.trim(), gstin: input.gstin?.trim() }; }
export function createCanonicalInvoiceSnapshot(tenant: string, actor: string, input: { sourceOrderId: string; issuedAt?: string; supplier: SupplierTaxProfile; customer: CanonicalInvoiceSnapshot['customer']; tax: CanonicalTaxSnapshot; paidPaise?: number }) {
  const sourceOrderId = String(input.sourceOrderId || '').trim(); if (!sourceOrderId) throw new Error('source order ID is required'); const existing = store.rowsOf(tenant, 'canonical_invoice_snapshot').find((candidate) => candidate.data.sourceOrderId === sourceOrderId); if (existing) return existing;
  const supplier = profile(input.supplier); const issuedAt = input.issuedAt || new Date().toISOString(); const date = new Date(issuedAt); if (!Number.isFinite(date.getTime())) throw new Error('invalid invoice date'); const financialYear = fy(date); const sequence = store.nextSeq(`invoice:${tenant}:${store.currentStore(tenant)}:${financialYear}`); const invoiceNumber = `${supplier.invoiceSeries || 'INV'}/${financialYear}/${String(sequence).padStart(5, '0')}`; const totalPaise = input.tax.totals.totalPaise; const paidPaise = Number.isSafeInteger(input.paidPaise) ? Math.max(0, input.paidPaise!) : 0; if (paidPaise > totalPaise) throw new Error('paid amount exceeds invoice total'); const snapshot: CanonicalInvoiceSnapshot = { invoiceNumber, documentType: supplier.registrationStatus === 'Registered' ? 'TaxInvoice' : 'BillOfSupply', issuedAt, financialYear, sourceOrderId, supplier, customer: input.customer, tax: structuredClone(input.tax), paidPaise, outstandingPaise: totalPaise - paidPaise, immutable: true }; const row: EntityRow = { id: `invoice_snapshot_${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '_')}`, entity: 'canonical_invoice_snapshot', tenant, status: 'Submitted', version: 1, created_by: actor, created_at: issuedAt, updated_at: issuedAt, data: snapshot }; store.insertRow(row); return row;
}

/**
 * Create the immutable, positive-valued tax evidence for a full sales reversal.
 * Credit notes retain the original invoice's line-level tax snapshot; the
 * document type and reference make the accounting direction explicit.
 */
export function createCanonicalCreditNoteSnapshot(tenant: string, actor: string, input: { sourceOrderId: string; issuedAt?: string; supplier: SupplierTaxProfile; customer: CanonicalInvoiceSnapshot['customer']; tax: CanonicalTaxSnapshot; referenceInvoiceNumber: string; reason: string }) {
  const sourceOrderId = String(input.sourceOrderId || '').trim(); if (!sourceOrderId) throw new Error('source order ID is required');
  const existing = store.rowsOf(tenant, 'canonical_invoice_snapshot').find((candidate) => candidate.data.sourceOrderId === sourceOrderId); if (existing) return existing;
  const supplier = profile(input.supplier); const issuedAt = input.issuedAt || new Date().toISOString(); const date = new Date(issuedAt); if (!Number.isFinite(date.getTime())) throw new Error('invalid credit note date'); const financialYear = fy(date); const sequence = store.nextSeq(`credit-note:${tenant}:${store.currentStore(tenant)}:${financialYear}`); const invoiceNumber = `${supplier.invoiceSeries || 'INV'}/CN/${financialYear}/${String(sequence).padStart(5, '0')}`;
  const snapshot: CanonicalInvoiceSnapshot = { invoiceNumber, documentType: 'CreditNote', issuedAt, financialYear, sourceOrderId, supplier, customer: input.customer, tax: structuredClone(input.tax), paidPaise: 0, outstandingPaise: 0, referenceInvoiceNumber: String(input.referenceInvoiceNumber || '').trim(), reason: String(input.reason || '').trim().slice(0, 500), immutable: true };
  const row: EntityRow = { id: `invoice_snapshot_${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '_')}`, entity: 'canonical_invoice_snapshot', tenant, status: 'Submitted', version: 1, created_by: actor, created_at: issuedAt, updated_at: issuedAt, data: snapshot }; store.insertRow(row); return row;
}

/**
 * Create a debit-note snapshot only when the caller has an approved business
 * and tax applicability decision. The local edge never infers that a debit
 * note is legally applicable from a customer or invoice shape.
 */
export function createCanonicalDebitNoteSnapshot(tenant: string, actor: string, input: { sourceOrderId: string; issuedAt?: string; supplier: SupplierTaxProfile; customer: CanonicalInvoiceSnapshot['customer']; tax: CanonicalTaxSnapshot; referenceInvoiceNumber: string; reason: string; applicabilityApproved: boolean }) {
  const sourceOrderId = String(input.sourceOrderId || '').trim(); if (!sourceOrderId) throw new Error('source order ID is required');
  if (input.applicabilityApproved !== true) throw new Error('DEBIT_NOTE_APPLICABILITY_UNAPPROVED');
  const referenceInvoiceNumber = String(input.referenceInvoiceNumber || '').trim(); const reason = String(input.reason || '').trim().slice(0, 500);
  if (!referenceInvoiceNumber || !reason) throw new Error('DEBIT_NOTE_INVALID');
  const existing = store.rowsOf(tenant, 'canonical_invoice_snapshot').find((candidate) => candidate.data.sourceOrderId === sourceOrderId); if (existing) return existing;
  const supplier = profile(input.supplier); const issuedAt = input.issuedAt || new Date().toISOString(); const date = new Date(issuedAt); if (!Number.isFinite(date.getTime())) throw new Error('invalid debit note date'); const financialYear = fy(date); const sequence = store.nextSeq(`debit-note:${tenant}:${store.currentStore(tenant)}:${financialYear}`); const invoiceNumber = `${supplier.invoiceSeries || 'INV'}/DN/${financialYear}/${String(sequence).padStart(5, '0')}`;
  const totalPaise = input.tax.totals.totalPaise; if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) throw new Error('DEBIT_NOTE_INVALID');
  const snapshot: CanonicalInvoiceSnapshot = { invoiceNumber, documentType: 'DebitNote', issuedAt, financialYear, sourceOrderId, supplier, customer: input.customer, tax: structuredClone(input.tax), paidPaise: 0, outstandingPaise: totalPaise, referenceInvoiceNumber, reason, immutable: true };
  const row: EntityRow = { id: `invoice_snapshot_${invoiceNumber.replace(/[^A-Za-z0-9]+/g, '_')}`, entity: 'canonical_invoice_snapshot', tenant, status: 'Submitted', version: 1, created_by: actor, created_at: issuedAt, updated_at: issuedAt, data: snapshot }; store.insertRow(row); return row;
}
