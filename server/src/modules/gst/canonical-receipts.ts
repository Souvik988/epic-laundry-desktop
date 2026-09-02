import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import type { CanonicalInvoiceSnapshot, SupplierTaxProfile } from './invoice-snapshot.js';

export type CanonicalReceiptSnapshot = {
  documentType: 'PaymentReceipt' | 'RefundReceipt';
  receiptNumber: string;
  issuedAt: string;
  financialYear: string;
  sourcePaymentId: string;
  referenceInvoiceNumber: string;
  supplier: SupplierTaxProfile;
  customer: CanonicalInvoiceSnapshot['customer'];
  amountPaise: number;
  currency: 'INR';
  method?: string;
  reference?: string;
  reason?: string;
  providerEvidence?: Record<string, unknown>;
  immutable: true;
};

function financialYear(issuedAt: string) {
  const date = new Date(issuedAt); if (!Number.isFinite(date.getTime())) throw new Error('invalid receipt date');
  const start = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
function positivePaise(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('receipt amount must be positive integer paise'); return Number(value); }
function supplier(input: SupplierTaxProfile) { if (!input?.legalName || !input.address || !/^\d{2}$/.test(input.stateCode) || !/^\d{6}$/.test(input.pincode)) throw new Error('TAX_PROFILE_INCOMPLETE'); return structuredClone(input); }

export function createCanonicalReceiptSnapshot(tenant: string, actor: string, input: {
  documentType: CanonicalReceiptSnapshot['documentType']; sourcePaymentId: string; issuedAt?: string; invoice: CanonicalInvoiceSnapshot; amountPaise: number; method?: string; reference?: string; reason?: string; providerEvidence?: Record<string, unknown>;
}) {
  const sourcePaymentId = String(input.sourcePaymentId || '').trim(); if (!sourcePaymentId) throw new Error('receipt source payment is required');
  const existing = store.rowsOf(tenant, 'canonical_receipt_snapshot').find((candidate) => candidate.data.documentType === input.documentType && candidate.data.sourcePaymentId === sourcePaymentId);
  if (existing) return existing;
  const issuedAt = input.issuedAt || new Date().toISOString(); const financialYearValue = financialYear(issuedAt); const amountPaise = positivePaise(input.amountPaise); const profile = supplier(input.invoice.supplier);
  const prefix = input.documentType === 'PaymentReceipt' ? 'RCPT' : 'REF'; const sequence = store.nextSeq(`${prefix}:${tenant}:${store.currentStore(tenant)}:${financialYearValue}`); const receiptNumber = `${profile.invoiceSeries || 'INV'}/${prefix}/${financialYearValue}/${String(sequence).padStart(5, '0')}`;
  const snapshot: CanonicalReceiptSnapshot = { documentType: input.documentType, receiptNumber, issuedAt, financialYear: financialYearValue, sourcePaymentId, referenceInvoiceNumber: input.invoice.invoiceNumber, supplier: profile, customer: structuredClone(input.invoice.customer), amountPaise, currency: 'INR', method: input.method ? String(input.method).trim().slice(0, 40) : undefined, reference: input.reference ? String(input.reference).trim().slice(0, 160) : undefined, reason: input.reason ? String(input.reason).trim().slice(0, 500) : undefined, providerEvidence: input.providerEvidence ? structuredClone(input.providerEvidence) : undefined, immutable: true };
  const timestamp = new Date(issuedAt).toISOString(); const row: EntityRow = { id: `receipt_snapshot_${receiptNumber.replace(/[^A-Za-z0-9]+/g, '_')}`, entity: 'canonical_receipt_snapshot', tenant, status: 'Submitted', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: snapshot };
  store.insertRow(row); return row;
}

export function renderCanonicalReceipt(snapshot: CanonicalReceiptSnapshot) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
  const money = `₹${(snapshot.amountPaise / 100).toFixed(2)}`;
  const title = snapshot.documentType === 'PaymentReceipt' ? 'PAYMENT RECEIPT' : 'REFUND RECEIPT';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)} ${escape(snapshot.receiptNumber)}</title><style>body{font:14px Arial,sans-serif;color:#17353c;margin:0;padding:28px;background:#fffdf8}main{max-width:720px;margin:auto;background:white;border:1px solid #d9e3de;padding:28px}header{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #39786f;padding-bottom:16px}.right{text-align:right}.muted{color:#617178}.box{border:1px solid #d9e3de;border-radius:8px;padding:14px;margin-top:18px}.amount{font-size:28px;font-weight:700;color:#39786f;margin-top:8px}dl{display:grid;grid-template-columns:170px 1fr;gap:9px 16px}dt{color:#718087}dd{margin:0;font-weight:600}footer{margin-top:22px;padding-top:12px;border-top:1px solid #d9e3de;color:#718087;font-size:12px}</style></head><body><main><header><div><h1>${escape(snapshot.supplier.tradeName || snapshot.supplier.legalName)}</h1><div>${escape(snapshot.supplier.address)}</div><div class="muted">State code ${escape(snapshot.supplier.stateCode)} · ${escape(snapshot.supplier.pincode)}</div>${snapshot.supplier.gstin ? `<div>GSTIN: ${escape(snapshot.supplier.gstin)}</div>` : ''}</div><div class="right"><h2>${escape(title)}</h2><div><b>${escape(snapshot.receiptNumber)}</b></div><div class="muted">${escape(snapshot.financialYear)} · ${escape(snapshot.issuedAt.slice(0, 10))}</div></div></header><section class="box"><b>Customer</b><br>${escape(snapshot.customer.name)}${snapshot.customer.gstin ? ` · GSTIN: ${escape(snapshot.customer.gstin)}` : ''}<br><span class="muted">${escape(snapshot.customer.address || '')}</span><div class="amount">${escape(money)}</div></section><section class="box"><dl><dt>Reference invoice</dt><dd>${escape(snapshot.referenceInvoiceNumber)}</dd><dt>Payment method</dt><dd>${escape(snapshot.method || 'Not recorded')}</dd>${snapshot.reference ? `<dt>Reference</dt><dd>${escape(snapshot.reference)}</dd>` : ''}${snapshot.reason ? `<dt>Reason</dt><dd>${escape(snapshot.reason)}</dd>` : ''}<dt>Currency</dt><dd>${escape(snapshot.currency)}</dd></dl></section><footer>This receipt is derived from the immutable local invoice/payment evidence. It does not claim external provider settlement or IRP evidence.</footer></main></body></html>`;
}
