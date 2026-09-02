import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'epic-provider-events-api-'));
process.env.EPIC_DB_FILE = join(dir, 'epic.sqlite');
process.env.EPIC_DATA_FILE = join(dir, 'legacy.json');
process.env.EPIC_LEGACY_JSON_FILE = process.env.EPIC_DATA_FILE;
process.env.EPIC_MARKETPLACE_PROVIDER_SECRET = 'provider-api-test-secret';
process.env.EPIC_MARKETPLACE_WEBHOOK_TENANT = 'PAYMENT-API';
process.env.EPIC_MARKETPLACE_WEBHOOK_STORE_ID = 'STORE-API';

let close: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { registerApi } = await import('./api.js');
  close = () => store.close();
  const app = Fastify();
  registerApi(app);
  const event = {
    eventId: 'evt-api-pay-1',
    paymentIntent: 'pi-api-1',
    status: 'Captured',
    amountPaise: 12500,
    currency: 'INR',
    occurredAt: new Date().toISOString(),
    payload: { source: 'provider-api-test' },
  } as const;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', process.env.EPIC_MARKETPLACE_PROVIDER_SECRET).update(`${timestamp}.${JSON.stringify(event)}`).digest('hex');
  const headers = { 'x-provider-timestamp': timestamp, 'x-provider-signature': signature };
  const first = await app.inject({ method: 'POST', url: '/api/marketplace/payments/webhook/simulator', headers, payload: event });
  assert.equal(first.statusCode, 202, 'verified provider event is accepted');
  const duplicate = await app.inject({ method: 'POST', url: '/api/marketplace/payments/webhook/simulator', headers, payload: event });
  assert.equal(duplicate.statusCode, 202, 'duplicate provider event is safely acknowledged');
  assert.equal(store.withStoreScope('PAYMENT-API', 'STORE-API', () => store.rowsOf('PAYMENT-API', 'provider_payment_event').length), 1, 'duplicate provider event is stored once');
  const invalid = await app.inject({ method: 'POST', url: '/api/marketplace/payments/webhook/simulator', headers: { ...headers, 'x-provider-signature': 'invalid' }, payload: event });
  assert.equal(invalid.statusCode, 401, 'invalid provider signature is rejected');
  delete process.env.EPIC_MARKETPLACE_PROVIDER_SECRET;
  const unconfigured = await app.inject({ method: 'POST', url: '/api/marketplace/payments/webhook/simulator', headers, payload: event });
  assert.equal(unconfigured.statusCode, 503, 'unconfigured provider boundary fails closed');
  await app.close();
  console.log('PASS provider webhook API signature, replay protection, duplicate delivery, and fail-closed configuration self-test complete');
} finally {
  close?.();
  rmSync(dir, { recursive: true, force: true });
}
