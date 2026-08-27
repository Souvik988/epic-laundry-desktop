import { randomUUID } from 'node:crypto';
import { store } from './store.js';
import { audit } from './audit.js';
import { runPosting } from './posting.js';
import { publish } from './event-bus.js';
import { ENTITIES } from '../metadata/entities.js';
import type { EntityDef, EntityRow } from './types.js';

const DEFS = new Map<string, EntityDef>(ENTITIES.map((e) => [e.name, e]));

export function getDef(name: string) { return DEFS.get(name); }
export function listDefs() { return ENTITIES; }

function genName(series: string): string {
  const n = store.nextSeq(series);
  const fy = String(new Date().getFullYear() % 100).padStart(2, '0');
  return series.replace('{FY}', fy).replace('{#####}', String(n).padStart(5, '0'));
}

function validate(def: EntityDef, data: Record<string, any>): string[] {
  const errs: string[] = [];
  for (const f of def.fields) {
    if (f.required && !f.computed && data[f.name] === undefined && data[f.name] === null) {
      errs.push(`'${f.name}' is required`);
    }
    if (f.required && (data[f.name] === '' || data[f.name] === undefined)) {
      errs.push(`'${f.name}' is required`);
    }
  }
  return errs;
}

export function createRow(tenant: string, actor: string, entity: string, input: Record<string, any>) {
  const def = DEFS.get(entity);
  if (!def) throw new Error(`unknown entity: ${entity}`);
  const errs = validate(def, input);
  if (errs.length) throw new Error('validation: ' + errs.join('; '));

  const name = def.naming ? genName(def.naming.series) : randomUUID().slice(0, 8);
  const row: EntityRow = {
    id: name,
    entity,
    tenant,
    status: def.kind === 'document' ? 'Draft' : 'Active',
    data: { ...input, name: input.name || name },
    version: 1,
    created_by: actor,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (def.lifecycle?.submit) row.data.__posting = def.posting;
  store.insertRow(row);
  audit(tenant, actor, `create:${entity}`, { entity, row_id: row.id, after: row.data });
  return row;
}

export function getRow(tenant: string, entity: string, id: string) {
  const r = store.getRow(tenant, id);
  if (!r || r.entity !== entity) throw new Error('not found');
  return r;
}

export function listRows(tenant: string, entity: string) {
  return store.rowsOf(tenant, entity);
}

export function submitRow(tenant: string, actor: string, entity: string, id: string) {
  const def = DEFS.get(entity);
  if (!def?.lifecycle?.submit) throw new Error(`${entity} is not submittable`);
  const row = store.getRow(tenant, id);
  if (!row) throw new Error('not found');
  if (row.status === 'Submitted') throw new Error('already submitted');

  const errs = validate(def, row.data);
  if (errs.length) throw new Error('validation: ' + errs.join('; '));

  runPosting(tenant, row, 1);
  row.status = 'Submitted';
  row.updated_at = new Date().toISOString();
  store.updateRow(row);
  audit(tenant, actor, `submit:${entity}`, { entity, row_id: row.id, after: row.data });
  publish(tenant, `${entity}.submitted.v1`, {
    id: row.id,
    name: row.data.name,
    customer: row.data.customer,
    grand_total: row.data.grand_total,
    posting_date: row.data.posting_date,
    suppress_notifications: Boolean(row.data.suppress_notifications),
  });
  return row;
}

export function cancelRow(tenant: string, actor: string, entity: string, id: string) {
  const def = DEFS.get(entity);
  if (!def?.lifecycle?.cancel) throw new Error(`${entity} is not cancellable`);
  const row = store.getRow(tenant, id);
  if (!row) throw new Error('not found');
  if (row.status !== 'Submitted') throw new Error('only submitted documents can be cancelled');

  runPosting(tenant, row, -1); // reversal entries
  row.status = 'Cancelled';
  row.updated_at = new Date().toISOString();
  store.updateRow(row);
  audit(tenant, actor, `cancel:${entity}`, { entity, row_id: row.id });
  publish(tenant, `${entity}.cancelled.v1`, { id: row.id, name: row.data.name });
  return row;
}
