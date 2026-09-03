import { randomUUID } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { moneyNumber } from '../../kernel/money.js';
import { store } from '../../kernel/store.js';
import type { EntityRow, GLEntry } from '../../kernel/types.js';

export type TdsCategory = 'CONTRACTOR' | 'COMMISSION' | 'RENT_EQUIPMENT' | 'RENT_PROPERTY' | 'PROFESSIONAL' | 'TECHNICAL' | 'GOODS_PURCHASE' | 'ECOMMERCE';
export type TdsPayeeType = 'INDIVIDUAL_HUF' | 'OTHER';
export type PanStatus = 'VALID' | 'MISSING' | 'INVALID' | 'INOPERATIVE' | 'UNKNOWN';
export type TcsCategory = 'GST_ECO_TCS' | 'INCOME_TAX_TCS';
export type StatutoryReturnType = 'TDS_138' | 'TDS_140' | 'TCS_143' | 'GSTR_8';
export type StatutoryReturnState = 'Prepared' | 'Validated' | 'Exported' | 'Submitted' | 'Acknowledged' | 'Accepted' | 'Rejected' | 'CorrectionRequired';
export type IncomeTaxTcsPolicyStatus = 'DRAFT' | 'APPROVED' | 'RETIRED';
export type IncomeTaxTcsPolicy = { id: string; policyKey: string; rateBps: number; effectiveFrom: string; effectiveUntil?: string; calculationBasis: string; sourceNote: string; status: IncomeTaxTcsPolicyStatus; version: string; approvedBy?: string; approvedAt?: string; createdAt: string; updatedAt: string };

type DateRange = { from: string; to: string };
type TdsCalculation = {
  applicable: boolean; amountPaise: number; rateBps: number; thresholdPaise?: number; policyKey: string;
  reason: string; basisPaise: number; higherRateApplied: boolean; status: 'CALCULATED' | 'NOT_APPLICABLE' | 'REVIEW_REQUIRED';
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INR_CRORE_PAISE = 1_000_000_000;
const INR_LAKH_PAISE = 5_000_000;
const TDS_POLICY_VERSION = 'ITA2025-IND-2026.1';
const GST_TCS_POLICY_VERSION = 'GST-ECO-2024.1';

const tdsPolicy: Record<TdsCategory, { policyKey: string; normalRateBps: number; higherRateBps: number; thresholdPaise?: number; legacyReference: string; rule: string }> = {
  CONTRACTOR: { policyKey: 'ITA2025_SECTION_393_CONTRACTOR', normalRateBps: 100, higherRateBps: 2000, thresholdPaise: 3_000_000, legacyReference: '194C', rule: 'Resident contractor: 1% for an individual/HUF payee and 2% for other resident payees; ₹30,000 single-payment and ₹1,00,000 annual aggregate thresholds are evaluated.' },
  COMMISSION: { policyKey: 'ITA2025_SECTION_393_COMMISSION', normalRateBps: 200, higherRateBps: 2000, thresholdPaise: 2_000_000, legacyReference: '194H', rule: 'Covered resident commission/brokerage; ₹20,000 annual threshold.' },
  RENT_EQUIPMENT: { policyKey: 'ITA2025_SECTION_393_RENT_EQUIPMENT', normalRateBps: 200, higherRateBps: 2000, thresholdPaise: 5_000_000, legacyReference: '194-I', rule: 'Covered plant, machinery or equipment rent; ₹50,000 monthly threshold.' },
  RENT_PROPERTY: { policyKey: 'ITA2025_SECTION_393_RENT_PROPERTY', normalRateBps: 1000, higherRateBps: 2000, thresholdPaise: 5_000_000, legacyReference: '194-I', rule: 'Covered land, building, furniture or fittings rent; ₹50,000 monthly threshold.' },
  PROFESSIONAL: { policyKey: 'ITA2025_SECTION_393_PROFESSIONAL', normalRateBps: 1000, higherRateBps: 2000, thresholdPaise: 5_000_000, legacyReference: '194J', rule: 'Covered professional services; ₹50,000 financial-year threshold.' },
  TECHNICAL: { policyKey: 'ITA2025_SECTION_393_TECHNICAL', normalRateBps: 200, higherRateBps: 2000, thresholdPaise: 5_000_000, legacyReference: '194J', rule: 'Covered technical services; ₹50,000 financial-year threshold.' },
  GOODS_PURCHASE: { policyKey: 'ITA2025_SECTION_393_GOODS_PURCHASE', normalRateBps: 10, higherRateBps: 500, thresholdPaise: INR_LAKH_PAISE, legacyReference: '194Q', rule: 'Buyer preceding-year business turnover above ₹10 crore and resident-seller purchases above ₹50 lakh; rate applies to the excess.' },
  ECOMMERCE: { policyKey: 'ITA2025_SECTION_393_ECOMMERCE', normalRateBps: 10, higherRateBps: 500, legacyReference: '194-O', rule: 'Covered gross e-commerce participant sales/services; small resident Individual/HUF exception requires explicit verified eligibility.' },
};

const text = (value: unknown, label: string, max = 200) => { const result = String(value ?? '').trim(); if (!result || result.length > max) throw new Error(`${label} is required`); return result; };
const isoDate = (value: unknown, label: string) => { const result = text(value, label, 10); if (!DATE.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new Error(`${label} is invalid`); return result; };
const paise = (value: unknown, label: string) => { const result = typeof value === 'number' ? value : Number(value); if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} must be a non-negative integer paise amount`); return result; };
const rowData = (row: EntityRow) => row.data as Record<string, any>;
const rows = (tenant: string, entity: string) => store.rowsOf(tenant, entity);
const inRange = (value: string, range: DateRange) => value >= range.from && value <= range.to;
const dateRange = (from?: string, to?: string): DateRange => { const end = to || new Date().toISOString().slice(0, 10); const start = from || `${end.slice(0, 8)}01`; const result = { from: isoDate(start, 'from'), to: isoDate(end, 'to') }; if (result.from > result.to) throw new Error('STATUTORY_DATE_RANGE_INVALID'); return result; };

function presentTcsPolicy(row: EntityRow): IncomeTaxTcsPolicy { const data = rowData(row); return { id: row.id, policyKey: String(data.policyKey), rateBps: paise(data.rateBps, 'TCS policy rate'), effectiveFrom: String(data.effectiveFrom), effectiveUntil: data.effectiveUntil ? String(data.effectiveUntil) : undefined, calculationBasis: String(data.calculationBasis), sourceNote: String(data.sourceNote), status: data.status as IncomeTaxTcsPolicyStatus, version: String(data.version), approvedBy: data.approvedBy ? String(data.approvedBy) : undefined, approvedAt: data.approvedAt ? String(data.approvedAt) : undefined, createdAt: String(data.createdAt || row.created_at), updatedAt: String(data.updatedAt || row.updated_at) }; }

export function listIncomeTaxTcsPolicies(tenant: string) { return rows(tenant, 'finance_income_tax_tcs_policy').map(presentTcsPolicy).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.updatedAt.localeCompare(a.updatedAt)); }

export function saveIncomeTaxTcsPolicy(tenant: string, actor: string, input: { policyKey: string; rateBps: number; effectiveFrom: string; effectiveUntil?: string; calculationBasis: string; sourceNote: string; status?: IncomeTaxTcsPolicyStatus; version: string }) {
  const policyKey = text(input.policyKey, 'policy key', 120); const effectiveFrom = isoDate(input.effectiveFrom, 'effective from'); const effectiveUntil = input.effectiveUntil ? isoDate(input.effectiveUntil, 'effective until') : undefined; if (effectiveUntil && effectiveUntil < effectiveFrom) throw new Error('TCS_POLICY_PERIOD_INVALID'); const rateBps = paise(input.rateBps, 'TCS policy rate'); if (rateBps > 10_000) throw new Error('TCS_POLICY_RATE_INVALID'); const calculationBasis = text(input.calculationBasis, 'calculation basis', 500); const sourceNote = text(input.sourceNote, 'source note', 1000); const status = input.status || 'DRAFT'; const version = text(input.version, 'policy version', 80); const existing = rows(tenant, 'finance_income_tax_tcs_policy').find((row) => rowData(row).policyKey === policyKey && rowData(row).version === version);
  const now = new Date().toISOString(); const approved = status === 'APPROVED' ? { approvedBy: actor, approvedAt: now } : {}; const record: IncomeTaxTcsPolicy = { id: existing?.id || `tcs_policy_${randomUUID()}`, policyKey, rateBps, effectiveFrom, effectiveUntil, calculationBasis, sourceNote, status, version, ...(existing ? { approvedBy: rowData(existing).approvedBy as string | undefined, approvedAt: rowData(existing).approvedAt as string | undefined } : {}), ...approved, createdAt: existing ? String(rowData(existing).createdAt || existing.created_at) : now, updatedAt: now };
  const row: EntityRow = existing ? { ...existing, version: existing.version + 1, updated_at: now, data: record } : { id: record.id, entity: 'finance_income_tax_tcs_policy', tenant, status: 'Active', version: 1, created_by: actor, created_at: now, updated_at: now, data: record }; if (existing) store.updateRow(row); else store.insertRow(row); audit(tenant, actor, existing ? 'finance:income-tax-tcs-policy-updated' : 'finance:income-tax-tcs-policy-created', { entity: row.entity, row_id: row.id, after: { policyKey, rateBps, effectiveFrom, effectiveUntil, status, version } }); return record;
}

function incomeTaxTcsPolicy(tenant: string, postingDate: string, policyKey?: string) { const policies = listIncomeTaxTcsPolicies(tenant).filter((policy) => policy.status === 'APPROVED' && policy.effectiveFrom <= postingDate && (!policy.effectiveUntil || policy.effectiveUntil >= postingDate) && (!policyKey || policy.policyKey === policyKey)); if (!policies.length) throw new Error('TCS_POLICY_NOT_CONFIGURED'); return policies[0]; }

function calculateIncomeTaxTcs(input: { taxableSupplyPaise: number; policy: IncomeTaxTcsPolicy }) { const taxable = paise(input.taxableSupplyPaise, 'income-tax TCS base'); const amountPaise = Math.floor(taxable * input.policy.rateBps / 10_000); return { category: 'INCOME_TAX_TCS' as const, taxableSupplyPaise: taxable, amountPaise, rateBps: input.policy.rateBps, policyKey: input.policy.policyKey, policyVersion: input.policy.version, policyStatus: input.policy.status, status: taxable ? 'CALCULATED' as const : 'NOT_APPLICABLE' as const, reason: input.policy.calculationBasis }; }

export function calculateConfiguredIncomeTaxTcs(tenant: string, input: { postingDate: string; taxableSupplyPaise: number; policyKey?: string }) {
  const postingDate = isoDate(input.postingDate, 'posting date');
  const policy = incomeTaxTcsPolicy(tenant, postingDate, input.policyKey);
  return calculateIncomeTaxTcs({ taxableSupplyPaise: input.taxableSupplyPaise, policy });
}

function gl(tenant: string, row: EntityRow, account: string, debitPaise: number, creditPaise: number): GLEntry {
  return { id: randomUUID(), tenant, posting_date: String(rowData(row).postingDate), voucher_type: row.entity, voucher: row.id, account, party: rowData(row).payeeName || rowData(row).sourceReference, debit: moneyNumber(debitPaise), credit: moneyNumber(creditPaise), created_at: new Date().toISOString() };
}

function appendLiabilityPosting(tenant: string, row: EntityRow, account: string, amountPaise: number, debitAccount: string) {
  if (!amountPaise) return;
  store.appendGL(gl(tenant, row, debitAccount, amountPaise, 0));
  store.appendGL(gl(tenant, row, account, 0, amountPaise));
}

export function calculateTds(input: { postingDate: string; category: TdsCategory; payeeType?: TdsPayeeType; basePaise: number; aggregatePaise?: number; panStatus?: PanStatus; buyerTurnoverPaise?: number; participantExemptionEligible?: boolean }): TdsCalculation {
  const category = input.category; const policy = tdsPolicy[category]; if (!policy) throw new Error('TDS_CATEGORY_INVALID');
  const base = paise(input.basePaise, 'TDS base'); const aggregate = paise(input.aggregatePaise ?? base, 'TDS aggregate');
  const buyerTurnover = paise(input.buyerTurnoverPaise ?? 0, 'buyer turnover'); const payeeType = input.payeeType || 'OTHER';
  if (!base) return { applicable: false, amountPaise: 0, rateBps: policy.normalRateBps, thresholdPaise: policy.thresholdPaise, policyKey: policy.policyKey, reason: 'No taxable base supplied.', basisPaise: 0, higherRateApplied: false, status: 'NOT_APPLICABLE' };
  if (category === 'CONTRACTOR' && base <= 3_000_000 && aggregate <= 10_000_000) return { applicable: false, amountPaise: 0, rateBps: payeeType === 'INDIVIDUAL_HUF' ? 100 : 200, thresholdPaise: 3_000_000, policyKey: policy.policyKey, reason: 'Contractor payment remains below both the single-payment and annual aggregate thresholds.', basisPaise: 0, higherRateApplied: false, status: 'NOT_APPLICABLE' };
  if (category !== 'CONTRACTOR' && category !== 'GOODS_PURCHASE' && category !== 'ECOMMERCE' && policy.thresholdPaise && aggregate <= policy.thresholdPaise) return { applicable: false, amountPaise: 0, rateBps: policy.normalRateBps, thresholdPaise: policy.thresholdPaise, policyKey: policy.policyKey, reason: 'Aggregate payment remains at or below the configured statutory threshold.', basisPaise: 0, higherRateApplied: false, status: 'NOT_APPLICABLE' };
  if (category === 'GOODS_PURCHASE' && buyerTurnover <= INR_CRORE_PAISE) return { applicable: false, amountPaise: 0, rateBps: policy.normalRateBps, thresholdPaise: INR_LAKH_PAISE, policyKey: policy.policyKey, reason: 'Buyer preceding-year turnover is not configured above the statutory eligibility threshold.', basisPaise: 0, higherRateApplied: false, status: 'REVIEW_REQUIRED' };
  if (category === 'GOODS_PURCHASE') { const basis = Math.max(0, aggregate - INR_LAKH_PAISE); const higher = input.panStatus === 'MISSING' || input.panStatus === 'INVALID' || input.panStatus === 'INOPERATIVE'; const rate = higher ? policy.higherRateBps : policy.normalRateBps; return { applicable: true, amountPaise: Math.floor(basis * rate / 10_000), rateBps: rate, thresholdPaise: INR_LAKH_PAISE, policyKey: policy.policyKey, reason: higher ? 'Purchase threshold met; higher PAN-related rate applied.' : 'Purchase threshold and buyer eligibility met.', basisPaise: basis, higherRateApplied: higher, status: 'CALCULATED' }; }
  if (category === 'ECOMMERCE' && input.participantExemptionEligible === true) return { applicable: false, amountPaise: 0, rateBps: policy.normalRateBps, policyKey: policy.policyKey, reason: 'Explicitly verified small resident Individual/HUF participant exception applied.', basisPaise: 0, higherRateApplied: false, status: 'NOT_APPLICABLE' };
  const higher = input.panStatus === 'MISSING' || input.panStatus === 'INVALID' || input.panStatus === 'INOPERATIVE'; const normalRate = category === 'CONTRACTOR' ? (payeeType === 'INDIVIDUAL_HUF' ? 100 : 200) : policy.normalRateBps; const rate = higher ? policy.higherRateBps : normalRate;
  return { applicable: true, amountPaise: Math.floor(base * rate / 10_000), rateBps: rate, thresholdPaise: policy.thresholdPaise, policyKey: policy.policyKey, reason: higher ? 'Applicable transaction with missing, invalid or inoperative PAN; higher rate applied.' : policy.rule, basisPaise: base, higherRateApplied: higher, status: 'CALCULATED' };
}

export function calculateGstEcoTcs(input: { taxableSupplyPaise: number; returnedSupplyPaise?: number; intraState: boolean }) {
  const gross = paise(input.taxableSupplyPaise, 'GST TCS taxable supply'); const returned = Math.min(gross, paise(input.returnedSupplyPaise ?? 0, 'GST TCS returned supply')); const net = gross - returned; const amountPaise = Math.floor(net * 50 / 10_000);
  return { category: 'GST_ECO_TCS' as const, grossSupplyPaise: gross, returnedSupplyPaise: returned, netSupplyPaise: net, amountPaise, rateBps: 50, intraState: input.intraState, policyKey: GST_TCS_POLICY_VERSION, status: net ? 'CALCULATED' as const : 'NOT_APPLICABLE' as const, reason: 'GST ECO TCS is calculated on net taxable supplies after statutory returned-supply treatment; intra-state components are 25 bps CGST plus 25 bps SGST.' };
}

export function recordTdsTransaction(tenant: string, actor: string, input: { sourceReference: string; postingDate: string; category: TdsCategory; payeeName?: string; payeeType?: TdsPayeeType; basePaise: number; aggregatePaise?: number; panStatus?: PanStatus; buyerTurnoverPaise?: number; participantExemptionEligible?: boolean; debitAccount?: string }) {
  const sourceReference = text(input.sourceReference, 'source reference'); const postingDate = isoDate(input.postingDate, 'posting date'); const existing = rows(tenant, 'finance_tds_transaction').find((row) => rowData(row).sourceReference === sourceReference);
  if (existing) return existing;
  const calculation = calculateTds({ ...input, postingDate }); const now = new Date().toISOString(); const row: EntityRow = { id: `tds_${randomUUID()}`, entity: 'finance_tds_transaction', tenant, status: 'Active', version: 1, created_by: actor, created_at: now, updated_at: now, amountPaise: calculation.amountPaise, amountDirection: 'CREDIT', amountCurrency: 'INR', data: { ...input, sourceReference, postingDate, category: input.category, payeeName: input.payeeName || '', payeeType: input.payeeType || 'OTHER', panStatus: input.panStatus || 'UNKNOWN', calculation, policyVersion: TDS_POLICY_VERSION, state: 'Posted', amountPaise: calculation.amountPaise, createdAt: now, createdBy: actor, immutable: true } };
  store.transaction(() => { store.insertRow(row); appendLiabilityPosting(tenant, row, 'TDS Payable (Liability)', calculation.amountPaise, input.debitAccount || 'Vendor Payable (Liability)'); }); audit(tenant, actor, 'finance:tds-transaction-posted', { entity: row.entity, row_id: row.id, after: { sourceReference, category: input.category, amountPaise: calculation.amountPaise, policyKey: calculation.policyKey } }); return row;
}

export function recordTcsTransaction(tenant: string, actor: string, input: { sourceReference: string; postingDate: string; category: TcsCategory; taxableSupplyPaise: number; returnedSupplyPaise?: number; intraState?: boolean; policyKey?: string; debitAccount?: string }) {
  const sourceReference = text(input.sourceReference, 'source reference'); const postingDate = isoDate(input.postingDate, 'posting date'); const existing = rows(tenant, 'finance_tcs_transaction').find((row) => rowData(row).sourceReference === sourceReference);
  if (existing) return existing;
  const calculation = input.category === 'GST_ECO_TCS'
    ? calculateGstEcoTcs({ taxableSupplyPaise: input.taxableSupplyPaise, returnedSupplyPaise: input.returnedSupplyPaise, intraState: input.intraState !== false })
    : calculateConfiguredIncomeTaxTcs(tenant, { postingDate, taxableSupplyPaise: input.taxableSupplyPaise, policyKey: input.policyKey });
  const policyVersion = input.category === 'INCOME_TAX_TCS' ? (calculation as { policyVersion: string }).policyVersion : GST_TCS_POLICY_VERSION;
  const now = new Date().toISOString(); const row: EntityRow = { id: `tcs_${randomUUID()}`, entity: 'finance_tcs_transaction', tenant, status: 'Active', version: 1, created_by: actor, created_at: now, updated_at: now, amountPaise: calculation.amountPaise, amountDirection: 'CREDIT', amountCurrency: 'INR', data: { ...input, sourceReference, postingDate, calculation, policyVersion, state: 'Posted', amountPaise: calculation.amountPaise, createdAt: now, createdBy: actor, immutable: true } };
  store.transaction(() => { store.insertRow(row); appendLiabilityPosting(tenant, row, 'TCS Payable (Liability)', calculation.amountPaise, input.debitAccount || 'Debtors (Assets)'); }); audit(tenant, actor, 'finance:tcs-transaction-posted', { entity: row.entity, row_id: row.id, after: { sourceReference, category: input.category, amountPaise: calculation.amountPaise, policyKey: calculation.policyKey } }); return row;
}

function periodEndFor(type: StatutoryReturnType, periodStart: string, periodEnd: string) {
  if (type === 'GSTR_8') { const next = new Date(`${periodEnd}T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1, 10); return next.toISOString().slice(0, 10); }
  const month = Number(periodEnd.slice(5, 7)); const year = Number(periodEnd.slice(0, 4)); if (month === 3) return `${year + 1}-05-31`; if (month === 6) return `${year}-07-31`; if (month === 9) return `${year}-10-31`; if (month === 12) return `${year + 1}-01-31`; return periodStart;
}

export function prepareStatutoryReturn(tenant: string, actor: string, input: { returnType: StatutoryReturnType; periodStart: string; periodEnd: string }) {
  const periodStart = isoDate(input.periodStart, 'period start'); const periodEnd = isoDate(input.periodEnd, 'period end'); if (periodStart > periodEnd) throw new Error('STATUTORY_PERIOD_INVALID');
  const existing = rows(tenant, 'finance_statutory_return').find((row) => rowData(row).returnType === input.returnType && rowData(row).periodStart === periodStart && rowData(row).periodEnd === periodEnd);
  if (existing) return existing;
  const sourceEntity = input.returnType === 'TDS_138' || input.returnType === 'TDS_140' ? 'finance_tds_transaction' : 'finance_tcs_transaction'; const transactions = rows(tenant, sourceEntity).filter((row) => inRange(String(rowData(row).postingDate), { from: periodStart, to: periodEnd })); const amountPaise = transactions.reduce((sum, row) => sum + paise(rowData(row).amountPaise, 'statutory transaction amount'), 0);
  const now = new Date().toISOString(); const row: EntityRow = { id: `return_${randomUUID()}`, entity: 'finance_statutory_return', tenant, status: 'Active', version: 1, created_by: actor, created_at: now, updated_at: now, data: { returnType: input.returnType, periodStart, periodEnd, dueDate: periodEndFor(input.returnType, periodStart, periodEnd), transactionCount: transactions.length, amountPaise, state: 'Prepared' as StatutoryReturnState, preparedAt: now, evidence: '', acknowledgement: '', policyVersion: input.returnType === 'GSTR_8' ? GST_TCS_POLICY_VERSION : TDS_POLICY_VERSION, immutableSnapshot: true } };
  store.insertRow(row); audit(tenant, actor, 'finance:statutory-return-prepared', { entity: row.entity, row_id: row.id, after: { returnType: input.returnType, periodStart, periodEnd, transactionCount: transactions.length, amountPaise } }); return row;
}

export function updateStatutoryReturn(tenant: string, actor: string, id: string, input: { state: StatutoryReturnState; evidence?: string; acknowledgement?: string }) {
  const row = store.getRow(tenant, id); if (!row || row.entity !== 'finance_statutory_return') throw new Error('STATUTORY_RETURN_NOT_FOUND'); const data = rowData(row); const state = input.state;
  if (['Submitted', 'Acknowledged', 'Accepted'].includes(state) && !String(input.evidence || '').trim()) throw new Error('STATUTORY_RETURN_EVIDENCE_REQUIRED');
  if (state === 'Accepted' && !String(input.acknowledgement || '').trim()) throw new Error('STATUTORY_RETURN_ACK_REQUIRED');
  row.version += 1; row.updated_at = new Date().toISOString(); data.state = state; data.evidence = String(input.evidence || data.evidence || ''); data.acknowledgement = String(input.acknowledgement || data.acknowledgement || ''); data.updatedBy = actor; store.updateRow(row); audit(tenant, actor, 'finance:statutory-return-state-updated', { entity: row.entity, row_id: row.id, after: { state, evidencePresent: Boolean(data.evidence), acknowledgementPresent: Boolean(data.acknowledgement) } }); return row;
}

export function statutoryDashboard(tenant: string, input: { from?: string; to?: string } = {}) {
  const range = dateRange(input.from, input.to); const tds = rows(tenant, 'finance_tds_transaction').filter((row) => inRange(String(rowData(row).postingDate), range)); const tcs = rows(tenant, 'finance_tcs_transaction').filter((row) => inRange(String(rowData(row).postingDate), range)); const sum = (list: EntityRow[]) => list.reduce((total, row) => total + paise(rowData(row).amountPaise, 'statutory amount'), 0);
  const tdsPaise = sum(tds); const tcsPaise = sum(tcs); const byPolicy = new Map<string, { policyKey: string; amountPaise: number; count: number }>(); for (const row of [...tds, ...tcs]) { const data = rowData(row); const policyKey = String(data.calculation?.policyKey || data.policyVersion); const bucket = byPolicy.get(policyKey) || { policyKey, amountPaise: 0, count: 0 }; bucket.amountPaise += paise(data.amountPaise, 'statutory amount'); bucket.count += 1; byPolicy.set(policyKey, bucket); }
  const returns: Array<Record<string, any>> = rows(tenant, 'finance_statutory_return').sort((a, b) => String(rowData(a).dueDate).localeCompare(String(rowData(b).dueDate))).map((row) => ({ id: row.id, ...rowData(row), amount: moneyNumber(paise(rowData(row).amountPaise, 'return amount')) })); const openReturns = returns.filter((item) => !['Accepted', 'Acknowledged'].includes(String(item.state))).length;
  return { range, liabilities: { tdsPaise, tds: moneyNumber(tdsPaise), tcsPaise, tcs: moneyNumber(tcsPaise), totalPaise: tdsPaise + tcsPaise, total: moneyNumber(tdsPaise + tcsPaise) }, transactions: { tdsCount: tds.length, tcsCount: tcs.length, byPolicy: [...byPolicy.values()].map((item) => ({ ...item, amount: moneyNumber(item.amountPaise) })).sort((a, b) => b.amountPaise - a.amountPaise) }, returns, openReturns, evidenceState: returns.some((item) => ['Submitted', 'Acknowledged', 'Accepted'].includes(String(item.state)) && !String(item.evidence || '').trim()) ? 'EVIDENCE_ERROR' : 'CONTROLLED' };
}

export function listStatutoryTransactions(tenant: string, input: { from?: string; to?: string } = {}) { const range = dateRange(input.from, input.to); return [...rows(tenant, 'finance_tds_transaction'), ...rows(tenant, 'finance_tcs_transaction')].filter((row) => inRange(String(rowData(row).postingDate), range)).sort((a, b) => String(rowData(b).postingDate).localeCompare(String(rowData(a).postingDate))).map((row) => ({ id: row.id, entity: row.entity, ...rowData(row), amount: moneyNumber(paise(rowData(row).amountPaise, 'statutory amount')) })); }
