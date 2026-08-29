import { store } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';

const text = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const normalized = (value: unknown, max = 120) => text(value, max).replace(/\s+/g, ' ').trim();

export type RackProfile = { id: string; name: string; code: string; capacity: number; active: boolean; notes: string };
function presentRackProfile(row: ReturnType<typeof store.rowsOf>[number]): RackProfile {
  return { id: row.id, name: normalized(row.data.name), code: text(row.data.code, 40).toUpperCase(), capacity: Math.max(1, Math.floor(Number(row.data.capacity || 0))), active: row.data.active !== false, notes: text(row.data.notes, 500) };
}
export function listRackProfiles(tenant: string, includeInactive = false) {
  return store.rowsOf(tenant, 'laundry_rack_profile').map(presentRackProfile).filter((profile) => includeInactive || profile.active).sort((a, b) => a.name.localeCompare(b.name));
}
function assertRackIdentityAvailable(tenant: string, name: string, code: string, excludeId?: string) {
  const profiles = listRackProfiles(tenant, true);
  if (profiles.some((profile) => profile.id !== excludeId && profile.name.toLowerCase() === name.toLowerCase())) throw new Error('rack profile name already exists');
  if (code && profiles.some((profile) => profile.id !== excludeId && profile.code.toLowerCase() === code.toLowerCase())) throw new Error('rack profile code already exists');
}
function rackCapacity(value: unknown) {
  const capacity = Math.floor(Number(value));
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 100000) throw new Error('rack capacity must be between 1 and 100000');
  return capacity;
}
export function createRackProfile(tenant: string, actor: string, input: { name?: string; code?: string; capacity?: number; active?: boolean; notes?: string }) {
  const name = normalized(input.name); if (name.length < 2) throw new Error('rack profile name is required');
  const code = text(input.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const capacity = rackCapacity(input.capacity);
  assertRackIdentityAvailable(tenant, name, code);
  const row = createRow(tenant, actor, 'laundry_rack_profile', { name, code, capacity, active: input.active !== false, notes: text(input.notes, 500) });
  audit(tenant, actor, 'laundry:rack-profile-created', { entity: row.entity, row_id: row.id, after: row.data });
  return presentRackProfile(row);
}
export function updateRackProfile(tenant: string, actor: string, id: string, input: { name?: string; code?: string; capacity?: number; active?: boolean; notes?: string }) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'laundry_rack_profile') throw new Error('rack profile not found');
  const before = presentRackProfile(row);
  const name = input.name === undefined ? before.name : normalized(input.name); if (name.length < 2) throw new Error('rack profile name is required');
  const code = input.code === undefined ? before.code : text(input.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const capacity = input.capacity === undefined ? before.capacity : rackCapacity(input.capacity);
  assertRackIdentityAvailable(tenant, name, code, id);
  row.data.name = name; row.data.code = code; row.data.capacity = capacity;
  if (input.active !== undefined) row.data.active = Boolean(input.active);
  if (input.notes !== undefined) row.data.notes = text(input.notes, 500);
  row.updated_at = new Date().toISOString(); store.updateRow(row);
  audit(tenant, actor, 'laundry:rack-profile-updated', { entity: row.entity, row_id: id, before, after: presentRackProfile(row) });
  return presentRackProfile(row);
}

/**
 * Store-scoped rack/bin occupancy derived from durable garment units.
 * Capacity is intentionally not invented here; a location is an occupied slot
 * only when a physical unit is actually recorded there.
 */
export function rackOccupancy(tenant: string, input: { location?: string; limit?: number } = {}) {
  const filter = text(input.location, 120).toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(input.limit || 500)));
  const profiles = listRackProfiles(tenant);
  const profileByKey = new Map(profiles.flatMap((profile) => [[profile.name.toLowerCase(), profile], ...(profile.code ? [[profile.code.toLowerCase(), profile] as const] : [])]));
  const units = store.listGarmentUnits(tenant, { state: 'Racked' }).filter((unit) => !filter || unit.location.toLowerCase().includes(filter));
  const locations = new Map<string, { location: string; occupied: number; capacity: number | null; available: number | null; utilizationPercent: number | null; overCapacity: boolean; units: Array<{ id: string; tagCode: string; orderId: string; orderNumber: string; customer: string; garment: string; updatedAt: string }> }>();
  for (const unit of units.slice(0, limit)) {
    const location = text(unit.location, 80) || 'UNASSIGNED';
    const profile = profileByKey.get(location.toLowerCase());
    const current = locations.get(location.toLowerCase()) || { location, occupied: 0, capacity: profile?.capacity ?? null, available: profile ? profile.capacity : null, utilizationPercent: null, overCapacity: false, units: [] };
    const order = store.getRow(tenant, unit.orderId);
    const customer = store.getRow(tenant, unit.customerId);
    const garment = store.getRow(tenant, unit.garmentId);
    current.occupied += 1;
    if (current.capacity !== null) { current.available = current.capacity - current.occupied; current.utilizationPercent = Math.round(current.occupied / current.capacity * 100); current.overCapacity = current.occupied > current.capacity; }
    if (current.units.length < 100) current.units.push({ id: unit.id, tagCode: unit.activeTagCode, orderId: unit.orderId, orderNumber: text(order?.data.name, 80) || unit.orderId, customer: text(customer?.data.name, 120) || 'Unknown customer', garment: text(garment?.data.name, 120) || unit.garmentId, updatedAt: unit.updatedAt });
    locations.set(location.toLowerCase(), current);
  }
  if (!filter) for (const profile of profiles) if (!locations.has(profile.name.toLowerCase())) locations.set(profile.name.toLowerCase(), { location: profile.name, occupied: 0, capacity: profile.capacity, available: profile.capacity, utilizationPercent: 0, overCapacity: false, units: [] });
  const unassigned = units.filter((unit) => !text(unit.location, 80)).length;
  const locationRows = [...locations.values()].sort((a, b) => a.location.localeCompare(b.location));
  const configuredCapacity = profiles.reduce((sum, profile) => sum + profile.capacity, 0);
  const overCapacityLocations = locationRows.filter((location) => location.overCapacity).length;
  return {
    asOf: new Date().toISOString(),
    totals: { rackedUnits: units.length, locations: locations.size, unassignedRackedUnits: unassigned, occupiedSlots: units.length, configuredLocations: profiles.length, configuredCapacity, availableSlots: configuredCapacity - units.filter((unit) => profileByKey.has(text(unit.location, 80).toLowerCase())).length, overCapacityLocations },
    locations: locationRows,
  };
}
