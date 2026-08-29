import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-garment-backfill-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = join(tempDir, 'legacy.json');
let closeStore: (() => void) | undefined;

try {
  const { store } = await import('./kernel/store.js');
  const { createRow } = await import('./kernel/entity-service.js');
  const { applyLaundryGarmentBackfill, laundryCatalogue, previewLaundryGarmentBackfill, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  closeStore = () => store.close();
  const tenant = 'GARMENT-BACKFILL';
  const actor = 'backfill-owner';
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => seedLaundryDefaults(tenant));
  const catalogue = store.withStoreScope(tenant, 'STORE-DEFAULT', () => laundryCatalogue(tenant));
  const piece = catalogue.garments.find((garment: any) => garment.unit === 'Piece')!;
  const weight = catalogue.garments.find((garment: any) => garment.unit === 'Kilogram')!;
  const service = catalogue.services[0];
  const customer = store.withStoreScope(tenant, 'STORE-DEFAULT', () => createRow(tenant, actor, 'party', { name: 'Legacy Customer', phone: '9000000998', is_customer: true }));
  const order = store.withStoreScope(tenant, 'STORE-DEFAULT', () => createRow(tenant, actor, 'laundry_order', {
    customer: customer.id, order_date: '2026-08-01', expected_delivery_date: '2026-08-03', fulfillment_mode: 'Home Delivery',
    state: 'Ready', items: [
      { garment: piece.id, garmentName: piece.name, service: service.id, serviceName: service.name, unit: 'Piece', qty: 2, rate: 100, amount: 200 },
      { garment: weight.id, garmentName: weight.name, service: service.id, serviceName: service.name, unit: 'Kilogram', qty: 2.5, rate: 100, amount: 250 },
    ],
  }));
  order.status = 'Booked'; order.updated_at = new Date().toISOString(); store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.updateRow(order));
  const preview = store.withStoreScope(tenant, 'STORE-DEFAULT', () => previewLaundryGarmentBackfill(tenant));
  assert.equal(preview.candidateCount, 2, 'backfill previews each missing physical piece');
  assert.equal(preview.skippedNonPhysical, 1, 'backfill excludes weight lines without fabricating garments');
  const applied = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyLaundryGarmentBackfill(tenant, actor));
  assert.equal(applied.applied, 2, 'reviewed backfill creates the missing durable units');
  const units = store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listGarmentUnits(tenant, { orderId: order.id }));
  assert.deepEqual(units.map((unit) => unit.state), ['Racked', 'Racked'], 'backfill preserves the known order lifecycle state');
  assert.equal(store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listGarmentUnitEvents(tenant).filter((event) => event.event === 'legacy_backfill').length), 2, 'backfill records an auditable source event for every unit');
  const retry = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyLaundryGarmentBackfill(tenant, actor));
  assert.equal(retry.applied, 0, 'backfill retry is idempotent after all physical lines are migrated');
  console.log('PASS  reviewed legacy garment-unit backfill preview, apply, lifecycle preservation, and idempotency self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
