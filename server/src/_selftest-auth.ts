import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-auth-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');

let closeStore: (() => void) | undefined;
try {
  const Fastify = (await import('fastify')).default;
  const { store } = await import('./kernel/store.js');
  const { bootstrapOwner, changePassword, createOperationalUser, signIn, signOut, contextForToken } = await import('./modules/auth/auth.js');
  const { seedLaundryDefaults, laundryCatalogue } = await import('./modules/laundry/domain.js');
  const { registerApi } = await import('./api.js');
  closeStore = () => store.close();

  const owner = bootstrapOwner({ username: 'owner-test', password: 'StrongPassword!26', tenant: 'AUTH', storeId: 'STORE-A' });
  assert.equal(owner.passwordHash.includes('StrongPassword!26'), false, 'password is never stored in plaintext');
  assert.throws(() => bootstrapOwner({ username: 'second-owner', password: 'StrongPassword!26' }), /already exists/, 'bootstrap is one-time');
  const signedIn = signIn('owner-test', 'StrongPassword!26');
  assert.equal(contextForToken(signedIn.token)?.actor, 'owner-test', 'signed-in context derives actor from session');
  signOut(signedIn.token);
  assert.equal(contextForToken(signedIn.token), undefined, 'revoked session cannot authenticate');
  const passwordSession = signIn('owner-test', 'StrongPassword!26');
  changePassword(passwordSession.context, 'StrongPassword!26', 'ChangedPassword!26');
  assert.throws(() => signIn('owner-test', 'StrongPassword!26'), /invalid username or password/, 'old password is rejected after change');
  signOut(passwordSession.token);

  const app = Fastify();
  registerApi(app);
  const catalogue = store.withStoreScope('AUTH', 'STORE-A', () => {
    seedLaundryDefaults('AUTH');
    return laundryCatalogue('AUTH');
  });
  const garment = catalogue.garments.find((item: any) => item.name === 'Shirt / T-shirt')!;
  const service = catalogue.services.find((item: any) => item.name === 'Steam Iron')!;
  const activeSession = signIn('owner-test', 'ChangedPassword!26');
  const headers = { cookie: `epic_session=${activeSession.token}`, 'idempotency-key': 'booking-auth-test-001' };
  const staffCreate = await app.inject({ method: 'POST', url: '/api/settings/staff', headers, payload: { username: 'processing-user', password: 'ProcessingPassword!26', roles: ['processing_staff'], firstName: 'Priya', lastName: 'Pressing', email: 'priya@example.test', phone: '9000000001', description: 'Finishing desk' } });
  assert.equal(staffCreate.statusCode, 201, 'owner can create a scoped staff identity');
  assert.equal(staffCreate.json().firstName, 'Priya', 'staff profile fields persist and return safely');
  assert.equal(staffCreate.json().passwordHash, undefined, 'staff creation never returns a password hash');
  const staffList = await app.inject({ method: 'GET', url: '/api/settings/staff', headers });
  assert.equal(staffList.statusCode, 200, 'owner can list scoped staff identities');
  assert.equal(staffList.body.includes('passwordHash'), false, 'staff API never returns password hashes');
  const staffEdit = await app.inject({ method: 'PATCH', url: `/api/settings/staff/${staffCreate.json().id}`, headers, payload: { firstName: 'Priya', lastName: 'Finishing', email: 'priya.updated@example.test', phone: '9000000002', description: 'Finishing lead', roles: ['processing_staff', 'rider'] } });
  assert.equal(staffEdit.statusCode, 200, 'owner can update a staff profile and roles');
  assert.deepEqual(staffEdit.json().roles, ['processing_staff', 'rider'], 'updated operational roles round-trip');
  const initialStaffSession = signIn('processing-user', 'ProcessingPassword!26');
  const passwordReset = await app.inject({ method: 'POST', url: `/api/settings/staff/${staffCreate.json().id}/reset-password`, headers, payload: { password: 'ReplacementPassword!26' } });
  assert.equal(passwordReset.statusCode, 200, 'owner can reset a staff password without reading it back');
  assert.equal(contextForToken(initialStaffSession.token), undefined, 'password reset invalidates prior staff sessions');
  assert.throws(() => signIn('processing-user', 'ProcessingPassword!26'), /invalid username or password/, 'previous staff password is invalidated');
  assert.equal(signIn('processing-user', 'ReplacementPassword!26').context.roles.includes('rider'), true, 'new password receives current role set');
  const staffDisable = await app.inject({ method: 'POST', url: `/api/settings/staff/${staffCreate.json().id}/enabled`, headers, payload: { enabled: false } });
  assert.equal(staffDisable.statusCode, 200, 'owner can disable a staff identity');
  assert.throws(() => signIn('processing-user', 'ProcessingPassword!26'), /invalid username or password/, 'disabled staff cannot sign in');
  const lastOwnerDisable = await app.inject({ method: 'POST', url: `/api/settings/staff/${owner.id}/enabled`, headers, payload: { enabled: false } });
  assert.equal(lastOwnerDisable.statusCode, 400, 'the final enabled owner cannot be disabled');
  const settingsSave = await app.inject({ method: 'POST', url: '/api/settings/store', headers, payload: { businessName: 'Auth Test Laundry', upiId: 'auth-test@upi', qrOnPrint: true, logoDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' } });
  assert.equal(settingsSave.statusCode, 200, 'owner can persist scoped store settings');
  const settingsRead = await app.inject({ method: 'GET', url: '/api/settings/store', headers });
  assert.equal(settingsRead.json().upiId, 'auth-test@upi', 'stored settings round-trip through the scoped API');
  assert.equal(settingsRead.json().logoDataUrl, 'data:image/svg+xml;base64,PHN2Zy8+', 'a local store logo round-trips without an external upload');
  assert.equal(store.withStoreScope('AUTH', 'STORE-A', () => store.auditOf('AUTH').some((entry) => entry.action === 'settings:store-updated')), true, 'store settings changes create an audit record in their own branch');
  const storeCreate = await app.inject({ method: 'POST', url: '/api/settings/stores', headers, payload: { name: 'North Branch', code: 'north' } });
  assert.equal(storeCreate.statusCode, 201, 'owner can create a branch with an explicit code');
  const stores = await app.inject({ method: 'GET', url: '/api/settings/stores', headers });
  assert.equal(stores.json().some((entry: any) => entry.id === storeCreate.json().id && entry.roles.includes('owner')), true, 'owner receives a role-bearing membership for a new branch');
  const storeSwitch = await app.inject({ method: 'POST', url: '/api/auth/switch-store', headers, payload: { storeId: storeCreate.json().id } });
  assert.equal(storeSwitch.statusCode, 200, 'owner can switch their active branch');
  assert.equal(contextForToken(activeSession.token)?.storeId, storeCreate.json().id, 'active session persists branch selection');
  const newBranchSettings = await app.inject({ method: 'GET', url: '/api/settings/store', headers });
  assert.equal(newBranchSettings.json().businessName, 'Epic Laundry', 'new branch settings do not inherit another branch profile');
  const restoreStore = await app.inject({ method: 'POST', url: '/api/auth/switch-store', headers, payload: { storeId: 'STORE-A' } });
  assert.equal(restoreStore.statusCode, 200, 'owner can switch back to their original branch');
  const restoredSettings = await app.inject({ method: 'GET', url: '/api/settings/store', headers });
  assert.equal(restoredSettings.json().businessName, 'Auth Test Laundry', 'switching restores the original store-scoped profile');
  const body = {
    customer: { name: 'Idempotent Customer', phone: '9000000201' },
    items: [{ garment: garment.id, service: service.id, qty: 1 }],
    expectedDeliveryDate: '2026-09-05', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash',
  };
  const first = await app.inject({ method: 'POST', url: '/api/laundry/orders', headers, payload: body });
  const duplicate = await app.inject({ method: 'POST', url: '/api/laundry/orders', headers, payload: body });
  assert.equal(first.statusCode, 201, `authenticated booking succeeds: ${first.body}`);
  assert.equal(duplicate.statusCode, 201, 'duplicate command returns its original response');
  assert.equal(first.json().order.id, duplicate.json().order.id, 'idempotency returns the original order');
  assert.equal(store.withStoreScope('AUTH', 'STORE-A', () => store.rowsOf('AUTH', 'laundry_order').length), 1, 'idempotency prevents a duplicate order');
  const inbox = await app.inject({ method: 'GET', url: '/api/notifications', headers });
  assert.equal(inbox.statusCode, 200, 'authenticated operator can read the scoped notification centre');
  assert.equal(inbox.json().some((entry: any) => String(entry.title).includes(first.json().order.orderNumber)), true, 'booking creates an internal operational notification');
  createOperationalUser(activeSession.context, { username: 'store-b-counter', password: 'StoreBPassword!26', roles: ['counter_staff'], storeId: 'STORE-B' });
  const secondStore = signIn('store-b-counter', 'StoreBPassword!26');
  const secondStoreOrders = await app.inject({ method: 'GET', url: '/api/laundry/orders', headers: { cookie: `epic_session=${secondStore.token}` } });
  assert.equal(secondStoreOrders.statusCode, 200, 'authorised Store B counter can access its own queue');
  assert.equal(secondStoreOrders.json().length, 0, 'Store B cannot read Store A orders');
  const crossStoreDetail = await app.inject({ method: 'GET', url: `/api/laundry/orders/${first.json().order.id}`, headers: { cookie: `epic_session=${secondStore.token}` } });
  assert.equal(crossStoreDetail.statusCode, 404, 'Store B cannot retrieve Store A order by identifier');
  const deniedSettings = await app.inject({ method: 'POST', url: '/api/settings/store', headers: { cookie: `epic_session=${secondStore.token}` }, payload: { businessName: 'Unauthorised change' } });
  assert.equal(deniedSettings.statusCode, 403, 'counter staff cannot edit owner-only store settings');
  const staffPrintSettings = await app.inject({ method: 'GET', url: '/api/laundry/print-settings', headers: { cookie: `epic_session=${secondStore.token}` } });
  assert.equal(staffPrintSettings.statusCode, 200, 'counter staff can read branch-scoped print settings');
  assert.equal(staffPrintSettings.json().businessName, 'Epic Laundry', 'counter print settings do not leak another branch profile');
  const deniedCatalogueChange = await app.inject({ method: 'POST', url: '/api/laundry/catalogue/categories', headers: { cookie: `epic_session=${secondStore.token}` }, payload: { name: 'Unauthorised category', color: '#664CF0' } });
  assert.equal(deniedCatalogueChange.statusCode, 403, 'counter staff cannot mutate protected catalogue configuration');
  const catalogueB = store.withStoreScope('AUTH', 'STORE-B', () => { seedLaundryDefaults('AUTH'); return laundryCatalogue('AUTH'); });
  const bGarment = catalogueB.garments.find((item: any) => item.name === 'Shirt / T-shirt')!;
  const bService = catalogueB.services.find((item: any) => item.name === 'Steam Iron')!;
  const bOrder = await app.inject({ method: 'POST', url: '/api/laundry/orders', headers: { cookie: `epic_session=${secondStore.token}`, 'idempotency-key': 'booking-store-b-001' }, payload: { customer: { name: 'Store B Customer', phone: '9000000301' }, items: [{ garment: bGarment.id, service: bService.id, qty: 1 }], expectedDeliveryDate: '2026-09-05', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash' } });
  assert.equal(bOrder.statusCode, 201, 'Store B can independently create its own order');
  createOperationalUser(activeSession.context, { username: 'store-a-rider', password: 'StoreARiderPassword!26', roles: ['rider'] });
  const riderA = signIn('store-a-rider', 'StoreARiderPassword!26');
  const crossStoreRiderMutation = await app.inject({ method: 'POST', url: `/api/laundry/orders/${bOrder.json().order.id}/transition`, headers: { cookie: `epic_session=${riderA.token}` }, payload: { state: 'Delivered' } });
  assert.equal(crossStoreRiderMutation.statusCode, 403, 'Store A rider cannot mutate a Store B delivery');
  const scopedBackup = await app.inject({ method: 'GET', url: '/api/ops/backup', headers });
  assert.equal(scopedBackup.statusCode, 200, 'owner can download a branch-scoped backup');
  const backupPayload = scopedBackup.json();
  assert.equal(backupPayload.rows.some((row: any) => row.id === bOrder.json().order.id), false, 'branch backup excludes another store data');
  const throwaway = await app.inject({ method: 'POST', url: '/api/laundry/orders', headers: { ...headers, 'idempotency-key': 'backup-throwaway-001' }, payload: body });
  assert.equal(throwaway.statusCode, 201, 'backup restore fixture row is created');
  const restored = await app.inject({ method: 'POST', url: '/api/ops/restore', headers, payload: backupPayload });
  assert.equal(restored.statusCode, 200, 'owner can restore a valid branch backup');
  const afterRestore = await app.inject({ method: 'GET', url: `/api/laundry/orders/${throwaway.json().order.id}`, headers });
  assert.equal(afterRestore.statusCode, 404, 'branch restore removes rows created after the snapshot');
  const bOrderAfterRestore = await app.inject({ method: 'GET', url: `/api/laundry/orders/${bOrder.json().order.id}`, headers: { cookie: `epic_session=${secondStore.token}` } });
  assert.equal(bOrderAfterRestore.statusCode, 200, 'branch restore preserves another store data');
  const badRestore = await app.inject({ method: 'POST', url: '/api/ops/restore', headers, payload: { rows: [] } });
  assert.equal(badRestore.statusCode, 400, 'malformed restore payload is rejected');
  const foreignPayload = JSON.parse(JSON.stringify(backupPayload));
  if (foreignPayload.rows[0]) foreignPayload.rows[0].tenant = 'FOREIGN';
  const foreignRestore = await app.inject({ method: 'POST', url: '/api/ops/restore', headers, payload: foreignPayload });
  assert.equal(foreignRestore.statusCode, 400, 'cross-tenant restore payload is rejected');
  const unauthenticated = await app.inject({ method: 'GET', url: '/api/laundry/orders' });
  assert.equal(unauthenticated.statusCode, 401, 'laundry data requires an authenticated session');
  await app.close();
  console.log('PASS  authentication, session revocation and booking idempotency self-test complete');
} finally {
  closeStore?.();
  try { rmSync(tempDir, { recursive: true, force: true }); }
  catch (error) { console.error('auth test cleanup failed:', (error as Error).message); }
}
