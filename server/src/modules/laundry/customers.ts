import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { laundryBusinessDate } from './dates.js';

export type CustomerInput = { name: string; phone: string; email?: string; address?: string; openingBalance?: number; notes?: string };
export type WalletCommand = { type: 'Credit' | 'Debit' | 'Refund' | 'Adjustment'; amount: number; reason: string; referenceType?: string; referenceId?: string };
export type RewardCommand = { points: number; reason: string; referenceType?: string; referenceId?: string };

const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const date = () => laundryBusinessDate();
const normPhone = (value: unknown) => String(value || '').replace(/\D/g, '');

function customerRow(tenant: string, id: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== 'party' || !row.data.is_customer) throw new Error('customer not found');
  return row;
}

function findCustomer(tenant: string, phone: string, excludeId = '') {
  return store.rowsOf(tenant, 'party').find((row) => row.entity === 'party' && row.data.is_customer && row.id !== excludeId && normPhone(row.data.phone) === phone);
}

function postDocument(row: EntityRow) {
  row.status = 'Posted';
  row.updated_at = new Date().toISOString();
  store.updateRow(row);
  return row;
}

export function appendCustomerLedger(tenant: string, actor: string, input: { customer: string; entryType: 'Opening Balance' | 'Invoice Debit' | 'Payment Credit' | 'Wallet Credit' | 'Wallet Debit' | 'Refund' | 'Adjustment' | 'Settlement'; debit?: number; credit?: number; referenceType?: string; referenceId?: string; reason?: string }) {
  customerRow(tenant, input.customer);
  const debit = Math.max(0, round(Number(input.debit) || 0));
  const credit = Math.max(0, round(Number(input.credit) || 0));
  if ((debit === 0 && credit === 0) || (debit > 0 && credit > 0)) throw new Error('customer ledger entry needs exactly one debit or credit amount');
  const row = postDocument(createRow(tenant, actor, 'laundry_customer_ledger', {
    customer: input.customer, entry_date: date(), entry_type: input.entryType, debit, credit,
    reference_type: input.referenceType || '', reference_id: input.referenceId || '', reason: String(input.reason || '').trim(),
  }));
  audit(tenant, actor, 'customer:ledger-posted', { entity: 'laundry_customer_ledger', row_id: row.id, after: { customer: input.customer, entryType: input.entryType, debit, credit, referenceId: input.referenceId } });
  return presentLedger(row);
}

export function createLaundryCustomer(tenant: string, actor: string, input: CustomerInput) {
  const name = String(input.name || '').trim().slice(0, 160);
  const phone = normPhone(input.phone);
  if (!name) throw new Error('customer name is required');
  if (phone.length < 6 || phone.length > 15) throw new Error('a valid customer phone is required');
  if (findCustomer(tenant, phone)) throw new Error('a customer with this phone already exists in this branch');
  const openingBalance = round(Number(input.openingBalance) || 0);
  return store.transaction(() => {
    const customer = createRow(tenant, actor, 'party', { name, phone, email: String(input.email || '').trim(), address: String(input.address || '').trim(), notes: String(input.notes || '').trim(), is_customer: true });
    let openingEntry: ReturnType<typeof appendCustomerLedger> | undefined;
    if (openingBalance !== 0) openingEntry = appendCustomerLedger(tenant, actor, { customer: customer.id, entryType: 'Opening Balance', debit: openingBalance > 0 ? openingBalance : 0, credit: openingBalance < 0 ? Math.abs(openingBalance) : 0, reason: 'Opening balance' });
    audit(tenant, actor, 'customer:created', { entity: 'party', row_id: customer.id, after: { name, phone, openingBalance } });
    return { ...presentCustomer(customer), openingEntry };
  });
}

export function updateLaundryCustomer(tenant: string, actor: string, id: string, input: Partial<CustomerInput>) {
  const customer = customerRow(tenant, id);
  const name = input.name === undefined ? String(customer.data.name || '') : String(input.name || '').trim().slice(0, 160);
  const phone = input.phone === undefined ? normPhone(customer.data.phone) : normPhone(input.phone);
  if (!name) throw new Error('customer name is required');
  if (phone.length < 6 || phone.length > 15) throw new Error('a valid customer phone is required');
  if (findCustomer(tenant, phone, id)) throw new Error('a customer with this phone already exists in this branch');
  const before = presentCustomer(customer);
  customer.data = { ...customer.data, name, phone, email: input.email === undefined ? customer.data.email || '' : String(input.email || '').trim(), address: input.address === undefined ? customer.data.address || '' : String(input.address || '').trim(), notes: input.notes === undefined ? customer.data.notes || '' : String(input.notes || '').trim(), is_customer: true };
  customer.updated_at = new Date().toISOString();
  store.updateRow(customer);
  audit(tenant, actor, 'customer:updated', { entity: 'party', row_id: id, before, after: presentCustomer(customer) });
  return presentCustomer(customer);
}

export function applyWalletCommand(tenant: string, actor: string, customerId: string, input: WalletCommand) {
  customerRow(tenant, customerId);
  const amount = round(Number(input.amount));
  const reason = String(input.reason || '').trim().slice(0, 500);
  if (!['Credit', 'Debit', 'Refund', 'Adjustment'].includes(input.type)) throw new Error('unknown wallet action');
  if (amount <= 0) throw new Error('wallet amount must be greater than zero');
  if (!reason) throw new Error('wallet adjustment reason is required');
  return store.transaction(() => {
    const current = walletEntries(tenant, customerId).reduce((sum, entry) => sum + (entry.entryType === 'Debit' ? -entry.amount : entry.amount), 0);
    if (input.type === 'Debit' && round(current) < amount) throw new Error('wallet debit exceeds available balance');
    const entry = postDocument(createRow(tenant, actor, 'laundry_wallet_entry', { customer: customerId, entry_date: date(), entry_type: input.type, amount, reason, reference_type: input.referenceType || '', reference_id: input.referenceId || '' }));
    const isDebit = input.type === 'Debit';
    appendCustomerLedger(tenant, actor, { customer: customerId, entryType: isDebit ? 'Wallet Debit' : 'Wallet Credit', debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount, referenceType: 'laundry_wallet_entry', referenceId: entry.id, reason });
    audit(tenant, actor, 'customer:wallet-posted', { entity: 'laundry_wallet_entry', row_id: entry.id, after: { customer: customerId, type: input.type, amount, reason } });
    return presentWallet(entry);
  });
}

export function adjustRewards(tenant: string, actor: string, customerId: string, input: RewardCommand) {
  customerRow(tenant, customerId);
  const points = Math.round(Number(input.points) || 0);
  const reason = String(input.reason || '').trim().slice(0, 500);
  if (!points) throw new Error('reward points must not be zero');
  if (!reason) throw new Error('reward adjustment reason is required');
  const current = rewardEntries(tenant, customerId).reduce((sum, entry) => sum + entry.points, 0);
  if (points < 0 && current + points < 0) throw new Error('reward redemption exceeds available points');
  const entry = postDocument(createRow(tenant, actor, 'laundry_reward_entry', { customer: customerId, entry_date: date(), points, reason, reference_type: input.referenceType || '', reference_id: input.referenceId || '' }));
  audit(tenant, actor, 'customer:reward-posted', { entity: 'laundry_reward_entry', row_id: entry.id, after: { customer: customerId, points, reason, policy: 'EPIC_EXTENSION_MANUAL' } });
  return presentReward(entry);
}

export function customerProfile(tenant: string, id: string) {
  const customer = customerRow(tenant, id);
  const orders = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.customer === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ledger = customerLedger(tenant, id);
  const wallet = walletEntries(tenant, id);
  const rewards = rewardEntries(tenant, id);
  const unreconciledOrderIds = orders.filter((order) => order.data.state !== 'Cancelled' && Number(order.data.grand_total || 0) > 0 && !ledger.some((entry) => entry.referenceType === 'laundry_order' && entry.referenceId === order.id)).map((order) => order.id);
  const balance = round(ledger.reduce((sum, entry) => sum + entry.debit - entry.credit, 0));
  const walletBalance = round(wallet.reduce((sum, entry) => sum + (entry.entryType === 'Debit' ? -entry.amount : entry.amount), 0));
  const rewardPoints = rewards.reduce((sum, entry) => sum + entry.points, 0);
  const revenue = round(orders.filter((order) => order.data.state !== 'Cancelled').reduce((sum, order) => sum + (Number(order.data.grand_total) || 0), 0));
  const currentPackageRow = store.rowsOf(tenant, 'customer_package').filter((row) => row.data.customer === id && row.data.status === 'Active' && String(row.data.expires_on || '') >= date()).sort((a, b) => String(a.data.expires_on).localeCompare(String(b.data.expires_on)))[0];
  const currentPackageDefinition = currentPackageRow ? store.getRow(tenant, String(currentPackageRow.data.service_package)) : undefined;
  const byState = Object.fromEntries(['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'].map((state) => [state, orders.filter((order) => order.data.state === state).length]));
  const timeline = [
    ...ledger.map((entry) => ({ at: entry.entryDate, type: 'ledger', label: entry.entryType, amount: round(entry.debit - entry.credit), referenceId: entry.referenceId, reason: entry.reason })),
    ...wallet.map((entry) => ({ at: entry.entryDate, type: 'wallet', label: `Wallet ${entry.entryType}`, amount: entry.entryType === 'Debit' ? -entry.amount : entry.amount, referenceId: entry.referenceId, reason: entry.reason })),
    ...rewards.map((entry) => ({ at: entry.entryDate, type: 'reward', label: 'Reward adjustment', amount: entry.points, referenceId: entry.referenceId, reason: entry.reason })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    customer: presentCustomer(customer),
    metrics: { revenue, orderBalance: balance, walletBalance, rewardPoints, lastVisit: orders[0]?.data.order_date || null, currentPackage: currentPackageDefinition ? String(currentPackageDefinition.data.name || '') : null, orderStatus: byState },
    orders: orders.map((order) => ({ id: order.id, orderNumber: order.data.name || order.id, orderDate: order.data.order_date, state: order.data.state, grandTotal: Number(order.data.grand_total || 0), invoice: order.data.invoice || null, paymentStatus: order.data.payment_status || 'Unpaid' })),
    ledger, wallet, rewards, timeline,
    reconciliation: { customerLedgerBalance: balance, walletBalance, orderCount: orders.length, unreconciledOrderCount: unreconciledOrderIds.length, note: unreconciledOrderIds.length ? `${unreconciledOrderIds.length} historical order(s) predate the customer ledger and require controlled reconciliation; displayed balance is ledger-only.` : 'Balances are derived from append-only customer and wallet ledger entries.' },
  };
}

export function searchCustomerRecords(tenant: string, search = '') {
  const needle = String(search || '').trim().toLowerCase();
  const invoiceMatches = new Set(store.rowsOf(tenant, 'laundry_order').filter((order) => `${order.data.name || ''} ${order.data.invoice || ''}`.toLowerCase().includes(needle)).map((order) => String(order.data.customer)));
  return store.rowsOf(tenant, 'party').filter((row) => row.entity === 'party' && row.data.is_customer).filter((row) => !needle || `${row.data.name || ''} ${row.data.phone || ''}`.toLowerCase().includes(needle) || invoiceMatches.has(row.id)).slice(0, 30).map((row) => ({ ...presentCustomer(row), matchedBy: invoiceMatches.has(row.id) && !`${row.data.name || ''} ${row.data.phone || ''}`.toLowerCase().includes(needle) ? 'invoice' : 'identity' }));
}

function customerLedger(tenant: string, customer: string) { return store.rowsOf(tenant, 'laundry_customer_ledger').filter((row) => row.data.customer === customer).map(presentLedger).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id.localeCompare(a.id)); }
function walletEntries(tenant: string, customer: string) { return store.rowsOf(tenant, 'laundry_wallet_entry').filter((row) => row.data.customer === customer).map(presentWallet).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id.localeCompare(a.id)); }
function rewardEntries(tenant: string, customer: string) { return store.rowsOf(tenant, 'laundry_reward_entry').filter((row) => row.data.customer === customer).map(presentReward).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id.localeCompare(a.id)); }
function presentCustomer(row: EntityRow) { return { id: row.id, name: String(row.data.name || ''), phone: normPhone(row.data.phone), email: String(row.data.email || ''), address: String(row.data.address || ''), notes: String(row.data.notes || ''), createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentLedger(row: EntityRow) { return { id: row.id, entryDate: String(row.data.entry_date), entryType: String(row.data.entry_type), debit: Number(row.data.debit || 0), credit: Number(row.data.credit || 0), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || ''), reason: String(row.data.reason || '') }; }
function presentWallet(row: EntityRow) { return { id: row.id, entryDate: String(row.data.entry_date), entryType: String(row.data.entry_type), amount: Number(row.data.amount || 0), reason: String(row.data.reason || ''), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || '') }; }
function presentReward(row: EntityRow) { return { id: row.id, entryDate: String(row.data.entry_date), points: Number(row.data.points || 0), reason: String(row.data.reason || ''), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || '') }; }
