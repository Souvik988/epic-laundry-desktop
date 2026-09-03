import { randomUUID } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { moneyNumber } from '../../kernel/money.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';

export type FinancePlanningTarget = {
  id: string;
  periodStart: string;
  periodEnd: string;
  revenuePaise?: number;
  expensePaise?: number;
  ebitdaPaise?: number;
  collectionPaise?: number;
  marginBps?: number;
  payrollPaise?: number;
  note: string;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

type TargetInput = Omit<FinancePlanningTarget, 'id' | 'note' | 'policyVersion' | 'createdAt' | 'updatedAt' | 'updatedBy'> & { note?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rowData = (row: EntityRow) => row.data as Record<string, unknown>;
const targetRows = (tenant: string) => store.rowsOf(tenant, 'finance_planning_target');
const date = (value: unknown, label: string) => { const result = String(value || ''); if (!DATE.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new Error(`${label} is invalid`); return result; };
const paise = (value: unknown, label: string) => { if (value === undefined || value === null || value === '') return undefined; const result = typeof value === 'number' ? value : Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} must be a non-negative integer paise amount`); return result; };
const margin = (value: unknown) => { if (value === undefined || value === null || value === '') return undefined; const result = typeof value === 'number' ? value : Number(value); if (!Number.isInteger(result) || result < 0 || result > 10_000) throw new Error('margin target must be between 0 and 10000 basis points'); return result; };

function present(row: EntityRow): FinancePlanningTarget {
  const data = rowData(row);
  return { id: row.id, periodStart: String(data.periodStart), periodEnd: String(data.periodEnd), revenuePaise: data.revenuePaise === undefined ? undefined : Number(data.revenuePaise), expensePaise: data.expensePaise === undefined ? undefined : Number(data.expensePaise), ebitdaPaise: data.ebitdaPaise === undefined ? undefined : Number(data.ebitdaPaise), collectionPaise: data.collectionPaise === undefined ? undefined : Number(data.collectionPaise), marginBps: data.marginBps === undefined ? undefined : Number(data.marginBps), payrollPaise: data.payrollPaise === undefined ? undefined : Number(data.payrollPaise), note: String(data.note || ''), policyVersion: String(data.policyVersion || 'MANAGEMENT-TARGETS-2026.1'), createdAt: String(data.createdAt || row.created_at), updatedAt: String(data.updatedAt || row.updated_at), updatedBy: String(data.updatedBy || row.created_by) };
}

export function listFinancePlanningTargets(tenant: string) { return targetRows(tenant).map(present).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.updatedAt.localeCompare(a.updatedAt)); }

export function saveFinancePlanningTarget(tenant: string, actor: string, input: TargetInput) {
  const periodStart = date(input.periodStart, 'period start'); const periodEnd = date(input.periodEnd, 'period end'); if (periodStart > periodEnd) throw new Error('FINANCE_TARGET_PERIOD_INVALID');
  const fields = { revenuePaise: paise(input.revenuePaise, 'revenue target'), expensePaise: paise(input.expensePaise, 'expense target'), ebitdaPaise: paise(input.ebitdaPaise, 'EBITDA target'), collectionPaise: paise(input.collectionPaise, 'collection target'), marginBps: margin(input.marginBps), payrollPaise: paise(input.payrollPaise, 'payroll target') };
  if (!Object.values(fields).some((value) => value !== undefined)) throw new Error('FINANCE_TARGET_EMPTY');
  const existing = targetRows(tenant).find((row) => rowData(row).periodStart === periodStart && rowData(row).periodEnd === periodEnd);
  const now = new Date().toISOString(); const id = existing?.id || `finance_target_${store.currentStore(tenant)}_${periodStart}_${periodEnd}`; const record: FinancePlanningTarget = { id, periodStart, periodEnd, ...fields, note: String(input.note || '').trim().slice(0, 500), policyVersion: 'MANAGEMENT-TARGETS-2026.1', createdAt: existing ? String(rowData(existing).createdAt || existing.created_at) : now, updatedAt: now, updatedBy: actor };
  const row: EntityRow = existing ? { ...existing, version: existing.version + 1, updated_at: now, data: record } : { id, entity: 'finance_planning_target', tenant, status: 'Active', version: 1, created_by: actor, created_at: now, updated_at: now, data: record };
  if (existing) store.updateRow(row); else store.insertRow(row);
  audit(tenant, actor, existing ? 'finance:planning-target-updated' : 'finance:planning-target-created', { entity: row.entity, row_id: row.id, after: { periodStart, periodEnd, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === undefined ? undefined : '[configured]'])) } });
  return record;
}

export function planningForRange(tenant: string, periodStart: string, periodEnd: string) {
  const targets = listFinancePlanningTargets(tenant); return targets.find((target) => target.periodStart === periodStart && target.periodEnd === periodEnd) || targets.find((target) => target.periodStart <= periodStart && target.periodEnd >= periodEnd);
}

export function actualVsTarget(tenant: string, range: { from: string; to: string }, current: { kpis: { netRevenuePaise: number; expensesPaise: number; collectedPaise: number; ebitdaPaise: number | null; ebitdaMarginPercent: number | null } }) {
  const target = planningForRange(tenant, range.from, range.to);
  if (!target) return { state: 'NOT_CONFIGURED' as const, period: range, target: null, metrics: [] };
  const metrics = [
    { key: 'revenue', label: 'Net revenue', actualPaise: current.kpis.netRevenuePaise, targetPaise: target.revenuePaise },
    { key: 'collection', label: 'Cash collected', actualPaise: current.kpis.collectedPaise, targetPaise: target.collectionPaise },
    { key: 'expenses', label: 'Total expenses', actualPaise: current.kpis.expensesPaise, targetPaise: target.expensePaise, inverse: true },
    { key: 'ebitda', label: 'EBITDA', actualPaise: current.kpis.ebitdaPaise, targetPaise: target.ebitdaPaise },
    { key: 'margin', label: 'EBITDA margin', actualBps: current.kpis.ebitdaMarginPercent === null ? null : Math.round(current.kpis.ebitdaMarginPercent * 100), targetBps: target.marginBps },
  ].filter((item) => item.targetPaise !== undefined || item.targetBps !== undefined).map((item) => {
    const actual = 'actualBps' in item ? item.actualBps : item.actualPaise;
    const targetValue = 'targetBps' in item ? item.targetBps : item.targetPaise;
    const variance = actual === null || actual === undefined || targetValue === undefined ? null : actual - targetValue;
    const attainment = actual === null || actual === undefined || !targetValue ? null : Math.round(actual * 10_000 / targetValue) / 100;
    const actualNumber = actual === null || actual === undefined ? null : actual; const targetNumber = targetValue === undefined ? null : targetValue;
    return { ...item, actual, target: targetValue, variance, attainment, actualValue: actualNumber === null ? null : 'actualBps' in item ? actualNumber / 100 : moneyNumber(actualNumber), targetValue: targetNumber === null ? null : 'targetBps' in item ? targetNumber / 100 : moneyNumber(targetNumber), varianceValue: variance === null ? null : 'targetBps' in item ? variance / 100 : moneyNumber(variance) };
  });
  return { state: 'CONFIGURED' as const, period: range, target, metrics };
}
