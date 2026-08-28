import type { FastifyInstance } from 'fastify';
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
  assignLaundryOrder, bookLaundryOrder, cancelLaundryExpense, cancelLaundryOrder, createLaundryExpense, createLaundryRider, editLaundryExpense, editLaundryOrder, getLaundryOrder, importLaundryCustomers, importLaundryPrices, laundryCatalogue, laundryDashboard, listLaundryFulfillment, recordLaundryFulfillment,
  laundryDispatch, laundryReportDetail, laundryReports, laundryStatistics, listLaundryExpenses, listLaundryImportJobs, listLaundryOrders, listLaundryRiderSettlements, listLaundryRiders, quoteLaundryOrder, saveLaundryCategory, saveLaundryChargeRule, saveLaundryDiscountRule,
  saveLaundryGarment, saveLaundryPrice, saveLaundryRiderSettlement, saveLaundryService, saveLaundryTaxRule, searchLaundryCustomers, transitionLaundryOrder,
} from './modules/laundry/domain.js';
import { adjustRewards, applyWalletCommand, createLaundryCustomer, customerProfile, updateLaundryCustomer } from './modules/laundry/customers.js';
import { createServicePackage, customerPackages, listServicePackages, purchaseServicePackage, redeemServicePackage } from './modules/laundry/packages.js';
import { collectLaundryPayment, laundryPaymentSummary, reverseLaundryPayment } from './modules/laundry/payments.js';
import { laundryBusinessDate } from './modules/laundry/dates.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const USER = process.env.EPIC_USER || 'admin@epic.local';
declare module 'fastify' { interface FastifyRequest { auth?: AuthContext } }

function sessionCookie(token: string, maxAgeSeconds: number) {
  return `epic_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
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
      return;
    }
    const auth = contextForToken(readSessionToken(req.headers));
    if (!auth) return rep.code(401).send({ error: 'authentication required' });
    req.auth = auth;
  };
  const allow = (permission: string) => async (req: any, rep: any) => {
    if (!req.auth || !can(req.auth, permission)) return rep.code(403).send({ error: 'permission denied' });
  };
  const idempotent = <T>(req: any, scope: string, work: () => T) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key || key.length > 160) throw new Error('a valid idempotency key is required');
    const auth = req.auth as AuthContext;
    return store.transaction(() => {
      const previous = store.idempotencyResult<T>(auth.tenant, scope, key);
      if (previous !== undefined) return previous;
      const result = work();
      store.recordIdempotencyResult(auth.tenant, scope, key, result);
      return result;
    });
  };
  const inStore = <T>(req: any, work: () => T) => store.withStoreScope(req.auth!.tenant, req.auth!.storeId, work);

  app.get('/api/auth/bootstrap-status', async () => ({ needsBootstrap: store.authIdentityCount() === 0 }));
  app.post('/api/auth/bootstrap', async (req: any, rep: any) => {
    try {
      const identity = bootstrapOwner(req.body as any);
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
      return { user: { username: req.auth!.actor, roles: switched.roles, tenant: req.auth!.tenant, storeId: switched.store.id }, store: switched.store };
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
        const identity = createOperationalUser(req.auth!, { username: body?.username, password: body?.password, roles: body?.roles, storeId: body?.storeId || req.auth!.storeId, firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone, description: body?.description });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-created', { entity: 'auth_identity', row_id: identity.id, after: { username: identity.username, roles: identity.roles, enabled: identity.enabled, firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone, description: identity.description } });
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
        const identity = updateOperationalUser(req.auth!, req.params.id, { firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone, description: body?.description, roles: body?.roles, enabled: body?.enabled });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-updated', { entity: 'auth_identity', row_id: identity.id, before: before ? { username: before.username, roles: before.roles, enabled: before.enabled, firstName: before.firstName, lastName: before.lastName, email: before.email, phone: before.phone, description: before.description } : undefined, after: { username: identity.username, roles: identity.roles, enabled: identity.enabled, firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone, description: identity.description } });
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
  app.get('/api/auth/session', async (req: any) => {
    const auth = contextForToken(readSessionToken(req.headers));
    return auth ? { user: { username: auth.actor, roles: auth.roles, tenant: auth.tenant, storeId: auth.storeId } } : { user: null };
  });

  // ---- Laundry desk: dedicated domain API, kept separate from generic ERP screens ----
  app.get('/api/laundry/catalogue', { preHandler: [guard, allow('catalogue.read')] }, async (req: any) => inStore(req, () => laundryCatalogue(req.auth!.tenant)));
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
  app.get('/api/laundry/customers', { preHandler: [guard, allow('customers.read')] }, async (req: any) =>
    inStore(req, () => searchLaundryCustomers(req.auth!.tenant, String((req.query as any)?.search || ''))),
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
  app.post('/api/laundry/customers/:id/wallet', { preHandler: [guard, allow('wallet.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.customer-wallet:${req.params.id}`, () => applyWalletCommand(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/rewards', { preHandler: [guard, allow('rewards.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.customer-rewards:${req.params.id}`, () => adjustRewards(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/packages', { preHandler: [guard, allow('packages.read')] }, async (req: any) => inStore(req, () => listServicePackages(req.auth!.tenant, String((req.query as any)?.includeInactive || '') === 'true')));
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
  app.get('/api/laundry/orders', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryOrders(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/orders/:id', { preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
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
  app.post('/api/laundry/orders/:id/transition', { preHandler: [guard, allow('orders.transition')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      return inStore(req, () => transitionLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, body?.state, body?.note));
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders/:id/cancel', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => cancelLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || ''))); }
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
  app.get('/api/laundry/reports/:kind', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => laundryReportDetail(req.auth!.tenant, req.params.kind, req.query?.from, req.query?.to, req.query?.search)); }
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
    audit(TENANT, 'wa-bot', 'wa:inbound', { entity: 'party', row_id: party.id, after: { from, text } });
    console.log(`[wa] inbound from ${from}: ${text}`);
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
    const row = store.getRow(TENANT, req.params.id);
    if (!row || !['sales_invoice', 'pos_invoice'].includes(row.entity)) return rep.code(404).send({ error: 'not found' });
    const gst = row.data.__gst;
    if (!gst) return rep.code(400).send({ error: 'invoice not submitted' });
    const p = store.getRow(TENANT, row.data.customer);
    return buildEinvoicePayload({ name: row.data.name, posting_date: row.data.posting_date, data: row.data }, company(), {
      name: p?.data?.name || (row.entity === 'pos_invoice' ? 'Walk-in Customer' : ''), gstin: p?.data?.gstin, addr: p?.data?.addr,
      state: p?.data?.state, pos: row.data.place_of_supply,
    }, gst);
  });
  app.get('/api/gst/print/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(TENANT, req.params.id);
    const gst = row?.data?.__gst;
    if (!gst) return rep.code(400).send({ error: 'no GST computed' });
    const p = store.getRow(TENANT, row.data.customer);
    rep.header('Content-Type', 'text/html');
    return renderTaxInvoice(
      { name: row.data.name, posting_date: row.data.posting_date, data: row.data },
      { name: p?.data?.name || (row.entity === 'pos_invoice' ? 'Walk-in Customer' : ''), gstin: p?.data?.gstin, addr: p?.data?.addr }, company(), gst,
      row.data.__einvoice,
    );
  });
  app.get('/api/gst/gstr1', { preHandler: guard }, async () => {
    const invs = store.rowsOf(TENANT, 'sales_invoice')
      .filter((r) => r.status === 'Submitted')
      .map((r) => ({ data: r.data, gst: r.data.__gst }));
    const cns = store.rowsOf(TENANT, 'credit_note')
      .filter((r) => r.status === 'Submitted')
      .map((r) => ({ data: r.data, gst: r.data.__gst }));
    return {
      ...buildGstr1(invs, (data) => !!store.getRow(TENANT, data.customer)?.data?.gstin),
      ...buildCdnr(cns, (data) => store.getRow(TENANT, data.reference_invoice)?.data?.name || ''),
    };
  });
  app.get('/api/gst/cockpit', { preHandler: guard }, async () => {
    const invs = store.rowsOf(TENANT, 'sales_invoice').filter((r) => r.status === 'Submitted');
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
    try { return await generateIrnForInvoice(TENANT, req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/gst/irn/:id/cancel', { preHandler: guard }, async (req: any, rep: any) => {
    const reason = (req.body as any)?.reason || 'Data entry mistake';
    try { return await cancelIrnForInvoice(TENANT, req.params.id, reason); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/gst/irn/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(TENANT, req.params.id);
    return { einvoice: row?.data?.__einvoice || null, status: row?.data?.einvoice_status || 'NOT_GENERATED' };
  });

  // ---- E-way bill via GSP ----
  app.post('/api/gst/eway/:id', { preHandler: guard }, async (req: any, rep: any) => {
    try { return await generateEwbForInvoice(TENANT, req.params.id, (req.body as any)?.transporter); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/gst/eway/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(TENANT, req.params.id);
    return { eway: row?.data?.__eway || null };
  });

  // ---- IMS (inward supply 2A/2B matching) ----
  app.get('/api/gst/ims', { preHandler: guard }, async (req: any) => {
    const period = (req.query as any)?.period as string | undefined;
    return getImsSupplies(TENANT, period);
  });
  app.post('/api/gst/ims/action', { preHandler: guard }, async (req: any, rep: any) => {
    const { irn, action, reason } = req.body as any;
    if (!irn || !['ACC', 'REJ', 'PEN'].includes(action)) return rep.code(400).send({ error: 'irn + valid action required' });
    return recordImsAction(TENANT, irn, action, reason, USER);
  });

  // ---- CRM: convert a lead into party + opportunity (optionally a quotation) ----
  app.post('/api/lead/:id/convert', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any) || {};
      const out = convertLead(TENANT, USER, req.params.id, { gstin: b.gstin, createQuotation: !!b.createQuotation });
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
    try { return scoreLead(TENANT, req.params.id); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });
  app.post('/api/crm/score-all', { preHandler: guard }, async () => scoreAllLeads(TENANT));

  // ---- CRM: activities (timeline) ----
  app.post('/api/crm/activity', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any)?.data || req.body;
      const row = logActivity(TENANT, USER, b);
      return rep.code(201).send(row);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/crm/timeline/:id', { preHandler: guard }, async (req: any) =>
    activitiesFor(TENANT, (req.query as any)?.ref_entity, req.params.id).map((a) => ({ id: a.id, ...a.data, created_at: a.created_at })));

  // ---- CRM: duplicate detection + merge ----
  app.get('/api/crm/duplicates', { preHandler: guard }, async () => findDuplicateLeads(TENANT));
  app.post('/api/crm/merge', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any) || {};
      if (!b.primary || !Array.isArray(b.duplicates)) return rep.code(400).send({ error: 'primary + duplicates[] required' });
      return mergeLeads(TENANT, USER, b.primary, b.duplicates);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- CRM: opportunity win/lose + assignment ----
  app.post('/api/crm/opportunity/:id/win', { preHandler: guard }, async (req: any, rep: any) => {
    try { return winOpportunity(TENANT, USER, req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/crm/opportunity/:id/lose', { preHandler: guard }, async (req: any, rep: any) => {
    try { return loseOpportunity(TENANT, USER, req.params.id, (req.body as any)?.lost_reason || ''); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/crm/lead/:id/assign', { preHandler: guard }, async (req: any) => ({ owner: assignOwner(TENANT, req.params.id) }));

  // ---- CRM: pipeline board, forecast, analytics (for the dashboard) ----
  app.get('/api/crm/pipeline', { preHandler: guard }, async (req: any) => getPipeline(TENANT, req.query as any));
  app.get('/api/crm/forecast', { preHandler: guard }, async (req: any) => getForecast(TENANT, req.query as any));
  app.get('/api/crm/analytics/source', { preHandler: guard }, async () => getSourceAnalytics(TENANT));
  app.get('/api/crm/analytics/lost-reasons', { preHandler: guard }, async () => getLostReasonPareto(TENANT));
  app.get('/api/crm/analytics/owners', { preHandler: guard }, async () => getOwnerPerformance(TENANT));

  // ---- Dashboard analytics: KPIs + time-series for the home command center ----
  app.get('/api/dashboard/summary', { preHandler: guard }, async (req: any) =>
    dashboardSummary(TENANT, (req.query as any)?.asOf));

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
    const items = store.rowsOf(TENANT, 'item');
    const whs = store.rowsOf(TENANT, 'warehouse');
    const balances: Record<string, Record<string, number>> = {};
    for (const s of store.stockOf(TENANT)) {
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
    return { method, ...stockValuation(TENANT, method) };
  });
  app.get('/api/inventory/serials', { preHandler: guard }, async () => serialStock(TENANT));
  app.get('/api/inventory/batches', { preHandler: guard }, async () => batchStock(TENANT));
  app.get('/api/inventory/balances', { preHandler: guard }, async () => getStockBalance(TENANT));

  // ---- Manufacturing depth (Phase-17): BOM cost, explosion, MRP planning ----
  app.get('/api/manufacturing/bom-cost', { preHandler: guard }, async (req: any) => {
    const item = (req.query as any).item; if (!item) return { error: 'item required' };
    return bomCost(TENANT, item, Number((req.query as any).qty || 1));
  });
  app.get('/api/manufacturing/explode', { preHandler: guard }, async (req: any) => {
    const item = (req.query as any).item; if (!item) return { error: 'item required' };
    return explodeBom(TENANT, item, Number((req.query as any).qty || 1));
  });
  app.get('/api/manufacturing/mrp', { preHandler: guard }, async () => planMaterials(TENANT));
  app.post('/api/manufacturing/mrp/work-orders', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {};
    if (!b.items?.length) return rep.code(400).send({ error: 'items required' });
    const created = createPlannedWorkOrders(TENANT, b.module || 'manufacturing', b.items);
    return { created: created.map((r: any) => ({ id: r.id, name: r.data.name })) };
  });
  app.post('/api/manufacturing/mrp/purchase-order', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {};
    if (!b.supplier || !b.items?.length) return rep.code(400).send({ error: 'supplier and items required' });
    const po = createPlannedPurchaseOrder(TENANT, b.module || 'buying', b.supplier, b.items, {
      isSubcontracted: b.isSubcontracted, suppliedItems: b.suppliedItems,
    });
    return { id: po.id, name: po.data.name };
  });

  // ---- Accounting: Trial Balance / P&L / Balance Sheet / Ledger ----
  app.get('/api/accounting/trial-balance', { preHandler: guard }, async (req: any) => getTrialBalance(TENANT, (req.query as any).cost_center));
  app.get('/api/accounting/pnl', { preHandler: guard }, async (req: any) => getPnL(TENANT, (req.query as any).cost_center));
  app.get('/api/accounting/balancesheet', { preHandler: guard }, async (req: any) => getBalanceSheet(TENANT, (req.query as any).cost_center));
  app.get('/api/accounting/ledger/:account', { preHandler: guard }, async (req: any) => {
    const name = decodeURIComponent(String(req.params.account));
    return { account: name, entries: getLedger(TENANT, name) };
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
      const stmt = createRow(TENANT, USER, 'bank_statement', {
        bank_name: b.bank_name, account_no: b.account_no, period: b.period, lines,
      });
      return rep.code(201).send(stmt);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/bank/:id/reconcile', { preHandler: guard }, async (req: any, rep: any) => {
    const stmt = store.getRow(TENANT, req.params.id);
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
      const payment = createRow(TENANT, USER, 'payment_entry', {
        payment_type: isDeposit ? 'Receive' : 'Pay',
        party: party || undefined,
        posting_date: line.date || new Date().toISOString().slice(0, 10),
        mode: 'Bank',
        bank_account: stmt.data.account_no || stmt.data.bank_name,
        amount,
        remarks: line.narration || '',
      });
      submitRow(TENANT, USER, 'payment_entry', payment.id);
      line.reconciled = true;
      store.updateRow(stmt);
      return { payment: payment.id, type: isDeposit ? 'Receive' : 'Pay', amount, index: Number(index) };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.get('/api/banking/outstanding', { preHandler: guard }, async () => {
    const paidFor = (invId: string) =>
      store.rowsOf(TENANT, 'payment_entry').filter((p) => p.status === 'Submitted').reduce(
        (acc, p) => acc + ((p.data.against_sales === invId || p.data.against_purchase === invId) ? (Number(p.data.amount) || 0) : 0),
        0,
      );
    const map = (r: any) => {
      const gt = Number(r.data.grand_total || 0);
      const paid = paidFor(r.id);
      return {
        id: r.id, name: r.data.name, type: r.entity,
        party: r.data.customer || r.data.supplier,
        grand_total: gt, paid, balance: Math.max(0, Math.round((gt - paid) * 100) / 100),
      };
    };
    const sales = store.rowsOf(TENANT, 'sales_invoice').filter((r) => r.status === 'Submitted').map(map).filter((x) => x.balance > 0);
    const purchases = store.rowsOf(TENANT, 'purchase_invoice').filter((r) => r.status === 'Submitted').map(map).filter((x) => x.balance > 0);
    return { receivables: sales, payables: purchases };
  });

  // ---- Sync: store-and-forward bulk push (offline POS / field app replays queued docs) ----
  app.post('/api/sync/push', { preHandler: guard }, async (req: any, rep: any) => {
    const docs = (req.body as any)?.docs;
    if (!Array.isArray(docs)) return rep.code(400).send({ error: 'docs[] required' });
    const results: any[] = [];
    let okN = 0;
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i] as any;
      try {
        const row = createRow(TENANT, USER, d.entity, d.data || {});
        const sub = submitRow(TENANT, USER, d.entity, row.id);
        results.push({ index: i, ok: true, id: row.id, name: sub.id });
        okN++;
      } catch (e: any) { results.push({ index: i, ok: false, error: e.message }); }
    }
    return { accepted: docs.length, applied: okN, results };
  });

  // ---- HR & Payroll ----
  app.get('/api/payroll/preview', { preHandler: guard }, async (req: any, rep: any) => {
    const emp = store.getRow(TENANT, (req.query as any).employee);
    if (!emp) return rep.code(404).send({ error: 'employee not found' });
    const ss = emp.data.salary_structure ? store.getRow(TENANT, emp.data.salary_structure)?.data : null;
    if (!ss) return rep.code(400).send({ error: 'employee has no salary structure' });
    return computePayroll(ss, Number((req.query as any).paid_days) || 30, 30);
  });
  app.post('/api/payroll/run', { preHandler: guard }, async (req: any, rep: any) => {
    const { period, paid_days, payment_mode } = req.body as any;
    if (!period) return rep.code(400).send({ error: 'period required' });
    const emps = store.rowsOf(TENANT, 'employee').filter((e) => e.data.is_active && e.data.salary_structure);
    const results: any[] = [];
    for (const e of emps) {
      try {
        const r = createRow(TENANT, USER, 'salary_slip', { employee: e.id, period, paid_days: Number(paid_days) || 30, payment_mode: payment_mode || 'Bank' });
        const s = submitRow(TENANT, USER, 'salary_slip', r.id);
        results.push({ ok: true, id: r.id, name: s.id, employee: e.data.name });
      } catch (err: any) { results.push({ ok: false, employee: e.data.name, error: err.message }); }
    }
    return { period, generated: results.length, results };
  });

  // ---- P18 HR Depth: Attendance, Leave, Expense Claims, Loans, Recruitment ----
  // Attendance
  app.post('/api/hr/attendance', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.date || !b.data?.status) return rep.code(400).send({ error: 'employee, date, status required' });
    return recordAttendance(TENANT, 'hr', b.data);
  });
  app.get('/api/hr/attendance', { preHandler: guard }, async (req: any) => {
    const { employee, from, to } = req.query as any;
    let rows = store.rowsOf(TENANT, 'attendance');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (from) rows = rows.filter(r => r.data.date >= from);
    if (to) rows = rows.filter(r => r.data.date <= to);
    return rows;
  });

  // Leave balances & applications
  app.get('/api/hr/leave-balance', { preHandler: guard }, async (req: any, rep: any) => {
    const { employee, fiscal_year } = req.query as any;
    if (!employee || !fiscal_year) return rep.code(400).send({ error: 'employee and fiscal_year required' });
    return getLeaveBalances(TENANT, employee, fiscal_year);
  });
  app.post('/api/hr/leave-apply', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.leave_type || !b.data?.from_date || !b.data?.to_date) return rep.code(400).send({ error: 'employee, leave_type, from_date, to_date required' });
    return applyLeave(TENANT, 'hr', b.data);
  });
  app.post('/api/hr/leave-approve/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const approver = (req.body as any)?.approver; if (!approver) return rep.code(400).send({ error: 'approver required' });
    return approveLeave(TENANT, req.params.id, approver);
  });

  // Expense Claims
  app.post('/api/hr/expense-claim', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.posting_date || !b.data?.items?.length) return rep.code(400).send({ error: 'employee, posting_date, items[] required' });
    return createExpenseClaim(TENANT, 'hr', b.data);
  });
  app.get('/api/hr/expense-claims', { preHandler: guard }, async (req: any) => {
    const { employee, status } = req.query as any;
    let rows = store.rowsOf(TENANT, 'expense_claim');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });

  // Employee Loans
  app.post('/api/hr/loan', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.loan_type || !b.data?.principal_amount || !b.data?.start_date) return rep.code(400).send({ error: 'employee, loan_type, principal_amount, start_date required' });
    return createEmployeeLoan(TENANT, 'hr', b.data);
  });
  app.get('/api/hr/loan/:id/schedule', { preHandler: guard }, async (req: any) => getLoanSchedule(TENANT, req.params.id));
  app.get('/api/hr/loans', { preHandler: guard }, async (req: any) => {
    const { employee, status } = req.query as any;
    let rows = store.rowsOf(TENANT, 'employee_loan');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });

  // Recruitment
  app.post('/api/hr/job-opening', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.title) return rep.code(400).send({ error: 'title required' });
    return createJobOpening(TENANT, 'hr', b.data);
  });
  app.get('/api/hr/job-openings', { preHandler: guard }, async (req: any) => {
    const { status } = req.query as any;
    let rows = store.rowsOf(TENANT, 'job_opening');
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });
  app.post('/api/hr/job-apply', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.job_opening || !b.data?.applicant_name) return rep.code(400).send({ error: 'job_opening, applicant_name required' });
    return applyToJob(TENANT, 'hr', b.data);
  });
  app.post('/api/hr/interview', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.job_applicant || !b.data?.round || !b.data?.interviewer || !b.data?.scheduled_on) return rep.code(400).send({ error: 'job_applicant, round, interviewer, scheduled_on required' });
    return scheduleInterview(TENANT, 'hr', b.data);
  });
  app.get('/api/hr/recruitment-pipeline', { preHandler: guard }, async () => getRecruitmentPipeline(TENANT));

  // ---- Migration: Tally / Zoho / generic CSV import ----
  app.get('/api/migration/presets', { preHandler: guard }, async () => PRESETS);
  app.post('/api/migration/import', { preHandler: guard }, async (req: any, rep: any) => {
    const { entity, rows, fieldMap, open_bal_account } = req.body as any;
    if (!entity || !Array.isArray(rows)) return rep.code(400).send({ error: 'entity + rows[] required' });
    if (!getDef(entity)) return rep.code(400).send({ error: 'unknown entity: ' + entity });
    try {
      const results = runImport(TENANT, USER, entity, rows, fieldMap, open_bal_account);
      const ok = results.filter((r) => r.ok).length;
      return { accepted: rows.length, imported: ok, results };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Projects & Services: bill unbilled timesheets into a draft sales invoice ----
  app.post('/api/projects/bill', { preHandler: guard }, async (req: any, rep: any) => {
    const { project } = req.body as any;
    if (!project) return rep.code(400).send({ error: 'project required' });
    try { return billProject(TENANT, USER, project); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Fixed Assets: run depreciation for a period (YYYY-MM) ----
  app.post('/api/assets/depreciate', { preHandler: guard }, async (req: any, rep: any) => {
    const { period } = req.body as any;
    if (!period) return rep.code(400).send({ error: 'period required (YYYY-MM)' });
    try { return runDepreciation(TENANT, USER, period); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Compliance: statutory summary + audit-trail verification ----
  app.get('/api/compliance/summary', { preHandler: guard }, async () => getComplianceSummary(TENANT));
  app.get('/api/compliance/audit', { preHandler: guard }, async () => verifyAuditTrail(TENANT));

  // ---- Multi-currency: FX rate lookup + convert to base (INR) ----
  app.get('/api/fx/rate', { preHandler: guard }, async (req: any) => {
    const code = (req.query as any).code || 'INR';
    return { code, rate: getRate(TENANT, code) };
  });
  app.get('/api/fx/convert', { preHandler: guard }, async (req: any) => {
    const code = (req.query as any).code || 'INR';
    const amount = Number((req.query as any).amount) || 0;
    const rate = getRate(TENANT, code);
    return { code, amount, rate, base: convert(amount, rate) };
  });

  // ---- Platform & Ecosystem: RBAC, payments, RPA, marketplace ----
  app.get('/api/auth/whoami', { preHandler: guard }, async (req: any) => ({
    role: req.headers['x-role'] || 'admin', tenant: TENANT,
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
    try { return runBot(TENANT, USER, bot, input || {}); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/bank/statement', { preHandler: guard }, async (req: any) => fetchBankStatement({ provider: (req.query as any).provider }));
  app.get('/api/marketplace/apps', { preHandler: guard }, async () => store.rowsOf(TENANT, 'app_def').map((a) => a.data));

  // ---- Phase-14 Ops pack: pricing, recurring invoices, reorder, alerts, backup ----
  app.post('/api/ops/quote', { preHandler: guard }, async (req: any) => quoteRate(TENANT, req.body || {}));
  app.post('/api/ops/recurring/run', { preHandler: guard }, async (req: any) => {
    const ids = runRecurring(TENANT, (req.body as any)?.asOf);
    return { created: ids.length, invoices: ids };
  });
  app.get('/api/ops/reorder', { preHandler: guard }, async () => reorderSuggestions(TENANT));
  app.get('/api/ops/alerts', { preHandler: guard }, async (req: any) => getAlerts(TENANT, (req.query as any)?.asOf));
  app.post('/api/ops/po/from-reorder', { preHandler: guard }, async (req: any, rep: any) => {
    const id = createReorderPO(TENANT, (req.body as any)?.supplier);
    if (!id) return rep.code(400).send({ error: 'nothing below reorder level' });
    return { purchase_order: id };
  });
  app.get('/api/ops/backup', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const db = store.snapshotFor(req.auth!.tenant, req.auth!.storeId);
    rep.type('application/json').header('Content-Disposition', 'attachment; filename="epic-bos-backup.json"');
    return db;
  });
  app.post('/api/ops/restore', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const db = req.body as any;
    if (!db || !Array.isArray(db.rows) || !Array.isArray(db.gl) || !Array.isArray(db.audit) || !Array.isArray(db.outbox) || !Array.isArray(db.stock) || !Array.isArray(db.ims) || (db.seq !== undefined && (typeof db.seq !== 'object' || Array.isArray(db.seq)))) return rep.code(400).send({ error: 'invalid backup payload' });
    try {
      const result = store.replaceScoped(req.auth!.tenant, req.auth!.storeId, db);
      audit(req.auth!.tenant, req.auth!.actor, 'ops:restore', { after: { storeId: req.auth!.storeId, rows: result.rows } });
      return { ok: true, rows: result.rows, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'backup restore failed' }); }
  });

  // ---- Distribution: read-only customer portal (self-serve invoices + pay link) ----
  // Public by design (customer-facing); returns ONLY the requested party's own data and never mutates.
  app.get('/api/portal/:customer', async (req: any, rep: any) => {
    const cid = String(req.params.customer);
    const party = store.getRow(TENANT, cid);
    if (!party || party.entity !== 'party') return rep.code(404).send({ error: 'customer not found' });
    const paidFor = (invId: string) =>
      store.rowsOf(TENANT, 'payment_entry').filter((p) => p.status === 'Submitted' && p.data.against_sales === invId)
        .reduce((a, p) => a + (Number(p.data.amount) || 0), 0);
    const invs = store.rowsOf(TENANT, 'sales_invoice')
      .filter((r) => r.status === 'Submitted' && r.data.customer === cid)
      .map((r) => {
        const gt = Number(r.data.grand_total || 0);
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
  app.get('/api/ai/insights', { preHandler: guard }, async () => getInsights(TENANT));
  app.post('/api/ai/ask', { preHandler: guard }, async (req: any, rep: any) => {
    const q = (req.body as any)?.question;
    if (!q) return rep.code(400).send({ error: 'question required' });
    try { return await ask(TENANT, q); } catch (e: any) { return rep.code(500).send({ error: e.message }); }
  });

  console.log('[api] routes registered');
}
