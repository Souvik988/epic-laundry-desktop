import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-restart-test-'));
const port = 3247;
const internalKey = 'restart-test-key';
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', EPIC_TENANT: 'RESTART', EPIC_DATA_FILE: join(tempDir, 'legacy.json'), EPIC_DB_FILE: join(tempDir, 'epic.sqlite'), EPIC_LEGACY_JSON_FILE: join(tempDir, 'legacy.json'), EPIC_INTERNAL_API_KEY: internalKey, EPIC_TEST_SYNC_DELAY_MS: '250' };
let headers: Record<string, string> = { 'x-epic-internal-key': internalKey };

function start(): ChildProcess {
  const child = spawn(process.execPath, ['dist/index.js'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('restart test server did not become healthy');
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function stop(child: ChildProcess) {
  if (!child.killed) child.kill();
  await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
}

let first: ChildProcess | undefined;
let second: ChildProcess | undefined;
try {
  first = start();
  await waitForHealth();
  const bootstrap = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'restart-owner', password: 'RestartOwnerPassword!26', firstName: 'Restart', businessName: 'Restart Test Laundry', phone: '9000000998', address: 'Restart test address' }),
  });
  assert.equal(bootstrap.status, 200, 'production owner bootstrap creates the neutral default catalogue');
  headers = { cookie: String(bootstrap.headers.get('set-cookie') || '').split(';')[0] };
  const catalogue = await api<{ garments: Array<{ id: string }>; services: Array<{ id: string }> }>('/api/laundry/catalogue');
  const created = await api<{ order: { id: string } }>('/api/laundry/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'idempotency-key': 'restart-order-001' }, body: JSON.stringify({ customer: { name: 'Restart Customer', phone: '9000000999' }, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later' }) });
  assert.ok(created.order.id, 'order created before process restart');
  const replayDoc = { entity: 'party', clientId: 'restart-replay-customer-001', data: { name: 'Restart Replay Customer', phone: '9000000997', is_customer: true } };
  const transitionDoc = { entity: 'laundry_order_transition', clientId: 'restart-replay-transition-001', data: { orderId: created.order.id, state: 'In Process', expectedVersion: 0, note: 'Restart mixed-batch transition' } };
  const editDoc = { entity: 'laundry_order_edit', clientId: 'restart-replay-edit-001', data: { orderId: created.order.id, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', charges: 0, discounts: 0, taxRate: 0, notes: 'Restart mixed-batch edit', deliveryAddress: 'Restart edited address', expectedVersion: 1 } };
  const replayed = await api<{ applied: number; results: Array<{ id: string }> }>('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: [replayDoc, transitionDoc, editDoc] }) });
  assert.equal(replayed.applied, 3, 'mixed offline customer, transition and edit batch applies before the simulated restart');
  const cancelOrder = await api<{ order: { id: string } }>('/api/laundry/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'idempotency-key': 'restart-cancel-order-001' }, body: JSON.stringify({ customer: { name: 'Restart Cancel Customer', phone: '9000000996' }, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later' }) });
  const editOrder = await api<{ order: { id: string } }>('/api/laundry/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'idempotency-key': 'restart-edit-order-001' }, body: JSON.stringify({ customer: { name: 'Restart Edit Customer', phone: '9000000994' }, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later' }) });
  const inFlightDocs = [
    { entity: 'party', clientId: 'restart-inflight-party-001', data: { name: 'Restart Inflight Customer', phone: '9000000995', is_customer: true } },
    { entity: 'laundry_order_edit', clientId: 'restart-inflight-edit-001', data: { orderId: editOrder.order.id, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', charges: 0, discounts: 0, taxRate: 0, notes: 'Restart kill-in-flight edit', deliveryAddress: 'Restart in-flight address', expectedVersion: 0 } },
    { entity: 'laundry_order_transition', clientId: 'restart-inflight-transition-001', data: { orderId: editOrder.order.id, state: 'In Process', expectedVersion: 1, note: 'Restart kill-in-flight transition' } },
    { entity: 'laundry_order_cancel', clientId: 'restart-inflight-cancel-001', data: { orderId: cancelOrder.order.id, reason: 'Restart kill-in-flight cancellation', expectedVersion: 0 } },
  ];
  let inFlightCompleted = false;
  const inFlightPromise = api<{ applied: number }>('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: inFlightDocs }) }).then(() => { inFlightCompleted = true; return true; }).catch(() => { inFlightCompleted = true; return false; });
  await new Promise((resolve) => setTimeout(resolve, 325));
  assert.equal(inFlightCompleted, false, 'delayed sync batch is still in flight at the kill boundary');
  await stop(first); first = undefined;
  assert.equal(await inFlightPromise, false, 'killed sync request is interrupted and can be retried');
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/health`), 'stopped server is offline between launches');
  second = start();
  await waitForHealth();
  const orders = await api<Array<{ id: string }>>('/api/laundry/orders');
  assert.equal(orders.some((order) => order.id === created.order.id), true, 'SQLite order survives a process restart');
  const replayRetry = await api<{ applied: number; results: Array<{ id: string }> }>('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: [replayDoc, transitionDoc, editDoc] }) });
  assert.equal(replayRetry.applied, 3, 'mixed replay remains safely idempotent after a process restart');
  assert.deepEqual(replayRetry.results.map((result) => result.id), replayed.results.map((result) => result.id), 'mixed replay after restart returns the original entities');
  const inFlightRetry = await api<{ applied: number; results: Array<{ id: string }> }>('/api/sync/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: inFlightDocs }) });
  assert.equal(inFlightRetry.applied, inFlightDocs.length, 'partially processed mixed mutation batch replays after restart without loss');
  assert.equal(inFlightRetry.results.length, inFlightDocs.length, 'replayed mixed in-flight batch returns one result per command');
  assert.equal(new Set(inFlightRetry.results.map((result) => result.id)).size, 3, 'replayed mixed in-flight batch references the party, edited order and cancelled order');
  const inFlightOrder = await api<{ version: number; state: string; notes: string }>(`/api/laundry/orders/${editOrder.order.id}`);
  assert.equal(inFlightOrder.version, 2, 'in-flight edit and transition replay preserve ordered versions');
  assert.equal(inFlightOrder.state, 'In Process', 'in-flight transition replays after restart');
  assert.equal(inFlightOrder.notes, 'Restart kill-in-flight edit', 'in-flight edit replays after restart');
  const cancelledOrder = await api<{ version: number; state: string }>(`/api/laundry/orders/${cancelOrder.order.id}`);
  assert.equal(cancelledOrder.version, 1, 'in-flight cancellation increments the order version');
  assert.equal(cancelledOrder.state, 'Cancelled', 'in-flight cancellation replays after restart');
  const persisted = await api<{ version: number; state: string; notes: string; deliveryAddress?: string }>(`/api/laundry/orders/${created.order.id}`);
  assert.equal(persisted.version, 2, 'versioned transition and edit survive the process restart');
  assert.equal(persisted.state, 'In Process', 'transition state survives the process restart');
  assert.equal(persisted.notes, 'Restart mixed-batch edit', 'controlled edit survives the process restart');
  await stop(second); second = undefined;
  console.log('PASS  packaged server restart and offline persistence self-test complete');
} finally {
  if (first) await stop(first);
  if (second) await stop(second);
  rmSync(tempDir, { recursive: true, force: true });
}
