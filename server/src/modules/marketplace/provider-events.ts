import { createHmac, timingSafeEqual } from 'node:crypto';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';

export type ProviderPaymentEvent = { eventId: string; provider: string; paymentIntent: string; status: 'Captured' | 'Failed' | 'Refunded' | 'Chargeback'; amountPaise: number; currency: string; occurredAt: string; payload: Record<string, unknown> };
function signature(secret: string, timestamp: string, rawBody: string) { return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex'); }
export function verifyProviderWebhook(input: { secret: string; signature: string; timestamp: string; rawBody: string; now?: Date; maxSkewSeconds?: number }) {
  const timestamp = Number(input.timestamp); const maxSkew = input.maxSkewSeconds || 300; if (!input.secret || !Number.isSafeInteger(timestamp) || Math.abs((input.now || new Date()).getTime() / 1000 - timestamp) > maxSkew) throw new Error('PAYMENT_WEBHOOK_REPLAY_REJECTED'); const expected = Buffer.from(signature(input.secret, input.timestamp, input.rawBody), 'utf8'); const actual = Buffer.from(String(input.signature || ''), 'utf8'); if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('PAYMENT_WEBHOOK_SIGNATURE_INVALID'); return true;
}
export function recordProviderPaymentEvent(tenant: string, actor: string, event: ProviderPaymentEvent) {
  if (!event.eventId || !event.paymentIntent || !Number.isSafeInteger(event.amountPaise) || event.amountPaise < 0 || event.currency !== 'INR') throw new Error('PAYMENT_PROVIDER_EVENT_INVALID'); const existing = store.rowsOf(tenant, 'provider_payment_event').find((row) => row.data.eventId === event.eventId && row.data.provider === event.provider); if (existing) return existing; const timestamp = new Date().toISOString(); const row: EntityRow = { id: `provider_event_${event.provider}_${event.eventId}`, entity: 'provider_payment_event', tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { ...event, immutable: true, receivedAt: timestamp } }; store.insertRow(row); audit(tenant, actor, 'payment:provider-event-recorded', { entity: row.entity, row_id: row.id, after: { eventId: event.eventId, provider: event.provider, paymentIntent: event.paymentIntent, status: event.status, amountPaise: event.amountPaise } }); return row;
}
