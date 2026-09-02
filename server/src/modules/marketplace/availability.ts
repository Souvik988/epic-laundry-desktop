import { store, type MarketplaceAvailabilityRecord, type MarketplaceAvailabilityState } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const boolMap = (value: unknown) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([, v]) => typeof v === 'boolean').slice(0, 50)) as Record<string, boolean>;
export function saveMarketplaceAvailability(tenant: string, actor: string, input: Partial<MarketplaceAvailabilityRecord>) {
  const current = store.getMarketplaceAvailability(tenant); const state = (input.state || current?.state || 'Closed') as MarketplaceAvailabilityState;
  if (!['Open', 'Closed', 'Paused'].includes(state)) throw new Error('invalid availability state');
  const hours = input.businessHours || current?.businessHours || Object.fromEntries(DAYS.map((day) => [day, { open: '09:00', close: '20:00' }])) as MarketplaceAvailabilityRecord['businessHours'];
  for (const day of DAYS) { const entry = hours[day]; if (entry !== null && (!entry || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.close))) throw new Error(`invalid business hours for ${day}`); }
  const capacity = { orders: input.capacity?.orders ?? current?.capacity.orders ?? null, bags: input.capacity?.bags ?? current?.capacity.bags ?? null, kg: input.capacity?.kg ?? current?.capacity.kg ?? null, stops: input.capacity?.stops ?? current?.capacity.stops ?? null };
  for (const [key, value] of Object.entries(capacity)) if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000)) throw new Error(`invalid ${key} capacity`);
  const record: MarketplaceAvailabilityRecord = { tenant, storeId: store.currentStore(tenant), state, timezone: clean(input.timezone || current?.timezone || 'Asia/Kolkata', 80), businessHours: hours, holidays: (input.holidays || current?.holidays || []).map((v) => clean(v, 20)).filter(Boolean).slice(0, 500), serviceZones: (input.serviceZones || current?.serviceZones || []).map((v) => clean(v, 120)).filter(Boolean).slice(0, 200), capabilities: boolMap(input.capabilities || current?.capabilities || { express: false, pickup: true, delivery: true }), capacity, leadTimeMinutes: Number.isSafeInteger(input.leadTimeMinutes) ? Math.max(0, input.leadTimeMinutes!) : current?.leadTimeMinutes || 0, staleAfterMinutes: Number.isSafeInteger(input.staleAfterMinutes) ? Math.max(1, input.staleAfterMinutes!) : current?.staleAfterMinutes || 30, updatedAt: new Date().toISOString(), updatedBy: actor };
  const saved = store.saveMarketplaceAvailability(record); audit(tenant, actor, 'marketplace:availability-updated', { entity: 'marketplace_store_availability', row_id: record.storeId, after: { state, capacity, serviceZones: record.serviceZones, capabilities: record.capabilities } }); return saved;
}
export function marketplaceAvailability(tenant: string, now = new Date()) {
  const availability = store.getMarketplaceAvailability(tenant); const device = store.getMarketplaceDevice(tenant);
  if (!availability) return { configured: false, state: 'NotConfigured' as const, stale: true, availability: null, device: device ? { id: device.id, status: device.status } : null };
  const lastSeen = device?.lastSeenAt ? Date.parse(device.lastSeenAt) : NaN; const stale = !Number.isFinite(lastSeen) || now.getTime() - lastSeen > availability.staleAfterMinutes * 60_000;
  return { configured: true, state: device?.status === 'Registered' && !stale ? availability.state : 'Stale', stale, availability, device: device ? { id: device.id, status: device.status, lastSeenAt: device.lastSeenAt } : null };
}
