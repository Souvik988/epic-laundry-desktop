import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EntityRow, GLEntry, AuditEntry, OutboxEvent, StockLedgerEntry, ImsAction } from './types.js';

export interface DbShape {
  rows: EntityRow[];
  gl: GLEntry[];
  audit: AuditEntry[];
  outbox: OutboxEvent[];
  stock: StockLedgerEntry[];
  ims: ImsAction[];
  seq: Record<string, number>; // naming series counters
}

const FILE = process.env.EPIC_DATA_FILE || './data/epic.json';

function blank(): DbShape {
  return { rows: [], gl: [], audit: [], outbox: [], stock: [], ims: [], seq: {} };
}

function load(): DbShape {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as DbShape;
  } catch (e) {
    console.error('[store] failed to load, starting blank:', (e as Error).message);
  }
  return blank();
}

export class Store {
  private db: DbShape = blank();

  constructor() {
    this.db = load();
  }

  private persist() {
    try {
      // dirname is platform-aware. Electron supplies an absolute Windows path in production,
      // while tests and Linux builds may use forward slashes.
      const dir = dirname(FILE);
      if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(FILE, JSON.stringify(this.db, null, 2));
    } catch (e) {
      console.error('[store] persist failed:', (e as Error).message);
    }
  }

  all(): DbShape { return this.db; }

  nextSeq(series: string): number {
    const n = (this.db.seq[series] || 0) + 1;
    this.db.seq[series] = n;
    this.persist();
    return n;
  }

  insertRow(r: EntityRow) { this.db.rows.push(r); this.persist(); }
  updateRow(r: EntityRow) {
    const i = this.db.rows.findIndex((x) => x.id === r.id && x.tenant === r.tenant);
    if (i >= 0) this.db.rows[i] = r; else this.db.rows.push(r);
    this.persist();
  }
  getRow(tenant: string, id: string) { return this.db.rows.find((r) => r.tenant === tenant && r.id === id); }
  rowsOf(tenant: string, entity: string) { return this.db.rows.filter((r) => r.tenant === tenant && r.entity === entity); }

  appendGL(e: GLEntry) { this.db.gl.push(e); this.persist(); }
  glOf(tenant: string) { return this.db.gl.filter((g) => g.tenant === tenant); }

  appendAudit(e: AuditEntry) { this.db.audit.push(e); this.persist(); }
  auditOf(tenant: string) { return this.db.audit.filter((a) => a.tenant === tenant); }

  appendOutbox(e: OutboxEvent) { this.db.outbox.push(e); this.persist(); }
  outboxUnpublished(tenant: string) { return this.db.outbox.filter((o) => o.tenant === tenant && !o.published); }
  markPublished(id: string) {
    const o = this.db.outbox.find((x) => x.id === id);
    if (o) { o.published = true; this.persist(); }
  }

  appendStock(e: StockLedgerEntry) { (this.db.stock ||= []).push(e); this.persist(); }
  stockOf(tenant: string) { return (this.db.stock || []).filter((s) => s.tenant === tenant); }
  appendIms(a: ImsAction) { (this.db.ims ||= []).push(a); this.persist(); }
  imsOf(tenant: string) { return (this.db.ims || []).filter((a) => a.tenant === tenant); }

  // Full-tenant snapshot (for backup / migration) and replace (for restore).
  snapshot(): DbShape {
    return JSON.parse(JSON.stringify({ ...this.db, ims: this.db.ims || [], stock: this.db.stock || [] }));
  }
  replaceAll(db: DbShape) {
    this.db = {
      rows: db.rows || [],
      gl: db.gl || [],
      audit: db.audit || [],
      outbox: db.outbox || [],
      stock: db.stock || [],
      ims: db.ims || [],
      seq: db.seq || {},
    };
    this.persist();
  }
}

export const store = new Store();
