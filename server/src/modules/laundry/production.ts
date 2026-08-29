import { randomUUID } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { DEFAULT_STATION_CAPACITIES, store } from '../../kernel/store.js';
import { laundryBusinessDate } from './dates.js';

export type ProductionTaskStatus = 'Open' | 'In Progress' | 'Completed' | 'Blocked' | 'Cancelled';
const terminalStates = new Set(['Delivered', 'Cancelled']);
const stationForState: Record<string, string> = { Intake: 'Intake', Sorted: 'Sorting', Processing: 'Processing', QC: 'Quality control', Rewash: 'Rewash', Assembly: 'Assembly', Racked: 'Rack', Dispatched: 'Dispatch' };

export function createProductionTask(tenant: string, actor: string, unitId: string, orderId: string, state: string, reason = '') {
  const station = stationForState[state];
  if (!station) return undefined;
  const task = createRow(tenant, actor, 'laundry_production_task', { garment_unit: unitId, order: orderId, station, kind: state, status: 'Open', priority: ['Missing', 'Damaged', 'Rewash'].includes(state) ? 'Urgent' : 'Normal', reason: reason.slice(0, 500), created_at: new Date().toISOString() });
  return task;
}

export function completeOpenTask(tenant: string, actor: string, unitId: string, nextState: string, reason = '') {
  const task = store.rowsOf(tenant, 'laundry_production_task').find((row) => row.data.garment_unit === unitId && ['Open', 'In Progress'].includes(String(row.data.status)));
  if (!task) return;
  const now = new Date().toISOString();
  task.data.status = 'Completed'; task.data.completed_at = now; task.data.completed_by = actor; task.data.output_state = nextState; task.data.completion_note = reason.slice(0, 500); task.updated_at = now; store.updateRow(task);
  audit(tenant, actor, 'laundry:production-task-completed', { entity: task.entity, row_id: task.id, after: { unitId, nextState, reason } });
}

function presentTask(tenant: string, row: ReturnType<typeof store.rowsOf>[number]) {
  const unit = store.getGarmentUnit(tenant, String(row.data.garment_unit || ''));
  const order = unit ? store.getRow(tenant, unit.orderId) : undefined;
  const garment = unit ? store.getRow(tenant, unit.garmentId) : undefined;
  const status = String(row.data.status || 'Open') as ProductionTaskStatus;
  const dueCandidate = String(order?.data.expected_delivery_date || row.data.due_date || '').trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueCandidate) ? dueCandidate : null;
  const overdue = Boolean(dueDate && !['Completed', 'Cancelled'].includes(status) && dueDate < laundryBusinessDate());
  return { id: row.id, unitId: String(row.data.garment_unit), tagCode: unit?.activeTagCode || '', orderId: String(row.data.order || unit?.orderId || ''), orderNumber: order?.data.name || unit?.orderId || '', garment: garment?.data.name || unit?.garmentId || '', station: String(row.data.station || ''), kind: String(row.data.kind || ''), status, priority: String(row.data.priority || 'Normal'), assignedTo: String(row.data.assigned_to || ''), reason: String(row.data.reason || ''), completionNote: String(row.data.completion_note || ''), createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.data.completed_at || null, dueDate, overdue };
}

export function listProductionTasks(tenant: string, filters: { status?: string; station?: string; overdue?: string } = {}) {
  return store.rowsOf(tenant, 'laundry_production_task').map((row) => presentTask(tenant, row)).filter((task) => (!filters.status || task.status === filters.status) && (!filters.station || task.station === filters.station) && (filters.overdue !== 'true' || task.overdue)).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.status === 'Completed' ? 1 : 0) - (b.status === 'Completed' ? 1 : 0) || (a.priority === 'Urgent' ? -1 : 1) - (b.priority === 'Urgent' ? -1 : 1) || b.createdAt.localeCompare(a.createdAt));
}

/** Truthful floor-load telemetry derived from durable task records. This is a
 * workload view, not a fabricated throughput/capacity promise. */
export function productionLoad(tenant: string) {
  const tasks = listProductionTasks(tenant);
  const configuredCapacity = store.getStoreSettings(tenant).stationCapacities || DEFAULT_STATION_CAPACITIES;
  const stations = new Map<string, { station: string; total: number; open: number; inProgress: number; urgent: number; overdue: number; completed: number }>();
  for (const task of tasks) {
    const point = stations.get(task.station) || { station: task.station, total: 0, open: 0, inProgress: 0, urgent: 0, overdue: 0, completed: 0 };
    point.total += 1;
    if (task.status === 'Completed') point.completed += 1;
    else point.open += 1;
    if (task.status === 'In Progress') point.inProgress += 1;
    if (task.priority === 'Urgent' && task.status !== 'Completed') point.urgent += 1;
    if (task.overdue) point.overdue += 1;
    stations.set(task.station, point);
  }
  const rows = [...stations.values()].sort((a, b) => b.open - a.open || a.station.localeCompare(b.station)).map((station) => {
    const capacity = Number.isSafeInteger(configuredCapacity[station.station]) ? configuredCapacity[station.station] : null;
    const utilizationPercent = capacity && capacity > 0 ? Math.round((station.open / capacity) * 100) : null;
    return { ...station, capacity, utilizationPercent, atCapacity: capacity !== null && capacity > 0 && station.open >= capacity };
  });
  return { generatedAt: new Date().toISOString(), totalTasks: tasks.length, openTasks: tasks.filter((task) => task.status !== 'Completed').length, urgentTasks: tasks.filter((task) => task.priority === 'Urgent' && task.status !== 'Completed').length, overdueTasks: tasks.filter((task) => task.overdue).length, stations: rows };
}

/** Deterministic, capacity-aware assignment guidance for open floor work.
 * Recommendations are advisory: only the authenticated assignment command
 * changes a task, and every assignment remains audited. Staff identities are
 * read from the active branch so another store can never receive a suggestion. */
export function productionWorkload(tenant: string) {
  const tasks = listProductionTasks(tenant).filter((task) => !['Completed', 'Cancelled'].includes(task.status));
  const identities = store.listIdentities(tenant, store.currentStore(tenant)).filter((identity) => identity.enabled && identity.roles.some((role) => ['owner', 'processing_staff'].includes(role)));
  const loads = new Map<string, { openTasks: number; urgent: number; overdue: number }>();
  for (const identity of identities) loads.set(identity.id, { openTasks: 0, urgent: 0, overdue: 0 });
  const identityForAssignment = (assignedTo: string) => identities.find((identity) => identity.id === assignedTo || identity.username === assignedTo || `${identity.firstName} ${identity.lastName}`.trim() === assignedTo);
  let unassignedOpenTasks = 0;
  let unrecognizedAssignments = 0;
  for (const task of tasks) {
    if (!task.assignedTo) { unassignedOpenTasks += 1; continue; }
    const identity = identityForAssignment(task.assignedTo);
    if (!identity) { unrecognizedAssignments += 1; continue; }
    const load = loads.get(identity.id)!; load.openTasks += 1; if (task.priority === 'Urgent') load.urgent += 1; if (task.overdue) load.overdue += 1;
  }
  const assignees = identities.map((identity) => {
    const load = loads.get(identity.id)!;
    return { id: identity.id, username: identity.username, name: `${identity.firstName} ${identity.lastName}`.trim() || identity.username, ...load };
  }).sort((a, b) => a.openTasks - b.openTasks || a.urgent - b.urgent || a.name.localeCompare(b.name));
  const recommendations = tasks.filter((task) => !task.assignedTo).slice(0, 200).map((task) => {
    const assignee = assignees[0];
    return { taskId: task.id, tagCode: task.tagCode, station: task.station, priority: task.priority, overdue: task.overdue, assignee: assignee ? { id: assignee.id, username: assignee.username, name: assignee.name } : null, rationale: assignee ? 'lowest open-task load in this branch' : 'no eligible processing operator is configured' };
  });
  return { generatedAt: new Date().toISOString(), openTasks: tasks.length, unassignedOpenTasks, unrecognizedAssignments, assignees, recommendations };
}

/**
 * Supervisor-facing operational metrics derived only from durable task
 * timestamps. Cycle time is measured from task creation to completion; tasks
 * without a valid completion timestamp are excluded from duration statistics,
 * never treated as zero. The projection is intentionally descriptive: it does
 * not promise capacity or automatically mutate work.
 */
export function productionSupervisorMetrics(tenant: string, filters: { from?: string; to?: string } = {}) {
  const validDate = (value: unknown) => {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  };
  const from = validDate(filters.from);
  const to = validDate(filters.to);
  const inRange = (task: ReturnType<typeof listProductionTasks>[number]) => {
    const date = task.createdAt.slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  };
  const tasks = listProductionTasks(tenant).filter(inRange);
  const cycleFor = (task: ReturnType<typeof listProductionTasks>[number]) => {
    if (task.status !== 'Completed' || !task.completedAt) return undefined;
    const start = Date.parse(task.createdAt);
    const end = Date.parse(task.completedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
    return Math.round((end - start) / 60000);
  };
  const cycleMinutes = tasks.map(cycleFor).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  const percentile = (values: number[], ratio: number) => values.length ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))] : null;
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const summarize = (group: ReturnType<typeof listProductionTasks>) => {
    const completed = group.filter((task) => task.status === 'Completed').length;
    const durations = group.map(cycleFor).filter((value): value is number => value !== undefined);
    return {
      total: group.length,
      completed,
      active: group.filter((task) => !['Completed', 'Cancelled'].includes(task.status)).length,
      blocked: group.filter((task) => task.status === 'Blocked').length,
      urgent: group.filter((task) => task.priority === 'Urgent' && task.status !== 'Completed').length,
      overdue: group.filter((task) => task.overdue && task.status !== 'Completed').length,
      completionRatePercent: group.length ? Math.round((completed / group.length) * 100) : 0,
      averageCycleMinutes: average(durations),
      p95CycleMinutes: percentile([...durations].sort((a, b) => a - b), 0.95),
    };
  };
  const byStation = new Map<string, ReturnType<typeof listProductionTasks>>();
  const byOperator = new Map<string, ReturnType<typeof listProductionTasks>>();
  for (const task of tasks) {
    const station = byStation.get(task.station) || [];
    station.push(task);
    byStation.set(task.station, station);
    const operator = task.assignedTo || 'Unassigned';
    const assigned = byOperator.get(operator) || [];
    assigned.push(task);
    byOperator.set(operator, assigned);
  }
  const shapeGroup = (name: string, group: ReturnType<typeof listProductionTasks>) => ({ name, ...summarize(group) });
  return {
    generatedAt: new Date().toISOString(),
    from: from || null,
    to: to || null,
    ...summarize(tasks),
    cycleSamples: cycleMinutes.length,
    averageCycleMinutes: average(cycleMinutes),
    p50CycleMinutes: percentile(cycleMinutes, 0.5),
    p95CycleMinutes: percentile(cycleMinutes, 0.95),
    stations: [...byStation.entries()].map(([name, group]) => shapeGroup(name, group)).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)),
    operators: [...byOperator.entries()].map(([name, group]) => shapeGroup(name, group)).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)),
  };
}

/** Forward-looking due-date dispatch view for the branch production floor.
 * This is an operational schedule, not an invented promise of completion time:
 * it groups durable open work by the order's expected delivery date and station
 * while retaining an explicit unscheduled bucket for missing commitments. */
export function productionSchedule(tenant: string, filters: { from?: string; to?: string } = {}) {
  const validDate = (value: unknown) => {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  };
  const from = validDate(filters.from);
  const to = validDate(filters.to);
  const tasks = listProductionTasks(tenant).filter((task) => !['Completed', 'Cancelled'].includes(task.status));
  const currentLoad = productionLoad(tenant);
  // Keep undated work visible even when a date window is selected: it is the
  // most important exception for a dispatcher to resolve.
  const visibleTasks = tasks.filter((task) => {
    const date = task.dueDate || '';
    return !date || (!from || date >= from) && (!to || date <= to);
  });
  const grouped = new Map<string, ReturnType<typeof listProductionTasks>>();
  for (const task of visibleTasks) {
    const date = task.dueDate || '';
    const bucket = grouped.get(date) || [];
    bucket.push(task);
    grouped.set(date, bucket);
  }
  const days = [...grouped.entries()].sort(([a], [b]) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  }).map(([date, dayTasks]) => {
    const stations = new Map<string, ReturnType<typeof presentTask>[]>();
    for (const task of dayTasks) {
      const bucket = stations.get(task.station) || [];
      bucket.push(task);
      stations.set(task.station, bucket);
    }
    return {
      date: date || null,
      label: date || 'Unscheduled commitment',
      totalTasks: dayTasks.length,
      urgentTasks: dayTasks.filter((task) => task.priority === 'Urgent').length,
      overdueTasks: dayTasks.filter((task) => task.overdue).length,
      stations: [...stations.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([station, stationTasks]) => {
        const load = currentLoad.stations.find((item) => item.station === station);
        return {
          station,
          totalTasks: stationTasks.length,
          urgentTasks: stationTasks.filter((task) => task.priority === 'Urgent').length,
          overdueTasks: stationTasks.filter((task) => task.overdue).length,
          currentOpen: load?.open || 0,
          capacityTarget: load?.capacity ?? null,
          atCapacity: load?.atCapacity || false,
          tasks: stationTasks.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.priority === 'Urgent' ? -1 : 1) - (b.priority === 'Urgent' ? -1 : 1) || a.createdAt.localeCompare(b.createdAt)),
        };
      }),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    from: from || null,
    to: to || null,
    totalTasks: visibleTasks.length,
    scheduledTasks: visibleTasks.filter((task) => Boolean(task.dueDate)).length,
    unscheduledTasks: visibleTasks.filter((task) => !task.dueDate).length,
    days,
  };
}

/** Apply selected lowest-load recommendations. Selection is mandatory and
 * bounded so automation never silently mutates an entire queue. Each command
 * delegates to the same audited assignment handler used by the manual control. */
export function applyProductionWorkloadRecommendations(tenant: string, actor: string, taskIds: unknown) {
  const requested = [...new Set((Array.isArray(taskIds) ? taskIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!requested.length) throw new Error('select at least one production task');
  if (requested.length > 50) throw new Error('automatic assignment is limited to 50 tasks per command');
  const tasks = listProductionTasks(tenant).filter((task) => !['Completed', 'Cancelled'].includes(task.status));
  const identities = store.listIdentities(tenant, store.currentStore(tenant)).filter((identity) => identity.enabled && identity.roles.some((role) => ['owner', 'processing_staff'].includes(role)));
  const loads = new Map<string, number>();
  for (const identity of identities) loads.set(identity.id, 0);
  const identityForAssignment = (assignedTo: string) => identities.find((identity) => identity.id === assignedTo || identity.username === assignedTo || `${identity.firstName} ${identity.lastName}`.trim() === assignedTo);
  for (const task of tasks) {
    if (!task.assignedTo) continue;
    const identity = identityForAssignment(task.assignedTo);
    if (identity) loads.set(identity.id, (loads.get(identity.id) || 0) + 1);
  }
  const assigned: Array<{ taskId: string; assignedTo: string; operator: string }> = [];
  const skipped: Array<{ taskId: string; reason: string }> = [];
  for (const taskId of requested) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) { skipped.push({ taskId, reason: 'task is not open or does not belong to this branch' }); continue; }
    if (task.assignedTo) { skipped.push({ taskId, reason: 'task is already assigned' }); continue; }
    const identity = [...identities].sort((a, b) => (loads.get(a.id) || 0) - (loads.get(b.id) || 0) || a.username.localeCompare(b.username))[0];
    if (!identity) { skipped.push({ taskId, reason: 'no eligible processing operator is configured' }); continue; }
    assignProductionTask(tenant, actor, taskId, identity.id);
    loads.set(identity.id, (loads.get(identity.id) || 0) + 1);
    assigned.push({ taskId, assignedTo: identity.id, operator: `${identity.firstName} ${identity.lastName}`.trim() || identity.username });
  }
  audit(tenant, actor, 'laundry:production-workload-applied', { after: { requested: requested.length, assigned: assigned.length, skipped: skipped.length, taskIds: requested } });
  return { generatedAt: new Date().toISOString(), requested: requested.length, assigned, skipped };
}

export function assignProductionTask(tenant: string, actor: string, id: string, assignee: string) {
  const task = store.getRow(tenant, id);
  if (!task || task.entity !== 'laundry_production_task') throw new Error('production task not found');
  if (!['Open', 'In Progress'].includes(String(task.data.status))) throw new Error('completed production tasks cannot be assigned');
  const assignedTo = String(assignee || '').trim().slice(0, 160);
  if (!assignedTo) throw new Error('assignee is required');
  task.data.assigned_to = assignedTo; task.updated_at = new Date().toISOString(); store.updateRow(task);
  audit(tenant, actor, 'laundry:production-task-assigned', { entity: task.entity, row_id: id, after: { assignedTo } });
  return presentTask(tenant, task);
}

export function startProductionTask(tenant: string, actor: string, id: string) {
  const task = store.getRow(tenant, id);
  if (!task || task.entity !== 'laundry_production_task') throw new Error('production task not found');
  if (task.data.status !== 'Open') throw new Error('only open production tasks can be started');
  const now = new Date().toISOString(); task.data.status = 'In Progress'; task.data.started_at = now; task.data.started_by = actor; task.updated_at = now; store.updateRow(task);
  audit(tenant, actor, 'laundry:production-task-started', { entity: task.entity, row_id: id, after: { assignedTo: task.data.assigned_to || '', startedAt: now } });
  return presentTask(tenant, task);
}

export function productionStateCreatesTask(state: string) { return !terminalStates.has(state) && Boolean(stationForState[state]); }
