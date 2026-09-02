import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-marketplace-notifications-api-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite');
process.env.EPIC_DATA_FILE = join(dir, 'legacy.json');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
let close: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  close = () => store.close();
  const app = Fastify();
  registerApi(app);
  const boot = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'notification-owner', password: 'StrongNotificationPassword!26', tenant: 'NOTIFY-API', storeId: 'STORE-NOTIFY', businessName: 'Notification API Laundry' } });
  assert.equal(boot.statusCode, 200);
  const headers = { cookie: String(boot.headers['set-cookie']).split(';')[0], 'idempotency-key': 'notification-queue-001' };
  const queued = await app.inject({ method: 'POST', url: '/api/marketplace/notifications', headers, payload: { eventId: 'order-ready-001', eventType: 'order.ready', recipientRef: 'customer-ref-001', channel: 'whatsapp', template: 'order-ready', payload: { orderRef: 'order-001' } } });
  assert.equal(queued.statusCode, 201, 'notification event can be queued');
  const sentWithoutEvidence = await app.inject({ method: 'POST', url: '/api/marketplace/notifications/order-ready-001/whatsapp/delivery', headers: { cookie: headers.cookie }, payload: { state: 'Sent' } });
  assert.equal(sentWithoutEvidence.statusCode, 400, 'sent state requires provider evidence');
  const delivered = await app.inject({ method: 'POST', url: '/api/marketplace/notifications/order-ready-001/whatsapp/delivery', headers: { cookie: headers.cookie }, payload: { state: 'Delivered', providerMessageId: 'wamid-001' } });
  assert.equal(delivered.statusCode, 200, 'delivery state records provider evidence');
  const duplicate = await app.inject({ method: 'POST', url: '/api/marketplace/notifications', headers: { cookie: headers.cookie, 'idempotency-key': 'notification-queue-002' }, payload: { eventId: 'order-ready-001', eventType: 'order.ready', recipientRef: 'customer-ref-001', channel: 'whatsapp', template: 'order-ready', payload: { orderRef: 'order-001' } } });
  assert.equal(duplicate.statusCode, 201);
  assert.equal(store.withStoreScope('NOTIFY-API', 'STORE-NOTIFY', () => store.rowsOf('NOTIFY-API', 'marketplace_notification_event').length), 1, 'same event/channel remains idempotent');
  await app.close();
  console.log('PASS marketplace notification API queue, provider evidence, and event/channel idempotency self-test complete');
} finally {
  close?.();
  rmSync(dir, { recursive: true, force: true });
}
