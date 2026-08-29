import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-recovery-drill-'));
const port = 3251;
const internalKey = 'recovery-drill-key';
const dbFile = join(tempDir, 'epic.sqlite');
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', EPIC_TENANT: 'RECOVERY', EPIC_DATA_FILE: join(tempDir, 'legacy.json'), EPIC_DB_FILE: dbFile, EPIC_LEGACY_JSON_FILE: join(tempDir, 'legacy.json'), EPIC_INTERNAL_API_KEY: internalKey };
const headers = { 'x-epic-internal-key': internalKey };
let child: ChildProcess | undefined;
function start() { const next = spawn(process.execPath, ['dist/index.js'], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] }); next.stdout?.on('data', () => undefined); next.stderr?.on('data', () => undefined); return next; }
async function waitForHealth() { for (let attempt = 0; attempt < 50; attempt += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) return; } catch { /* starting */ } await new Promise((resolve) => setTimeout(resolve, 120)); } throw new Error('recovery drill server did not become healthy'); }
async function stop() { if (!child) return; child.kill(); await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 4000); child?.once('exit', () => { clearTimeout(timer); resolve(); }); }); child = undefined; }
async function api(path: string, init: RequestInit = {}) { const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } }); if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${await response.text()}`); return response.json() as Promise<any>; }

try {
  child = start(); await waitForHealth();
  const bootstrap = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'recovery-owner', password: 'RecoveryOwnerPassword!26', tenant: 'RECOVERY', storeId: 'STORE-DEFAULT', businessName: 'Recovery Drill Laundry', phone: '9000000122' }) });
  assert.equal(bootstrap.status, 200, 'recovery drill bootstraps a fresh workspace');
  const catalogue = await api('/api/laundry/catalogue');
  assert.ok(Array.isArray(catalogue.garments) && catalogue.garments.length > 0, `recovery drill catalogue unavailable: ${JSON.stringify(catalogue)}`);
  const price = catalogue.prices[0];
  assert.ok(price?.garment && price?.service, 'recovery drill has at least one active price rule');
  const created = await api('/api/laundry/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'idempotency-key': 'recovery-order-001' }, body: JSON.stringify({ customer: { name: 'Recovery Customer', phone: '9000000121' }, items: [{ garment: price.garment, service: price.service, qty: 1 }], expectedDeliveryDate: '2026-09-10', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash' }) });
  const backup = await api('/api/ops/backup');
  assert.ok(backup.rows.some((row: any) => row.id === created.order.id), 'backup captures the operational order before the drill');
  const rehearsal = await api('/api/ops/restore/rehearse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
  assert.equal(rehearsal.ok, true, 'scheduled-style fresh-database rehearsal restores into an isolated temporary database');
  assert.equal(rehearsal.isolatedDatabase, true, 'fresh-database rehearsal never targets the live database');
  assert.equal(rehearsal.counts.rows, backup.rows.length, 'fresh-database rehearsal preserves durable row count');
  const encrypted = await api('/api/ops/backup/encrypted', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: 'Recovery Drill Passphrase!26' }) });
  const encryptedRehearsal = await api('/api/ops/restore/encrypted/rehearse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup: encrypted, passphrase: 'Recovery Drill Passphrase!26' }) });
  assert.equal(encryptedRehearsal.ok, true, 'encrypted fresh-database rehearsal decrypts and restores in isolation');
  await stop();
  renameSync(dbFile, join(tempDir, 'epic.sqlite.before-restore'));
  child = start(); await waitForHealth();
  const emptyOrders = await api('/api/laundry/orders');
  assert.equal(emptyOrders.length, 0, 'fresh database is empty before restore');
  const restored = await api('/api/ops/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
  assert.equal(restored.ok, true, 'versioned backup restores into a fresh database');
  const recoveredOrders = await api('/api/laundry/orders');
  assert.ok(recoveredOrders.some((order: any) => order.id === created.order.id), 'restored database exposes the original order');
  const recoveredBackup = await api('/api/ops/backup');
  assert.equal(recoveredBackup.financialEntries.length, backup.financialEntries.length, 'recovery preserves canonical financial entries');
  console.log('PASS  fresh-database backup restore and financial recovery drill complete');
} finally { await stop(); rmSync(tempDir, { recursive: true, force: true }); }
