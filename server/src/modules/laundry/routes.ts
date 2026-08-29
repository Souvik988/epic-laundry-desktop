import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import { transitionLaundryOrder } from './domain.js';
import { laundryBusinessDate } from './dates.js';

export type RouteStage = 'Pickup' | 'Delivery';
const openRunStatuses = ['Planned', 'In Progress'];
const text = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const normalizedZone = (value: unknown) => text(value, 120).replace(/\s+/g, ' ').trim();
function routeTime(value: unknown, fallback = '09:00') { const candidate = text(value, 5); return /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : fallback; }
function etaFor(routeDate: string, startTime: string, minutesPerStop: number, sequence: number) { const [hours, minutes] = startTime.split(':').map(Number); const total = hours * 60 + minutes + Math.max(0, sequence - 1) * minutesPerStop; const dayOffset = Math.floor(total / 1440); const dayMinutes = total % 1440; const date = new Date(`${routeDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + dayOffset); return `${date.toISOString().slice(0, 10)}T${String(Math.floor(dayMinutes / 60)).padStart(2, '0')}:${String(dayMinutes % 60).padStart(2, '0')}:00`; }

export type ServiceZone = { id: string; name: string; code: string; active: boolean; pickupWindow: string; deliveryWindow: string; notes: string };
function presentServiceZone(row: ReturnType<typeof store.rowsOf>[number]): ServiceZone {
  return { id: row.id, name: normalizedZone(row.data.name), code: text(row.data.code, 40).toUpperCase(), active: row.data.active !== false, pickupWindow: text(row.data.pickup_window, 40), deliveryWindow: text(row.data.delivery_window, 40), notes: text(row.data.notes, 500) };
}
export function listServiceZoneMaster(tenant: string, includeInactive = false) {
  return store.rowsOf(tenant, 'laundry_service_zone').map(presentServiceZone).filter((zone) => includeInactive || zone.active).sort((a, b) => a.name.localeCompare(b.name));
}
function assertZoneIdentityAvailable(tenant: string, name: string, code: string, excludeId?: string) {
  const key = name.toLocaleLowerCase();
  if (listServiceZoneMaster(tenant, true).some((zone) => zone.id !== excludeId && zone.name.toLocaleLowerCase() === key)) throw new Error('service zone name already exists');
  if (code && listServiceZoneMaster(tenant, true).some((zone) => zone.id !== excludeId && zone.code.toLocaleLowerCase() === code.toLocaleLowerCase())) throw new Error('service zone code already exists');
}
export function createServiceZone(tenant: string, actor: string, input: { name?: string; code?: string; active?: boolean; pickupWindow?: string; deliveryWindow?: string; notes?: string }) {
  const name = normalizedZone(input.name); if (name.length < 2) throw new Error('service zone name is required');
  const code = text(input.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  assertZoneIdentityAvailable(tenant, name, code);
  const row = createRow(tenant, actor, 'laundry_service_zone', { name, code, active: input.active !== false, pickup_window: text(input.pickupWindow, 40), delivery_window: text(input.deliveryWindow, 40), notes: text(input.notes, 500) });
  audit(tenant, actor, 'laundry:service-zone-created', { entity: row.entity, row_id: row.id, after: row.data });
  return presentServiceZone(row);
}
export function updateServiceZone(tenant: string, actor: string, id: string, input: { name?: string; code?: string; active?: boolean; pickupWindow?: string; deliveryWindow?: string; notes?: string }) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'laundry_service_zone') throw new Error('service zone not found');
  const before = presentServiceZone(row); const name = input.name === undefined ? before.name : normalizedZone(input.name); if (name.length < 2) throw new Error('service zone name is required');
  const code = input.code === undefined ? before.code : text(input.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  assertZoneIdentityAvailable(tenant, name, code, id);
  row.data.name = name; if (input.code !== undefined) row.data.code = code; if (input.active !== undefined) row.data.active = Boolean(input.active); if (input.pickupWindow !== undefined) row.data.pickup_window = text(input.pickupWindow, 40); if (input.deliveryWindow !== undefined) row.data.delivery_window = text(input.deliveryWindow, 40); if (input.notes !== undefined) row.data.notes = text(input.notes, 500); row.updated_at = new Date().toISOString(); store.updateRow(row);
  audit(tenant, actor, 'laundry:service-zone-updated', { entity: row.entity, row_id: id, before, after: presentServiceZone(row) });
  return presentServiceZone(row);
}

function stopsFor(tenant: string, runId: string) { return store.rowsOf(tenant, 'laundry_route_stop').filter((row) => row.data.route_run === runId).sort((a, b) => Number(a.data.sequence || 0) - Number(b.data.sequence || 0)); }

function presentRun(tenant: string, row: ReturnType<typeof store.rowsOf>[number]) {
  const rider = store.getRow(tenant, text(row.data.rider, 120));
  const routeDate = text(row.data.route_date, 20); const startTime = routeTime(row.data.route_start_time); const minutesPerStop = Math.max(1, Math.min(240, Number(row.data.minutes_per_stop || 15)));
  const stops = stopsFor(tenant, row.id).map((stop) => {
    const order = store.getRow(tenant, text(stop.data.order, 120));
    const sequence = Number(stop.data.sequence || 0);
    return { id: stop.id, sequence, orderId: text(stop.data.order, 120), orderNumber: order?.data.name || text(stop.data.order, 120), customer: text(order?.data.customer, 120), address: text(order?.data.delivery_address, 300), estimatedAt: etaFor(routeDate, startTime, minutesPerStop, sequence), status: text(stop.data.status, 20), completedAt: stop.data.completed_at || null, completedBy: stop.data.completed_by || null, note: stop.data.note || '' };
  });
  return { id: row.id, riderId: text(row.data.rider, 120), riderName: text(rider?.data.name, 160), routeDate, stage: text(row.data.stage, 20), zone: normalizedZone(row.data.service_zone), startTime, minutesPerStop, status: text(row.data.status, 20), stopCount: Number(row.data.stop_count || stops.length), startedAt: row.data.started_at || null, completedAt: row.data.completed_at || null, notes: row.data.notes || '', stops };
}

export function listRouteRuns(tenant: string, filters: { status?: string; riderId?: string; date?: string; zone?: string } = {}) {
  const zone = normalizedZone(filters.zone).toLowerCase();
  return store.rowsOf(tenant, 'laundry_route_run').filter((row) => (!filters.status || row.data.status === filters.status) && (!filters.riderId || row.data.rider === filters.riderId) && (!filters.date || row.data.route_date === filters.date) && (!zone || normalizedZone(row.data.service_zone).toLowerCase() === zone)).map((row) => presentRun(tenant, row)).sort((a, b) => `${b.routeDate}${b.id}`.localeCompare(`${a.routeDate}${a.id}`));
}

export function listServiceZones(tenant: string, riderId?: string) {
  const zones = new Map<string, string>();
  const master = listServiceZoneMaster(tenant);
  const orders = store.rowsOf(tenant, 'laundry_order').filter((row) => !riderId || row.data.pickup_rider === riderId || row.data.delivery_rider === riderId);
  const runs = store.rowsOf(tenant, 'laundry_route_run').filter((row) => !riderId || row.data.rider === riderId);
  if (!riderId) for (const zone of master) zones.set(zone.name.toLowerCase(), zone.name);
  for (const row of [...orders, ...runs]) {
    const zone = normalizedZone(row.data.service_zone);
    if (zone && !zones.has(zone.toLowerCase())) zones.set(zone.toLowerCase(), zone);
  }
  return [...zones.values()].sort((a, b) => a.localeCompare(b));
}

/** Read-only route coverage metrics for dispatch planning and daily review. */
export function routeCoverageAnalytics(tenant: string, riderId?: string) {
  const orders = store.rowsOf(tenant, 'laundry_order').filter((row) => !riderId || row.data.pickup_rider === riderId || row.data.delivery_rider === riderId);
  const runs = store.rowsOf(tenant, 'laundry_route_run').filter((row) => !riderId || row.data.rider === riderId);
  const zoneMap = new Map<string, { zone: string; orders: number; pickupReady: number; deliveryReady: number; assigned: number; activeRuns: number }>();
  const zoneFor = (row: any) => normalizedZone(row.data.service_zone) || 'Unzoned';
  for (const order of orders) {
    const zone = zoneFor(order); const key = zone.toLowerCase(); const current = zoneMap.get(key) || { zone, orders: 0, pickupReady: 0, deliveryReady: 0, assigned: 0, activeRuns: 0 };
    current.orders += 1;
    if (order.data.fulfillment_mode === 'Pickup Order' && order.data.state === 'Booked') current.pickupReady += 1;
    if (order.data.fulfillment_mode !== 'Pickup Order' && ['Ready', 'Out for Delivery'].includes(String(order.data.state))) current.deliveryReady += 1;
    if ((order.data.pickup_rider || order.data.delivery_rider) && (!riderId || order.data.pickup_rider === riderId || order.data.delivery_rider === riderId)) current.assigned += 1;
    zoneMap.set(key, current);
  }
  for (const run of runs) { const zone = normalizedZone(run.data.service_zone) || 'Unzoned'; const current = zoneMap.get(zone.toLowerCase()) || { zone, orders: 0, pickupReady: 0, deliveryReady: 0, assigned: 0, activeRuns: 0 }; if (openRunStatuses.includes(String(run.data.status))) current.activeRuns += 1; zoneMap.set(zone.toLowerCase(), current); }
  const runRows = runs.map((run) => { const stops = stopsFor(tenant, run.id); const completedStops = stops.filter((stop) => ['Completed', 'Skipped'].includes(String(stop.data.status))).length; return { id: run.id, status: String(run.data.status), stage: String(run.data.stage), zone: normalizedZone(run.data.service_zone) || 'Unzoned', stopCount: stops.length, completedStops }; });
  const totalStops = runRows.reduce((sum, run) => sum + run.stopCount, 0); const completedStops = runRows.reduce((sum, run) => sum + run.completedStops, 0);
  return { asOf: new Date().toISOString(), riderId: riderId || null, totals: { orders: orders.length, zones: zoneMap.size, routes: runs.length, activeRoutes: runRows.filter((run) => openRunStatuses.includes(run.status)).length, stops: totalStops, completedStops, completionPercent: totalStops ? Math.round(completedStops / totalStops * 100) : 0 }, zones: [...zoneMap.values()].sort((a, b) => a.zone.localeCompare(b.zone)), routes: runRows.slice(0, 100) };
}

export function createRouteRun(tenant: string, actor: string, input: { riderId?: string; stage?: string; routeDate?: string; orderIds?: unknown; notes?: string; zone?: string; serviceZone?: string; startTime?: string; minutesPerStop?: number }) {
  const riderId = text(input.riderId, 120); const rider = store.getRow(tenant, riderId);
  if (!rider || rider.entity !== 'laundry_rider' || rider.data.active === false) throw new Error('active rider not found');
  const stage = text(input.stage, 20) as RouteStage;
  if (!['Pickup', 'Delivery'].includes(stage)) throw new Error('route stage must be Pickup or Delivery');
  const routeDate = text(input.routeDate || laundryBusinessDate(), 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate) || Number.isNaN(Date.parse(`${routeDate}T00:00:00`))) throw new Error('route date must be YYYY-MM-DD');
  const orderIds = [...new Set((Array.isArray(input.orderIds) ? input.orderIds : []).map((value) => text(value, 120)).filter(Boolean))];
  if (!orderIds.length) throw new Error('at least one order is required for a route');
  if (orderIds.length > 100) throw new Error('a route cannot contain more than 100 stops');
  const requestedZone = normalizedZone(input.zone ?? input.serviceZone);
  const masterZones = listServiceZoneMaster(tenant);
  const masterMatch = requestedZone ? masterZones.find((zone) => zone.name.toLowerCase() === requestedZone.toLowerCase() || (zone.code && zone.code.toLowerCase() === requestedZone.toLowerCase())) : undefined;
  if (requestedZone && masterZones.length && !masterMatch) throw new Error('route zone is not an active service-zone master');
  const startTime = routeTime(input.startTime);
  const minutesPerStop = Math.max(1, Math.min(240, Math.round(Number(input.minutesPerStop || 15))));
  const orderZones = new Set<string>();
  const existingStops = new Set(store.rowsOf(tenant, 'laundry_route_stop').filter((stop) => store.rowsOf(tenant, 'laundry_route_run').some((run) => run.id === stop.data.route_run && run.data.stage === stage && openRunStatuses.includes(String(run.data.status)))).map((stop) => String(stop.data.order)));
  for (const orderId of orderIds) {
    const order = store.getRow(tenant, orderId);
    if (!order || order.entity !== 'laundry_order') throw new Error(`order ${orderId} not found`);
    const riderField = stage === 'Pickup' ? 'pickup_rider' : 'delivery_rider';
    const eligible = stage === 'Pickup' ? order.data.fulfillment_mode === 'Pickup Order' && order.data.state === 'Booked' : order.data.fulfillment_mode !== 'Pickup Order' && ['Ready', 'Out for Delivery'].includes(String(order.data.state));
    if (!eligible || order.data[riderField] !== riderId) throw new Error(`${order.data.name || orderId} is not eligible for this ${stage.toLowerCase()} route and rider`);
    if (existingStops.has(orderId)) throw new Error(`${order.data.name || orderId} is already on an active ${stage.toLowerCase()} route`);
    const zone = normalizedZone(order.data.service_zone);
    if (zone) orderZones.add(zone);
  }
  if (orderZones.size > 1) throw new Error('route stops must belong to one service zone');
  const serviceZone = masterMatch?.name || requestedZone || [...orderZones][0] || '';
  if (serviceZone && [...orderZones].some((zone) => zone.toLowerCase() !== serviceZone.toLowerCase())) throw new Error('route zone does not match one or more selected orders');
  const run = createRow(tenant, actor, 'laundry_route_run', { rider: riderId, route_date: routeDate, stage, service_zone: serviceZone, route_start_time: startTime, minutes_per_stop: minutesPerStop, status: 'Planned', stop_count: orderIds.length, notes: text(input.notes, 500) });
  orderIds.forEach((orderId, index) => createRow(tenant, actor, 'laundry_route_stop', { route_run: run.id, order: orderId, sequence: index + 1, status: 'Planned', service_zone: serviceZone }));
  audit(tenant, actor, 'laundry:route-created', { entity: run.entity, row_id: run.id, after: { riderId, stage, routeDate, serviceZone, startTime, minutesPerStop, orderIds } });
  return presentRun(tenant, run);
}

export function startRouteRun(tenant: string, actor: string, id: string, assignedRiderId?: string) {
  const run = store.getRow(tenant, id);
  if (!run || run.entity !== 'laundry_route_run') throw new Error('route run not found');
  if (assignedRiderId && run.data.rider !== assignedRiderId) throw new Error('rider can only start their assigned route');
  if (run.data.status !== 'Planned') throw new Error('only planned routes can be started');
  const now = new Date().toISOString();
  if (run.data.stage === 'Delivery') for (const stop of stopsFor(tenant, id)) {
    const order = store.getRow(tenant, text(stop.data.order, 120));
    if (order?.data.state === 'Ready') transitionLaundryOrder(tenant, actor, order.id, 'Out for Delivery', `Route ${run.data.name || id} started`);
  }
  run.data.status = 'In Progress'; run.data.started_at = now; run.updated_at = now; store.updateRow(run);
  audit(tenant, actor, 'laundry:route-started', { entity: run.entity, row_id: id, after: { startedAt: now, stage: run.data.stage } });
  return presentRun(tenant, run);
}

export function completeRouteStop(tenant: string, actor: string, runId: string, stopId: string, input: { status?: string; note?: string }, assignedRiderId?: string) {
  const run = store.getRow(tenant, runId); const stop = store.getRow(tenant, stopId);
  if (!run || run.entity !== 'laundry_route_run' || !stop || stop.entity !== 'laundry_route_stop' || stop.data.route_run !== runId) throw new Error('route stop not found');
  if (assignedRiderId && run.data.rider !== assignedRiderId) throw new Error('rider can only complete stops on their assigned route');
  if (run.data.status !== 'In Progress') throw new Error('start the route before completing stops');
  if (stop.data.status !== 'Planned') throw new Error('route stop is already closed');
  const status = text(input.status || 'Completed', 20);
  if (!['Completed', 'Skipped'].includes(status)) throw new Error('stop status must be Completed or Skipped');
  const note = text(input.note, 500);
  if (status === 'Skipped' && note.length < 3) throw new Error('a reason is required when skipping a stop');
  const order = store.getRow(tenant, text(stop.data.order, 120));
  if (!order || order.entity !== 'laundry_order') throw new Error('route stop order not found');
  if (status === 'Completed') {
    if (run.data.stage === 'Pickup' && order.data.state === 'Booked') transitionLaundryOrder(tenant, actor, order.id, 'Picked Up', note || `Picked up on route ${run.data.name || runId}`);
    if (run.data.stage === 'Delivery') {
      if (order.data.state === 'Ready') transitionLaundryOrder(tenant, actor, order.id, 'Out for Delivery', note || `Dispatched on route ${run.data.name || runId}`);
      if (order.data.state === 'Out for Delivery') transitionLaundryOrder(tenant, actor, order.id, 'Delivered', note || `Delivered on route ${run.data.name || runId}`);
    }
  }
  const now = new Date().toISOString(); stop.data.status = status; stop.data.completed_at = now; stop.data.completed_by = actor; stop.data.note = note; stop.updated_at = now; store.updateRow(stop);
  const allClosed = stopsFor(tenant, runId).every((candidate) => ['Completed', 'Skipped'].includes(String(candidate.data.status)));
  if (allClosed) { run.data.status = 'Completed'; run.data.completed_at = now; run.updated_at = now; store.updateRow(run); }
  audit(tenant, actor, 'laundry:route-stop-completed', { entity: stop.entity, row_id: stop.id, after: { runId, status, note, orderId: order.id, routeStatus: run.data.status } });
  return presentRun(tenant, run);
}
