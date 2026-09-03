import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';

const reasons = new Set(['Quality issue', 'Service not performed', 'Duplicate charge', 'Customer cancellation', 'Other']);

export function listLaundryReturns(tenant: string) {
  return store.rowsOf(tenant, 'laundry_return_case').filter((row) => row.status !== 'Cancelled').map((row) => ({ id: row.id, status: String(row.data.status || 'Requested'), orderId: String(row.data.order || ''), customerId: String(row.data.customer || ''), amount: Number(row.data.amount || 0), reason: String(row.data.reason || ''), note: String(row.data.note || ''), createdAt: row.created_at, decisionNote: String(row.data.decision_note || '') })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function requestLaundryReturn(tenant: string, actor: string, input: Record<string, unknown>) {
  const orderId = String(input.orderId || '').trim();
  const order = store.getRow(tenant, orderId);
  const reason = String(input.reason || '').trim();
  const amount = Number(input.amount || 0);
  if (!order || order.entity !== 'laundry_order') throw new Error('RETURN_ORDER_NOT_FOUND');
  if (!reasons.has(reason)) throw new Error('RETURN_REASON_INVALID');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('RETURN_AMOUNT_INVALID');
  const max = Number(order.data.grand_total || 0);
  if (amount > max) throw new Error('RETURN_EXCEEDS_ORDER_TOTAL');
  const duplicate = store.rowsOf(tenant, 'laundry_return_case').find((row) => row.data.order === orderId && row.data.amount === amount && row.data.reason === reason && row.data.status === 'Requested');
  if (duplicate) return { duplicate: true, returnCase: duplicate };
  const returnCase = createRow(tenant, actor, 'laundry_return_case', { order: orderId, customer: String(order.data.customer || ''), amount, reason, note: String(input.note || '').trim().slice(0, 1000), status: 'Requested' });
  audit(tenant, actor, 'laundry:return-requested', { entity: returnCase.entity, row_id: returnCase.id, after: { orderId, amount, reason } });
  return { duplicate: false, returnCase };
}
