import { createHmac, timingSafeEqual } from 'node:crypto';
import { store } from '../../kernel/store.js';

type PortalClaims = { v: 1; aud: 'epic-customer-portal'; tenant: string; storeId: string; customerId: string; exp: number };
const audience = 'epic-customer-portal' as const;
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);

function secret() {
  const value = String(process.env.EPIC_PORTAL_SECRET || '').trim();
  if (value.length < 32) throw new Error('PORTAL_NOT_CONFIGURED');
  return value;
}
function encode(value: object) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function sign(body: string) { return createHmac('sha256', secret()).update(body).digest('base64url'); }
function validSignature(body: string, received: string) {
  const expected = Buffer.from(sign(body)); const actual = Buffer.from(received);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function customerExists(tenant: string, customerId: string) {
  const row = store.getRow(tenant, customerId);
  if (!row || row.entity !== 'party' || row.data.is_customer !== true) throw new Error('customer not found');
}

export function issueCustomerPortalToken(tenant: string, customerId: string, ttlSeconds = 900) {
  const normalizedCustomerId = clean(customerId, 160);
  if (!normalizedCustomerId) throw new Error('customer ID is required');
  customerExists(tenant, normalizedCustomerId);
  const ttl = Number.isSafeInteger(ttlSeconds) ? Math.max(300, Math.min(86_400, ttlSeconds)) : 900;
  const claims: PortalClaims = { v: 1, aud: audience, tenant, storeId: store.currentStore(tenant), customerId: normalizedCustomerId, exp: Math.floor(Date.now() / 1000) + ttl };
  const body = encode(claims);
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(claims.exp * 1000).toISOString(), customerId: claims.customerId, scope: 'local-vendor-store' as const };
}

export function verifyCustomerPortalToken(token: unknown, customerId: string) {
  const raw = clean(token, 4_000); const [body, signature, extra] = raw.split('.');
  if (!body || !signature || extra) throw new Error('PORTAL_TOKEN_INVALID');
  if (!validSignature(body, signature)) throw new Error('PORTAL_TOKEN_INVALID');
  let claims: PortalClaims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PortalClaims; } catch { throw new Error('PORTAL_TOKEN_INVALID'); }
  if (claims.v !== 1 || claims.aud !== audience || !clean(claims.tenant, 160) || !clean(claims.storeId, 160) || !clean(claims.customerId, 160) || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000) || claims.customerId !== clean(customerId, 160)) throw new Error('PORTAL_TOKEN_INVALID');
  return claims;
}
