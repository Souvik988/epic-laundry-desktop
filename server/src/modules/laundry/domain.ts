import { audit } from '../../kernel/audit.js';
import { cancelRow, createRow, submitRow } from '../../kernel/entity-service.js';
import { publish } from '../../kernel/event-bus.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { appendCustomerLedger, searchCustomerRecords } from './customers.js';
import { notify } from '../crm/engagement.js';
import { laundryBusinessDate } from './dates.js';

export const LAUNDRY_STATES = ['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'] as const;
export type LaundryState = typeof LAUNDRY_STATES[number];

type BookInput = {
  customer: { id?: string; name?: string; phone?: string; email?: string; address?: string };
  items: Array<{ garment: string; service: string; qty: number }>;
  orderDate?: string;
  expectedDeliveryDate: string;
  fulfillmentMode: 'Pickup Order' | 'Home Delivery' | 'Express Delivery';
  paymentMode?: 'Pay Later' | 'Cash' | 'UPI' | 'Card' | 'Bank';
  paymentReference?: string;
  charges?: number;
  discounts?: number;
  taxRate?: number;
  chargeRuleIds?: string[];
  discountRuleIds?: string[];
  taxRuleId?: string;
  notes?: string;
  photoPaths?: string;
  placeOfSupply?: string;
};

type QuotedItem = {
  garment: string;
  garmentName: string;
  service: string;
  serviceName: string;
  unit: string;
  qty: number;
  rate: number;
  priceRule: string;
  amount: number;
  hsn: string;
};

type Quote = {
  items: QuotedItem[];
  subtotal: number;
  charges: number;
  discounts: number;
  taxable: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
};

type ExpenseInput = {
  expenseName: string;
  expenseDate: string;
  amount: number;
  paymentReceiver?: string;
  invoiceNumber?: string;
  isTaxPaid?: boolean;
  paymentMode?: 'Cash' | 'UPI' | 'Card' | 'Bank';
  notes?: string;
  attachment?: string;
};

type ImportCustomerInput = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
};

type ImportPriceInput = {
  garmentName?: string;
  categoryName?: string;
  serviceName?: string;
  rate?: number | string;
  unit?: string;
  hsn?: string;
  gstRate?: number | string;
  customerPhone?: string;
};

type ImportIssue = { row: number; message: string };
type ImportResult = { created: number; updated: number; skipped: number; errors: ImportIssue[]; job?: { id: string; status: string } };
type RiderInput = { name: string; phone?: string };
type AssignmentInput = { stage: 'pickup' | 'delivery'; riderId?: string; slot?: string };
type RiderSettlementInput = { rider?: string; date?: string; amount?: number; method?: 'Cash' | 'UPI' | 'Bank'; status?: 'Pending' | 'Handed Over' | 'Reconciled' | 'Rejected'; orderIds?: string[]; reference?: string; notes?: string };
type FulfillmentInput = { itemIndex?: number; stage?: 'Picked Up' | 'In Process' | 'Ready' | 'Delivered'; quantity?: number; note?: string };
type EditOrderInput = Pick<BookInput, 'items' | 'expectedDeliveryDate' | 'fulfillmentMode' | 'charges' | 'discounts' | 'taxRate' | 'chargeRuleIds' | 'discountRuleIds' | 'taxRuleId'> & { notes?: string; deliveryAddress?: string };
type CategoryInput = { name?: string; color?: string; image?: string; sortOrder?: number; active?: boolean };
type ServiceInput = { name?: string; description?: string; units?: string[]; active?: boolean };
type GarmentInput = { name?: string; code?: string; category?: string; unit?: string; hsn?: string; gstRate?: number; photo?: string; active?: boolean };
type PriceInput = { garment?: string; service?: string; customer?: string; rate?: number; active?: boolean };
type AdjustmentRuleInput = { name?: string; type?: 'Flat' | 'Percentage'; amount?: number; description?: string; active?: boolean };
type TaxRuleInput = { name?: string; rate?: number; active?: boolean };

const SERVICE_UNITS = ['Piece', 'Kilogram', 'Pair', 'Square Foot'] as const;
const MAX_MASTER_IMAGE_PATH = 512;

const TRANSITIONS: Record<LaundryState, LaundryState[]> = {
  Booked: ['Picked Up', 'In Process', 'Cancelled'],
  'Picked Up': ['In Process', 'Cancelled'],
  'In Process': ['Ready', 'Cancelled'],
  Ready: ['Out for Delivery', 'Delivered', 'Cancelled'],
  'Out for Delivery': ['Delivered'],
  Delivered: [],
  Cancelled: [],
};

const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const today = () => laundryBusinessDate();
const normPhone = (value?: string) => String(value || '').replace(/\D/g, '');

function activeRows(tenant: string, entity: string) {
  return store.rowsOf(tenant, entity).filter((row) => row.data.active !== false);
}

function getRequired(tenant: string, entity: string, id: string, label: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== entity) throw new Error(`${label} not found`);
  if (row.data.active === false) throw new Error(`${label} is inactive`);
  return row;
}

function resolveCustomer(tenant: string, actor: string, input: BookInput['customer']) {
  if (input.id) {
    const customer = store.getRow(tenant, input.id);
    if (!customer || customer.entity !== 'party' || !customer.data.is_customer) throw new Error('customer not found');
    return customer;
  }
  const phone = normPhone(input.phone);
  if (!input.name?.trim()) throw new Error('customer name is required');
  if (phone.length < 6) throw new Error('a valid customer phone is required');
  const existing = store.rowsOf(tenant, 'party').find((row) => normPhone(row.data.phone) === phone && row.data.is_customer);
  if (existing) return existing;
  return createRow(tenant, actor, 'party', {
    name: input.name.trim(), phone, email: input.email?.trim(), address: input.address?.trim(), is_customer: true,
  });
}

function priceFor(tenant: string, garment: string, service: string, customer: string) {
  const prices = activeRows(tenant, 'laundry_price')
    .filter((row) => row.data.garment === garment && row.data.service === service)
    .sort((a, b) => Number(Boolean(b.data.customer)) - Number(Boolean(a.data.customer)));
  const rule = prices.find((row) => row.data.customer === customer) || prices.find((row) => !row.data.customer);
  if (!rule) throw new Error('no active price rule exists for this garment and service');
  const rate = round(Number(rule.data.rate));
  if (rate < 0) throw new Error('price rule has an invalid rate');
  return { rate, rule };
}

function selectedRules(tenant: string, entity: string, ids: unknown) {
  const requested = Array.isArray(ids) ? ids.map(String) : [];
  if (requested.length !== new Set(requested).size) throw new Error('each configuration rule can only be selected once');
  return requested.map((id) => getRequired(tenant, entity, id, 'configuration rule'));
}

function amountForRule(rule: EntityRow, base: number) {
  const amount = round(Number(rule.data.amount));
  if (!Number.isFinite(amount) || amount < 0) throw new Error('configuration rule has an invalid amount');
  return rule.data.type === 'Percentage' ? round(base * amount / 100) : amount;
}

export function quoteLaundryOrder(tenant: string, input: Pick<BookInput, 'items' | 'charges' | 'discounts' | 'taxRate' | 'chargeRuleIds' | 'discountRuleIds' | 'taxRuleId'>, customer = ''): Quote {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('select at least one garment');
  const seen = new Set<string>();
  const items = input.items.map((line) => {
    const qty = Number(line.qty);
    if (!line.garment || !line.service || !Number.isFinite(qty) || qty <= 0) throw new Error('each garment line needs a service and positive quantity');
    const key = `${line.garment}:${line.service}`;
    if (seen.has(key)) throw new Error('duplicate garment and service lines must be combined');
    seen.add(key);
    const garment = getRequired(tenant, 'laundry_garment', line.garment, 'garment');
    const service = getRequired(tenant, 'laundry_service', line.service, 'service');
    const price = priceFor(tenant, garment.id, service.id, customer);
    return {
      garment: garment.id,
      garmentName: String(garment.data.name),
      service: service.id,
      serviceName: String(service.data.name),
      unit: String(garment.data.unit || 'Piece'),
      qty: round(qty),
      rate: price.rate,
      priceRule: price.rule.id,
      amount: round(qty * price.rate),
      hsn: String(garment.data.hsn || '9997'),
    };
  });
  const subtotal = round(items.reduce((sum, item) => sum + item.amount, 0));
  const configuredCharges = selectedRules(tenant, 'laundry_charge_rule', input.chargeRuleIds).reduce((sum, rule) => round(sum + amountForRule(rule, subtotal)), 0);
  const charges = Math.max(0, round(configuredCharges + (Number(input.charges) || 0)));
  const configuredDiscounts = selectedRules(tenant, 'laundry_discount_rule', input.discountRuleIds).reduce((sum, rule) => round(sum + amountForRule(rule, subtotal + charges)), 0);
  const discounts = Math.min(round(configuredDiscounts + (Number(input.discounts) || 0)), subtotal + charges);
  const taxable = round(subtotal + charges - discounts);
  const selectedTax = input.taxRuleId ? getRequired(tenant, 'laundry_tax_rule', String(input.taxRuleId), 'tax rule') : undefined;
  const taxRate = Math.max(0, Math.min(100, round(selectedTax ? Number(selectedTax.data.rate) : Number(input.taxRate) || 0)));
  const taxAmount = round(taxable * taxRate / 100);
  return { items, subtotal, charges, discounts, taxable, taxRate, taxAmount, grandTotal: round(taxable + taxAmount) };
}

function invoiceItems(quote: Quote) {
  const rows = quote.items.map((item) => ({
    item: item.garment, qty: item.qty, rate: item.rate, gst_rate: quote.taxRate, hsn: item.hsn,
    description: `${item.garmentName} · ${item.serviceName}`,
  }));
  const adjustment = round(quote.charges - quote.discounts);
  if (adjustment !== 0) {
    rows.push({ item: 'LAUNDRY-ADJUSTMENT', qty: 1, rate: adjustment, gst_rate: quote.taxRate, hsn: '9997', description: 'Laundry order adjustment' });
  }
  return rows;
}

export function bookLaundryOrder(tenant: string, actor: string, input: BookInput) {
  return store.transaction(() => {
  if (!input.expectedDeliveryDate || Number.isNaN(Date.parse(input.expectedDeliveryDate))) throw new Error('expected delivery date is required');
  const orderDate = input.orderDate || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || Number.isNaN(Date.parse(`${orderDate}T00:00:00Z`))) throw new Error('order date must be a valid calendar date');
  const photoPaths = String(input.photoPaths || '').trim();
  if (photoPaths && photoPaths.length > 1_500_000) throw new Error('order photo must be under 1 MB');
  if (photoPaths && !(/^(?:\/ui\/app\/(?:garments|brand)\/[^\s,]+|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/i.test(photoPaths))) throw new Error('order photo must be a local approved asset or PNG, JPEG, or WebP data image');
  const customer = resolveCustomer(tenant, actor, input.customer || {});
  const quote = quoteLaundryOrder(tenant, input, customer.id);
  const paymentMode = input.paymentMode || 'Pay Later';
  const placeOfSupply = input.placeOfSupply || process.env.EPIC_SUPPLIER_STATE || '29';
  const invoice = createRow(tenant, actor, 'sales_invoice', {
    customer: customer.id,
    posting_date: orderDate,
    place_of_supply: placeOfSupply,
    currency: 'INR',
    // Laundry operators decide when to send a customer message. Booking must never send one implicitly.
    suppress_notifications: true,
    items: invoiceItems(quote),
  });
  const submittedInvoice = submitRow(tenant, actor, 'sales_invoice', invoice.id);
  if (process.env.EPIC_TEST_BOOKING_FAIL_AT === 'after-invoice') {
    throw new Error('forced booking failure after invoice');
  }
  let paymentEntry: EntityRow | undefined;
  if (paymentMode !== 'Pay Later') {
    paymentEntry = createRow(tenant, actor, 'payment_entry', {
      payment_type: 'Receive', party: customer.id, posting_date: orderDate, mode: paymentMode,
      amount: quote.grandTotal, against_sales: submittedInvoice.id, reference: input.paymentReference?.trim().slice(0, 120), provider_status: 'Manual',
      remarks: `Laundry order payment for ${submittedInvoice.data.name}`,
    });
    submitRow(tenant, actor, 'payment_entry', paymentEntry.id);
  }
  const order = createRow(tenant, actor, 'laundry_order', {
    customer: customer.id,
    order_date: orderDate,
    expected_delivery_date: input.expectedDeliveryDate,
    fulfillment_mode: input.fulfillmentMode,
    state: 'Booked',
    items: quote.items,
    subtotal: quote.subtotal,
    charges: quote.charges,
    discounts: quote.discounts,
    tax_rate: quote.taxRate,
    tax_amount: quote.taxAmount,
    grand_total: quote.grandTotal,
    payment_mode: paymentMode,
    payment_status: paymentEntry ? 'Paid' : 'Unpaid',
    invoice: submittedInvoice.id,
    payment_entry: paymentEntry?.id,
    source: 'By Store',
    notes: input.notes?.trim(),
    photo_paths: photoPaths,
    delivery_address: input.customer?.address?.trim(),
  });
  order.status = 'Booked';
  order.updated_at = new Date().toISOString();
  store.updateRow(order);
  appendCustomerLedger(tenant, actor, { customer: customer.id, entryType: 'Invoice Debit', debit: quote.grandTotal, referenceType: 'laundry_order', referenceId: order.id, reason: `Order ${order.data.name || order.id}` });
  if (paymentEntry) appendCustomerLedger(tenant, actor, { customer: customer.id, entryType: 'Payment Credit', credit: quote.grandTotal, referenceType: 'payment_entry', referenceId: paymentEntry.id, reason: `Payment against ${submittedInvoice.data.name || submittedInvoice.id}` });
  audit(tenant, actor, 'laundry:booked', { entity: 'laundry_order', row_id: order.id, after: { state: 'Booked', invoice: submittedInvoice.id } });
  notify(tenant, { title: `New laundry order ${order.data.name || order.id}`, body: `${customer.data.name || 'Customer'} · ₹${quote.grandTotal.toFixed(2)}`, kind: 'Laundry order', severity: 'info', ref_entity: 'laundry_order', ref_id: order.id });
  publish(tenant, 'laundry.order.booked.v1', { id: order.id, invoice: submittedInvoice.id, customer: customer.id, grand_total: quote.grandTotal });
  return { order: presentOrder(tenant, order), receipt: receiptFor(tenant, order), tags: tagsFor(tenant, order) };
  });
}

export function transitionLaundryOrder(tenant: string, actor: string, id: string, state: LaundryState, note?: string) {
  return store.transaction(() => {
    if (!LAUNDRY_STATES.includes(state)) throw new Error('unknown laundry order state');
    const order = store.getRow(tenant, id);
    if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
    const from = order.data.state as LaundryState;
    if (!TRANSITIONS[from]?.includes(state)) throw new Error(`cannot move an order from ${from} to ${state}`);
    if (state === 'Picked Up' && order.data.fulfillment_mode === 'Pickup Order' && !order.data.pickup_rider) throw new Error('assign a pickup rider before marking this order picked up');
    if (state === 'Out for Delivery' && order.data.fulfillment_mode !== 'Pickup Order' && !order.data.delivery_rider) throw new Error('assign a delivery rider before dispatching this order');
    order.data.state = state;
    order.data.last_transition_note = note?.trim() || undefined;
    order.data.last_transition_at = new Date().toISOString();
    order.status = state;
    order.updated_at = new Date().toISOString();
    store.updateRow(order);
    audit(tenant, actor, 'laundry:transition', { entity: 'laundry_order', row_id: order.id, before: { state: from }, after: { state, note: note?.trim() } });
    notify(tenant, { title: `${order.data.name || id} moved to ${state}`, body: note?.trim() || `Laundry order status changed from ${from}.`, kind: 'Fulfilment', severity: state === 'Cancelled' ? 'warning' : 'info', ref_entity: 'laundry_order', ref_id: id });
    publish(tenant, 'laundry.order.transitioned.v1', { id: order.id, from, state });
    return presentOrder(tenant, order);
  });
}

export function cancelLaundryOrder(tenant: string, actor: string, id: string, reason: string) {
  return store.transaction(() => {
    const order = store.getRow(tenant, id);
    if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
    const current = String(order.data.state || 'Booked') as LaundryState;
    if (current === 'Cancelled') throw new Error('order is already cancelled');
    if (current === 'Delivered') throw new Error('delivered orders cannot be cancelled');
    const note = String(reason || '').trim().slice(0, 500);
    if (!note) throw new Error('cancellation reason is required');
    const invoice = store.getRow(tenant, String(order.data.invoice || ''));
    if (invoice?.entity === 'sales_invoice' && invoice.status === 'Submitted') {
      const payments = store.rowsOf(tenant, 'payment_entry').filter((payment) => payment.status === 'Submitted' && payment.data.payment_type === 'Receive' && payment.data.against_sales === invoice.id);
      for (const payment of payments) {
        const amount = round(Number(payment.data.amount || 0));
        const cancelled = cancelRow(tenant, actor, 'payment_entry', payment.id);
        cancelled.data.provider_status = 'Reversed';
        cancelled.data.reversal_reason = note;
        cancelled.updated_at = new Date().toISOString();
        store.updateRow(cancelled);
        if (amount > 0) appendCustomerLedger(tenant, actor, { customer: String(order.data.customer), entryType: 'Refund', debit: amount, referenceType: 'payment_entry', referenceId: payment.id, reason: `Order cancellation: ${note}` });
      }
      cancelRow(tenant, actor, 'sales_invoice', invoice.id);
      const total = round(Number(order.data.grand_total || invoice.data.grand_total || 0));
      if (total > 0) appendCustomerLedger(tenant, actor, { customer: String(order.data.customer), entryType: 'Adjustment', credit: total, referenceType: 'laundry_order', referenceId: order.id, reason: `Invoice reversal: ${note}` });
    }
    order.data.state = 'Cancelled';
    order.data.payment_status = 'Unpaid';
    order.data.cancellation_reason = note;
    order.data.cancelled_at = new Date().toISOString();
    order.data.cancelled_by = actor;
    order.status = 'Cancelled';
    order.updated_at = new Date().toISOString();
    store.updateRow(order);
    audit(tenant, actor, 'laundry:order-cancelled', { entity: order.entity, row_id: order.id, before: { state: current }, after: { state: 'Cancelled', reason: note, invoice: invoice?.id } });
    notify(tenant, { title: `${order.data.name || id} cancelled`, body: note, kind: 'Cancellation', severity: 'warning', ref_entity: 'laundry_order', ref_id: id });
    publish(tenant, 'laundry.order.cancelled.v1', { id: order.id, reason: note });
    return presentOrder(tenant, order);
  });
}

export function editLaundryOrder(tenant: string, actor: string, id: string, input: EditOrderInput) {
  return store.transaction(() => {
    const order = store.getRow(tenant, id);
    if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
    const current = String(order.data.state || 'Booked') as LaundryState;
    if (['Delivered', 'Cancelled'].includes(current)) throw new Error('completed or cancelled orders cannot be edited');
    if (store.rowsOf(tenant, 'laundry_fulfillment_event').some((event) => event.data.order === id && event.status === 'Submitted')) throw new Error('orders with fulfilment events cannot be edited; cancel and rebook instead');
    const customer = store.getRow(tenant, String(order.data.customer || ''));
    if (!customer || customer.entity !== 'party') throw new Error('order customer not found');
    const quote = quoteLaundryOrder(tenant, input, customer.id);
    const invoice = store.getRow(tenant, String(order.data.invoice || ''));
    if (!invoice || invoice.entity !== 'sales_invoice' || invoice.status !== 'Submitted') throw new Error('order has no active invoice to amend');
    const submittedPayments = store.rowsOf(tenant, 'payment_entry').filter((payment) => payment.status === 'Submitted' && payment.data.payment_type === 'Receive' && payment.data.against_sales === invoice.id);
    if (submittedPayments.length) throw new Error('paid or partially paid orders cannot be edited; reverse the collection or cancel and rebook');
    const oldTotal = round(Number(order.data.grand_total || invoice.data.grand_total || 0));
    const oldInvoice = cancelRow(tenant, actor, 'sales_invoice', invoice.id);
    const replacement = createRow(tenant, actor, 'sales_invoice', { customer: customer.id, posting_date: today(), place_of_supply: String(invoice.data.place_of_supply || process.env.EPIC_SUPPLIER_STATE || '29'), currency: 'INR', suppress_notifications: true, items: invoiceItems(quote) });
    const submittedReplacement = submitRow(tenant, actor, 'sales_invoice', replacement.id);
    order.data.expected_delivery_date = input.expectedDeliveryDate;
    order.data.fulfillment_mode = input.fulfillmentMode;
    order.data.items = quote.items;
    order.data.subtotal = quote.subtotal;
    order.data.charges = quote.charges;
    order.data.discounts = quote.discounts;
    order.data.tax_rate = quote.taxRate;
    order.data.tax_amount = quote.taxAmount;
    order.data.grand_total = quote.grandTotal;
    order.data.payment_status = 'Unpaid';
    order.data.invoice = submittedReplacement.id;
    order.data.previous_invoice = oldInvoice.id;
    order.data.delivery_address = input.deliveryAddress?.trim() || order.data.delivery_address || customer.data.address || '';
    order.data.notes = input.notes?.trim() ?? order.data.notes;
    order.data.edit_revision = Number(order.data.edit_revision || 0) + 1;
    order.data.last_edit_at = new Date().toISOString();
    order.data.last_edit_by = actor;
    order.updated_at = new Date().toISOString();
    store.updateRow(order);
    if (oldTotal > 0) appendCustomerLedger(tenant, actor, { customer: customer.id, entryType: 'Adjustment', credit: oldTotal, referenceType: 'laundry_order', referenceId: order.id, reason: 'Invoice reversal for controlled order edit' });
    if (quote.grandTotal > 0) appendCustomerLedger(tenant, actor, { customer: customer.id, entryType: 'Invoice Debit', debit: quote.grandTotal, referenceType: 'laundry_order', referenceId: order.id, reason: 'Replacement invoice after controlled order edit' });
    audit(tenant, actor, 'laundry:order-edited', { entity: order.entity, row_id: order.id, before: { invoice: invoice.id, grandTotal: oldTotal }, after: { invoice: submittedReplacement.id, grandTotal: quote.grandTotal, delta: round(quote.grandTotal - oldTotal) } });
    notify(tenant, { title: `${order.data.name || id} updated`, body: `Replacement invoice ${submittedReplacement.data.name || submittedReplacement.id} · ₹${quote.grandTotal.toFixed(2)}`, kind: 'Order edit', severity: 'info', ref_entity: 'laundry_order', ref_id: id });
    publish(tenant, 'laundry.order.edited.v1', { id: order.id, previous_invoice: invoice.id, invoice: submittedReplacement.id, grand_total: quote.grandTotal });
    return presentOrder(tenant, order);
  });
}

export function listLaundryFulfillment(tenant: string, orderId: string) {
  const order = store.getRow(tenant, orderId);
  if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
  return store.rowsOf(tenant, 'laundry_fulfillment_event').filter((event) => event.data.order === orderId).map((event) => ({
    id: event.id, itemIndex: Number(event.data.item_index), stage: event.data.stage, quantity: Number(event.data.quantity), unit: event.data.unit,
    note: event.data.note || '', eventDate: event.data.event_date, createdAt: event.created_at, actor: event.created_by,
  }));
}

export function recordLaundryFulfillment(tenant: string, actor: string, orderId: string, input: FulfillmentInput) {
  return store.transaction(() => {
    const order = store.getRow(tenant, orderId);
    if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
    if (order.data.state === 'Cancelled') throw new Error('cancelled orders cannot receive fulfilment events');
    const itemIndex = Math.trunc(Number(input.itemIndex));
    const items = Array.isArray(order.data.items) ? order.data.items as Array<Record<string, unknown>> : [];
    const item = items[itemIndex];
    if (!item) throw new Error('order item was not found');
    const stage = input.stage;
    if (!stage || !['Picked Up', 'In Process', 'Ready', 'Delivered'].includes(stage)) throw new Error('fulfilment stage is required');
    const quantity = Math.round(Number(input.quantity) * 100) / 100;
    const ordered = Math.round((Number(item.qty) || 0) * 100) / 100;
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('fulfilment quantity must be greater than zero');
    const existing = store.rowsOf(tenant, 'laundry_fulfillment_event').filter((event) => event.data.order === orderId && Number(event.data.item_index) === itemIndex && event.data.stage === stage);
    const recorded = Math.round(existing.reduce((sum, event) => sum + (Number(event.data.quantity) || 0), 0) * 100) / 100;
    if (recorded + quantity > ordered) throw new Error(`fulfilment exceeds ordered quantity (${ordered} ${String(item.unit || 'Piece')})`);
    const event = createRow(tenant, actor, 'laundry_fulfillment_event', { order: orderId, item_index: itemIndex, stage, quantity, unit: String(item.unit || 'Piece'), note: String(input.note || '').trim().slice(0, 500), event_date: today() });
    submitRow(tenant, actor, 'laundry_fulfillment_event', event.id);
    audit(tenant, actor, 'laundry:fulfillment-recorded', { entity: event.entity, row_id: event.id, after: event.data });
    return { id: event.id, itemIndex, stage, quantity, unit: event.data.unit, note: event.data.note || '', eventDate: event.data.event_date, createdAt: event.created_at, actor: event.created_by };
  });
}

export function presentOrder(tenant: string, order: EntityRow) {
  const customer = store.getRow(tenant, order.data.customer);
  const pickupRider = store.getRow(tenant, order.data.pickup_rider);
  const deliveryRider = store.getRow(tenant, order.data.delivery_rider);
  const items = Array.isArray(order.data.items) ? order.data.items : [];
  const fulfilmentEvents = store.rowsOf(tenant, 'laundry_fulfillment_event').filter((event) => event.data.order === order.id && event.status === 'Submitted');
  const itemProgress = (item: any, index: number) => {
    const ordered = round(Number(item.qty) || 0);
    const byStage = (stage: string) => round(fulfilmentEvents.filter((event) => Number(event.data.item_index) === index && event.data.stage === stage).reduce((sum, event) => sum + (Number(event.data.quantity) || 0), 0));
    const pickedUp = Math.min(ordered, byStage('Picked Up'));
    const inProcess = Math.min(ordered, byStage('In Process'));
    const ready = Math.min(ordered, byStage('Ready'));
    const delivered = Math.min(ordered, byStage('Delivered'));
    const received = Math.max(pickedUp, inProcess, ready, delivered);
    return { ...item, fulfilment: { ordered, received, delivered, pending: round(Math.max(0, ordered - delivered)), pickedUp, inProcess, ready } };
  };
  return {
    id: order.id,
    orderNumber: order.data.name || order.id,
    invoiceNumber: store.getRow(tenant, order.data.invoice)?.data.name || order.data.invoice,
    customer: { id: customer?.id, name: customer?.data.name || 'Unknown customer', phone: customer?.data.phone || '' },
    orderDate: order.data.order_date,
    expectedDeliveryDate: order.data.expected_delivery_date,
    fulfillmentMode: order.data.fulfillment_mode,
    deliveryAddress: order.data.delivery_address || customer?.data.address || '',
    state: order.data.state,
    itemCount: round(items.reduce((sum: number, item: any) => sum + (Number(item.qty) || 0), 0)),
    subtotal: Number(order.data.subtotal || 0),
    charges: Number(order.data.charges || 0),
    discounts: Number(order.data.discounts || 0),
    taxRate: Number(order.data.tax_rate || 0),
    taxAmount: Number(order.data.tax_amount || 0),
    grandTotal: Number(order.data.grand_total || 0),
    paymentMode: order.data.payment_mode,
    paymentStatus: order.data.payment_status,
    source: order.data.source,
    pickupRider: pickupRider ? { id: pickupRider.id, name: pickupRider.data.name, phone: pickupRider.data.phone || '' } : undefined,
    deliveryRider: deliveryRider ? { id: deliveryRider.id, name: deliveryRider.data.name, phone: deliveryRider.data.phone || '' } : undefined,
    pickupSlot: order.data.pickup_slot || '',
    deliverySlot: order.data.delivery_slot || '',
    items: items.map(itemProgress),
    notes: order.data.notes || '',
    photoPaths: order.data.photo_paths || '',
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

export function listLaundryOrders(tenant: string, query: { search?: string; state?: string; from?: string; to?: string } = {}) {
  const needle = String(query.search || '').trim().toLowerCase();
  return store.rowsOf(tenant, 'laundry_order')
    .filter((order) => !query.state || order.data.state === query.state)
    .filter((order) => !query.from || order.data.order_date >= query.from)
    .filter((order) => !query.to || order.data.order_date <= query.to)
    .map((order) => presentOrder(tenant, order))
    .filter((order) => !needle || [order.orderNumber, order.invoiceNumber, order.customer.name, order.customer.phone].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getLaundryOrder(tenant: string, id: string) {
  const order = store.getRow(tenant, id);
  if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
  return {
    ...presentOrder(tenant, order),
    receipt: receiptFor(tenant, order),
    tags: tagsFor(tenant, order),
    timeline: store.auditOf(tenant).filter((entry) => entry.row_id === id).sort((a, b) => b.ts.localeCompare(a.ts)),
  };
}

export function laundryCatalogue(tenant: string) {
  const categories: Array<Record<string, any> & { id: string }> = activeRows(tenant, 'laundry_category').map((row) => ({ id: row.id, ...row.data }));
  const services: Array<Record<string, any> & { id: string }> = activeRows(tenant, 'laundry_service').map((row) => ({ id: row.id, ...row.data }));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const garments: Array<Record<string, any> & { id: string; categoryName: string }> = activeRows(tenant, 'laundry_garment').map((row) => ({ id: row.id, ...row.data, categoryName: String(categoryName.get(row.data.category) || '') }));
  const serviceName = new Map(services.map((service) => [service.id, service.name]));
  const garmentName = new Map(garments.map((garment) => [garment.id, garment.name]));
  const prices = activeRows(tenant, 'laundry_price').map((row) => ({
    id: row.id, ...row.data, garmentName: garmentName.get(row.data.garment) || '', serviceName: serviceName.get(row.data.service) || '',
  }));
  const chargeRules = activeRows(tenant, 'laundry_charge_rule').map((row) => ({ id: row.id, ...row.data }));
  const discountRules = activeRows(tenant, 'laundry_discount_rule').map((row) => ({ id: row.id, ...row.data }));
  const taxRules = activeRows(tenant, 'laundry_tax_rule').map((row) => ({ id: row.id, ...row.data }));
  return { categories, services, garments, prices, chargeRules, discountRules, taxRules, serviceUnits: [...SERVICE_UNITS] };
}

function cleanName(value: unknown, label: string) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new Error(`${label} must contain 2–120 characters`);
  return name;
}

function cleanActive(value: unknown, fallback = true) { return typeof value === 'boolean' ? value : fallback; }
function cleanColor(value: unknown) {
  const color = String(value || '').trim();
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('category color must be a six-digit hex value');
  return color;
}
function cleanImagePath(value: unknown) {
  const path = String(value || '').trim();
  if (!path) return '';
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(path)) {
    if (path.length > 1_500_000) throw new Error('garment image must be under 1 MB');
    return path;
  }
  if (path.length > MAX_MASTER_IMAGE_PATH || !/^\/ui\/app\/(?:garments|brand)\/[a-z0-9._-]+\.(?:png|webp|jpe?g|svg)$/i.test(path)) throw new Error('garment image must be an approved local application asset');
  return path;
}
function uniqueNamed(tenant: string, entity: string, name: string, exceptId?: string) {
  const duplicate = store.rowsOf(tenant, entity).find((row) => row.id !== exceptId && String(row.data.name || '').trim().toLowerCase() === name.toLowerCase());
  if (duplicate) throw new Error(`a ${entity.replace('laundry_', '').replace(/_/g, ' ')} with this name already exists`);
}
function updateMaster(tenant: string, actor: string, entity: string, id: string, data: Record<string, unknown>, action: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== entity) throw new Error(`${entity.replace('laundry_', '').replace(/_/g, ' ')} not found`);
  const before = { ...row.data };
  row.data = { ...row.data, ...data };
  row.updated_at = new Date().toISOString();
  store.updateRow(row);
  audit(tenant, actor, action, { entity, row_id: id, before, after: row.data });
  return row;
}

export function saveLaundryCategory(tenant: string, actor: string, input: CategoryInput, id?: string) {
  const name = cleanName(input.name, 'category name');
  const data = { name, color: cleanColor(input.color), image: cleanImagePath(input.image), sort_order: Math.max(0, Math.trunc(Number(input.sortOrder) || 0)), active: cleanActive(input.active) };
  return store.transaction(() => {
    uniqueNamed(tenant, 'laundry_category', name, id);
    const row = id ? updateMaster(tenant, actor, 'laundry_category', id, data, 'laundry:category-updated') : createRow(tenant, actor, 'laundry_category', data);
    if (!id) audit(tenant, actor, 'laundry:category-created', { entity: row.entity, row_id: row.id, after: row.data });
    return { id: row.id, ...row.data };
  });
}

export function saveLaundryService(tenant: string, actor: string, input: ServiceInput, id?: string) {
  const name = cleanName(input.name, 'service name');
  const units = Array.isArray(input.units) ? [...new Set(input.units.map(String))] : undefined;
  if (units && (!units.length || units.some((unit) => !SERVICE_UNITS.includes(unit as typeof SERVICE_UNITS[number])))) throw new Error('service units must use the supported unit list');
  const data = { name, description: String(input.description || '').trim().slice(0, 500), units: units || [...SERVICE_UNITS], active: cleanActive(input.active) };
  return store.transaction(() => {
    uniqueNamed(tenant, 'laundry_service', name, id);
    const row = id ? updateMaster(tenant, actor, 'laundry_service', id, data, 'laundry:service-updated') : createRow(tenant, actor, 'laundry_service', data);
    if (!id) audit(tenant, actor, 'laundry:service-created', { entity: row.entity, row_id: row.id, after: row.data });
    return { id: row.id, ...row.data };
  });
}

export function saveLaundryGarment(tenant: string, actor: string, input: GarmentInput, id?: string) {
  const name = cleanName(input.name, 'garment name');
  const category = getRequired(tenant, 'laundry_category', String(input.category || ''), 'category');
  const unit = String(input.unit || 'Piece');
  if (!SERVICE_UNITS.includes(unit as typeof SERVICE_UNITS[number])) throw new Error('garment unit must use the supported unit list');
  const code = String(input.code || name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 48);
  if (code.length < 2) throw new Error('garment code is required');
  const gstRate = round(Number(input.gstRate) || 0);
  if (gstRate < 0 || gstRate > 100) throw new Error('garment GST rate must be between 0 and 100');
  const data = { name, code, category: category.id, unit, hsn: String(input.hsn || '9997').trim().slice(0, 32), gst_rate: gstRate, photo: cleanImagePath(input.photo), active: cleanActive(input.active) };
  return store.transaction(() => {
    uniqueNamed(tenant, 'laundry_garment', name, id);
    const duplicateCode = store.rowsOf(tenant, 'laundry_garment').find((row) => row.id !== id && String(row.data.code || '').toUpperCase() === code);
    if (duplicateCode) throw new Error('a garment with this code already exists');
    const row = id ? updateMaster(tenant, actor, 'laundry_garment', id, data, 'laundry:garment-updated') : createRow(tenant, actor, 'laundry_garment', data);
    if (!id) audit(tenant, actor, 'laundry:garment-created', { entity: row.entity, row_id: row.id, after: row.data });
    return { id: row.id, ...row.data };
  });
}

export function saveLaundryPrice(tenant: string, actor: string, input: PriceInput, id?: string) {
  const garment = getRequired(tenant, 'laundry_garment', String(input.garment || ''), 'garment');
  const service = getRequired(tenant, 'laundry_service', String(input.service || ''), 'service');
  const customerId = String(input.customer || '').trim();
  if (customerId) {
    const customer = store.getRow(tenant, customerId);
    if (!customer || customer.entity !== 'party' || !customer.data.is_customer) throw new Error('special-pricing customer not found');
  }
  const rate = round(Number(input.rate));
  if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) throw new Error('price rate must be between 0 and 1,000,000');
  const units: string[] = Array.isArray(service.data.units) ? service.data.units.map(String) : [...SERVICE_UNITS];
  if (!units.includes(String(garment.data.unit || 'Piece'))) throw new Error('this service does not support the garment unit');
  const data = { garment: garment.id, service: service.id, customer: customerId || undefined, rate, active: cleanActive(input.active) };
  return store.transaction(() => {
    const duplicate = store.rowsOf(tenant, 'laundry_price').find((row) => row.id !== id && row.data.garment === garment.id && row.data.service === service.id && String(row.data.customer || '') === customerId);
    if (duplicate) throw new Error('a matching general or customer-specific price rule already exists');
    const row = id ? updateMaster(tenant, actor, 'laundry_price', id, data, 'laundry:price-rule-updated') : createRow(tenant, actor, 'laundry_price', data);
    if (!id) audit(tenant, actor, 'laundry:price-rule-created', { entity: row.entity, row_id: row.id, after: row.data });
    return { id: row.id, ...row.data };
  });
}

function saveAdjustmentRule(tenant: string, actor: string, entity: 'laundry_charge_rule' | 'laundry_discount_rule', input: AdjustmentRuleInput, id?: string) {
  const name = cleanName(input.name, 'rule name');
  const type = input.type === 'Percentage' ? 'Percentage' : input.type === 'Flat' ? 'Flat' : undefined;
  if (!type) throw new Error('rule type must be Flat or Percentage');
  const amount = round(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 0 || (type === 'Percentage' && amount > 100)) throw new Error('rule amount is invalid');
  const data = { name, type, amount, description: String(input.description || '').trim().slice(0, 500), active: cleanActive(input.active) };
  return store.transaction(() => {
    uniqueNamed(tenant, entity, name, id);
    const row = id ? updateMaster(tenant, actor, entity, id, data, `laundry:${entity}-updated`) : createRow(tenant, actor, entity, data);
    if (!id) audit(tenant, actor, `laundry:${entity}-created`, { entity, row_id: row.id, after: row.data });
    return { id: row.id, ...row.data };
  });
}
export const saveLaundryChargeRule = (tenant: string, actor: string, input: AdjustmentRuleInput, id?: string) => saveAdjustmentRule(tenant, actor, 'laundry_charge_rule', input, id);
export const saveLaundryDiscountRule = (tenant: string, actor: string, input: AdjustmentRuleInput, id?: string) => saveAdjustmentRule(tenant, actor, 'laundry_discount_rule', input, id);

export function saveLaundryTaxRule(tenant: string, actor: string, input: TaxRuleInput, id?: string) {
  const name = cleanName(input.name, 'tax rule name');
  const rate = round(Number(input.rate));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('tax rate must be between 0 and 100');
  const data = { name, rate, active: cleanActive(input.active) };
  return store.transaction(() => {
    uniqueNamed(tenant, 'laundry_tax_rule', name, id);
    const row = id ? updateMaster(tenant, actor, 'laundry_tax_rule', id, data, 'laundry:tax-rule-updated') : createRow(tenant, actor, 'laundry_tax_rule', data);
    if (!id) audit(tenant, actor, 'laundry:tax-rule-created', { entity: row.entity, row_id: row.id, after: row.data });
    return { id: row.id, ...row.data };
  });
}

export function searchLaundryCustomers(tenant: string, search = '') {
  return searchCustomerRecords(tenant, search);
}

export function listLaundryRiders(tenant: string) {
  return activeRows(tenant, 'laundry_rider').map((rider) => ({ id: rider.id, name: rider.data.name, phone: rider.data.phone || '' })).sort((a, b) => a.name.localeCompare(b.name));
}

export function createLaundryRider(tenant: string, actor: string, input: RiderInput) {
  const name = input.name?.trim();
  if (!name) throw new Error('rider name is required');
  const phone = normPhone(input.phone);
  const existing = store.rowsOf(tenant, 'laundry_rider').find((rider) => rider.data.name?.trim().toLowerCase() === name.toLowerCase() || (phone && normPhone(rider.data.phone) === phone));
  if (existing) throw new Error('a rider with this name or phone already exists');
  const rider = createRow(tenant, actor, 'laundry_rider', { name, phone, active: true });
  audit(tenant, actor, 'laundry:rider-created', { entity: 'laundry_rider', row_id: rider.id, after: { name, phone } });
  return { id: rider.id, name: rider.data.name, phone: rider.data.phone || '' };
}

export function listLaundryRiderSettlements(tenant: string, query: { rider?: string; from?: string; to?: string } = {}) {
  return store.rowsOf(tenant, 'laundry_rider_settlement').filter((row) => (!query.rider || row.data.rider === query.rider) && (!query.from || String(row.data.settlement_date) >= query.from) && (!query.to || String(row.data.settlement_date) <= query.to)).map((row) => ({
    id: row.id, rider: String(row.data.rider), date: String(row.data.settlement_date), amount: Number(row.data.amount || 0), method: String(row.data.method || 'Cash'), status: String(row.data.status || 'Pending'), orderIds: Array.isArray(row.data.order_ids) ? row.data.order_ids : [], reference: String(row.data.reference || ''), notes: String(row.data.notes || ''), createdAt: row.created_at, updatedAt: row.updated_at,
  })).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function saveLaundryRiderSettlement(tenant: string, actor: string, input: RiderSettlementInput, id?: string) {
  return store.transaction(() => {
    const existing = id ? store.getRow(tenant, id) : undefined;
    if (id && (!existing || existing.entity !== 'laundry_rider_settlement')) throw new Error('rider settlement not found');
    if (existing && ['Reconciled', 'Rejected'].includes(String(existing.data.status || 'Pending'))) {
      const mutableFields = ['rider', 'date', 'amount', 'method', 'orderIds', 'reference', 'notes'];
      const changing = mutableFields.some((field) => Object.prototype.hasOwnProperty.call(input, field));
      const requestedStatus = input.status ? String(input.status) : '';
      if (changing || (requestedStatus && requestedStatus !== String(existing.data.status))) throw new Error('reconciled or rejected settlements are immutable');
    }
    const riderId = String(input.rider || existing?.data.rider || '');
    const rider = store.getRow(tenant, riderId);
    if (!rider || rider.entity !== 'laundry_rider') throw new Error('active rider not found');
    const amount = Math.round((Number(input.amount ?? existing?.data.amount) || 0) * 100) / 100;
    if (amount <= 0) throw new Error('settlement amount must be greater than zero');
    const method = (input.method || String(existing?.data.method || 'Cash')) as 'Cash' | 'UPI' | 'Bank';
    if (!['Cash', 'UPI', 'Bank'].includes(method)) throw new Error('unsupported settlement method');
    const status = (input.status || String(existing?.data.status || 'Pending')) as 'Pending' | 'Handed Over' | 'Reconciled' | 'Rejected';
    if (!['Pending', 'Handed Over', 'Reconciled', 'Rejected'].includes(status)) throw new Error('unknown settlement status');
    if (existing && existing.data.status !== status) {
      const allowed: Record<string, string[]> = { Pending: ['Handed Over', 'Rejected'], 'Handed Over': ['Reconciled', 'Rejected'], Reconciled: [], Rejected: [] };
      if (!allowed[String(existing.data.status || 'Pending')]?.includes(status)) throw new Error('settlement status transition is not allowed');
    }
    const orderIds = [...new Set((Array.isArray(input.orderIds) ? input.orderIds : Array.isArray(existing?.data.order_ids) ? existing.data.order_ids : []).map(String).filter(Boolean))];
    for (const orderId of orderIds) {
      const order = store.getRow(tenant, orderId);
      if (!order || order.entity !== 'laundry_order' || (order.data.delivery_rider !== riderId && order.data.pickup_rider !== riderId)) throw new Error(`order ${orderId} is not assigned to this rider`);
    }
    const data = { rider: riderId, settlement_date: String(input.date || existing?.data.settlement_date || today()), amount, method, status, order_ids: orderIds, reference: String(input.reference ?? existing?.data.reference ?? '').trim().slice(0, 120), notes: String(input.notes ?? existing?.data.notes ?? '').trim().slice(0, 500) };
    const row = id ? updateMaster(tenant, actor, 'laundry_rider_settlement', id, data, 'laundry:rider-settlement-updated') : createRow(tenant, actor, 'laundry_rider_settlement', data);
    row.status = 'Posted';
    row.updated_at = new Date().toISOString();
    store.updateRow(row);
    audit(tenant, actor, id ? 'laundry:rider-settlement-updated' : 'laundry:rider-settlement-created', { entity: row.entity, row_id: row.id, after: row.data });
    return listLaundryRiderSettlements(tenant, { rider: riderId }).find((entry) => entry.id === row.id)!;
  });
}

export function assignLaundryOrder(tenant: string, actor: string, id: string, input: AssignmentInput) {
  return store.transaction(() => {
    const order = store.getRow(tenant, id);
    if (!order || order.entity !== 'laundry_order') throw new Error('laundry order not found');
    if (input.stage !== 'pickup' && input.stage !== 'delivery') throw new Error('assignment stage must be pickup or delivery');
    const rider = input.riderId ? store.getRow(tenant, input.riderId) : undefined;
    if (input.riderId && (!rider || rider.entity !== 'laundry_rider' || rider.data.active === false)) throw new Error('active rider not found');
    const riderField = input.stage === 'pickup' ? 'pickup_rider' : 'delivery_rider';
    const slotField = input.stage === 'pickup' ? 'pickup_slot' : 'delivery_slot';
    const before = { rider: order.data[riderField], slot: order.data[slotField] };
    order.data[riderField] = rider?.id;
    order.data[slotField] = input.slot?.trim() || undefined;
    order.updated_at = new Date().toISOString();
    store.updateRow(order);
    audit(tenant, actor, 'laundry:rider-assigned', { entity: 'laundry_order', row_id: id, before, after: { stage: input.stage, rider: rider?.id, slot: order.data[slotField] } });
    return presentOrder(tenant, order);
  });
}

export function laundryDispatch(tenant: string) {
  const orders = listLaundryOrders(tenant);
  return {
    riders: listLaundryRiders(tenant),
    pickups: orders.filter((order) => order.fulfillmentMode === 'Pickup Order' && order.state === 'Booked'),
    deliveries: orders.filter((order) => order.fulfillmentMode !== 'Pickup Order' && ['Ready', 'Out for Delivery'].includes(order.state)),
  };
}

function importResult(): ImportResult { return { created: 0, updated: 0, skipped: 0, errors: [] }; }

function recordImportJob(tenant: string, actor: string, kind: 'customers' | 'prices', totalRows: number, result: ImportResult) {
  const status = result.errors.length ? 'Completed with errors' : 'Completed';
  const row = createRow(tenant, actor, 'laundry_import_job', {
    import_type: kind, status, total_rows: totalRows, created_rows: result.created, updated_rows: result.updated, skipped_rows: result.skipped,
    errors: result.errors.slice(0, 500), completed_at: new Date().toISOString(), source: 'spreadsheet',
  });
  audit(tenant, actor, 'laundry:import-completed', { entity: row.entity, row_id: row.id, after: { importType: kind, status, totalRows, created: result.created, updated: result.updated, skipped: result.skipped } });
  return { id: row.id, status };
}

export function listLaundryImportJobs(tenant: string, importType?: string) {
  return store.rowsOf(tenant, 'laundry_import_job')
    .filter((row) => !importType || row.data.import_type === importType)
    .map((row) => ({ id: row.id, importType: row.data.import_type, status: row.data.status, totalRows: Number(row.data.total_rows || 0), createdRows: Number(row.data.created_rows || 0), updatedRows: Number(row.data.updated_rows || 0), skippedRows: Number(row.data.skipped_rows || 0), errors: Array.isArray(row.data.errors) ? row.data.errors : [], completedAt: row.data.completed_at || '', createdAt: row.created_at, actor: row.created_by }))
    .sort((a, b) => `${b.completedAt}:${b.createdAt}`.localeCompare(`${a.completedAt}:${a.createdAt}`));
}

export function importLaundryCustomers(tenant: string, actor: string, rows: ImportCustomerInput[]) {
  if (!Array.isArray(rows)) throw new Error('customer import must be a list of rows');
  if (rows.length === 0) throw new Error('customer import has no rows');
  if (rows.length > 2_000) throw new Error('customer import is limited to 2,000 rows at a time');
  const result = importResult();
  rows.forEach((input, index) => {
    try {
      const name = String(input.name || '').trim();
      const phone = normPhone(input.phone);
      if (!name) throw new Error('customer name is required');
      if (phone.length < 6) throw new Error('a valid phone is required');
      const existing = store.rowsOf(tenant, 'party').find((row) => normPhone(row.data.phone) === phone);
      if (existing) {
        existing.data = { ...existing.data, name, phone, email: String(input.email || '').trim() || existing.data.email, address: String(input.address || '').trim() || existing.data.address, is_customer: true };
        existing.updated_at = new Date().toISOString();
        store.updateRow(existing);
        result.updated += 1;
      } else {
        createRow(tenant, actor, 'party', { name, phone, email: String(input.email || '').trim(), address: String(input.address || '').trim(), is_customer: true });
        result.created += 1;
      }
    } catch (error: any) { result.skipped += 1; result.errors.push({ row: index + 2, message: error.message || 'Invalid row' }); }
  });
  result.job = recordImportJob(tenant, actor, 'customers', rows.length, result);
  audit(tenant, actor, 'laundry:customers-imported', { after: { ...result, errors: result.errors.slice(0, 20) } });
  return result;
}

function findNamedRow(tenant: string, entity: string, name: string) {
  const target = name.trim().toLowerCase();
  return store.rowsOf(tenant, entity).find((row) => String(row.data.name || '').trim().toLowerCase() === target);
}

export function importLaundryPrices(tenant: string, actor: string, rows: ImportPriceInput[]) {
  if (!Array.isArray(rows)) throw new Error('price import must be a list of rows');
  if (rows.length === 0) throw new Error('price import has no rows');
  if (rows.length > 2_000) throw new Error('price import is limited to 2,000 rows at a time');
  const allowedUnits = new Set(['Piece', 'Kilogram', 'Pair', 'Square Foot']);
  const result = importResult();
  rows.forEach((input, index) => {
    try {
      const garmentName = String(input.garmentName || '').trim();
      const categoryName = String(input.categoryName || 'Imported').trim() || 'Imported';
      const serviceName = String(input.serviceName || '').trim();
      if (input.rate === undefined || input.rate === null || String(input.rate).trim() === '') throw new Error('rate is required');
      const rate = round(Number(input.rate));
      if (!garmentName) throw new Error('garment name is required');
      if (!serviceName) throw new Error('service name is required');
      if (!Number.isFinite(rate) || rate < 0) throw new Error('rate must be zero or greater');
      const requestedUnit = String(input.unit || 'Piece').trim();
      const unit = allowedUnits.has(requestedUnit) ? requestedUnit : 'Piece';
      const category = findNamedRow(tenant, 'laundry_category', categoryName) || createRow(tenant, actor, 'laundry_category', { name: categoryName, active: true });
      const service = findNamedRow(tenant, 'laundry_service', serviceName) || createRow(tenant, actor, 'laundry_service', { name: serviceName, active: true });
      // A reference catalogue can legitimately reuse a display name across
      // categories (for example CAP or TOWEL). Keep those rows distinct by
      // category instead of silently attaching every price to the first match.
      let garment = store.rowsOf(tenant, 'laundry_garment').find((row) =>
        String(row.data.name || '').trim().toLowerCase() === garmentName.toLowerCase() && row.data.category === category.id,
      );
      if (!garment) {
        garment = createRow(tenant, actor, 'laundry_garment', {
          name: garmentName, code: garmentName.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), category: category.id, unit,
          hsn: String(input.hsn || '9997').trim() || '9997', gst_rate: Math.max(0, round(Number(input.gstRate) || 0)), active: true,
        });
      }
      const customerPhone = normPhone(input.customerPhone);
      const customer = customerPhone ? store.rowsOf(tenant, 'party').find((row) => normPhone(row.data.phone) === customerPhone && row.data.is_customer) : undefined;
      if (customerPhone && !customer) throw new Error('customer phone does not match an imported customer');
      const existingPrice = store.rowsOf(tenant, 'laundry_price').find((row) => row.data.garment === garment!.id && row.data.service === service.id && row.data.customer === customer?.id);
      if (existingPrice) {
        existingPrice.data = { ...existingPrice.data, rate, active: true };
        existingPrice.updated_at = new Date().toISOString();
        store.updateRow(existingPrice);
        result.updated += 1;
      } else {
        createRow(tenant, actor, 'laundry_price', { garment: garment.id, service: service.id, customer: customer?.id, rate, active: true });
        result.created += 1;
      }
    } catch (error: any) { result.skipped += 1; result.errors.push({ row: index + 2, message: error.message || 'Invalid row' }); }
  });
  result.job = recordImportJob(tenant, actor, 'prices', rows.length, result);
  audit(tenant, actor, 'laundry:prices-imported', { after: { ...result, errors: result.errors.slice(0, 20) } });
  return result;
}

export function laundryDashboard(tenant: string, asOf = today()) {
  const all = listLaundryOrders(tenant);
  const expenses = listLaundryExpenses(tenant);
  const todayOrders = all.filter((order) => order.orderDate === asOf);
  const active = all.filter((order) => !['Delivered', 'Cancelled'].includes(String(order.state)));
  const awaitingPickup = all.filter((order) => order.fulfillmentMode === 'Pickup Order' && order.state === 'Booked' && !order.pickupRider);
  const awaitingDelivery = all.filter((order) => order.fulfillmentMode !== 'Pickup Order' && ['Ready', 'Out for Delivery'].includes(order.state) && !order.deliveryRider);
  const stateCount = (state: LaundryState) => all.filter((order) => order.state === state).length;
  const trendFrom = shiftDate(asOf, -6);
  return {
    asOf,
    kpis: {
      collection: round(collectionsForOrders(tenant, todayOrders, asOf, asOf).reduce((sum, row) => sum + row.amount, 0)),
      orderRequests: 0,
      pendingOrders: active.length,
      booking: stateCount('Booked'),
      delivery: stateCount('Out for Delivery'),
      delivered: stateCount('Delivered'),
      todayRevenue: round(todayOrders.filter((order) => order.state !== 'Cancelled').reduce((sum, order) => sum + order.grandTotal, 0)),
      upcomingDeliveries: active.filter((order) => order.expectedDeliveryDate <= asOf).length,
    },
    attention: [
      { id: 'pickup', label: 'Pending / unassigned pickup', count: awaitingPickup.length, tone: 'amber' },
      { id: 'upcoming', label: 'Upcoming delivery', count: active.filter((order) => order.expectedDeliveryDate <= asOf).length, tone: 'blue' },
      { id: 'unassigned', label: 'Unassigned delivery', count: awaitingDelivery.length, tone: 'slate' },
      { id: 'express', label: 'Express delivery', count: active.filter((order) => order.fulfillmentMode === 'Express Delivery').length, tone: 'rose' },
      { id: 'requests', label: 'Order requests', count: 0, tone: 'slate' },
    ],
    trend: dailySeries(all, expenses, collectionsForOrders(tenant, all), trendFrom, asOf),
    fulfillmentBreakdown: fulfillmentSeries(all),
    topGarments: topItemSeries(all, 'garmentName'),
    topServices: topItemSeries(all, 'serviceName'),
    recent: all.slice(0, 8),
  };
}

function accountFor(tenant: string, actor: string, name: string, accountType: string) {
  const existing = store.rowsOf(tenant, 'account').find((row) => row.data.name === name);
  return existing || createRow(tenant, actor, 'account', { name, account_type: accountType });
}

function paymentAccountName(mode: string) {
  if (mode === 'Cash') return 'Cash (Assets)';
  if (mode === 'UPI') return 'Bank/UPI (Assets)';
  if (mode === 'Card') return 'Bank/Card (Assets)';
  return 'Bank (Assets)';
}

export function createLaundryExpense(tenant: string, actor: string, input: ExpenseInput) {
  const amount = round(Number(input.amount));
  if (!input.expenseName?.trim()) throw new Error('expense name is required');
  if (!input.expenseDate || Number.isNaN(Date.parse(input.expenseDate))) throw new Error('expense date is required');
  if (amount <= 0) throw new Error('expense amount must be greater than zero');
  const attachment = String(input.attachment || '').trim();
  if (attachment && (attachment.length > 1_500_000 || !/^data:(?:application\/pdf|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/i.test(attachment))) throw new Error('expense attachment must be a PDF, PNG, JPEG, or WebP under 1 MB');
  const paymentMode = input.paymentMode || 'Cash';
  return store.transaction(() => {
    const expenseAccount = accountFor(tenant, actor, 'Laundry Operating Expense (Expense)', 'Expense');
    const paidFrom = accountFor(tenant, actor, paymentAccountName(paymentMode), 'Asset');
    const journal = createRow(tenant, actor, 'journal_entry', {
      posting_date: input.expenseDate,
      remark: `Laundry expense: ${input.expenseName.trim()}`,
      entries: [
        { account: expenseAccount.id, debit: amount, credit: 0 },
        { account: paidFrom.id, debit: 0, credit: amount },
      ],
    });
    submitRow(tenant, actor, 'journal_entry', journal.id);
    const expense = createRow(tenant, actor, 'laundry_expense', {
      expense_name: input.expenseName.trim(), expense_date: input.expenseDate, amount,
      payment_receiver: input.paymentReceiver?.trim(), invoice_number: input.invoiceNumber?.trim(),
      is_tax_paid: Boolean(input.isTaxPaid), payment_mode: paymentMode, journal_entry: journal.id, notes: input.notes?.trim(), attachment,
    });
    expense.status = 'Paid';
    expense.updated_at = new Date().toISOString();
    store.updateRow(expense);
    audit(tenant, actor, 'laundry:expense-recorded', { entity: 'laundry_expense', row_id: expense.id, after: { amount, journal: journal.id } });
    return presentExpense(expense);
  });
}

export function presentExpense(expense: EntityRow) {
  return {
    id: expense.id, reference: expense.data.name || expense.id, expenseName: expense.data.expense_name,
    expenseDate: expense.data.expense_date, amount: Number(expense.data.amount || 0),
    paymentReceiver: expense.data.payment_receiver || '', invoiceNumber: expense.data.invoice_number || '',
    isTaxPaid: Boolean(expense.data.is_tax_paid), paymentMode: expense.data.payment_mode || 'Cash',
    journalEntry: expense.data.journal_entry, notes: expense.data.notes || '', attachment: expense.data.attachment || '', status: expense.status, actor: expense.created_by, createdAt: expense.created_at,
  };
}

export function cancelLaundryExpense(tenant: string, actor: string, id: string, reason: string) {
  return store.transaction(() => {
    const expense = store.getRow(tenant, id);
    if (!expense || expense.entity !== 'laundry_expense') throw new Error('expense not found');
    if (expense.status !== 'Paid') throw new Error('only paid expenses can be cancelled');
    const note = String(reason || '').trim().slice(0, 500);
    if (!note) throw new Error('expense cancellation reason is required');
    const journal = store.getRow(tenant, String(expense.data.journal_entry || ''));
    if (journal?.status === 'Submitted') cancelRow(tenant, actor, 'journal_entry', journal.id);
    expense.status = 'Cancelled'; expense.data.cancellation_reason = note; expense.updated_at = new Date().toISOString(); store.updateRow(expense);
    audit(tenant, actor, 'laundry:expense-cancelled', { entity: expense.entity, row_id: expense.id, after: { reason: note } });
    return presentExpense(expense);
  });
}

export function editLaundryExpense(tenant: string, actor: string, id: string, input: ExpenseInput, reason: string) {
  return store.transaction(() => {
    const expense = store.getRow(tenant, id);
    if (!expense || expense.entity !== 'laundry_expense') throw new Error('expense not found');
    if (expense.status !== 'Paid') throw new Error('only paid expenses can be edited');
    const note = String(reason || '').trim().slice(0, 500);
    if (!note) throw new Error('expense edit reason is required');
    const amount = round(Number(input.amount));
    const name = String(input.expenseName || '').trim();
    if (!name) throw new Error('expense name is required');
    if (!input.expenseDate || Number.isNaN(Date.parse(input.expenseDate))) throw new Error('expense date is required');
    if (amount <= 0) throw new Error('expense amount must be greater than zero');
    const attachment = String(input.attachment || '').trim();
    if (attachment && (attachment.length > 1_500_000 || !/^data:(?:application\/pdf|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/i.test(attachment))) throw new Error('expense attachment must be a PDF, PNG, JPEG, or WebP under 1 MB');
    const paymentMode = input.paymentMode || 'Cash';
    const oldJournal = store.getRow(tenant, String(expense.data.journal_entry || ''));
    if (oldJournal?.status === 'Submitted') cancelRow(tenant, actor, 'journal_entry', oldJournal.id);
    const expenseAccount = accountFor(tenant, actor, 'Laundry Operating Expense (Expense)', 'Expense');
    const paidFrom = accountFor(tenant, actor, paymentAccountName(paymentMode), 'Asset');
    const journal = createRow(tenant, actor, 'journal_entry', { posting_date: input.expenseDate, remark: `Laundry expense edit: ${name}`, entries: [{ account: expenseAccount.id, debit: amount, credit: 0 }, { account: paidFrom.id, debit: 0, credit: amount }] });
    submitRow(tenant, actor, 'journal_entry', journal.id);
    const before = presentExpense(expense);
    expense.data = { ...expense.data, expense_name: name, expense_date: input.expenseDate, amount, payment_receiver: input.paymentReceiver?.trim(), invoice_number: input.invoiceNumber?.trim(), is_tax_paid: Boolean(input.isTaxPaid), payment_mode: paymentMode, journal_entry: journal.id, previous_journal_entry: oldJournal?.id, notes: input.notes?.trim(), attachment, edit_reason: note };
    expense.updated_at = new Date().toISOString();
    store.updateRow(expense);
    audit(tenant, actor, 'laundry:expense-edited', { entity: expense.entity, row_id: id, before, after: { ...presentExpense(expense), reason: note } });
    return presentExpense(expense);
  });
}

export function listLaundryExpenses(tenant: string, query: { search?: string; from?: string; to?: string } = {}) {
  const needle = String(query.search || '').trim().toLowerCase();
  return store.rowsOf(tenant, 'laundry_expense')
    .filter((expense) => !query.from || expense.data.expense_date >= query.from)
    .filter((expense) => !query.to || expense.data.expense_date <= query.to)
    .map(presentExpense)
    .filter((expense) => !needle || `${expense.expenseName} ${expense.paymentReceiver} ${expense.invoiceNumber}`.toLowerCase().includes(needle))
    .sort((a, b) => `${b.expenseDate}:${b.createdAt}`.localeCompare(`${a.expenseDate}:${a.createdAt}`));
}

export function laundryReports(tenant: string, from?: string, to?: string) {
  const orders = listLaundryOrders(tenant, { from, to });
  const activeOrders = orders.filter((order) => order.state !== 'Cancelled');
  const expenses = listLaundryExpenses(tenant, { from, to }).filter((expense) => expense.status !== 'Cancelled');
  const reportTo = to || orders[0]?.orderDate || today();
  const reportFrom = from || shiftDate(reportTo, -6);
  const orderValue = round(activeOrders.reduce((sum, order) => sum + order.grandTotal, 0));
  const collections = collectionsForOrders(tenant, orders, from, to);
  const collected = round(collections.reduce((sum, row) => sum + row.amount, 0));
  const expenseTotal = round(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  return {
    range: { from: from || null, to: to || null },
    summary: { orderValue, collected, outstanding: round(orderValue - collected), expenses: expenseTotal, operatingCash: round(collected - expenseTotal), orders: orders.length, customers: new Set(orders.map((order) => order.customer.id || order.customer.phone)).size },
    stateBreakdown: LAUNDRY_STATES.map((state) => ({ state, count: orders.filter((order) => order.state === state).length, amount: round(orders.filter((order) => order.state === state).reduce((sum, order) => sum + order.grandTotal, 0)) })),
    paymentBreakdown: ['Pay Later', 'Cash', 'UPI', 'Card', 'Bank'].map((paymentMode) => ({ paymentMode, count: activeOrders.filter((order) => order.paymentMode === paymentMode).length, amount: round(activeOrders.filter((order) => order.paymentMode === paymentMode).reduce((sum, order) => sum + order.grandTotal, 0)) })),
    trend: dailySeries(orders, expenses, collections, reportFrom, reportTo),
    fulfillmentBreakdown: fulfillmentSeries(orders),
    topGarments: topItemSeries(orders, 'garmentName'),
    topServices: topItemSeries(orders, 'serviceName'),
  };
}

export type LaundryReportKind = 'invoice' | 'collection' | 'order' | 'consolidated-invoices' | 'customer' | 'customer-package' | 'customer-list' | 'growth' | 'discount' | 'expense' | 'balance' | 'pickup' | 'rider-delivery' | 'rider-collection' | 'warehouse-user-work';

export function laundryStatistics(tenant: string, period: 'today' | 'week' | 'lifetime' = 'today') {
  const to = today();
  const allOrderRows = store.rowsOf(tenant, 'laundry_order');
  const orderDates = allOrderRows.map((row) => String(row.data.order_date || '')).filter(Boolean).sort();
  const from = period === 'week' ? shiftDate(to, -6) : period === 'lifetime' ? (orderDates[0] || to) : to;
  const orders = allOrderRows.filter((row) => String(row.data.order_date || '') >= from && String(row.data.order_date || '') <= to && row.data.state !== 'Cancelled');
  // The overview intentionally keeps the four UniClean-style buckets while
  // aggregating Epic's more granular lifecycle states into those buckets.
  const orderStates = [
    { state: 'Booked', matches: ['Booked'] },
    { state: 'In Process', matches: ['Picked Up', 'In Process'] },
    { state: 'Delivered', matches: ['Delivered'] },
    { state: 'Done', matches: ['Ready', 'Out for Delivery'] },
  ].map(({ state, matches }) => ({ state, count: orders.filter((row) => matches.includes(String(row.data.state))).length }));
  const dates = dateList(from, to);
  const payments = store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Submitted' && row.data.payment_type === 'Receive' && dates.includes(String(row.data.posting_date || '')));
  const collectionDaily = dates.map((date) => ({ date, amount: round(payments.filter((row) => row.data.posting_date === date).reduce((sum, row) => sum + Number(row.data.amount || 0), 0)) }));
  const orderDaily = dates.map((date) => {
    const dayOrders = orders.filter((row) => String(row.data.order_date || '') === date);
    return { date, orders: dayOrders.length, amount: round(dayOrders.reduce((sum, row) => sum + Number(row.data.grand_total || 0), 0)) };
  });
  const customerIds = orders.map((row) => String(row.data.customer || '')).filter(Boolean);
  const frequency = [...new Set(customerIds)].map((customer) => ({ customer, visits: customerIds.filter((id) => id === customer).length })).sort((a, b) => b.visits - a.visits);
  const newCustomers = store.rowsOf(tenant, 'party').filter((row) => row.data.is_customer && dates.includes(row.created_at.slice(0, 10)));
  const newCustomerDaily = dates.map((date) => ({ date, count: newCustomers.filter((row) => row.created_at.slice(0, 10) === date).length }));
  const serviceMap = orders.flatMap((row) => (Array.isArray(row.data.items) ? row.data.items : []) as Array<Record<string, unknown>>).reduce((rows, item) => {
    const name = String(item.serviceName || 'Other');
    const current = rows.get(name) || { service: name, quantity: 0, amount: 0 };
    current.quantity += Number(item.qty || 0);
    current.amount = round(current.amount + Number(item.amount || 0));
    rows.set(name, current);
    return rows;
  }, new Map<string, { service: string; quantity: number; amount: number }>());
  const serviceMix = [...serviceMap.values()].sort((a, b) => b.amount - a.amount);
  const orderValue = round(orders.reduce((sum, row) => sum + Number(row.data.grand_total || 0), 0));
  const collectionTotal = round(payments.reduce((sum, row) => sum + Number(row.data.amount || 0), 0));
  const repeatCustomers = frequency.filter((row) => row.visits > 1).length;
  return { period, from, to, ordersReview: { total: orders.length, breakdown: orderStates, daily: orderDaily }, revenue: { total: orderValue, averageOrderValue: orders.length ? round(orderValue / orders.length) : 0 }, collection: { total: collectionTotal, daily: collectionDaily }, customerFrequency: { total: frequency.length, repeatCustomers, breakdown: frequency }, newCustomer: { total: newCustomers.length, daily: newCustomerDaily }, serviceMix };
}

export function laundryReportDetail(tenant: string, kind: LaundryReportKind, from?: string, to?: string, search?: string) {
  const reportKinds: LaundryReportKind[] = ['invoice', 'collection', 'order', 'consolidated-invoices', 'customer', 'customer-package', 'customer-list', 'growth', 'discount', 'expense', 'balance', 'pickup', 'rider-delivery', 'rider-collection', 'warehouse-user-work'];
  if (!reportKinds.includes(kind)) throw new Error('unknown laundry report');
  const needle = String(search || '').trim().toLowerCase();
  const inRange = (value: unknown) => (!from || String(value || '') >= from) && (!to || String(value || '') <= to);
  const orders = store.rowsOf(tenant, 'laundry_order').filter((row) => inRange(row.data.order_date)).map((row) => presentOrder(tenant, row)).filter((row) => !needle || `${row.orderNumber} ${row.invoiceNumber || ''} ${row.customer.name} ${row.customer.phone}`.toLowerCase().includes(needle));
  const rows = (() => {
    if (kind === 'invoice' || kind === 'consolidated-invoices') return orders.map((order) => ({ invoiceNumber: order.invoiceNumber || '', orderNumber: order.orderNumber, customer: order.customer.name, date: order.orderDate, amount: order.grandTotal, status: order.state, tax: Number((store.getRow(tenant, order.id)?.data.tax_amount) || 0) }));
    if (kind === 'order') { const grouped = new Map<string, { service: string; garments: number; amount: number }>(); for (const order of orders) for (const item of order.items) { const key = item.serviceName; const value = grouped.get(key) || { service: key, garments: 0, amount: 0 }; value.garments += item.qty; value.amount += item.amount; grouped.set(key, value); } return [...grouped.values()].map((row) => ({ ...row, amount: Math.round(row.amount * 100) / 100 })); }
    if (kind === 'discount') return orders.filter((order) => Number(store.getRow(tenant, order.id)?.data.discounts || 0) > 0).map((order) => { const raw = store.getRow(tenant, order.id)?.data || {}; return { orderNumber: order.orderNumber, date: order.orderDate, totalAmount: order.grandTotal, discount: Number(raw.discounts || 0), amountWithoutDiscount: Math.round((order.grandTotal + Number(raw.discounts || 0)) * 100) / 100 }; });
    if (kind === 'balance') return orders.filter((order) => order.state !== 'Cancelled' && order.paymentStatus !== 'Paid').map((order) => ({ orderNumber: order.orderNumber, invoiceNumber: order.invoiceNumber || '', customer: order.customer.name, date: order.orderDate, total: order.grandTotal, status: order.paymentStatus }));
    if (kind === 'pickup') return orders.filter((order) => order.fulfillmentMode === 'Pickup Order').map((order) => ({ orderNumber: order.orderNumber, customer: order.customer.name, phone: order.customer.phone, date: order.orderDate, due: order.expectedDeliveryDate, state: order.state, rider: order.pickupRider?.name || '' }));
    if (kind === 'rider-delivery') return orders.filter((order) => order.fulfillmentMode !== 'Pickup Order').map((order) => ({ orderNumber: order.orderNumber, customer: order.customer.name, date: order.orderDate, due: order.expectedDeliveryDate, state: order.state, rider: order.deliveryRider?.name || '' }));
    if (kind === 'collection') return store.rowsOf(tenant, 'payment_entry').filter((row) => row.status === 'Submitted' && row.data.payment_type === 'Receive' && inRange(row.data.posting_date)).map((row) => { const invoice = store.getRow(tenant, String(row.data.against_sales || '')); const order = orders.find((candidate) => candidate.invoiceNumber === invoice?.data.name || candidate.id === invoice?.data.laundry_order); return { invoiceNumber: invoice?.data.name || '', orderNumber: order?.orderNumber || '', amount: Number(row.data.amount || 0), method: row.data.mode || 'Cash', date: row.data.posting_date, reference: row.data.reference || '' }; });
    if (kind === 'rider-collection') return listLaundryRiderSettlements(tenant, { from, to }).map((row) => ({ date: row.date, rider: row.rider, amount: row.amount, method: row.method, status: row.status, reference: row.reference }));
    if (kind === 'expense') return listLaundryExpenses(tenant, { from, to }).map((row) => ({ date: row.expenseDate, expense: row.expenseName, receiver: row.paymentReceiver, invoiceNumber: row.invoiceNumber, amount: row.amount, status: row.status || 'Paid' }));
    if (kind === 'customer-list') return store.rowsOf(tenant, 'party').filter((row) => row.data.is_customer && inRange(row.created_at.slice(0, 10)) && (!needle || `${row.data.name} ${row.data.phone}`.toLowerCase().includes(needle))).map((row) => ({ customer: row.data.name, phone: row.data.phone, date: row.created_at.slice(0, 10) }));
    if (kind === 'customer') { const grouped = new Map<string, { customer: string; phone: string; revenue: number; visits: number; lastVisit: string }>(); for (const order of orders) { const value = grouped.get(order.customer.id || order.customer.phone) || { customer: order.customer.name, phone: order.customer.phone, revenue: 0, visits: 0, lastVisit: order.orderDate }; value.revenue += order.grandTotal; value.visits += 1; if (order.orderDate > value.lastVisit) value.lastVisit = order.orderDate; grouped.set(order.customer.id || order.customer.phone, value); } return [...grouped.values()].map((row) => ({ ...row, revenue: Math.round(row.revenue * 100) / 100, revenueWithoutTax: row.revenue, daysSinceVisit: Math.max(0, Math.floor((Date.now() - Date.parse(`${row.lastVisit}T00:00:00Z`)) / 86400000)) })); }
    if (kind === 'customer-package') return store.rowsOf(tenant, 'customer_package').filter((row) => inRange(row.created_at.slice(0, 10))).map((row) => ({ customer: store.getRow(tenant, String(row.data.customer))?.data.name || '', package: row.data.service_package, status: row.data.status, assigned: row.data.assigned_on || row.created_at.slice(0, 10), expires: row.data.expires_on || '' }));
    if (kind === 'warehouse-user-work') return store.rowsOf(tenant, 'laundry_fulfillment_event').filter((row) => inRange(row.data.event_date)).map((row) => ({ date: row.data.event_date, actor: row.created_by, order: row.data.order, stage: row.data.stage, quantity: row.data.quantity, unit: row.data.unit }));
    const summary = laundryReports(tenant, from, to).summary;
    const activeTax = orders
      .filter((order) => order.state !== 'Cancelled')
      .reduce((sum, order) => sum + Number(store.getRow(tenant, order.id)?.data.tax_amount || 0), 0);
    return [{ title: kind === 'growth' ? 'Growth' : 'Expense', total: summary.orderValue, tax: activeTax, amountWithoutTax: summary.orderValue - activeTax }];
  })();
  return { kind, from: from || null, to: to || null, columns: rows.length ? Object.keys(rows[0]) : [], rows, totalRows: rows.length };
}

type TrendPoint = { date: string; orders: number; orderValue: number; collected: number; expenses: number };
type RankedItem = { name: string; quantity: number; amount: number };
type CollectionPoint = { date: string; amount: number };

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateList(from: string, to: string) {
  const dates: string[] = [];
  let cursor = from;
  for (let i = 0; i < 366 && cursor <= to; i += 1) {
    dates.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  return dates;
}

function dailySeries(orders: ReturnType<typeof listLaundryOrders>, expenses: ReturnType<typeof listLaundryExpenses>, collections: CollectionPoint[], from: string, to: string): TrendPoint[] {
  const byDate = new Map<string, TrendPoint>(dateList(from, to).map((date) => [date, { date, orders: 0, orderValue: 0, collected: 0, expenses: 0 }]));
  orders.forEach((order) => {
    const point = byDate.get(order.orderDate);
    if (!point) return;
    point.orders += 1;
    if (order.state !== 'Cancelled') point.orderValue = round(point.orderValue + order.grandTotal);
  });
  collections.forEach((collection) => { const point = byDate.get(collection.date); if (point) point.collected = round(point.collected + collection.amount); });
  expenses.forEach((expense) => {
    const point = byDate.get(expense.expenseDate);
    if (point) point.expenses = round(point.expenses + expense.amount);
  });
  return [...byDate.values()];
}

function collectionsForOrders(tenant: string, orders: ReturnType<typeof listLaundryOrders>, from?: string, to?: string): CollectionPoint[] {
  const invoiceIds = new Set(orders.map((order) => String(store.getRow(tenant, order.id)?.data.invoice || '')).filter(Boolean));
  return store.rowsOf(tenant, 'payment_entry')
    .filter((row) => row.status === 'Submitted' && row.data.payment_type === 'Receive' && invoiceIds.has(String(row.data.against_sales || '')))
    .filter((row) => !from || String(row.data.posting_date || '') >= from)
    .filter((row) => !to || String(row.data.posting_date || '') <= to)
    .map((row) => ({ date: String(row.data.posting_date || ''), amount: round(Number(row.data.amount || 0)) }))
    .filter((row) => Boolean(row.date));
}

function fulfillmentSeries(orders: ReturnType<typeof listLaundryOrders>) {
  const byMode = new Map<string, { mode: string; count: number; amount: number }>();
  orders.forEach((order) => {
    const mode = order.fulfillmentMode || 'Pickup Order';
    const point = byMode.get(mode) || { mode, count: 0, amount: 0 };
    point.count += 1;
    if (order.state !== 'Cancelled') point.amount = round(point.amount + order.grandTotal);
    byMode.set(mode, point);
  });
  return [...byMode.values()].sort((a, b) => b.count - a.count || b.amount - a.amount);
}

function topItemSeries(orders: ReturnType<typeof listLaundryOrders>, key: 'garmentName' | 'serviceName'): RankedItem[] {
  const byName = new Map<string, RankedItem>();
  orders.filter((order) => order.state !== 'Cancelled').forEach((order) => order.items.forEach((item) => {
    const name = String(item[key] || 'Unlabelled');
    const point = byName.get(name) || { name, quantity: 0, amount: 0 };
    point.quantity += Number(item.qty) || 0;
    point.amount = round(point.amount + (Number(item.amount) || 0));
    byName.set(name, point);
  }));
  return [...byName.values()].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity).slice(0, 6);
}

export function receiptFor(tenant: string, order: EntityRow) {
  const display = presentOrder(tenant, order);
  return {
    orderNumber: display.orderNumber,
    invoiceNumber: display.invoiceNumber,
    customer: display.customer,
    orderDate: display.orderDate,
    expectedDeliveryDate: display.expectedDeliveryDate,
    fulfillmentMode: display.fulfillmentMode,
    items: display.items,
    subtotal: Number(order.data.subtotal || 0),
    charges: Number(order.data.charges || 0),
    discounts: Number(order.data.discounts || 0),
    taxAmount: Number(order.data.tax_amount || 0),
    grandTotal: Number(order.data.grand_total || 0),
    paymentMode: order.data.payment_mode,
    paymentStatus: order.data.payment_status,
  };
}

export function tagsFor(tenant: string, order: EntityRow) {
  const display = presentOrder(tenant, order);
  return display.items.flatMap((item: any, index: number) => {
    const total = Math.max(1, Math.ceil(Number(item.qty) || 1));
    return Array.from({ length: total }, (_, copy) => ({
      tagNumber: `${display.orderNumber}-${String(index + 1).padStart(2, '0')}-${String(copy + 1).padStart(2, '0')}`,
      orderNumber: display.orderNumber,
      customer: display.customer.name,
      garment: item.garmentName,
      service: item.serviceName,
      sequence: copy + 1,
      total,
      orderDate: display.orderDate,
      expectedDeliveryDate: display.expectedDeliveryDate,
    }));
  });
}

export function seedLaundryDefaults(tenant: string) {
  const actor = 'system';
  const categories = new Map<string, EntityRow>();
  for (const [name, color] of [['Men\'s Wear', '#345995'], ['Women\'s Wear', '#9B4D96'], ['Household', '#5D8A66'], ['Accessories', '#9A6B2F'], ['Laundry', '#5B6C5D'], ['Formalwear', '#4C5A8A'], ['Casualwear', '#B66B3C'], ['Ethnicwear', '#9B5A78']]) {
    categories.set(name, store.rowsOf(tenant, 'laundry_category').find((row) => String(row.data.name || '').trim().toLowerCase() === name.toLowerCase()) || createRow(tenant, actor, 'laundry_category', { name, color, active: true }));
  }
  const services = new Map<string, EntityRow>();
  for (const name of ['Dry Cleaning', 'Wash & Fold', 'Wash & Steam Iron', 'Steam Iron']) {
    services.set(name, store.rowsOf(tenant, 'laundry_service').find((row) => String(row.data.name || '').trim().toLowerCase() === name.toLowerCase()) || createRow(tenant, actor, 'laundry_service', { name, active: true }));
  }
  const defaults: Array<[string, string, string, Array<[string, number]>]> = [
    ['Shirt / T-shirt', 'Men\'s Wear', 'Piece', [['Dry Cleaning', 99], ['Steam Iron', 16]]],
    ['Trouser / Pant', 'Men\'s Wear', 'Piece', [['Dry Cleaning', 99], ['Steam Iron', 16]]],
    ['Saree', 'Women\'s Wear', 'Piece', [['Dry Cleaning', 180], ['Steam Iron', 89]]],
    ['Kurti', 'Women\'s Wear', 'Piece', [['Dry Cleaning', 129], ['Steam Iron', 16]]],
    ['Blanket', 'Household', 'Piece', [['Dry Cleaning', 320], ['Steam Iron', 49]]],
    ['Bed sheet', 'Household', 'Piece', [['Dry Cleaning', 165], ['Steam Iron', 39]]],
    ['Mixed clothes', 'Laundry', 'Kilogram', [['Wash & Fold', 80], ['Wash & Steam Iron', 120]]],
    ['Shoe pair', 'Accessories', 'Pair', [['Dry Cleaning', 329]]],
    ['Blazer / Suit', 'Formalwear', 'Piece', [['Dry Cleaning', 349], ['Steam Iron', 79]]],
    ['Dress / Gown', 'Women\'s Wear', 'Piece', [['Dry Cleaning', 299], ['Steam Iron', 69]]],
    ['Jeans / Denim', 'Casualwear', 'Piece', [['Dry Cleaning', 149], ['Wash & Fold', 89]]],
    ['Hoodie / Sweatshirt', 'Casualwear', 'Piece', [['Dry Cleaning', 179], ['Wash & Fold', 99]]],
    ['Kurta', 'Ethnicwear', 'Piece', [['Dry Cleaning', 159], ['Steam Iron', 39]]],
  ];
  const garmentVisualByName: Record<string, string> = {
    'Shirt / T-shirt': '/ui/app/garments/lndry-folded-shirt-v3.png',
    'Trouser / Pant': '/ui/app/garments/lndry-folded-trouser-v1.png',
    Saree: '/ui/app/garments/lndry-folded-saree-v1.png',
    Kurti: '/ui/app/garments/lndry-folded-kurti-v1.png',
    Blanket: '/ui/app/garments/lndry-folded-blanket-v1.png',
    'Bed sheet': '/ui/app/garments/lndry-folded-bedsheet-v1.png',
    'Mixed clothes': '/ui/app/garments/lndry-mixed-clothes-v1.png',
    'Shoe pair': '/ui/app/garments/lndry-shoe-pair-v1.png',
    'Blazer / Suit': '/ui/app/garments/lndry-folded-blazer-v1.png',
    'Dress / Gown': '/ui/app/garments/lndry-folded-dress-v1.png',
    'Jeans / Denim': '/ui/app/garments/lndry-folded-jeans-v1.png',
    'Hoodie / Sweatshirt': '/ui/app/garments/lndry-folded-hoodie-v1.png',
    Kurta: '/ui/app/garments/lndry-folded-kurta-v1.png',
  };
  for (const [name, category, unit, prices] of defaults) {
    const garment = store.rowsOf(tenant, 'laundry_garment').find((row) => String(row.data.name || '').trim().toLowerCase() === name.toLowerCase()) || createRow(tenant, actor, 'laundry_garment', {
      name, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), category: categories.get(category)!.id,
      unit, hsn: '9997', gst_rate: 0, photo: garmentVisualByName[name] || '', active: true,
    });
    for (const [service, rate] of prices) {
      const serviceId = services.get(service)!.id;
      const exists = store.rowsOf(tenant, 'laundry_price').some((row) => row.data.garment === garment.id && row.data.service === serviceId && !row.data.customer);
      if (!exists) createRow(tenant, actor, 'laundry_price', { garment: garment.id, service: serviceId, rate, active: true });
    }
  }
  audit(tenant, actor, 'laundry:catalogue-seeded', { after: { garments: defaults.length } });
}
