import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { appendCustomerLedger } from './customers.js';
import { laundryBusinessDate } from './dates.js';
import { parseMoney, moneyNumber } from '../../kernel/money.js';

export type PackageLineInput = { garment: string; service: string; allowance: number };
export type PackageInput = { name: string; description?: string; price: number | string; validityDays: number; active?: boolean; services: PackageLineInput[] };
export type PackagePurchaseInput = { customer: string; servicePackage: string; purchaseDate?: string; pricePaid?: number | string; paymentMode?: 'Pay Later' | 'Cash' | 'UPI' | 'Card' | 'Bank'; reason?: string };
export type PackagePaymentInput = { amount: number | string; mode: 'Cash' | 'UPI' | 'Card' | 'Bank'; reference?: string; paymentDate?: string; reason?: string };
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
function packagePaymentRows(tenant: string, customerPackageId: string) {
  return activeRows(tenant, 'customer_package_payment').filter((payment) => payment.data.customer_package === customerPackageId && payment.status !== 'Cancelled');
}
function packageContractAmount(tenant: string, row: EntityRow) {
  const definition = required(tenant, 'service_package', String(row.data.service_package), 'service package');
  return moneyNumber(parseMoney(row.data.contract_price ?? definition.data.price, `package ${row.id} contract value`, { allowZero: true }));
}
function packageCollectedAmount(tenant: string, row: EntityRow) {
  let collectedPaise = 0;
  const initial = store.financialDocumentAmountPaise(tenant, 'package-payment', row.entity, row.id);
  if (initial !== undefined) collectedPaise += initial;
  else if (String(row.data.payment_status || '') === 'Paid' && String(row.data.payment_mode || '') !== 'Pay Later') collectedPaise += parseMoney(row.data.price_paid || 0, `package ${row.id} payment`, { allowZero: true });
  for (const payment of packagePaymentRows(tenant, row.id)) {
    const amountPaise = store.financialDocumentAmountPaise(tenant, 'package-payment', payment.entity, payment.id);
    if (amountPaise !== undefined) collectedPaise += amountPaise;
    else collectedPaise += parseMoney(payment.data.amount || 0, `package payment ${payment.id}`, { allowZero: true });
  }
  return moneyNumber(collectedPaise);
}
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
  return { id: row.id, customer: String(row.data.customer), servicePackage: { id: definition.id, name: String(definition.data.name) }, purchasedDate: String(row.data.purchased_date), expiresOn: String(row.data.expires_on), pricePaid: packageCollectedAmount(tenant, row), contractValue: packageContractAmount(tenant, row), paymentMode: String(row.data.payment_mode || 'Pay Later'), paymentStatus: String(row.data.payment_status || 'Unpaid'), status: effectiveStatus(row), services, redemptions: redemptions.map((redemption) => ({ id: redemption.id, garment: String(redemption.data.garment), service: String(redemption.data.service), quantity: Number(redemption.data.quantity || 0), redeemedDate: String(redemption.data.redeemed_date), order: String(redemption.data.order || ''), reason: String(redemption.data.reason || '') })) };
}

export function listServicePackages(tenant: string, includeInactive = false) {
  return activeRows(tenant, 'service_package').filter((row) => includeInactive || Boolean(row.data.active)).map((row) => presentDefinition(tenant, row));
}

export function createServicePackage(tenant: string, actor: string, input: PackageInput) {
  const name = String(input.name || '').trim().slice(0, 160);
  const description = String(input.description || '').trim().slice(0, 1200);
  const price = moneyNumber(parseMoney(input.price, 'package price', { allowZero: true }));
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
  const contractPrice = moneyNumber(parseMoney(definition.data.price, 'package contract price', { allowZero: true }));
  const paymentMode = input.paymentMode || 'Pay Later';
  const pricePaid = input.pricePaid === undefined ? (paymentMode === 'Pay Later' ? 0 : contractPrice) : moneyNumber(parseMoney(input.pricePaid, 'package purchase price', { allowZero: true }));
  if (!Number.isFinite(pricePaid) || pricePaid < 0 || pricePaid > contractPrice) throw new Error(`package payment must be between 0 and ${contractPrice.toFixed(2)}`);
  if (!['Pay Later', 'Cash', 'UPI', 'Card', 'Bank'].includes(paymentMode)) throw new Error('unsupported package payment method');
  const reason = String(input.reason || 'Package purchase').trim().slice(0, 500);
  return store.transaction(() => {
    const assigned = post(createRow(tenant, actor, 'customer_package', { customer: input.customer, service_package: definition.id, purchased_date: purchaseDate, expires_on: addDays(purchaseDate, Number(definition.data.validity_days)), contract_price: contractPrice, price_paid: pricePaid, payment_mode: paymentMode, payment_status: pricePaid >= contractPrice && contractPrice > 0 ? 'Paid' : pricePaid > 0 ? 'Part Paid' : 'Unpaid', status: 'Active' }));
    if (contractPrice > 0) {
      appendCustomerLedger(tenant, actor, { customer: input.customer, entryType: 'Invoice Debit', debit: contractPrice, referenceType: 'customer_package', referenceId: assigned.id, reason });
      if (pricePaid > 0 && paymentMode !== 'Pay Later') {
        appendCustomerLedger(tenant, actor, { customer: input.customer, entryType: 'Payment Credit', credit: pricePaid, referenceType: 'customer_package', referenceId: assigned.id, reason: `${paymentMode} package payment` });
        store.appendFinancialEntry({ id: `money:${assigned.id}:package-payment`, tenant, storeId: store.currentStore(tenant), kind: 'package-payment', sourceEntity: 'customer_package', sourceId: assigned.id, direction: 'IN', amountPaise: parseMoney(pricePaid, 'package payment'), currency: 'INR', occurredAt: assigned.created_at, actor, metadata: { paymentMode, customerId: input.customer, packageId: definition.id } });
        store.appendFinancialDocument({ id: `doc:${assigned.id}`, tenant, storeId: store.currentStore(tenant), documentType: 'package-payment', sourceEntity: 'customer_package', sourceId: assigned.id, amountPaise: parseMoney(pricePaid, 'package payment'), currency: 'INR', status: assigned.status, occurredAt: assigned.created_at, actor, metadata: { paymentMode, customerId: input.customer, packageId: definition.id } });
      }
    }
    audit(tenant, actor, 'package:purchased', { entity: 'customer_package', row_id: assigned.id, after: { customer: input.customer, servicePackage: definition.id, contractPrice, pricePaid, paymentMode } });
    return presentCustomerPackage(tenant, assigned);
  });
}

export function collectServicePackagePayment(tenant: string, actor: string, customerPackageId: string, input: PackagePaymentInput) {
  const assigned = required(tenant, 'customer_package', customerPackageId, 'customer package');
  const status = effectiveStatus(assigned);
  if (status === 'Expired' || status === 'Cancelled') throw new Error(`customer package is ${status.toLowerCase()} and cannot receive payment`);
  const contract = packageContractAmount(tenant, assigned);
  const collected = packageCollectedAmount(tenant, assigned);
  const amount = moneyNumber(parseMoney(input.amount, 'package payment amount'));
  if (amount <= 0) throw new Error('package payment amount must be greater than zero');
  if (amount > round(contract - collected)) throw new Error(`package payment exceeds outstanding amount (${round(contract - collected).toFixed(2)})`);
  if (!['Cash', 'UPI', 'Card', 'Bank'].includes(input.mode)) throw new Error('unsupported package payment method');
  const paymentDate = String(input.paymentDate || today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(Date.parse(`${paymentDate}T00:00:00Z`))) throw new Error('payment date must be an ISO date');
  const reason = String(input.reason || 'Package payment').trim().slice(0, 500);
  const reference = String(input.reference || '').trim().slice(0, 120);
  return store.transaction(() => {
    const payment = post(createRow(tenant, actor, 'customer_package_payment', { customer_package: assigned.id, customer: assigned.data.customer, payment_date: paymentDate, amount, mode: input.mode, reference, reason }));
    store.appendFinancialEntry({ id: `money:${payment.id}:package-payment`, tenant, storeId: store.currentStore(tenant), kind: 'package-payment', sourceEntity: payment.entity, sourceId: payment.id, direction: 'IN', amountPaise: parseMoney(amount, 'package payment'), currency: 'INR', occurredAt: payment.created_at, actor, metadata: { paymentMode: input.mode, customerId: assigned.data.customer, customerPackageId: assigned.id, reference } });
    store.appendFinancialDocument({ id: `doc:${payment.id}:package-payment`, tenant, storeId: store.currentStore(tenant), documentType: 'package-payment', sourceEntity: payment.entity, sourceId: payment.id, amountPaise: parseMoney(amount, 'package payment'), currency: 'INR', status: payment.status, occurredAt: payment.created_at, actor, metadata: { paymentMode: input.mode, customerId: assigned.data.customer, customerPackageId: assigned.id, reference } });
    appendCustomerLedger(tenant, actor, { customer: String(assigned.data.customer), entryType: 'Payment Credit', credit: amount, referenceType: 'customer_package_payment', referenceId: payment.id, reason });
    const nextCollected = round(collected + amount);
    assigned.data.price_paid = nextCollected;
    assigned.data.payment_status = nextCollected >= contract && contract > 0 ? 'Paid' : 'Part Paid';
    assigned.data.payment_mode = input.mode;
    assigned.updated_at = new Date().toISOString();
    store.updateRow(assigned);
    audit(tenant, actor, 'package:payment-collected', { entity: payment.entity, row_id: payment.id, after: { customerPackageId: assigned.id, amount, collected: nextCollected, outstanding: round(contract - nextCollected), mode: input.mode, reference } });
    return { payment: { id: payment.id, amount, mode: input.mode, reference, paymentDate }, package: presentCustomerPackage(tenant, assigned), contractValue: contract, collected: nextCollected, outstanding: round(contract - nextCollected) };
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

/** Read-only package liability control. It reports contracted value, collected
 * cash, outstanding receivable, and remaining service allowances separately so
 * the system never invents a rupee value for an unpriced service unit. */
export function packageLiability(tenant: string, filters: { customerId?: string } = {}) {
  const rows = activeRows(tenant, 'customer_package').filter((row) => !filters.customerId || row.data.customer === filters.customerId);
  const issues: Array<{ code: string; packageId: string; message: string }> = [];
  const packages = rows.map((row) => {
    const presented = presentCustomerPackage(tenant, row);
    let contractPaise = 0;
    try { contractPaise = parseMoney(packageContractAmount(tenant, row), `package ${row.id} contract value`, { allowZero: true }); }
    catch (error: any) { issues.push({ code: 'INVALID_PACKAGE_VALUE', packageId: row.id, message: error.message || 'package contract value is not valid fixed-scale money' }); }
    let collectedPaise = 0;
    try { collectedPaise = parseMoney(packageCollectedAmount(tenant, row), `package ${row.id} collected value`, { allowZero: true }); }
    catch (error: any) { issues.push({ code: 'INVALID_PACKAGE_PAYMENT', packageId: row.id, message: error.message || 'package payment value is not valid fixed-scale money' }); }
    const outstandingPaise = Math.max(0, contractPaise - collectedPaise);
    const allowanceUnits = round(presented.services.reduce((sum, line) => sum + line.allowance, 0));
    const redeemedUnits = round(presented.services.reduce((sum, line) => sum + line.used, 0));
    const remainingUnits = round(presented.services.reduce((sum, line) => sum + Math.max(0, line.remaining), 0));
    const overRedeemed = presented.services.some((line) => line.remaining < 0);
    if (overRedeemed) issues.push({ code: 'PACKAGE_OVER_REDEEMED', packageId: row.id, message: 'redeemed quantity exceeds the package allowance' });
    if (String(row.data.payment_status || '') === 'Paid' && String(row.data.payment_mode || '') === 'Pay Later') issues.push({ code: 'PACKAGE_PAYMENT_STATE_MISMATCH', packageId: row.id, message: 'package is marked paid but payment mode is Pay Later' });
    if (collectedPaise > 0 && store.financialEntryAmountPaise(tenant, 'package-payment', row.entity, row.id) === undefined && packagePaymentRows(tenant, row.id).every((payment) => store.financialEntryAmountPaise(tenant, 'package-payment', payment.entity, payment.id) === undefined)) issues.push({ code: 'MISSING_PACKAGE_PAYMENT_EVIDENCE', packageId: row.id, message: 'package has collected cash but no canonical payment entry' });
    return { id: row.id, customer: String(row.data.customer), servicePackage: presented.servicePackage, purchasedDate: presented.purchasedDate, expiresOn: presented.expiresOn, status: presented.status, paymentStatus: presented.paymentStatus, contractPaise, collectedPaise, outstandingPaise, allowanceUnits, redeemedUnits, remainingUnits };
  });
  const totals = packages.reduce((sum, item) => ({ contractPaise: sum.contractPaise + item.contractPaise, collectedPaise: sum.collectedPaise + item.collectedPaise, outstandingPaise: sum.outstandingPaise + item.outstandingPaise, allowanceUnits: round(sum.allowanceUnits + item.allowanceUnits), redeemedUnits: round(sum.redeemedUnits + item.redeemedUnits), remainingUnits: round(sum.remainingUnits + item.remainingUnits) }), { contractPaise: 0, collectedPaise: 0, outstandingPaise: 0, allowanceUnits: 0, redeemedUnits: 0, remainingUnits: 0 });
  const byCustomer = new Map<string, { customer: string; packages: number; active: number; outstandingPaise: number; remainingUnits: number }>();
  for (const item of packages) {
    const current = byCustomer.get(item.customer) || { customer: item.customer, packages: 0, active: 0, outstandingPaise: 0, remainingUnits: 0 };
    current.packages += 1; if (item.status === 'Active') current.active += 1; current.outstandingPaise += item.outstandingPaise; current.remainingUnits = round(current.remainingUnits + item.remainingUnits); byCustomer.set(item.customer, current);
  }
  return {
    asOf: new Date().toISOString(),
    currency: 'INR',
    status: issues.length ? 'Attention required' : 'Reconciled',
    packageCount: packages.length,
    activePackageCount: packages.filter((item) => item.status === 'Active').length,
    expiredPackageCount: packages.filter((item) => item.status === 'Expired').length,
    exhaustedPackageCount: packages.filter((item) => item.status === 'Exhausted').length,
    totals: { ...totals, contract: moneyNumber(totals.contractPaise), collected: moneyNumber(totals.collectedPaise), outstanding: moneyNumber(totals.outstandingPaise) },
    packages: packages.slice(0, 500),
    customers: [...byCustomer.values()].sort((a, b) => b.outstandingPaise - a.outstandingPaise || a.customer.localeCompare(b.customer)).slice(0, 200).map((item) => ({ ...item, outstanding: moneyNumber(item.outstandingPaise) })),
    checks: { issueCount: issues.length, passed: issues.length === 0 },
    issues: issues.slice(0, 200),
    truncated: issues.length > 200 || packages.length > 500,
  };
}
