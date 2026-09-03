import { randomUUID } from 'node:crypto';
import { store, type MarketplaceChannel, type MarketplaceCustomerLinkRecord } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';

const channels: MarketplaceChannel[] = ['CUSTOMER_APP', 'WEBSITE', 'VENDOR_APP', 'MARKETPLACE', 'ADMIN', 'IMPORT'];

function text(value: unknown, label: string, max = 160) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new Error(`${label} is required`);
  return result;
}

export function listMarketplaceCustomerLinks(tenant: string, customerId?: string) {
  return store.listMarketplaceCustomerLinks(tenant, customerId);
}

export function saveMarketplaceCustomerLink(tenant: string, actor: string, input: { id?: string; customerId: string; channel: string; externalCustomerId: string }) {
  const customerId = text(input.customerId, 'customer ID');
  const channel = text(input.channel, 'channel', 40) as MarketplaceChannel;
  const externalCustomerId = text(input.externalCustomerId, 'external customer ID');
  if (!channels.includes(channel)) throw new Error('MARKETPLACE_CUSTOMER_LINK_CHANNEL_INVALID');
  const customer = store.getRow(tenant, customerId);
  if (!customer || customer.entity !== 'party' || customer.data.is_customer !== true) throw new Error('MARKETPLACE_CUSTOMER_LINK_CUSTOMER_NOT_FOUND');
  const existing = store.getMarketplaceCustomerLink(tenant, channel, externalCustomerId);
  if (existing && existing.customerId !== customerId) throw new Error('MARKETPLACE_CUSTOMER_ALREADY_LINKED');
  const now = new Date().toISOString();
  const record: MarketplaceCustomerLinkRecord = { id: existing?.id || text(input.id || `mcl_${randomUUID()}`, 'link ID'), tenant, storeId: store.currentStore(tenant), customerId, channel, externalCustomerId, status: 'Active', createdAt: existing?.createdAt || now, updatedAt: now, updatedBy: actor };
  const saved = store.saveMarketplaceCustomerLink(record);
  audit(tenant, actor, 'marketplace:customer-linked', { entity: 'marketplace_customer_link', row_id: saved.id, after: { customerId, channel, externalCustomerId, status: saved.status } });
  return saved;
}

export function revokeMarketplaceCustomerLink(tenant: string, actor: string, id: string) {
  const existing = store.getMarketplaceCustomerLinkById(tenant, text(id, 'link ID'));
  if (!existing) throw new Error('MARKETPLACE_CUSTOMER_LINK_NOT_FOUND');
  if (existing.status === 'Revoked') return existing;
  const saved = store.revokeMarketplaceCustomerLink(tenant, existing.id, new Date().toISOString(), actor)!;
  audit(tenant, actor, 'marketplace:customer-link-revoked', { entity: 'marketplace_customer_link', row_id: saved.id, after: { customerId: saved.customerId, channel: saved.channel, externalCustomerId: saved.externalCustomerId, status: saved.status } });
  return saved;
}
