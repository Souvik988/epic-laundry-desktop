// Phase-14 Ops pack: pricing rules, recurring invoices (subscriptions), reorder alerts,
// owner alerts center, and full-tenant backup/restore helpers.
import { store } from '../kernel/store.js';
import { createRow, submitRow, getRow } from '../kernel/entity-service.js';
import { supplierStateCodeForTenant } from './gst/tax-policy.js';

const todayStr = () => new Date().toISOString().slice(0, 10);

function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function addDays(a: string, n: number): string {
  return new Date(Date.parse(a + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

// ---------- Pricing engine ----------
// Returns the effective unit rate for an item given context. Pure, non-invasive: UIs call this
// to pre-fill line rates; the GL/posting path is untouched so existing GST math stays exact.
export function quoteRate(
  tenant: string,
  ctx: { item?: string; customer?: string; qty?: number; rate?: number },
): { rate: number; rule: string | null } {
  const { item, customer, qty = 0, rate = 0 } = ctx;
  const today = todayStr();
  const rules = store.rowsOf(tenant, 'pricing_rule').filter((r) => r.data.active);
  const candidates = rules.filter((r) => {
    const d = r.data;
    if (item && d.item && d.item !== item) return false;
    if (d.customer && d.customer !== (customer || '')) return false;
    if (d.min_qty && qty < Number(d.min_qty)) return false;
    if (d.valid_from && today < d.valid_from) return false;
    if (d.valid_upto && today > d.valid_upto) return false;
    return true;
  });
  let finalRate = Number(rate) || 0;
  let applied: string | null = null;
  const specificity = (r: any) => (r.data.customer ? 2 : 0) + (r.data.item ? 1 : 0);
  candidates.sort((a, b) => specificity(b) - specificity(a));
  for (const r of candidates) {
    if (r.data.rate_override != null && r.data.rate_override !== '') {
      finalRate = Number(r.data.rate_override); applied = r.data.name; break;
    }
  }
  if (!applied) {
    for (const r of candidates) {
      if (r.data.discount_pct != null && r.data.discount_pct !== '') {
        finalRate = Math.round(finalRate * (1 - Number(r.data.discount_pct) / 100) * 100) / 100;
        applied = r.data.name; break;
      }
    }
  }
  return { rate: finalRate, rule: applied };
}

// ---------- Reorder suggestions ----------
export function reorderSuggestions(tenant: string) {
  const stock = store.stockOf(tenant);
  return store.rowsOf(tenant, 'item')
    .filter((r) => Number(r.data.reorder_level || 0) > 0)
    .map((r) => {
      const onHand = stock.filter((s) => s.item === r.id).reduce((a, s) => a + s.qty, 0);
      const need = Math.max(0, Number(r.data.reorder_level) - onHand);
      return {
        item: r.id, name: r.data.name, code: r.data.item_code,
        on_hand: Math.round(onHand * 1000) / 1000,
        reorder_level: Number(r.data.reorder_level),
        shortfall: Math.round(need * 1000) / 1000,
        preferred_supplier: r.data.preferred_supplier || null,
      };
    })
    .filter((x) => x.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall);
}

// ---------- Recurring invoices (subscriptions) ----------
function advance(date: string, freq?: string): string {
  const d = new Date(date + 'T00:00:00Z');
  if (freq === 'Monthly') d.setMonth(d.getMonth() + 1);
  else if (freq === 'Quarterly') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function runRecurring(tenant: string, asOf?: string): string[] {
  const today = asOf || todayStr();
  const created: string[] = [];
  for (const sub of store.rowsOf(tenant, 'subscription').filter((r) => r.data.active)) {
    let next = sub.data.next_date;
    let guard = 0;
    while (next && next <= today && guard++ < 36) {
      const inv = createRow(tenant, 'scheduler', 'sales_invoice', {
        customer: sub.data.customer,
        posting_date: next,
        place_of_supply: sub.data.place_of_supply || supplierStateCodeForTenant(tenant),
        items: (sub.data.items || []).map((it: any) => ({
          item: it.item, qty: it.qty, rate: it.rate, gst_rate: it.gst_rate,
        })),
      });
      submitRow(tenant, 'scheduler', 'sales_invoice', inv.id);
      created.push(inv.id);
      next = advance(next, sub.data.frequency);
      store.updateRow({ ...sub, data: { ...sub.data, next_date: next, last_invoice: inv.id } });
    }
  }
  return created;
}

// ---------- Owner alerts center ----------
export function gstDueDates(today: string) {
  const d = new Date(today + 'T00:00:00Z');
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const g1 = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 11));
  const g3 = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 20));
  const out: any[] = [];
  for (const [name, due] of [['GSTR-1 (outward supplies)', g1], ['GSTR-3B (monthly return)', g3]] as [string, Date][]) {
    const ds = due.toISOString().slice(0, 10);
    const inDays = daysBetween(today, ds);
    out.push({ return: name, due: ds, in_days: inDays, urgent: inDays <= 5 });
  }
  return out;
}

export function getAlerts(tenant: string, asOf?: string) {
  const today = asOf || todayStr();
  const paidFor = (id: string) =>
    store.rowsOf(tenant, 'payment_entry').filter((p) => p.status === 'Submitted' && p.data.against_sales === id)
      .reduce((a, p) => a + Number(p.data.amount || 0), 0);

  const overdue = store.rowsOf(tenant, 'sales_invoice')
    .filter((r) => r.status === 'Submitted')
    .map((r) => {
      const gt = Number(r.data.grand_total || 0);
      const bal = gt - paidFor(r.id);
      const age = r.data.posting_date ? daysBetween(r.data.posting_date, today) : 0;
      return bal > 0.5 && age > 30 ? { id: r.id, name: r.data.name, customer: r.data.customer, age, due: Math.round(bal * 100) / 100 } : null;
    })
    .filter(Boolean) as any[];

  const subs = store.rowsOf(tenant, 'subscription')
    .filter((r) => r.data.active && r.data.next_date && r.data.next_date <= addDays(today, 7))
    .map((r) => ({ id: r.id, name: r.data.name, customer: r.data.customer, next: r.data.next_date }));

  // Budgets: actual spend = normal-balance movement on the scoped account / cost center.
  const CREDIT_NORMAL = new Set(['Liability', 'Equity', 'Income']);
  const acctType = (name: string) => {
    const a = store.rowsOf(tenant, 'account').find((x) => x.data.name === name);
    if (a?.data?.account_type) return a.data.account_type as string;
    const m: Record<string, string> = {
      'Cash (Assets)': 'Asset', 'Bank/UPI (Assets)': 'Asset', 'Bank/Card (Assets)': 'Asset',
      'CGST (Asset)': 'Asset', 'SGST (Asset)': 'Asset', 'IGST (Asset)': 'Asset', 'Debtors (Assets)': 'Asset',
      'Creditors (Liabilities)': 'Liability', 'CGST (Liability)': 'Liability', 'SGST (Liability)': 'Liability', 'IGST (Liability)': 'Liability',
      'Capital (Equity)': 'Equity', 'Sales (Revenue)': 'Income', 'Purchase (Expense)': 'Expense', 'Salary (Expense)': 'Expense',
    };
    return m[name] || 'Asset';
  };
  const budgets = store.rowsOf(tenant, 'budget').map((b) => {
    const d = b.data;
    const gl = store.glOf(tenant).filter((e) =>
      (!d.account || e.account === d.account) && (!d.cost_center || e.cost_center === d.cost_center));
    const actual = gl.reduce((a, e) => a + (CREDIT_NORMAL.has(acctType(e.account)) ? e.credit : e.debit), 0);
    const amt = Number(d.budget_amount) || 0;
    const pct = amt > 0 ? Math.round((Math.abs(actual) / amt) * 100) : 0;
    const alertAt = Number(d.alert_at_pct || 80);
    return { id: b.id, name: d.name, scope: d.account || d.cost_center || 'company', budget: amt, actual: Math.round(actual * 100) / 100, pct, breached: pct >= alertAt };
  }).filter((x) => x.breached);

  return {
    overdue,
    reorder: reorderSuggestions(tenant),
    gst: gstDueDates(today),
    subscriptions_due: subs,
    budgets,
    counts: { overdue: overdue.length, reorder: reorderSuggestions(tenant).length, gst: 2, subscriptions: subs.length, budgets: budgets.length },
  };
}

// Draft purchase order from all reorder suggestions (one PO for a chosen supplier).
export function createReorderPO(tenant: string, supplier: string) {
  const lines = reorderSuggestions(tenant).map((s) => ({ item: s.item, qty: s.shortfall, rate: 0, gst_rate: 18 }));
  if (!lines.length) return null;
  const po = createRow(tenant, 'scheduler', 'purchase_order', { supplier, items: lines });
  return po.id;
}
