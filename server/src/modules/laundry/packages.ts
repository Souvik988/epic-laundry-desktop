import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { appendCustomerLedger } from './customers.js';
import { laundryBusinessDate } from './dates.js';

export type PackageLineInput = { garment: string; service: string; allowance: number };
export type PackageInput = { name: string; description?: string; price: number; validityDays: number; active?: boolean; services: PackageLineInput[] };
export type PackagePurchaseInput = { customer: string; servicePackage: string; purchaseDate?: string; pricePaid?: number; paymentMode?: 'Pay Later' | 'Cash' | 'UPI' | 'Card'; reason?: string };
export type PackageRedemptionInput = { customerPackage: string; garment: string; service: string; quantity: number; order?: string; reason?: string };

const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const today = () => laundryBusinessDate();
const addDays = (value: string, days: number) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const activeRows = (tenant: string, entity: string) => store.rowsOf(tenant, entity).filter((row) => row.status !== 'Cancelled');

function required(tenant: string, entity: string, id: string, label: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== entity || row.status === 'Cancelled') throw new Error(`${label} not found`);
  return row;
}
function customer(tenant: string, id: string) {
  const row = required(tenant, 'party', id, 'customer');
  if (!row.data.is_customer) throw new Error('customer not found');
  return row;
}
function post(row: EntityRow) { row.status = 'Posted'; row.updated_at = new Date().toISOString(); store.updateRow(row); return row; }
function packageLines(tenant: string, packageId: string) { return activeRows(tenant, 'package_service').filter((row) => row.data.service_package === packageId); }
function redemptionRows(tenant: string, customerPackageId: string) { return activeRows(tenant, 'package_redemption').filter((row) => row.data.customer_package === customerPackageId); }
function effectiveStatus(row: EntityRow) { return String(row.data.status) === 'Active' && String(row.data.expires_on) < today() ? 'Expired' : String(row.data.status); }
function presentDefinition(tenant: string, row: EntityRow) {
  return { id: row.id, name: String(row.data.name), description: String(row.data.description || ''), price: Number(row.data.price || 0), validityDays: Number(row.data.validity_days || 0), active: Boolean(row.data.active), services: packageLines(tenant, row.id).map((line) => ({ id: line.id, garment: String(line.data.garment), service: String(line.data.service), allowance: Number(line.data.allowance || 0) })) };
}
function presentCustomerPackage(tenant: string, row: EntityRow) {
  const definition = required(tenant, 'service_package', String(row.data.service_package), 'service package');
  const redemptions = redemptionRows(tenant, row.id);
  const services = packageLines(tenant, definition.id).map((line) => {
    const used = round(redemptions.filter((redemption) => redemption.data.garment === line.data.garment && redemption.data.service === line.data.service).reduce((sum, redemption) => sum + Number(redemption.data.quantity || 0), 0));
    const allowance = Number(line.data.allowance || 0);
    return { garment: String(line.data.garment), service: String(line.data.service), allowance, used, remaining: round(allowance - used) };
  });
  return { id: row.id, customer: String(row.data.customer), servicePackage: { id: definition.id, name: String(definition.data.name) }, purchasedDate: String(row.data.purchased_date), expiresOn: String(row.data.expires_on), pricePaid: Number(row.data.price_paid || 0), paymentMode: String(row.data.payment_mode || 'Pay Later'), paymentStatus: String(row.data.payment_status || 'Unpaid'), status: effectiveStatus(row), services, redemptions: redemptions.map((redemption) => ({ id: redemption.id, garment: String(redemption.data.garment), service: String(redemption.data.service), quantity: Number(redemption.data.quantity || 0), redeemedDate: String(redemption.data.redeemed_date), order: String(redemption.data.order || ''), reason: String(redemption.data.reason || '') })) };
}

export function listServicePackages(tenant: string, includeInactive = false) {
  return activeRows(tenant, 'service_package').filter((row) => includeInactive || Boolean(row.data.active)).map((row) => presentDefinition(tenant, row));
}

export function createServicePackage(tenant: string, actor: string, input: PackageInput) {
  const name = String(input.name || '').trim().slice(0, 160);
  const description = String(input.description || '').trim().slice(0, 1200);
  const price = round(Number(input.price));
  const validityDays = Math.round(Number(input.validityDays));
  if (!name) throw new Error('package name is required');
  if (!Number.isFinite(price) || price < 0) throw new Error('package price must be zero or greater');
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) throw new Error('package validity must be between 1 and 3650 days');
  if (!Array.isArray(input.services) || input.services.length === 0) throw new Error('at least one package service allowance is required');
  const duplicateName = activeRows(tenant, 'service_package').some((row) => String(row.data.name).trim().toLowerCase() === name.toLowerCase());
  if (duplicateName) throw new Error('a package with this name already exists in this branch');
  const seen = new Set<string>();
  const lines = input.services.map((line) => {
    required(tenant, 'laundry_garment', line.garment, 'garment'); required(tenant, 'laundry_service', line.service, 'service');
    const allowance = round(Number(line.allowance)); const key = `${line.garment}:${line.service}`;
    if (!Number.isFinite(allowance) || allowance <= 0) throw new Error('package allowance must be greater than zero');
    if (seen.has(key)) throw new Error('a package service allowance can appear only once'); seen.add(key);
    return { garment: line.garment, service: line.service, allowance };
  });
  return store.transaction(() => {
    const definition = createRow(tenant, actor, 'service_package', { name, description, price, validity_days: validityDays, active: input.active !== false });
    lines.forEach((line) => createRow(tenant, actor, 'package_service', { service_package: definition.id, ...line }));
    audit(tenant, actor, 'package:created', { entity: 'service_package', row_id: definition.id, after: { name, price, validityDays, lineCount: lines.length } });
    return presentDefinition(tenant, definition);
  });
}

export function purchaseServicePackage(tenant: string, actor: string, input: PackagePurchaseInput) {
  customer(tenant, input.customer);
  const definition = required(tenant, 'service_package', input.servicePackage, 'service package');
  if (!definition.data.active) throw new Error('this service package is inactive');
  const purchaseDate = String(input.purchaseDate || today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || Number.isNaN(Date.parse(`${purchaseDate}T00:00:00Z`))) throw new Error('purchase date must be an ISO date');
  const pricePaid = input.pricePaid === undefined ? round(Number(definition.data.price)) : round(Number(input.pricePaid));
  if (!Number.isFinite(pricePaid) || pricePaid < 0) throw new Error('package purchase price must be zero or greater');
  const paymentMode = input.paymentMode || 'Pay Later';
  const reason = String(input.reason || 'Package purchase').trim().slice(0, 500);
  return store.transaction(() => {
    const assigned = post(createRow(tenant, actor, 'customer_package', { customer: input.customer, service_package: definition.id, purchased_date: purchaseDate, expires_on: addDays(purchaseDate, Number(definition.data.validity_days)), price_paid: pricePaid, payment_mode: paymentMode, payment_status: paymentMode === 'Pay Later' ? 'Unpaid' : 'Paid', status: 'Active' }));
    if (pricePaid > 0) {
      appendCustomerLedger(tenant, actor, { customer: input.customer, entryType: 'Invoice Debit', debit: pricePaid, referenceType: 'customer_package', referenceId: assigned.id, reason });
      if (paymentMode !== 'Pay Later') appendCustomerLedger(tenant, actor, { customer: input.customer, entryType: 'Payment Credit', credit: pricePaid, referenceType: 'customer_package', referenceId: assigned.id, reason: `${paymentMode} package payment` });
    }
    audit(tenant, actor, 'package:purchased', { entity: 'customer_package', row_id: assigned.id, after: { customer: input.customer, servicePackage: definition.id, pricePaid, paymentMode } });
    return presentCustomerPackage(tenant, assigned);
  });
}

export function redeemServicePackage(tenant: string, actor: string, input: PackageRedemptionInput) {
  const assigned = required(tenant, 'customer_package', input.customerPackage, 'customer package');
  const status = effectiveStatus(assigned);
  if (status !== 'Active') throw new Error(`customer package is ${status.toLowerCase()} and cannot be redeemed`);
  const quantity = round(Number(input.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('redemption quantity must be greater than zero');
  const allowance = packageLines(tenant, String(assigned.data.service_package)).find((line) => line.data.garment === input.garment && line.data.service === input.service);
  if (!allowance) throw new Error('this garment and service are not included in the package');
  if (input.order) { const order = required(tenant, 'laundry_order', input.order, 'order'); if (order.data.customer !== assigned.data.customer) throw new Error('package redemption order belongs to another customer'); }
  return store.transaction(() => {
    const used = redemptionRows(tenant, assigned.id).filter((row) => row.data.garment === input.garment && row.data.service === input.service).reduce((sum, row) => sum + Number(row.data.quantity || 0), 0);
    if (round(used + quantity) > Number(allowance.data.allowance)) throw new Error('package redemption exceeds the remaining allowance');
    const redemption = post(createRow(tenant, actor, 'package_redemption', { customer_package: assigned.id, customer: assigned.data.customer, garment: input.garment, service: input.service, quantity, redeemed_date: today(), order: input.order || '', reason: String(input.reason || '').trim().slice(0, 500) }));
    const exhausted = packageLines(tenant, String(assigned.data.service_package)).every((line) => {
      const lineUsed = redemptionRows(tenant, assigned.id).filter((row) => row.data.garment === line.data.garment && row.data.service === line.data.service).reduce((sum, row) => sum + Number(row.data.quantity || 0), 0);
      return round(lineUsed) >= Number(line.data.allowance);
    });
    if (exhausted) { assigned.data.status = 'Exhausted'; assigned.updated_at = new Date().toISOString(); store.updateRow(assigned); }
    audit(tenant, actor, 'package:redeemed', { entity: 'package_redemption', row_id: redemption.id, after: { customerPackage: assigned.id, quantity, exhausted } });
    return presentCustomerPackage(tenant, assigned);
  });
}

export function customerPackages(tenant: string, customerId: string) {
  customer(tenant, customerId);
  return activeRows(tenant, 'customer_package').filter((row) => row.data.customer === customerId).map((row) => presentCustomerPackage(tenant, row)).sort((a, b) => b.purchasedDate.localeCompare(a.purchasedDate) || b.id.localeCompare(a.id));
}
