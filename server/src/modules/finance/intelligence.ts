import { moneyNumber, parseMoney } from '../../kernel/money.js';
import { store } from '../../kernel/store.js';
import { getComplianceSummary } from '../compliance/returns.js';
import { financePolicyReadiness } from './regulatory-policy.js';
import { FINANCE_CLASSIFICATIONS, financeExpenseCategory, type FinanceExpenseCategory } from './classification.js';

type Range = { from: string; to: string };
type Point = { date: string; grossRevenuePaise: number; discountsPaise: number; refundsPaise: number; netRevenuePaise: number; collectedPaise: number; cashInPaise: number; cashOutPaise: number; expensesPaise: number };
type ExpenseBucket = { category: FinanceExpenseCategory; label: string; amountPaise: number; count: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateKey = (value: string) => value.slice(0, 10);
const addDays = (value: string, days: number) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const daysBetween = (from: string, to: string) => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
const rupees = (paise: number) => moneyNumber(paise);
const validRange = (from?: string, to?: string): Range => { const end = to || new Date().toISOString().slice(0, 10); const start = from || addDays(end, -29); if (!DATE.test(start) || !DATE.test(end) || start > end || daysBetween(start, end) > 366) throw new Error('FINANCE_DATE_RANGE_INVALID'); return { from: start, to: end }; };
const inRange = (date: string, range: Range) => date >= range.from && date <= range.to;
const safePaise = (value: unknown, label: string) => parseMoney(value ?? 0, label, { allowZero: true });

function documentAmount(tenant: string, type: string, row: { entity: string; id: string; data: Record<string, unknown> }, fallback: unknown, label: string) {
  return store.financialDocumentAmountPaise(tenant, type, row.entity, row.id) ?? safePaise(fallback, label);
}
function entryAmount(tenant: string, kind: string, row: { entity: string; id: string; data: Record<string, unknown> }, fallback: unknown, label: string) {
  return store.financialEntryAmountPaise(tenant, kind, row.entity, row.id) ?? safePaise(fallback, label);
}
function blankPoint(date: string): Point { return { date, grossRevenuePaise: 0, discountsPaise: 0, refundsPaise: 0, netRevenuePaise: 0, collectedPaise: 0, cashInPaise: 0, cashOutPaise: 0, expensesPaise: 0 }; }
function dailyPoints(range: Range) { const result = new Map<string, Point>(); for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) result.set(cursor, blankPoint(cursor)); return result; }
function increment(map: Map<string, Point>, date: string, key: Exclude<keyof Point, 'date'>, value: number) { const point = map.get(date); if (point) point[key] += value; }
function presentPoint(point: Point) { return { ...point, grossRevenue: rupees(point.grossRevenuePaise), discounts: rupees(point.discountsPaise), refunds: rupees(point.refundsPaise), netRevenue: rupees(point.netRevenuePaise), collected: rupees(point.collectedPaise), cashIn: rupees(point.cashInPaise), cashOut: rupees(point.cashOutPaise), expenses: rupees(point.expensesPaise) }; }
function percent(numerator: number, denominator: number) { return denominator ? Math.round(numerator * 10_000 / denominator) / 100 : null; }
function comparison(current: number, previous: number) { return { currentPaise: current, previousPaise: previous, current: rupees(current), previous: rupees(previous), changePaise: current - previous, change: rupees(current - previous), percent: percent(current - previous, previous) }; }

function aggregate(tenant: string, range: Range) {
  const trend = dailyPoints(range); const issues: string[] = [];
  let grossRevenuePaise = 0; let discountsPaise = 0; let taxPaise = 0; let activeOrders = 0;
  const service = new Map<string, number>(); const channel = new Map<string, number>();
  const invoiceTotals = new Map<string, { totalPaise: number; issuedDate: string; customer: string }>();
  for (const order of store.rowsOf(tenant, 'laundry_order')) {
    const orderDate = String(order.data.order_date || ''); if (!DATE.test(orderDate) || order.data.state === 'Cancelled') continue;
    const invoiceId = String(order.data.invoice || ''); const invoice = invoiceId ? store.getRow(tenant, invoiceId) : undefined;
    let totalPaise = 0; let subtotalPaise = 0; let chargePaise = 0; let discountPaise = 0; let orderTaxPaise = 0;
    try {
      totalPaise = invoice?.entity === 'sales_invoice' ? documentAmount(tenant, 'invoice', invoice, invoice.data.grand_total, `invoice ${invoice.id}`) : safePaise(order.data.grand_total, `order ${order.id}`);
      subtotalPaise = safePaise(order.data.subtotal, `order ${order.id} subtotal`); chargePaise = safePaise(order.data.charges, `order ${order.id} charges`); discountPaise = safePaise(order.data.discounts, `order ${order.id} discounts`); orderTaxPaise = safePaise(order.data.tax_amount, `order ${order.id} tax`);
    } catch (error: any) { issues.push(`Order ${order.data.name || order.id}: ${error.message}`); continue; }
    const serviceRevenue = Math.max(0, subtotalPaise + chargePaise);
    if (invoiceId) invoiceTotals.set(invoiceId, { totalPaise, issuedDate: orderDate, customer: String(order.data.customer || '') });
    if (!inRange(orderDate, range)) continue;
    activeOrders += 1; grossRevenuePaise += serviceRevenue; discountsPaise += discountPaise; taxPaise += orderTaxPaise;
    increment(trend, orderDate, 'grossRevenuePaise', serviceRevenue); increment(trend, orderDate, 'discountsPaise', discountPaise);
    const source = String(order.data.source || 'Counter'); channel.set(source, (channel.get(source) || 0) + Math.max(0, serviceRevenue - discountPaise));
    for (const item of Array.isArray(order.data.items) ? order.data.items as Array<Record<string, unknown>> : []) {
      const name = String(item.serviceName || 'Unmapped service'); const amount = safePaise(item.amount, `order ${order.id} item`); service.set(name, (service.get(name) || 0) + amount);
    }
  }
  let refundsPaise = 0; const refundsByDate = new Map<string, number>();
  const allCollections = new Map<string, number>(); let collectedPaise = 0;
  const paymentMode = new Map<string, number>();
  for (const payment of store.rowsOf(tenant, 'payment_entry')) {
    const paymentDate = String(payment.data.posting_date || dateKey(payment.created_at)); const invoiceId = String(payment.data.against_sales || '');
    if (payment.status === 'Submitted' && payment.data.payment_type === 'Receive') {
      let amount = 0; try { amount = documentAmount(tenant, 'payment', payment, payment.data.amount, `payment ${payment.id}`); } catch (error: any) { issues.push(`Payment ${payment.id}: ${error.message}`); continue; }
      allCollections.set(invoiceId, (allCollections.get(invoiceId) || 0) + amount);
      if (inRange(paymentDate, range)) { collectedPaise += amount; increment(trend, paymentDate, 'collectedPaise', amount); paymentMode.set(String(payment.data.mode || 'Other'), (paymentMode.get(String(payment.data.mode || 'Other')) || 0) + amount); }
    }
    if (payment.status === 'Cancelled' && payment.data.payment_type === 'Receive' && payment.data.provider_status === 'Reversed') {
      let amount = 0; try { amount = entryAmount(tenant, 'refund', payment, payment.data.amount, `refund ${payment.id}`); } catch (error: any) { issues.push(`Refund ${payment.id}: ${error.message}`); continue; }
      if (inRange(paymentDate, range)) { refundsPaise += amount; refundsByDate.set(paymentDate, (refundsByDate.get(paymentDate) || 0) + amount); increment(trend, paymentDate, 'refundsPaise', amount); }
    }
  }
  for (const point of trend.values()) point.netRevenuePaise = point.grossRevenuePaise - point.discountsPaise - point.refundsPaise;
  const expenseBuckets = new Map<FinanceExpenseCategory, ExpenseBucket>(); let expensesPaise = 0; let unclassifiedExpenses = 0;
  for (const expense of store.rowsOf(tenant, 'laundry_expense').filter((row) => row.status !== 'Cancelled')) {
    const expenseDate = String(expense.data.expense_date || ''); if (!DATE.test(expenseDate) || !inRange(expenseDate, range)) continue;
    let amount = 0; try { amount = entryAmount(tenant, 'expense', expense, expense.data.amount, `expense ${expense.id}`); } catch (error: any) { issues.push(`Expense ${expense.id}: ${error.message}`); continue; }
    const category = financeExpenseCategory(expense.data.finance_category); if (category === 'UNCLASSIFIED') unclassifiedExpenses += 1;
    const bucket = expenseBuckets.get(category) || { category, label: FINANCE_CLASSIFICATIONS[category].label, amountPaise: 0, count: 0 }; bucket.amountPaise += amount; bucket.count += 1; expenseBuckets.set(category, bucket); expensesPaise += amount; increment(trend, expenseDate, 'expensesPaise', amount);
  }
  let cashInPaise = 0; let cashOutPaise = 0;
  for (const entry of store.listFinancialEntries(tenant)) { const date = dateKey(entry.occurredAt); if (!inRange(date, range)) continue; if (entry.direction === 'IN') { cashInPaise += entry.amountPaise; increment(trend, date, 'cashInPaise', entry.amountPaise); } else { cashOutPaise += entry.amountPaise; increment(trend, date, 'cashOutPaise', entry.amountPaise); } }
  const netRevenuePaise = grossRevenuePaise - discountsPaise - refundsPaise;
  const categoryAmount = (predicate: (category: FinanceExpenseCategory) => boolean) => [...expenseBuckets.values()].filter((item) => predicate(item.category)).reduce((sum, item) => sum + item.amountPaise, 0);
  const classificationComplete = unclassifiedExpenses === 0;
  const directCostPaise = categoryAmount((category) => FINANCE_CLASSIFICATIONS[category].grossProfit);
  const contributionCostPaise = categoryAmount((category) => FINANCE_CLASSIFICATIONS[category].contribution);
  const ebitdaCostPaise = categoryAmount((category) => FINANCE_CLASSIFICATIONS[category].ebitda);
  const grossProfitPaise = classificationComplete ? netRevenuePaise - directCostPaise : null;
  const contributionPaise = classificationComplete ? netRevenuePaise - contributionCostPaise : null;
  const ebitdaPaise = classificationComplete ? netRevenuePaise - ebitdaCostPaise : null;
  const receivableBuckets = new Map(['Current', '1–7 days', '8–15 days', '16–30 days', '31–60 days', '60+ days'].map((label) => [label, 0])); let outstandingPaise = 0;
  for (const [invoiceId, invoice] of invoiceTotals) { if (invoice.issuedDate > range.to) continue; const outstanding = Math.max(0, invoice.totalPaise - (allCollections.get(invoiceId) || 0)); if (!outstanding) continue; outstandingPaise += outstanding; const age = Math.max(0, Math.floor((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${invoice.issuedDate}T00:00:00Z`)) / 86_400_000)); const bucket = age === 0 ? 'Current' : age <= 7 ? '1–7 days' : age <= 15 ? '8–15 days' : age <= 30 ? '16–30 days' : age <= 60 ? '31–60 days' : '60+'; receivableBuckets.set(bucket, (receivableBuckets.get(bucket) || 0) + outstanding); }
  const marketplaceRows = store.rowsOf(tenant, 'marketplace_settlement').filter((row) => inRange(dateKey(row.created_at), range) && row.status !== 'Cancelled');
  const settlement = marketplaceRows.reduce((sum, row) => ({ customerCollectedPaise: sum.customerCollectedPaise + Number(row.data.customerCollectedPaise || 0), refundPaise: sum.refundPaise + Number(row.data.refundPaise || 0), vendorGrossPaise: sum.vendorGrossPaise + Number(row.data.vendorServiceGrossPaise || 0), commissionPaise: sum.commissionPaise + Number(row.data.commissionPaise || 0), paymentFeePaise: sum.paymentFeePaise + Number(row.data.paymentFeePaise || 0), withholdingPaise: sum.withholdingPaise + Number(row.data.withholdingPaise || 0), vendorSettlementPaise: sum.vendorSettlementPaise + Number(row.data.vendorSettlementPaise || 0) }), { customerCollectedPaise: 0, refundPaise: 0, vendorGrossPaise: 0, commissionPaise: 0, paymentFeePaise: 0, withholdingPaise: 0, vendorSettlementPaise: 0 });
  const canonicalTax = store.rowsOf(tenant, 'canonical_invoice_snapshot').filter((row) => inRange(dateKey(String(row.data.issuedAt || row.created_at)), range) && row.data.documentType === 'TaxInvoice').reduce((sum, row) => { const tax = row.data.tax as any; return { taxablePaise: sum.taxablePaise + Number(tax?.totals?.taxablePaise || 0), cgstPaise: sum.cgstPaise + Number(tax?.totals?.cgstPaise || 0), sgstPaise: sum.sgstPaise + Number(tax?.totals?.sgstPaise || 0), igstPaise: sum.igstPaise + Number(tax?.totals?.igstPaise || 0), count: sum.count + 1 }; }, { taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, count: 0 });
  const overduePaise = ['16–30 days', '31–60 days', '60+ days'].reduce((sum, bucket) => sum + (receivableBuckets.get(bucket) || 0), 0);
  const operatingCashFlowPaise = cashInPaise - cashOutPaise;
  return { range, trend: [...trend.values()].map(presentPoint), kpis: { grossRevenuePaise, grossRevenue: rupees(grossRevenuePaise), netRevenuePaise, netRevenue: rupees(netRevenuePaise), collectedPaise, collected: rupees(collectedPaise), expensesPaise, expenses: rupees(expensesPaise), cashInPaise, cashIn: rupees(cashInPaise), cashOutPaise, cashOut: rupees(cashOutPaise), operatingCashFlowPaise, operatingCashFlow: rupees(operatingCashFlowPaise), outstandingPaise, outstanding: rupees(outstandingPaise), refundsPaise, refunds: rupees(refundsPaise), directCostPaise, directCost: rupees(directCostPaise), grossProfitPaise, grossProfit: grossProfitPaise === null ? null : rupees(grossProfitPaise), contributionPaise, contribution: contributionPaise === null ? null : rupees(contributionPaise), ebitdaPaise, ebitda: ebitdaPaise === null ? null : rupees(ebitdaPaise), orderCount: activeOrders, averageOrderValuePaise: activeOrders ? Math.round(netRevenuePaise / activeOrders) : null, grossMarginPercent: grossProfitPaise === null ? null : percent(grossProfitPaise, netRevenuePaise), contributionMarginPercent: contributionPaise === null ? null : percent(contributionPaise, netRevenuePaise), ebitdaMarginPercent: ebitdaPaise === null ? null : percent(ebitdaPaise, netRevenuePaise) }, classification: { policy: 'MANAGEMENT-2026.1', state: classificationComplete ? 'MANAGEMENT_POLICY' : 'NEEDS_CLASSIFICATION', unclassifiedExpenses, complete: classificationComplete }, composition: { expense: [...expenseBuckets.values()].sort((a, b) => b.amountPaise - a.amountPaise).map((item) => ({ ...item, amount: rupees(item.amountPaise) })), services: [...service].map(([name, amountPaise]) => ({ name, amountPaise, amount: rupees(amountPaise) })).sort((a, b) => b.amountPaise - a.amountPaise), channels: [...channel].map(([name, amountPaise]) => ({ name, amountPaise, amount: rupees(amountPaise) })).sort((a, b) => b.amountPaise - a.amountPaise), payments: [...paymentMode].map(([name, amountPaise]) => ({ name, amountPaise, amount: rupees(amountPaise) })).sort((a, b) => b.amountPaise - a.amountPaise) }, receivables: { totalPaise: outstandingPaise, total: rupees(outstandingPaise), overduePaise, overdue: rupees(overduePaise), collectionRatePercent: percent(collectedPaise, grossRevenuePaise - discountsPaise), aging: [...receivableBuckets].map(([label, amountPaise]) => ({ label, amountPaise, amount: rupees(amountPaise) })) }, settlement: Object.fromEntries(Object.entries(settlement).map(([key, value]) => [key, { paise: value, amount: rupees(value) }])), tax: { ...canonicalTax, taxable: rupees(canonicalTax.taxablePaise), cgst: rupees(canonicalTax.cgstPaise), sgst: rupees(canonicalTax.sgstPaise), igst: rupees(canonicalTax.igstPaise), legacyOutputTaxPaise: taxPaise, legacyOutputTax: rupees(taxPaise), canonicalInvoiceCount: canonicalTax.count }, issues };
}

export function financeCommandCenter(tenant: string, input: { from?: string; to?: string } = {}) {
  const range = validRange(input.from, input.to); const current = aggregate(tenant, range); const duration = daysBetween(range.from, range.to); const previous = aggregate(tenant, { from: addDays(range.from, -duration), to: addDays(range.from, -1) });
  const compliance = getComplianceSummary(tenant); const readiness = financePolicyReadiness(tenant);
  const currentKpis = current.kpis; const insights: Array<{ tone: 'watch' | 'critical' | 'good'; title: string; detail: string }> = [];
  if (current.classification.unclassifiedExpenses) insights.push({ tone: 'watch', title: `${current.classification.unclassifiedExpenses} expense record${current.classification.unclassifiedExpenses === 1 ? '' : 's'} need classification`, detail: 'EBITDA and margin are withheld until each expense has a management category.' });
  if (current.receivables.overduePaise) insights.push({ tone: 'critical', title: `${rupees(current.receivables.overduePaise).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })} is overdue`, detail: 'Open Receivables to review invoices older than 15 days.' });
  if (currentKpis.ebitdaMarginPercent !== null && currentKpis.ebitdaMarginPercent < 0) insights.push({ tone: 'critical', title: 'Operating result is negative', detail: 'The classified operating-cost bridge is larger than net revenue in this period.' });
  if (!insights.length) insights.push({ tone: 'good', title: 'No deterministic finance risk in this period', detail: 'Continue reviewing classifications, receivables and reconciliation evidence as new records arrive.' });
  return { generatedAt: new Date().toISOString(), currency: 'INR', range, previousRange: previous.range, current, previous: { kpis: previous.kpis }, comparisons: { netRevenue: comparison(currentKpis.netRevenuePaise, previous.kpis.netRevenuePaise), collected: comparison(currentKpis.collectedPaise, previous.kpis.collectedPaise), expenses: comparison(currentKpis.expensesPaise, previous.kpis.expensesPaise), operatingCashFlow: comparison(currentKpis.operatingCashFlowPaise, previous.kpis.operatingCashFlowPaise), ebitda: currentKpis.ebitdaPaise === null || previous.kpis.ebitdaPaise === null ? null : comparison(currentKpis.ebitdaPaise, previous.kpis.ebitdaPaise) }, compliance: { readiness: readiness.checks, missing: readiness.missing, outputGst: compliance.output_gst, inputGst: compliance.input_gst, netGstPayable: compliance.net_gst_payable, tdsPayable: compliance.tds_payable, tcsPayable: compliance.tcs_payable, policyState: readiness.checks.entityConfiguration ? 'CONFIGURATION_REVIEW' : 'ENTITY_CONFIGURATION_REQUIRED' }, insights };
}
