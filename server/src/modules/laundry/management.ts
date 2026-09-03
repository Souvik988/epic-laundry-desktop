import { createRow, submitRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import { audit } from '../../kernel/audit.js';
import { getComplianceSummary } from '../compliance/returns.js';
import { laundryFinancialReconciliation } from './reconciliation.js';
import { qualityAnalytics } from './quality.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ATTENDANCE = new Set(['Present', 'Absent', 'Half Day', 'On Leave', 'Holiday']);

/** A Laundry Desk attendance command. It intentionally submits the document and
 * rejects a second daily mark, unlike the older generic draft-only endpoint. */
export function markLaundryAttendance(tenant: string, actor: string, input: Record<string, unknown>) {
  const employee = String(input.employee || '').trim();
  const date = String(input.date || '').trim();
  const status = String(input.status || '').trim();
  if (!employee || !store.getRow(tenant, employee)) throw new Error('WORKFORCE_EMPLOYEE_NOT_FOUND');
  if (!DATE.test(date)) throw new Error('WORKFORCE_DATE_INVALID');
  if (!ATTENDANCE.has(status)) throw new Error('WORKFORCE_ATTENDANCE_STATUS_INVALID');
  const existing = store.rowsOf(tenant, 'attendance').find((row) => row.data.employee === employee && row.data.date === date && row.status !== 'Cancelled');
  if (existing) {
    if (existing.data.status === status) return { duplicate: true, attendance: existing };
    throw new Error('WORKFORCE_ATTENDANCE_ALREADY_MARKED');
  }
  const row = createRow(tenant, actor, 'attendance', {
    employee, date, status, shift: String(input.shift || '').trim(),
    in_time: String(input.inTime || '').trim(), out_time: String(input.outTime || '').trim(),
    working_hours: Number(input.workingHours || 0), status_note: String(input.note || '').trim().slice(0, 500),
  });
  const attendance = submitRow(tenant, actor, 'attendance', row.id);
  audit(tenant, actor, 'laundry:workforce-attendance-marked', { entity: attendance.entity, row_id: attendance.id, after: { employee, date, status } });
  return { duplicate: false, attendance };
}

export function laundryWorkforceDashboard(tenant: string, asOf = new Date().toISOString().slice(0, 10)) {
  const employees = store.rowsOf(tenant, 'employee').filter((row) => row.data.is_active !== false);
  const marks = store.rowsOf(tenant, 'attendance').filter((row) => row.data.date === asOf && row.status !== 'Cancelled');
  const byEmployee = new Map(marks.map((row) => [String(row.data.employee), row]));
  const statusCounts: Record<string, number> = { Present: 0, Absent: 0, 'Half Day': 0, 'On Leave': 0, Holiday: 0, Unmarked: 0 };
  for (const employee of employees) statusCounts[String(byEmployee.get(employee.id)?.data.status || 'Unmarked')] += 1;
  const roster = employees.map((employee) => {
    const mark = byEmployee.get(employee.id);
    return { id: employee.id, name: String(employee.data.name || employee.id), department: String(employee.data.department || 'Unassigned'), designation: String(employee.data.designation || ''), status: String(mark?.data.status || 'Unmarked'), shift: String(mark?.data.shift || ''), inTime: String(mark?.data.in_time || ''), outTime: String(mark?.data.out_time || ''), workingHours: Number(mark?.data.working_hours || 0) };
  });
  return { asOf, activeEmployees: employees.length, marked: marks.length, statusCounts, roster };
}

/** Finance control room uses canonical store facts. EBITDA is deliberately
 * withheld until payroll/direct-cost/overhead classifications are configured. */
export function laundryManagementSnapshot(tenant: string) {
  const reconciliation = laundryFinancialReconciliation(tenant);
  const compliance = getComplianceSummary(tenant);
  const quality = qualityAnalytics(tenant);
  const activeEmployees = store.rowsOf(tenant, 'employee').filter((row) => row.data.is_active !== false).length;
  const policyRows = store.rowsOf(tenant, 'laundry_withholding_policy').filter((row) => row.status !== 'Cancelled');
  return {
    generatedAt: new Date().toISOString(),
    financial: reconciliation.totals,
    reconciliation: { status: reconciliation.status, issueCount: reconciliation.checks.issueCount, journalsBalanced: reconciliation.journals.balanced },
    quality, workforce: { activeEmployees },
    ebitda: { state: 'NOT_READY', value: null, reason: 'Classify direct laundry cost, payroll cost, overhead and non-cash adjustments before EBITDA can be calculated.' },
    withholding: { state: policyRows.length ? 'POLICY_REQUIRES_CA_APPROVAL' : 'NOT_CONFIGURED', policyCount: policyRows.length, ledgerBalances: { tdsPayable: compliance.tds_payable, tcsPayable: compliance.tcs_payable }, note: 'TDS/TCS balances are only posted-ledger balances. Rates, thresholds, filing and remittance are never inferred.' },
  };
}
