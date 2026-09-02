import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import { laundryReportDetail, laundryReportDetailStream, type LaundryReportKind } from './domain.js';

type ExportStatus = 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Expired';
type ExportInput = { kind?: string; from?: string; to?: string; search?: string };
const reportKinds: LaundryReportKind[] = ['invoice', 'collection', 'order', 'consolidated-invoices', 'customer', 'customer-package', 'customer-list', 'growth', 'discount', 'expense', 'balance', 'pickup', 'rider-delivery', 'rider-collection', 'warehouse-user-work'];
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
const exportDirectory = () => { const configured = clean(process.env.EPIC_REPORT_EXPORT_DIR, 500); return configured || join(dirname(process.env.EPIC_DB_FILE || join(process.cwd(), 'epic.sqlite')), 'report-exports'); };
const fileNameFor = (id: string) => `laundry-report-${id}.csv`;

function present(row: ReturnType<typeof store.rowsOf>[number]) {
  return { id: row.id, kind: clean(row.data.report_kind, 60), from: clean(row.data.from_date, 20) || null, to: clean(row.data.to_date, 20) || null, search: clean(row.data.search, 120), status: clean(row.data.status, 20) as ExportStatus, executor: clean(row.data.executor, 40) || null, requestedBy: clean(row.data.requested_by, 160), requestedAt: clean(row.data.requested_at, 40), startedAt: clean(row.data.started_at, 40) || null, completedAt: clean(row.data.completed_at, 40) || null, totalRows: Number(row.data.total_rows || 0), fileName: clean(row.data.file_name, 160) || null, error: clean(row.data.error, 500) || null, expiresAt: clean(row.data.expires_at, 40) || null };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
/**
 * Write the CSV in bounded batches so a large export does not create a second
 * full-size string in memory. Row-oriented exports may provide a SQLite cursor
 * iterator; aggregate reports provide an already-materialized bounded result.
 * The file boundary is flushed synchronously in the worker thread for
 * deterministic completion/error handling.
 */
function writeCsvFile(filePath: string, columns: string[], rows: Iterable<Record<string, unknown>>) {
  const fd = openSync(filePath, 'w');
  let count = 0;
  try {
    writeSync(fd, `\uFEFF${columns.map(csvCell).join(',')}\r\n`, undefined, 'utf8');
    const batchSize = 256;
    let batch: string[] = [];
    const flush = () => { if (!batch.length) return; writeSync(fd, `${batch.join('\r\n')}\r\n`, undefined, 'utf8'); batch = []; };
    for (const row of rows) {
      batch.push(columns.map((column) => csvCell(row[column])).join(',')); count += 1;
      if (batch.length >= batchSize) flush();
    }
    flush();
  } finally {
    closeSync(fd);
  }
  return count;
}
function update(tenant: string, id: string, mutate: (row: ReturnType<typeof store.rowsOf>[number]) => void) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'laundry_report_export_job') return undefined;
  mutate(row); row.updated_at = new Date().toISOString(); store.updateRow(row); return present(row);
}

function runExport(tenant: string, storeId: string, id: string) {
  store.withStoreScope(tenant, storeId, () => {
    const running = update(tenant, id, (row) => { row.data.status = 'Running'; row.data.executor = 'worker_thread'; row.data.started_at = new Date().toISOString(); row.data.error = ''; });
    if (!running) return;
    try {
      const job = store.getRow(tenant, id); if (!job) throw new Error('export job not found');
      const from = clean(job.data.from_date, 20) || undefined; const to = clean(job.data.to_date, 20) || undefined; const search = clean(job.data.search, 120) || undefined;
      const stream = laundryReportDetailStream(tenant, job.data.report_kind as LaundryReportKind, from, to, search);
      const result = stream ? { columns: stream.columns, rows: stream.rows, totalRows: undefined } : laundryReportDetail(tenant, job.data.report_kind as LaundryReportKind, from, to, search, 1, 500, undefined, true);
      const fileName = fileNameFor(id); const directory = exportDirectory(); mkdirSync(directory, { recursive: true }); const writtenRows = writeCsvFile(join(directory, fileName), result.columns, result.rows);
      const totalRows = stream ? writtenRows : result.totalRows;
      update(tenant, id, (row) => { row.data.status = 'Completed'; row.data.completed_at = new Date().toISOString(); row.data.total_rows = totalRows; row.data.file_name = fileName; row.data.expires_at = new Date(Date.now() + 7 * 86400000).toISOString(); row.data.executor = stream ? 'worker_thread_cursor' : 'worker_thread'; row.data.error = ''; });
      audit(tenant, clean(job.data.requested_by, 160), 'laundry:report-export-completed', { entity: job.entity, row_id: id, after: { kind: job.data.report_kind, totalRows, fileName, executor: stream ? 'worker_thread_cursor' : 'worker_thread' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'report export failed';
      update(tenant, id, (row) => { row.data.status = 'Failed'; row.data.completed_at = new Date().toISOString(); row.data.error = message.slice(0, 500); });
      audit(tenant, clean(store.getRow(tenant, id)?.data.requested_by, 160), 'laundry:report-export-failed', { entity: 'laundry_report_export_job', row_id: id, after: { error: message.slice(0, 500) } });
    }
  });
}

function markWorkerFailure(tenant: string, storeId: string, id: string, message: string) {
  store.withStoreScope(tenant, storeId, () => {
    const row = store.getRow(tenant, id); if (!row || row.entity !== 'laundry_report_export_job') return;
    row.data.status = 'Failed'; row.data.completed_at = new Date().toISOString(); row.data.error = message.slice(0, 500); row.updated_at = new Date().toISOString(); store.updateRow(row);
    audit(tenant, clean(row.data.requested_by, 160), 'laundry:report-export-failed', { entity: row.entity, row_id: id, after: { error: message.slice(0, 500), executor: 'worker_thread' } });
  });
}

function launchWorker(tenant: string, storeId: string, id: string) {
  try {
    const builtWorker = new URL('./report-export-worker.js', import.meta.url);
    const sourceWorker = new URL('./report-export-worker.ts', import.meta.url);
    const workerUrl = existsSync(fileURLToPath(builtWorker)) ? builtWorker : sourceWorker;
    const worker = new Worker(workerUrl, { workerData: { tenant, storeId, id, databaseFile: process.env.EPIC_DB_FILE || '' }, execArgv: process.execArgv });
    worker.once('error', (error) => markWorkerFailure(tenant, storeId, id, error instanceof Error ? error.message : 'report export worker failed'));
    worker.once('exit', (code) => { if (code !== 0) markWorkerFailure(tenant, storeId, id, `report export worker exited with code ${code}`); });
    worker.unref();
  } catch (error) {
    markWorkerFailure(tenant, storeId, id, error instanceof Error ? error.message : 'report export worker could not start');
  }
}

/** Worker entrypoint; kept exported so the worker has no privileged API surface. */
export function runExportInWorker(tenant: string, storeId: string, id: string) { runExport(tenant, storeId, id); }

export function createLaundryReportExportJob(tenant: string, actor: string, input: ExportInput) {
  const kind = clean(input.kind, 60) as LaundryReportKind; if (!reportKinds.includes(kind)) throw new Error('unknown laundry report');
  const from = clean(input.from, 20); const to = clean(input.to, 20); if (!validDate(from) || !validDate(to)) throw new Error('report dates must be YYYY-MM-DD'); if (from && to && from > to) throw new Error('report from date must not be after to date');
  const row = createRow(tenant, actor, 'laundry_report_export_job', { report_kind: kind, from_date: from, to_date: to, search: clean(input.search, 120), status: 'Queued', executor: '', requested_by: actor, requested_at: new Date().toISOString(), total_rows: 0, file_name: '', error: '', expires_at: '' });
  const storeId = store.currentStore(tenant); audit(tenant, actor, 'laundry:report-export-queued', { entity: row.entity, row_id: row.id, after: { kind, from: from || null, to: to || null } });
  setImmediate(() => launchWorker(tenant, storeId, row.id));
  return present(row);
}

export function getLaundryReportExportJob(tenant: string, id: string) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'laundry_report_export_job') throw new Error('report export job not found');
  const job = present(row); if (job.status === 'Completed' && job.expiresAt && Date.parse(job.expiresAt) <= Date.now()) { update(tenant, id, (current) => { current.data.status = 'Expired'; }); return present(store.getRow(tenant, id)!); }
  return job;
}

export function readLaundryReportExport(tenant: string, id: string) {
  const job = getLaundryReportExportJob(tenant, id); if (job.status !== 'Completed' || !job.fileName) throw new Error(job.status === 'Expired' ? 'report export has expired' : 'report export is not ready');
  if (!/^[A-Za-z0-9._-]+\.csv$/.test(job.fileName)) throw new Error('invalid report export file');
  try { return { job, csv: readFileSync(join(exportDirectory(), job.fileName), 'utf8') }; } catch { update(tenant, id, (row) => { row.data.status = 'Failed'; row.data.error = 'report export file is unavailable'; }); throw new Error('report export file is unavailable'); }
}
