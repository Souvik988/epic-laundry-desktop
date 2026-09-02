// Projects & Services billing: convert unbilled timesheets into a draft sales invoice.
import { store } from '../../kernel/store.js';
import { createRow } from '../../kernel/entity-service.js';
import { supplierStateCodeForTenant } from '../gst/tax-policy.js';

function placeOfSupply(tenant: string, gstin?: string): string {
  return (gstin && gstin.length >= 2) ? gstin.slice(0, 2) : supplierStateCodeForTenant(tenant);
}

// Ensures a generic "Professional Services" item exists for time-based billing lines.
function serviceItem(tenant: string): string {
  const existing = store.rowsOf(tenant, 'item').find((i) => i.data.item_code === 'SERVICE');
  if (existing) return existing.id;
  const r = createRow(tenant, 'billing', 'item', {
    name: 'Professional Services', item_code: 'SERVICE', uom: 'HRS', rate: 0, hsn: '9983', gst_rate: 18,
  });
  return r.id;
}

export interface BillResult {
  ok: boolean;
  invoice_id?: string;
  invoice_name?: string;
  hours: number;
  amount: number;
  lines: number;
  error?: string;
}

// Bill all unbilled timesheets for a project into one draft sales invoice.
export function billProject(tenant: string, actor: string, projectId: string): BillResult {
  const project = store.getRow(tenant, projectId);
  if (!project || project.entity !== 'project') return { ok: false, hours: 0, amount: 0, lines: 0, error: 'project not found' };
  const ts = store.rowsOf(tenant, 'timesheet').filter(
    (t) => t.status === 'Submitted' && !t.data.billed && t.data.project === projectId,
  );
  if (!ts.length) return { ok: false, hours: 0, amount: 0, lines: 0, error: 'no unbilled timesheets' };

  const cust = project.data.customer ? store.getRow(tenant, project.data.customer) : undefined;
  const svc = serviceItem(tenant);
  const items: any[] = [];
  let hours = 0;
  let amount = 0;
  for (const t of ts) {
    const h = Number(t.data.hours) || 0;
    const rate = Number(t.data.billing_rate) || 0;
    const lineAmt = Math.round(h * rate * 100) / 100;
    hours += h;
    amount += lineAmt;
    items.push({ item: svc, qty: h, rate, gst_rate: 18 });
  }
  const inv = createRow(tenant, actor, 'sales_invoice', {
    customer: project.data.customer,
    posting_date: new Date().toISOString().slice(0, 10),
    place_of_supply: placeOfSupply(tenant, cust?.data?.gstin),
    items,
  });
  for (const t of ts) { t.data.billed = true; t.updated_at = new Date().toISOString(); store.updateRow(t); }
  return { ok: true, invoice_id: inv.id, invoice_name: inv.data.name, hours: Math.round(hours * 100) / 100, amount: Math.round(amount * 100) / 100, lines: items.length };
}
