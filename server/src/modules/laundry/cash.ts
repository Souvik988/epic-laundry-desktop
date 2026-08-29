import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { parseMoney, moneyNumber } from '../../kernel/money.js';
import { store } from '../../kernel/store.js';
import { laundryBusinessDate } from './dates.js';
import { randomUUID } from 'node:crypto';

type CashShiftInput = { openingCash?: unknown; register?: string; note?: string };
type CashCloseInput = { countedCash?: unknown; register?: string; note?: string; supervisorApproved?: boolean; supervisorActor?: string };

function paiseAmount(value: unknown, label: string, allowZero = true) { return parseMoney(value ?? 0, label, { allowZero }); }
function amount(value: unknown, label: string, allowZero = true) { return moneyNumber(paiseAmount(value, label, allowZero)); }
function canonicalMovementAmount(tenant: string, kind: string, row: { entity: string; id: string; data: Record<string, any> }, fallback: unknown, label: string) {
  return store.financialEntryAmountPaise(tenant, kind, row.entity, row.id) ?? paiseAmount(fallback, label);
}
function current(tenant: string, register?: string) {
  const open = store.rowsOf(tenant, 'laundry_cash_shift').filter((row) => row.status === 'Open');
  if (register) { const wanted = String(register).trim().toLowerCase(); return open.find((row) => String(row.data.register || '').trim().toLowerCase() === wanted); }
  return open[0];
}
export function cashShiftForTransaction(tenant: string, register?: unknown) {
  const open = store.rowsOf(tenant, 'laundry_cash_shift').filter((row) => row.status === 'Open');
  if (!open.length) return undefined;
  const requested = String(register || '').trim();
  if (requested) {
    const match = current(tenant, requested);
    if (!match) throw new Error(`no open cash shift exists for register '${requested}'`);
    return match;
  }
  if (open.length > 1) throw new Error('register is required when multiple cash shifts are open');
  return open[0];
}
function movements(tenant: string, shift: ReturnType<typeof current>) {
  if (!shift) return { collectionsPaise: 0, expensesPaise: 0, refundsPaise: 0, collectionCount: 0, expenseCount: 0, refundCount: 0 };
  const since = shift.created_at;
  const cashPayments = store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Submitted' && row.data.payment_type === 'Receive' && row.data.mode === 'Cash' && (row.data.cash_shift_id ? row.data.cash_shift_id === shift.id : row.created_at >= since));
  const cashExpenses = store.rowsOf(tenant, 'laundry_expense').filter((row) => row.status === 'Paid' && row.data.payment_mode === 'Cash' && (row.data.cash_shift_id ? row.data.cash_shift_id === shift.id : row.created_at >= since));
  const cashRefunds = store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Cancelled' && row.data.payment_type === 'Receive' && row.data.mode === 'Cash' && row.data.provider_status === 'Reversed' && (row.data.cash_shift_id ? row.data.cash_shift_id === shift.id : row.updated_at >= since));
  return {
    collectionsPaise: cashPayments.reduce((sum, row) => sum + canonicalMovementAmount(tenant, 'collection', row, row.data.amount, `payment ${row.id}`), 0),
    expensesPaise: cashExpenses.reduce((sum, row) => sum + canonicalMovementAmount(tenant, 'expense', row, row.data.amount, `expense ${row.id}`), 0),
    refundsPaise: cashRefunds.reduce((sum, row) => sum + canonicalMovementAmount(tenant, 'refund', row, row.data.amount, `refund ${row.id}`), 0),
    collectionCount: cashPayments.length, expenseCount: cashExpenses.length, refundCount: cashRefunds.length,
  };
}
function present(tenant: string, row: ReturnType<typeof current>) {
  if (!row) return null;
  const movement = movements(tenant, row);
  const close = row.status === 'Closed' ? store.cashShiftCloseFor(tenant, row.id) : undefined;
  const openingCashPaise = close?.openingCashPaise ?? paiseAmount(row.data.opening_cash, 'opening cash');
  const collectionsPaise = close?.collectionsPaise ?? movement.collectionsPaise;
  const expensesPaise = close?.expensesPaise ?? movement.expensesPaise;
  const refundsPaise = close?.refundsPaise ?? movement.refundsPaise;
  const expectedCashPaise = close?.expectedCashPaise ?? (openingCashPaise + collectionsPaise - expensesPaise - refundsPaise);
  const openingCash = moneyNumber(openingCashPaise);
  const expectedCash = moneyNumber(expectedCashPaise);
  const countedCashPaise = close?.countedCashPaise ?? (row.data.counted_cash === undefined ? null : paiseAmount(row.data.counted_cash, 'counted cash'));
  const countedCash = countedCashPaise === null ? null : moneyNumber(countedCashPaise);
  return {
    id: row.id, status: row.status, register: String(row.data.register || 'Main counter'), businessDate: String(row.data.business_date || laundryBusinessDate()),
    openedAt: row.data.opened_at || row.created_at, openedBy: row.data.opened_by || row.created_by, closedAt: row.data.closed_at || null, closedBy: row.data.closed_by || null,
    openingCash, collections: moneyNumber(collectionsPaise), expenses: moneyNumber(expensesPaise), refunds: moneyNumber(refundsPaise), expectedCash, countedCash,
    variance: close ? moneyNumber(close.variancePaise) : (countedCashPaise === null ? null : moneyNumber(countedCashPaise - expectedCashPaise)),
    varianceApprovedBy: close?.supervisorActor || row.data.variance_approved_by || null,
    movementCounts: { collections: close?.collectionCount ?? movement.collectionCount, expenses: close?.expenseCount ?? movement.expenseCount, refunds: close?.refundCount ?? movement.refundCount }, note: String(row.data.note || ''), closeNote: close?.note || String(row.data.close_note || ''),
  };
}

export function getCurrentCashShift(tenant: string, register?: string) { return present(tenant, current(tenant, register)); }
export function listCashShifts(tenant: string) { return store.rowsOf(tenant, 'laundry_cash_shift').sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => present(tenant, row)); }

export function openCashShift(tenant: string, actor: string, input: CashShiftInput) {
  return store.transaction(() => {
    if (input.openingCash === undefined || input.openingCash === null || input.openingCash === '') throw new Error('opening cash count is required');
    const openingCash = amount(input.openingCash, 'opening cash');
    const register = String(input.register || 'Main counter').trim().slice(0, 80) || 'Main counter';
    if (current(tenant, register)) throw new Error(`a cash shift is already open for register '${register}'`);
    const now = new Date().toISOString();
    const row = createRow(tenant, actor, 'laundry_cash_shift', { business_date: laundryBusinessDate(), register, opening_cash: openingCash, opened_at: now, opened_by: actor, note: String(input.note || '').trim().slice(0, 500), currency: 'INR' });
    row.status = 'Open'; row.updated_at = now; store.updateRow(row);
    audit(tenant, actor, 'laundry:cash-shift-opened', { entity: row.entity, row_id: row.id, after: { register, openingCash } });
    return present(tenant, row);
  });
}

export function closeCashShift(tenant: string, actor: string, input: CashCloseInput) {
  return store.transaction(() => {
    const openShifts = store.rowsOf(tenant, 'laundry_cash_shift').filter((candidate) => candidate.status === 'Open');
    if (!input.register && openShifts.length > 1) throw new Error('register is required when multiple cash shifts are open');
    const row = current(tenant, input.register);
    if (!row) throw new Error('no cash shift is open for this store');
    if (input.countedCash === undefined || input.countedCash === null || input.countedCash === '') throw new Error('counted cash is required to close the shift');
    const countedCash = amount(input.countedCash, 'counted cash');
    const before = present(tenant, row);
    const now = new Date().toISOString();
    const countedCashPaise = paiseAmount(input.countedCash, 'counted cash');
    const expectedCashPaise = before ? paiseAmount(before.expectedCash, 'expected cash') : 0;
    const variance = moneyNumber(countedCashPaise - expectedCashPaise);
    if (variance !== 0 && (!input.supervisorApproved || !String(input.supervisorActor || '').trim())) throw new Error('a non-zero cash variance requires supervisor approval');
    if (variance !== 0 && !String(input.note || '').trim()) throw new Error('a variance explanation is required before supervisor approval');
    row.data.counted_cash = moneyNumber(countedCashPaise); row.data.expected_cash = moneyNumber(expectedCashPaise); row.data.variance = variance; row.data.closed_at = now; row.data.closed_by = actor; row.data.close_note = String(input.note || '').trim().slice(0, 500);
    row.data.variance_approved_by = variance !== 0 ? String(input.supervisorActor).trim().slice(0, 160) : undefined;
    row.data.variance_approved_at = variance !== 0 ? now : undefined;
    row.status = 'Closed'; row.updated_at = now; store.updateRow(row);
    const movement = before?.movementCounts || { collections: 0, expenses: 0, refunds: 0 };
    store.appendCashShiftClose({
      id: randomUUID(), tenant, storeId: store.currentStore(tenant), shiftId: row.id, register: String(row.data.register || 'Main counter'),
      businessDate: String(row.data.business_date || laundryBusinessDate()), openingCashPaise: before ? paiseAmount(before.openingCash, 'opening cash') : 0,
      collectionsPaise: before ? paiseAmount(before.collections, 'collections') : 0, expensesPaise: before ? paiseAmount(before.expenses, 'expenses') : 0,
      refundsPaise: before ? paiseAmount(before.refunds, 'refunds') : 0, expectedCashPaise, countedCashPaise, variancePaise: countedCashPaise - expectedCashPaise,
      collectionCount: movement.collections, expenseCount: movement.expenses, refundCount: movement.refunds, closedAt: now, closedBy: actor,
      supervisorActor: variance !== 0 ? String(input.supervisorActor).trim().slice(0, 160) : undefined, note: String(input.note || '').trim().slice(0, 500),
    });
    audit(tenant, actor, 'laundry:cash-shift-closed', { entity: row.entity, row_id: row.id, before: before ? { status: before.status, expectedCash: before.expectedCash } : undefined, after: { countedCash, variance: row.data.variance, movementCounts: before?.movementCounts } });
    return present(tenant, row);
  });
}
