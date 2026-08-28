import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi } from './api.js';
import { registerSeedAutomations } from './automations/seed.js';
import { createRow, listRows, submitRow } from './kernel/entity-service.js';
import { assignLaundryOrder, bookLaundryOrder, createLaundryRider, laundryCatalogue, seedLaundryDefaults, transitionLaundryOrder } from './modules/laundry/domain.js';
import { laundryBusinessDate } from './modules/laundry/dates.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const PORT = Number(process.env.PORT || 3001);

const app = Fastify({ logger: true });
const configuredCorsOrigins = String(process.env.EPIC_CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
await app.register(cors, { origin: configuredCorsOrigins.length ? configuredCorsOrigins : false });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/ui/',
});

registerApi(app);
registerSeedAutomations(TENANT);
seedDemo();
seedLaundryDefaults(TENANT);
seedLaundryDemo();

function seedDemo() {
  if (listRows(TENANT, 'party').length) return;
  createRow(TENANT, 'system', 'party', {
    name: 'Sharma Traders', gstin: '29ABCDE1234F1Z5', phone: '919876543210',
    is_customer: true, email: 'sharma@example.com',
  });
  const item = createRow(TENANT, 'system', 'item', {
    name: 'Cement 50kg', item_code: 'CEM-50', uom: 'BORI', rate: 350, hsn: '252329', gst_rate: 18, reorder_level: 20,
  });
  createRow(TENANT, 'system', 'item', {
    name: 'Paint 20L', item_code: 'PNT-20', uom: 'LTR', rate: 1200, hsn: '320910', gst_rate: 18, reorder_level: 10,
  });
  const wh = createRow(TENANT, 'system', 'warehouse', {
    name: 'Bengaluru DC', code: 'BLR-DC', address: 'Peenya, Bengaluru', state: '29',
  });
  // opening stock: receipt
  const ste = createRow(TENANT, 'system', 'stock_entry', {
    stock_type: 'Material Receipt', posting_date: '2026-07-01',
    to_warehouse: wh.id, items: [{ item: item.id, qty: 100, rate: 300 }],
  });
  submitRow(TENANT, 'system', 'stock_entry', ste.id);
  console.log('[seed] demo party, items, warehouse + opening stock created');

  if (listRows(TENANT, 'account').length === 0) {
    const coa: [string, string][] = [
      ['Debtors (Assets)', 'Asset'], ['Cash (Assets)', 'Asset'], ['Bank (Assets)', 'Asset'], ['Bank/UPI (Assets)', 'Asset'],
      ['Bank/Card (Assets)', 'Asset'], ['CGST (Asset)', 'Asset'], ['SGST (Asset)', 'Asset'], ['IGST (Asset)', 'Asset'],
      ['Creditors (Liabilities)', 'Liability'], ['CGST (Liability)', 'Liability'], ['SGST (Liability)', 'Liability'], ['IGST (Liability)', 'Liability'],
      ['PF Payable (Liability)', 'Liability'], ['ESI Payable (Liability)', 'Liability'], ['TDS Payable (Liability)', 'Liability'], ['PT Payable (Liability)', 'Liability'],
      ['Capital (Equity)', 'Equity'], ['Opening Balance (Equity)', 'Equity'], ['Sales (Revenue)', 'Income'], ['Purchase (Expense)', 'Expense'], ['Salary (Expense)', 'Expense'],
    ];
    for (const [name, account_type] of coa) createRow(TENANT, 'system', 'account', { name, account_type });
    console.log('[seed] chart of accounts created');
  }
  if (listRows(TENANT, 'cost_center').length === 0) {
    createRow(TENANT, 'system', 'cost_center', { name: 'Head Office', is_group: true });
    console.log('[seed] default cost center created');
  }
}

function seedLaundryDemo() {
  if (listRows(TENANT, 'laundry_order').length) return;
  const catalogue = laundryCatalogue(TENANT);
  const garments = new Map(catalogue.garments.map((garment) => [garment.name, garment]));
  const services = new Map(catalogue.services.map((service) => [service.name, service]));
  const rider = createLaundryRider(TENANT, 'demo-seed', { name: 'Amit Das', phone: '9000000109' });
  const today = laundryBusinessDate();
  const day = (offset: number) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const samples = [
    ['Demo Priya', '9000000101', 'Shirt / T-shirt', 'Steam Iron', 'Home Delivery', 'Cash', 'Booked'],
    ['Demo Rahul', '9000000102', 'Trouser / Pant', 'Dry Cleaning', 'Pickup Order', 'Pay Later', 'Booked'],
    ['Demo Ananya', '9000000103', 'Saree', 'Dry Cleaning', 'Pickup Order', 'UPI', 'Picked Up'],
    ['Demo Kabir', '9000000104', 'Kurti', 'Steam Iron', 'Home Delivery', 'Card', 'In Process'],
    ['Demo Meera', '9000000105', 'Blanket', 'Dry Cleaning', 'Home Delivery', 'Pay Later', 'In Process'],
    ['Demo Suman', '9000000106', 'Bed sheet', 'Dry Cleaning', 'Home Delivery', 'Cash', 'Ready'],
    ['Demo Arjun', '9000000107', 'Mixed clothes', 'Wash & Fold', 'Home Delivery', 'UPI', 'Out for Delivery'],
    ['Demo Nisha', '9000000108', 'Shoe pair', 'Dry Cleaning', 'Home Delivery', 'Card', 'Delivered'],
  ] as const;
  for (const [index, [name, phone, garmentName, serviceName, fulfillmentMode, paymentMode, targetState]] of samples.entries()) {
    const garment = garments.get(garmentName);
    const service = services.get(serviceName);
    if (!garment || !service) continue;
    const result = bookLaundryOrder(TENANT, 'demo-seed', {
      orderDate: day(index - 7),
      customer: { name, phone },
      items: [{ garment: garment.id, service: service.id, qty: index % 3 + 1 }],
      expectedDeliveryDate: day(index + 1),
      fulfillmentMode,
      paymentMode,
    });
    if (targetState === 'Picked Up') {
      assignLaundryOrder(TENANT, 'demo-seed', result.order.id, { stage: 'pickup', riderId: rider.id });
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo intake complete');
    } else if (targetState === 'In Process') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
    } else if (targetState === 'Ready') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
    } else if (targetState === 'Out for Delivery') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
      assignLaundryOrder(TENANT, 'demo-seed', result.order.id, { stage: 'delivery', riderId: rider.id });
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Out for Delivery', 'Demo rider dispatched');
    } else if (targetState === 'Delivered') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Delivered', 'Demo customer handoff complete');
    }
  }
  console.log('[seed] laundry demo orders, customers and rider created');
}

try {
  await app.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' });
  console.log(`\n  Epic BOS Phase-0 kernel on http://localhost:${PORT}`);
  console.log(`  Demo UI:         http://localhost:${PORT}/ui/`);
  console.log(`  API health:      http://localhost:${PORT}/api/health`);
  console.log('  Session auth:    enabled\n');
} catch (e) {
  console.error(e);
  process.exit(1);
}
