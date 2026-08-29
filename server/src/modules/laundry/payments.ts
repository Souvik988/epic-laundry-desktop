import { audit } from '../../kernel/audit.js';
import { cancelRow, createRow, submitRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { appendCustomerLedger } from './customers.js';
import { notify } from '../crm/engagement.js';
import { laundryBusinessDate } from './dates.js';
import { parseMoney, moneyNumber } from '../../kernel/money.js';
import { cashShiftForTransaction } from './cash.js';

export type LaundryPaymentMode = 'Cash' | 'UPI' | 'Card' | 'Bank';
export type LaundryPaymentInput = { amount: number | string; mode: LaundryPaymentMode; register?: string; reference?: string; note?: string; providerStatus?: 'Manual' | 'Confirmed' };

const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const today = () => laundryBusinessDate();

function orderRow(tenant: string, orderId: string, allowCancelled = false) {
  const order = store.getRow(tenant, orderId);
  if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
  if (!allowCancelled && order.data.state === 'Cancelled') throw new Error('cancelled orders cannot receive payments');
  const invoice = store.getRow(tenant, String(order.data.invoice || ''));
  if (!invoice || invoice.entity !== 'sales_invoice' || (!allowCancelled && invoice.status === 'Cancelled')) throw new Error('the order has no active invoice');
  return { order, invoice };
}

function validPayments(tenant: string, invoiceId: string) {
  return store.rowsOf(tenant, 'payment_entry').filter((payment) => payment.entity === 'payment_entry' && payment.status === 'Submitted' && payment.data.payment_type === 'Receive' && payment.data.against_sales === invoiceId);
}

function normalizedAmount(tenant: string, documentType: string, sourceEntity: string, sourceId: string, fallback: unknown, label: string) {
  const amountPaise = store.financialDocumentAmountPaise(tenant, documentType, sourceEntity, sourceId);
  return moneyNumber(amountPaise === undefined ? parseMoney(fallback ?? 0, label, { allowZero: true }) : amountPaise);
}
function invoiceAmount(tenant: string, invoice: EntityRow, order: EntityRow) { return round(normalizedAmount(tenant, 'invoice', invoice.entity, invoice.id, invoice.data.grand_total || order.data.grand_total, `invoice ${invoice.id} total`)); }
function paymentAmount(tenant: string, payment: EntityRow, documentType = 'payment') { return round(normalizedAmount(tenant, documentType, payment.entity, payment.id, payment.data.amount, `${documentType} ${payment.id}`)); }
function paidAmount(tenant: string, invoiceId: string) { return round(validPayments(tenant, invoiceId).reduce((sum, payment) => sum + paymentAmount(tenant, payment), 0)); }

function paymentStatus(total: number, paid: number) { return paid >= total && total > 0 ? 'Paid' : paid > 0 ? 'Part Paid' : 'Unpaid'; }

function syncOrderPaymentState(order: EntityRow, total: number, paid: number, latestPayment?: string) {
  order.data.payment_status = paymentStatus(total, paid);
  if (latestPayment) order.data.last_payment_entry = latestPayment;
  order.updated_at = new Date().toISOString();
  store.updateRow(order);
}

export function laundryPaymentSummary(tenant: string, orderId: string) {
  const { order, invoice } = orderRow(tenant, orderId, true);
  const total = invoiceAmount(tenant, invoice, order);
  const payments = validPayments(tenant, invoice.id).map((payment) => ({ id: payment.id, amount: paymentAmount(tenant, payment), mode: String(payment.data.mode || 'Cash'), reference: String(payment.data.reference || ''), providerStatus: String(payment.data.provider_status || 'Manual'), postingDate: String(payment.data.posting_date || ''), remarks: String(payment.data.remarks || '') }));
  const paid = round(payments.reduce((sum, payment) => sum + payment.amount, 0));
  return { orderId: order.id, invoiceId: invoice.id, invoiceNumber: String(invoice.data.name || invoice.id), total, paid, outstanding: Math.max(0, round(total - paid)), status: paymentStatus(total, paid), payments, provider: { mode: 'manual-safe', onlineConfirmation: false, note: 'No payment gateway is configured; UPI/Card entries are recorded as operator-confirmed local evidence.' } };
}

export function collectLaundryPayment(tenant: string, actor: string, orderId: string, input: LaundryPaymentInput) {
  return store.transaction(() => {
    const { order, invoice } = orderRow(tenant, orderId);
    const total = invoiceAmount(tenant, invoice, order);
    const currentPaid = paidAmount(tenant, invoice.id);
    const amount = moneyNumber(parseMoney(input.amount, 'payment amount'));
    if (amount <= 0) throw new Error('payment amount must be greater than zero');
    if (amount > round(total - currentPaid)) throw new Error(`payment exceeds outstanding amount (${round(total - currentPaid).toFixed(2)})`);
    if (!['Cash', 'UPI', 'Card', 'Bank'].includes(input.mode)) throw new Error('unsupported payment method');
    if (input.providerStatus === 'Confirmed') throw new Error('online provider confirmation is unavailable; record this collection as manual');
    const cashShift = input.mode === 'Cash' ? cashShiftForTransaction(tenant, input.register) : undefined;
    const reference = String(input.reference || '').trim().slice(0, 120);
    const remarks = String(input.note || '').trim().slice(0, 500) || `Laundry collection for ${String(invoice.data.name || invoice.id)}`;
    const payment = createRow(tenant, actor, 'payment_entry', { payment_type: 'Receive', party: order.data.customer, posting_date: today(), mode: input.mode, amount, against_sales: invoice.id, reference, provider_status: 'Manual', remarks, cash_shift_id: cashShift?.id, cash_register: cashShift?.data.register });
    submitRow(tenant, actor, 'payment_entry', payment.id);
    store.appendFinancialEntry({ id: `money:${payment.id}:collection`, tenant, storeId: store.currentStore(tenant), kind: 'collection', sourceEntity: 'payment_entry', sourceId: payment.id, direction: 'IN', amountPaise: parseMoney(amount, 'payment amount'), currency: 'INR', occurredAt: payment.created_at, actor, metadata: { mode: input.mode, invoiceId: invoice.id, orderId: order.id } });
    store.appendFinancialDocument({ id: `doc:${payment.id}`, tenant, storeId: store.currentStore(tenant), documentType: 'payment', sourceEntity: 'payment_entry', sourceId: payment.id, amountPaise: parseMoney(amount, 'payment amount'), currency: 'INR', status: payment.status, occurredAt: payment.created_at, actor, metadata: { mode: input.mode, invoiceId: invoice.id, orderId: order.id } });
    const paid = round(currentPaid + amount);
    syncOrderPaymentState(order, total, paid, payment.id);
    appendCustomerLedger(tenant, actor, { customer: String(order.data.customer), entryType: 'Payment Credit', credit: amount, referenceType: 'payment_entry', referenceId: payment.id, reason: remarks });
    audit(tenant, actor, 'laundry:payment-collected', { entity: 'payment_entry', row_id: payment.id, after: { order: order.id, invoice: invoice.id, amount, mode: input.mode, paid, outstanding: round(total - paid), providerStatus: 'Manual' } });
    notify(tenant, { title: `Payment received for ${order.data.name || order.id}`, body: `₹${amount.toFixed(2)} via ${input.mode}; ${round(total - paid).toFixed(2)} outstanding.`, kind: 'Payment', severity: 'info', ref_entity: 'laundry_order', ref_id: order.id });
    return { payment: { id: payment.id, amount, mode: input.mode, reference, providerStatus: 'Manual' }, summary: laundryPaymentSummary(tenant, order.id) };
  });
}

export function reverseLaundryPayment(tenant: string, actor: string, paymentId: string, reason: string) {
  return store.transaction(() => {
    const payment = store.getRow(tenant, paymentId);
    if (!payment || payment.entity !== 'payment_entry') throw new Error('payment not found');
    if (payment.status !== 'Submitted' || payment.data.payment_type !== 'Receive' || !payment.data.against_sales) throw new Error('only submitted laundry collections can be reversed');
    const note = String(reason || '').trim().slice(0, 500);
    if (!note) throw new Error('payment reversal reason is required');
    const invoice = store.getRow(tenant, String(payment.data.against_sales));
    const order = invoice ? store.rowsOf(tenant, 'laundry_order').find((candidate) => candidate.data.invoice === invoice.id) : undefined;
    if (!invoice || !order) throw new Error('payment invoice/order linkage is missing');
    const cancelled = cancelRow(tenant, actor, 'payment_entry', payment.id);
    // cancelRow persists a fresh row; continue with that version so provider metadata
    // cannot accidentally write the stale Submitted status back over the cancellation.
    cancelled.data.provider_status = 'Reversed';
    cancelled.data.reversal_reason = note;
    cancelled.updated_at = new Date().toISOString();
    store.updateRow(cancelled);
    const amount = paymentAmount(tenant, payment);
    store.appendFinancialEntry({ id: `money:${payment.id}:refund`, tenant, storeId: store.currentStore(tenant), kind: 'refund', sourceEntity: 'payment_entry', sourceId: payment.id, direction: 'OUT', amountPaise: parseMoney(amount, 'refund amount'), currency: 'INR', occurredAt: cancelled.updated_at, actor, metadata: { invoiceId: invoice.id, orderId: order.id, reason: note } });
    store.appendFinancialDocument({ id: `doc:${payment.id}:refund`, tenant, storeId: store.currentStore(tenant), documentType: 'refund', sourceEntity: 'payment_entry', sourceId: payment.id, amountPaise: parseMoney(amount, 'refund amount'), currency: 'INR', status: 'Posted', occurredAt: cancelled.updated_at, actor, metadata: { invoiceId: invoice.id, orderId: order.id, reason: note } });
    appendCustomerLedger(tenant, actor, { customer: String(order.data.customer), entryType: 'Refund', debit: amount, referenceType: 'payment_entry', referenceId: payment.id, reason: note });
    const total = invoiceAmount(tenant, invoice, order);
    syncOrderPaymentState(order, total, paidAmount(tenant, invoice.id));
    audit(tenant, actor, 'laundry:payment-reversed', { entity: 'payment_entry', row_id: payment.id, before: { status: 'Submitted', amount }, after: { status: 'Cancelled', reason: note } });
    return laundryPaymentSummary(tenant, order.id);
  });
}
