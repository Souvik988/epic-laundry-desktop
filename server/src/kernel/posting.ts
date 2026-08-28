import { randomUUID } from 'node:crypto';
import { store } from './store.js';
import { computeGst } from '../modules/gst/engine.js';
import { computePayroll } from '../modules/hr/payroll.js';
import { docRate } from '../modules/multi-entity/fx.js';
import type { EntityRow, GLEntry, StockLedgerEntry } from './types.js';

// Posting engine: a submitted document projects append-only ledger entries.
// Cancelling posts a reversal (never deletion) — audit-trail as physics (blueprint §2.4).

type PostingHook = (tenant: string, row: EntityRow, sign: 1 | -1) => GLEntry[];

const HOOKS: Record<string, PostingHook> = {};

export function registerPosting(name: string, fn: PostingHook) {
  HOOKS[name] = fn;
}

function gl(tenant: string, row: EntityRow, account: string, debit: number, credit: number, costCenter?: string): GLEntry {
  return {
    id: randomUUID(),
    tenant,
    posting_date: (row.data.posting_date as string) || new Date().toISOString().slice(0, 10),
    voucher_type: row.entity,
    voucher: row.id,
    account,
    party: row.data.party || row.data.customer,
    cost_center: costCenter,
    debit: Math.round(debit * 100) / 100,
    credit: Math.round(credit * 100) / 100,
    created_at: new Date().toISOString(),
  };
}

// Sales Invoice -> GL with full GST split (CGST/SGST or IGST) by place of supply.
registerPosting('sales_invoice_posting', (tenant, row, sign) => {
  const supplierState = process.env.EPIC_SUPPLIER_STATE || '29';
  const pos = String(row.data.place_of_supply || supplierState);
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const hsn = master?.data?.hsn || it.hsn || '';
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { hsn, taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS' };
  });
  const gst = computeGst(items, supplierState, pos);
  row.data.__gst = gst;                 // kept for e-invoice / GSTR-1 / print
  row.data.grand_total = gst.grandTotal;
  const rate = docRate(tenant, row.data); // INR per 1 unit of transaction currency
  row.data.base_grand_total = Math.round(gst.grandTotal * rate * 100) / 100;

  const entries: GLEntry[] = [
    gl(tenant, row, 'Debtors (Assets)', gst.grandTotal * rate * sign, 0),
    gl(tenant, row, 'Sales (Revenue)', 0, gst.totalTaxable * rate * sign),
  ];
  if (gst.totalCgst > 0) entries.push(gl(tenant, row, 'CGST (Liability)', 0, gst.totalCgst * rate * sign));
  if (gst.totalSgst > 0) entries.push(gl(tenant, row, 'SGST (Liability)', 0, gst.totalSgst * rate * sign));
  if (gst.totalIgst > 0) entries.push(gl(tenant, row, 'IGST (Liability)', 0, gst.totalIgst * rate * sign));
  return entries;
});

// Manual Journal Entry: a balanced double-entry adjustment (accruals, reclass, forex, write-offs).
// Validated to balance; each row posts to the GL tagged with its cost center (if any).
registerPosting('journal_entry_posting', (tenant, row, sign) => {
  const rows = ((row.data.entries || []) as any[]);
  const totalDebit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) throw new Error('journal entry must be balanced (dr ' + Math.round(totalDebit) + ' / cr ' + Math.round(totalCredit) + ')');
  const s = sign;
  const out: GLEntry[] = [];
  for (const r of rows) {
    const d = Number(r.debit) || 0, c = Number(r.credit) || 0;
    const accName = store.getRow(tenant, r.account)?.data?.name || r.account;
    if (d > 0) out.push(gl(tenant, row, accName, d * s, 0, r.cost_center));
    if (c > 0) out.push(gl(tenant, row, accName, 0, c * s, r.cost_center));
  }
  return out;
});

export function runPosting(tenant: string, row: EntityRow, sign: 1 | -1): GLEntry[] {
  const def = row.data.__posting as string | undefined;
  const name = def;
  const hook = name ? HOOKS[name] : undefined;
  if (!hook) return [];
  const entries = hook(tenant, row, sign);
  for (const e of entries) store.appendGL(e);
  return entries;
}

// ---- stock ledger helper (running balance per item+warehouse) ----
function runningBalance(tenant: string, item: string, warehouse: string): number {
  return store.stockOf(tenant)
    .filter((s) => s.item === item && s.warehouse === warehouse)
    .reduce((acc, s) => acc + s.qty, 0);
}

function parseSerials(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

// Record a tracked serial number as a master row (used by serial-tracked stock movements).
function makeSerial(tenant: string, row: EntityRow, item: string, warehouse: string, serial: string, status: string) {
  const id = 'SER-' + String(store.nextSeq('SER')).padStart(5, '0');
  const now = new Date().toISOString();
  store.insertRow({
    id, entity: 'item_serial', tenant, status: 'Submitted',
    data: { name: serial, serial_no: serial, item, warehouse, status, stock_entry: row.id },
    version: 1, created_by: 'system', created_at: now, updated_at: now,
  });
}

// Move / consume tracked serials on a stock entry.
function applySerials(tenant: string, row: EntityRow, item: string, serials: string[], action: 'receipt' | 'issue' | 'transfer') {
  for (const s of serials) {
    if (action === 'receipt') {
      makeSerial(tenant, row, item, row.data.to_warehouse, s, 'In Stock');
    } else if (action === 'issue') {
      const rec = store.rowsOf(tenant, 'item_serial')
        .find((r) => r.data.serial_no === s && r.data.item === item && r.data.warehouse === row.data.from_warehouse && r.data.status === 'In Stock');
      if (rec) { rec.data.status = 'Issued'; rec.updated_at = new Date().toISOString(); store.updateRow(rec); }
    } else if (action === 'transfer') {
      const rec = store.rowsOf(tenant, 'item_serial')
        .find((r) => r.data.serial_no === s && r.data.item === item && r.data.warehouse === row.data.from_warehouse && r.data.status === 'In Stock');
      if (rec) { rec.data.status = 'Transferred'; rec.data.warehouse = row.data.to_warehouse; rec.updated_at = new Date().toISOString(); store.updateRow(rec); }
    }
  }
}

function postStock(
  tenant: string, row: EntityRow, item: string, warehouse: string, qty: number,
  valuationRate?: number, serialNos?: string[], batchNo?: string, adjustment?: number,
): StockLedgerEntry {
  const balance = runningBalance(tenant, item, warehouse) + qty;
  const e: StockLedgerEntry = {
    id: randomUUID(),
    tenant,
    posting_date: (row.data.posting_date as string) || new Date().toISOString().slice(0, 10),
    item,
    warehouse,
    qty: Math.round(qty * 1000) / 1000,
    balance_qty: Math.round(balance * 1000) / 1000,
    valuation_rate: valuationRate,
    valuation_adjustment: adjustment ? Math.round(adjustment * 100) / 100 : undefined,
    serial_nos: serialNos && serialNos.length ? serialNos : undefined,
    batch_no: batchNo || undefined,
    voucher_type: row.entity,
    voucher: row.id,
    created_at: new Date().toISOString(),
  };
  store.appendStock(e);
  return e;
}

// ---- Stock Entry -> stock ledger (no GL; perpetual valuation can be added later) ----
registerPosting('stock_entry_posting', (tenant, row, sign) => {
  const type = String(row.data.stock_type || 'Material Receipt');
  const items = ((row.data.items || []) as any[]).map((it) => ({
    item: it.item,
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
    serial_nos: parseSerials(it.serial_nos),
    batch_no: it.batch_no,
  }));
  for (const it of items) {
    const isReceipt = type === 'Material Receipt' || type === 'Manufacture' || /receipt/i.test(type);
    const isIssue = type === 'Stock Issue' || /issue/i.test(type);
    const isTransfer = type === 'Stock Transfer' || /transfer/i.test(type);
    if (isReceipt && row.data.to_warehouse) {
      postStock(tenant, row, it.item, row.data.to_warehouse, it.qty * sign, it.rate, it.serial_nos, it.batch_no);
      if (it.serial_nos.length) applySerials(tenant, row, it.item, it.serial_nos, 'receipt');
    }
    if (isIssue && row.data.from_warehouse) {
      postStock(tenant, row, it.item, row.data.from_warehouse, -it.qty * sign, it.rate, it.serial_nos, it.batch_no);
      if (it.serial_nos.length) applySerials(tenant, row, it.item, it.serial_nos, 'issue');
    }
    if (isTransfer) {
      if (row.data.from_warehouse) postStock(tenant, row, it.item, row.data.from_warehouse, -it.qty * sign, it.rate, it.serial_nos, it.batch_no);
      if (row.data.to_warehouse) postStock(tenant, row, it.item, row.data.to_warehouse, it.qty * sign, it.rate, it.serial_nos, it.batch_no);
      if (it.serial_nos.length) applySerials(tenant, row, it.item, it.serial_nos, 'transfer');
    }
  }
  // Manufacture also consumes raw materials from the linked Work Order's BOM.
  if (type === 'Manufacture' && row.data.work_order && row.data.from_warehouse) {
    const wo = store.getRow(tenant, row.data.work_order);
    const bom = wo ? store.getRow(tenant, wo.data.bom) : undefined;
    if (bom) {
      const baseQty = Number(bom.data.quantity) || 1;
      for (const bi of (bom.data.items || []) as any[]) {
        const scale = (Number(bi.qty) || 0) / baseQty;
        for (const it of items) {
          const consume = scale * (Number(it.qty) || 0) * sign;
          if (consume) postStock(tenant, row, bi.item, row.data.from_warehouse, -consume, undefined);
        }
      }
    }
  }
  return [];
});

// ---- Stock Reconciliation: set system stock to a physical count (posts the +/- delta) ----
registerPosting('stock_reconciliation_posting', (tenant, row, sign) => {
  const items = ((row.data.items || []) as any[]).map((it) => ({
    item: it.item,
    warehouse: it.warehouse,
    qty: Number(it.qty) || 0,
    rate: Number(it.rate) || 0,
  }));
  for (const it of items) {
    if (!it.warehouse) continue;
    const current = runningBalance(tenant, it.item, it.warehouse);
    const delta = (it.qty - current) * sign;
    if (Math.abs(delta) > 1e-9) postStock(tenant, row, it.item, it.warehouse, delta, it.rate);
  }
  return [];
});

// ---- Landed Cost Voucher: capitalize freight/insurance/duty into item valuation ----
// Posts a zero-qty stock-ledger revaluation (valuation_adjustment) so FIFO/moving-average
// inventory value on the Balance Sheet reflects the additional cost. No GL entry (it is a
// stock-ledger revaluation within inventory).
registerPosting('landed_cost_voucher_posting', (tenant, row, sign) => {
  const receipt = store.getRow(tenant, row.data.receipt);
  if (!receipt || receipt.entity !== 'stock_entry') throw new Error('landed cost needs a reference stock entry');
  const wh = receipt.data.to_warehouse;
  if (!wh) throw new Error('reference stock entry has no warehouse');
  for (const c of (row.data.items || []) as any[]) {
    const amt = (Number(c.amount) || 0) * sign;
    if (Math.abs(amt) < 1e-9) continue;
    postStock(tenant, row, c.item, wh, 0, undefined, undefined, undefined, amt);
  }
  return [];
});

// ---- POS Invoice -> GL (cash/upi/card + sales + GST) AND stock ledger deduction ----
const PAYMENT_ACCOUNT: Record<string, string> = {
  Cash: 'Cash (Assets)',
  UPI: 'Bank/UPI (Assets)',
  Card: 'Bank/Card (Assets)',
};

registerPosting('pos_invoice_posting', (tenant, row, sign) => {
  const supplierState = process.env.EPIC_SUPPLIER_STATE || '29';
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const hsn = master?.data?.hsn || it.hsn || '';
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { item: it.item, hsn, taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS', rate: Number(it.rate) || 0 };
  });
  // POS is a walk-in counter at the supplier's location -> intra-state. Inter-state POS is
  // possible for registered buyers but is out of scope for Phase 0.
  const gst = computeGst(items, supplierState, supplierState);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;

  const paymentMode = String(row.data.payment_mode || 'Cash');
  const acct = PAYMENT_ACCOUNT[paymentMode] || 'Cash (Assets)';
  const entries: GLEntry[] = [
    gl(tenant, row, acct, gst.grandTotal * sign, 0),
    gl(tenant, row, 'Sales (Revenue)', 0, gst.totalTaxable * sign),
  ];
  if (gst.totalCgst > 0) entries.push(gl(tenant, row, 'CGST (Liability)', 0, gst.totalCgst * sign));
  if (gst.totalSgst > 0) entries.push(gl(tenant, row, 'SGST (Liability)', 0, gst.totalSgst * sign));
  if (gst.totalIgst > 0) entries.push(gl(tenant, row, 'IGST (Liability)', 0, gst.totalIgst * sign));

  // Deduct stock for each line (issue from the counter warehouse).
  const wh = row.data.warehouse;
  if (wh) {
    for (const it of items) postStock(tenant, row, it.item, wh, -(Number(it.qty) || 0) * sign, Number(it.rate) || 0);
  }
  return entries;
});

// ---- Purchase Invoice -> GL (purchase expense + input GST as ASSET + creditors) and GRN stock ----
// We are the buyer: place_of_supply = our state, so intra-state gives input CGST+SGST (assets),
// inter-state gives input IGST (asset). This is the input-credit leg that pairs with IMS 2B recon.
registerPosting('purchase_invoice_posting', (tenant, row, sign) => {
  const ourState = process.env.EPIC_SUPPLIER_STATE || '29';
  const pos = String(row.data.place_of_supply || ourState);
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const hsn = master?.data?.hsn || it.hsn || '';
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { item: it.item, hsn, taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS', rate: Number(it.rate) || 0 };
  });
  const gst = computeGst(items, ourState, pos);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;
  const rate = docRate(tenant, row.data); // INR per 1 unit of transaction currency
  row.data.base_grand_total = Math.round(gst.grandTotal * rate * 100) / 100;

  const entries: GLEntry[] = [
    gl(tenant, row, 'Purchase (Expense)', gst.totalTaxable * rate * sign, 0),
    gl(tenant, row, 'Creditors (Liabilities)', 0, gst.grandTotal * rate * sign),
  ];
  if (gst.totalCgst > 0) entries.push(gl(tenant, row, 'CGST (Asset)', gst.totalCgst * rate * sign, 0));
  if (gst.totalSgst > 0) entries.push(gl(tenant, row, 'SGST (Asset)', gst.totalSgst * rate * sign, 0));
  if (gst.totalIgst > 0) entries.push(gl(tenant, row, 'IGST (Asset)', gst.totalIgst * rate * sign, 0));

  // GRN: receive stock into the warehouse.
  const wh = row.data.warehouse;
  if (wh) {
    for (const it of items) postStock(tenant, row, it.item, wh, (Number(it.qty) || 0) * sign, Number(it.rate) || 0);
  }
  return entries;
});

// ---- Credit Note (sales return): reverse Sales + output GST, credit Debtors; return stock in ----
registerPosting('credit_note_posting', (tenant, row, sign) => {
  const ref = store.getRow(tenant, row.data.reference_invoice);
  if (!ref || !ref.data.__gst) throw new Error('credit note needs a submitted reference invoice');
  const pos = String(ref.data.place_of_supply || (process.env.EPIC_SUPPLIER_STATE || '29'));
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const hsn = master?.data?.hsn || it.hsn || '';
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { item: it.item, hsn, taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS', rate: Number(it.rate) || 0 };
  });
  const gst = computeGst(items, process.env.EPIC_SUPPLIER_STATE || '29', pos);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;

  // Reversal: asset side (Debtors) credited, income (Sales) debited, output GST (liability) debited.
  const entries: GLEntry[] = [
    gl(tenant, row, 'Sales (Revenue)', gst.totalTaxable * sign, 0),
    gl(tenant, row, 'Debtors (Assets)', 0, gst.grandTotal * sign),
  ];
  if (gst.totalCgst > 0) entries.push(gl(tenant, row, 'CGST (Liability)', gst.totalCgst * sign, 0));
  if (gst.totalSgst > 0) entries.push(gl(tenant, row, 'SGST (Liability)', gst.totalSgst * sign, 0));
  if (gst.totalIgst > 0) entries.push(gl(tenant, row, 'IGST (Liability)', gst.totalIgst * sign, 0));

  if (row.data.warehouse) {
    for (const it of items) postStock(tenant, row, it.item, row.data.warehouse, (Number(it.qty) || 0) * sign, Number(it.rate) || 0);
  }
  return entries;
});

// ---- Debit Note (purchase return): reverse Purchase + input GST, debit Creditors; return stock out ----
registerPosting('debit_note_posting', (tenant, row, sign) => {
  const ref = store.getRow(tenant, row.data.reference_invoice);
  if (!ref || !ref.data.__gst) throw new Error('debit note needs a submitted reference invoice');
  const pos = String(ref.data.place_of_supply || (process.env.EPIC_SUPPLIER_STATE || '29'));
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const hsn = master?.data?.hsn || it.hsn || '';
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { item: it.item, hsn, taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS', rate: Number(it.rate) || 0 };
  });
  const gst = computeGst(items, process.env.EPIC_SUPPLIER_STATE || '29', pos);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;

  // Reversal: expense (Purchase) credited, liability (Creditors) debited, input GST (asset) credited.
  const entries: GLEntry[] = [
    gl(tenant, row, 'Purchase (Expense)', 0, gst.totalTaxable * sign),
    gl(tenant, row, 'Creditors (Liabilities)', gst.grandTotal * sign, 0),
  ];
  if (gst.totalCgst > 0) entries.push(gl(tenant, row, 'CGST (Asset)', 0, gst.totalCgst * sign));
  if (gst.totalSgst > 0) entries.push(gl(tenant, row, 'SGST (Asset)', 0, gst.totalSgst * sign));
  if (gst.totalIgst > 0) entries.push(gl(tenant, row, 'IGST (Asset)', 0, gst.totalIgst * sign));

  const wh = ref.data.warehouse;
  if (wh) {
    for (const it of items) postStock(tenant, row, it.item, wh, -(Number(it.qty) || 0) * sign, Number(it.rate) || 0);
  }
  return entries;
});

// ---- Payment Entry: settle Debtors (Receive) or Creditors (Pay) via Cash/Bank ----
const PAY_MODE_ACCOUNT: Record<string, string> = {
  Cash: 'Cash (Assets)',
  Bank: 'Bank (Assets)',
  UPI: 'Bank/UPI (Assets)',
  Card: 'Bank/Card (Assets)',
};

function refreshSalesInvoicePaymentStatus(tenant: string, invoiceId: string, excludedPaymentId?: string) {
  const invoice = store.getRow(tenant, invoiceId);
  if (!invoice || invoice.entity !== 'sales_invoice' || invoice.status === 'Cancelled') return;
  const total = Math.max(0, Math.round((Number(invoice.data.grand_total) || 0) * 100) / 100);
  const paid = Math.round(store.rowsOf(tenant, 'payment_entry')
    .filter((payment) => payment.status === 'Submitted' && payment.id !== excludedPaymentId && payment.data.payment_type === 'Receive' && payment.data.against_sales === invoiceId)
    .reduce((sum, payment) => sum + (Number(payment.data.amount) || 0), 0) * 100) / 100;
  invoice.data.payment_status = paid >= total && total > 0 ? 'Paid' : paid > 0 ? 'Part Paid' : 'Unpaid';
  invoice.updated_at = new Date().toISOString();
  store.updateRow(invoice);
}

registerPosting('payment_posting', (tenant, row, sign) => {
  const type = String(row.data.payment_type || 'Receive');
  const mode = String(row.data.mode || 'Cash');
  const acct = PAY_MODE_ACCOUNT[mode] || 'Cash (Assets)';
  const amount = Math.round((Number(row.data.amount) || 0) * 100) / 100;

  const entries: GLEntry[] = [];
  if (type === 'Receive') {
    // money in: debit Bank/Cash, credit Debtors
    entries.push(gl(tenant, row, acct, amount * sign, 0));
    entries.push(gl(tenant, row, 'Debtors (Assets)', 0, amount * sign));
  } else {
    // money out: debit Creditors, credit Bank/Cash
    entries.push(gl(tenant, row, 'Creditors (Liabilities)', amount * sign, 0));
    entries.push(gl(tenant, row, acct, 0, amount * sign));
  }

  // Payment status is derived from all valid allocations, including reversals;
  // never overload the invoice lifecycle status with a partial payment.
  if (type === 'Receive' && row.data.against_sales) refreshSalesInvoicePaymentStatus(tenant, String(row.data.against_sales), sign === -1 ? row.id : undefined);
  return entries;
});

// ---- Salary Slip -> GL (Salary expense + net paid via Bank/Cash + statutory payables) ----
const PAY_MODE_ACCOUNT_HR: Record<string, string> = {
  Bank: 'Bank (Assets)', Cash: 'Cash (Assets)', UPI: 'Bank/UPI (Assets)',
};
registerPosting('salary_slip_posting', (tenant, row, sign) => {
  const emp = store.getRow(tenant, row.data.employee);
  const ss = emp?.data?.salary_structure ? store.getRow(tenant, emp.data.salary_structure)?.data : undefined;
  if (!ss) throw new Error('employee has no salary structure');
  const p = computePayroll(ss, Number(row.data.paid_days) || 30, 30);
  row.data.__payroll = p;
  row.data.gross = p.gross;
  row.data.net_pay = p.net_pay;
  const acct = PAY_MODE_ACCOUNT_HR[String(row.data.payment_mode || 'Bank')] || 'Bank (Assets)';
  const entries: GLEntry[] = [
    gl(tenant, row, 'Salary (Expense)', p.gross * sign, 0),
    gl(tenant, row, acct, 0, p.net_pay * sign),
  ];
  if (p.deductions.pf > 0) entries.push(gl(tenant, row, 'PF Payable (Liability)', 0, p.deductions.pf * sign));
  if (p.deductions.esi > 0) entries.push(gl(tenant, row, 'ESI Payable (Liability)', 0, p.deductions.esi * sign));
  if (p.deductions.tds > 0) entries.push(gl(tenant, row, 'TDS Payable (Liability)', 0, p.deductions.tds * sign));
  if (p.deductions.pt > 0) entries.push(gl(tenant, row, 'PT Payable (Liability)', 0, p.deductions.pt * sign));
  return entries;
});

// ---- Purchase Order: a commitment, not a ledger posting. Compute the order value only. ----
registerPosting('purchase_order_posting', (tenant, row, sign) => {
  const supplierState = process.env.EPIC_SUPPLIER_STATE || '29';
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const hsn = master?.data?.hsn || it.hsn || '';
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { hsn, taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS' };
  });
  const gst = computeGst(items, supplierState, supplierState);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;
  return []; // no GL: a PO is a commitment until goods are received / invoiced
});

// ---- Quotation: a proposal, not a commitment. Compute the quoted value only. ----
registerPosting('quotation_posting', (tenant, row, sign) => {
  const ourState = process.env.EPIC_SUPPLIER_STATE || '29';
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { hsn: master?.data?.hsn || '', taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS' };
  });
  const gst = computeGst(items, ourState, ourState);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;
  return []; // no GL: a quotation is a proposal
});

// ---- Opportunity: a weighted pipeline commitment, not a ledger posting. ----
registerPosting('opportunity_posting', (_tenant, row, _sign) => {
  const val = Number(row.data.expected_value) || 0;
  const probMap: Record<string, number> = {
    Qualification: 10, 'Needs Analysis': 25, Proposal: 50, Negotiation: 75, Won: 100, Lost: 0,
  };
  const prob = Number(row.data.probability) || probMap[row.data.stage as string] || 20;
  row.data.probability = prob;
  row.data.weighted_value = Math.round(val * prob) / 100;
  return []; // no GL: a forecast, not a booked sale
});

// ---- Sales Order: a commitment to deliver, not a ledger posting. Compute order value. ----
registerPosting('sales_order_posting', (tenant, row, sign) => {
  const ourState = process.env.EPIC_SUPPLIER_STATE || '29';
  const items = ((row.data.items || []) as any[]).map((it) => {
    const master = store.getRow(tenant, it.item);
    const gstRate = Number(it.gst_rate ?? master?.data?.gst_rate ?? 0);
    const taxable = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    return { hsn: master?.data?.hsn || '', taxable, gstRate, qty: Number(it.qty) || 0, unit: master?.data?.uom || 'NOS' };
  });
  const gst = computeGst(items, ourState, ourState);
  row.data.__gst = gst;
  row.data.grand_total = gst.grandTotal;
  return []; // no GL: an SO is a commitment until invoiced
});

// ---- Delivery Note: issue stock out of the warehouse (no GL — invoice books the revenue). ----
registerPosting('delivery_note_posting', (tenant, row, sign) => {
  const wh = row.data.warehouse;
  if (!wh) throw new Error('delivery note needs a warehouse');
  for (const it of (row.data.items || []) as any[]) {
    postStock(tenant, row, it.item, wh, -(Number(it.qty) || 0) * sign, undefined);
  }
  return []; // stock movement only; the linked sales invoice posts the GL
});

// ---- Depreciation: expense the period charge, build up accumulated depreciation (contra-asset) ----
registerPosting('depreciation_posting', (tenant, row, sign) => {
  const amount = Number(row.data.amount) || 0;
  const asset = store.getRow(tenant, row.data.asset);
  if (asset) {
    const acc = (Number(asset.data.accumulated_depreciation) || 0) + amount * sign;
    asset.data.accumulated_depreciation = Math.round(acc * 100) / 100;
    asset.data.book_value = Math.round(((Number(asset.data.purchase_value) || 0) - asset.data.accumulated_depreciation) * 100) / 100;
    asset.updated_at = new Date().toISOString();
    store.updateRow(asset);
  }
  return [
    gl(tenant, row, 'Depreciation Expense', amount * sign, 0),
    gl(tenant, row, 'Accumulated Depreciation (Asset)', 0, amount * sign),
  ];
});

// ---- TCS (Tax Collected at Source): collected from the buyer, payable to govt ----
registerPosting('tcs_posting', (tenant, row, sign) => {
  const amt = Number(row.data.amount) || 0;
  return [
    gl(tenant, row, 'Debtors (Assets)', amt * sign, 0),
    gl(tenant, row, 'TCS Payable (Liability)', 0, amt * sign),
  ];
});
