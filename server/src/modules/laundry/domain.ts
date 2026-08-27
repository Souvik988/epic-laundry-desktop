import { audit } from '../../kernel/audit.js';
import { createRow, submitRow } from '../../kernel/entity-service.js';
import { publish } from '../../kernel/event-bus.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';

export const LAUNDRY_STATES = ['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'] as const;
export type LaundryState = typeof LAUNDRY_STATES[number];

type BookInput = {
  customer: { id?: string; name?: string; phone?: string; email?: string; address?: string };
  items: Array<{ garment: string; service: string; qty: number }>;
  expectedDeliveryDate: string;
  fulfillmentMode: 'Pickup Order' | 'Home Delivery' | 'Express Delivery';
  paymentMode?: 'Pay Later' | 'Cash' | 'UPI' | 'Card';
  charges?: number;
  discounts?: number;
  taxRate?: number;
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
type ImportResult = { created: number; updated: number; skipped: number; errors: ImportIssue[] };
type RiderInput = { name: string; phone?: string };
type AssignmentInput = { stage: 'pickup' | 'delivery'; riderId?: string; slot?: string };

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
const today = () => new Date().toISOString().slice(0, 10);
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
  return rate;
}

export function quoteLaundryOrder(tenant: string, input: Pick<BookInput, 'items' | 'charges' | 'discounts' | 'taxRate'>, customer = ''): Quote {
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
    const rate = priceFor(tenant, garment.id, service.id, customer);
    return {
      garment: garment.id,
      garmentName: String(garment.data.name),
      service: service.id,
      serviceName: String(service.data.name),
      unit: String(garment.data.unit || 'Piece'),
      qty: round(qty),
      rate,
      amount: round(qty * rate),
      hsn: String(garment.data.hsn || '9997'),
    };
  });
  const subtotal = round(items.reduce((sum, item) => sum + item.amount, 0));
  const charges = Math.max(0, round(Number(input.charges) || 0));
  const discounts = Math.min(round(Number(input.discounts) || 0), subtotal + charges);
  const taxable = round(subtotal + charges - discounts);
  const taxRate = Math.max(0, Math.min(100, round(Number(input.taxRate) || 0)));
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
  if (!input.expectedDeliveryDate || Number.isNaN(Date.parse(input.expectedDeliveryDate))) throw new Error('expected delivery date is required');
  const customer = resolveCustomer(tenant, actor, input.customer || {});
  const quote = quoteLaundryOrder(tenant, input, customer.id);
  const paymentMode = input.paymentMode || 'Pay Later';
  const placeOfSupply = input.placeOfSupply || process.env.EPIC_SUPPLIER_STATE || '29';
  const invoice = createRow(tenant, actor, 'sales_invoice', {
    customer: customer.id,
    posting_date: today(),
    place_of_supply: placeOfSupply,
    currency: 'INR',
    // Laundry operators decide when to send a customer message. Booking must never send one implicitly.
    suppress_notifications: true,
    items: invoiceItems(quote),
  });
  const submittedInvoice = submitRow(tenant, actor, 'sales_invoice', invoice.id);
  let paymentEntry: EntityRow | undefined;
  if (paymentMode !== 'Pay Later') {
    paymentEntry = createRow(tenant, actor, 'payment_entry', {
      payment_type: 'Receive', party: customer.id, posting_date: today(), mode: paymentMode,
      amount: quote.grandTotal, against_sales: submittedInvoice.id,
      remarks: `Laundry order payment for ${submittedInvoice.data.name}`,
    });
    submitRow(tenant, actor, 'payment_entry', paymentEntry.id);
  }
  const order = createRow(tenant, actor, 'laundry_order', {
    customer: customer.id,
    order_date: today(),
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
    photo_paths: input.photoPaths?.trim(),
  });
  order.status = 'Booked';
  order.updated_at = new Date().toISOString();
  store.updateRow(order);
  audit(tenant, actor, 'laundry:booked', { entity: 'laundry_order', row_id: order.id, after: { state: 'Booked', invoice: submittedInvoice.id } });
  publish(tenant, 'laundry.order.booked.v1', { id: order.id, invoice: submittedInvoice.id, customer: customer.id, grand_total: quote.grandTotal });
  return { order: presentOrder(tenant, order), receipt: receiptFor(tenant, order), tags: tagsFor(tenant, order) };
}

export function transitionLaundryOrder(tenant: string, actor: string, id: string, state: LaundryState, note?: string) {
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
  publish(tenant, 'laundry.order.transitioned.v1', { id: order.id, from, state });
  return presentOrder(tenant, order);
}

export function presentOrder(tenant: string, order: EntityRow) {
  const customer = store.getRow(tenant, order.data.customer);
  const pickupRider = store.getRow(tenant, order.data.pickup_rider);
  const deliveryRider = store.getRow(tenant, order.data.delivery_rider);
  const items = Array.isArray(order.data.items) ? order.data.items : [];
  return {
    id: order.id,
    orderNumber: order.data.name || order.id,
    invoiceNumber: store.getRow(tenant, order.data.invoice)?.data.name || order.data.invoice,
    customer: { id: customer?.id, name: customer?.data.name || 'Unknown customer', phone: customer?.data.phone || '' },
    orderDate: order.data.order_date,
    expectedDeliveryDate: order.data.expected_delivery_date,
    fulfillmentMode: order.data.fulfillment_mode,
    state: order.data.state,
    itemCount: round(items.reduce((sum: number, item: any) => sum + (Number(item.qty) || 0), 0)),
    grandTotal: Number(order.data.grand_total || 0),
    paymentMode: order.data.payment_mode,
    paymentStatus: order.data.payment_status,
    source: order.data.source,
    pickupRider: pickupRider ? { id: pickupRider.id, name: pickupRider.data.name, phone: pickupRider.data.phone || '' } : undefined,
    deliveryRider: deliveryRider ? { id: deliveryRider.id, name: deliveryRider.data.name, phone: deliveryRider.data.phone || '' } : undefined,
    pickupSlot: order.data.pickup_slot || '',
    deliverySlot: order.data.delivery_slot || '',
    items,
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
  return { categories, services, garments, prices };
}

export function searchLaundryCustomers(tenant: string, search = '') {
  const needle = search.trim().toLowerCase();
  return store.rowsOf(tenant, 'party')
    .filter((row) => row.data.is_customer)
    .filter((row) => !needle || `${row.data.name || ''} ${row.data.phone || ''}`.toLowerCase().includes(needle))
    .slice(0, 12)
    .map((row) => ({ id: row.id, name: row.data.name, phone: row.data.phone || '', email: row.data.email || '', address: row.data.address || '' }));
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

export function assignLaundryOrder(tenant: string, actor: string, id: string, input: AssignmentInput) {
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
      let garment = findNamedRow(tenant, 'laundry_garment', garmentName);
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
  audit(tenant, actor, 'laundry:prices-imported', { after: { ...result, errors: result.errors.slice(0, 20) } });
  return result;
}

export function laundryDashboard(tenant: string, asOf = today()) {
  const all = listLaundryOrders(tenant);
  const todayOrders = all.filter((order) => order.orderDate === asOf);
  const active = all.filter((order) => !['Delivered', 'Cancelled'].includes(String(order.state)));
  const awaitingPickup = all.filter((order) => order.fulfillmentMode === 'Pickup Order' && order.state === 'Booked' && !order.pickupRider);
  const awaitingDelivery = all.filter((order) => order.fulfillmentMode !== 'Pickup Order' && ['Ready', 'Out for Delivery'].includes(order.state) && !order.deliveryRider);
  const stateCount = (state: LaundryState) => all.filter((order) => order.state === state).length;
  return {
    asOf,
    kpis: {
      collection: round(todayOrders.filter((order) => order.paymentStatus === 'Paid').reduce((sum, order) => sum + order.grandTotal, 0)),
      orderRequests: 0,
      pendingOrders: active.length,
      booking: stateCount('Booked'),
      delivery: stateCount('Out for Delivery'),
      delivered: stateCount('Delivered'),
      todayRevenue: round(todayOrders.reduce((sum, order) => sum + order.grandTotal, 0)),
      upcomingDeliveries: active.filter((order) => order.expectedDeliveryDate <= asOf).length,
    },
    attention: [
      { id: 'pickup', label: 'Pending / unassigned pickup', count: awaitingPickup.length, tone: 'amber' },
      { id: 'upcoming', label: 'Upcoming delivery', count: active.filter((order) => order.expectedDeliveryDate <= asOf).length, tone: 'blue' },
      { id: 'unassigned', label: 'Unassigned delivery', count: awaitingDelivery.length, tone: 'slate' },
      { id: 'express', label: 'Express delivery', count: active.filter((order) => order.fulfillmentMode === 'Express Delivery').length, tone: 'rose' },
      { id: 'requests', label: 'Order requests', count: 0, tone: 'slate' },
    ],
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
  const paymentMode = input.paymentMode || 'Cash';
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
    is_tax_paid: Boolean(input.isTaxPaid), payment_mode: paymentMode, journal_entry: journal.id, notes: input.notes?.trim(),
  });
  expense.status = 'Paid';
  expense.updated_at = new Date().toISOString();
  store.updateRow(expense);
  audit(tenant, actor, 'laundry:expense-recorded', { entity: 'laundry_expense', row_id: expense.id, after: { amount, journal: journal.id } });
  return presentExpense(expense);
}

export function presentExpense(expense: EntityRow) {
  return {
    id: expense.id, reference: expense.data.name || expense.id, expenseName: expense.data.expense_name,
    expenseDate: expense.data.expense_date, amount: Number(expense.data.amount || 0),
    paymentReceiver: expense.data.payment_receiver || '', invoiceNumber: expense.data.invoice_number || '',
    isTaxPaid: Boolean(expense.data.is_tax_paid), paymentMode: expense.data.payment_mode || 'Cash',
    journalEntry: expense.data.journal_entry, notes: expense.data.notes || '', createdAt: expense.created_at,
  };
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
  const expenses = listLaundryExpenses(tenant, { from, to });
  const orderValue = round(orders.filter((order) => order.state !== 'Cancelled').reduce((sum, order) => sum + order.grandTotal, 0));
  const collected = round(orders.filter((order) => order.paymentStatus === 'Paid').reduce((sum, order) => sum + order.grandTotal, 0));
  const expenseTotal = round(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  return {
    range: { from: from || null, to: to || null },
    summary: { orderValue, collected, outstanding: round(orderValue - collected), expenses: expenseTotal, operatingCash: round(collected - expenseTotal), orders: orders.length, customers: new Set(orders.map((order) => order.customer.id || order.customer.phone)).size },
    stateBreakdown: LAUNDRY_STATES.map((state) => ({ state, count: orders.filter((order) => order.state === state).length, amount: round(orders.filter((order) => order.state === state).reduce((sum, order) => sum + order.grandTotal, 0)) })),
    paymentBreakdown: ['Pay Later', 'Cash', 'UPI', 'Card'].map((paymentMode) => ({ paymentMode, count: orders.filter((order) => order.paymentMode === paymentMode).length, amount: round(orders.filter((order) => order.paymentMode === paymentMode).reduce((sum, order) => sum + order.grandTotal, 0)) })),
  };
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
  return display.items.flatMap((item: any, index: number) => Array.from({ length: Math.max(1, Math.ceil(Number(item.qty) || 1)) }, (_, copy) => ({
    tagNumber: `${display.orderNumber}-${String(index + 1).padStart(2, '0')}-${String(copy + 1).padStart(2, '0')}`,
    orderNumber: display.orderNumber,
    customer: display.customer.name,
    garment: item.garmentName,
    service: item.serviceName,
    expectedDeliveryDate: display.expectedDeliveryDate,
  })));
}

export function seedLaundryDefaults(tenant: string) {
  if (store.rowsOf(tenant, 'laundry_garment').length > 0) return;
  const actor = 'system';
  const categories = new Map<string, EntityRow>();
  for (const [name, color] of [['Men\'s Wear', '#345995'], ['Women\'s Wear', '#9B4D96'], ['Household', '#5D8A66'], ['Accessories', '#9A6B2F'], ['Laundry', '#5B6C5D']]) {
    categories.set(name, createRow(tenant, actor, 'laundry_category', { name, color, active: true }));
  }
  const services = new Map<string, EntityRow>();
  for (const name of ['Dry Cleaning', 'Wash & Fold', 'Wash & Steam Iron', 'Steam Iron']) {
    services.set(name, createRow(tenant, actor, 'laundry_service', { name, active: true }));
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
  ];
  for (const [name, category, unit, prices] of defaults) {
    const garment = createRow(tenant, actor, 'laundry_garment', {
      name, code: name.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), category: categories.get(category)!.id,
      unit, hsn: '9997', gst_rate: 0, active: true,
    });
    for (const [service, rate] of prices) {
      createRow(tenant, actor, 'laundry_price', { garment: garment.id, service: services.get(service)!.id, rate, active: true });
    }
  }
  audit(tenant, actor, 'laundry:catalogue-seeded', { after: { garments: defaults.length } });
}
