import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-restart-test-'));
const port = 3247;
const internalKey = 'restart-test-key';
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', EPIC_TENANT: 'RESTART', EPIC_DATA_FILE: join(tempDir, 'legacy.json'), EPIC_DB_FILE: join(tempDir, 'epic.sqlite'), EPIC_LEGACY_JSON_FILE: join(tempDir, 'legacy.json'), EPIC_INTERNAL_API_KEY: internalKey };
const headers = { 'x-epic-internal-key': internalKey };

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
  const catalogue = await api<{ garments: Array<{ id: string }>; services: Array<{ id: string }> }>('/api/laundry/catalogue');
  const created = await api<{ order: { id: string } }>('/api/laundry/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'idempotency-key': 'restart-order-001' }, body: JSON.stringify({ customer: { name: 'Restart Customer', phone: '9000000999' }, items: [{ garment: catalogue.garments[0].id, service: catalogue.services[0].id, qty: 1 }], expectedDeliveryDate: '2026-09-03', fulfillmentMode: 'Home Delivery', paymentMode: 'Pay Later' }) });
  assert.ok(created.order.id, 'order created before process restart');
  await stop(first); first = undefined;
  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/api/health`), 'stopped server is offline between launches');
  second = start();
  await waitForHealth();
  const orders = await api<Array<{ id: string }>>('/api/laundry/orders');
  assert.equal(orders.some((order) => order.id === created.order.id), true, 'SQLite order survives a process restart');
  await stop(second); second = undefined;
  console.log('PASS  packaged server restart and offline persistence self-test complete');
} finally {
  if (first) await stop(first);
  if (second) await stop(second);
  rmSync(tempDir, { recursive: true, force: true });
}
