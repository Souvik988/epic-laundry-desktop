import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './kernel/store.js';
import type { EntityRow } from './kernel/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-order-search-'));
const databaseFile = join(tempDir, 'nested', 'search.sqlite');
const tenant = 'SEARCH-TEST';
const storeId = 'STORE-DEFAULT';
const at = '2026-09-03T00:00:00.000Z';
const row = (id: string, entity: string, data: Record<string, unknown>, version = 1): EntityRow => ({ id, entity, tenant, status: 'Submitted', version, created_by: 'test', created_at: at, updated_at: at, data });

let store: Store | undefined;
try {
  store = new Store(databaseFile, { skipLegacyImport: true });
  store.withStoreScope(tenant, storeId, () => {
    store!.insertRow(row('customer-1', 'party', { name: 'Searchable Customer', phone: '9000000001', is_customer: true }));
    store!.insertRow(row('order-1', 'laundry_order', { name: 'ORD-SEARCH-1', customer: 'customer-1', invoice: '', state: 'Booked', order_date: '2026-09-03', expected_delivery_date: '2026-09-04', fulfillment_mode: 'Pickup Order', items: [], grand_total: 100 }));
    assert.equal(store!.listLaundryOrderPage(tenant, { search: 'Searchable Customer' }).total, 1, 'new order is searchable by customer identity');
    assert.equal(store!.listLaundryOrderPage(tenant, { search: '!!!' }).total, 0, 'punctuation-only search cannot accidentally return every order');

    store!.updateRow(row('customer-1', 'party', { name: 'Renamed Customer', phone: '9000000001', is_customer: true }, 2));
    assert.equal(store!.listLaundryOrderPage(tenant, { search: 'Searchable Customer' }).total, 0, 'customer rename removes the old search projection');
    assert.equal(store!.listLaundryOrderPage(tenant, { search: 'Renamed Customer' }).total, 1, 'customer rename refreshes the order search projection');

    store!.updateRow(row('order-1', 'laundry_order', { name: 'ORD-RENAMED-1', customer: 'customer-1', invoice: '', state: 'Booked', order_date: '2026-09-03', expected_delivery_date: '2026-09-04', fulfillment_mode: 'Pickup Order', items: [], grand_total: 100 }, 2));
    assert.equal(store!.listLaundryOrderPage(tenant, { search: 'ORD-SEARCH-1' }).total, 0, 'order rename removes the old order search projection');
    assert.equal(store!.listLaundryOrderPage(tenant, { search: 'ORD-RENAMED-1' }).total, 1, 'order rename refreshes the order search projection');
  });
  store.close();
  store = new Store(databaseFile, { skipLegacyImport: true });
  assert.equal(store.withStoreScope(tenant, storeId, () => store!.listLaundryOrderPage(tenant, { search: 'Renamed Customer' }).total), 1, 'search projection survives restart');
  console.log('PASS order search projection backfill, update, and restart self-test complete');
} finally {
  store?.close();
  rmSync(tempDir, { recursive: true, force: true });
}
