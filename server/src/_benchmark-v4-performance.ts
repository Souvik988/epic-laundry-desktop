import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Store } from './kernel/store.js';
import type { EntityRow } from './kernel/types.js';

const CUSTOMER_COUNT = Math.max(1, Number(process.env.V4_BENCH_CUSTOMERS || 100_000));
const ORDER_COUNT = Math.max(1, Number(process.env.V4_BENCH_ORDERS || 500_000));
const TENANT = 'bench-tenant';
const STORE_ID = 'STORE-DEFAULT';
const ACTOR = 'performance-benchmark';
const now = new Date('2026-01-01T00:00:00.000Z').getTime();

const row = (id: string, entity: string, data: Record<string, unknown>, createdAt: string): EntityRow => ({
  id, entity, tenant: TENANT, status: 'Submitted', version: 1, created_by: ACTOR, created_at: createdAt, updated_at: createdAt, data,
});

const timed = <T>(label: string, work: () => T) => {
  const started = performance.now();
  const result = work();
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  console.log(`${label}: ${elapsedMs} ms`);
  return { result, elapsedMs };
};

const databaseDirectory = mkdtempSync(join(tmpdir(), 'epic-v4-performance-'));
const databaseFile = join(databaseDirectory, 'benchmark.sqlite');
const store = new Store(databaseFile, { skipLegacyImport: true });

try {
  console.log(JSON.stringify({ database: 'disposable-temp', customers: CUSTOMER_COUNT, orders: ORDER_COUNT, tenant: TENANT, store: STORE_ID }));
  const seedStarted = performance.now();
  store.transaction(() => {
    for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
      const createdAt = new Date(now + index * 1000).toISOString();
      store.insertRow(row(`customer-${index + 1}`, 'party', { name: `Benchmark Customer ${index + 1}`, phone: `90000${String(index).padStart(5, '0')}`, is_customer: true }, createdAt));
    }
    for (let index = 0; index < ORDER_COUNT; index += 1) {
      const createdAt = new Date(now + (CUSTOMER_COUNT + index) * 1000).toISOString();
      const customer = `customer-${(index % CUSTOMER_COUNT) + 1}`;
      store.insertRow(row(`order-${index + 1}`, 'laundry_order', {
        name: `ORD-${String(index + 1).padStart(7, '0')}`, customer, invoice: '', state: index % 20 === 0 ? 'Ready' : 'Booked', order_date: '2026-01-15', expected_delivery_date: '2026-01-17', fulfillment_mode: 'Pickup Order', items: [], subtotal: 100, charges: 0, discounts: 0, tax_rate: 0, tax_amount: 0, grand_total: 100, payment_mode: 'Pay Later', payment_status: 'Pending', source: 'COUNTER',
      }, createdAt));
      if ((index + 1) % 50_000 === 0) console.log(`seeded orders: ${index + 1}/${ORDER_COUNT}`);
    }
  });
  console.log(`seed time: ${Math.round((performance.now() - seedStarted) / 1000)} s`);

  const firstPage = timed('order page 1', () => store.listLaundryOrderPage(TENANT, { page: 1, pageSize: 50 }));
  const deepPage = timed('order page 10000', () => store.listLaundryOrderPage(TENANT, { page: 10_000, pageSize: 50 }));
  const cursorAfterOrder51 = Buffer.from(JSON.stringify({ createdAt: new Date(now + (CUSTOMER_COUNT + 50) * 1000).toISOString(), id: 'order-51' }), 'utf8').toString('base64url');
  const cursorPage = timed('keyset page near order 10000', () => store.listLaundryOrderPage(TENANT, { cursor: cursorAfterOrder51, pageSize: 50 }));
  const searchCustomerNumber = Math.min(CUSTOMER_COUNT, 99_999);
  const searchedPage = timed('customer search', () => store.listLaundryOrderPage(TENANT, { search: `Benchmark Customer ${searchCustomerNumber}`, page: 1, pageSize: 50 }));
  const plan = store.explainRowsOfReportDate(TENANT, 'laundry_order', 'created_at');
  console.log(JSON.stringify({
    counts: { customers: CUSTOMER_COUNT, orders: ORDER_COUNT },
    checks: { firstPageItems: firstPage.result.rows.length, deepPageItems: deepPage.result.rows.length, cursorPageItems: cursorPage.result.rows.length, searchTotal: searchedPage.result.total },
    timingsMs: { firstPage: firstPage.elapsedMs, deepPage: deepPage.elapsedMs, cursorPage: cursorPage.elapsedMs, customerSearch: searchedPage.elapsedMs },
    queryPlan: plan,
  }, null, 2));
} finally {
  store.close();
  rmSync(databaseDirectory, { recursive: true, force: true });
}
