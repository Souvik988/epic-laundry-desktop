import { parseMoney, moneyNumber } from '../../kernel/money.js';
import { store } from '../../kernel/store.js';

type Issue = { code: string; entity: string; id: string; message: string };

function paise(value: unknown, label: string) {
  return parseMoney(value ?? 0, label, { allowZero: true });
}
function authoritativeDocumentAmount(tenant: string, documentType: string, source: { entity: string; id: string }, fallback: unknown, label: string) {
  const normalized = store.financialDocumentAmountPaise(tenant, documentType, source.entity, source.id);
  return normalized === undefined ? paise(fallback, label) : normalized;
}
function authoritativeEntryAmount(tenant: string, kind: string, source: { entity: string; id: string }, fallback: unknown, label: string) {
  const normalized = store.financialEntryAmountPaise(tenant, kind, source.entity, source.id);
  return normalized === undefined ? paise(fallback, label) : normalized;
}

/**
 * Read-only financial control report. It deliberately does not “fix” data: a
 * mismatch is returned as an actionable exception for a controlled correction.
 */
export function laundryFinancialReconciliation(tenant: string) {
  const issues: Issue[] = [];
  let invoicePaise = 0;
  let collectedPaise = 0;
  let refundPaise = 0;
  let expensePaise = 0;
  let canonicalInPaise = 0;
  let canonicalOutPaise = 0;
  const financialEntries = store.listFinancialEntries(tenant);
  const expectedMoney = new Map<string, { amountPaise: number; kind: string; sourceEntity: string; sourceId: string }>();
  const expected = (kind: string, sourceEntity: string, sourceId: string, amount: number) => expectedMoney.set(`${sourceEntity}:${sourceId}:${kind}`, { amountPaise: amount, kind, sourceEntity, sourceId });
  const paymentsByInvoice = new Map<string, number>();
  const orderByInvoice = new Map<string, { id: string; total: number; customer: string }>();
  for (const order of store.rowsOf(tenant, 'laundry_order')) {
    const rawTotal = order.data.grand_total ?? 0;
    let total: number;
    const invoiceId = String(order.data.invoice || '');
    const invoice = invoiceId ? store.getRow(tenant, invoiceId) : undefined;
    try {
      const legacyOrderTotal = paise(rawTotal, `order ${order.id} total`);
      const normalizedInvoiceTotal = invoice?.entity === 'sales_invoice' ? store.financialDocumentAmountPaise(tenant, 'invoice', invoice.entity, invoice.id) : undefined;
      total = normalizedInvoiceTotal === undefined ? legacyOrderTotal : normalizedInvoiceTotal;
      if (normalizedInvoiceTotal !== undefined && normalizedInvoiceTotal !== legacyOrderTotal) issues.push({ code: 'INVOICE_ORDER_MISMATCH', entity: order.entity, id: order.id, message: `normalized invoice total ${moneyNumber(normalizedInvoiceTotal).toFixed(2)} differs from order compatibility total ${moneyNumber(legacyOrderTotal).toFixed(2)}` });
    } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: order.entity, id: order.id, message: error.message }); continue; }
    if (order.data.state !== 'Cancelled') {
      invoicePaise += total;
      orderByInvoice.set(invoiceId, { id: order.id, total, customer: String(order.data.customer || '') });
    }
    if (invoice && invoice.entity === 'sales_invoice') {
      let invoiceTotal: number;
      try { invoiceTotal = authoritativeDocumentAmount(tenant, 'invoice', invoice, invoice.data.grand_total ?? order.data.grand_total, `invoice ${invoice.id} total`); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: invoice.entity, id: invoice.id, message: error.message }); continue; }
      if (invoice.status !== 'Cancelled' && invoiceTotal !== total) issues.push({ code: 'INVOICE_ORDER_MISMATCH', entity: order.entity, id: order.id, message: `order total ${moneyNumber(total).toFixed(2)} differs from invoice total ${moneyNumber(invoiceTotal).toFixed(2)}` });
    } else if (order.data.state !== 'Cancelled') issues.push({ code: 'MISSING_INVOICE_LINK', entity: order.entity, id: order.id, message: 'active order has no linked sales invoice' });
  }
  for (const payment of store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Submitted' && row.data.payment_type === 'Receive')) {
    const invoiceId = String(payment.data.against_sales || '');
    let amount: number;
    try { amount = authoritativeDocumentAmount(tenant, 'payment', payment, payment.data.amount, `payment ${payment.id}`); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: payment.entity, id: payment.id, message: error.message }); continue; }
    if (amount <= 0) issues.push({ code: 'NON_POSITIVE_PAYMENT', entity: payment.entity, id: payment.id, message: 'submitted collection must be greater than zero' });
    collectedPaise += amount;
    paymentsByInvoice.set(invoiceId, (paymentsByInvoice.get(invoiceId) || 0) + amount);
    const order = orderByInvoice.get(invoiceId);
    if (!order) issues.push({ code: 'ORPHAN_PAYMENT', entity: payment.entity, id: payment.id, message: `collection is not linked to an active order invoice (${invoiceId || 'missing'})` });
    expected('collection', payment.entity, payment.id, amount);
  }
  for (const payment of store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Cancelled' && row.data.payment_type === 'Receive' && row.data.provider_status === 'Reversed')) {
    try { const amount = authoritativeEntryAmount(tenant, 'refund', payment, payment.data.amount, `refund ${payment.id}`); refundPaise += amount; expected('refund', payment.entity, payment.id, amount); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: payment.entity, id: payment.id, message: error.message }); }
  }
  for (const [invoiceId, paid] of paymentsByInvoice) {
    const order = orderByInvoice.get(invoiceId);
    if (order && paid > order.total) issues.push({ code: 'OVERPAYMENT', entity: 'payment_entry', id: invoiceId, message: `collections ${moneyNumber(paid).toFixed(2)} exceed invoice ${moneyNumber(order.total).toFixed(2)}` });
  }
  for (const expense of store.rowsOf(tenant, 'laundry_expense').filter((row) => row.status !== 'Cancelled')) {
    try { const amount = authoritativeEntryAmount(tenant, 'expense', expense, expense.data.amount, `expense ${expense.id}`); expensePaise += amount; expected('expense', expense.entity, expense.id, amount); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: expense.entity, id: expense.id, message: error.message }); }
  }
  for (const pkg of store.rowsOf(tenant, 'customer_package').filter((row) => row.data.payment_mode && row.data.payment_mode !== 'Pay Later' && Number(row.data.price_paid || 0) > 0)) {
    try { expected('package-payment', pkg.entity, pkg.id, authoritativeEntryAmount(tenant, 'package-payment', pkg, pkg.data.price_paid, `package ${pkg.id} payment`)); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: pkg.entity, id: pkg.id, message: error.message }); }
  }
  for (const payment of store.rowsOf(tenant, 'customer_package_payment').filter((row) => row.status !== 'Cancelled')) {
    try { expected('package-payment', payment.entity, payment.id, authoritativeEntryAmount(tenant, 'package-payment', payment, payment.data.amount, `package payment ${payment.id}`)); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: payment.entity, id: payment.id, message: error.message }); }
  }
  for (const entry of financialEntries) {
    if (entry.direction === 'IN') canonicalInPaise += entry.amountPaise; else canonicalOutPaise += entry.amountPaise;
    const key = `${entry.sourceEntity}:${entry.sourceId}:${entry.kind}`;
    const source = expectedMoney.get(key);
    if (!source) issues.push({ code: 'ORPHAN_FINANCIAL_ENTRY', entity: 'financial_entries', id: entry.id, message: `financial entry points to no current source (${key})` });
    else if (source.amountPaise !== entry.amountPaise) issues.push({ code: 'FINANCIAL_AMOUNT_MISMATCH', entity: 'financial_entries', id: entry.id, message: `canonical ${entry.amountPaise} paise differs from source ${source.amountPaise} paise` });
    expectedMoney.delete(key);
  }
  for (const source of expectedMoney.values()) issues.push({ code: 'MISSING_FINANCIAL_ENTRY', entity: source.sourceEntity, id: source.sourceId, message: `missing canonical ${source.kind} financial entry` });
  const financialDocuments = store.listFinancialDocuments(tenant);
  const documentAmount = (document: ReturnType<typeof store.listFinancialDocuments>[number]) => {
    const source = store.getRow(tenant, document.sourceId);
    if (!source) return { source: undefined, amountPaise: undefined };
    // A customer_package row keeps `price_paid` as a mutable aggregate for
    // liability presentation after later balance collections. Its original
    // payment document is immutable, so validate against the canonical entry
    // when one exists instead of treating the aggregate as the original receipt.
    const packageEntryAmount = document.documentType === 'package-payment' && source.entity === 'customer_package'
      ? store.financialEntryAmountPaise(tenant, 'package-payment', source.entity, source.id)
      : undefined;
    if (packageEntryAmount !== undefined) return { source, amountPaise: packageEntryAmount };
    const raw = document.documentType === 'invoice' ? source.data.grand_total : document.documentType === 'package-payment' ? (source.entity === 'customer_package_payment' ? source.data.amount : packageEntryAmount ?? source.data.price_paid) : source.data.amount;
    try { return { source, amountPaise: paise(raw ?? 0, `${document.documentType} ${document.sourceId}`) }; } catch (error: any) {
      issues.push({ code: 'INVALID_MONEY', entity: document.sourceEntity, id: document.sourceId, message: error.message });
      return { source, amountPaise: undefined };
    }
  };
  let validatedDocumentCount = 0;
  for (const document of financialDocuments) {
    const { source, amountPaise } = documentAmount(document);
    if (!source || source.entity !== document.sourceEntity) issues.push({ code: 'ORPHAN_FINANCIAL_DOCUMENT', entity: 'financial_documents', id: document.id, message: `normalized document points to missing source (${document.sourceEntity}:${document.sourceId})` });
    else if (amountPaise !== undefined && amountPaise !== document.amountPaise) issues.push({ code: 'FINANCIAL_DOCUMENT_AMOUNT_MISMATCH', entity: 'financial_documents', id: document.id, message: `normalized ${document.amountPaise} paise differs from source ${amountPaise} paise` });
    else if (amountPaise !== undefined) validatedDocumentCount += 1;
  }
  let journalDebitPaise = 0;
  let journalCreditPaise = 0;
  for (const journal of store.rowsOf(tenant, 'journal_entry').filter((row) => row.status === 'Submitted')) {
    const entries = Array.isArray(journal.data.entries) ? journal.data.entries as Array<Record<string, unknown>> : [];
    let debit = 0; let credit = 0;
    for (const entry of entries) {
      try { debit += paise(entry.debit ?? 0, `journal ${journal.id} debit`); credit += paise(entry.credit ?? 0, `journal ${journal.id} credit`); } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: journal.entity, id: journal.id, message: error.message }); }
    }
    journalDebitPaise += debit; journalCreditPaise += credit;
    if (debit !== credit) issues.push({ code: 'UNBALANCED_JOURNAL', entity: journal.entity, id: journal.id, message: `debit ${moneyNumber(debit).toFixed(2)} does not equal credit ${moneyNumber(credit).toFixed(2)}` });
  }
  for (const shift of store.rowsOf(tenant, 'laundry_cash_shift').filter((row) => row.status === 'Closed')) {
    try {
      const normalizedClose = store.cashShiftCloseFor(tenant, shift.id);
      const opening = paise(shift.data.opening_cash, `cash shift ${shift.id} opening`);
      const inShift = (row: any) => row.data.cash_shift_id === shift.id || (!row.data.cash_shift_id && row.created_at >= shift.created_at);
      const collections = store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Submitted' && row.data.payment_type === 'Receive' && row.data.mode === 'Cash' && inShift(row)).reduce((sum, row) => sum + authoritativeDocumentAmount(tenant, 'payment', row, row.data.amount, `payment ${row.id}`), 0);
      const expenses = store.rowsOf(tenant, 'laundry_expense').filter((row) => row.status === 'Paid' && row.data.payment_mode === 'Cash' && inShift(row)).reduce((sum, row) => sum + authoritativeEntryAmount(tenant, 'expense', row, row.data.amount, `expense ${row.id}`), 0);
      const refunds = store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Cancelled' && row.data.payment_type === 'Receive' && row.data.mode === 'Cash' && row.data.provider_status === 'Reversed' && inShift(row)).reduce((sum, row) => sum + authoritativeEntryAmount(tenant, 'refund', row, row.data.amount, `refund ${row.id}`), 0);
      const expectedCash = opening + collections - expenses - refunds;
      const persistedExpected = paise(shift.data.expected_cash, `cash shift ${shift.id} expected`);
      if (persistedExpected !== expectedCash) issues.push({ code: 'CASH_CLOSE_MISMATCH', entity: shift.entity, id: shift.id, message: `persisted expected cash ${moneyNumber(persistedExpected).toFixed(2)} differs from canonical movement total ${moneyNumber(expectedCash).toFixed(2)}` });
      if (!normalizedClose) issues.push({ code: 'MISSING_CASH_CLOSE_SNAPSHOT', entity: shift.entity, id: shift.id, message: 'closed shift has no normalized paise close snapshot' });
      else {
        if (normalizedClose.expectedCashPaise !== expectedCash) issues.push({ code: 'CASH_CLOSE_SNAPSHOT_MISMATCH', entity: 'cash_shift_closes', id: normalizedClose.id, message: `normalized expected cash ${moneyNumber(normalizedClose.expectedCashPaise).toFixed(2)} differs from canonical movement total ${moneyNumber(expectedCash).toFixed(2)}` });
        const normalizedVariance = normalizedClose.countedCashPaise - normalizedClose.expectedCashPaise;
        if (normalizedClose.variancePaise !== normalizedVariance) issues.push({ code: 'CASH_CLOSE_VARIANCE_MISMATCH', entity: 'cash_shift_closes', id: normalizedClose.id, message: 'normalized counted, expected, and variance values do not reconcile' });
        if (normalizedClose.openingCashPaise !== opening || normalizedClose.collectionsPaise !== collections || normalizedClose.expensesPaise !== expenses || normalizedClose.refundsPaise !== refunds) issues.push({ code: 'CASH_CLOSE_COMPONENT_MISMATCH', entity: 'cash_shift_closes', id: normalizedClose.id, message: 'normalized close component totals differ from canonical movements' });
      }
    } catch (error: any) { issues.push({ code: 'INVALID_MONEY', entity: shift.entity, id: shift.id, message: error.message }); }
  }
  const cashCloseRows = store.listCashShiftCloses(tenant);
  const cashClosedShifts = store.rowsOf(tenant, 'laundry_cash_shift').filter((row) => row.status === 'Closed');
  const cashSnapshotTotals = cashCloseRows.reduce((totals, close) => ({
    openingPaise: totals.openingPaise + close.openingCashPaise, collectionsPaise: totals.collectionsPaise + close.collectionsPaise,
    expensesPaise: totals.expensesPaise + close.expensesPaise, refundsPaise: totals.refundsPaise + close.refundsPaise,
    expectedPaise: totals.expectedPaise + close.expectedCashPaise, countedPaise: totals.countedPaise + close.countedCashPaise,
    variancePaise: totals.variancePaise + close.variancePaise,
  }), { openingPaise: 0, collectionsPaise: 0, expensesPaise: 0, refundsPaise: 0, expectedPaise: 0, countedPaise: 0, variancePaise: 0 });
  return {
    asOf: new Date().toISOString(), currency: 'INR', status: issues.length ? 'Attention required' : 'Reconciled',
    totals: { invoicePaise, invoice: moneyNumber(invoicePaise), collectedPaise, collected: moneyNumber(collectedPaise), refundPaise, refunds: moneyNumber(refundPaise), outstandingPaise: Math.max(0, invoicePaise - collectedPaise + refundPaise), outstanding: moneyNumber(Math.max(0, invoicePaise - collectedPaise + refundPaise)), expensePaise, expenses: moneyNumber(expensePaise), canonicalInPaise, canonicalIn: moneyNumber(canonicalInPaise), canonicalOutPaise, canonicalOut: moneyNumber(canonicalOutPaise), canonicalNetPaise: canonicalInPaise - canonicalOutPaise, canonicalNet: moneyNumber(canonicalInPaise - canonicalOutPaise) },
    journals: { debitPaise: journalDebitPaise, creditPaise: journalCreditPaise, debit: moneyNumber(journalDebitPaise), credit: moneyNumber(journalCreditPaise), balanced: journalDebitPaise === journalCreditPaise },
    normalization: { documentCount: financialDocuments.length, validatedDocumentCount, note: 'Normalized financial documents are append-safe mirrors of source records; legacy JSON source fields still require a controlled backfill before they become authoritative.' },
    cash: {
      closedShiftCount: cashClosedShifts.length, normalizedCloseCount: cashCloseRows.length,
      missingSnapshotCount: Math.max(0, cashClosedShifts.length - cashCloseRows.length),
      totals: { ...cashSnapshotTotals, opening: moneyNumber(cashSnapshotTotals.openingPaise), collections: moneyNumber(cashSnapshotTotals.collectionsPaise), expenses: moneyNumber(cashSnapshotTotals.expensesPaise), refunds: moneyNumber(cashSnapshotTotals.refundsPaise), expected: moneyNumber(cashSnapshotTotals.expectedPaise), counted: moneyNumber(cashSnapshotTotals.countedPaise), variance: moneyNumber(cashSnapshotTotals.variancePaise) },
      shifts: cashCloseRows.slice(0, 200).map((close) => ({ id: close.shiftId, register: close.register, businessDate: close.businessDate, expected: moneyNumber(close.expectedCashPaise), counted: moneyNumber(close.countedCashPaise), variance: moneyNumber(close.variancePaise), closedAt: close.closedAt, closedBy: close.closedBy, supervisorActor: close.supervisorActor || null })),
    },
    checks: { issueCount: issues.length, passed: issues.length === 0 }, issues: issues.slice(0, 200), truncated: issues.length > 200,
  };
}

/** Focused daily-close drill. It recomputes each normalized closed-shift
 * equation without mutating the ledger, so an owner can prove that the drawer
 * snapshot still agrees with its fixed-scale components after a restart. */
export function cashCloseDrill(tenant: string, businessDate?: string) {
  const wantedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(businessDate || '')) ? String(businessDate) : undefined;
  const sourceIssues = laundryFinancialReconciliation(tenant).issues.filter((issue) => issue.entity === 'laundry_cash_shift' || issue.entity === 'cash_shift_closes');
  const shifts = store.listCashShiftCloses(tenant).filter((close) => !wantedDate || close.businessDate === wantedDate).map((close) => {
    const expectedPaise = close.openingCashPaise + close.collectionsPaise - close.expensesPaise - close.refundsPaise;
    const variancePaise = close.countedCashPaise - close.expectedCashPaise;
    const checks = { equation: expectedPaise === close.expectedCashPaise, variance: variancePaise === close.variancePaise, fixedScale: Number.isSafeInteger(close.openingCashPaise) && Number.isSafeInteger(close.collectionsPaise) && Number.isSafeInteger(close.expensesPaise) && Number.isSafeInteger(close.refundsPaise) && Number.isSafeInteger(close.expectedCashPaise) && Number.isSafeInteger(close.countedCashPaise) && Number.isSafeInteger(close.variancePaise) };
    const relatedIssues = sourceIssues.filter((issue) => issue.id === close.shiftId || issue.id === close.id);
    return { shiftId: close.shiftId, register: close.register, businessDate: close.businessDate, closedAt: close.closedAt, closedBy: close.closedBy, expectedPaise: close.expectedCashPaise, countedPaise: close.countedCashPaise, variancePaise: close.variancePaise, checks, issueCount: relatedIssues.length, passed: Object.values(checks).every(Boolean) && relatedIssues.length === 0 };
  });
  const passed = shifts.every((shift) => shift.passed);
  return { asOf: new Date().toISOString(), businessDate: wantedDate || null, currency: 'INR', totalShifts: shifts.length, passed, status: passed ? 'Reconciled' : 'Attention required', shifts, issues: sourceIssues.slice(0, 200), truncated: sourceIssues.length > 200 };
}
