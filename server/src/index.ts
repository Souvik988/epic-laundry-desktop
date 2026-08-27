import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi } from './api.js';
import { registerSeedAutomations } from './automations/seed.js';
import { createRow, listRows, submitRow } from './kernel/entity-service.js';
import { seedLaundryDefaults } from './modules/laundry/domain.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const PORT = Number(process.env.PORT || 3001);
const KEY = process.env.EPIC_API_KEY || 'dev-key-change-me';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/ui/',
});

registerApi(app);
registerSeedAutomations(TENANT);
seedDemo();
seedLaundryDefaults(TENANT);

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

try {
  await app.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' });
  console.log(`\n  Epic BOS Phase-0 kernel on http://localhost:${PORT}`);
  console.log(`  Demo UI:         http://localhost:${PORT}/ui/`);
  console.log(`  API health:      http://localhost:${PORT}/api/health`);
  console.log(`  API key:         ${KEY}\n`);
} catch (e) {
  console.error(e);
  process.exit(1);
}
