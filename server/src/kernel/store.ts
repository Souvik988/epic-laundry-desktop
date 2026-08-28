import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditEntry, EntityRow, GLEntry, ImsAction, OutboxEvent, StockLedgerEntry } from './types.js';

export interface DbShape {
  rows: EntityRow[];
  gl: GLEntry[];
  audit: AuditEntry[];
  outbox: OutboxEvent[];
  stock: StockLedgerEntry[];
  ims: ImsAction[];
  seq: Record<string, number>;
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
export type StoreSettings = { businessName: string; address: string; phone: string; email: string; upiId: string; qrOnPrint: boolean; logoDataUrl: string; updatedAt: string; updatedBy: string };
export type StoreRecord = { id: string; tenant: string; name: string; code: string; enabled: boolean; createdAt: string };
export type StoreMembership = { identityId: string; tenant: string; storeId: string; roles: string[]; createdAt: string };

const legacyFile = process.env.EPIC_LEGACY_JSON_FILE || process.env.EPIC_DATA_FILE || './data/epic.json';
const databaseFile = process.env.EPIC_DB_FILE
  || (extname(legacyFile).toLowerCase() === '.json' ? `${legacyFile.slice(0, -5)}.sqlite` : join(legacyFile, 'epic.sqlite'));
const empty = (): DbShape => ({ rows: [], gl: [], audit: [], outbox: [], stock: [], ims: [], seq: {} });
const encode = (value: unknown) => JSON.stringify(value);
const decode = <T>(value: string): T => JSON.parse(value) as T;

/** Local SQLite persistence; legacy JSON imports once but is never authoritative again. */
export class Store {
  private readonly db: Database.Database;
  private readonly scope = new AsyncLocalStorage<{ tenant: string; storeId: string }>();

  constructor() {
    this.db = new Database(databaseFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.createSchema();
    this.migrateStoreScope();
    this.importLegacyJsonIfNeeded();
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
      CREATE TABLE IF NOT EXISTS auth_identities (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store_id TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL, roles_json TEXT NOT NULL, enabled INTEGER NOT NULL,
        first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
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
    `);
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
      ['phone', "TEXT NOT NULL DEFAULT ''"], ['description', "TEXT NOT NULL DEFAULT ''"],
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
    if (count > 0 || !existsSync(legacyFile) || legacyFile === databaseFile) return;
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
  private currentStore(tenant: string) {
    const scope = this.scope.getStore();
    if (scope && scope.tenant !== tenant) throw new Error('tenant context mismatch');
    return scope?.storeId || 'STORE-DEFAULT';
  }

  authIdentityCount() { return Number((this.db.prepare('SELECT COUNT(*) AS count FROM auth_identities').get() as { count: number }).count); }
  createIdentity(identity: AuthIdentity) {
    this.db.prepare(`INSERT INTO auth_identities(
      id,tenant,store_id,username,password_hash,roles_json,enabled,first_name,last_name,email,phone,description,created_at
    ) VALUES (
      @id,@tenant,@storeId,@username,@passwordHash,@rolesJson,@enabled,@firstName,@lastName,@email,@phone,@description,@createdAt
    )`)
      .run({ ...identity, rolesJson: encode(identity.roles), enabled: identity.enabled ? 1 : 0 });
    this.ensureStore(identity.tenant, identity.storeId, identity.storeId, identity.storeId);
    this.addStoreMembership({ identityId: identity.id, tenant: identity.tenant, storeId: identity.storeId, roles: identity.roles, createdAt: identity.createdAt });
  }
  private identityFromRow(row: Record<string, unknown>, includePassword = true): AuthIdentity {
    return {
      id: String(row.id), tenant: String(row.tenant), storeId: String(row.store_id), username: String(row.username),
      passwordHash: includePassword ? String(row.password_hash) : '', roles: decode<string[]>(String(row.roles_json)), enabled: Boolean(row.enabled),
      firstName: String(row.first_name || ''), lastName: String(row.last_name || ''), email: String(row.email || ''),
      phone: String(row.phone || ''), description: String(row.description || ''), createdAt: String(row.created_at),
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
  updateIdentityProfile(id: string, input: Pick<AuthIdentity, 'firstName' | 'lastName' | 'email' | 'phone' | 'description' | 'roles' | 'enabled'>) {
    this.db.prepare(`UPDATE auth_identities SET
      first_name = @firstName, last_name = @lastName, email = @email, phone = @phone, description = @description,
      roles_json = @rolesJson, enabled = @enabled
      WHERE id = @id`).run({ id, ...input, rolesJson: encode(input.roles), enabled: input.enabled ? 1 : 0 });
  }
  getStoreSettings(tenant: string, storeId = this.currentStore(tenant)): StoreSettings {
    const row = this.db.prepare('SELECT settings_json FROM store_settings WHERE tenant = ? AND store_id = ?').get(tenant, storeId) as { settings_json: string } | undefined;
    if (row) {
      const saved = decode<StoreSettings>(row.settings_json);
      return { ...saved, logoDataUrl: saved.logoDataUrl || '' };
    }
    return { businessName: 'Epic Laundry', address: '', phone: '', email: '', upiId: '', qrOnPrint: false, logoDataUrl: '', updatedAt: '', updatedBy: '' };
  }
  saveStoreSettings(tenant: string, actor: string, input: Partial<StoreSettings>, storeId = this.currentStore(tenant)) {
    const previous = this.getStoreSettings(tenant, storeId);
    const next: StoreSettings = {
      businessName: String(input.businessName ?? previous.businessName).trim() || 'Epic Laundry', address: String(input.address ?? previous.address).trim(),
      phone: String(input.phone ?? previous.phone).trim(), email: String(input.email ?? previous.email).trim(), upiId: String(input.upiId ?? previous.upiId).trim(),
      qrOnPrint: typeof input.qrOnPrint === 'boolean' ? input.qrOnPrint : previous.qrOnPrint, updatedAt: new Date().toISOString(), updatedBy: actor,
      logoDataUrl: String(input.logoDataUrl ?? previous.logoDataUrl).trim(),
    };
    if (next.logoDataUrl && (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(next.logoDataUrl) || next.logoDataUrl.length > 1_500_000)) throw new Error('logo must be a PNG, JPEG, WebP, or SVG image under 1 MB');
    this.db.prepare('INSERT INTO store_settings(tenant,store_id,settings_json) VALUES (?, ?, ?) ON CONFLICT(tenant,store_id) DO UPDATE SET settings_json=excluded.settings_json').run(tenant, storeId, encode(next));
    this.updateStoreName(tenant, storeId, next.businessName);
    return next;
  }
  updateIdentityPassword(id: string, passwordHash: string) { this.db.prepare('UPDATE auth_identities SET password_hash = ? WHERE id = ?').run(passwordHash, id); }
  revokeOtherSessions(identityId: string, exceptTokenHash: string) { this.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE identity_id = ? AND token_hash <> ? AND revoked_at IS NULL').run(new Date().toISOString(), identityId, exceptTokenHash); }
  createSession(session: AuthSession) {
    this.db.prepare('INSERT INTO auth_sessions(token_hash,identity_id,tenant,store_id,expires_at,revoked_at,created_at) VALUES (@tokenHash,@identityId,@tenant,@storeId,@expiresAt,@revokedAt,@createdAt)').run({ ...session, revokedAt: session.revokedAt || null });
  }
  sessionByTokenHash(tokenHash: string) {
    const row = this.db.prepare(`SELECT s.*, i.username, i.roles_json, i.enabled, i.first_name, i.last_name, i.email, i.phone, i.description
      FROM auth_sessions s JOIN auth_identities i ON i.id = s.identity_id
      WHERE s.token_hash = ?`).get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      session: { tokenHash: String(row.token_hash), identityId: String(row.identity_id), tenant: String(row.tenant), storeId: String(row.store_id), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : undefined, createdAt: String(row.created_at) } satisfies AuthSession,
      identity: { id: String(row.identity_id), tenant: String(row.tenant), storeId: String(row.store_id), username: String(row.username), passwordHash: '', roles: decode<string[]>(String(row.roles_json)), enabled: Boolean(row.enabled), firstName: String(row.first_name || ''), lastName: String(row.last_name || ''), email: String(row.email || ''), phone: String(row.phone || ''), description: String(row.description || ''), createdAt: '' } satisfies AuthIdentity,
    };
  }
  revokeSession(tokenHash: string) { this.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').run(new Date().toISOString(), tokenHash); }
  idempotencyResult<T>(tenant: string, scope: string, key: string) {
    const scopedOperation = `${this.currentStore(tenant)}:${scope}`;
    const row = this.db.prepare('SELECT response_json FROM idempotency_commands WHERE tenant = ? AND scope = ? AND command_key = ?').get(tenant, scopedOperation, key) as { response_json: string } | undefined;
    return row ? decode<T>(row.response_json) : undefined;
  }
  recordIdempotencyResult(tenant: string, scope: string, key: string, response: unknown) {
    const scopedOperation = `${this.currentStore(tenant)}:${scope}`;
    this.db.prepare('INSERT INTO idempotency_commands(tenant,scope,command_key,response_json,created_at) VALUES (?, ?, ?, ?, ?)').run(tenant, scopedOperation, key, encode(response), new Date().toISOString());
  }

  private readRows(sql: string, params: unknown[] = []) {
    return (this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), entity: String(row.entity), tenant: String(row.tenant), status: String(row.status),
      version: Number(row.version), created_by: String(row.created_by), created_at: String(row.created_at),
      updated_at: String(row.updated_at), data: decode<Record<string, unknown>>(String(row.data_json)),
    }) as EntityRow);
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
    this.db.prepare('INSERT INTO entity_rows(tenant,store_id,id,entity,status,version,created_by,created_at,updated_at,data_json) VALUES (@tenant,@storeId,@id,@entity,@status,@version,@created_by,@created_at,@updated_at,@data_json)').run({ ...row, storeId: this.currentStore(row.tenant), data_json: encode(row.data) });
  }
  updateRow(row: EntityRow) {
    const result = this.db.prepare('UPDATE entity_rows SET entity=@entity,status=@status,version=@version,created_by=@created_by,created_at=@created_at,updated_at=@updated_at,data_json=@data_json WHERE tenant=@tenant AND store_id=@storeId AND id=@id').run({ ...row, storeId: this.currentStore(row.tenant), data_json: encode(row.data) });
    if (result.changes === 0) this.insertRow(row);
  }
  getRow(tenant: string, id: string) { return this.readRows('SELECT * FROM entity_rows WHERE tenant = ? AND store_id = ? AND id = ?', [tenant, this.currentStore(tenant), id])[0]; }
  rowsOf(tenant: string, entity: string) { return this.readRows('SELECT * FROM entity_rows WHERE tenant = ? AND store_id = ? AND entity = ? ORDER BY created_at', [tenant, this.currentStore(tenant), entity]); }

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
      };
    });
  }
  replaceAll(input: DbShape) {
    this.db.exec('DELETE FROM entity_rows; DELETE FROM records; DELETE FROM sequences;');
    for (const row of input.rows || []) this.insertRow(row);
    for (const entry of input.gl || []) this.appendGL(entry);
    for (const entry of input.audit || []) this.appendAudit(entry);
    for (const event of input.outbox || []) this.appendOutbox(event);
    for (const entry of input.stock || []) this.appendStock(entry);
    for (const entry of input.ims || []) this.appendIms(entry);
    for (const [series, value] of Object.entries(input.seq || {})) this.db.prepare('INSERT INTO sequences(series, value) VALUES (?, ?)').run(series, value);
  }
  replaceScoped(tenant: string, storeId: string, input: DbShape) {
    return this.withStoreScope(tenant, storeId, () => this.transaction(() => {
      this.db.prepare('DELETE FROM entity_rows WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
      this.db.prepare('DELETE FROM records WHERE tenant = ? AND store_id = ?').run(tenant, storeId);
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
      return { rows: (input.rows || []).length };
    }));
  }
}

export const store = new Store();
