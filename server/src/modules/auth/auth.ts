import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { store, type AuthIdentity } from '../../kernel/store.js';

export type OperationalRole = 'owner' | 'counter_staff' | 'processing_staff' | 'rider';

export type AuthContext = {
  identityId: string;
  actor: string;
  tenant: string;
  storeId: string;
  roles: OperationalRole[];
  sessionHash: string;
};

export type StaffProfileInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  description?: string;
};

const SESSION_TTL_MS = Number(process.env.EPIC_SESSION_TTL_MS || 1000 * 60 * 60 * 12);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function passwordMatches(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function requireNewPassword(password: string) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('password must be at least 12 characters');
}

const validRoles: OperationalRole[] = ['owner', 'counter_staff', 'processing_staff', 'rider'];
function validOperationalRoles(roles: unknown): roles is OperationalRole[] {
  return Array.isArray(roles) && roles.length > 0 && roles.every((role) => typeof role === 'string' && validRoles.includes(role as OperationalRole));
}
function profile(input: StaffProfileInput) {
  const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
  const email = clean(input.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email address is invalid');
  return { firstName: clean(input.firstName, 80), lastName: clean(input.lastName, 80), email, phone: clean(input.phone, 40), description: clean(input.description, 500) };
}
function ensureOwnerContinuity(identity: AuthIdentity, nextRoles: OperationalRole[], nextEnabled: boolean) {
  if (!identity.enabled || !identity.roles.includes('owner') || (nextEnabled && nextRoles.includes('owner'))) return;
  const remainingOwners = store.listIdentities(identity.tenant, identity.storeId)
    .filter((user) => user.enabled && user.roles.includes('owner') && user.id !== identity.id);
  if (remainingOwners.length === 0) throw new Error('at least one enabled owner is required');
}

export function bootstrapOwner(input: { username: string; password: string; tenant?: string; storeId?: string } & StaffProfileInput) {
  const username = input.username?.trim();
  if (!username || username.length < 3) throw new Error('username must be at least 3 characters');
  requireNewPassword(input.password);
  return store.transaction(() => {
    if (store.authIdentityCount() > 0) throw new Error('an owner already exists; use sign in');
    const identity: AuthIdentity = {
      id: randomUUID(), tenant: input.tenant?.trim() || 'T1', storeId: input.storeId?.trim() || 'STORE-DEFAULT', username,
      passwordHash: passwordHash(input.password), roles: ['owner'], enabled: true, ...profile(input), createdAt: new Date().toISOString(),
    };
    store.createIdentity(identity);
    return identity;
  });
}

export function signIn(username: string, password: string) {
  const identity = store.findIdentityByUsername(username?.trim() || '');
  if (!identity || !identity.enabled || !passwordMatches(password, identity.passwordHash)) throw new Error('invalid username or password');
  const token = randomBytes(32).toString('base64url');
  const sessionHash = hashToken(token);
  store.createSession({ tokenHash: sessionHash, identityId: identity.id, tenant: identity.tenant, storeId: identity.storeId, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(), createdAt: new Date().toISOString() });
  return { token, context: toContext(identity, sessionHash), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
}

export function contextForToken(token: string | undefined) {
  if (!token) return undefined;
  const sessionHash = hashToken(token);
  const result = store.sessionByTokenHash(sessionHash);
  if (!result || result.session.revokedAt || !result.identity.enabled || Date.parse(result.session.expiresAt) <= Date.now()) return undefined;
  const membership = store.membershipForIdentity(result.identity.id, result.identity.tenant, result.session.storeId);
  if (!membership?.enabled) return undefined;
  return toContext({ ...result.identity, roles: membership.roles }, sessionHash, result.session.storeId);
}

export function signOut(token: string | undefined) { if (token) store.revokeSession(hashToken(token)); }

export function changePassword(context: AuthContext, currentPassword: string, newPassword: string) {
  const identity = store.findIdentityByUsername(context.actor);
  if (!identity || !identity.enabled || !passwordMatches(currentPassword, identity.passwordHash)) throw new Error('current password is incorrect');
  requireNewPassword(newPassword);
  store.transaction(() => {
    store.updateIdentityPassword(identity.id, passwordHash(newPassword));
    store.revokeOtherSessions(identity.id, context.sessionHash);
  });
}

/** Server-only staff-account primitive. The staff-management UI is added in Phase 3. */
export function createOperationalUser(actor: AuthContext, input: { username: string; password: string; roles: OperationalRole[]; storeId?: string } & StaffProfileInput) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const username = input.username?.trim();
  if (!username || username.length < 3) throw new Error('username must be at least 3 characters');
  if (store.findIdentityByUsername(username)) throw new Error('username is already in use');
  requireNewPassword(input.password);
  if (!validOperationalRoles(input.roles)) throw new Error('a valid operational role is required');
  const identity: AuthIdentity = {
    id: randomUUID(), tenant: actor.tenant, storeId: input.storeId?.trim() || actor.storeId, username,
    passwordHash: passwordHash(input.password), roles: input.roles, enabled: true, ...profile(input), createdAt: new Date().toISOString(),
  };
  store.createIdentity(identity);
  return identity;
}

export function setOperationalUserEnabled(actor: AuthContext, identityId: string, enabled: boolean) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const identity = store.identityById(identityId);
  if (!identity || identity.tenant !== actor.tenant || identity.storeId !== actor.storeId) throw new Error('staff user not found');
  ensureOwnerContinuity(identity, identity.roles as OperationalRole[], enabled);
  store.setIdentityEnabled(identity.id, enabled);
  return { ...identity, enabled };
}

export function updateOperationalUser(actor: AuthContext, identityId: string, input: StaffProfileInput & { roles?: OperationalRole[]; enabled?: boolean }) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const identity = store.identityById(identityId);
  if (!identity || identity.tenant !== actor.tenant || identity.storeId !== actor.storeId) throw new Error('staff user not found');
  const roles = input.roles === undefined ? identity.roles as OperationalRole[] : input.roles;
  if (!validOperationalRoles(roles)) throw new Error('a valid operational role is required');
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : identity.enabled;
  ensureOwnerContinuity(identity, roles, enabled);
  const next = { ...identity, ...profile(input), roles, enabled };
  store.updateIdentityProfile(identity.id, next);
  store.addStoreMembership({ identityId: identity.id, tenant: identity.tenant, storeId: identity.storeId, roles, createdAt: identity.createdAt });
  return next;
}

export function resetOperationalUserPassword(actor: AuthContext, identityId: string, password: string) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const identity = store.identityById(identityId);
  if (!identity || identity.tenant !== actor.tenant || identity.storeId !== actor.storeId) throw new Error('staff user not found');
  requireNewPassword(password);
  store.transaction(() => {
    store.updateIdentityPassword(identity.id, passwordHash(password));
    // A reset immediately expires any active sessions for that staff account.
    store.revokeOtherSessions(identity.id, '');
  });
}

export function createOperationalStore(actor: AuthContext, input: { name: string; code?: string }) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const name = String(input.name || '').trim().slice(0, 120);
  if (name.length < 2) throw new Error('store name must be at least 2 characters');
  const code = String(input.code || name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  if (code.length < 2) throw new Error('store code must contain letters or numbers');
  const record = { id: `STORE-${randomUUID().slice(0, 8).toUpperCase()}`, tenant: actor.tenant, name, code, enabled: true, createdAt: new Date().toISOString() };
  store.transaction(() => {
    store.createStore(record);
    store.addStoreMembership({ identityId: actor.identityId, tenant: actor.tenant, storeId: record.id, roles: actor.roles, createdAt: record.createdAt });
  });
  return record;
}

export function listOperationalStores(actor: AuthContext) { return store.listStoresForIdentity(actor.identityId, actor.tenant); }

export function switchOperationalStore(actor: AuthContext, storeId: string) {
  const membership = store.membershipForIdentity(actor.identityId, actor.tenant, storeId);
  if (!membership?.enabled) throw new Error('you do not have active access to that store');
  if (actor.sessionHash === 'desktop-internal') throw new Error('desktop maintenance session cannot switch stores');
  store.updateActiveSessionStore(actor.sessionHash, storeId);
  const storeRecord = store.storeById(actor.tenant, storeId)!;
  return { store: storeRecord, roles: membership.roles as OperationalRole[] };
}

function toContext(identity: AuthIdentity, sessionHash: string, storeId = identity.storeId): AuthContext {
  return { identityId: identity.id, actor: identity.username, tenant: identity.tenant, storeId, roles: identity.roles.filter((role): role is OperationalRole => validRoles.includes(role as OperationalRole)), sessionHash };
}

export function can(context: AuthContext, permission: string) {
  if (context.roles.includes('owner')) return true;
  const permissions: Record<OperationalRole, string[]> = {
    counter_staff: ['orders.read', 'orders.create', 'orders.edit', 'payments.collect', 'customers.read', 'customers.create', 'customers.edit', 'expenses.create', 'catalogue.read', 'packages.read', 'packages.sell', 'packages.redeem'],
    processing_staff: ['orders.read', 'orders.transition', 'catalogue.read', 'packages.read', 'packages.redeem'],
    rider: ['orders.read.assigned', 'orders.deliver.assigned'],
    owner: ['*'],
  };
  return context.roles.some((role) => permissions[role].includes(permission));
}

export const readSessionToken = (headers: Record<string, unknown>) => {
  const cookie = String(headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('epic_session='));
  return cookie ? decodeURIComponent(cookie.slice('epic_session='.length)) : undefined;
};
