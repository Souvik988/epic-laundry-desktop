import { createHash, randomUUID } from 'node:crypto';
import type { SyncOutboxRecord } from '../../kernel/store.js';
import type { MarketplaceEnvelope, SyncTransport } from './edge-sync.js';

/**
 * Development-only deterministic stand-in for the unavailable marketplace control plane.
 * It deliberately uses a sim:// credential reference and must never be treated as a live
 * endpoint, payment provider, or production acknowledgement service.
 */
export class MarketplaceIntegrationSimulator implements SyncTransport {
  private readonly delivered = new Map<string, string>();
  private readonly inboxes = new Map<string, MarketplaceEnvelope[]>();
  private unavailable = false;

  setUnavailable(value: boolean) { this.unavailable = value; }
  deliver(event: SyncOutboxRecord) {
    if (this.unavailable) throw new Error('simulated marketplace transport outage');
    const prior = this.delivered.get(event.eventId);
    if (prior) return { receiptId: prior };
    const receiptId = `sim_receipt_${createHash('sha256').update(event.eventId).digest('hex').slice(0, 24)}`;
    this.delivered.set(event.eventId, receiptId);
    return { receiptId };
  }
  enqueue(deviceId: string, envelope: MarketplaceEnvelope) {
    const pending = this.inboxes.get(deviceId) || [];
    pending.push(structuredClone(envelope));
    this.inboxes.set(deviceId, pending);
  }
  enqueueOrder(deviceId: string, input: Omit<MarketplaceEnvelope, 'eventId' | 'source' | 'deviceId' | 'aggregateType' | 'aggregateId' | 'occurredAt'> & { externalOrderId: string; payload: Record<string, unknown> }) {
    const envelope: MarketplaceEnvelope = {
      eventId: `sim_evt_${randomUUID()}`,
      source: 'marketplace-simulator',
      tenantId: input.tenantId,
      vendorId: input.vendorId,
      storeId: input.storeId,
      deviceId,
      aggregateType: 'marketplace_order',
      aggregateId: input.externalOrderId,
      aggregateVersion: input.aggregateVersion,
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      occurredAt: new Date().toISOString(),
      correlationId: input.correlationId,
      payload: { externalOrderId: input.externalOrderId, ...input.payload },
    };
    this.enqueue(deviceId, envelope);
    return envelope;
  }
  pull(deviceId: string, limit = 100) {
    if (this.unavailable) throw new Error('simulated marketplace transport outage');
    const pending = this.inboxes.get(deviceId) || [];
    const batch = pending.splice(0, Math.max(1, Math.min(1_000, limit))).map((event) => structuredClone(event));
    this.inboxes.set(deviceId, pending);
    return batch;
  }
  deliveryCount(eventId: string) { return this.delivered.has(eventId) ? 1 : 0; }
}
