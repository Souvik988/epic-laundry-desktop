import { randomUUID } from 'node:crypto';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { audit } from '../../kernel/audit.js';

export type NotificationChannel = 'in-app' | 'push' | 'whatsapp' | 'sms' | 'email';
export type NotificationState = 'Queued' | 'Sent' | 'Delivered' | 'Failed';
export function queueMarketplaceNotification(tenant: string, actor: string, input: { eventId: string; eventType: string; recipientRef: string; channel: NotificationChannel; template: string; payload: Record<string, unknown> }) {
  if (!input.eventId || !input.eventType || !input.recipientRef || !input.template || !['in-app', 'push', 'whatsapp', 'sms', 'email'].includes(input.channel)) throw new Error('NOTIFICATION_EVENT_INVALID');
  const existing = store.rowsOf(tenant, 'marketplace_notification_event').find((candidate) => candidate.data.eventId === input.eventId && candidate.data.channel === input.channel); if (existing) return existing;
  const timestamp = new Date().toISOString(); const event: EntityRow = { id: `notification_${randomUUID()}`, entity: 'marketplace_notification_event', tenant, status: 'Active', version: 1, created_by: actor, created_at: timestamp, updated_at: timestamp, data: { ...input, state: 'Queued' as NotificationState, queuedAt: timestamp, immutableEvent: true } }; store.insertRow(event); audit(tenant, actor, 'marketplace:notification-queued', { entity: event.entity, row_id: event.id, after: { eventId: input.eventId, eventType: input.eventType, channel: input.channel } }); return event;
}
export function recordMarketplaceNotificationDelivery(tenant: string, actor: string, eventId: string, channel: NotificationChannel, input: { state: NotificationState; providerMessageId?: string; error?: string }) {
  const event = store.rowsOf(tenant, 'marketplace_notification_event').find((candidate) => candidate.data.eventId === eventId && candidate.data.channel === channel); if (!event) throw new Error('notification event not found');
  if (input.state === 'Delivered' && !input.providerMessageId) throw new Error('NOTIFICATION_EVIDENCE_REQUIRED');
  if (input.state === 'Sent' && !input.providerMessageId) throw new Error('NOTIFICATION_EVIDENCE_REQUIRED');
  if (input.state === 'Failed' && !String(input.error || '').trim()) throw new Error('NOTIFICATION_FAILURE_REASON_REQUIRED');
  if (event.data.state === 'Delivered') return event;
  event.data.state = input.state; event.data.providerMessageId = input.providerMessageId; event.data.error = input.error; event.data.updatedAt = new Date().toISOString(); event.version += 1; event.updated_at = String(event.data.updatedAt); store.updateRow(event); audit(tenant, actor, 'marketplace:notification-delivery-recorded', { entity: event.entity, row_id: event.id, after: { eventId, channel, state: input.state, providerMessageId: input.providerMessageId ? '[present]' : undefined } }); return event;
}
