// Epic BOS self-test 18 — Phase-14 Ops pack: pricing rules, recurring invoices, reorder, alerts, backup.
import { createRow, submitRow } from './kernel/entity-service.js';
import { store } from './kernel/store.js';
import { quoteRate, runRecurring, reorderSuggestions, getAlerts } from './modules/ops.js';

const T = 'TECO';
let fails = 0;
const assert = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

async function main() {
  // --- pricing engine ---
  const cust = createRow(T, 'test', 'party', { name: 'Sub Co', gstin: '33AAAAA0000A1Z5' });
  const item = createRow(T, 'test', 'item', { name: 'Widget', item_code: 'WID', rate: 100, gst_rate: 18, reorder_level: 5 });
  const wh = createRow(T, 'test', 'warehouse', { name: 'DC', code: 'DC', state: '29' });
  const rcpt = createRow(T, 'test', 'stock_entry', { stock_type: 'Material Receipt', posting_date: '2026-01-01', to_warehouse: wh.id, items: [{ item: item.id, qty: 2, rate: 50 }] });
  submitRow(T, 'test', 'stock_entry', rcpt.id);

  const r1 = createRow(T, 'test', 'pricing_rule', { name: 'Bulk 10%', item: item.id, min_qty: 5, discount_pct: 10, active: true });
  const r2 = createRow(T, 'test', 'pricing_rule', { name: 'Sub Co flat', customer: cust.id, rate_override: 80, active: true });
  assert(quoteRate(T, { item: item.id, qty: 5, rate: 100 }).rate === 90, 'volume discount 10% -> 90');
  assert(quoteRate(T, { item: item.id, qty: 5, rate: 100 }).rule === r1.data.name, 'applied bulk rule name');
  assert(quoteRate(T, { item: item.id, qty: 5, rate: 100, customer: cust.id }).rate === 80, 'customer override -> 80 wins');
  assert(quoteRate(T, { item: item.id, qty: 2, rate: 100 }).rate === 100, 'below min_qty -> no discount');

  // --- reorder ---
  const re = reorderSuggestions(T);
  const mine = re.find((x) => x.item === item.id);
  assert(!!mine && mine.on_hand === 2 && mine.shortfall === 3, 'reorder shortfall = 5 - 2 = 3');

  // --- recurring invoices (subscriptions) ---
  const sub = createRow(T, 'test', 'subscription', {
    name: 'Monthly Retainer', customer: cust.id, frequency: 'Monthly',
    next_date: '2026-01-01', place_of_supply: '29', active: true,
    items: [{ item: item.id, qty: 1, rate: 500, gst_rate: 18 }],
  });
  const created = runRecurring(T, '2026-03-05');
  assert(created.length === 3, '3 monthly invoices generated (Jan/Feb/Mar)');
  const after = store.getRow(T, sub.id);
  assert(!!after && after.data.next_date === '2026-04-01', 'subscription advanced to 2026-04-01');
  assert(!!after?.data.last_invoice, 'last_invoice linked');

  // --- owner alerts ---
  const inv = createRow(T, 'test', 'sales_invoice', { customer: cust.id, posting_date: '2026-01-01', place_of_supply: '33', items: [{ item: item.id, qty: 1, rate: 1000, gst_rate: 18 }] });
  submitRow(T, 'test', 'sales_invoice', inv.id);
  const alerts = getAlerts(T, '2026-03-05');
  assert(alerts.overdue.length >= 1, 'overdue receivable surfaced');
  assert(alerts.gst.length === 2, 'GST due dates (GSTR-1 + GSTR-3B)');
  assert(alerts.reorder.length >= 1, 'low-stock surfaced in alerts');

  // --- backup / restore (store-scoped snapshot) ---
  const before = store.rowsOf(T, 'party').length;
  const snap = store.snapshotFor(T, 'STORE-DEFAULT');
  createRow(T, 'test', 'party', { name: 'throwaway' });
  assert(store.rowsOf(T, 'party').length === before + 1, 'row added after snapshot');
  store.replaceScoped(T, 'STORE-DEFAULT', snap);
  assert(store.rowsOf(T, 'party').length === before, 'restore rolled back the extra row');

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
