import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { LaundryReportKind } from './domain.js';

const reportKinds: LaundryReportKind[] = ['invoice', 'collection', 'order', 'consolidated-invoices', 'customer', 'customer-package', 'customer-list', 'growth', 'discount', 'expense', 'balance', 'pickup', 'rider-delivery', 'rider-collection', 'warehouse-user-work'];
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
export type SavedReportView = { id: string; name: string; kind: LaundryReportKind; from: string | null; to: string | null; search: string; owner: string; shared: boolean; active: boolean; createdAt: string; updatedAt: string };
function present(row: ReturnType<typeof store.rowsOf>[number]): SavedReportView { return { id: row.id, name: clean(row.data.view_name, 120), kind: clean(row.data.report_kind, 60) as LaundryReportKind, from: clean(row.data.from_date, 20) || null, to: clean(row.data.to_date, 20) || null, search: clean(row.data.search, 120), owner: clean(row.data.owner, 160), shared: Boolean(row.data.shared), active: row.data.active !== false, createdAt: row.created_at, updatedAt: row.updated_at }; }
export function listSavedReportViews(tenant: string, actor: string) { return store.rowsOf(tenant, 'laundry_report_saved_view').map(present).filter((view) => view.active && (view.shared || view.owner === actor)).sort((a, b) => `${a.name}:${a.kind}`.localeCompare(`${b.name}:${b.kind}`)); }
export function createSavedReportView(tenant: string, actor: string, input: { name?: string; kind?: string; from?: string; to?: string; search?: string; shared?: boolean }, canShare = false) {
  const name = clean(input.name, 120); const kind = clean(input.kind, 60) as LaundryReportKind; const from = clean(input.from, 20); const to = clean(input.to, 20); if (name.length < 2) throw new Error('saved view name is required'); if (!reportKinds.includes(kind)) throw new Error('unknown laundry report'); if (!validDate(from) || !validDate(to)) throw new Error('report dates must be YYYY-MM-DD'); if (from && to && from > to) throw new Error('report from date must not be after to date');
  if (store.rowsOf(tenant, 'laundry_report_saved_view').some((row) => row.data.owner === actor && row.data.active !== false && String(row.data.view_name).toLowerCase() === name.toLowerCase() && row.data.report_kind === kind)) throw new Error('saved view name already exists for this report');
  const shared = Boolean(input.shared) && canShare; const row = createRow(tenant, actor, 'laundry_report_saved_view', { view_name: name, report_kind: kind, from_date: from, to_date: to, search: clean(input.search, 120), owner: actor, shared, active: true });
  audit(tenant, actor, 'laundry:report-view-created', { entity: row.entity, row_id: row.id, after: { name, kind, from: from || null, to: to || null, shared } }); return present(row);
}
export function deleteSavedReportView(tenant: string, actor: string, id: string) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'laundry_report_saved_view') throw new Error('saved view not found'); const view = present(row); if (view.owner !== actor) throw new Error('only the saved view owner can delete it'); if (!view.active) return view; row.data.active = false; row.updated_at = new Date().toISOString(); store.updateRow(row); audit(tenant, actor, 'laundry:report-view-deleted', { entity: row.entity, row_id: id, before: view, after: { active: false } }); return present(row);
}
