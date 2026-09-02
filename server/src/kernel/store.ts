import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { parseMoney } from './money.js';
import type { AuditEntry, EntityRow, GLEntry, ImsAction, OutboxEvent, StockLedgerEntry } from './types.js';

export const ORDER_HOLD_LEASE_MINUTES = 15;

export interface DbShape {
  rows: EntityRow[];
  gl: GLEntry[];
  audit: AuditEntry[];
  outbox: OutboxEvent[];
  stock: StockLedgerEntry[];
  ims: ImsAction[];
  seq: Record<string, number>;
  garmentUnits?: GarmentUnitRecord[];
  garmentUnitEvents?: GarmentUnitEventRecord[];
  tagReprints?: TagReprintRecord[];
  tagHistory?: TagHistoryRecord[];
  printJobs?: TagPrintJobRecord[];
  laundryContainers?: LaundryContainerRecord[];
  laundryContainerEvents?: LaundryContainerEventRecord[];
  financialEntries?: FinancialEntryRecord[];
  financialDocuments?: FinancialDocumentRecord[];
  customerLedgerEntries?: CustomerLedgerRecord[];
  walletEntries?: WalletEntryRecord[];
  customerAddresses?: CustomerAddressRecord[];
  orderHolds?: LaundryOrderHoldRecord[];
  cashShiftCloses?: CashShiftCloseRecord[];
  financialNormalizationRuns?: FinancialNormalizationRun[];
  normalizedCustomers?: NormalizedCustomerRecord[];
  normalizedOrders?: NormalizedOrderRecord[];
}

export type AuthIdentity = {
  id: string;
  tenant: string;
  storeId: string;
  username: string;
  passwordHash: string;
  roles: string[];
  enabled: boolean;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  description: string;
  riderId?: string;
  createdAt: string;
};

export type AuthSession = {
  tokenHash: string;
  identityId: string;
  tenant: string;
  storeId: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
};
export type StoreSettings = {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  upiId: string;
  qrOnPrint: boolean;
  logoDataUrl: string;
  taxMode: 'none' | 'gst';
  gstin: string;
  currency: string;
  timezone: string;
  printerProfile: string;
  afterBooking: 'ask' | 'open-print-centre' | 'auto-print' | 'none';
  printerProfiles: PrinterProfileSettings[];
  tagTemplate: TagTemplateSettings;
  stationCapacities: Record<string, number>;
  setupProgress: {
    business: boolean;
    owner: boolean;
    operations: boolean;
    catalogue: boolean;
    recovery: boolean;
    updatedAt: string;
    updatedBy: string;
  };
  updatedAt: string;
  updatedBy: string;
};
export type PrinterProfileSettings = {
  id: string;
  name: string;
  kind: 'receipt' | 'tag';
  connection: 'system-dialog' | 'usb' | 'network' | 'file';
  device: string;
  paperWidthMm: number;
  paperHeightMm: number;
  orientation: 'portrait' | 'landscape';
  marginMm: number;
  dpi: number;
  copies: number;
  silentPrintEnabled: boolean;
  active: boolean;
  supportsQr: boolean;
  supportsBarcode: boolean;
  lastVerifiedAt?: string;
  verificationEvidence?: string;
};
export type TagTemplateSettings = {
  preset: 'a4-4' | 'a4-6' | 'a4-8' | 'a4-10' | 'thermal-50.8x51.4' | 'thermal-50x25' | 'custom';
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
  orientation: 'portrait' | 'landscape';
  pageSize: 'A4' | 'thermal';
  marginMm: number;
  fontScale: number;
  lineSpacing: number;
  codeFormat: 'qr' | 'code128' | 'qr+code128';
  showLogo: boolean;
  showGarment: boolean;
  showService: boolean;
  showInvoiceNumber: boolean;
  showPhone: boolean;
  showOrderDate: boolean;
  showTagCode: boolean;
  showStoreName: boolean;
  showCustomer: boolean;
  showOrder: boolean;
  showDueDate: boolean;
  showSequence: boolean;
  showNotes: boolean;
  showExpress: boolean;
  showSpecialCare: boolean;
};
export const DEFAULT_TAG_TEMPLATE: TagTemplateSettings = { preset: 'a4-6', widthMm: 96, heightMm: 84, columns: 2, rows: 3, orientation: 'portrait', pageSize: 'A4', marginMm: 8, fontScale: 1, lineSpacing: 1, codeFormat: 'qr', showLogo: true, showGarment: true, showService: true, showInvoiceNumber: false, showPhone: false, showOrderDate: false, showTagCode: true, showStoreName: true, showCustomer: true, showOrder: true, showDueDate: true, showSequence: true, showNotes: false, showExpress: true, showSpecialCare: true };
export const DEFAULT_STATION_CAPACITIES: Record<string, number> = {
  Intake: 20,
  Sorting: 20,
  Processing: 20,
  'Quality control': 12,
  Rewash: 8,
  Assembly: 16,
  Rack: 20,
  Dispatch: 12,
};
export type StoreRecord = { id: string; tenant: string; name: string; code: string; enabled: boolean; createdAt: string };
export type StoreMembership = { identityId: string; tenant: string; storeId: string; roles: string[]; createdAt: string };
export type GarmentUnitRecord = {
  id: string; tenant: string; storeId: string; code: string; orderId: string; itemIndex: number; sequence: number;
  customerId: string; garmentId: string; serviceId: string; unit: string; state: string; location: string;
  activeTagCode: string; condition: string; createdBy: string; createdAt: string; updatedAt: string;
};
export type GarmentUnitEventRecord = {
  id: string; tenant: string; storeId: string; unitId: string; event: string; fromState?: string; toState?: string;
  location?: string; actor: string; note?: string; metadata?: Record<string, unknown>; createdAt: string;
};
export type TagReprintRecord = {
  id: string; tenant: string; storeId: string; unitId: string; previousTagCode: string; newTagCode: string;
  station: string; reason: string; actor: string; createdAt: string;
};
export type TagHistoryStatus = 'Active' | 'Retired' | 'Lost' | 'Damaged' | 'Replaced';
export type TagHistoryRecord = {
  id: string; tenant: string; storeId: string; garmentUnitId: string; tagCode: string; status: TagHistoryStatus;
  issuedAt: string; issuedBy: string; retiredAt?: string; retiredBy?: string; retirementReason?: string;
  replacementTagId?: string; version: number; createdAt: string;
};
export type TagPrintJobStatus = 'Queued' | 'Rendering' | 'Printed' | 'Downloaded' | 'Failed' | 'Cancelled';
export type TagPrintJobRecord = {
  id: string; tenant: string; storeId: string; orderId: string; templateId: string; templateVersion: string;
  printerProfile: string; tagIds: string[]; documentType: string; requestedCopies: number; requestedBy: string;
  createdAt: string; status: TagPrintJobStatus; startedAt?: string; completedAt?: string; failureReason?: string;
  outputHash?: string; evidence?: string;
};
export type LaundryContainerState = 'Intake' | 'Processing' | 'Ready' | 'Dispatched' | 'Delivered' | 'Missing' | 'Damaged' | 'Cancelled';
export type LaundryContainerRecord = {
  id: string; tenant: string; storeId: string; orderId: string; customerId: string;
  sequence: number; total: number; weightKg?: number; tagCode: string; state: LaundryContainerState;
  location: string; condition: string; createdBy: string; createdAt: string; updatedAt: string; deliveredAt?: string;
};
export type LaundryContainerEventRecord = {
  id: string; tenant: string; storeId: string; containerId: string; event: string; fromState?: LaundryContainerState;
  toState?: LaundryContainerState; location?: string; actor: string; note?: string; createdAt: string;
};
export type FinancialEntryRecord = {
  id: string; tenant: string; storeId: string; kind: string; sourceEntity: string; sourceId: string;
  direction: 'IN' | 'OUT'; amountPaise: number; currency: string; occurredAt: string; actor: string; metadata?: Record<string, unknown>;
};
export type FinancialDocumentRecord = {
  id: string; tenant: string; storeId: string; documentType: string; sourceEntity: string; sourceId: string;
  amountPaise: number; currency: string; status: string; occurredAt: string; actor: string; metadata?: Record<string, unknown>;
};
export type CustomerLedgerRecord = {
  id: string; tenant: string; storeId: string; customerId: string; entryType: string;
  debitPaise: number; creditPaise: number; entryDate: string; referenceType: string; referenceId: string; reason: string; actor: string; createdAt: string;
};
export type WalletEntryRecord = {
  id: string; tenant: string; storeId: string; customerId: string; entryType: string; amountPaise: number;
  entryDate: string; referenceType: string; referenceId: string; reason: string; actor: string; createdAt: string;
};
export type CustomerAddressRecord = {
  id: string; tenant: string; storeId: string; customerId: string; label: string;
  line1: string; line2: string; city: string; state: string; postalCode: string;
  isDefault: boolean; active: boolean; createdAt: string; updatedAt: string; actor: string;
};
export type LaundryOrderHoldRecord = {
  id: string; tenant: string; storeId: string; holdCode: string; status: 'Held' | 'Resumed' | 'Cancelled';
  payload: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string;
  ownerActor?: string; ownershipUpdatedAt?: string;
  resumedBy?: string; resumedAt?: string; cancelledBy?: string; cancelledAt?: string;
};
export type CashShiftCloseRecord = {
  id: string; tenant: string; storeId: string; shiftId: string; register: string; businessDate: string;
  openingCashPaise: number; collectionsPaise: number; expensesPaise: number; refundsPaise: number;
  expectedCashPaise: number; countedCashPaise: number; variancePaise: number;
  collectionCount: number; expenseCount: number; refundCount: number;
  closedAt: string; closedBy: string; supervisorActor?: string; note: string;
};
export type FinancialNormalizationRun = {
  id: string; tenant: string; storeId: string; actor: string; status: 'certified';
  candidates: number; ledgerCandidates: number; cashCloseCandidates: number;
  documentsApplied: number; entriesApplied: number; ledgerEntriesApplied: number;
  walletEntriesApplied: number; cashCloseSnapshotsApplied: number; sourceColumnsApplied: number;
  reconciliationStatus: string; reconciliationIssueCount: number; createdAt: string;
};
export type NormalizedCustomerRecord = {
  id: string; tenant: string; storeId: string; name: string; phone: string; email: string;
  address: string; notes: string; preferredContact: string; servicePreferences: string;
  marketingConsent: boolean; sourceVersion: number; sourceUpdatedAt: string; sourceHash: string;
  createdAt: string; updatedAt: string;
};
export type NormalizedOrderItemRecord = {
  id: string; tenant: string; storeId: string; orderId: string; itemIndex: number;
  garmentId: string; serviceId: string; unit: string; quantityMilli: number;
  ratePaise: number; amountPaise: number; data: Record<string, unknown>;
};
export type NormalizedOrderRecord = {
  id: string; tenant: string; storeId: string; customerId: string; orderNumber: string;
  state: string; orderDate: string; expectedDeliveryDate: string; fulfillmentMode: string;
  grandTotalPaise: number; paymentStatus: string; data: Record<string, unknown>;
  sourceVersion: number; sourceUpdatedAt: string; sourceHash: string; createdAt: string; updatedAt: string;
  items: NormalizedOrderItemRecord[];
};
export type CompatibilityMigrationRun = {
  id: string; tenant: string; storeId: string; entity: string; status: 'running' | 'completed' | 'failed';
  cursor: number; total: number; applied: number; invalid: number; conflicts: number;
  sourceHash: string; actor: string; startedAt: string; updatedAt: string; completedAt?: string; error?: string;
};

const legacyFile = process.env.EPIC_LEGACY_JSON_FILE || process.env.EPIC_DATA_FILE || './data/epic.json';
const databaseFile = process.env.EPIC_DB_FILE
  || (extname(legacyFile).toLowerCase() === '.json' ? `${legacyFile.slice(0, -5)}.sqlite` : join(legacyFile, 'epic.sqlite'));
const empty = (): DbShape => ({ rows: [], gl: [], audit: [], outbox: [], stock: [], ims: [], seq: {} });
const encode = (value: unknown) => JSON.stringify(value);
function normalizeStationCapacities(value: unknown) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Record<string, number> = { ...DEFAULT_STATION_CAPACITIES };
  for (const [rawName, rawCapacity] of Object.entries(input)) {
    const name = String(rawName || '').trim().slice(0, 80);
    const capacity = Number(rawCapacity);
    if (!name || !Number.isSafeInteger(capacity) || capacity < 0 || capacity > 10_000) continue;
    result[name] = capacity;
  }
  return result;
}
function normalizeTagTemplate(value: unknown): TagTemplateSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const preset = ['a4-4', 'a4-6', 'a4-8', 'a4-10', 'thermal-50.8x51.4', 'thermal-50x25', 'custom'].includes(String(input.preset)) ? String(input.preset) as TagTemplateSettings['preset'] : DEFAULT_TAG_TEMPLATE.preset;
  const number = (key: keyof TagTemplateSettings, fallback: number, min: number, max: number) => { const value = Number(input[key]); return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value * 10) / 10)) : fallback; };
  const codeFormat = ['qr', 'code128', 'qr+code128'].includes(String(input.codeFormat)) ? String(input.codeFormat) as TagTemplateSettings['codeFormat'] : DEFAULT_TAG_TEMPLATE.codeFormat;
  const orientation = input.orientation === 'landscape' ? 'landscape' : 'portrait';
  const pageSize = input.pageSize === 'thermal' ? 'thermal' : 'A4';
  const boolean = (key: keyof TagTemplateSettings) => input[key] === undefined ? DEFAULT_TAG_TEMPLATE[key] as boolean : Boolean(input[key]);
  return { preset, widthMm: number('widthMm', DEFAULT_TAG_TEMPLATE.widthMm, 20, 200), heightMm: number('heightMm', DEFAULT_TAG_TEMPLATE.heightMm, 15, 280), columns: Math.round(number('columns', DEFAULT_TAG_TEMPLATE.columns, 1, 6)), rows: Math.round(number('rows', DEFAULT_TAG_TEMPLATE.rows, 1, 12)), orientation, pageSize, marginMm: number('marginMm', DEFAULT_TAG_TEMPLATE.marginMm, 0, 25), fontScale: number('fontScale', DEFAULT_TAG_TEMPLATE.fontScale, 0.7, 1.5), lineSpacing: number('lineSpacing', DEFAULT_TAG_TEMPLATE.lineSpacing, 0.8, 2), codeFormat, showLogo: boolean('showLogo'), showGarment: boolean('showGarment'), showService: boolean('showService'), showInvoiceNumber: boolean('showInvoiceNumber'), showPhone: boolean('showPhone'), showOrderDate: boolean('showOrderDate'), showTagCode: boolean('showTagCode'), showStoreName: boolean('showStoreName'), showCustomer: boolean('showCustomer'), showOrder: boolean('showOrder'), showDueDate: boolean('showDueDate'), showSequence: boolean('showSequence'), showNotes: boolean('showNotes'), showExpress: boolean('showExpress'), showSpecialCare: boolean('showSpecialCare') };
}
function normalizePrinterProfiles(value: unknown): PrinterProfileSettings[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((raw): PrinterProfileSettings | null => {
    const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const id = String(input.id || '').trim().slice(0, 80);
    const name = String(input.name || '').trim().slice(0, 120);
    if (!id || !name || seen.has(id)) return null;
    seen.add(id);
    const kind = input.kind === 'tag' ? 'tag' : 'receipt';
    const connection = ['system-dialog', 'usb', 'network', 'file'].includes(String(input.connection)) ? String(input.connection) as PrinterProfileSettings['connection'] : 'system-dialog';
    const width = Number(input.paperWidthMm); const height = Number(input.paperHeightMm); const dpi = Number(input.dpi); const margin = Number(input.marginMm); const copies = Number(input.copies);
    return { id, name, kind, connection, device: String(input.device || '').trim().slice(0, 200), paperWidthMm: Number.isFinite(width) ? Math.max(25, Math.min(300, Math.round(width * 10) / 10)) : 80, paperHeightMm: Number.isFinite(height) ? Math.max(15, Math.min(300, Math.round(height * 10) / 10)) : 80, orientation: input.orientation === 'landscape' ? 'landscape' : 'portrait', marginMm: Number.isFinite(margin) ? Math.max(0, Math.min(30, Math.round(margin * 10) / 10)) : 5, dpi: Number.isSafeInteger(dpi) ? Math.max(72, Math.min(1200, dpi)) : 203, copies: Number.isSafeInteger(copies) ? Math.max(1, Math.min(500, copies)) : 1, silentPrintEnabled: input.silentPrintEnabled === true, active: input.active !== false, supportsQr: input.supportsQr !== false, supportsBarcode: Boolean(input.supportsBarcode), lastVerifiedAt: input.lastVerifiedAt ? String(input.lastVerifiedAt).slice(0, 40) : undefined, verificationEvidence: input.verificationEvidence ? String(input.verificationEvidence).trim().slice(0, 500) : undefined };
  }).filter((profile): profile is PrinterProfileSettings => Boolean(profile)).slice(0, 50);
}
const decode = <T>(value: string): T => JSON.parse(value) as T;

/** Local SQLite persistence; legacy JSON imports once but is never authoritative again. */
export class Store {
  private readonly db: Database.Database;
  private readonly databasePath: string;
  private readonly skipLegacyImport: boolean;
  private readonly scope = new AsyncLocalStorage<{ tenant: string; storeId: string }>();

  constructor(databaseFileOverride?: string, options: { skipLegacyImport?: boolean } = {}) {
    this.databasePath = databaseFileOverride || databaseFile;
    this.skipLegacyImport = Boolean(options.skipLegacyImport);
    this.db = new Database(this.databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.createSchema();
    this.migrateStoreScope();
    this.applyMigrations();
    if (!this.skipLegacyImport) this.importLegacyJsonIfNeeded();
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_rows (
        tenant TEXT NOT NULL, store_id TEXT NOT NULL DEFAULT 'STORE-DEFAULT', id TEXT NOT NULL, entity TEXT NOT NULL, status TEXT NOT NULL,
        version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY (tenant, store_id, id)
      );
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, tenant TEXT NOT NULL, store_id TEXT NOT NULL DEFAULT 'STORE-DEFAULT', id TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY (kind, tenant, id)
      );
      CREATE INDEX IF NOT EXISTS records_tenant_kind ON records(tenant, kind);
      CREATE TABLE IF NOT EXISTS sequences (series TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_identities (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL, roles_json TEXT NOT NULL, enabled INTEGER NOT NULL,
        first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', rider_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE(tenant, username)
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, identity_id TEXT NOT NULL, tenant TEXT NOT NULL, store_id TEXT NOT NULL,
        expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(identity_id) REFERENCES auth_identities(id)
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_active ON auth_sessions(token_hash, expires_at, revoked_at);
      CREATE TABLE IF NOT EXISTS idempotency_commands (
        tenant TEXT NOT NULL, scope TEXT NOT NULL, command_key TEXT NOT NULL, response_json TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (tenant, scope, command_key)
      );
      CREATE TABLE IF NOT EXISTS store_settings (
        tenant TEXT NOT NULL, store_id TEXT NOT NULL, settings_json TEXT NOT NULL,
        PRIMARY KEY (tenant, store_id)
      );
      CREATE TABLE IF NOT EXISTS stores (
        id TEXT NOT NULL, tenant TEXT NOT NULL, name TEXT NOT NULL, code TEXT NOT NULL,
        enabled INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant, id), UNIQUE(tenant, code)
      );
      CREATE TABLE IF NOT EXISTS auth_store_memberships (
        identity_id TEXT NOT NULL, tenant TEXT NOT NULL, store_id TEXT NOT NULL, roles_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (identity_id, store_id), FOREIGN KEY(identity_id) REFERENCES auth_identities(id)
      );
      CREATE INDEX IF NOT EXISTS auth_store_memberships_scope ON auth_store_memberships(tenant, store_id, identity_id);
      CREATE TABLE IF NOT EXISTS garment_units (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, code TEXT NOT NULL,
        order_id TEXT NOT NULL, item_index INTEGER NOT NULL, sequence INTEGER NOT NULL,
        customer_id TEXT NOT NULL, garment_id TEXT NOT NULL, service_id TEXT NOT NULL, unit TEXT NOT NULL,
        state TEXT NOT NULL, location TEXT NOT NULL DEFAULT 'Intake', active_tag_code TEXT NOT NULL,
        condition TEXT NOT NULL DEFAULT 'Normal', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(tenant, store_id, code), UNIQUE(tenant, store_id, active_tag_code)
      );
      CREATE INDEX IF NOT EXISTS garment_units_scope_state ON garment_units(tenant, store_id, state, updated_at DESC);
      CREATE INDEX IF NOT EXISTS garment_units_order ON garment_units(tenant, store_id, order_id, item_index);
      CREATE TABLE IF NOT EXISTS garment_unit_events (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, unit_id TEXT NOT NULL,
        event TEXT NOT NULL, from_state TEXT, to_state TEXT, location TEXT, actor TEXT NOT NULL,
        note TEXT, metadata_json TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS garment_unit_events_unit ON garment_unit_events(tenant, store_id, unit_id, created_at);
      CREATE TABLE IF NOT EXISTS tag_reprints (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, unit_id TEXT NOT NULL,
        previous_tag_code TEXT NOT NULL, new_tag_code TEXT NOT NULL, station TEXT NOT NULL, reason TEXT NOT NULL,
        actor TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant, store_id, new_tag_code)
      );
      CREATE INDEX IF NOT EXISTS tag_reprints_unit ON tag_reprints(tenant, store_id, unit_id, created_at);
      CREATE TABLE IF NOT EXISTS tag_history (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, garment_unit_id TEXT NOT NULL,
        tag_code TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Active','Retired','Lost','Damaged','Replaced')),
        issued_at TEXT NOT NULL, issued_by TEXT NOT NULL, retired_at TEXT, retired_by TEXT, retirement_reason TEXT,
        replacement_tag_id TEXT, version INTEGER NOT NULL CHECK(version > 0), created_at TEXT NOT NULL,
        UNIQUE(tenant, store_id, tag_code)
      );
      CREATE INDEX IF NOT EXISTS tag_history_unit ON tag_history(tenant, store_id, garment_unit_id, created_at);
      CREATE INDEX IF NOT EXISTS tag_history_lookup ON tag_history(tenant, store_id, tag_code, status);
      CREATE TABLE IF NOT EXISTS tag_print_jobs (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL,
        template_id TEXT NOT NULL, template_version TEXT NOT NULL, printer_profile TEXT NOT NULL,
        tag_ids_json TEXT NOT NULL, document_type TEXT NOT NULL CHECK(document_type IN ('invoice','mini-invoice','garment-tags','bag-tags','correction')),
        requested_copies INTEGER NOT NULL CHECK(typeof(requested_copies) = 'integer' AND requested_copies BETWEEN 1 AND 500),
        requested_by TEXT NOT NULL, created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('Queued','Rendering','Printed','Downloaded','Failed','Cancelled')),
        started_at TEXT, completed_at TEXT, failure_reason TEXT, output_hash TEXT, evidence TEXT
      );
      CREATE INDEX IF NOT EXISTS tag_print_jobs_scope_time ON tag_print_jobs(tenant, store_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS laundry_containers (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK(sequence > 0), total INTEGER NOT NULL CHECK(total > 0), weight_milli INTEGER,
        tag_code TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('Intake','Processing','Ready','Dispatched','Delivered','Missing','Damaged','Cancelled')),
        location TEXT NOT NULL DEFAULT 'Intake', condition TEXT NOT NULL DEFAULT 'Normal', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, delivered_at TEXT, UNIQUE(tenant, store_id, tag_code), UNIQUE(tenant, store_id, order_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS laundry_containers_scope_order ON laundry_containers(tenant, store_id, order_id, sequence);
      CREATE INDEX IF NOT EXISTS laundry_containers_tag_lookup ON laundry_containers(tenant, store_id, tag_code, state);
      CREATE TABLE IF NOT EXISTS laundry_container_events (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, container_id TEXT NOT NULL, event TEXT NOT NULL,
        from_state TEXT, to_state TEXT, location TEXT, actor TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS laundry_container_events_container ON laundry_container_events(tenant, store_id, container_id, created_at);
      CREATE TABLE IF NOT EXISTS financial_entries (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, kind TEXT NOT NULL,
        source_entity TEXT NOT NULL, source_id TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
        amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0), currency TEXT NOT NULL DEFAULT 'INR',
        occurred_at TEXT NOT NULL, actor TEXT NOT NULL, metadata_json TEXT
      );
      CREATE INDEX IF NOT EXISTS financial_entries_scope_time ON financial_entries(tenant, store_id, occurred_at, kind);
      CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_source ON financial_entries(tenant, store_id, source_entity, source_id, kind);
      CREATE TABLE IF NOT EXISTS financial_documents (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, document_type TEXT NOT NULL,
        source_entity TEXT NOT NULL, source_id TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0),
        currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, metadata_json TEXT,
        UNIQUE(tenant, store_id, document_type, source_entity, source_id)
      );
      CREATE INDEX IF NOT EXISTS financial_documents_scope_time ON financial_documents(tenant, store_id, occurred_at, document_type);
      CREATE TABLE IF NOT EXISTS customer_ledger_entries (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        entry_type TEXT NOT NULL, debit_paise INTEGER NOT NULL CHECK(debit_paise >= 0), credit_paise INTEGER NOT NULL CHECK(credit_paise >= 0),
        entry_date TEXT NOT NULL, reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL,
        CHECK((debit_paise = 0 AND credit_paise > 0) OR (debit_paise > 0 AND credit_paise = 0)),
        UNIQUE(tenant, store_id, id)
      );
      CREATE INDEX IF NOT EXISTS customer_ledger_scope_customer ON customer_ledger_entries(tenant, store_id, customer_id, entry_date DESC);
      CREATE TABLE IF NOT EXISTS wallet_entries (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        entry_type TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), entry_date TEXT NOT NULL,
        reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(tenant, store_id, id)
      );
      CREATE INDEX IF NOT EXISTS wallet_scope_customer ON wallet_entries(tenant, store_id, customer_id, entry_date DESC);
      CREATE TABLE IF NOT EXISTS customer_addresses (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        label TEXT NOT NULL, line1 TEXT NOT NULL, line2 TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, actor TEXT NOT NULL,
        UNIQUE(tenant, store_id, id)
      );
      CREATE INDEX IF NOT EXISTS customer_addresses_scope_customer ON customer_addresses(tenant, store_id, customer_id, active, is_default DESC, updated_at DESC);
      CREATE TABLE IF NOT EXISTS laundry_order_holds (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, hold_code TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('Held','Resumed','Cancelled')), payload_json TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        resumed_by TEXT, resumed_at TEXT, cancelled_by TEXT, cancelled_at TEXT,
        UNIQUE(tenant, store_id, hold_code)
      );
      CREATE INDEX IF NOT EXISTS laundry_order_holds_scope_status ON laundry_order_holds(tenant, store_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS cash_shift_closes (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, shift_id TEXT NOT NULL, register TEXT NOT NULL,
        business_date TEXT NOT NULL, opening_cash_paise INTEGER NOT NULL CHECK(opening_cash_paise >= 0),
        collections_paise INTEGER NOT NULL CHECK(collections_paise >= 0), expenses_paise INTEGER NOT NULL CHECK(expenses_paise >= 0),
        refunds_paise INTEGER NOT NULL CHECK(refunds_paise >= 0), expected_cash_paise INTEGER NOT NULL CHECK(expected_cash_paise >= 0),
        counted_cash_paise INTEGER NOT NULL CHECK(counted_cash_paise >= 0), variance_paise INTEGER NOT NULL,
        collection_count INTEGER NOT NULL CHECK(collection_count >= 0), expense_count INTEGER NOT NULL CHECK(expense_count >= 0),
        refund_count INTEGER NOT NULL CHECK(refund_count >= 0), closed_at TEXT NOT NULL, closed_by TEXT NOT NULL,
        supervisor_actor TEXT, note TEXT NOT NULL DEFAULT '', UNIQUE(tenant, store_id, shift_id)
      );
      CREATE INDEX IF NOT EXISTS cash_shift_closes_scope_time ON cash_shift_closes(tenant, store_id, closed_at DESC);
    `);
  }

  private applyMigrations() {
    const migrations = [
      { version: 1, name: 'store-scope-and-operational-tables', sql: 'CREATE INDEX IF NOT EXISTS entity_rows_tenant_store_entity ON entity_rows(tenant, store_id, entity, updated_at DESC); CREATE INDEX IF NOT EXISTS records_tenant_store_kind ON records(tenant, store_id, kind);' },
      { version: 2, name: 'garment-traceability-tables', sql: 'CREATE INDEX IF NOT EXISTS garment_units_scope_state ON garment_units(tenant, store_id, state, updated_at DESC); CREATE INDEX IF NOT EXISTS garment_unit_events_unit ON garment_unit_events(tenant, store_id, unit_id, created_at); CREATE INDEX IF NOT EXISTS tag_reprints_unit ON tag_reprints(tenant, store_id, unit_id, created_at);' },
      { version: 3, name: 'cash-shift-control', sql: 'CREATE INDEX IF NOT EXISTS entity_rows_cash_shift ON entity_rows(tenant, store_id, entity, status, created_at DESC);' },
      { version: 4, name: 'financial-paise-journal', sql: "CREATE TABLE IF NOT EXISTS financial_entries (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, kind TEXT NOT NULL, source_entity TEXT NOT NULL, source_id TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')), amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0), currency TEXT NOT NULL DEFAULT 'INR', occurred_at TEXT NOT NULL, actor TEXT NOT NULL, metadata_json TEXT); CREATE INDEX IF NOT EXISTS financial_entries_scope_time ON financial_entries(tenant, store_id, occurred_at, kind); CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_source ON financial_entries(tenant, store_id, source_entity, source_id, kind);" },
      { version: 5, name: 'normalized-financial-documents', sql: "CREATE TABLE IF NOT EXISTS financial_documents (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, document_type TEXT NOT NULL, source_entity TEXT NOT NULL, source_id TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0), currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL, occurred_at TEXT NOT NULL, actor TEXT NOT NULL, metadata_json TEXT); CREATE UNIQUE INDEX IF NOT EXISTS financial_documents_source ON financial_documents(tenant, store_id, document_type, source_entity, source_id); CREATE INDEX IF NOT EXISTS financial_documents_scope_time ON financial_documents(tenant, store_id, occurred_at, document_type);" },
      { version: 6, name: 'normalized-customer-ledger-wallet', sql: "CREATE TABLE IF NOT EXISTS customer_ledger_entries (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL, entry_type TEXT NOT NULL, debit_paise INTEGER NOT NULL CHECK(debit_paise >= 0), credit_paise INTEGER NOT NULL CHECK(credit_paise >= 0), entry_date TEXT NOT NULL, reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL, CHECK((debit_paise = 0 AND credit_paise > 0) OR (debit_paise > 0 AND credit_paise = 0))); CREATE INDEX IF NOT EXISTS customer_ledger_scope_customer ON customer_ledger_entries(tenant, store_id, customer_id, entry_date DESC); CREATE TABLE IF NOT EXISTS wallet_entries (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL, entry_type TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), entry_date TEXT NOT NULL, reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS wallet_scope_customer ON wallet_entries(tenant, store_id, customer_id, entry_date DESC);" },
      { version: 7, name: 'customer-address-book', sql: "CREATE TABLE IF NOT EXISTS customer_addresses (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL, label TEXT NOT NULL, line1 TEXT NOT NULL, line2 TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, actor TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_scope_id ON customer_addresses(tenant, store_id, id); CREATE INDEX IF NOT EXISTS customer_addresses_scope_customer ON customer_addresses(tenant, store_id, customer_id, active, is_default, updated_at);" },
      { version: 8, name: 'idempotency-request-fingerprint', sql: 'ALTER TABLE idempotency_commands ADD COLUMN request_hash TEXT;' },
      { version: 9, name: 'constrained-financial-source-columns', sql: "ALTER TABLE entity_rows ADD COLUMN amount_paise INTEGER CHECK(amount_paise IS NULL OR (typeof(amount_paise) = 'integer' AND amount_paise >= 0)); ALTER TABLE entity_rows ADD COLUMN amount_direction TEXT CHECK(amount_direction IS NULL OR amount_direction IN ('DEBIT','CREDIT','NONE')); ALTER TABLE entity_rows ADD COLUMN amount_currency TEXT NOT NULL DEFAULT 'INR'; CREATE INDEX IF NOT EXISTS entity_rows_financial_amount ON entity_rows(tenant, store_id, entity, amount_paise);" },
      { version: 10, name: 'audited-pos-order-holds', sql: "CREATE TABLE IF NOT EXISTS laundry_order_holds (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, hold_code TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Held','Resumed','Cancelled')), payload_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resumed_by TEXT, resumed_at TEXT, cancelled_by TEXT, cancelled_at TEXT, UNIQUE(tenant, store_id, hold_code)); CREATE INDEX IF NOT EXISTS laundry_order_holds_scope_status ON laundry_order_holds(tenant, store_id, status, updated_at DESC);" },
      { version: 11, name: 'normalized-cash-shift-closes', sql: "CREATE TABLE IF NOT EXISTS cash_shift_closes (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, shift_id TEXT NOT NULL, register TEXT NOT NULL, business_date TEXT NOT NULL, opening_cash_paise INTEGER NOT NULL CHECK(opening_cash_paise >= 0), collections_paise INTEGER NOT NULL CHECK(collections_paise >= 0), expenses_paise INTEGER NOT NULL CHECK(expenses_paise >= 0), refunds_paise INTEGER NOT NULL CHECK(refunds_paise >= 0), expected_cash_paise INTEGER NOT NULL CHECK(expected_cash_paise >= 0), counted_cash_paise INTEGER NOT NULL CHECK(counted_cash_paise >= 0), variance_paise INTEGER NOT NULL, collection_count INTEGER NOT NULL CHECK(collection_count >= 0), expense_count INTEGER NOT NULL CHECK(expense_count >= 0), refund_count INTEGER NOT NULL CHECK(refund_count >= 0), closed_at TEXT NOT NULL, closed_by TEXT NOT NULL, supervisor_actor TEXT, note TEXT NOT NULL DEFAULT '', UNIQUE(tenant, store_id, shift_id)); CREATE INDEX IF NOT EXISTS cash_shift_closes_scope_time ON cash_shift_closes(tenant, store_id, closed_at DESC);" },
      { version: 12, name: 'indexed-laundry-report-dates', sql: "CREATE INDEX IF NOT EXISTS entity_rows_laundry_order_date ON entity_rows(tenant, store_id, entity, json_extract(data_json, '$.order_date')); CREATE INDEX IF NOT EXISTS entity_rows_payment_posting_date ON entity_rows(tenant, store_id, entity, json_extract(data_json, '$.posting_date')); CREATE INDEX IF NOT EXISTS entity_rows_expense_date ON entity_rows(tenant, store_id, entity, json_extract(data_json, '$.expense_date')); CREATE INDEX IF NOT EXISTS entity_rows_party_created_at ON entity_rows(tenant, store_id, entity, created_at);" },
      { version: 13, name: 'financial-normalization-evidence', sql: "CREATE TABLE IF NOT EXISTS financial_normalization_runs (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('certified')), candidates INTEGER NOT NULL CHECK(candidates >= 0), ledger_candidates INTEGER NOT NULL CHECK(ledger_candidates >= 0), cash_close_candidates INTEGER NOT NULL CHECK(cash_close_candidates >= 0), documents_applied INTEGER NOT NULL CHECK(documents_applied >= 0), entries_applied INTEGER NOT NULL CHECK(entries_applied >= 0), ledger_entries_applied INTEGER NOT NULL CHECK(ledger_entries_applied >= 0), cash_close_snapshots_applied INTEGER NOT NULL CHECK(cash_close_snapshots_applied >= 0), source_columns_applied INTEGER NOT NULL CHECK(source_columns_applied >= 0), reconciliation_status TEXT NOT NULL, reconciliation_issue_count INTEGER NOT NULL CHECK(reconciliation_issue_count >= 0), created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS financial_normalization_runs_scope_time ON financial_normalization_runs(tenant, store_id, created_at DESC);" },
      { version: 14, name: 'financial-normalization-wallet-evidence', sql: "ALTER TABLE financial_normalization_runs ADD COLUMN wallet_entries_applied INTEGER NOT NULL DEFAULT 0 CHECK(wallet_entries_applied >= 0);" },
      { version: 15, name: 'audited-pos-hold-ownership', sql: "ALTER TABLE laundry_order_holds ADD COLUMN owner_actor TEXT NOT NULL DEFAULT ''; ALTER TABLE laundry_order_holds ADD COLUMN ownership_updated_at TEXT NOT NULL DEFAULT ''; UPDATE laundry_order_holds SET owner_actor = created_by WHERE owner_actor = ''; UPDATE laundry_order_holds SET ownership_updated_at = updated_at WHERE ownership_updated_at = ''; CREATE INDEX IF NOT EXISTS laundry_order_holds_scope_owner ON laundry_order_holds(tenant, store_id, owner_actor, status, updated_at DESC);" },
      { version: 16, name: 'normalized-customer-order-projections', sql: "CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', preferred_contact TEXT NOT NULL DEFAULT 'Phone', service_preferences TEXT NOT NULL DEFAULT '', marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK(marketing_consent IN (0,1)), source_version INTEGER NOT NULL CHECK(source_version > 0), source_updated_at TEXT NOT NULL, source_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant, store_id, phone)); CREATE INDEX IF NOT EXISTS customers_scope_name ON customers(tenant, store_id, name COLLATE NOCASE); CREATE TABLE IF NOT EXISTS laundry_orders (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, customer_id TEXT NOT NULL, order_number TEXT NOT NULL, state TEXT NOT NULL, order_date TEXT NOT NULL, expected_delivery_date TEXT NOT NULL, fulfillment_mode TEXT NOT NULL, grand_total_paise INTEGER NOT NULL CHECK(grand_total_paise >= 0), payment_status TEXT NOT NULL, data_json TEXT NOT NULL, source_version INTEGER NOT NULL CHECK(source_version > 0), source_updated_at TEXT NOT NULL, source_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant, store_id, order_number), FOREIGN KEY(customer_id) REFERENCES customers(id)); CREATE INDEX IF NOT EXISTS laundry_orders_scope_state_due ON laundry_orders(tenant, store_id, state, expected_delivery_date, updated_at DESC); CREATE INDEX IF NOT EXISTS laundry_orders_scope_customer ON laundry_orders(tenant, store_id, customer_id, order_date DESC); CREATE TABLE IF NOT EXISTS laundry_order_items (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL, item_index INTEGER NOT NULL CHECK(item_index >= 0), garment_id TEXT NOT NULL, service_id TEXT NOT NULL, unit TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0), rate_paise INTEGER NOT NULL CHECK(rate_paise >= 0), amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0), data_json TEXT NOT NULL, UNIQUE(tenant, store_id, order_id, item_index), FOREIGN KEY(order_id) REFERENCES laundry_orders(id)); CREATE INDEX IF NOT EXISTS laundry_order_items_scope_order ON laundry_order_items(tenant, store_id, order_id, item_index); CREATE TABLE IF NOT EXISTS compatibility_migration_runs (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, entity TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed')), cursor INTEGER NOT NULL CHECK(cursor >= 0), total INTEGER NOT NULL CHECK(total >= 0), applied INTEGER NOT NULL CHECK(applied >= 0), invalid INTEGER NOT NULL CHECK(invalid >= 0), conflicts INTEGER NOT NULL CHECK(conflicts >= 0), source_hash TEXT NOT NULL, actor TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, error TEXT); CREATE INDEX IF NOT EXISTS compatibility_migration_scope ON compatibility_migration_runs(tenant, store_id, entity, updated_at DESC);" },
      { version: 17, name: 'durable-tag-history-and-print-jobs', sql: "CREATE TABLE IF NOT EXISTS tag_history (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, garment_unit_id TEXT NOT NULL, tag_code TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Active','Retired','Lost','Damaged','Replaced')), issued_at TEXT NOT NULL, issued_by TEXT NOT NULL, retired_at TEXT, retired_by TEXT, retirement_reason TEXT, replacement_tag_id TEXT, version INTEGER NOT NULL CHECK(version > 0), created_at TEXT NOT NULL, UNIQUE(tenant, store_id, tag_code)); CREATE INDEX IF NOT EXISTS tag_history_unit ON tag_history(tenant, store_id, garment_unit_id, created_at); CREATE INDEX IF NOT EXISTS tag_history_lookup ON tag_history(tenant, store_id, tag_code, status); CREATE TABLE IF NOT EXISTS tag_print_jobs (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL, template_id TEXT NOT NULL, template_version TEXT NOT NULL, printer_profile TEXT NOT NULL, tag_ids_json TEXT NOT NULL, document_type TEXT NOT NULL, requested_copies INTEGER NOT NULL CHECK(requested_copies > 0), requested_by TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT, completed_at TEXT, failure_reason TEXT, output_hash TEXT, evidence TEXT); CREATE INDEX IF NOT EXISTS tag_print_jobs_scope_time ON tag_print_jobs(tenant, store_id, created_at DESC); INSERT INTO tag_history(id,tenant,store_id,garment_unit_id,tag_code,status,issued_at,issued_by,version,created_at) SELECT 'th_legacy_' || id,tenant,store_id,id,active_tag_code,'Active',created_at,created_by,1,created_at FROM garment_units WHERE NOT EXISTS (SELECT 1 FROM tag_history h WHERE h.tenant = garment_units.tenant AND h.store_id = garment_units.store_id AND h.tag_code = garment_units.active_tag_code);" },
      { version: 18, name: 'hardened-print-job-state-and-document-constraints', sql: "CREATE TABLE tag_print_jobs_hardened (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL, template_id TEXT NOT NULL, template_version TEXT NOT NULL, printer_profile TEXT NOT NULL, tag_ids_json TEXT NOT NULL, document_type TEXT NOT NULL CHECK(document_type IN ('invoice','mini-invoice','garment-tags','bag-tags','correction')), requested_copies INTEGER NOT NULL CHECK(typeof(requested_copies) = 'integer' AND requested_copies BETWEEN 1 AND 500), requested_by TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Queued','Rendering','Printed','Downloaded','Failed','Cancelled')), started_at TEXT, completed_at TEXT, failure_reason TEXT, output_hash TEXT, evidence TEXT); INSERT INTO tag_print_jobs_hardened(id,tenant,store_id,order_id,template_id,template_version,printer_profile,tag_ids_json,document_type,requested_copies,requested_by,created_at,status,started_at,completed_at,failure_reason,output_hash,evidence) SELECT id,tenant,store_id,order_id,template_id,template_version,printer_profile,tag_ids_json,document_type,requested_copies,requested_by,created_at,status,started_at,completed_at,failure_reason,output_hash,evidence FROM tag_print_jobs; DROP TABLE tag_print_jobs; ALTER TABLE tag_print_jobs_hardened RENAME TO tag_print_jobs; CREATE INDEX tag_print_jobs_scope_time ON tag_print_jobs(tenant, store_id, created_at DESC);" },
      { version: 19, name: 'explicit-laundry-container-tags', sql: "CREATE TABLE IF NOT EXISTS laundry_containers (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, order_id TEXT NOT NULL, customer_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0), total INTEGER NOT NULL CHECK(total > 0), weight_milli INTEGER, tag_code TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('Intake','Processing','Ready','Dispatched','Delivered','Missing','Damaged','Cancelled')), location TEXT NOT NULL DEFAULT 'Intake', condition TEXT NOT NULL DEFAULT 'Normal', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, delivered_at TEXT, UNIQUE(tenant, store_id, tag_code), UNIQUE(tenant, store_id, order_id, sequence)); CREATE INDEX IF NOT EXISTS laundry_containers_scope_order ON laundry_containers(tenant, store_id, order_id, sequence); CREATE INDEX IF NOT EXISTS laundry_containers_tag_lookup ON laundry_containers(tenant, store_id, tag_code, state); CREATE TABLE IF NOT EXISTS laundry_container_events (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, container_id TEXT NOT NULL, event TEXT NOT NULL, from_state TEXT, to_state TEXT, location TEXT, actor TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS laundry_container_events_container ON laundry_container_events(tenant, store_id, container_id, created_at);" },
    ];
    this.db.transaction(() => {
      for (const migration of migrations) {
        const checksum = createHash('sha256').update(migration.sql).digest('hex');
        const applied = this.db.prepare('SELECT checksum, name FROM schema_migrations WHERE version = ?').get(migration.version) as { checksum: string; name: string } | undefined;
        if (applied) {
          if (applied.checksum !== checksum || applied.name !== migration.name) throw new Error(`schema migration ${migration.version} checksum mismatch`);
          continue;
        }
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES (?,?,?,?)').run(migration.version, migration.name, checksum, new Date().toISOString());
      }
    })();
  }

  migrationStatus() {
    return (this.db.prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version').all() as Array<Record<string, unknown>>).map((row) => ({ version: Number(row.version), name: String(row.name), checksum: String(row.checksum), appliedAt: String(row.applied_at) }));
  }

  private migrateStoreScope() {
    const entityColumns = this.db.prepare('PRAGMA table_info(entity_rows)').all() as Array<{ name: string }>;
    if (entityColumns.length && !entityColumns.some((column) => column.name === 'store_id')) {
      this.db.transaction(() => {
        this.db.exec('ALTER TABLE entity_rows RENAME TO entity_rows_legacy;');
        this.db.exec(`CREATE TABLE entity_rows (
          tenant TEXT NOT NULL, store_id TEXT NOT NULL DEFAULT 'STORE-DEFAULT', id TEXT NOT NULL, entity TEXT NOT NULL, status TEXT NOT NULL,
          version INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data_json TEXT NOT NULL,
          PRIMARY KEY (tenant, store_id, id)
        );
        INSERT INTO entity_rows(tenant,store_id,id,entity,status,version,created_by,created_at,updated_at,data_json)
          SELECT tenant,'STORE-DEFAULT',id,entity,status,version,created_by,created_at,updated_at,data_json FROM entity_rows_legacy;
        DROP TABLE entity_rows_legacy;
        CREATE INDEX IF NOT EXISTS entity_rows_tenant_store_entity ON entity_rows(tenant, store_id, entity, updated_at DESC);`);
      })();
    }
    const recordColumns = this.db.prepare('PRAGMA table_info(records)').all() as Array<{ name: string }>;
    if (recordColumns.length && !recordColumns.some((column) => column.name === 'store_id')) this.db.exec("ALTER TABLE records ADD COLUMN store_id TEXT NOT NULL DEFAULT 'STORE-DEFAULT';");
    const identityColumns = this.db.prepare('PRAGMA table_info(auth_identities)').all() as Array<{ name: string }>;
    const identityProfileColumns = [
      ['first_name', "TEXT NOT NULL DEFAULT ''"], ['last_name', "TEXT NOT NULL DEFAULT ''"], ['email', "TEXT NOT NULL DEFAULT ''"],
      ['phone', "TEXT NOT NULL DEFAULT ''"], ['description', "TEXT NOT NULL DEFAULT ''"], ['rider_id', "TEXT NOT NULL DEFAULT ''"],
    ] as const;
    for (const [name, definition] of identityProfileColumns) {
      if (identityColumns.length && !identityColumns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE auth_identities ADD COLUMN ${name} ${definition};`);
    }
    // Existing profiles predate explicit branch records. Backfill a durable record and membership for their previous home store.
    this.db.exec(`INSERT OR IGNORE INTO stores(id,tenant,name,code,enabled,created_at)
      SELECT store_id, tenant, store_id, store_id, 1, created_at FROM auth_identities;
      INSERT OR IGNORE INTO auth_store_memberships(identity_id,tenant,store_id,roles_json,created_at)
      SELECT id, tenant, store_id, roles_json, created_at FROM auth_identities;`);
    this.db.exec('CREATE INDEX IF NOT EXISTS entity_rows_tenant_store_entity ON entity_rows(tenant, store_id, entity, updated_at DESC);');
  }

  private importLegacyJsonIfNeeded() {
    const count = Number((this.db.prepare('SELECT COUNT(*) AS count FROM entity_rows').get() as { count: number }).count);
    if (count > 0 || !existsSync(legacyFile) || legacyFile === this.databasePath) return;
    try {
      const parsed = decode<Partial<DbShape>>(readFileSync(legacyFile, 'utf8'));
      if (!Array.isArray(parsed.rows)) return;
      this.transaction(() => this.replaceAll({ ...empty(), ...parsed }));
      this.db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('legacy_json_imported_at', new Date().toISOString());
      this.db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)').run('legacy_json_source', legacyFile);
      console.log(`[store] migrated legacy JSON into SQLite: ${legacyFile}`);
    } catch (error) {
      console.error('[store] legacy JSON migration skipped:', (error as Error).message);
    }
  }

  transaction<T>(work: () => T): T { return this.db.transaction(work)(); }
  close() { this.db.close(); }
  withStoreScope<T>(tenant: string, storeId: string, work: () => T): T { return this.scope.run({ tenant, storeId }, work); }
  /** Bind the authenticated workspace to the remainder of the current request.
   * Legacy handlers that do not explicitly use withStoreScope still resolve
   * currentStore() to the caller's selected store rather than STORE-DEFAULT. */
  enterStoreScope(tenant: string, storeId: string) { this.scope.enterWith({ tenant, storeId }); }
  currentStore(tenant: string) {
    const scope = this.scope.getStore();
    if (scope && scope.tenant !== tenant) throw new Error('tenant context mismatch');
    return scope?.storeId || 'STORE-DEFAULT';
  }

  authIdentityCount() { return Number((this.db.prepare('SELECT COUNT(*) AS count FROM auth_identities').get() as { count: number }).count); }
  createIdentity(identity: AuthIdentity) {
    this.db.prepare(`INSERT INTO auth_identities(
      id,tenant,store_id,username,password_hash,roles_json,enabled,first_name,last_name,email,phone,description,rider_id,created_at
    ) VALUES (
      @id,@tenant,@storeId,@username,@passwordHash,@rolesJson,@enabled,@firstName,@lastName,@email,@phone,@description,@riderId,@createdAt
    )`)
      .run({ ...identity, riderId: identity.riderId || '', rolesJson: encode(identity.roles), enabled: identity.enabled ? 1 : 0 });
    this.ensureStore(identity.tenant, identity.storeId, identity.storeId, identity.storeId);
    this.addStoreMembership({ identityId: identity.id, tenant: identity.tenant, storeId: identity.storeId, roles: identity.roles, createdAt: identity.createdAt });
  }
  private identityFromRow(row: Record<string, unknown>, includePassword = true): AuthIdentity {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), username: String(row.username),
      passwordHash: includePassword ? String(row.password_hash) : '', roles: decode<string[]>(String(row.roles_json)), enabled: Boolean(row.enabled),
      firstName: String(row.first_name || ''), lastName: String(row.last_name || ''), email: String(row.email || ''),
      phone: String(row.phone || ''), description: String(row.description || ''), riderId: String(row.rider_id || '') || undefined, createdAt: String(row.created_at),
    };
  }
  findIdentityByUsername(username: string) {
    const row = this.db.prepare('SELECT * FROM auth_identities WHERE username = ?').get(username) as Record<string, unknown> | undefined;
    return row ? this.identityFromRow(row) : undefined;
  }
  listIdentities(tenant: string, storeId: string) {
    return (this.db.prepare('SELECT * FROM auth_identities WHERE tenant = ? AND store_id = ? ORDER BY first_name, last_name, username').all(tenant, storeId) as Array<Record<string, unknown>>)
      .map((row) => this.identityFromRow(row, false));
  }
  identityById(id: string) {
    const row = this.db.prepare('SELECT * FROM auth_identities WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.identityFromRow(row) : undefined;
  }
  setIdentityEnabled(id: string, enabled: boolean) { this.db.prepare('UPDATE auth_identities SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id); }
  ensureStore(tenant: string, id: string, name: string, code: string) {
    this.db.prepare('INSERT OR IGNORE INTO stores(id,tenant,name,code,enabled,created_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, tenant, name, code, new Date().toISOString());
  }
  createStore(input: StoreRecord) {
    this.db.prepare('INSERT INTO stores(id,tenant,name,code,enabled,created_at) VALUES (@id,@tenant,@name,@code,@enabled,@createdAt)')
      .run({ ...input, enabled: input.enabled ? 1 : 0 });
  }
  storeById(tenant: string, id: string) {
    const row = this.db.prepare('SELECT * FROM stores WHERE tenant = ? AND id = ?').get(tenant, id) as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), tenant: String(row.tenant), name: String(row.name), code: String(row.code), enabled: Boolean(row.enabled), createdAt: String(row.created_at) } satisfies StoreRecord : undefined;
  }
  listStoresForIdentity(identityId: string, tenant: string) {
    return (this.db.prepare(`SELECT s.*, m.roles_json FROM stores s JOIN auth_store_memberships m ON m.tenant = s.tenant AND m.store_id = s.id
      WHERE m.identity_id = ? AND s.tenant = ? ORDER BY s.name COLLATE NOCASE`).all(identityId, tenant) as Array<Record<string, unknown>>)
      .map((row) => ({ id: String(row.id), tenant: String(row.tenant), name: String(row.name), code: String(row.code), enabled: Boolean(row.enabled), createdAt: String(row.created_at), roles: decode<string[]>(String(row.roles_json)) }));
  }
  addStoreMembership(membership: StoreMembership) {
    this.db.prepare('INSERT INTO auth_store_memberships(identity_id,tenant,store_id,roles_json,created_at) VALUES (@identityId,@tenant,@storeId,@rolesJson,@createdAt) ON CONFLICT(identity_id,store_id) DO UPDATE SET roles_json=excluded.roles_json')
      .run({ ...membership, rolesJson: encode(membership.roles) });
  }
  membershipForIdentity(identityId: string, tenant: string, storeId: string) {
    const row = this.db.prepare(`SELECT m.roles_json, m.created_at, s.enabled AS store_enabled FROM auth_store_memberships m
      JOIN stores s ON s.tenant=m.tenant AND s.id=m.store_id WHERE m.identity_id = ? AND m.tenant = ? AND m.store_id = ?`).get(identityId, tenant, storeId) as Record<string, unknown> | undefined;
    return row ? { identityId, tenant, storeId, roles: decode<string[]>(String(row.roles_json)), createdAt: String(row.created_at), enabled: Boolean(row.store_enabled) } : undefined;
  }
  updateActiveSessionStore(tokenHash: string, storeId: string) { this.db.prepare('UPDATE auth_sessions SET store_id = ? WHERE token_hash = ? AND revoked_at IS NULL').run(storeId, tokenHash); }
  updateStoreName(tenant: string, id: string, name: string) { this.db.prepare('UPDATE stores SET name = ? WHERE tenant = ? AND id = ?').run(name, tenant, id); }
  updateIdentityProfile(id: string, input: Pick<AuthIdentity, 'firstName' | 'lastName' | 'email' | 'phone' | 'description' | 'roles' | 'enabled' | 'riderId'>) {
    this.db.prepare(`UPDATE auth_identities SET
      first_name = @firstName, last_name = @lastName, email = @email, phone = @phone, description = @description,
      roles_json = @rolesJson, enabled = @enabled, rider_id = @riderId
      WHERE id = @id`).run({ id, ...input, riderId: input.riderId || '', rolesJson: encode(input.roles), enabled: input.enabled ? 1 : 0 });
  }
  getStoreSettings(tenant: string, storeId = this.currentStore(tenant)): StoreSettings {
    const row = this.db.prepare('SELECT settings_json FROM store_settings WHERE tenant = ? AND store_id = ?').get(tenant, storeId) as { settings_json: string } | undefined;
    if (row) {
      const saved = decode<StoreSettings>(row.settings_json);
      const currency = String(saved.currency || 'INR').trim().toUpperCase();
      let timezone = String(saved.timezone || 'Asia/Kolkata').trim() || 'Asia/Kolkata';
      try { new Intl.DateTimeFormat('en-IN', { timeZone: timezone }).format(); } catch { timezone = 'Asia/Kolkata'; }
      const afterBooking = ['ask', 'open-print-centre', 'auto-print', 'none'].includes(String(saved.afterBooking)) ? saved.afterBooking : 'ask';
      return {
        ...saved,
        logoDataUrl: saved.logoDataUrl || '',
        taxMode: saved.taxMode === 'gst' ? 'gst' : 'none',
        gstin: String(saved.gstin || '').trim().toUpperCase(),
        currency: /^[A-Z]{3}$/.test(currency) ? currency : 'INR',
        timezone,
        printerProfile: String(saved.printerProfile || '').trim().slice(0, 80),
        afterBooking,
        printerProfiles: normalizePrinterProfiles(saved.printerProfiles),
        tagTemplate: normalizeTagTemplate(saved.tagTemplate),
        stationCapacities: normalizeStationCapacities(saved.stationCapacities),
        setupProgress: {
          business: Boolean(saved.setupProgress?.business),
          owner: Boolean(saved.setupProgress?.owner),
          operations: Boolean(saved.setupProgress?.operations),
          catalogue: Boolean(saved.setupProgress?.catalogue),
          recovery: Boolean(saved.setupProgress?.recovery),
          updatedAt: String(saved.setupProgress?.updatedAt || ''),
          updatedBy: String(saved.setupProgress?.updatedBy || ''),
        },
      };
    }
    return { businessName: 'Epic Laundry', address: '', phone: '', email: '', upiId: '', qrOnPrint: false, logoDataUrl: '', taxMode: 'none', gstin: '', currency: 'INR', timezone: 'Asia/Kolkata', printerProfile: '', afterBooking: 'ask', printerProfiles: [], tagTemplate: { ...DEFAULT_TAG_TEMPLATE }, stationCapacities: { ...DEFAULT_STATION_CAPACITIES }, setupProgress: { business: false, owner: false, operations: false, catalogue: false, recovery: false, updatedAt: '', updatedBy: '' }, updatedAt: '', updatedBy: '' };
  }
  saveStoreSettings(tenant: string, actor: string, input: Partial<StoreSettings>, storeId = this.currentStore(tenant)) {
    const previous = this.getStoreSettings(tenant, storeId);
    const next: StoreSettings = {
      businessName: String(input.businessName ?? previous.businessName).trim() || 'Epic Laundry', address: String(input.address ?? previous.address).trim(),
      phone: String(input.phone ?? previous.phone).trim(), email: String(input.email ?? previous.email).trim(), upiId: String(input.upiId ?? previous.upiId).trim(),
      qrOnPrint: typeof input.qrOnPrint === 'boolean' ? input.qrOnPrint : previous.qrOnPrint,
      taxMode: input.taxMode === 'gst' ? 'gst' : input.taxMode === 'none' ? 'none' : previous.taxMode || 'none',
      gstin: String(input.gstin ?? (previous.gstin || '')).trim().toUpperCase(),
      currency: /^[A-Z]{3}$/.test(String(input.currency ?? (previous.currency || 'INR')).trim().toUpperCase()) ? String(input.currency ?? (previous.currency || 'INR')).trim().toUpperCase() : 'INR',
      timezone: String(input.timezone ?? (previous.timezone || 'Asia/Kolkata')).trim() || 'Asia/Kolkata',
      printerProfile: String(input.printerProfile ?? (previous.printerProfile || '')).trim().slice(0, 80),
      afterBooking: ['ask', 'open-print-centre', 'auto-print', 'none'].includes(String(input.afterBooking ?? previous.afterBooking)) ? String(input.afterBooking ?? previous.afterBooking) as StoreSettings['afterBooking'] : 'ask',
      printerProfiles: normalizePrinterProfiles(input.printerProfiles ?? previous.printerProfiles),
      tagTemplate: normalizeTagTemplate(input.tagTemplate ?? previous.tagTemplate),
      stationCapacities: normalizeStationCapacities(input.stationCapacities ?? previous.stationCapacities),
      setupProgress: previous.setupProgress,
      updatedAt: new Date().toISOString(), updatedBy: actor,
      logoDataUrl: String(input.logoDataUrl ?? previous.logoDataUrl).trim(),
    };
    if (next.taxMode === 'gst' && next.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(next.gstin)) throw new Error('GSTIN must match the 15-character GST format');
    if (next.taxMode === 'gst' && !next.gstin) throw new Error('GSTIN is required when GST mode is enabled');
    try { new Intl.DateTimeFormat('en-IN', { timeZone: next.timezone }).format(); } catch { throw new Error('timezone must be a valid IANA timezone'); }
    if (next.logoDataUrl && (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(next.logoDataUrl) || next.logoDataUrl.length > 1_500_000)) throw new Error('logo must be a PNG, JPEG, WebP, or SVG image under 1 MB');
    this.db.prepare('INSERT INTO store_settings(tenant,store_id,settings_json) VALUES (?, ?, ?) ON CONFLICT(tenant,store_id) DO UPDATE SET settings_json=excluded.settings_json').run(tenant, storeId, encode(next));
    this.updateStoreName(tenant, storeId, next.businessName);
    return next;
  }
  saveSetupProgress(tenant: string, actor: string, input: Partial<StoreSettings['setupProgress']>, storeId = this.currentStore(tenant)) {
    const previous = this.getStoreSettings(tenant, storeId);
    const nextProgress = {
      ...previous.setupProgress,
      business: typeof input.business === 'boolean' ? input.business : previous.setupProgress.business,
      owner: typeof input.owner === 'boolean' ? input.owner : previous.setupProgress.owner,
      operations: typeof input.operations === 'boolean' ? input.operations : previous.setupProgress.operations,
      catalogue: typeof input.catalogue === 'boolean' ? input.catalogue : previous.setupProgress.catalogue,
      recovery: typeof input.recovery === 'boolean' ? input.recovery : previous.setupProgress.recovery,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    const next = { ...previous, setupProgress: nextProgress };
    this.db.prepare('INSERT INTO store_settings(tenant,store_id,settings_json) VALUES (?, ?, ?) ON CONFLICT(tenant,store_id) DO UPDATE SET settings_json=excluded.settings_json').run(tenant, storeId, encode(next));
    return nextProgress;
  }
  updateIdentityPassword(id: string, passwordHash: string) { this.db.prepare('UPDATE auth_identities SET password_hash = ? WHERE id = ?').run(passwordHash, id); }
  revokeOtherSessions(identityId: string, exceptTokenHash: string) { this.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE identity_id = ? AND token_hash <> ? AND revoked_at IS NULL').run(new Date().toISOString(), identityId, exceptTokenHash); }
  createSession(session: AuthSession) {
    this.db.prepare('INSERT INTO auth_sessions(token_hash,identity_id,tenant,store_id,expires_at,revoked_at,created_at) VALUES (@tokenHash,@identityId,@tenant,@storeId,@expiresAt,@revokedAt,@createdAt)').run({ ...session, revokedAt: session.revokedAt || null });
  }
  sessionByTokenHash(tokenHash: string) {
    const row = this.db.prepare(`SELECT s.*, i.username, i.roles_json, i.enabled, i.first_name, i.last_name, i.email, i.phone, i.description, i.rider_id
      FROM auth_sessions s JOIN auth_identities i ON i.id = s.identity_id
      WHERE s.token_hash = ?`).get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      session: { tokenHash: String(row.token_hash), identityId: String(row.identity_id), tenant: String(row.tenant), storeId: String(row.store_id), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : undefined, createdAt: String(row.created_at) } satisfies AuthSession,
      identity: { id: String(row.identity_id), tenant: String(row.tenant), storeId: String(row.store_id), username: String(row.username), passwordHash: '', roles: decode<string[]>(String(row.roles_json)), enabled: Boolean(row.enabled), firstName: String(row.first_name || ''), lastName: String(row.last_name || ''), email: String(row.email || ''), phone: String(row.phone || ''), description: String(row.description || ''), riderId: String(row.rider_id || '') || undefined, createdAt: '' } satisfies AuthIdentity,
    };
  }
  revokeSession(tokenHash: string) { this.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').run(new Date().toISOString(), tokenHash); }
  idempotencyRecord<T>(tenant: string, scope: string, key: string) {
    const scopedOperation = `${this.currentStore(tenant)}:${scope}`;
    const row = this.db.prepare('SELECT response_json, request_hash FROM idempotency_commands WHERE tenant = ? AND scope = ? AND command_key = ?').get(tenant, scopedOperation, key) as { response_json: string; request_hash?: string | null } | undefined;
    return row ? { response: decode<T>(row.response_json), requestHash: row.request_hash || undefined } : undefined;
  }
  idempotencyResult<T>(tenant: string, scope: string, key: string) { return this.idempotencyRecord<T>(tenant, scope, key)?.response; }
  recordIdempotencyResult(tenant: string, scope: string, key: string, response: unknown, requestHash?: string) {
    const scopedOperation = `${this.currentStore(tenant)}:${scope}`;
    this.db.prepare('INSERT INTO idempotency_commands(tenant,scope,command_key,response_json,request_hash,created_at) VALUES (?, ?, ?, ?, ?, ?)').run(tenant, scopedOperation, key, encode(response), requestHash || null, new Date().toISOString());
  }

  private decodeEntityRow(row: Record<string, unknown>) {
    return ({
      id: String(row.id), entity: String(row.entity), tenant: String(row.tenant), status: String(row.status),
      version: Number(row.version), created_by: String(row.created_by), created_at: String(row.created_at),
      updated_at: String(row.updated_at), data: decode<Record<string, unknown>>(String(row.data_json)),
      amountPaise: row.amount_paise === null || row.amount_paise === undefined ? undefined : Number(row.amount_paise),
      amountDirection: row.amount_direction ? String(row.amount_direction) as 'DEBIT' | 'CREDIT' | 'NONE' : undefined,
      amountCurrency: row.amount_currency ? String(row.amount_currency) : 'INR',
    }) as EntityRow;
  }
  private readRows(sql: string, params: unknown[] = []) {
    return (this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((row) => this.decodeEntityRow(row));
  }

  private constrainedAmount(row: EntityRow) {
    if (row.amountPaise !== undefined) return { amountPaise: row.amountPaise, amountDirection: row.amountDirection || null, amountCurrency: row.amountCurrency || 'INR' };
    const source = row.entity === 'sales_invoice' ? row.data.grand_total
      : row.entity === 'payment_entry' ? row.data.amount
        : row.entity === 'laundry_expense' ? row.data.amount
          : row.entity === 'customer_package' ? row.data.price_paid
            : row.entity === 'laundry_wallet_entry' ? row.data.amount
              : row.entity === 'laundry_customer_ledger' ? (Number(row.data.debit || 0) > 0 ? row.data.debit : row.data.credit)
                : undefined;
    if (source === undefined || source === null || source === '') return { amountPaise: null, amountDirection: null, amountCurrency: 'INR' };
    try {
      const amountPaise = parseMoney(source, `${row.entity} amount`, { allowZero: true });
      const amountDirection = row.entity === 'laundry_customer_ledger' ? (Number(row.data.debit || 0) > 0 ? 'DEBIT' : 'CREDIT') : null;
      return { amountPaise, amountDirection, amountCurrency: 'INR' };
    } catch { return { amountPaise: null, amountDirection: null, amountCurrency: 'INR' }; }
  }

  private appendRecord(kind: string, tenant: string, id: string, payload: unknown) {
    this.db.prepare('INSERT INTO records(kind, tenant, store_id, id, payload_json) VALUES (?, ?, ?, ?, ?)').run(kind, tenant, this.currentStore(tenant), id, encode(payload));
  }

  private recordsOf<T>(kind: string, tenant: string): T[] {
    return (this.db.prepare('SELECT payload_json FROM records WHERE kind = ? AND tenant = ? AND store_id = ? ORDER BY rowid').all(kind, tenant, this.currentStore(tenant)) as Array<{ payload_json: string }>)
      .map((row) => decode<T>(row.payload_json));
  }

  all(): DbShape {
    const allRecords = <T>(kind: string) => (this.db.prepare('SELECT payload_json FROM records WHERE kind = ? ORDER BY rowid').all(kind) as Array<{ payload_json: string }>).map((row) => decode<T>(row.payload_json));
    const seq = Object.fromEntries((this.db.prepare('SELECT series, value FROM sequences').all() as Array<{ series: string; value: number }>).map((row) => [row.series, row.value]));
    return { rows: this.readRows('SELECT * FROM entity_rows ORDER BY created_at'), gl: allRecords<GLEntry>('gl'), audit: allRecords<AuditEntry>('audit'), outbox: allRecords<OutboxEvent>('outbox'), stock: allRecords<StockLedgerEntry>('stock'), ims: allRecords<ImsAction>('ims'), seq };
  }

  nextSeq(series: string): number {
    const statement = this.db.prepare('INSERT INTO sequences(series, value) VALUES (?, 1) ON CONFLICT(series) DO UPDATE SET value = value + 1 RETURNING value');
    return Number((statement.get(series) as { value: number }).value);
  }

  insertRow(row: EntityRow) {
    const amount = this.constrainedAmount(row);
    this.db.prepare('INSERT INTO entity_rows(tenant,store_id,id,entity,status,version,created_by,created_at,updated_at,data_json,amount_paise,amount_direction,amount_currency) VALUES (@tenant,@storeId,@id,@entity,@status,@version,@created_by,@created_at,@updated_at,@data_json,@amountPaise,@amountDirection,@amountCurrency)').run({ ...row, ...amount, storeId: this.currentStore(row.tenant), data_json: encode(row.data) });
  }
  updateRow(row: EntityRow) {
    const amount = this.constrainedAmount(row);
    const result = this.db.prepare('UPDATE entity_rows SET entity=@entity,status=@status,version=@version,created_by=@created_by,created_at=@created_at,updated_at=@updated_at,data_json=@data_json,amount_paise=@amountPaise,amount_direction=@amountDirection,amount_currency=@amountCurrency WHERE tenant=@tenant AND store_id=@storeId AND id=@id').run({ ...row, ...amount, storeId: this.currentStore(row.tenant), data_json: encode(row.data) });
    if (result.changes === 0) this.insertRow(row);
  }
  getRow(tenant: string, id: string) { return this.readRows('SELECT * FROM entity_rows WHERE tenant = ? AND store_id = ? AND id = ?', [tenant, this.currentStore(tenant), id])[0]; }
  rowsOf(tenant: string, entity: string) { return this.readRows('SELECT * FROM entity_rows WHERE tenant = ? AND store_id = ? AND entity = ? ORDER BY created_at', [tenant, this.currentStore(tenant), entity]); }
  private reportDateExpression(field: 'order_date' | 'posting_date' | 'expense_date' | 'created_at') { return field === 'created_at' ? 'created_at' : `json_extract(data_json, '$.${field}')`; }
  rowsOfReportDate(tenant: string, entity: string, field: 'order_date' | 'posting_date' | 'expense_date' | 'created_at', from?: string, to?: string) {
    const expression = this.reportDateExpression(field); const params: unknown[] = [tenant, this.currentStore(tenant), entity]; const clauses = ['tenant = ?', 'store_id = ?', 'entity = ?'];
    if (from) { clauses.push(`${expression} >= ?`); params.push(from); }
    if (to) { clauses.push(`${expression} <= ?`); params.push(to); }
    return this.readRows(`SELECT * FROM entity_rows WHERE ${clauses.join(' AND ')} ORDER BY created_at`, params);
  }
  *iterateRowsOfReportDate(tenant: string, entity: string, field: 'order_date' | 'posting_date' | 'expense_date' | 'created_at', from?: string, to?: string): IterableIterator<EntityRow> {
    const expression = this.reportDateExpression(field); const params: unknown[] = [tenant, this.currentStore(tenant), entity]; const clauses = ['tenant = ?', 'store_id = ?', 'entity = ?'];
    if (from) { clauses.push(`${expression} >= ?`); params.push(from); }
    if (to) { clauses.push(`${expression} <= ?`); params.push(to); }
    const rows = this.db.prepare(`SELECT * FROM entity_rows WHERE ${clauses.join(' AND ')} ORDER BY created_at`).iterate(...params) as IterableIterator<Record<string, unknown>>;
    for (const row of rows) yield this.decodeEntityRow(row);
  }
  explainRowsOfReportDate(tenant: string, entity: string, field: 'order_date' | 'posting_date' | 'expense_date' | 'created_at', from?: string, to?: string) {
    const expression = this.reportDateExpression(field); const params: unknown[] = [tenant, this.currentStore(tenant), entity]; const clauses = ['tenant = ?', 'store_id = ?', 'entity = ?'];
    if (from) { clauses.push(`${expression} >= ?`); params.push(from); }
    if (to) { clauses.push(`${expression} <= ?`); params.push(to); }
    return this.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM entity_rows WHERE ${clauses.join(' AND ')} ORDER BY created_at`).all(...params).map((row: any) => String(row.detail || ''));
  }

  appendGL(entry: GLEntry) { this.appendRecord('gl', entry.tenant, entry.id, entry); }
  glOf(tenant: string) { return this.recordsOf<GLEntry>('gl', tenant); }
  appendAudit(entry: AuditEntry) { this.appendRecord('audit', entry.tenant, entry.id, entry); }
  auditOf(tenant: string) { return this.recordsOf<AuditEntry>('audit', tenant); }
  appendOutbox(event: OutboxEvent) { this.appendRecord('outbox', event.tenant, event.id, event); }
  outboxUnpublished(tenant: string) { return this.recordsOf<OutboxEvent>('outbox', tenant).filter((event) => !event.published); }
  markPublished(id: string) {
    const row = this.db.prepare("SELECT tenant, store_id, payload_json FROM records WHERE kind = 'outbox' AND id = ?").get(id) as { tenant: string; store_id: string; payload_json: string } | undefined;
    if (!row) return;
    const event = decode<OutboxEvent>(row.payload_json);
    event.published = true;
    this.db.prepare("UPDATE records SET payload_json = ? WHERE kind = 'outbox' AND tenant = ? AND store_id = ? AND id = ?").run(encode(event), row.tenant, row.store_id, id);
  }
  appendStock(entry: StockLedgerEntry) { this.appendRecord('stock', entry.tenant, entry.id, entry); }
  stockOf(tenant: string) { return this.recordsOf<StockLedgerEntry>('stock', tenant); }
  appendIms(action: ImsAction) { this.appendRecord('ims', action.tenant, action.id, action); }
  imsOf(tenant: string) { return this.recordsOf<ImsAction>('ims', tenant); }
  snapshot(): DbShape { return this.all(); }
  snapshotFor(tenant: string, storeId: string): DbShape {
    return this.withStoreScope(tenant, storeId, () => {
      const scopedRecords = <T>(kind: string) => (this.db.prepare('SELECT payload_json FROM records WHERE kind = ? AND tenant = ? AND store_id = ? ORDER BY rowid').all(kind, tenant, storeId) as Array<{ payload_json: string }>).map((row) => decode<T>(row.payload_json));
      const seq = Object.fromEntries((this.db.prepare('SELECT series, value FROM sequences').all() as Array<{ series: string; value: number }>).map((row) => [row.series, row.value]));
      return {
        rows: this.readRows('SELECT * FROM entity_rows WHERE tenant = ? AND store_id = ? ORDER BY created_at', [tenant, storeId]),
        gl: scopedRecords<GLEntry>('gl'), audit: scopedRecords<AuditEntry>('audit'), outbox: scopedRecords<OutboxEvent>('outbox'),
        stock: scopedRecords<StockLedgerEntry>('stock'), ims: scopedRecords<ImsAction>('ims'), seq,
        garmentUnits: this.listGarmentUnits(tenant), garmentUnitEvents: this.listGarmentUnitEvents(tenant), tagReprints: this.listTagReprints(tenant), tagHistory: this.listTagHistory(tenant), printJobs: this.listPrintJobs(tenant), laundryContainers: this.listLaundryContainers(tenant), laundryContainerEvents: this.listLaundryContainerEvents(tenant), financialEntries: this.listFinancialEntries(tenant), financialDocuments: this.listFinancialDocuments(tenant), customerLedgerEntries: this.listCustomerLedgerEntries(tenant), walletEntries: this.listWalletEntries(tenant), orderHolds: this.listOrderHolds(tenant, true), customerAddresses: this.listCustomerAddresses(tenant), cashShiftCloses: this.listCashShiftCloses(tenant), financialNormalizationRuns: this.listFinancialNormalizationRuns(tenant, 10000), normalizedCustomers: this.listNormalizedCustomers(tenant), normalizedOrders: this.listNormalizedOrders(tenant),
      };
    });
  }
  replaceAll(input: DbShape) {
    this.db.exec('DELETE FROM entity_rows; DELETE FROM records; DELETE FROM sequences; DELETE FROM garment_unit_events; DELETE FROM tag_reprints; DELETE FROM tag_history; DELETE FROM tag_print_jobs; DELETE FROM laundry_container_events; DELETE FROM laundry_containers; DELETE FROM garment_units; DELETE FROM financial_entries; DELETE FROM financial_documents; DELETE FROM customer_ledger_entries; DELETE FROM wallet_entries; DELETE FROM customer_addresses; DELETE FROM laundry_order_holds; DELETE FROM cash_shift_closes; DELETE FROM financial_normalization_runs; DELETE FROM laundry_order_items; DELETE FROM laundry_orders; DELETE FROM customers; DELETE FROM compatibility_migration_runs; DELETE FROM idempotency_commands;');
    for (const row of input.rows || []) this.insertRow(row);
    for (const entry of input.gl || []) this.appendGL(entry);
    for (const entry of input.audit || []) this.appendAudit(entry);
    for (const event of input.outbox || []) this.appendOutbox(event);
    for (const entry of input.stock || []) this.appendStock(entry);
    for (const entry of input.ims || []) this.appendIms(entry);
    for (const [series, value] of Object.entries(input.seq || {})) this.db.prepare('INSERT INTO sequences(series, value) VALUES (?, ?)').run(series, value);
    for (const unit of input.garmentUnits || []) this.createGarmentUnit(unit);
    for (const event of input.garmentUnitEvents || []) this.appendGarmentUnitEvent(event);
    for (const reprint of input.tagReprints || []) this.createTagReprint(reprint);
    for (const history of input.tagHistory || []) this.createTagHistory(history);
    for (const job of input.printJobs || []) this.createPrintJob(job);
    for (const container of input.laundryContainers || []) this.createLaundryContainer(container);
    for (const event of input.laundryContainerEvents || []) this.appendLaundryContainerEvent(event);
    for (const entry of input.financialEntries || []) this.appendFinancialEntry(entry);
    for (const document of input.financialDocuments || []) this.appendFinancialDocument(document);
    for (const entry of input.customerLedgerEntries || []) this.appendCustomerLedgerEntry(entry);
    for (const entry of input.walletEntries || []) this.appendWalletEntry(entry);
    for (const address of input.customerAddresses || []) this.appendCustomerAddress(address);
    for (const hold of input.orderHolds || []) this.createOrderHold(hold);
    for (const close of input.cashShiftCloses || []) this.appendCashShiftClose(close);
    for (const run of input.financialNormalizationRuns || []) this.appendFinancialNormalizationRun(run);
    for (const customer of input.normalizedCustomers || []) this.upsertNormalizedCustomer(customer);
    for (const order of input.normalizedOrders || []) this.upsertNormalizedOrder(order);
  }
  replaceScoped(tenant: string, storeId: string, input: DbShape) {
    return this.withStoreScope(tenant, storeId, () => this.transaction(() => {
      this.db.prepare('DELETE FROM entity_rows WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM records WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM garment_unit_events WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM tag_reprints WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM tag_history WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM tag_print_jobs WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM laundry_container_events WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM laundry_containers WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM garment_units WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM financial_entries WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM financial_documents WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM customer_ledger_entries WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM wallet_entries WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM customer_addresses WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM laundry_order_holds WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM cash_shift_closes WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM financial_normalization_runs WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM laundry_order_items WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM laundry_orders WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM customers WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM compatibility_migration_runs WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM idempotency_commands WHERE tenant = ? AND scope LIKE ?').run(tenant, `${storeId}:%`);
      for (const row of input.rows || []) {
        if (String(row.tenant) !== tenant) throw new Error('backup contains a row from another tenant');
        this.insertRow({ ...row, tenant });
      }
      for (const entry of input.gl || []) { if (String(entry.tenant) !== tenant) throw new Error('backup contains GL data from another tenant'); this.appendGL({ ...entry, tenant }); }
      for (const entry of input.audit || []) { if (String(entry.tenant) !== tenant) throw new Error('backup contains audit data from another tenant'); this.appendAudit({ ...entry, tenant }); }
      for (const event of input.outbox || []) { if (String(event.tenant) !== tenant) throw new Error('backup contains outbox data from another tenant'); this.appendOutbox({ ...event, tenant }); }
      for (const entry of input.stock || []) { if (String(entry.tenant) !== tenant) throw new Error('backup contains stock data from another tenant'); this.appendStock({ ...entry, tenant }); }
      for (const entry of input.ims || []) { if (String(entry.tenant) !== tenant) throw new Error('backup contains IMS data from another tenant'); this.appendIms({ ...entry, tenant }); }
      for (const [series, value] of Object.entries(input.seq || {})) {
        const current = Number((this.db.prepare('SELECT value FROM sequences WHERE series = ?').get(series) as { value: number } | undefined)?.value || 0);
        if (Number(value) > current) this.db.prepare('INSERT INTO sequences(series, value) VALUES (?, ?) ON CONFLICT(series) DO UPDATE SET value = excluded.value').run(series, Number(value));
      }
      for (const unit of input.garmentUnits || []) { if (unit.tenant !== tenant || unit.storeId !== storeId) throw new Error('backup contains a garment unit from another store'); this.createGarmentUnit(unit); }
      for (const event of input.garmentUnitEvents || []) { if (event.tenant !== tenant || event.storeId !== storeId) throw new Error('backup contains a garment event from another store'); this.appendGarmentUnitEvent(event); }
      for (const reprint of input.tagReprints || []) { if (reprint.tenant !== tenant || reprint.storeId !== storeId) throw new Error('backup contains a tag reprint from another store'); this.createTagReprint(reprint); }
      for (const history of input.tagHistory || []) { if (history.tenant !== tenant || history.storeId !== storeId) throw new Error('backup contains tag history from another store'); this.createTagHistory(history); }
      for (const job of input.printJobs || []) { if (job.tenant !== tenant || job.storeId !== storeId) throw new Error('backup contains a print job from another store'); this.createPrintJob(job); }
      for (const container of input.laundryContainers || []) { if (container.tenant !== tenant || container.storeId !== storeId) throw new Error('backup contains a laundry container from another store'); this.createLaundryContainer(container); }
      for (const event of input.laundryContainerEvents || []) { if (event.tenant !== tenant || event.storeId !== storeId) throw new Error('backup contains a laundry container event from another store'); this.appendLaundryContainerEvent(event); }
      for (const entry of input.financialEntries || []) { if (entry.tenant !== tenant || entry.storeId !== storeId) throw new Error('backup contains a financial entry from another store'); this.appendFinancialEntry(entry); }
      for (const document of input.financialDocuments || []) { if (document.tenant !== tenant || document.storeId !== storeId) throw new Error('backup contains a financial document from another store'); this.appendFinancialDocument(document); }
      for (const entry of input.customerLedgerEntries || []) { if (entry.tenant !== tenant || entry.storeId !== storeId) throw new Error('backup contains a customer ledger entry from another store'); this.appendCustomerLedgerEntry(entry); }
      for (const entry of input.walletEntries || []) { if (entry.tenant !== tenant || entry.storeId !== storeId) throw new Error('backup contains a wallet entry from another store'); this.appendWalletEntry(entry); }
      for (const address of input.customerAddresses || []) { if (address.tenant !== tenant || address.storeId !== storeId) throw new Error('backup contains a customer address from another store'); this.appendCustomerAddress(address); }
      for (const hold of input.orderHolds || []) { if (hold.tenant !== tenant || hold.storeId !== storeId) throw new Error('backup contains an order hold from another store'); this.createOrderHold(hold); }
      for (const close of input.cashShiftCloses || []) { if (close.tenant !== tenant || close.storeId !== storeId) throw new Error('backup contains a cash shift close from another store'); this.appendCashShiftClose(close); }
      for (const run of input.financialNormalizationRuns || []) { if (run.tenant !== tenant || run.storeId !== storeId) throw new Error('backup contains normalization evidence from another store'); this.appendFinancialNormalizationRun(run); }
      for (const customer of input.normalizedCustomers || []) { if (customer.tenant !== tenant || customer.storeId !== storeId) throw new Error('backup contains a normalized customer from another store'); this.upsertNormalizedCustomer(customer); }
      for (const order of input.normalizedOrders || []) { if (order.tenant !== tenant || order.storeId !== storeId) throw new Error('backup contains a normalized order from another store'); this.upsertNormalizedOrder(order); }
      return { rows: (input.rows || []).length };
    }));
  }

  private garmentUnitFromRow(row: Record<string, unknown>): GarmentUnitRecord {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), code: String(row.code), orderId: String(row.order_id),
      itemIndex: Number(row.item_index), sequence: Number(row.sequence), customerId: String(row.customer_id), garmentId: String(row.garment_id),
      serviceId: String(row.service_id), unit: String(row.unit), state: String(row.state), location: String(row.location),
      activeTagCode: String(row.active_tag_code), condition: String(row.condition), createdBy: String(row.created_by),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }
  createGarmentUnit(unit: GarmentUnitRecord) {
    this.db.prepare(`INSERT INTO garment_units(id,tenant,store_id,code,order_id,item_index,sequence,customer_id,garment_id,service_id,unit,state,location,active_tag_code,condition,created_by,created_at,updated_at)
      VALUES (@id,@tenant,@storeId,@code,@orderId,@itemIndex,@sequence,@customerId,@garmentId,@serviceId,@unit,@state,@location,@activeTagCode,@condition,@createdBy,@createdAt,@updatedAt)`).run(unit);
    return unit;
  }
  getGarmentUnit(tenant: string, idOrCode: string) {
    const value = String(idOrCode || '').trim();
    if (!value) return undefined;
    const row = this.db.prepare('SELECT * FROM garment_units WHERE tenant = ? AND store_id = ? AND (id = ? OR code = ? OR active_tag_code = ?)').get(tenant, this.currentStore(tenant), value, value, value) as Record<string, unknown> | undefined;
    return row ? this.garmentUnitFromRow(row) : undefined;
  }
  getGarmentUnitByTag(tenant: string, tagCode: string) {
    const value = String(tagCode || '').trim();
    if (!value) return undefined;
    const row = this.db.prepare('SELECT * FROM garment_units WHERE tenant = ? AND store_id = ? AND active_tag_code = ?').get(tenant, this.currentStore(tenant), value) as Record<string, unknown> | undefined;
    return row ? this.garmentUnitFromRow(row) : undefined;
  }
  listGarmentUnits(tenant: string, filters: { orderId?: string; state?: string; search?: string } = {}) {
    const orderBy = filters.orderId ? 'item_index ASC, sequence ASC' : 'updated_at DESC, created_at DESC';
    const rows = this.db.prepare(`SELECT * FROM garment_units WHERE tenant = ? AND store_id = ? ORDER BY ${orderBy}`).all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    const search = String(filters.search || '').trim().toLowerCase();
    return rows.map((row) => this.garmentUnitFromRow(row)).filter((unit) => (!filters.orderId || unit.orderId === filters.orderId) && (!filters.state || unit.state === filters.state) && (!search || `${unit.id} ${unit.code} ${unit.activeTagCode} ${unit.orderId}`.toLowerCase().includes(search)));
  }
  updateGarmentUnit(unit: GarmentUnitRecord) {
    this.db.prepare('UPDATE garment_units SET state=@state, location=@location, active_tag_code=@activeTagCode, condition=@condition, updated_at=@updatedAt WHERE tenant=@tenant AND store_id=@storeId AND id=@id').run(unit);
    return unit;
  }
  appendGarmentUnitEvent(event: GarmentUnitEventRecord) {
    this.db.prepare(`INSERT INTO garment_unit_events(id,tenant,store_id,unit_id,event,from_state,to_state,location,actor,note,metadata_json,created_at)
      VALUES (@id,@tenant,@storeId,@unitId,@event,@fromState,@toState,@location,@actor,@note,@metadataJson,@createdAt)`).run({ ...event, fromState: event.fromState || null, toState: event.toState || null, location: event.location || null, note: event.note || null, metadataJson: encode(event.metadata || {}) });
    return event;
  }
  listGarmentUnitEvents(tenant: string, unitId?: string) {
    const rows = this.db.prepare('SELECT * FROM garment_unit_events WHERE tenant = ? AND store_id = ? ORDER BY created_at').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => !unitId || String(row.unit_id) === unitId).map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), unitId: String(row.unit_id), event: String(row.event), fromState: row.from_state ? String(row.from_state) : undefined, toState: row.to_state ? String(row.to_state) : undefined, location: row.location ? String(row.location) : undefined, actor: String(row.actor), note: row.note ? String(row.note) : undefined, metadata: row.metadata_json ? decode<Record<string, unknown>>(String(row.metadata_json)) : {}, createdAt: String(row.created_at) } satisfies GarmentUnitEventRecord));
  }
  createTagReprint(reprint: TagReprintRecord) {
    this.db.prepare(`INSERT INTO tag_reprints(id,tenant,store_id,unit_id,previous_tag_code,new_tag_code,station,reason,actor,created_at)
      VALUES (@id,@tenant,@storeId,@unitId,@previousTagCode,@newTagCode,@station,@reason,@actor,@createdAt)`).run(reprint);
    return reprint;
  }
  listTagReprints(tenant: string, unitId?: string) {
    const rows = this.db.prepare('SELECT * FROM tag_reprints WHERE tenant = ? AND store_id = ? ORDER BY created_at').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => !unitId || String(row.unit_id) === unitId).map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), unitId: String(row.unit_id), previousTagCode: String(row.previous_tag_code), newTagCode: String(row.new_tag_code), station: String(row.station), reason: String(row.reason), actor: String(row.actor), createdAt: String(row.created_at) } satisfies TagReprintRecord));
  }
  private tagHistoryFromRow(row: Record<string, unknown>): TagHistoryRecord {
    return { id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), garmentUnitId: String(row.garment_unit_id), tagCode: String(row.tag_code), status: String(row.status) as TagHistoryStatus, issuedAt: String(row.issued_at), issuedBy: String(row.issued_by), retiredAt: row.retired_at ? String(row.retired_at) : undefined, retiredBy: row.retired_by ? String(row.retired_by) : undefined, retirementReason: row.retirement_reason ? String(row.retirement_reason) : undefined, replacementTagId: row.replacement_tag_id ? String(row.replacement_tag_id) : undefined, version: Number(row.version), createdAt: String(row.created_at) };
  }
  createTagHistory(history: TagHistoryRecord) {
    this.db.prepare(`INSERT INTO tag_history(id,tenant,store_id,garment_unit_id,tag_code,status,issued_at,issued_by,retired_at,retired_by,retirement_reason,replacement_tag_id,version,created_at)
      VALUES (@id,@tenant,@storeId,@garmentUnitId,@tagCode,@status,@issuedAt,@issuedBy,@retiredAt,@retiredBy,@retirementReason,@replacementTagId,@version,@createdAt)`).run({ ...history, storeId: history.storeId || this.currentStore(history.tenant), retiredAt: history.retiredAt || null, retiredBy: history.retiredBy || null, retirementReason: history.retirementReason || null, replacementTagId: history.replacementTagId || null });
    return history;
  }
  getTagHistoryByCode(tenant: string, tagCode: string) {
    const row = this.db.prepare('SELECT * FROM tag_history WHERE tenant = ? AND store_id = ? AND tag_code = ?').get(tenant, this.currentStore(tenant), String(tagCode || '').trim()) as Record<string, unknown> | undefined;
    return row ? this.tagHistoryFromRow(row) : undefined;
  }
  listTagHistory(tenant: string, unitId?: string) {
    const rows = this.db.prepare('SELECT * FROM tag_history WHERE tenant = ? AND store_id = ? ORDER BY created_at DESC').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.tagHistoryFromRow(row)).filter((row) => !unitId || row.garmentUnitId === unitId);
  }
  updateTagHistory(history: TagHistoryRecord) {
    this.db.prepare(`UPDATE tag_history SET status=@status,retired_at=@retiredAt,retired_by=@retiredBy,retirement_reason=@retirementReason,replacement_tag_id=@replacementTagId,version=@version WHERE tenant=@tenant AND store_id=@storeId AND id=@id`).run({ ...history, retiredAt: history.retiredAt || null, retiredBy: history.retiredBy || null, retirementReason: history.retirementReason || null, replacementTagId: history.replacementTagId || null });
    return history;
  }
  private printJobFromRow(row: Record<string, unknown>): TagPrintJobRecord {
    return { id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), orderId: String(row.order_id), templateId: String(row.template_id), templateVersion: String(row.template_version), printerProfile: String(row.printer_profile), tagIds: decode<string[]>(String(row.tag_ids_json)), documentType: String(row.document_type), requestedCopies: Number(row.requested_copies), requestedBy: String(row.requested_by), createdAt: String(row.created_at), status: String(row.status) as TagPrintJobStatus, startedAt: row.started_at ? String(row.started_at) : undefined, completedAt: row.completed_at ? String(row.completed_at) : undefined, failureReason: row.failure_reason ? String(row.failure_reason) : undefined, outputHash: row.output_hash ? String(row.output_hash) : undefined, evidence: row.evidence ? String(row.evidence) : undefined };
  }
  createPrintJob(job: TagPrintJobRecord) {
    this.db.prepare(`INSERT INTO tag_print_jobs(id,tenant,store_id,order_id,template_id,template_version,printer_profile,tag_ids_json,document_type,requested_copies,requested_by,created_at,status,started_at,completed_at,failure_reason,output_hash,evidence)
      VALUES (@id,@tenant,@storeId,@orderId,@templateId,@templateVersion,@printerProfile,@tagIdsJson,@documentType,@requestedCopies,@requestedBy,@createdAt,@status,@startedAt,@completedAt,@failureReason,@outputHash,@evidence)`).run({ ...job, storeId: job.storeId || this.currentStore(job.tenant), tagIdsJson: encode(job.tagIds), startedAt: job.startedAt || null, completedAt: job.completedAt || null, failureReason: job.failureReason || null, outputHash: job.outputHash || null, evidence: job.evidence || null });
    return job;
  }
  listPrintJobs(tenant: string, orderId?: string) {
    const rows = this.db.prepare('SELECT * FROM tag_print_jobs WHERE tenant = ? AND store_id = ? ORDER BY created_at DESC').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.printJobFromRow(row)).filter((row) => !orderId || row.orderId === orderId);
  }
  private laundryContainerFromRow(row: Record<string, unknown>): LaundryContainerRecord {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), orderId: String(row.order_id), customerId: String(row.customer_id),
      sequence: Number(row.sequence), total: Number(row.total), weightKg: row.weight_milli === null || row.weight_milli === undefined ? undefined : Number(row.weight_milli) / 1000,
      tagCode: String(row.tag_code), state: String(row.state) as LaundryContainerState, location: String(row.location), condition: String(row.condition),
      createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at), deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    };
  }
  createLaundryContainer(container: LaundryContainerRecord) {
    const weightMilli = container.weightKg === undefined ? null : Math.round(container.weightKg * 1000);
    this.db.prepare(`INSERT INTO laundry_containers(id,tenant,store_id,order_id,customer_id,sequence,total,weight_milli,tag_code,state,location,condition,created_by,created_at,updated_at,delivered_at)
      VALUES (@id,@tenant,@storeId,@orderId,@customerId,@sequence,@total,@weightMilli,@tagCode,@state,@location,@condition,@createdBy,@createdAt,@updatedAt,@deliveredAt)`).run({ ...container, storeId: container.storeId || this.currentStore(container.tenant), weightMilli, deliveredAt: container.deliveredAt || null });
    return container;
  }
  getLaundryContainer(tenant: string, idOrTag: string) {
    const value = String(idOrTag || '').trim();
    if (!value) return undefined;
    const row = this.db.prepare('SELECT * FROM laundry_containers WHERE tenant = ? AND store_id = ? AND (id = ? OR tag_code = ?)').get(tenant, this.currentStore(tenant), value, value) as Record<string, unknown> | undefined;
    return row ? this.laundryContainerFromRow(row) : undefined;
  }
  listLaundryContainers(tenant: string, orderId?: string) {
    const rows = this.db.prepare('SELECT * FROM laundry_containers WHERE tenant = ? AND store_id = ? ORDER BY order_id, sequence').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.laundryContainerFromRow(row)).filter((row) => !orderId || row.orderId === orderId);
  }
  updateLaundryContainer(container: LaundryContainerRecord) {
    this.db.prepare('UPDATE laundry_containers SET state=@state,location=@location,condition=@condition,updated_at=@updatedAt,delivered_at=@deliveredAt WHERE tenant=@tenant AND store_id=@storeId AND id=@id').run({ ...container, deliveredAt: container.deliveredAt || null });
    return container;
  }
  appendLaundryContainerEvent(event: LaundryContainerEventRecord) {
    this.db.prepare(`INSERT INTO laundry_container_events(id,tenant,store_id,container_id,event,from_state,to_state,location,actor,note,created_at)
      VALUES (@id,@tenant,@storeId,@containerId,@event,@fromState,@toState,@location,@actor,@note,@createdAt)`).run({ ...event, storeId: event.storeId || this.currentStore(event.tenant), fromState: event.fromState || null, toState: event.toState || null, location: event.location || null, note: event.note || null });
    return event;
  }
  listLaundryContainerEvents(tenant: string, containerId?: string) {
    const rows = this.db.prepare('SELECT * FROM laundry_container_events WHERE tenant = ? AND store_id = ? ORDER BY created_at').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => !containerId || String(row.container_id) === containerId).map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), containerId: String(row.container_id), event: String(row.event), fromState: row.from_state ? String(row.from_state) as LaundryContainerState : undefined, toState: row.to_state ? String(row.to_state) as LaundryContainerState : undefined, location: row.location ? String(row.location) : undefined, actor: String(row.actor), note: row.note ? String(row.note) : undefined, createdAt: String(row.created_at) } satisfies LaundryContainerEventRecord));
  }
  appendFinancialEntry(entry: FinancialEntryRecord) {
    if (!Number.isInteger(entry.amountPaise) || entry.amountPaise < 0) throw new Error('financial entry amount must be a non-negative integer number of paise');
    if (!['IN', 'OUT'].includes(entry.direction)) throw new Error('financial entry direction is invalid');
    this.db.prepare(`INSERT INTO financial_entries(id,tenant,store_id,kind,source_entity,source_id,direction,amount_paise,currency,occurred_at,actor,metadata_json)
      VALUES (@id,@tenant,@storeId,@kind,@sourceEntity,@sourceId,@direction,@amountPaise,@currency,@occurredAt,@actor,@metadataJson)`).run({ ...entry, storeId: entry.storeId || this.currentStore(entry.tenant), currency: entry.currency || 'INR', metadataJson: encode(entry.metadata || {}) });
    return entry;
  }
  listFinancialEntries(tenant: string, filters: { kind?: string; sourceId?: string } = {}) {
    const rows = this.db.prepare('SELECT * FROM financial_entries WHERE tenant = ? AND store_id = ? ORDER BY occurred_at, rowid').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => (!filters.kind || String(row.kind) === filters.kind) && (!filters.sourceId || String(row.source_id) === filters.sourceId)).map((row) => ({
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), kind: String(row.kind), sourceEntity: String(row.source_entity), sourceId: String(row.source_id), direction: String(row.direction) as 'IN' | 'OUT', amountPaise: Number(row.amount_paise), currency: String(row.currency), occurredAt: String(row.occurred_at), actor: String(row.actor), metadata: row.metadata_json ? decode<Record<string, unknown>>(String(row.metadata_json)) : {},
    } satisfies FinancialEntryRecord));
  }

  /**
   * Canonical fixed-scale amount for a financial source. Domain code should
   * use this for reads once the source has a normalized journal row; the
   * legacy JSON field remains only as a migration fallback for old records.
   */
  financialEntryAmountPaise(tenant: string, kind: string, sourceEntity: string, sourceId: string) {
    const row = this.db.prepare('SELECT amount_paise FROM financial_entries WHERE tenant = ? AND store_id = ? AND kind = ? AND source_entity = ? AND source_id = ?').get(tenant, this.currentStore(tenant), kind, sourceEntity, sourceId) as { amount_paise?: number } | undefined;
    return row ? Number(row.amount_paise) : undefined;
  }

  appendFinancialDocument(document: FinancialDocumentRecord) {
    if (!Number.isInteger(document.amountPaise) || document.amountPaise < 0) throw new Error('financial document amount must be a non-negative integer number of paise');
    const storeId = document.storeId || this.currentStore(document.tenant);
    this.db.prepare(`INSERT INTO financial_documents(id,tenant,store_id,document_type,source_entity,source_id,amount_paise,currency,status,occurred_at,actor,metadata_json)
      VALUES (@id,@tenant,@storeId,@documentType,@sourceEntity,@sourceId,@amountPaise,@currency,@status,@occurredAt,@actor,@metadataJson)
      ON CONFLICT(tenant,store_id,document_type,source_entity,source_id) DO UPDATE SET amount_paise=excluded.amount_paise,currency=excluded.currency,status=excluded.status,occurred_at=excluded.occurred_at,actor=excluded.actor,metadata_json=excluded.metadata_json`).run({ ...document, storeId, currency: document.currency || 'INR', metadataJson: encode(document.metadata || {}) });
    return document;
  }
  listFinancialDocuments(tenant: string, filters: { documentType?: string; sourceId?: string } = {}) {
    const rows = this.db.prepare('SELECT * FROM financial_documents WHERE tenant = ? AND store_id = ? ORDER BY occurred_at, rowid').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => (!filters.documentType || String(row.document_type) === filters.documentType) && (!filters.sourceId || String(row.source_id) === filters.sourceId)).map((row) => ({
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), documentType: String(row.document_type), sourceEntity: String(row.source_entity), sourceId: String(row.source_id), amountPaise: Number(row.amount_paise), currency: String(row.currency), status: String(row.status), occurredAt: String(row.occurred_at), actor: String(row.actor), metadata: row.metadata_json ? decode<Record<string, unknown>>(String(row.metadata_json)) : {},
    } satisfies FinancialDocumentRecord));
  }

  /** Return the normalized invoice/payment/package/expense amount, if present. */
  financialDocumentAmountPaise(tenant: string, documentType: string, sourceEntity: string, sourceId: string) {
    const row = this.db.prepare('SELECT amount_paise FROM financial_documents WHERE tenant = ? AND store_id = ? AND document_type = ? AND source_entity = ? AND source_id = ?').get(tenant, this.currentStore(tenant), documentType, sourceEntity, sourceId) as { amount_paise?: number } | undefined;
    return row ? Number(row.amount_paise) : undefined;
  }

  appendFinancialNormalizationRun(run: FinancialNormalizationRun) {
    this.db.prepare(`INSERT INTO financial_normalization_runs(
      id,tenant,store_id,actor,status,candidates,ledger_candidates,cash_close_candidates,
      documents_applied,entries_applied,ledger_entries_applied,wallet_entries_applied,cash_close_snapshots_applied,
      source_columns_applied,reconciliation_status,reconciliation_issue_count,created_at
    ) VALUES (@id,@tenant,@storeId,@actor,@status,@candidates,@ledgerCandidates,@cashCloseCandidates,
      @documentsApplied,@entriesApplied,@ledgerEntriesApplied,@walletEntriesApplied,@cashCloseSnapshotsApplied,
      @sourceColumnsApplied,@reconciliationStatus,@reconciliationIssueCount,@createdAt)
      ON CONFLICT(id) DO NOTHING`).run({ ...run });
    return run;
  }

  listFinancialNormalizationRuns(tenant: string, limit = 20) {
    const safeLimit = Math.max(1, Math.min(10000, Math.trunc(limit)));
    const rows = this.db.prepare(`SELECT * FROM financial_normalization_runs WHERE tenant = ? AND store_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${safeLimit}`).all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), actor: String(row.actor), status: 'certified' as const,
      candidates: Number(row.candidates), ledgerCandidates: Number(row.ledger_candidates), cashCloseCandidates: Number(row.cash_close_candidates),
      documentsApplied: Number(row.documents_applied), entriesApplied: Number(row.entries_applied), ledgerEntriesApplied: Number(row.ledger_entries_applied), walletEntriesApplied: Number(row.wallet_entries_applied || 0),
      cashCloseSnapshotsApplied: Number(row.cash_close_snapshots_applied), sourceColumnsApplied: Number(row.source_columns_applied),
      reconciliationStatus: String(row.reconciliation_status), reconciliationIssueCount: Number(row.reconciliation_issue_count), createdAt: String(row.created_at),
    } satisfies FinancialNormalizationRun));
  }

  appendCustomerLedgerEntry(entry: CustomerLedgerRecord) {
    if (!Number.isInteger(entry.debitPaise) || !Number.isInteger(entry.creditPaise) || (entry.debitPaise === 0) === (entry.creditPaise === 0) || (entry.debitPaise > 0 && entry.creditPaise > 0)) throw new Error('customer ledger amounts must contain exactly one positive integer-paise side');
    const storeId = entry.storeId || this.currentStore(entry.tenant);
    this.db.prepare(`INSERT INTO customer_ledger_entries(id,tenant,store_id,customer_id,entry_type,debit_paise,credit_paise,entry_date,reference_type,reference_id,reason,actor,created_at)
      VALUES (@id,@tenant,@storeId,@customerId,@entryType,@debitPaise,@creditPaise,@entryDate,@referenceType,@referenceId,@reason,@actor,@createdAt)
      ON CONFLICT(id) DO UPDATE SET debit_paise=excluded.debit_paise,credit_paise=excluded.credit_paise,entry_date=excluded.entry_date,reference_type=excluded.reference_type,reference_id=excluded.reference_id,reason=excluded.reason,actor=excluded.actor`).run({ ...entry, storeId, referenceType: entry.referenceType || '', referenceId: entry.referenceId || '', reason: entry.reason || '' });
    return entry;
  }
  listCustomerLedgerEntries(tenant: string, customerId?: string) {
    const rows = this.db.prepare('SELECT * FROM customer_ledger_entries WHERE tenant = ? AND store_id = ? ORDER BY entry_date DESC, rowid DESC').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => !customerId || String(row.customer_id) === customerId).map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), customerId: String(row.customer_id), entryType: String(row.entry_type), debitPaise: Number(row.debit_paise), creditPaise: Number(row.credit_paise), entryDate: String(row.entry_date), referenceType: String(row.reference_type || ''), referenceId: String(row.reference_id || ''), reason: String(row.reason || ''), actor: String(row.actor), createdAt: String(row.created_at) } satisfies CustomerLedgerRecord));
  }
  appendWalletEntry(entry: WalletEntryRecord) {
    if (!Number.isInteger(entry.amountPaise) || entry.amountPaise <= 0) throw new Error('wallet amount must be a positive integer number of paise');
    const storeId = entry.storeId || this.currentStore(entry.tenant);
    this.db.prepare(`INSERT INTO wallet_entries(id,tenant,store_id,customer_id,entry_type,amount_paise,entry_date,reference_type,reference_id,reason,actor,created_at)
      VALUES (@id,@tenant,@storeId,@customerId,@entryType,@amountPaise,@entryDate,@referenceType,@referenceId,@reason,@actor,@createdAt)
      ON CONFLICT(id) DO UPDATE SET entry_type=excluded.entry_type,amount_paise=excluded.amount_paise,entry_date=excluded.entry_date,reference_type=excluded.reference_type,reference_id=excluded.reference_id,reason=excluded.reason,actor=excluded.actor`).run({ ...entry, storeId, referenceType: entry.referenceType || '', referenceId: entry.referenceId || '', reason: entry.reason || '' });
    return entry;
  }
  listWalletEntries(tenant: string, customerId?: string) {
    const rows = this.db.prepare('SELECT * FROM wallet_entries WHERE tenant = ? AND store_id = ? ORDER BY entry_date DESC, rowid DESC').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => !customerId || String(row.customer_id) === customerId).map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), customerId: String(row.customer_id), entryType: String(row.entry_type), amountPaise: Number(row.amount_paise), entryDate: String(row.entry_date), referenceType: String(row.reference_type || ''), referenceId: String(row.reference_id || ''), reason: String(row.reason || ''), actor: String(row.actor), createdAt: String(row.created_at) } satisfies WalletEntryRecord));
  }

  appendCustomerAddress(address: CustomerAddressRecord) {
    if (!address.customerId || !address.line1) throw new Error('customer address requires a customer and line1');
    const storeId = address.storeId || this.currentStore(address.tenant);
    this.db.prepare(`INSERT INTO customer_addresses(id,tenant,store_id,customer_id,label,line1,line2,city,state,postal_code,is_default,active,created_at,updated_at,actor)
      VALUES (@id,@tenant,@storeId,@customerId,@label,@line1,@line2,@city,@state,@postalCode,@isDefault,@active,@createdAt,@updatedAt,@actor)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label,line1=excluded.line1,line2=excluded.line2,city=excluded.city,state=excluded.state,postal_code=excluded.postal_code,is_default=excluded.is_default,active=excluded.active,updated_at=excluded.updated_at,actor=excluded.actor`).run({ ...address, storeId, line2: address.line2 || '', city: address.city || '', state: address.state || '', postalCode: address.postalCode || '', isDefault: address.isDefault ? 1 : 0, active: address.active === false ? 0 : 1 });
    return address;
  }
  listCustomerAddresses(tenant: string, customerId?: string) {
    const rows = this.db.prepare('SELECT * FROM customer_addresses WHERE tenant = ? AND store_id = ? ORDER BY is_default DESC, active DESC, updated_at DESC').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.filter((row) => !customerId || String(row.customer_id) === customerId).map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), customerId: String(row.customer_id), label: String(row.label), line1: String(row.line1), line2: String(row.line2 || ''), city: String(row.city || ''), state: String(row.state || ''), postalCode: String(row.postal_code || ''), isDefault: Boolean(row.is_default), active: Boolean(row.active), createdAt: String(row.created_at), updatedAt: String(row.updated_at), actor: String(row.actor) } satisfies CustomerAddressRecord));
  }
  setCustomerAddressDefault(tenant: string, customerId: string, addressId: string) {
    const storeId = this.currentStore(tenant);
    this.db.prepare('UPDATE customer_addresses SET is_default = 0, updated_at = ? WHERE tenant = ? AND store_id = ? AND customer_id = ? AND active = 1').run(new Date().toISOString(), tenant, storeId, customerId);
    this.db.prepare('UPDATE customer_addresses SET is_default = 1, active = 1, updated_at = ? WHERE tenant = ? AND store_id = ? AND customer_id = ? AND id = ?').run(new Date().toISOString(), tenant, storeId, customerId, addressId);
  }
  archiveCustomerAddress(tenant: string, customerId: string, addressId: string) {
    const storeId = this.currentStore(tenant);
    this.db.prepare('UPDATE customer_addresses SET active = 0, is_default = 0, updated_at = ? WHERE tenant = ? AND store_id = ? AND customer_id = ? AND id = ?').run(new Date().toISOString(), tenant, storeId, customerId, addressId);
  }

  private normalizedCustomerFromRow(row: Record<string, unknown>): NormalizedCustomerRecord {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), name: String(row.name), phone: String(row.phone),
      email: String(row.email || ''), address: String(row.address || ''), notes: String(row.notes || ''), preferredContact: String(row.preferred_contact || 'Phone'),
      servicePreferences: String(row.service_preferences || ''), marketingConsent: Boolean(row.marketing_consent), sourceVersion: Number(row.source_version),
      sourceUpdatedAt: String(row.source_updated_at), sourceHash: String(row.source_hash), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }

  upsertNormalizedCustomer(customer: NormalizedCustomerRecord) {
    if (!customer.id || !customer.tenant || !customer.storeId || !customer.name || !customer.phone) throw new Error('normalized customer requires identity, name and phone');
    if (!Number.isSafeInteger(customer.sourceVersion) || customer.sourceVersion < 1) throw new Error('normalized customer source version is invalid');
    this.db.prepare(`INSERT INTO customers(
      id,tenant,store_id,name,phone,email,address,notes,preferred_contact,service_preferences,marketing_consent,
      source_version,source_updated_at,source_hash,created_at,updated_at
    ) VALUES (@id,@tenant,@storeId,@name,@phone,@email,@address,@notes,@preferredContact,@servicePreferences,@marketingConsent,
      @sourceVersion,@sourceUpdatedAt,@sourceHash,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,email=excluded.email,address=excluded.address,
      notes=excluded.notes,preferred_contact=excluded.preferred_contact,service_preferences=excluded.service_preferences,
      marketing_consent=excluded.marketing_consent,source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,
      source_hash=excluded.source_hash,updated_at=excluded.updated_at`).run({ ...customer, marketingConsent: customer.marketingConsent ? 1 : 0 });
    const saved = this.db.prepare('SELECT * FROM customers WHERE id = ? AND tenant = ? AND store_id = ?').get(customer.id, customer.tenant, customer.storeId) as Record<string, unknown> | undefined;
    if (!saved) throw new Error('normalized customer could not be persisted');
    return this.normalizedCustomerFromRow(saved);
  }

  listNormalizedCustomers(tenant: string) {
    const rows = this.db.prepare('SELECT * FROM customers WHERE tenant = ? AND store_id = ? ORDER BY created_at, id').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.normalizedCustomerFromRow(row));
  }

  private normalizedOrderItemsFromRows(rows: Array<Record<string, unknown>>): NormalizedOrderItemRecord[] {
    return rows.map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), orderId: String(row.order_id), itemIndex: Number(row.item_index), garmentId: String(row.garment_id), serviceId: String(row.service_id), unit: String(row.unit), quantityMilli: Number(row.quantity_milli), ratePaise: Number(row.rate_paise), amountPaise: Number(row.amount_paise), data: decode<Record<string, unknown>>(String(row.data_json)) }));
  }
  private normalizedOrderFromRow(row: Record<string, unknown>, items: NormalizedOrderItemRecord[]): NormalizedOrderRecord {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), customerId: String(row.customer_id), orderNumber: String(row.order_number),
      state: String(row.state), orderDate: String(row.order_date), expectedDeliveryDate: String(row.expected_delivery_date), fulfillmentMode: String(row.fulfillment_mode),
      grandTotalPaise: Number(row.grand_total_paise), paymentStatus: String(row.payment_status), data: decode<Record<string, unknown>>(String(row.data_json)),
      sourceVersion: Number(row.source_version), sourceUpdatedAt: String(row.source_updated_at), sourceHash: String(row.source_hash), createdAt: String(row.created_at), updatedAt: String(row.updated_at), items,
    };
  }
  upsertNormalizedOrder(order: NormalizedOrderRecord) {
    if (!order.id || !order.tenant || !order.storeId || !order.customerId || !order.orderNumber) throw new Error('normalized order requires identity, customer and order number');
    if (!Number.isSafeInteger(order.sourceVersion) || order.sourceVersion < 1) throw new Error('normalized order source version is invalid');
    if (!Number.isSafeInteger(order.grandTotalPaise) || order.grandTotalPaise < 0) throw new Error('normalized order total is invalid');
    this.db.prepare(`INSERT INTO laundry_orders(
      id,tenant,store_id,customer_id,order_number,state,order_date,expected_delivery_date,fulfillment_mode,
      grand_total_paise,payment_status,data_json,source_version,source_updated_at,source_hash,created_at,updated_at
    ) VALUES (@id,@tenant,@storeId,@customerId,@orderNumber,@state,@orderDate,@expectedDeliveryDate,@fulfillmentMode,
      @grandTotalPaise,@paymentStatus,@dataJson,@sourceVersion,@sourceUpdatedAt,@sourceHash,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,order_number=excluded.order_number,state=excluded.state,
      order_date=excluded.order_date,expected_delivery_date=excluded.expected_delivery_date,fulfillment_mode=excluded.fulfillment_mode,
      grand_total_paise=excluded.grand_total_paise,payment_status=excluded.payment_status,data_json=excluded.data_json,
      source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,source_hash=excluded.source_hash,updated_at=excluded.updated_at`).run({ ...order, dataJson: encode(order.data) });
    this.db.prepare('DELETE FROM laundry_order_items WHERE tenant = ? AND store_id = ? AND order_id = ?').run(order.tenant, order.storeId, order.id);
    const insert = this.db.prepare(`INSERT INTO laundry_order_items(id,tenant,store_id,order_id,item_index,garment_id,service_id,unit,quantity_milli,rate_paise,amount_paise,data_json)
      VALUES (@id,@tenant,@storeId,@orderId,@itemIndex,@garmentId,@serviceId,@unit,@quantityMilli,@ratePaise,@amountPaise,@dataJson)`);
    for (const item of order.items) {
      if (!Number.isSafeInteger(item.itemIndex) || item.itemIndex < 0 || !Number.isSafeInteger(item.quantityMilli) || item.quantityMilli <= 0 || !Number.isSafeInteger(item.ratePaise) || item.ratePaise < 0 || !Number.isSafeInteger(item.amountPaise) || item.amountPaise < 0) throw new Error('normalized order item has invalid fixed-scale values');
      insert.run({ ...item, dataJson: encode(item.data || {}) });
    }
    const saved = this.db.prepare('SELECT * FROM laundry_orders WHERE id = ? AND tenant = ? AND store_id = ?').get(order.id, order.tenant, order.storeId) as Record<string, unknown> | undefined;
    if (!saved) throw new Error('normalized order could not be persisted');
    const savedItems = this.db.prepare('SELECT * FROM laundry_order_items WHERE tenant = ? AND store_id = ? AND order_id = ? ORDER BY item_index').all(order.tenant, order.storeId, order.id) as Array<Record<string, unknown>>;
    return this.normalizedOrderFromRow(saved, this.normalizedOrderItemsFromRows(savedItems));
  }
  listNormalizedOrders(tenant: string) {
    const rows = this.db.prepare('SELECT * FROM laundry_orders WHERE tenant = ? AND store_id = ? ORDER BY order_date, id').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.normalizedOrderFromRow(row, this.normalizedOrderItemsFromRows(this.db.prepare('SELECT * FROM laundry_order_items WHERE tenant = ? AND store_id = ? AND order_id = ? ORDER BY item_index').all(tenant, this.currentStore(tenant), String(row.id)) as Array<Record<string, unknown>>)));
  }

  appendCompatibilityMigrationRun(run: CompatibilityMigrationRun) {
    this.db.prepare(`INSERT INTO compatibility_migration_runs(id,tenant,store_id,entity,status,cursor,total,applied,invalid,conflicts,source_hash,actor,started_at,updated_at,completed_at,error)
      VALUES (@id,@tenant,@storeId,@entity,@status,@cursor,@total,@applied,@invalid,@conflicts,@sourceHash,@actor,@startedAt,@updatedAt,@completedAt,@error)`).run({ ...run, completedAt: run.completedAt || null, error: run.error || null });
    return run;
  }
  updateCompatibilityMigrationRun(run: CompatibilityMigrationRun) {
    this.db.prepare(`UPDATE compatibility_migration_runs SET status=@status,cursor=@cursor,total=@total,applied=@applied,invalid=@invalid,conflicts=@conflicts,source_hash=@sourceHash,updated_at=@updatedAt,completed_at=@completedAt,error=@error WHERE id=@id AND tenant=@tenant AND store_id=@storeId`).run({ ...run, completedAt: run.completedAt || null, error: run.error || null });
    return run;
  }
  latestCompatibilityMigrationRun(tenant: string, entity: string): CompatibilityMigrationRun | undefined {
    const row = this.db.prepare('SELECT * FROM compatibility_migration_runs WHERE tenant = ? AND store_id = ? AND entity = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(tenant, this.currentStore(tenant), entity) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), entity: String(row.entity), status: String(row.status) as CompatibilityMigrationRun['status'], cursor: Number(row.cursor), total: Number(row.total), applied: Number(row.applied), invalid: Number(row.invalid), conflicts: Number(row.conflicts), sourceHash: String(row.source_hash), actor: String(row.actor), startedAt: String(row.started_at), updatedAt: String(row.updated_at), completedAt: row.completed_at ? String(row.completed_at) : undefined, error: row.error ? String(row.error) : undefined } satisfies CompatibilityMigrationRun;
  }
  listCompatibilityMigrationRuns(tenant: string, entity?: string): CompatibilityMigrationRun[] {
    const rows = this.db.prepare(`SELECT * FROM compatibility_migration_runs WHERE tenant = ? AND store_id = ? ${entity ? 'AND entity = ?' : ''} ORDER BY started_at DESC, rowid DESC`).all(...(entity ? [tenant, this.currentStore(tenant), entity] : [tenant, this.currentStore(tenant)])) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), entity: String(row.entity), status: String(row.status) as CompatibilityMigrationRun['status'], cursor: Number(row.cursor), total: Number(row.total), applied: Number(row.applied), invalid: Number(row.invalid), conflicts: Number(row.conflicts), sourceHash: String(row.source_hash), actor: String(row.actor), startedAt: String(row.started_at), updatedAt: String(row.updated_at), completedAt: row.completed_at ? String(row.completed_at) : undefined, error: row.error ? String(row.error) : undefined } satisfies CompatibilityMigrationRun));
  }

  createOrderHold(input: LaundryOrderHoldRecord) {
    const storeId = input.storeId || this.currentStore(input.tenant);
    const now = input.createdAt || new Date().toISOString();
    const id = input.id || randomUUID();
    const holdCode = input.holdCode || `HLD-${now.replace(/\D/g, '').slice(-12)}-${id.slice(0, 6).toUpperCase()}`;
    const ownershipUpdatedAt = input.ownershipUpdatedAt || now;
    const hold: LaundryOrderHoldRecord = { ...input, id, storeId, holdCode, status: input.status || 'Held', payload: input.payload || {}, createdAt: now, updatedAt: input.updatedAt || now, ownerActor: input.ownerActor || input.createdBy, ownershipUpdatedAt };
    this.db.prepare(`INSERT INTO laundry_order_holds(id,tenant,store_id,hold_code,status,payload_json,created_by,created_at,updated_at,owner_actor,ownership_updated_at,resumed_by,resumed_at,cancelled_by,cancelled_at)
      VALUES (@id,@tenant,@storeId,@holdCode,@status,@payloadJson,@createdBy,@createdAt,@updatedAt,@ownerActor,@ownershipUpdatedAt,@resumedBy,@resumedAt,@cancelledBy,@cancelledAt)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json,updated_at=excluded.updated_at,owner_actor=excluded.owner_actor,ownership_updated_at=excluded.ownership_updated_at,resumed_by=excluded.resumed_by,resumed_at=excluded.resumed_at,cancelled_by=excluded.cancelled_by,cancelled_at=excluded.cancelled_at`).run({ ...hold, payloadJson: encode(hold.payload), ownerActor: hold.ownerActor || '', ownershipUpdatedAt, resumedBy: hold.resumedBy || null, resumedAt: hold.resumedAt || null, cancelledBy: hold.cancelledBy || null, cancelledAt: hold.cancelledAt || null });
    return hold;
  }
  private orderHoldFromRow(row: Record<string, unknown>): LaundryOrderHoldRecord {
    return { id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), holdCode: String(row.hold_code), status: String(row.status) as LaundryOrderHoldRecord['status'], payload: decode<Record<string, unknown>>(String(row.payload_json)), createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ownerActor: row.owner_actor ? String(row.owner_actor) : undefined, ownershipUpdatedAt: row.ownership_updated_at ? String(row.ownership_updated_at) : undefined, resumedBy: row.resumed_by ? String(row.resumed_by) : undefined, resumedAt: row.resumed_at ? String(row.resumed_at) : undefined, cancelledBy: row.cancelled_by ? String(row.cancelled_by) : undefined, cancelledAt: row.cancelled_at ? String(row.cancelled_at) : undefined };
  }
  listOrderHolds(tenant: string, includeClosed = false) {
    const rows = this.db.prepare(`SELECT * FROM laundry_order_holds WHERE tenant = ? AND store_id = ? ${includeClosed ? '' : "AND status = 'Held'"} ORDER BY updated_at DESC`).all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.orderHoldFromRow(row));
  }
  getOrderHold(tenant: string, id: string) {
    const row = this.db.prepare('SELECT * FROM laundry_order_holds WHERE tenant = ? AND store_id = ? AND id = ?').get(tenant, this.currentStore(tenant), id) as Record<string, unknown> | undefined;
    return row ? this.orderHoldFromRow(row) : undefined;
  }
  updateOrderHold(input: LaundryOrderHoldRecord) {
    const storeId = input.storeId || this.currentStore(input.tenant);
    const result = this.db.prepare(`UPDATE laundry_order_holds SET status=@status,payload_json=@payloadJson,updated_at=@updatedAt,owner_actor=@ownerActor,ownership_updated_at=@ownershipUpdatedAt,resumed_by=@resumedBy,resumed_at=@resumedAt,cancelled_by=@cancelledBy,cancelled_at=@cancelledAt WHERE tenant=@tenant AND store_id=@storeId AND id=@id`).run({ ...input, storeId, payloadJson: encode(input.payload || {}), ownerActor: input.ownerActor || '', ownershipUpdatedAt: input.ownershipUpdatedAt || input.updatedAt || new Date().toISOString(), resumedBy: input.resumedBy || null, resumedAt: input.resumedAt || null, cancelledBy: input.cancelledBy || null, cancelledAt: input.cancelledAt || null });
    if (result.changes === 0) throw new Error('order hold not found');
    return input;
  }

  claimOrderHold(tenant: string, id: string, actor: string) {
    const hold = this.getOrderHold(tenant, id);
    if (!hold) throw new Error('order hold not found');
    if (hold.status !== 'Held') throw new Error(`order hold is already ${hold.status.toLowerCase()}`);
    const now = new Date().toISOString();
    return this.updateOrderHold({ ...hold, ownerActor: actor, ownershipUpdatedAt: now, updatedAt: now });
  }

  renewOrderHold(tenant: string, id: string, actor: string) {
    const hold = this.getOrderHold(tenant, id);
    if (!hold) throw new Error('order hold not found');
    if (hold.status !== 'Held') throw new Error(`order hold is already ${hold.status.toLowerCase()}`);
    if (hold.ownerActor !== actor) throw new Error('order hold is owned by another counter; claim it before renewing');
    const ownershipAt = hold.ownershipUpdatedAt ? Date.parse(hold.ownershipUpdatedAt) : NaN;
    if (Number.isFinite(ownershipAt) && ownershipAt + ORDER_HOLD_LEASE_MINUTES * 60 * 1000 <= Date.now()) throw new Error('order hold lease expired; claim it before renewing');
    const now = new Date().toISOString();
    return this.updateOrderHold({ ...hold, ownershipUpdatedAt: now, updatedAt: now });
  }

  releaseOrderHold(tenant: string, id: string, actor: string, override = false) {
    const hold = this.getOrderHold(tenant, id);
    if (!hold) throw new Error('order hold not found');
    if (hold.status !== 'Held') throw new Error(`order hold is already ${hold.status.toLowerCase()}`);
    if (hold.ownerActor && hold.ownerActor !== actor && !override) throw new Error('order hold is owned by another counter');
    const now = new Date().toISOString();
    return this.updateOrderHold({ ...hold, ownerActor: '', ownershipUpdatedAt: now, updatedAt: now });
  }

  appendCashShiftClose(close: CashShiftCloseRecord) {
    const integerFields: Array<keyof CashShiftCloseRecord> = [
      'openingCashPaise', 'collectionsPaise', 'expensesPaise', 'refundsPaise', 'expectedCashPaise', 'countedCashPaise',
      'variancePaise', 'collectionCount', 'expenseCount', 'refundCount',
    ];
    for (const field of integerFields) if (!Number.isSafeInteger(close[field]) || Number(close[field]) < (field === 'variancePaise' ? -Number.MAX_SAFE_INTEGER : 0)) throw new Error(`cash shift close ${String(field)} must be an integer`);
    const storeId = close.storeId || this.currentStore(close.tenant);
    this.db.prepare(`INSERT INTO cash_shift_closes(
      id,tenant,store_id,shift_id,register,business_date,opening_cash_paise,collections_paise,expenses_paise,refunds_paise,
      expected_cash_paise,counted_cash_paise,variance_paise,collection_count,expense_count,refund_count,closed_at,closed_by,supervisor_actor,note
    ) VALUES (@id,@tenant,@storeId,@shiftId,@register,@businessDate,@openingCashPaise,@collectionsPaise,@expensesPaise,@refundsPaise,
      @expectedCashPaise,@countedCashPaise,@variancePaise,@collectionCount,@expenseCount,@refundCount,@closedAt,@closedBy,@supervisorActor,@note)
      ON CONFLICT(tenant,store_id,shift_id) DO NOTHING`).run({ ...close, storeId, supervisorActor: close.supervisorActor || null, note: close.note || '' });
    const saved = this.db.prepare('SELECT * FROM cash_shift_closes WHERE tenant = ? AND store_id = ? AND shift_id = ?').get(close.tenant, storeId, close.shiftId) as Record<string, unknown> | undefined;
    if (!saved) throw new Error('cash shift close could not be persisted');
    const normalized = this.cashShiftCloseFromRow(saved);
    const immutableFields: Array<keyof CashShiftCloseRecord> = ['id', 'register', 'businessDate', 'openingCashPaise', 'collectionsPaise', 'expensesPaise', 'refundsPaise', 'expectedCashPaise', 'countedCashPaise', 'variancePaise', 'collectionCount', 'expenseCount', 'refundCount', 'closedAt', 'closedBy', 'supervisorActor', 'note'];
    if (immutableFields.some((field) => normalized[field] !== close[field])) throw new Error(`cash shift close already exists with different values for shift '${close.shiftId}'`);
    return normalized;
  }
  private cashShiftCloseFromRow(row: Record<string, unknown>): CashShiftCloseRecord {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), shiftId: String(row.shift_id), register: String(row.register), businessDate: String(row.business_date),
      openingCashPaise: Number(row.opening_cash_paise), collectionsPaise: Number(row.collections_paise), expensesPaise: Number(row.expenses_paise), refundsPaise: Number(row.refunds_paise),
      expectedCashPaise: Number(row.expected_cash_paise), countedCashPaise: Number(row.counted_cash_paise), variancePaise: Number(row.variance_paise), collectionCount: Number(row.collection_count), expenseCount: Number(row.expense_count), refundCount: Number(row.refund_count),
      closedAt: String(row.closed_at), closedBy: String(row.closed_by), supervisorActor: row.supervisor_actor ? String(row.supervisor_actor) : undefined, note: String(row.note || ''),
    };
  }
  cashShiftCloseFor(tenant: string, shiftId: string) {
    const row = this.db.prepare('SELECT * FROM cash_shift_closes WHERE tenant = ? AND store_id = ? AND shift_id = ?').get(tenant, this.currentStore(tenant), shiftId) as Record<string, unknown> | undefined;
    return row ? this.cashShiftCloseFromRow(row) : undefined;
  }
  listCashShiftCloses(tenant: string) {
    const rows = this.db.prepare('SELECT * FROM cash_shift_closes WHERE tenant = ? AND store_id = ? ORDER BY closed_at DESC').all(tenant, this.currentStore(tenant)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.cashShiftCloseFromRow(row));
  }

  /** Aggregate-only support diagnostics. Deliberately excludes row payloads, identities, paths and secrets. */
  diagnosticsFor(tenant: string, storeId = this.currentStore(tenant)) {
    return this.withStoreScope(tenant, storeId, () => {
      const entityCounts = Object.fromEntries((this.db.prepare('SELECT entity, COUNT(*) AS count FROM entity_rows WHERE tenant = ? AND store_id = ? GROUP BY entity ORDER BY entity').all(tenant, storeId) as Array<{ entity: string; count: number }>).map((row) => [row.entity, Number(row.count)]));
      const recordCounts = Object.fromEntries((this.db.prepare('SELECT kind, COUNT(*) AS count FROM records WHERE tenant = ? AND store_id = ? GROUP BY kind ORDER BY kind').all(tenant, storeId) as Array<{ kind: string; count: number }>).map((row) => [row.kind, Number(row.count)]));
      const groupedSourceCounts = (table: 'financial_entries' | 'financial_documents', column: 'source_entity' | 'source_entity') => Object.fromEntries((this.db.prepare(`SELECT ${column} AS source, COUNT(*) AS count FROM ${table} WHERE tenant = ? AND store_id = ? GROUP BY ${column} ORDER BY ${column}`).all(tenant, storeId) as Array<{ source: string; count: number }>).map((row) => [String(row.source), Number(row.count)]));
      const scalar = (table: string) => Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant = ? AND store_id = ?`).get(tenant, storeId) as { count: number }).count);
      return {
        entityCounts,
        recordCounts,
        financialEntrySources: groupedSourceCounts('financial_entries', 'source_entity'),
        financialDocumentSources: groupedSourceCounts('financial_documents', 'source_entity'),
        garmentUnits: scalar('garment_units'),
        garmentUnitEvents: scalar('garment_unit_events'),
        tagReprints: scalar('tag_reprints'),
        tagHistory: scalar('tag_history'),
        printJobs: scalar('tag_print_jobs'),
        laundryContainers: scalar('laundry_containers'),
        laundryContainerEvents: scalar('laundry_container_events'),
        financialEntries: scalar('financial_entries'),
        financialDocuments: scalar('financial_documents'),
        customerLedgerEntries: scalar('customer_ledger_entries'),
        walletEntries: scalar('wallet_entries'),
        customerAddresses: scalar('customer_addresses'),
        normalizedCustomers: scalar('customers'),
        normalizedOrders: scalar('laundry_orders'),
        normalizedOrderItems: scalar('laundry_order_items'),
        compatibilityMigrationRuns: scalar('compatibility_migration_runs'),
        orderHolds: scalar('laundry_order_holds'),
        cashShiftCloses: scalar('cash_shift_closes'),
        financialNormalizationRuns: scalar('financial_normalization_runs'),
        identities: Number((this.db.prepare('SELECT COUNT(*) AS count FROM auth_identities WHERE tenant = ? AND store_id = ?').get(tenant, storeId) as { count: number }).count),
        activeSessions: Number((this.db.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE tenant = ? AND store_id = ? AND revoked_at IS NULL AND expires_at > ?").get(tenant, storeId, new Date().toISOString()) as { count: number }).count),
        storeSettingsConfigured: Number((this.db.prepare('SELECT COUNT(*) AS count FROM store_settings WHERE tenant = ? AND store_id = ?').get(tenant, storeId) as { count: number }).count) > 0,
      };
    });
  }
}

export const store = new Store();
