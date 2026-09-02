import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import {
  listDefs, getDef, createRow, getRow, listRows, submitRow, cancelRow,
} from './kernel/entity-service.js';
import { store } from './kernel/store.js';
import { drainOutbox } from './kernel/event-bus.js';
import { audit } from './kernel/audit.js';
import { ShotlinXchatAdapter } from './integrations/whatsapp/shotlinxchat.js';
import { buildEinvoicePayload } from './modules/gst/einvoice.js';
import { buildGstr1, buildCdnr } from './modules/gst/gstr1.js';
import { renderTaxInvoice } from './modules/gst/tax-invoice.js';
import {
  generateIrnForInvoice, cancelIrnForInvoice, generateEwbForInvoice,
  getImsSupplies, recordImsAction,
} from './modules/gst/irn-service.js';
import { getTrialBalance, getPnL, getBalanceSheet, getLedger } from './modules/accounting/reports.js';
import { computePayroll } from './modules/hr/payroll.js';
import {
  recordAttendance, getLeaveBalances, applyLeave, approveLeave,
  createExpenseClaim, createEmployeeLoan, getLoanSchedule,
  createJobOpening, applyToJob, scheduleInterview, getRecruitmentPipeline,
} from './modules/hr/hr-depth.js';
import { getInsights } from './modules/ai/insights.js';
import { ask } from './modules/ai/assistant.js';
import { runImport, PRESETS } from './modules/migration/import.js';
import { stockValuation, serialStock, batchStock, getStockBalance } from './modules/inventory/valuation.js';
import { quoteRate, runRecurring, reorderSuggestions, getAlerts, createReorderPO } from './modules/ops.js';
import {
  explodeBom, bomCost, planMaterials, createPlannedWorkOrders, createPlannedPurchaseOrder, defaultBom,
} from './modules/manufacturing/mrp.js';
import { billProject } from './modules/projects/billing.js';
import { runDepreciation } from './modules/assets/depreciation.js';
import { getComplianceSummary, verifyAuditTrail } from './modules/compliance/returns.js';
import { getRate, convert } from './modules/multi-entity/fx.js';
import { roleCan } from './modules/rbac/roles.js';
import { paymentLink } from './modules/integrations/payments.js';
import { bootstrapOwner, can, changePassword, contextForToken, createOperationalStore, createOperationalUser, listOperationalStores, readSessionToken, resetOperationalUserPassword, setOperationalUserEnabled, signIn, signOut, switchOperationalStore, updateOperationalUser, type AuthContext } from './modules/auth/auth.js';
import { runBot, fetchBankStatement } from './modules/integrations/rpa.js';
import {
  scoreLead, scoreAllLeads, logActivity, activitiesFor, findDuplicateLeads, mergeLeads,
  convertLead, winOpportunity, loseOpportunity, getPipeline, getForecast,
  getSourceAnalytics, getLostReasonPareto, getOwnerPerformance, assignOwner,
} from './modules/crm/crm.js';
import {
  sendMessage, sendTemplated, runCampaign, campaignStats, notify,
  listNotifications, markNotificationRead, markAllRead, syncAlertsToNotifications,
} from './modules/crm/engagement.js';
import { dashboardSummary } from './modules/analytics/dashboard.js';
import {
  applyLaundryGarmentBackfill, assignLaundryOrder, bookLaundryOrder, cancelLaundryExpense, cancelLaundryOrder, createLaundryExpense, createLaundryRider, editLaundryExpense, editLaundryOrder, getLaundryOrder, importLaundryCatalogue, importLaundryCustomers, importLaundryPrices, laundryCatalogue, laundryDashboard, listLaundryFulfillment, recordLaundryFulfillment, listLaundryGarmentUnits, getLaundryGarmentUnit, previewLaundryGarmentBackfill, scanLaundryGarment, scanLaundryContainer, getLaundryContainerDetail, reprintLaundryTag, replaceLaundryTag, createLaundryPrintJob, listLaundryPrintJobs, LaundryDomainError, TagRetiredError,
  laundryDispatch, laundryReportDetail, laundryReports, laundryStatistics, listLaundryExpenses, listLaundryImportJobs, listLaundryOrders, listLaundryRiderSettlements, listLaundryRiders, quoteLaundryOrder, saveLaundryCategory, saveLaundryChargeRule, saveLaundryDiscountRule,
  saveLaundryGarment, saveLaundryPrice, saveLaundryRiderSettlement, saveLaundryService, saveLaundryTaxRule, searchLaundryCustomers, seedLaundryDefaults, transitionLaundryOrder,
} from './modules/laundry/domain.js';
import { adjustRewards, applyWalletCommand, archiveLaundryCustomerAddress, createLaundryCustomer, customerProfile, customerRetentionInsights, listLaundryCustomerAddresses, saveLaundryCustomerAddress, updateLaundryCustomer } from './modules/laundry/customers.js';
import { collectServicePackagePayment, createServicePackage, customerPackages, listServicePackages, packageLiability, purchaseServicePackage, redeemServicePackage } from './modules/laundry/packages.js';
import { collectLaundryPayment, laundryPaymentSummary, reverseLaundryPayment } from './modules/laundry/payments.js';
import { laundryBusinessDate } from './modules/laundry/dates.js';
import { cashCloseDrill, laundryFinancialReconciliation } from './modules/laundry/reconciliation.js';
import { closeCashShift, getCurrentCashShift, listCashShifts, openCashShift } from './modules/laundry/cash.js';
import { applyProductionWorkloadRecommendations, assignProductionTask, listProductionTasks, productionLoad, productionSchedule, productionSupervisorMetrics, productionWorkload, startProductionTask } from './modules/laundry/production.js';
import { listCustomerCorrections, listQualityClaims, openQualityClaim, qualityAnalytics, resolveQualityClaim } from './modules/laundry/quality.js';
import { cancelLaundryOrderHold, claimLaundryOrderHold, createLaundryOrderHold, listLaundryOrderHolds, orderHoldPresence, releaseLaundryOrderHold, renewLaundryOrderHold, resumeLaundryOrderHold } from './modules/laundry/holds.js';
import { completeRouteStop, createRouteRun, createServiceZone, listRouteRuns, listServiceZoneMaster, listServiceZones, routeCoverageAnalytics, startRouteRun, updateServiceZone } from './modules/laundry/routes.js';
import { createRackProfile, listRackProfiles, rackOccupancy, updateRackProfile } from './modules/laundry/rack.js';
import { hardwareCapabilities, hardwareStatus, listHardwareReceipts, recordHardwareReceipt } from './modules/laundry/hardware.js';
import { buildDiagnostics } from './modules/ops/diagnostics.js';
import { freshDatabaseRestoreRehearsal } from './modules/ops/fresh-recovery.js';
import { decryptBackup, encryptBackup } from './modules/ops/backup-crypto.js';
import { applyFinancialNormalization, previewFinancialNormalization } from './modules/ops/financial-normalization.js';
import { compatibilityRetirementAudit } from './modules/ops/compatibility-audit.js';
import { applyEntityNormalization, previewEntityNormalization, ENTITY_NORMALIZATION_ENTITIES, type EntityNormalizationEntity } from './modules/ops/entity-normalization.js';
import { searchLaundryWorkspace } from './modules/laundry/search.js';
import { createLaundryReportExportJob, getLaundryReportExportJob, readLaundryReportExport } from './modules/laundry/report-exports.js';
import { createSavedReportView, deleteSavedReportView, listSavedReportViews } from './modules/laundry/report-views.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const USER = process.env.EPIC_USER || 'admin@epic.local';
// Legacy ERP routes predate the laundry workspace APIs. Always derive their
// tenant/actor from the authenticated request so a multi-store session cannot
// read or mutate the process-default workspace.
const requestTenant = (req: any) => req?.auth?.tenant || TENANT;
const requestActor = (req: any) => req?.auth?.actor || USER;
declare module 'fastify' { interface FastifyRequest { auth?: AuthContext } }

const laundryIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const laundrySearchQuery = {
  type: 'object',
  properties: { q: { type: 'string', maxLength: 80 } },
  additionalProperties: false,
} as const;
const laundryTransitionBody = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'] },
    note: { type: 'string', maxLength: 500 },
    expectedVersion: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;
const laundryScanBody = {
  type: 'object',
  required: ['tagCode'],
  properties: {
    tagCode: { type: 'string', minLength: 1, maxLength: 120 },
    nextState: { type: 'string', enum: ['Intake', 'Sorted', 'Processing', 'QC', 'Rewash', 'Assembly', 'Racked', 'Dispatched', 'Delivered', 'Missing', 'Damaged', 'Cancelled'] },
    location: { type: 'string', maxLength: 80 },
    note: { type: 'string', maxLength: 500 },
    condition: { type: 'string', maxLength: 40 },
  },
  additionalProperties: false,
} as const;
const laundryContainerScanBody = {
  ...laundryScanBody,
  properties: { ...laundryScanBody.properties, nextState: { type: 'string', enum: ['Intake', 'Processing', 'Ready', 'Dispatched', 'Delivered', 'Missing', 'Damaged', 'Cancelled'] } },
} as const;
const laundryLifecycleBody = {
  type: 'object',
  required: ['reason'],
  properties: {
    station: { type: 'string', maxLength: 80 },
    reason: { type: 'string', minLength: 3, maxLength: 240 },
    status: { type: 'string', enum: ['Lost', 'Damaged', 'Replaced'] },
  },
  additionalProperties: false,
} as const;
const laundryPrintJobBody = {
  type: 'object',
  required: ['orderId'],
  properties: {
    orderId: { type: 'string', minLength: 1, maxLength: 120 },
    templateId: { type: 'string', maxLength: 120 },
    templateVersion: { type: 'string', maxLength: 40 },
    printerProfile: { type: 'string', maxLength: 120 },
    tagIds: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 120 } },
    containerIds: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 120 } },
    documentType: { type: 'string', enum: ['invoice', 'mini-invoice', 'garment-tags', 'bag-tags', 'correction'] },
    requestedCopies: { type: 'integer', minimum: 1, maximum: 1000 },
    status: { type: 'string', enum: ['Queued', 'Rendering', 'Printed', 'Downloaded', 'Failed', 'Cancelled'] },
    failureReason: { type: 'string', maxLength: 500 },
    outputHash: { type: 'string', maxLength: 128 },
    evidence: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
} as const;

function sessionCookie(token: string, maxAgeSeconds: number) {
  return `epic_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function validateRestorePayload(input: any, tenant: string, storeId: string) {
  const { backupFormat, backupVersion, checksum, tenant: backupTenant, storeId: backupStoreId, createdAt: _createdAt, migrations: _migrations, ...db } = input || {};
  if (backupFormat !== undefined) {
    if (backupFormat !== 'epic-laundry-backup' || backupVersion !== 1 || typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error('invalid backup envelope');
    if (backupTenant !== tenant || backupStoreId !== storeId) throw new Error('backup belongs to another workspace');
    const actual = createHash('sha256').update(JSON.stringify(db), 'utf8').digest('hex');
    if (actual !== checksum) throw new Error('backup checksum mismatch');
  }
  if (!db || !Array.isArray(db.rows) || !Array.isArray(db.gl) || !Array.isArray(db.audit) || !Array.isArray(db.outbox) || !Array.isArray(db.stock) || !Array.isArray(db.ims) || (db.seq !== undefined && (typeof db.seq !== 'object' || Array.isArray(db.seq)))) throw new Error('invalid backup payload');
  return db;
}

export function registerApi(app: FastifyInstance) {
  // ---- health / meta ----
  app.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));
  app.get('/api/entities', async () => listDefs().map((d) => ({
    name: d.name, label: d.label, kind: d.kind, module: d.module,
    fields: d.fields, lifecycle: d.lifecycle,
  })));

  // ---- auth guard for mutating/reading routes ----
  const guard = async (req: any, rep: any) => {
    const internalKey = String(req.headers['x-epic-internal-key'] || '');
    if (internalKey && process.env.EPIC_INTERNAL_API_KEY && internalKey === process.env.EPIC_INTERNAL_API_KEY) {
      req.auth = { identityId: 'desktop-system', actor: 'desktop-system', tenant: TENANT, storeId: 'STORE-DEFAULT', roles: ['owner'], sessionHash: 'desktop-internal' } satisfies AuthContext;
      store.enterStoreScope(req.auth.tenant, req.auth.storeId);
      return;
    }
    const auth = contextForToken(readSessionToken(req.headers));
    if (!auth) return rep.code(401).send({ error: 'authentication required' });
    req.auth = auth;
    store.enterStoreScope(auth.tenant, auth.storeId);
  };
  const allow = (permission: string) => async (req: any, rep: any) => {
    if (!req.auth || !can(req.auth, permission)) return rep.code(403).send({ error: 'permission denied' });
  };
  const allowAny = (...permissions: string[]) => async (req: any, rep: any) => {
    if (!req.auth || !permissions.some((permission) => can(req.auth, permission))) return rep.code(403).send({ error: 'permission denied' });
  };
  const idempotent = <T>(req: any, scope: string, work: () => T) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key || key.length > 160) throw new Error('a valid idempotency key is required');
    const auth = req.auth as AuthContext;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body === undefined ? null : req.body)).digest('hex');
    let conflict = false;
    const result = store.transaction(() => {
      const previous = store.idempotencyRecord<T>(auth.tenant, scope, key);
      if (previous) {
        if (previous.requestHash && previous.requestHash !== requestHash) {
          conflict = true;
          return undefined as T;
        }
        return previous.response;
      }
      const result = work();
      store.recordIdempotencyResult(auth.tenant, scope, key, result, requestHash);
      return result;
    });
    if (conflict) {
      audit(auth.tenant, auth.actor, 'ops:idempotency-conflict', { after: { scope, keyHash: createHash('sha256').update(key).digest('hex'), requestHash } });
      throw new Error('idempotency key was already used for a different command payload; use a new key or resolve the conflict');
    }
    return result;
  };
  const inStore = <T>(req: any, work: () => T) => store.withStoreScope(req.auth!.tenant, req.auth!.storeId, work);
  const laundryFailure = (rep: any, error: unknown) => {
    if (error instanceof TagRetiredError) return rep.code(409).send({ code: error.code, error: error.message, details: error.details });
    if (error instanceof LaundryDomainError) return rep.code(error.code === 'TAG_RETIRED' ? 409 : 400).send({ code: error.code, error: error.message, details: error.details });
    return rep.code(400).send({ error: error instanceof Error ? error.message : String(error || 'laundry operation failed') });
  };

  app.get('/api/auth/bootstrap-status', async () => ({ needsBootstrap: store.authIdentityCount() === 0 }));
  app.post('/api/auth/bootstrap', async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      const identity = bootstrapOwner({
        username: body?.username, password: body?.password,
        tenant: body?.tenant, storeId: body?.storeId,
        firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone,
      });
      // Production starts without fabricated business activity. Catalogue defaults are
      // neutral master data, created only after the owner explicitly completes setup.
      store.withStoreScope(identity.tenant, identity.storeId, () => {
        seedLaundryDefaults(identity.tenant);
        store.saveStoreSettings(identity.tenant, identity.username, {
          businessName: body?.businessName,
          address: body?.address,
          phone: body?.phone,
          email: body?.email,
          upiId: body?.upiId,
          taxMode: body?.taxMode,
          gstin: body?.gstin,
          currency: body?.currency,
          timezone: body?.timezone,
          printerProfile: body?.printerProfile,
        }, identity.storeId);
        const setupProgress = store.saveSetupProgress(identity.tenant, identity.username, { business: true, owner: true, operations: true }, identity.storeId);
        audit(identity.tenant, identity.username, 'settings:setup-progress-updated', { entity: 'store_settings', row_id: identity.storeId, after: { ...setupProgress, source: 'bootstrap' } });
      });
      const signedIn = signIn(identity.username, (req.body as any).password);
      rep.header('Set-Cookie', sessionCookie(signedIn.token, 60 * 60 * 12));
      return { user: { username: signedIn.context.actor, roles: signedIn.context.roles, tenant: signedIn.context.tenant, storeId: signedIn.context.storeId }, expiresAt: signedIn.expiresAt };
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/auth/sign-in', async (req: any, rep: any) => {
    try {
      const signedIn = signIn((req.body as any)?.username, (req.body as any)?.password);
      rep.header('Set-Cookie', sessionCookie(signedIn.token, 60 * 60 * 12));
      return { user: { username: signedIn.context.actor, roles: signedIn.context.roles, tenant: signedIn.context.tenant, storeId: signedIn.context.storeId }, expiresAt: signedIn.expiresAt };
    } catch (error: any) { return rep.code(401).send({ error: error.message }); }
  });
  app.post('/api/auth/sign-out', { preHandler: guard }, async (req: any, rep: any) => {
    signOut(readSessionToken(req.headers));
    rep.header('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  });
  app.post('/api/auth/change-password', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      changePassword(req.auth!, String((req.body as any)?.currentPassword || ''), String((req.body as any)?.newPassword || ''));
      return { ok: true };
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/auth/switch-store', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const switched = switchOperationalStore(req.auth!, String((req.body as any)?.storeId || ''));
      const token = readSessionToken(req.headers);
      if (token) rep.header('Set-Cookie', sessionCookie(token, 60 * 60 * 12));
      return { user: { username: req.auth!.actor, roles: switched.roles, tenant: req.auth!.tenant, storeId: switched.store.id, riderId: req.auth!.riderId || null }, store: switched.store };
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/stores', { preHandler: [guard, allow('staff.manage')] }, async (req: any) => listOperationalStores(req.auth!));
  app.post('/api/settings/stores', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const created = createOperationalStore(req.auth!, { name: (req.body as any)?.name, code: (req.body as any)?.code });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:store-created', { entity: 'store', row_id: created.id, after: created });
        return rep.code(201).send(created);
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/staff', { preHandler: [guard, allow('staff.manage')] }, async (req: any) =>
    store.listIdentities(req.auth!.tenant, req.auth!.storeId).map(({ passwordHash: _passwordHash, ...user }) => user),
  );
  app.post('/api/settings/staff', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const body = req.body as any;
        const identity = createOperationalUser(req.auth!, { username: body?.username, password: body?.password, roles: body?.roles, storeId: body?.storeId || req.auth!.storeId, firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone, description: body?.description, riderId: body?.riderId });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-created', { entity: 'auth_identity', row_id: identity.id, after: { username: identity.username, roles: identity.roles, enabled: identity.enabled, riderId: identity.riderId || '', firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone, description: identity.description } });
        const { passwordHash: _passwordHash, ...safeIdentity } = identity;
        return rep.code(201).send(safeIdentity);
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/settings/staff/:id', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const before = store.identityById(req.params.id);
        const body = req.body as any;
        const identity = updateOperationalUser(req.auth!, req.params.id, { firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone, description: body?.description, roles: body?.roles, enabled: body?.enabled, riderId: body?.riderId });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-updated', { entity: 'auth_identity', row_id: identity.id, before: before ? { username: before.username, roles: before.roles, enabled: before.enabled, riderId: before.riderId || '', firstName: before.firstName, lastName: before.lastName, email: before.email, phone: before.phone, description: before.description } : undefined, after: { username: identity.username, roles: identity.roles, enabled: identity.enabled, riderId: identity.riderId || '', firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone, description: identity.description } });
        const { passwordHash: _passwordHash, ...safeIdentity } = identity;
        return safeIdentity;
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/settings/staff/:id/reset-password', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        resetOperationalUserPassword(req.auth!, req.params.id, String((req.body as any)?.password || ''));
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-password-reset', { entity: 'auth_identity', row_id: req.params.id });
        return { ok: true };
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/settings/staff/:id/enabled', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const identity = setOperationalUserEnabled(req.auth!, req.params.id, Boolean((req.body as any)?.enabled));
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-enabled', { entity: 'auth_identity', row_id: identity.id, after: { enabled: identity.enabled } });
        return { id: identity.id, enabled: identity.enabled };
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/store', { preHandler: [guard, allow('settings.manage')] }, async (req: any) =>
    inStore(req, () => store.getStoreSettings(req.auth!.tenant, req.auth!.storeId)),
  );
  app.post('/api/settings/store', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const before = store.getStoreSettings(req.auth!.tenant, req.auth!.storeId);
        const next = store.saveStoreSettings(req.auth!.tenant, req.auth!.actor, req.body as any, req.auth!.storeId);
        audit(req.auth!.tenant, req.auth!.actor, 'settings:store-updated', { entity: 'store_settings', row_id: req.auth!.storeId, before, after: next });
        return next;
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/setup-progress', { preHandler: [guard, allow('settings.manage')] }, async (req: any) =>
    inStore(req, () => store.getStoreSettings(req.auth!.tenant, req.auth!.storeId).setupProgress),
  );
  app.post('/api/settings/setup-progress', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as Record<string, unknown>;
      const allowed = ['business', 'owner', 'operations', 'catalogue', 'recovery'] as const;
      const progress = inStore(req, () => store.saveSetupProgress(req.auth!.tenant, req.auth!.actor, Object.fromEntries(allowed.filter((key) => typeof body?.[key] === 'boolean').map((key) => [key, body[key]])) as any, req.auth!.storeId));
      audit(req.auth!.tenant, req.auth!.actor, 'settings:setup-progress-updated', { entity: 'store_settings', row_id: req.auth!.storeId, after: progress });
      return progress;
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/auth/session', async (req: any) => {
    const auth = contextForToken(readSessionToken(req.headers));
    return auth ? { user: { username: auth.actor, roles: auth.roles, tenant: auth.tenant, storeId: auth.storeId, riderId: auth.riderId || null } } : { user: null };
  });

  // ---- Laundry desk: dedicated domain API, kept separate from generic ERP screens ----
  app.get('/api/laundry/catalogue', { preHandler: [guard, allow('catalogue.read')] }, async (req: any) => inStore(req, () => laundryCatalogue(req.auth!.tenant)));
  app.get('/api/laundry/search', { schema: { querystring: laundrySearchQuery }, preHandler: [guard, allowAny('orders.read', 'customers.read', 'garments.read')] }, async (req: any) => inStore(req, () => searchLaundryWorkspace(req.auth!.tenant, (req.query as any)?.q, {
    customers: can(req.auth!, 'customers.read'), orders: can(req.auth!, 'orders.read'), garments: can(req.auth!, 'garments.read'),
  })));
  app.post('/api/laundry/catalogue/categories', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryCategory(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/categories/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryCategory(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/services', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryService(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/services/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryService(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/garments', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryGarment(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/garments/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryGarment(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/prices', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryPrice(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/prices/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryPrice(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/charges', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryChargeRule(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/charges/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryChargeRule(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/discounts', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryDiscountRule(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/discounts/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryDiscountRule(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/taxes', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryTaxRule(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/taxes/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryTaxRule(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/import', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try {
      const result = inStore(req, () => idempotent(req, 'laundry.catalogue-import', () => importLaundryCatalogue(req.auth!.tenant, req.auth!.actor, req.body as any)));
      inStore(req, () => store.saveSetupProgress(req.auth!.tenant, req.auth!.actor, { catalogue: true }, req.auth!.storeId));
      return rep.code(201).send(result);
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/garment-backfill', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any) => inStore(req, () => previewLaundryGarmentBackfill(req.auth!.tenant)));
  app.post('/api/laundry/garment-backfill', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(200).send(inStore(req, () => idempotent(req, 'laundry.garment-backfill', () => applyLaundryGarmentBackfill(req.auth!.tenant, req.auth!.actor)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'garment backfill failed' }); }
  });
  app.get('/api/laundry/customers', { preHandler: [guard, allow('customers.read')] }, async (req: any) =>
    inStore(req, () => searchLaundryCustomers(req.auth!.tenant, String((req.query as any)?.search || ''))),
  );
  app.get('/api/laundry/customer-insights', { preHandler: [guard, allow('customers.read')] }, async (req: any) =>
    inStore(req, () => customerRetentionInsights(req.auth!.tenant)),
  );
  app.post('/api/laundry/customers', { preHandler: [guard, allow('customers.create')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.customer-create', () => createLaundryCustomer(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/customers/:id', { preHandler: [guard, allow('customers.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => customerProfile(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.patch('/api/laundry/customers/:id', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => updateLaundryCustomer(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/customers/:id/addresses', { preHandler: [guard, allow('customers.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => listLaundryCustomerAddresses(req.auth!.tenant, req.params.id)); } catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/addresses', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `customer-address:${req.params.id}`, () => saveLaundryCustomerAddress(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}))); } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/customers/:id/addresses/:addressId', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `customer-address:${req.params.id}`, () => saveLaundryCustomerAddress(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}, req.params.addressId))); } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/addresses/:addressId/archive', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `customer-address-archive:${req.params.id}`, () => archiveLaundryCustomerAddress(req.auth!.tenant, req.auth!.actor, req.params.id, req.params.addressId))); } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/wallet', { preHandler: [guard, allow('wallet.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.customer-wallet:${req.params.id}`, () => applyWalletCommand(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/rewards', { preHandler: [guard, allow('rewards.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.customer-rewards:${req.params.id}`, () => adjustRewards(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/packages', { preHandler: [guard, allow('packages.read')] }, async (req: any) => inStore(req, () => listServicePackages(req.auth!.tenant, String((req.query as any)?.includeInactive || '') === 'true')));
  app.get('/api/laundry/package-liability', { preHandler: [guard, allowAny('packages.read', 'reports.read')] }, async (req: any) => inStore(req, () => packageLiability(req.auth!.tenant, { customerId: String((req.query as any)?.customerId || '').trim() || undefined })));
  app.post('/api/laundry/packages', { preHandler: [guard, allow('packages.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.package-create', () => createServicePackage(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/customers/:id/packages', { preHandler: [guard, allow('packages.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => customerPackages(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/packages', { preHandler: [guard, allow('packages.sell')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.package-purchase:${req.params.id}`, () => purchaseServicePackage(req.auth!.tenant, req.auth!.actor, { ...(req.body as any), customer: req.params.id })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customer-packages/:id/redemptions', { preHandler: [guard, allow('packages.redeem')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.package-redemption:${req.params.id}`, () => redeemServicePackage(req.auth!.tenant, req.auth!.actor, { ...(req.body as any), customerPackage: req.params.id })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customer-packages/:id/payments', { preHandler: [guard, allow('packages.sell')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.package-payment:${req.params.id}`, () => collectServicePackagePayment(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/dashboard', { preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    inStore(req, () => laundryDashboard(req.auth!.tenant, String((req.query as any)?.asOf || laundryBusinessDate()))),
  );
  app.post('/api/laundry/quote', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      return inStore(req, () => quoteLaundryOrder(req.auth!.tenant, body, body?.customerId || ''));
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.booking', () => bookLaundryOrder(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/order-holds', { preHandler: [guard, allow('orders.hold')] }, async (req: any) => inStore(req, () => listLaundryOrderHolds(req.auth!.tenant, req.auth!.actor, String(req.query?.includeClosed || '') === 'true')));
  app.get('/api/laundry/order-holds/presence', { preHandler: [guard, allow('orders.hold')] }, async (req: any) => inStore(req, () => orderHoldPresence(req.auth!.tenant, req.auth!.actor)));
  app.post('/api/laundry/order-holds', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.order-hold', () => createLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/resume', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-resume:${req.params.id}`, () => resumeLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles?.includes('owner') === true))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/claim', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-claim:${req.params.id}`, () => claimLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/heartbeat', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-heartbeat:${req.params.id}`, () => renewLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/release', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-release:${req.params.id}`, () => releaseLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles?.includes('owner') === true))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/cancel', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-cancel:${req.params.id}`, () => cancelLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles?.includes('owner') === true))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/orders', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryOrders(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/orders/:id', { schema: { params: laundryIdParams }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryOrder(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/laundry/orders/:id/payments', { preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => laundryPaymentSummary(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders/:id/payments', { preHandler: [guard, allow('payments.collect')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.payment:${req.params.id}`, () => collectLaundryPayment(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/payments/:id/reverse', { preHandler: [guard, allow('payments.refund')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.payment-reversal:${req.params.id}`, () => reverseLaundryPayment(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || '')))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders/:id/transition', { schema: { params: laundryIdParams, body: laundryTransitionBody }, preHandler: [guard, allow('orders.transition')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      return inStore(req, () => transitionLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, body?.state, body?.note, body?.expectedVersion));
    } catch (error: any) { return laundryFailure(rep, error); }
  });
  app.post('/api/laundry/orders/:id/cancel', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => cancelLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || ''), (req.body as any)?.expectedVersion)); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'order cancellation failed' }); }
  });
  app.patch('/api/laundry/orders/:id', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => editLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'order edit failed' }); }
  });
  app.post('/api/laundry/orders/:id/assign', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => assignLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/orders/:id/fulfillment', { preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => listLaundryFulfillment(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/laundry/garment-units', { preHandler: [guard, allow('garments.read')] }, async (req: any) => inStore(req, () => listLaundryGarmentUnits(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/rack-occupancy', { preHandler: [guard, allow('garments.read')] }, async (req: any) => inStore(req, () => rackOccupancy(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/rack-profiles', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listRackProfiles(req.auth!.tenant, true)));
  app.post('/api/laundry/rack-profiles', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => { try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.rack-profile-create', () => createRackProfile(req.auth!.tenant, req.auth!.actor, req.body || {})))); } catch (error: any) { return rep.code(400).send({ error: error.message }); } });
  app.patch('/api/laundry/rack-profiles/:id', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => { try { return updateRackProfile(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}); } catch (error: any) { rep.code(400); return { error: error.message }; } }));
  app.get('/api/laundry/garment-units/:id', { schema: { params: laundryIdParams }, preHandler: [guard, allow('garments.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryGarmentUnit(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/garment-units/scan', { schema: { body: laundryScanBody }, preHandler: [guard, allow('garments.scan')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.garment-scan', () => scanLaundryGarment(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.get('/api/laundry/containers/:id', { schema: { params: laundryIdParams }, preHandler: [guard, allow('garments.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryContainerDetail(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/containers/scan', { schema: { body: laundryContainerScanBody }, preHandler: [guard, allow('garments.scan')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.container-scan', () => scanLaundryContainer(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.post('/api/laundry/garment-units/:id/reprint', { schema: { params: laundryIdParams, body: laundryLifecycleBody }, preHandler: [guard, allow('tags.reprint')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.tag-reprint:${req.params.id}`, () => reprintLaundryTag(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.post('/api/laundry/garment-units/:id/replace-tag', { schema: { params: laundryIdParams, body: laundryLifecycleBody }, preHandler: [guard, allow('tags.replace')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.tag-replace:${req.params.id}`, () => replaceLaundryTag(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.get('/api/laundry/print-jobs', { schema: { querystring: { type: 'object', properties: { orderId: { type: 'string', maxLength: 120 } }, additionalProperties: false } }, preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryPrintJobs(req.auth!.tenant, String(req.query?.orderId || '') || undefined)));
  app.post('/api/laundry/print-jobs', { schema: { body: laundryPrintJobBody }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.print-job:${String(req.body?.orderId || '')}`, () => createLaundryPrintJob(req.auth!.tenant, req.auth!.actor, req.body || {})))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.get('/api/laundry/production-queue', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => listProductionTasks(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/production-load', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionLoad(req.auth!.tenant)));
  app.get('/api/laundry/production-workload', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionWorkload(req.auth!.tenant)));
  app.get('/api/laundry/production-supervisor-metrics', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionSupervisorMetrics(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/production-schedule', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionSchedule(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/production-workload/assign', { preHandler: [guard, allow('production.assign')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, 'laundry.production-workload-assign', () => applyProductionWorkloadRecommendations(req.auth!.tenant, req.auth!.actor, (req.body as any)?.taskIds))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/production-tasks/:id/assign', { preHandler: [guard, allow('production.assign')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.production-assign:${req.params.id}`, () => assignProductionTask(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.assignedTo || '')))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/production-tasks/:id/start', { preHandler: [guard, allow('production.start')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.production-start:${req.params.id}`, () => startProductionTask(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/quality-claims', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => listQualityClaims(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/quality-analytics', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => qualityAnalytics(req.auth!.tenant)));
  app.get('/api/laundry/customer-corrections', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => listCustomerCorrections(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/quality-claims', { preHandler: [guard, allow('quality.open')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => openQualityClaim(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/quality-claims/:id/resolve', { preHandler: [guard, allow('quality.resolve')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => resolveQualityClaim(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.decision || ''), String((req.body as any)?.note || ''))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/routes', { preHandler: [guard, allowAny('routes.read', 'routes.read.assigned')] }, async (req: any) => inStore(req, () => listRouteRuns(req.auth!.tenant, { ...(req.query as any), ...(req.auth!.roles.includes('rider') ? { riderId: req.auth!.riderId || '__unlinked-rider__' } : {}) })));
  app.get('/api/laundry/service-zones', { preHandler: [guard, allowAny('routes.read', 'routes.read.assigned')] }, async (req: any) => inStore(req, () => listServiceZones(req.auth!.tenant, req.auth!.roles.includes('rider') ? req.auth!.riderId : undefined)));
  app.get('/api/laundry/service-zone-master', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listServiceZoneMaster(req.auth!.tenant, true)));
  app.post('/api/laundry/service-zone-master', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => { try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.service-zone-create', () => createServiceZone(req.auth!.tenant, req.auth!.actor, req.body || {})))); } catch (error: any) { return rep.code(400).send({ error: error.message }); } });
  app.patch('/api/laundry/service-zone-master/:id', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => { try { return updateServiceZone(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}); } catch (error: any) { rep.code(400); return { error: error.message }; } }));
  app.get('/api/laundry/route-analytics', { preHandler: [guard, allowAny('routes.read', 'routes.read.assigned')] }, async (req: any) => inStore(req, () => routeCoverageAnalytics(req.auth!.tenant, req.auth!.roles.includes('rider') ? (req.auth!.riderId || '__unlinked-rider__') : undefined)));
  app.post('/api/laundry/routes', { preHandler: [guard, allow('routes.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.route-create', () => createRouteRun(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/routes/:id/start', { preHandler: [guard, allowAny('routes.manage', 'routes.manage.assigned')] }, async (req: any, rep: any) => {
    if (req.auth!.roles.includes('rider') && !req.auth!.riderId) return rep.code(403).send({ error: 'rider account is not linked to an active rider record' });
    try { return inStore(req, () => idempotent(req, `laundry.route-start:${req.params.id}`, () => startRouteRun(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles.includes('rider') ? req.auth!.riderId : undefined))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/routes/:runId/stops/:stopId/complete', { preHandler: [guard, allowAny('routes.manage', 'routes.manage.assigned')] }, async (req: any, rep: any) => {
    if (req.auth!.roles.includes('rider') && !req.auth!.riderId) return rep.code(403).send({ error: 'rider account is not linked to an active rider record' });
    try { return inStore(req, () => idempotent(req, `laundry.route-stop:${req.params.stopId}`, () => completeRouteStop(req.auth!.tenant, req.auth!.actor, req.params.runId, req.params.stopId, req.body as any, req.auth!.roles.includes('rider') ? req.auth!.riderId : undefined))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/ops/hardware-capabilities', { preHandler: [guard, allow('hardware.read')] }, async () => hardwareCapabilities());
  app.get('/api/ops/hardware-status', { preHandler: [guard, allow('hardware.read')] }, async (req: any) => inStore(req, () => hardwareStatus(req.auth!.tenant)));
  app.get('/api/ops/diagnostics', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => buildDiagnostics(req.auth!.tenant, req.auth!.storeId)));
  app.get('/api/ops/financial-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => previewFinancialNormalization(req.auth!.tenant)));
  app.get('/api/ops/compatibility-audit', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => compatibilityRetirementAudit(req.auth!.tenant, req.auth!.storeId)));
  app.get('/api/ops/entity-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const entity = String((req.query as any)?.entity || '');
    if (!ENTITY_NORMALIZATION_ENTITIES.includes(entity as EntityNormalizationEntity)) return rep.code(400).send({ error: 'entity must be party or laundry_order' });
    try { return inStore(req, () => previewEntityNormalization(req.auth!.tenant, entity as EntityNormalizationEntity)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/ops/entity-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const entity = String((req.body as any)?.entity || '');
    if (!ENTITY_NORMALIZATION_ENTITIES.includes(entity as EntityNormalizationEntity)) return rep.code(400).send({ error: 'entity must be party or laundry_order' });
    try { return inStore(req, () => idempotent(req, `ops.entity-normalization:${entity}`, () => applyEntityNormalization(req.auth!.tenant, req.auth!.actor, entity as EntityNormalizationEntity, Number((req.body as any)?.batchSize || 250)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/ops/financial-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, 'ops.financial-normalization', () => applyFinancialNormalization(req.auth!.tenant, req.auth!.actor))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/ops/hardware-receipts', { preHandler: [guard, allow('hardware.read')] }, async (req: any) => inStore(req, () => listHardwareReceipts(req.auth!.tenant)));
  app.post('/api/ops/hardware-receipts', { preHandler: [guard, allow('hardware.receipt')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'ops.hardware-receipt', () => recordHardwareReceipt(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/print-settings', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => {
    const settings = store.getStoreSettings(req.auth!.tenant, req.auth!.storeId);
    return {
      businessName: settings.businessName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      upiId: settings.upiId,
      qrOnPrint: settings.qrOnPrint,
      logoDataUrl: settings.logoDataUrl,
      taxMode: settings.taxMode,
      gstin: settings.gstin,
      currency: settings.currency,
      timezone: settings.timezone,
      printerProfile: settings.printerProfile,
      afterBooking: settings.afterBooking,
      printerProfiles: settings.printerProfiles,
      tagTemplate: settings.tagTemplate,
    };
  }));
  app.post('/api/laundry/orders/:id/fulfillment', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => recordLaundryFulfillment(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/riders', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryRiders(req.auth!.tenant)));
  app.post('/api/laundry/riders', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => createLaundryRider(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/dispatch', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => laundryDispatch(req.auth!.tenant)));
  app.get('/api/laundry/rider-settlements', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryRiderSettlements(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/rider-settlements', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.rider-settlement', () => saveLaundryRiderSettlement(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/rider-settlements/:id', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryRiderSettlement(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/expenses', { preHandler: [guard, allow('expenses.create')] }, async (req: any) => inStore(req, () => listLaundryExpenses(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/expenses', { preHandler: [guard, allow('expenses.create')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => createLaundryExpense(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/expenses/:id/cancel', { preHandler: [guard, allow('expenses.create')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => cancelLaundryExpense(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || ''))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/expenses/:id', { preHandler: [guard, allow('expenses.create')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => editLaundryExpense(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any, String((req.body as any)?.reason || ''))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'expense edit failed' }); }
  });
  app.get('/api/laundry/reports', { preHandler: [guard, allow('reports.read')] }, async (req: any) => {
    const query = req.query as any;
    return inStore(req, () => laundryReports(req.auth!.tenant, query?.from, query?.to));
  });
  app.get('/api/laundry/reports/:kind/export', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try {
      const cap = 5000;
      const result = inStore(req, () => laundryReportDetail(req.auth!.tenant, req.params.kind, req.query?.from, req.query?.to, req.query?.search, 1, cap, cap));
      return { ...result, exportAll: true, exportCap: cap, exportTruncated: result.totalRows > cap };
    }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/report-exports', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return rep.code(202).send(inStore(req, () => idempotent(req, 'laundry.report-export-queue', () => createLaundryReportExportJob(req.auth!.tenant, req.auth!.actor, { ...(req.body || {}), kind: req.body?.kind || req.body?.reportKind })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'report export could not be queued' }); }
  });
  app.get('/api/laundry/report-exports/:id', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryReportExportJob(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/laundry/report-exports/:id/download', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { const result = inStore(req, () => readLaundryReportExport(req.auth!.tenant, req.params.id)); rep.header('Content-Type', 'text/csv; charset=utf-8'); rep.header('Content-Disposition', `attachment; filename="${result.job.fileName}"`); return rep.send(result.csv); }
    catch (error: any) { return rep.code(409).send({ error: error.message }); }
  });
  app.get('/api/laundry/report-views', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => listSavedReportViews(req.auth!.tenant, req.auth!.actor)));
  app.post('/api/laundry/report-views', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.report-view-create', () => createSavedReportView(req.auth!.tenant, req.auth!.actor, { ...(req.body || {}), kind: req.body?.kind || req.body?.reportKind }, req.auth!.roles.includes('owner'))))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'saved report view could not be created' }); }
  });
  app.delete('/api/laundry/report-views/:id', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => inStore(req, () => { try { return deleteSavedReportView(req.auth!.tenant, req.auth!.actor, req.params.id); } catch (error: any) { rep.code(400); return { error: error.message }; } }));
  app.get('/api/laundry/reconciliation', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => laundryFinancialReconciliation(req.auth!.tenant)));
  app.get('/api/laundry/cash-close-drill', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => cashCloseDrill(req.auth!.tenant, String(req.query?.businessDate || ''))));
  app.get('/api/laundry/financial-entries', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => store.listFinancialEntries(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/cash-shift', { preHandler: [guard, allow('cash.read')] }, async (req: any) => inStore(req, () => getCurrentCashShift(req.auth!.tenant, String((req.query as any)?.register || '').trim() || undefined)));
  app.get('/api/laundry/cash-shifts', { preHandler: [guard, allow('cash.read')] }, async (req: any) => inStore(req, () => listCashShifts(req.auth!.tenant)));
  app.post('/api/laundry/cash-shift/open', { preHandler: [guard, allow('cash.open')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.cash-shift-open', () => openCashShift(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/cash-shift/close', { preHandler: [guard, allow('cash.close')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.cash-shift-close', () => closeCashShift(req.auth!.tenant, req.auth!.actor, { ...(req.body || {}), supervisorApproved: req.auth!.roles.includes('owner'), supervisorActor: req.auth!.roles.includes('owner') ? req.auth!.actor : undefined })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/reports/:kind', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try {
      const page = Math.max(1, Math.floor(Number(req.query?.page) || 1));
      const pageSize = Math.max(1, Math.min(500, Math.floor(Number(req.query?.pageSize) || 100)));
      return inStore(req, () => laundryReportDetail(req.auth!.tenant, req.params.kind, req.query?.from, req.query?.to, req.query?.search, page, pageSize));
    }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/statistics', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => {
    const requestedPeriod = String(req.query?.period || 'today');
    const period = requestedPeriod === 'week' ? 'week' : requestedPeriod === 'lifetime' ? 'lifetime' : 'today';
    return laundryStatistics(req.auth!.tenant, period);
  }));
  app.post('/api/laundry/import/customers', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.customer-import', () => importLaundryCustomers(req.auth!.tenant, req.auth!.actor, req.body?.rows)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/import/prices', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.price-import', () => importLaundryPrices(req.auth!.tenant, req.auth!.actor, req.body?.rows)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/import/jobs', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any) =>
    inStore(req, () => listLaundryImportJobs(req.auth!.tenant, String((req.query as any)?.type || ''))),
  );

  // ---- generic entity CRUD (the Schema Registry in action) ----
  app.get('/api/:entity', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => {
    const { entity } = req.params;
    if (!getDef(entity)) return req.status ? null : { error: 'unknown entity' };
    return listRows(req.auth!.tenant, entity).map((r) => ({ id: r.id, status: r.status, ...r.data }));
  });

  app.get('/api/:entity/:id', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const { entity, id } = req.params;
    try { return getRow(req.auth!.tenant, entity, id); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });

  app.post('/api/:entity', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const { entity } = req.params;
      const data = (req.body as any)?.data || req.body;
      const row = createRow(req.auth!.tenant, req.auth!.actor, entity, data);
      return rep.code(201).send(row);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/:entity/:id/submit', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return submitRow(req.auth!.tenant, req.auth!.actor, req.params.entity, req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/:entity/:id/cancel', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return cancelRow(req.auth!.tenant, req.auth!.actor, req.params.entity, req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- ledger / audit / event outbox (relay) ----
  app.get('/api/ledger/gl', { preHandler: [guard, allow('reports.read')] }, async (req: any) => store.glOf(req.auth!.tenant));
  app.get('/api/ledger/audit', { preHandler: [guard, allow('reports.read')] }, async (req: any) => store.auditOf(req.auth!.tenant).slice(-200).reverse());
  app.get('/api/events/outbox', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => drainOutbox(req.auth!.tenant));

  // ---- WhatsApp (shotlinXchat / WhatsAPI) ----
  const wa = new ShotlinXchatAdapter();

  app.post('/api/wa/inbound', async (req: any, rep: any) => {
    // WhatsAPI pushes recent messages here (or we poll /api/v1/messages).
    const m = req.body as any;
    const from = m?.from || m?.to || m?.phone;
    const text = m?.body || m?.message || m?.text || '';
    if (!from) return rep.code(400).send({ error: 'no sender' });
    // CRM capture: attach to existing party or create a lead (consent-gated).
    let party = store.rowsOf(TENANT, 'party').find((p) => p.data.phone === from);
    if (!party) {
      party = createRow(TENANT, 'wa-bot', 'party', {
        name: 'WA:' + from, phone: from, is_customer: true,
      });
      audit(TENANT, 'wa-bot', 'crm:lead-created', { row_id: party.id, after: { from } });
    }
    // Never place phone numbers or message bodies in logs/audit payloads.
    // Support can correlate a webhook without exposing customer content.
    const senderHash = createHash('sha256').update(String(from), 'utf8').digest('hex');
    const textHash = createHash('sha256').update(String(text), 'utf8').digest('hex');
    audit(TENANT, 'wa-bot', 'wa:inbound', { entity: 'party', row_id: party.id, after: { senderHash, textHash, textLength: String(text).length } });
    console.log(`[wa] inbound received senderHash=${senderHash} textLength=${String(text).length}`);
    return { ok: true, party: party.id };
  });

  app.get('/api/wa/qr', async () => wa.getQr());
  app.post('/api/wa/webhook', { preHandler: guard }, async (req: any, rep: any) => {
    const url = (req.body as any)?.url || `${process.env.EPIC_PUBLIC_BASE || 'http://localhost:3001'}/api/wa/inbound`;
    const r = await wa.setWebhook(url);
    return rep.code(r.ok ? 200 : 502).send(r);
  });
  app.post('/api/wa/send', { preHandler: guard }, async (req: any, rep: any) => {
    const { to, message } = req.body as any;
    if (!to || !message) return rep.code(400).send({ error: 'to+message required' });
    const r = await wa.sendText(to, message);
    return rep.code(r.ok ? 200 : 502).send(r);
  });

  // ---- GST compliance engine (the moat) ----
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  function company() {
    return {
      gstin: process.env.EPIC_SUPPLIER_GSTIN || '',
      name: process.env.EPIC_COMPANY_NAME || 'Epic BOS Demo',
      addr: process.env.EPIC_COMPANY_ADDR || '',
      state: process.env.EPIC_SUPPLIER_STATE || '29',
    };
  }
  app.get('/api/gst/einvoice/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(requestTenant(req), req.params.id);
    if (!row || !['sales_invoice', 'pos_invoice'].includes(row.entity)) return rep.code(404).send({ error: 'not found' });
    const gst = row.data.__gst;
    if (!gst) return rep.code(400).send({ error: 'invoice not submitted' });
    const p = store.getRow(requestTenant(req), row.data.customer);
    return buildEinvoicePayload({ name: row.data.name, posting_date: row.data.posting_date, data: row.data }, company(), {
      name: p?.data?.name || (row.entity === 'pos_invoice' ? 'Walk-in Customer' : ''), gstin: p?.data?.gstin, addr: p?.data?.addr,
      state: p?.data?.state, pos: row.data.place_of_supply,
    }, gst);
  });
  app.get('/api/gst/print/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(requestTenant(req), req.params.id);
    const gst = row?.data?.__gst;
    if (!gst) return rep.code(400).send({ error: 'no GST computed' });
    const p = store.getRow(requestTenant(req), row.data.customer);
    rep.header('Content-Type', 'text/html');
    return renderTaxInvoice(
      { name: row.data.name, posting_date: row.data.posting_date, data: row.data },
      { name: p?.data?.name || (row.entity === 'pos_invoice' ? 'Walk-in Customer' : ''), gstin: p?.data?.gstin, addr: p?.data?.addr }, company(), gst,
      row.data.__einvoice,
    );
  });
  app.get('/api/gst/gstr1', { preHandler: guard }, async (req: any) => {
    const tenant = requestTenant(req);
    const invs = store.rowsOf(tenant, 'sales_invoice')
      .filter((r) => r.status === 'Submitted')
      .map((r) => ({ data: r.data, gst: r.data.__gst }));
    const cns = store.rowsOf(tenant, 'credit_note')
      .filter((r) => r.status === 'Submitted')
      .map((r) => ({ data: r.data, gst: r.data.__gst }));
    return {
      ...buildGstr1(invs, (data) => !!store.getRow(tenant, data.customer)?.data?.gstin),
      ...buildCdnr(cns, (data) => store.getRow(tenant, data.reference_invoice)?.data?.name || ''),
    };
  });
  app.get('/api/gst/cockpit', { preHandler: guard }, async (req: any) => {
    const invs = store.rowsOf(requestTenant(req), 'sales_invoice').filter((r) => r.status === 'Submitted');
    let cgst = 0, sgst = 0, igst = 0, taxable = 0;
    for (const r of invs) { const g = r.data.__gst; if (!g) continue; cgst += g.totalCgst; sgst += g.totalSgst; igst += g.totalIgst; taxable += g.totalTaxable; }
    const threshold = Number(process.env.GST_EINVOICE_THRESHOLD || 5000000);
    return {
      supplierState: process.env.EPIC_SUPPLIER_STATE || '29',
      periodInvoices: invs.length,
      outputTax: { cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), total: round2(cgst + sgst + igst) },
      taxable: round2(taxable),
      einvoiceApplicable: true,
      thresholdNote: `E-invoicing mandated when aggregate turnover > ₹${threshold.toLocaleString('en-IN')}`,
      nextGstr1Due: '10th of next month',
      nextGstr3bDue: '20th of next month',
    };
  });

  // ---- E-invoice (IRN) via GSP ----
  app.post('/api/gst/irn/:id', { preHandler: guard }, async (req: any, rep: any) => {
    try { return await generateIrnForInvoice(requestTenant(req), req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/gst/irn/:id/cancel', { preHandler: guard }, async (req: any, rep: any) => {
    const reason = (req.body as any)?.reason || 'Data entry mistake';
    try { return await cancelIrnForInvoice(requestTenant(req), req.params.id, reason); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/gst/irn/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(requestTenant(req), req.params.id);
    return { einvoice: row?.data?.__einvoice || null, status: row?.data?.einvoice_status || 'NOT_GENERATED' };
  });

  // ---- E-way bill via GSP ----
  app.post('/api/gst/eway/:id', { preHandler: guard }, async (req: any, rep: any) => {
    try { return await generateEwbForInvoice(requestTenant(req), req.params.id, (req.body as any)?.transporter); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/gst/eway/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(requestTenant(req), req.params.id);
    return { eway: row?.data?.__eway || null };
  });

  // ---- IMS (inward supply 2A/2B matching) ----
  app.get('/api/gst/ims', { preHandler: guard }, async (req: any) => {
    const period = (req.query as any)?.period as string | undefined;
    return getImsSupplies(requestTenant(req), period);
  });
  app.post('/api/gst/ims/action', { preHandler: guard }, async (req: any, rep: any) => {
    const { irn, action, reason } = req.body as any;
    if (!irn || !['ACC', 'REJ', 'PEN'].includes(action)) return rep.code(400).send({ error: 'irn + valid action required' });
    return recordImsAction(requestTenant(req), irn, action, reason, requestActor(req));
  });

  // ---- CRM: convert a lead into party + opportunity (optionally a quotation) ----
  app.post('/api/lead/:id/convert', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any) || {};
      const out = convertLead(requestTenant(req), requestActor(req), req.params.id, { gstin: b.gstin, createQuotation: !!b.createQuotation });
      return {
        party: out.party,
        opportunity: { id: out.opportunity.id },
        quotation: out.quotation ? { id: out.quotation.id } : undefined,
        lead: { id: req.params.id },
      };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- CRM: lead scoring ----
  app.post('/api/crm/lead/:id/score', { preHandler: guard }, async (req: any, rep: any) => {
    try { return scoreLead(requestTenant(req), req.params.id); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });
  app.post('/api/crm/score-all', { preHandler: guard }, async (req: any) => scoreAllLeads(requestTenant(req)));

  // ---- CRM: activities (timeline) ----
  app.post('/api/crm/activity', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any)?.data || req.body;
      const row = logActivity(requestTenant(req), requestActor(req), b);
      return rep.code(201).send(row);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/crm/timeline/:id', { preHandler: guard }, async (req: any) =>
    activitiesFor(requestTenant(req), (req.query as any)?.ref_entity, req.params.id).map((a) => ({ id: a.id, ...a.data, created_at: a.created_at })));

  // ---- CRM: duplicate detection + merge ----
  app.get('/api/crm/duplicates', { preHandler: guard }, async (req: any) => findDuplicateLeads(requestTenant(req)));
  app.post('/api/crm/merge', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any) || {};
      if (!b.primary || !Array.isArray(b.duplicates)) return rep.code(400).send({ error: 'primary + duplicates[] required' });
      return mergeLeads(requestTenant(req), requestActor(req), b.primary, b.duplicates);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- CRM: opportunity win/lose + assignment ----
  app.post('/api/crm/opportunity/:id/win', { preHandler: guard }, async (req: any, rep: any) => {
    try { return winOpportunity(requestTenant(req), requestActor(req), req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/crm/opportunity/:id/lose', { preHandler: guard }, async (req: any, rep: any) => {
    try { return loseOpportunity(requestTenant(req), requestActor(req), req.params.id, (req.body as any)?.lost_reason || ''); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/crm/lead/:id/assign', { preHandler: guard }, async (req: any) => ({ owner: assignOwner(requestTenant(req), req.params.id) }));

  // ---- CRM: pipeline board, forecast, analytics (for the dashboard) ----
  app.get('/api/crm/pipeline', { preHandler: guard }, async (req: any) => getPipeline(requestTenant(req), req.query as any));
  app.get('/api/crm/forecast', { preHandler: guard }, async (req: any) => getForecast(requestTenant(req), req.query as any));
  app.get('/api/crm/analytics/source', { preHandler: guard }, async (req: any) => getSourceAnalytics(requestTenant(req)));
  app.get('/api/crm/analytics/lost-reasons', { preHandler: guard }, async (req: any) => getLostReasonPareto(requestTenant(req)));
  app.get('/api/crm/analytics/owners', { preHandler: guard }, async (req: any) => getOwnerPerformance(requestTenant(req)));

  // ---- Dashboard analytics: KPIs + time-series for the home command center ----
  app.get('/api/dashboard/summary', { preHandler: guard }, async (req: any) =>
    dashboardSummary(requestTenant(req), (req.query as any)?.asOf));

  // ---- P19 Engagement: multi-channel gateway, templates, campaigns, notifications ----
  // Templates use the generic CRUD (`/api/message_template`). These are the action routes.

  // Send a free-form message on any channel (WhatsApp/Email/SMS). Offline-simulated unless creds set.
  app.post('/api/engage/send', { preHandler: guard }, async (req: any, rep: any) => {
    const { channel, to, message, subject } = (req.body as any) || {};
    if (!channel || !to || !message) return rep.code(400).send({ error: 'channel + to + message required' });
    try { return await inStore(req, () => sendMessage(req.auth!.tenant, req.auth!.actor, channel, to, message, { subject })); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // Send using a saved template to a party/lead (renders {{merge}} fields from the record).
  app.post('/api/engage/send-templated', { preHandler: guard }, async (req: any, rep: any) => {
    const { template, ref, extra } = (req.body as any) || {};
    if (!template || !ref) return rep.code(400).send({ error: 'template + ref required' });
    try { return await inStore(req, () => sendTemplated(req.auth!.tenant, req.auth!.actor, template, ref, extra)); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // Run a campaign: blast a template to an audience, tracking each recipient as a touch.
  app.post('/api/engage/campaign/:id/run', { preHandler: guard }, async (req: any, rep: any) => {
    const b = (req.body as any) || {};
    const templateId = b.templateId || b.template;
    if (!templateId) return rep.code(400).send({ error: 'template required' });
    try { return await inStore(req, () => runCampaign(req.auth!.tenant, req.auth!.actor, req.params.id, { templateId, audience: b.audience, consentOnly: b.consentOnly })); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // Per-campaign stats (touches sent/delivered/failed/skipped + reach %).
  app.get('/api/engage/campaign/:id/stats', { preHandler: guard }, async (req: any) => inStore(req, () => campaignStats(req.auth!.tenant, req.params.id)));

  // Notification center (internal inbox).
  app.get('/api/notifications', { preHandler: guard }, async (req: any) =>
    inStore(req, () => listNotifications(req.auth!.tenant, { unreadOnly: (req.query as any)?.unread === '1', user: req.auth!.actor })
      .map((n) => ({ id: n.id, ...n.data, created_at: n.created_at }))));
  app.post('/api/notifications/:id/read', { preHandler: guard }, async (req: any, rep: any) => {
    try { return inStore(req, () => markNotificationRead(req.auth!.tenant, req.params.id, (req.body as any)?.read !== false)); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });
  app.post('/api/notifications/read-all', { preHandler: guard }, async (req: any) =>
    inStore(req, () => ({ marked: markAllRead(req.auth!.tenant, req.auth!.actor) })));
  // Pull the ops alerts (overdue receivables, low stock, GST due dates) into the notification inbox.
  app.post('/api/notifications/sync-alerts', { preHandler: guard }, async (req: any) => inStore(req, () => {
    const a = getAlerts(req.auth!.tenant) as any;
    const norm: { type: string; message: string; severity?: string; ref?: string }[] = [];
    for (const o of a.overdue || [])
      norm.push({ type: 'Receivable', message: `Overdue ₹${o.due} from ${o.customer || o.name} (${o.age}d)`, severity: 'warning', ref: o.id });
    for (const r of a.reorder || [])
      norm.push({ type: 'Stock', message: `Low stock: ${r.name} (on-hand ${r.on_hand}, reorder ${r.reorder_level})`, severity: 'warning', ref: r.item });
    for (const g of a.gst || [])
      norm.push({ type: 'Compliance', message: g.message || `${g.name || 'GST'} due ${g.due || ''}`.trim(), severity: 'critical', ref: g.name });
    for (const s of a.subscriptions_due || [])
      norm.push({ type: 'Billing', message: `Subscription renewal due: ${s.name} on ${s.next}`, severity: 'info', ref: s.id });
    for (const b of a.budgets || [])
      norm.push({ type: 'Budget', message: `Budget breach: ${b.name} at ${b.pct}% (₹${b.actual} / ₹${b.budget})`, severity: 'warning', ref: b.id });
    return { created: syncAlertsToNotifications(req.auth!.tenant, norm) };
  }));

  // ---- Inventory: stock balances + low-stock alert ----
  app.get('/api/inventory/stock', { preHandler: guard }, async (req: any) => {
    const wh = (req.query as any)?.warehouse as string | undefined;
    const tenant = requestTenant(req);
    const items = store.rowsOf(tenant, 'item');
    const whs = store.rowsOf(tenant, 'warehouse');
    const balances: Record<string, Record<string, number>> = {};
    for (const s of store.stockOf(tenant)) {
      if (wh && s.warehouse !== wh) continue;
      balances[s.item] ||= {};
      balances[s.item][s.warehouse] = (balances[s.item][s.warehouse] || 0) + s.qty;
    }
    return {
      warehouses: whs.map((w) => ({ id: w.id, name: w.data.name })),
      items: items.map((it) => ({
        id: it.id, name: it.data.name, item_code: it.data.item_code,
        by_warehouse: balances[it.id] || {},
        total: Object.values(balances[it.id] || {}).reduce((a, b) => a + b, 0),
        reorder: Number(it.data.reorder_level || 0),
        low: (Number(it.data.reorder_level || 0) > 0)
          && (Object.values(balances[it.id] || {}).reduce((a, b) => a + b, 0) <= Number(it.data.reorder_level || 0)),
      })),
    };
  });

  // ---- Inventory depth (Phase-16): valuation, serials, batches ----
  app.get('/api/inventory/valuation', { preHandler: guard }, async (req: any) => {
    const method = ((req.query as any).method === 'fifo' ? 'fifo' : 'moving-average') as 'moving-average' | 'fifo';
    return { method, ...stockValuation(requestTenant(req), method) };
  });
  app.get('/api/inventory/serials', { preHandler: guard }, async (req: any) => serialStock(requestTenant(req)));
  app.get('/api/inventory/batches', { preHandler: guard }, async (req: any) => batchStock(requestTenant(req)));
  app.get('/api/inventory/balances', { preHandler: guard }, async (req: any) => getStockBalance(requestTenant(req)));

  // ---- Manufacturing depth (Phase-17): BOM cost, explosion, MRP planning ----
  app.get('/api/manufacturing/bom-cost', { preHandler: guard }, async (req: any) => {
    const item = (req.query as any).item; if (!item) return { error: 'item required' };
    return bomCost(requestTenant(req), item, Number((req.query as any).qty || 1));
  });
  app.get('/api/manufacturing/explode', { preHandler: guard }, async (req: any) => {
    const item = (req.query as any).item; if (!item) return { error: 'item required' };
    return explodeBom(requestTenant(req), item, Number((req.query as any).qty || 1));
  });
  app.get('/api/manufacturing/mrp', { preHandler: guard }, async (req: any) => planMaterials(requestTenant(req)));
  app.post('/api/manufacturing/mrp/work-orders', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {};
    if (!b.items?.length) return rep.code(400).send({ error: 'items required' });
    const created = createPlannedWorkOrders(requestTenant(req), b.module || 'manufacturing', b.items);
    return { created: created.map((r: any) => ({ id: r.id, name: r.data.name })) };
  });
  app.post('/api/manufacturing/mrp/purchase-order', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {};
    if (!b.supplier || !b.items?.length) return rep.code(400).send({ error: 'supplier and items required' });
    const po = createPlannedPurchaseOrder(requestTenant(req), b.module || 'buying', b.supplier, b.items, {
      isSubcontracted: b.isSubcontracted, suppliedItems: b.suppliedItems,
    });
    return { id: po.id, name: po.data.name };
  });

  // ---- Accounting: Trial Balance / P&L / Balance Sheet / Ledger ----
  app.get('/api/accounting/trial-balance', { preHandler: guard }, async (req: any) => getTrialBalance(requestTenant(req), (req.query as any).cost_center));
  app.get('/api/accounting/pnl', { preHandler: guard }, async (req: any) => getPnL(requestTenant(req), (req.query as any).cost_center));
  app.get('/api/accounting/balancesheet', { preHandler: guard }, async (req: any) => getBalanceSheet(requestTenant(req), (req.query as any).cost_center));
  app.get('/api/accounting/ledger/:account', { preHandler: guard }, async (req: any) => {
    const name = decodeURIComponent(String(req.params.account));
    return { account: name, entries: getLedger(requestTenant(req), name) };
  });

  // ---- Banking: bank statement import + reconcile + outstanding ----
  app.post('/api/bank/import', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body as any;
    const lines = (b.lines || []).map((l: any) => ({
      date: l.date,
      narration: l.narration || l.particulars || '',
      withdrawal: Math.round((Number(l.withdrawal || l.debit || 0)) * 100) / 100,
      deposit: Math.round((Number(l.deposit || l.credit || 0)) * 100) / 100,
      balance: Math.round((Number(l.balance || 0)) * 100) / 100,
      reconciled: false,
    }));
    try {
      const stmt = createRow(requestTenant(req), requestActor(req), 'bank_statement', {
        bank_name: b.bank_name, account_no: b.account_no, period: b.period, lines,
      });
      return rep.code(201).send(stmt);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/bank/:id/reconcile', { preHandler: guard }, async (req: any, rep: any) => {
    const stmt = store.getRow(requestTenant(req), req.params.id);
    if (!stmt || stmt.entity !== 'bank_statement') return rep.code(404).send({ error: 'statement not found' });
    const { index, party } = req.body as any;
    const lines = (stmt.data.lines || []) as any[];
    const line = lines[Number(index)];
    if (!line) return rep.code(400).send({ error: 'line not found' });
    if (line.reconciled) return rep.code(400).send({ error: 'line already reconciled' });
    const deposit = Number(line.deposit) || 0;
    const withdrawal = Number(line.withdrawal) || 0;
    if (deposit <= 0 && withdrawal <= 0) return rep.code(400).send({ error: 'line has no amount' });
    const isDeposit = deposit > 0;
    const amount = isDeposit ? deposit : withdrawal;
    try {
      const payment = createRow(requestTenant(req), requestActor(req), 'payment_entry', {
        payment_type: isDeposit ? 'Receive' : 'Pay',
        party: party || undefined,
        posting_date: line.date || new Date().toISOString().slice(0, 10),
        mode: 'Bank',
        bank_account: stmt.data.account_no || stmt.data.bank_name,
        amount,
        remarks: line.narration || '',
      });
      submitRow(requestTenant(req), requestActor(req), 'payment_entry', payment.id);
      line.reconciled = true;
      store.updateRow(stmt);
      return { payment: payment.id, type: isDeposit ? 'Receive' : 'Pay', amount, index: Number(index) };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.get('/api/banking/outstanding', { preHandler: guard }, async (req: any) => {
    const paidFor = (invId: string) =>
      store.rowsOf(requestTenant(req), 'payment_entry').filter((p) => p.status === 'Submitted').reduce(
        (acc, p) => acc + ((p.data.against_sales === invId || p.data.against_purchase === invId) ? ((store.financialDocumentAmountPaise(requestTenant(req), 'payment', p.entity, p.id) ?? Math.round((Number(p.data.amount) || 0) * 100)) / 100) : 0),
        0,
      );
    const map = (r: any) => {
      const gt = (store.financialDocumentAmountPaise(requestTenant(req), 'invoice', r.entity, r.id) ?? Math.round((Number(r.data.grand_total) || 0) * 100)) / 100;
      const paid = paidFor(r.id);
      return {
        id: r.id, name: r.data.name, type: r.entity,
        party: r.data.customer || r.data.supplier,
        grand_total: gt, paid, balance: Math.max(0, Math.round((gt - paid) * 100) / 100),
      };
    };
    const sales = store.rowsOf(requestTenant(req), 'sales_invoice').filter((r) => r.status === 'Submitted').map(map).filter((x) => x.balance > 0);
    const purchases = store.rowsOf(requestTenant(req), 'purchase_invoice').filter((r) => r.status === 'Submitted').map(map).filter((x) => x.balance > 0);
    return { receivables: sales, payables: purchases };
  });

  // ---- Sync: store-and-forward bulk push (offline POS / field app replays queued docs) ----
  app.post('/api/sync/push', { preHandler: guard }, async (req: any, rep: any) => {
    const docs = (req.body as any)?.docs;
    if (!Array.isArray(docs)) return rep.code(400).send({ error: 'docs[] required' });
    if (docs.length > 500) return rep.code(413).send({ error: 'a maximum of 500 offline commands can be replayed at once' });
    const auth = req.auth as AuthContext;
    const supported = new Set(['laundry_order', 'laundry_expense', 'party', 'laundry_order_transition', 'laundry_order_cancel', 'laundry_order_edit']);
    const results: any[] = [];
    let okN = 0;
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i] as any;
      try {
        const testDelayMs = Math.max(0, Math.min(5_000, Number(process.env.EPIC_TEST_SYNC_DELAY_MS || 0)));
        if (testDelayMs) await new Promise((resolve) => setTimeout(resolve, testDelayMs));
        const entity = String(d?.entity || '').trim();
        if (!supported.has(entity)) throw new Error(`offline sync does not support '${entity || 'unknown'}'; use its authoritative command endpoint`);
        const key = String(d?.idempotencyKey || d?.clientId || '').trim();
        if (!key || key.length > 160) throw new Error('each offline command requires a unique idempotencyKey or clientId');
        const result: any = inStore(req, () => idempotent({ headers: { 'idempotency-key': key }, auth, body: d.data || {} }, `sync:${entity}`, () => {
          if (entity === 'laundry_order') return bookLaundryOrder(auth.tenant, auth.actor, d.data || {});
          if (entity === 'laundry_order_transition') {
            const command = d.data || {};
            if (!command.orderId || !command.state) throw new Error('offline order transition requires orderId and state');
            return transitionLaundryOrder(auth.tenant, auth.actor, String(command.orderId), command.state, command.note, command.expectedVersion);
          }
          if (entity === 'laundry_order_cancel') {
            const command = d.data || {};
            if (!command.orderId || !command.reason) throw new Error('offline order cancellation requires orderId and reason');
            return cancelLaundryOrder(auth.tenant, auth.actor, String(command.orderId), String(command.reason), command.expectedVersion);
          }
          if (entity === 'laundry_order_edit') {
            const command = d.data || {};
            if (!command.orderId) throw new Error('offline order edit requires orderId');
            const { orderId, ...edit } = command;
            return editLaundryOrder(auth.tenant, auth.actor, String(orderId), edit);
          }
          if (entity === 'laundry_expense') return createLaundryExpense(auth.tenant, auth.actor, d.data || {});
          const customer = d.data || {};
          if (!customer.is_customer && customer.is_customer !== undefined) throw new Error('offline party sync only accepts customer records');
          return createLaundryCustomer(auth.tenant, auth.actor, customer);
        }));
        const id = result?.order?.id || result?.id || result?.expense?.id;
        audit(auth.tenant, auth.actor, 'ops:offline-replay-applied', { after: { entity, id: id || null, keyHash: createHash('sha256').update(key).digest('hex') } });
        results.push({ index: i, ok: true, id, entity });
        okN++;
      } catch (e: any) { results.push({ index: i, ok: false, error: e.message }); }
    }
    return { accepted: docs.length, applied: okN, results };
  });
  app.get('/api/sync/replay-audit', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => store.auditOf(req.auth!.tenant).filter((entry) => entry.action === 'ops:offline-replay-applied' || entry.action === 'ops:idempotency-conflict').slice(-200).reverse()));

  // ---- HR & Payroll ----
  app.get('/api/payroll/preview', { preHandler: guard }, async (req: any, rep: any) => {
    const emp = store.getRow(requestTenant(req), (req.query as any).employee);
    if (!emp) return rep.code(404).send({ error: 'employee not found' });
    const ss = emp.data.salary_structure ? store.getRow(requestTenant(req), emp.data.salary_structure)?.data : null;
    if (!ss) return rep.code(400).send({ error: 'employee has no salary structure' });
    return computePayroll(ss, Number((req.query as any).paid_days) || 30, 30);
  });
  app.post('/api/payroll/run', { preHandler: guard }, async (req: any, rep: any) => {
    const { period, paid_days, payment_mode } = req.body as any;
    if (!period) return rep.code(400).send({ error: 'period required' });
    const emps = store.rowsOf(requestTenant(req), 'employee').filter((e) => e.data.is_active && e.data.salary_structure);
    const results: any[] = [];
    for (const e of emps) {
      try {
        const r = createRow(requestTenant(req), requestActor(req), 'salary_slip', { employee: e.id, period, paid_days: Number(paid_days) || 30, payment_mode: payment_mode || 'Bank' });
        const s = submitRow(requestTenant(req), requestActor(req), 'salary_slip', r.id);
        results.push({ ok: true, id: r.id, name: s.id, employee: e.data.name });
      } catch (err: any) { results.push({ ok: false, employee: e.data.name, error: err.message }); }
    }
    return { period, generated: results.length, results };
  });

  // ---- P18 HR Depth: Attendance, Leave, Expense Claims, Loans, Recruitment ----
  // Attendance
  app.post('/api/hr/attendance', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.date || !b.data?.status) return rep.code(400).send({ error: 'employee, date, status required' });
    return recordAttendance(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/attendance', { preHandler: guard }, async (req: any) => {
    const { employee, from, to } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'attendance');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (from) rows = rows.filter(r => r.data.date >= from);
    if (to) rows = rows.filter(r => r.data.date <= to);
    return rows;
  });

  // Leave balances & applications
  app.get('/api/hr/leave-balance', { preHandler: guard }, async (req: any, rep: any) => {
    const { employee, fiscal_year } = req.query as any;
    if (!employee || !fiscal_year) return rep.code(400).send({ error: 'employee and fiscal_year required' });
    return getLeaveBalances(requestTenant(req), employee, fiscal_year);
  });
  app.post('/api/hr/leave-apply', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.leave_type || !b.data?.from_date || !b.data?.to_date) return rep.code(400).send({ error: 'employee, leave_type, from_date, to_date required' });
    return applyLeave(requestTenant(req), requestActor(req), b.data);
  });
  app.post('/api/hr/leave-approve/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const approver = (req.body as any)?.approver; if (!approver) return rep.code(400).send({ error: 'approver required' });
    return approveLeave(requestTenant(req), req.params.id, approver);
  });

  // Expense Claims
  app.post('/api/hr/expense-claim', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.posting_date || !b.data?.items?.length) return rep.code(400).send({ error: 'employee, posting_date, items[] required' });
    return createExpenseClaim(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/expense-claims', { preHandler: guard }, async (req: any) => {
    const { employee, status } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'expense_claim');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });

  // Employee Loans
  app.post('/api/hr/loan', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.loan_type || !b.data?.principal_amount || !b.data?.start_date) return rep.code(400).send({ error: 'employee, loan_type, principal_amount, start_date required' });
    return createEmployeeLoan(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/loan/:id/schedule', { preHandler: guard }, async (req: any) => getLoanSchedule(requestTenant(req), req.params.id));
  app.get('/api/hr/loans', { preHandler: guard }, async (req: any) => {
    const { employee, status } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'employee_loan');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });

  // Recruitment
  app.post('/api/hr/job-opening', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.title) return rep.code(400).send({ error: 'title required' });
    return createJobOpening(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/job-openings', { preHandler: guard }, async (req: any) => {
    const { status } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'job_opening');
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });
  app.post('/api/hr/job-apply', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.job_opening || !b.data?.applicant_name) return rep.code(400).send({ error: 'job_opening, applicant_name required' });
    return applyToJob(requestTenant(req), requestActor(req), b.data);
  });
  app.post('/api/hr/interview', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.job_applicant || !b.data?.round || !b.data?.interviewer || !b.data?.scheduled_on) return rep.code(400).send({ error: 'job_applicant, round, interviewer, scheduled_on required' });
    return scheduleInterview(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/recruitment-pipeline', { preHandler: guard }, async (req: any) => getRecruitmentPipeline(requestTenant(req)));

  // ---- Migration: Tally / Zoho / generic CSV import ----
  app.get('/api/migration/presets', { preHandler: guard }, async () => PRESETS);
  app.post('/api/migration/import', { preHandler: guard }, async (req: any, rep: any) => {
    const { entity, rows, fieldMap, open_bal_account } = req.body as any;
    if (!entity || !Array.isArray(rows)) return rep.code(400).send({ error: 'entity + rows[] required' });
    if (!getDef(entity)) return rep.code(400).send({ error: 'unknown entity: ' + entity });
    try {
      const results = runImport(requestTenant(req), requestActor(req), entity, rows, fieldMap, open_bal_account);
      const ok = results.filter((r) => r.ok).length;
      return { accepted: rows.length, imported: ok, results };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Projects & Services: bill unbilled timesheets into a draft sales invoice ----
  app.post('/api/projects/bill', { preHandler: guard }, async (req: any, rep: any) => {
    const { project } = req.body as any;
    if (!project) return rep.code(400).send({ error: 'project required' });
    try { return billProject(requestTenant(req), requestActor(req), project); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Fixed Assets: run depreciation for a period (YYYY-MM) ----
  app.post('/api/assets/depreciate', { preHandler: guard }, async (req: any, rep: any) => {
    const { period } = req.body as any;
    if (!period) return rep.code(400).send({ error: 'period required (YYYY-MM)' });
    try { return runDepreciation(requestTenant(req), requestActor(req), period); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Compliance: statutory summary + audit-trail verification ----
  app.get('/api/compliance/summary', { preHandler: guard }, async (req: any) => getComplianceSummary(requestTenant(req)));
  app.get('/api/compliance/audit', { preHandler: guard }, async (req: any) => verifyAuditTrail(requestTenant(req)));

  // ---- Multi-currency: FX rate lookup + convert to base (INR) ----
  app.get('/api/fx/rate', { preHandler: guard }, async (req: any) => {
    const code = (req.query as any).code || 'INR';
    return { code, rate: getRate(requestTenant(req), code) };
  });
  app.get('/api/fx/convert', { preHandler: guard }, async (req: any) => {
    const code = (req.query as any).code || 'INR';
    const amount = Number((req.query as any).amount) || 0;
    const rate = getRate(requestTenant(req), code);
    return { code, amount, rate, base: convert(amount, rate) };
  });

  // ---- Platform & Ecosystem: RBAC, payments, RPA, marketplace ----
  app.get('/api/auth/whoami', { preHandler: guard }, async (req: any) => ({
    role: req.headers['x-role'] || 'admin', tenant: requestTenant(req),
  }));
  app.get('/api/rbac/check', { preHandler: guard }, async (req: any) => {
    const { entity, action, role } = req.query as any;
    const def = getDef(entity);
    if (!def) return { ok: false, error: 'unknown entity' };
    return { entity, action, role: role || 'admin', allowed: roleCan(role || 'admin', action, def) };
  });
  app.post('/api/payments/link', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body as any;
    if (!b?.amount) return rep.code(400).send({ error: 'amount required' });
    try { return paymentLink(b); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/rpa/run', { preHandler: guard }, async (req: any, rep: any) => {
    const { bot, input } = req.body as any;
    if (!bot) return rep.code(400).send({ error: 'bot required' });
    try { return runBot(requestTenant(req), requestActor(req), bot, input || {}); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/bank/statement', { preHandler: guard }, async (req: any) => fetchBankStatement({ provider: (req.query as any).provider }));
  app.get('/api/marketplace/apps', { preHandler: guard }, async (req: any) => store.rowsOf(requestTenant(req), 'app_def').map((a) => a.data));

  // ---- Phase-14 Ops pack: pricing, recurring invoices, reorder, alerts, backup ----
  app.post('/api/ops/quote', { preHandler: guard }, async (req: any) => quoteRate(requestTenant(req), req.body || {}));
  app.post('/api/ops/recurring/run', { preHandler: guard }, async (req: any) => {
    const ids = runRecurring(requestTenant(req), (req.body as any)?.asOf);
    return { created: ids.length, invoices: ids };
  });
  app.get('/api/ops/reorder', { preHandler: guard }, async (req: any) => reorderSuggestions(requestTenant(req)));
  app.get('/api/ops/alerts', { preHandler: guard }, async (req: any) => getAlerts(requestTenant(req), (req.query as any)?.asOf));
  app.post('/api/ops/po/from-reorder', { preHandler: guard }, async (req: any, rep: any) => {
    const id = createReorderPO(requestTenant(req), (req.body as any)?.supplier);
    if (!id) return rep.code(400).send({ error: 'nothing below reorder level' });
    return { purchase_order: id };
  });
  app.get('/api/ops/backup', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const db = store.snapshotFor(req.auth!.tenant, req.auth!.storeId);
    const checksum = createHash('sha256').update(JSON.stringify(db), 'utf8').digest('hex');
    rep.type('application/json').header('Content-Disposition', 'attachment; filename="epic-bos-backup.json"');
    return { ...db, backupFormat: 'epic-laundry-backup', backupVersion: 1, createdAt: new Date().toISOString(), tenant: req.auth!.tenant, storeId: req.auth!.storeId, migrations: store.migrationStatus(), checksum };
  });
  app.post('/api/ops/backup/encrypted', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const db = store.snapshotFor(req.auth!.tenant, req.auth!.storeId);
      return rep.type('application/json').send(encryptBackup(db, (req.body as any)?.passphrase, req.auth!.tenant, req.auth!.storeId));
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted backup failed' }); }
  });
  app.get('/api/ops/migrations', { preHandler: [guard, allow('settings.manage')] }, async () => ({ status: 'ok', migrations: store.migrationStatus() }));
  app.post('/api/ops/restore/verify', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const db = validateRestorePayload(req.body, req.auth!.tenant, req.auth!.storeId);
      return { ok: true, backupFormat: 'epic-laundry-backup', rows: db.rows.length, financialEntries: Array.isArray(db.financialEntries) ? db.financialEntries.length : 0, financialDocuments: Array.isArray(db.financialDocuments) ? db.financialDocuments.length : 0, customerLedgerEntries: Array.isArray(db.customerLedgerEntries) ? db.customerLedgerEntries.length : 0, cashShiftCloses: Array.isArray(db.cashShiftCloses) ? db.cashShiftCloses.length : 0, normalizedCustomers: Array.isArray(db.normalizedCustomers) ? db.normalizedCustomers.length : 0, normalizedOrders: Array.isArray(db.normalizedOrders) ? db.normalizedOrders.length : 0, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'backup verification failed' }); }
  });
  app.post('/api/ops/restore/rehearse', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { const db = validateRestorePayload(req.body, req.auth!.tenant, req.auth!.storeId); const result = freshDatabaseRestoreRehearsal(req.auth!.tenant, req.auth!.storeId, db); audit(req.auth!.tenant, req.auth!.actor, 'ops:fresh-database-recovery-rehearsal', { after: { storeId: req.auth!.storeId, ...result } }); return result; }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'fresh-database recovery rehearsal failed' }); }
  });
  app.post('/api/ops/restore', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const db = validateRestorePayload(req.body, req.auth!.tenant, req.auth!.storeId);
      const result = store.replaceScoped(req.auth!.tenant, req.auth!.storeId, db);
      audit(req.auth!.tenant, req.auth!.actor, 'ops:restore', { after: { storeId: req.auth!.storeId, rows: result.rows } });
      return { ok: true, rows: result.rows, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'backup restore failed' }); }
  });
  app.post('/api/ops/restore/encrypted/verify', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const envelope = (req.body as any)?.backup;
      if (!envelope || envelope.tenant !== req.auth!.tenant || envelope.storeId !== req.auth!.storeId) throw new Error('encrypted backup belongs to another workspace');
      const db = validateRestorePayload(decryptBackup(envelope, (req.body as any)?.passphrase), req.auth!.tenant, req.auth!.storeId);
      return { ok: true, backupFormat: 'epic-laundry-encrypted-backup', rows: db.rows.length, financialEntries: Array.isArray(db.financialEntries) ? db.financialEntries.length : 0, financialDocuments: Array.isArray(db.financialDocuments) ? db.financialDocuments.length : 0, customerLedgerEntries: Array.isArray(db.customerLedgerEntries) ? db.customerLedgerEntries.length : 0, cashShiftCloses: Array.isArray(db.cashShiftCloses) ? db.cashShiftCloses.length : 0, normalizedCustomers: Array.isArray(db.normalizedCustomers) ? db.normalizedCustomers.length : 0, normalizedOrders: Array.isArray(db.normalizedOrders) ? db.normalizedOrders.length : 0, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted backup verification failed' }); }
  });
  app.post('/api/ops/restore/encrypted/rehearse', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { const envelope = (req.body as any)?.backup; if (!envelope || envelope.tenant !== req.auth!.tenant || envelope.storeId !== req.auth!.storeId) throw new Error('encrypted backup belongs to another workspace'); const db = validateRestorePayload(decryptBackup(envelope, (req.body as any)?.passphrase), req.auth!.tenant, req.auth!.storeId); const result = freshDatabaseRestoreRehearsal(req.auth!.tenant, req.auth!.storeId, db); audit(req.auth!.tenant, req.auth!.actor, 'ops:encrypted-fresh-database-recovery-rehearsal', { after: { storeId: req.auth!.storeId, ...result } }); return result; }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted fresh-database recovery rehearsal failed' }); }
  });
  app.post('/api/ops/restore/encrypted', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const envelope = (req.body as any)?.backup;
      if (!envelope || envelope.tenant !== req.auth!.tenant || envelope.storeId !== req.auth!.storeId) return rep.code(400).send({ error: 'encrypted backup belongs to another workspace' });
      const db = validateRestorePayload(decryptBackup(envelope, (req.body as any)?.passphrase), req.auth!.tenant, req.auth!.storeId);
      const result = store.replaceScoped(req.auth!.tenant, req.auth!.storeId, db);
      audit(req.auth!.tenant, req.auth!.actor, 'ops:encrypted-restore', { after: { storeId: req.auth!.storeId, rows: result.rows } });
      return result;
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted backup restore failed' }); }
  });

  // ---- Distribution: read-only customer portal (self-serve invoices + pay link) ----
  // Public by design (customer-facing); returns ONLY the requested party's own data and never mutates.
  app.get('/api/portal/:customer', async (req: any, rep: any) => {
    const cid = String(req.params.customer);
    const party = store.getRow(TENANT, cid);
    if (!party || party.entity !== 'party') return rep.code(404).send({ error: 'customer not found' });
    const paidFor = (invId: string) =>
      store.rowsOf(TENANT, 'payment_entry').filter((p) => p.status === 'Submitted' && p.data.against_sales === invId)
        .reduce((a, p) => a + ((store.financialDocumentAmountPaise(TENANT, 'payment', p.entity, p.id) ?? Math.round((Number(p.data.amount) || 0) * 100)) / 100), 0);
    const invs = store.rowsOf(TENANT, 'sales_invoice')
      .filter((r) => r.status === 'Submitted' && r.data.customer === cid)
      .map((r) => {
        const gt = (store.financialDocumentAmountPaise(TENANT, 'invoice', r.entity, r.id) ?? Math.round((Number(r.data.grand_total) || 0) * 100)) / 100;
        const paid = Math.round(paidFor(r.id) * 100) / 100;
        return { name: r.data.name, date: r.data.posting_date, grand_total: gt, paid, balance: Math.max(0, Math.round((gt - paid) * 100) / 100) };
      })
      .filter((x) => x.balance > 0);
    return {
      customer: { name: party.data.name, gstin: party.data.gstin },
      invoices: invs,
      total_outstanding: Math.round(invs.reduce((a, x) => a + x.balance, 0) * 100) / 100,
    };
  });

  // ---- Epic AI & Analytics ----
  app.get('/api/ai/insights', { preHandler: guard }, async (req: any) => getInsights(requestTenant(req)));
  app.post('/api/ai/ask', { preHandler: guard }, async (req: any, rep: any) => {
    const q = (req.body as any)?.question;
    if (!q) return rep.code(400).send({ error: 'question required' });
    try { return await ask(requestTenant(req), q); } catch (e: any) { return rep.code(500).send({ error: e.message }); }
  });

  console.log('[api] routes registered');
}
