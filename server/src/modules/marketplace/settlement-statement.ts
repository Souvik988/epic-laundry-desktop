import type { EntityRow } from '../../kernel/types.js';
import { store } from '../../kernel/store.js';

type SettlementLine = { code: string; label: string; amountPaise: number; direction: 'credit' | 'debit'; explanation: string };
type RefundAllocation = { allocationId: string; amountPaise: number; responsibility: string; reason: string };

export type CanonicalSettlementStatement = {
  documentType: 'MarketplaceSettlementStatement';
  statementNumber: string;
  issuedAt: string;
  financialYear: string;
  settlementId: string;
  storeId: string;
  externalOrderId: string;
  policyVersion: string;
  currency: 'INR';
  customerCollectedPaise: number;
  refundPaise: number;
  collectedCustomerValuePaise: number;
  refundAllocations: RefundAllocation[];
  collectionLines: SettlementLine[];
  lines: SettlementLine[];
  vendorSettlementPaise: number;
  reconciled: true;
  immutable: true;
};

function fy(issuedAt: string) {
  const date = new Date(issuedAt);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid settlement statement date');
  const start = date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function integerPaise(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be non-negative integer paise`);
  return Number(value);
}

function cloneLines(lines: unknown, label: string): SettlementLine[] {
  if (!Array.isArray(lines)) throw new Error(`${label} are required`);
  return lines.map((candidate: any) => {
    const direction = candidate?.direction;
    if (!['credit', 'debit'].includes(direction)) throw new Error('invalid settlement line direction');
    const code = String(candidate?.code || '').trim();
    const lineLabel = String(candidate?.label || '').trim();
    const explanation = String(candidate?.explanation || '').trim();
    if (!code || !lineLabel || !explanation) throw new Error('invalid settlement line');
    return { code, label: lineLabel, amountPaise: integerPaise(candidate.amountPaise, lineLabel), direction, explanation };
  });
}

export function createCanonicalSettlementStatement(tenant: string, actor: string, input: {
  settlementId: string;
  storeId: string;
  externalOrderId: string;
  policyVersion: string;
  issuedAt: string;
  customerCollectedPaise: number;
  refundPaise: number;
  collectedCustomerValuePaise: number;
  refundAllocations: RefundAllocation[];
  collectionLines: SettlementLine[];
  lines: SettlementLine[];
  vendorSettlementPaise: number;
  reconciled: true;
}) {
  const settlementId = String(input.settlementId || '').trim();
  const externalOrderId = String(input.externalOrderId || '').trim();
  const policyVersion = String(input.policyVersion || '').trim();
  const storeId = String(input.storeId || '').trim();
  if (!settlementId || !externalOrderId || !policyVersion || !storeId) throw new Error('SETTLEMENT_STATEMENT_INVALID');
  const existing = store.rowsOf(tenant, 'canonical_settlement_statement').find((candidate) => candidate.data.settlementId === settlementId);
  if (existing) return existing;
  const issuedAt = new Date(input.issuedAt).toISOString();
  const financialYear = fy(issuedAt);
  const customerCollectedPaise = integerPaise(input.customerCollectedPaise, 'customer collection');
  const refundPaise = integerPaise(input.refundPaise, 'refund');
  const collectedCustomerValuePaise = integerPaise(input.collectedCustomerValuePaise, 'collected customer value');
  const vendorSettlementPaise = integerPaise(input.vendorSettlementPaise, 'vendor settlement');
  const collectionLines = cloneLines(input.collectionLines, 'collection lines');
  const lines = cloneLines(input.lines, 'settlement lines');
  const refundAllocations = (input.refundAllocations || []).map((allocation) => {
    const allocationId = String(allocation?.allocationId || '').trim();
    const responsibility = String(allocation?.responsibility || '').trim();
    const reason = String(allocation?.reason || '').trim();
    if (!allocationId || !reason || !['Vendor', 'Platform', 'Shared', 'PendingPolicy'].includes(responsibility)) throw new Error('SETTLEMENT_RECONCILIATION_FAILED');
    return { allocationId, amountPaise: integerPaise(allocation.amountPaise, 'refund allocation'), responsibility, reason };
  });
  if (new Set(refundAllocations.map((allocation) => allocation.allocationId)).size !== refundAllocations.length || refundAllocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0) !== refundPaise || (refundPaise > 0 && refundAllocations.length === 0)) throw new Error('SETTLEMENT_RECONCILIATION_FAILED');
  const collectionEquation = collectionLines.reduce((sum, line) => sum + (line.direction === 'credit' ? line.amountPaise : -line.amountPaise), 0);
  const settlementEquation = lines.reduce((sum, line) => sum + (line.direction === 'credit' ? line.amountPaise : -line.amountPaise), 0);
  if (refundPaise > customerCollectedPaise || collectedCustomerValuePaise !== customerCollectedPaise - refundPaise || collectionEquation !== collectedCustomerValuePaise || settlementEquation !== vendorSettlementPaise || input.reconciled !== true) throw new Error('SETTLEMENT_RECONCILIATION_FAILED');
  const sequence = store.nextSeq(`settlement-statement:${tenant}:${storeId}:${financialYear}`);
  const statementNumber = `SETTLE/${financialYear}/${String(sequence).padStart(5, '0')}`;
  const snapshot: CanonicalSettlementStatement = { documentType: 'MarketplaceSettlementStatement', statementNumber, issuedAt, financialYear, settlementId, storeId, externalOrderId, policyVersion, currency: 'INR', customerCollectedPaise, refundPaise, collectedCustomerValuePaise, refundAllocations, collectionLines, lines, vendorSettlementPaise, reconciled: true, immutable: true };
  const row: EntityRow = { id: `settlement_statement_${statementNumber.replace(/[^A-Za-z0-9]+/g, '_')}`, entity: 'canonical_settlement_statement', tenant, status: 'Submitted', version: 1, created_by: actor, created_at: issuedAt, updated_at: issuedAt, data: snapshot };
  store.insertRow(row);
  return row;
}

export function marketplaceSettlementStatement(tenant: string, externalOrderId: string): (EntityRow & { data: CanonicalSettlementStatement }) | undefined {
  const settlement = store.rowsOf(tenant, 'marketplace_settlement').find((candidate) => candidate.data.externalOrderId === externalOrderId);
  if (!settlement) return undefined;
  const statement = store.rowsOf(tenant, 'canonical_settlement_statement').find((candidate) => candidate.data.settlementId === settlement.id);
  return statement as (EntityRow & { data: CanonicalSettlementStatement }) | undefined;
}

export function renderCanonicalSettlementStatement(snapshot: CanonicalSettlementStatement) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
  const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const row = (line: SettlementLine) => `<tr><td>${escape(line.label)}</td><td>${escape(line.code)}</td><td>${escape(line.direction)}</td><td class="number">${escape(money(line.amountPaise))}</td><td>${escape(line.explanation)}</td></tr>`;
  const allocationRow = (allocation: RefundAllocation) => `<tr><td>${escape(allocation.allocationId)}</td><td>${escape(allocation.responsibility)}</td><td class="number">${escape(money(allocation.amountPaise))}</td><td>${escape(allocation.reason)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Marketplace Settlement Statement ${escape(snapshot.statementNumber)}</title><style>body{font:14px Arial,sans-serif;color:#17353c;margin:0;padding:28px;background:#fffdf8}main{max-width:980px;margin:auto;background:#fff;border:1px solid #d9e3de;padding:28px}header{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #39786f;padding-bottom:16px}.right{text-align:right}.muted{color:#617178}.box{border:1px solid #d9e3de;border-radius:8px;padding:14px;margin-top:18px}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border-bottom:1px solid #e4ece8;padding:9px 7px;text-align:left;vertical-align:top}th{background:#f1f7f4;font-size:12px;text-transform:uppercase}.number{text-align:right;white-space:nowrap}.total{font-size:22px;font-weight:700;color:#39786f;text-align:right;margin-top:14px}footer{margin-top:22px;padding-top:12px;border-top:1px solid #d9e3de;color:#718087;font-size:12px}</style></head><body><main><header><div><h1>Marketplace Settlement Statement</h1><div class="muted">Store ${escape(snapshot.storeId)} · Order ${escape(snapshot.externalOrderId)}</div></div><div class="right"><b>${escape(snapshot.statementNumber)}</b><div class="muted">${escape(snapshot.financialYear)} · ${escape(snapshot.issuedAt.slice(0, 10))}</div></div></header><section class="box"><b>Settlement identity</b><div>Settlement: ${escape(snapshot.settlementId)}</div><div>Policy version: ${escape(snapshot.policyVersion)}</div><div>Currency: ${escape(snapshot.currency)}</div></section><section class="box"><h2>Customer collection reconciliation</h2><table><thead><tr><th>Line</th><th>Code</th><th>Direction</th><th>Amount</th><th>Explanation</th></tr></thead><tbody>${snapshot.collectionLines.map(row).join('')}</tbody></table><div class="total">Collected customer value: ${escape(money(snapshot.collectedCustomerValuePaise))}</div></section><section class="box"><h2>Refund allocation evidence</h2><table><thead><tr><th>Allocation</th><th>Responsibility</th><th>Amount</th><th>Reason</th></tr></thead><tbody>${snapshot.refundAllocations.length ? snapshot.refundAllocations.map(allocationRow).join('') : '<tr><td colspan="4">No refund allocation recorded</td></tr>'}</tbody></table></section><section class="box"><h2>Vendor settlement reconciliation</h2><table><thead><tr><th>Line</th><th>Code</th><th>Direction</th><th>Amount</th><th>Explanation</th></tr></thead><tbody>${snapshot.lines.map(row).join('')}</tbody></table><div class="total">Vendor settlement amount: ${escape(money(snapshot.vendorSettlementPaise))}</div></section><footer>This is an immutable marketplace reconciliation statement. It is not a customer tax invoice, commission invoice, payout confirmation, or provider settlement success record. External payment and payout evidence must be supplied by the authorized control plane/provider.</footer></main></body></html>`;
}
