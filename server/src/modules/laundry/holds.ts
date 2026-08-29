import { randomUUID } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { ORDER_HOLD_LEASE_MINUTES as STORE_ORDER_HOLD_LEASE_MINUTES, store, type LaundryOrderHoldRecord } from '../../kernel/store.js';

export const ORDER_HOLD_LEASE_MINUTES = STORE_ORDER_HOLD_LEASE_MINUTES;
const ORDER_HOLD_LEASE_MS = ORDER_HOLD_LEASE_MINUTES * 60 * 1000;

export type LaundryOrderHoldPayload = {
  cart: Record<string, unknown>;
  customer?: Record<string, unknown> | null;
  newCustomerName?: string;
  newCustomerPhone?: string;
  deliveryAddress?: string;
  serviceZone?: string;
  deliveryMode?: string;
  expectedDeliveryDate?: string;
  charges?: number;
  discounts?: number;
  taxRate?: number;
  chargeRuleIds?: string[];
  discountRuleIds?: string[];
  taxRuleId?: string;
  notes?: string;
  paymentMode?: string;
  paymentReference?: string;
};

function text(value: unknown, max: number) { return String(value ?? '').trim().slice(0, max); }
function sanitizePayload(input: unknown): LaundryOrderHoldPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('order hold payload must be an object');
  const body = input as Record<string, unknown>;
  const cart = body.cart;
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) throw new Error('order hold requires a cart object');
  const normalizedCart: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cart as Record<string, unknown>).slice(0, 100)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const line = value as Record<string, unknown>;
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 1000) throw new Error('order hold cart quantities must be positive integers');
    normalizedCart[text(key, 180)] = { garment: text(line.garment, 160), service: text(line.service, 160), qty };
  }
  if (!Object.keys(normalizedCart).length) throw new Error('order hold requires at least one cart line');
  const customer = body.customer && typeof body.customer === 'object' && !Array.isArray(body.customer) ? body.customer as Record<string, unknown> : null;
  const result: LaundryOrderHoldPayload = {
    cart: normalizedCart,
    customer: customer ? { id: text(customer.id, 160), name: text(customer.name, 160), phone: text(customer.phone, 40), email: text(customer.email, 200), address: text(customer.address, 500) } : null,
    newCustomerName: text(body.newCustomerName, 160), newCustomerPhone: text(body.newCustomerPhone, 40), deliveryAddress: text(body.deliveryAddress, 500), serviceZone: text(body.serviceZone, 120), deliveryMode: text(body.deliveryMode, 40), expectedDeliveryDate: text(body.expectedDeliveryDate, 20),
    charges: Number(body.charges || 0), discounts: Number(body.discounts || 0), taxRate: Number(body.taxRate || 0),
    chargeRuleIds: Array.isArray(body.chargeRuleIds) ? body.chargeRuleIds.slice(0, 20).map((value) => text(value, 160)) : [], discountRuleIds: Array.isArray(body.discountRuleIds) ? body.discountRuleIds.slice(0, 20).map((value) => text(value, 160)) : [], taxRuleId: text(body.taxRuleId, 160), notes: text(body.notes, 1000), paymentMode: text(body.paymentMode || 'Pay Later', 40), paymentReference: text(body.paymentReference, 160),
  };
  const numericValues = [result.charges, result.discounts, result.taxRate].map((value) => Number(value));
  if (!numericValues.every((value) => Number.isFinite(value) && value >= 0)) throw new Error('order hold money and tax values must be non-negative numbers');
  const serialized = JSON.stringify(result);
  if (serialized.length > 100_000) throw new Error('order hold payload is too large');
  return result;
}

export function createLaundryOrderHold(tenant: string, actor: string, input: unknown) {
  const payload = sanitizePayload(input);
  const now = new Date().toISOString();
  const hold = store.createOrderHold({ id: randomUUID(), tenant, storeId: store.currentStore(tenant), holdCode: '', status: 'Held', payload: payload as unknown as Record<string, unknown>, createdBy: actor, createdAt: now, updatedAt: now });
  audit(tenant, actor, 'laundry:order-held', { entity: 'laundry_order_hold', row_id: hold.id, after: { holdCode: hold.holdCode, itemLines: Object.keys(payload.cart).length } });
  return hold;
}

export function listLaundryOrderHolds(tenant: string, actor: string, includeClosed = false) {
  const now = Date.now();
  return store.listOrderHolds(tenant, includeClosed).map((hold) => {
    const ownershipAt = hold.ownershipUpdatedAt ? Date.parse(hold.ownershipUpdatedAt) : NaN;
    const leaseExpiresAt = hold.ownerActor && Number.isFinite(ownershipAt) ? new Date(ownershipAt + ORDER_HOLD_LEASE_MS).toISOString() : undefined;
    const expired = Boolean(leaseExpiresAt && Date.parse(leaseExpiresAt) <= now);
    const ownership = hold.ownerActor ? expired ? 'expired' as const : hold.ownerActor === actor ? 'mine' as const : 'other' as const : 'unassigned' as const;
    return { ...hold, leaseExpiresAt, ownership };
  });
}

/** Read-only counter presence projection. Expiry is derived from the audited ownership timestamp. */
export function orderHoldPresence(tenant: string, actor: string) {
  const holds = listLaundryOrderHolds(tenant, actor);
  const expired = holds.filter((hold) => hold.ownership === 'expired');
  return {
    observedAt: new Date().toISOString(),
    leaseMinutes: ORDER_HOLD_LEASE_MINUTES,
    totalHeld: holds.length,
    mineActive: holds.filter((hold) => hold.ownership === 'mine').length,
    otherActive: holds.filter((hold) => hold.ownership === 'other').length,
    expired: expired.length,
    unassigned: holds.filter((hold) => hold.ownership === 'unassigned').length,
    staleHoldCodes: expired.slice(0, 50).map((hold) => hold.holdCode),
  };
}

export function claimLaundryOrderHold(tenant: string, actor: string, id: string) {
  const current = store.getOrderHold(tenant, id);
  const next = store.claimOrderHold(tenant, id, actor);
  audit(tenant, actor, 'laundry:order-hold-claimed', { entity: 'laundry_order_hold', row_id: id, after: { holdCode: next.holdCode, previousOwner: current?.ownerActor || '' } });
  return { ...next, ownership: 'mine' as const, leaseExpiresAt: new Date(Date.now() + ORDER_HOLD_LEASE_MS).toISOString() };
}

export function renewLaundryOrderHold(tenant: string, actor: string, id: string) {
  const next = store.renewOrderHold(tenant, id, actor);
  audit(tenant, actor, 'laundry:order-hold-renewed', { entity: 'laundry_order_hold', row_id: id, after: { holdCode: next.holdCode, leaseMinutes: ORDER_HOLD_LEASE_MINUTES } });
  return { ...next, ownership: 'mine' as const, leaseExpiresAt: new Date(Date.now() + ORDER_HOLD_LEASE_MS).toISOString() };
}

export function releaseLaundryOrderHold(tenant: string, actor: string, id: string, override = false) {
  const next = store.releaseOrderHold(tenant, id, actor, override);
  audit(tenant, actor, 'laundry:order-hold-released', { entity: 'laundry_order_hold', row_id: id, after: { holdCode: next.holdCode, override } });
  return { ...next, ownership: 'unassigned' as const, leaseExpiresAt: undefined };
}

export function resumeLaundryOrderHold(tenant: string, actor: string, id: string, override = false) {
  const hold = store.getOrderHold(tenant, id);
  if (!hold) throw new Error('order hold not found');
  if (hold.status !== 'Held') throw new Error(`order hold is already ${hold.status.toLowerCase()}`);
  if (hold.ownerActor && hold.ownerActor !== actor && !override) throw new Error('order hold is owned by another counter; claim it before resuming');
  const now = new Date().toISOString();
  const next = { ...hold, status: 'Resumed' as const, resumedBy: actor, resumedAt: now, updatedAt: now };
  store.updateOrderHold(next);
  audit(tenant, actor, 'laundry:order-hold-resumed', { entity: 'laundry_order_hold', row_id: hold.id, after: { holdCode: hold.holdCode } });
  return next;
}

export function cancelLaundryOrderHold(tenant: string, actor: string, id: string, override = false) {
  const hold = store.getOrderHold(tenant, id);
  if (!hold) throw new Error('order hold not found');
  if (hold.status !== 'Held') throw new Error(`order hold is already ${hold.status.toLowerCase()}`);
  if (hold.ownerActor && hold.ownerActor !== actor && !override) throw new Error('order hold is owned by another counter; claim it before cancelling');
  const now = new Date().toISOString();
  const next = { ...hold, status: 'Cancelled' as const, cancelledBy: actor, cancelledAt: now, updatedAt: now };
  store.updateOrderHold(next);
  audit(tenant, actor, 'laundry:order-hold-cancelled', { entity: 'laundry_order_hold', row_id: hold.id, after: { holdCode: hold.holdCode } });
  return next;
}
