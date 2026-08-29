import { audit } from '../../kernel/audit.js';
import { parseMoney } from '../../kernel/money.js';
import { store, type CashShiftCloseRecord, type CustomerLedgerRecord, type FinancialDocumentRecord, type FinancialEntryRecord, type WalletEntryRecord } from '../../kernel/store.js';
import { randomUUID } from 'node:crypto';
import { listCashShifts } from '../laundry/cash.js';
import { laundryFinancialReconciliation } from '../laundry/reconciliation.js';

type Candidate = { document: FinancialDocumentRecord; entry?: FinancialEntryRecord; source?: import('../../kernel/types.js').EntityRow };
type LedgerCandidate = { entry: CustomerLedgerRecord; source: import('../../kernel/types.js').EntityRow };
type CashCloseCandidate = { close: CashShiftCloseRecord; source: import('../../kernel/types.js').EntityRow };
type WalletCandidate = { entry: WalletEntryRecord; source: import('../../kernel/types.js').EntityRow };
type NormalizationIssue = { sourceEntity: string; sourceId: string; message: string };

function amount(value: unknown, label: string) { return parseMoney(value ?? 0, label, { allowZero: true }); }
function sourceCandidate(tenant: string, actor: string, documentType: string, sourceEntity: string, sourceId: string, rawAmount: unknown, status: string, occurredAt: string, metadata: Record<string, unknown>, entry?: Omit<FinancialEntryRecord, 'tenant' | 'storeId' | 'actor' | 'amountPaise'>): Candidate {
  const amountPaise = amount(rawAmount, `${documentType} ${sourceId}`);
  const storeId = store.currentStore(tenant);
  const document: FinancialDocumentRecord = { id: `doc:${sourceId}${documentType === 'refund' ? ':refund' : ''}`, tenant, storeId, documentType, sourceEntity, sourceId, amountPaise, currency: 'INR', status, occurredAt, actor, metadata };
  return { document, entry: entry ? { ...entry, tenant, storeId, actor, amountPaise } : undefined };
}

function candidatesFor(tenant: string, actor: string) {
  const candidates: Candidate[] = [];
  const issues: NormalizationIssue[] = [];
  const push = (work: () => Candidate, sourceEntity: string, sourceId: string, source?: import('../../kernel/types.js').EntityRow) => { try { candidates.push({ ...work(), source }); } catch (error: any) { issues.push({ sourceEntity, sourceId, message: error.message }); } };
  for (const invoice of store.rowsOf(tenant, 'sales_invoice').filter((row) => ['Submitted', 'Cancelled'].includes(row.status))) {
    push(() => sourceCandidate(tenant, actor, 'invoice', invoice.entity, invoice.id, invoice.data.grand_total, invoice.status, invoice.updated_at, {}), invoice.entity, invoice.id, invoice);
  }
  for (const payment of store.rowsOf(tenant, 'payment_entry').filter((row) => row.data.payment_type === 'Receive' && ['Submitted', 'Cancelled'].includes(row.status))) {
    const mode = String(payment.data.mode || 'Cash');
    push(() => sourceCandidate(tenant, actor, 'payment', payment.entity, payment.id, payment.data.amount, payment.status, payment.updated_at, { mode, invoiceId: String(payment.data.against_sales || '') }, { id: `money:${payment.id}:collection`, kind: 'collection', sourceEntity: payment.entity, sourceId: payment.id, direction: 'IN', currency: 'INR', occurredAt: payment.created_at, metadata: { mode, invoiceId: String(payment.data.against_sales || '') } }), payment.entity, payment.id, payment);
    if (payment.status === 'Cancelled' && payment.data.provider_status === 'Reversed') {
      push(() => sourceCandidate(tenant, actor, 'refund', payment.entity, payment.id, payment.data.amount, 'Posted', payment.updated_at, { mode, invoiceId: String(payment.data.against_sales || '') }, { id: `money:${payment.id}:refund`, kind: 'refund', sourceEntity: payment.entity, sourceId: payment.id, direction: 'OUT', currency: 'INR', occurredAt: payment.updated_at, metadata: { mode, invoiceId: String(payment.data.against_sales || '') } }), payment.entity, payment.id, payment);
    }
  }
  for (const expense of store.rowsOf(tenant, 'laundry_expense').filter((row) => ['Paid', 'Cancelled'].includes(row.status))) {
    push(() => sourceCandidate(tenant, actor, 'expense', expense.entity, expense.id, expense.data.amount, expense.status, expense.updated_at, { paymentMode: String(expense.data.payment_mode || 'Cash') }, { id: `money:${expense.id}:expense`, kind: 'expense', sourceEntity: expense.entity, sourceId: expense.id, direction: 'OUT', currency: 'INR', occurredAt: expense.updated_at, metadata: { paymentMode: String(expense.data.payment_mode || 'Cash') } }), expense.entity, expense.id, expense);
  }
  for (const pkg of store.rowsOf(tenant, 'customer_package').filter((row) => String(row.data.payment_mode || '') !== 'Pay Later' && Number(row.data.price_paid || 0) > 0)) {
    push(() => sourceCandidate(tenant, actor, 'package-payment', pkg.entity, pkg.id, pkg.data.price_paid, pkg.status, pkg.updated_at, { paymentMode: String(pkg.data.payment_mode || '') }, { id: `money:${pkg.id}:package-payment`, kind: 'package-payment', sourceEntity: pkg.entity, sourceId: pkg.id, direction: 'IN', currency: 'INR', occurredAt: pkg.created_at, metadata: { paymentMode: String(pkg.data.payment_mode || '') } }), pkg.entity, pkg.id, pkg);
  }
  for (const payment of store.rowsOf(tenant, 'customer_package_payment').filter((row) => row.status !== 'Cancelled')) {
    push(() => sourceCandidate(tenant, actor, 'package-payment', payment.entity, payment.id, payment.data.amount, payment.status, payment.updated_at, { paymentMode: String(payment.data.mode || ''), customerPackageId: String(payment.data.customer_package || '') }, { id: `money:${payment.id}:package-payment`, kind: 'package-payment', sourceEntity: payment.entity, sourceId: payment.id, direction: 'IN', currency: 'INR', occurredAt: payment.created_at, metadata: { paymentMode: String(payment.data.mode || ''), customerPackageId: String(payment.data.customer_package || '') } }), payment.entity, payment.id, payment);
  }
  for (const wallet of store.rowsOf(tenant, 'laundry_wallet_entry').filter((row) => row.status !== 'Cancelled')) {
    push(() => sourceCandidate(tenant, actor, 'wallet', wallet.entity, wallet.id, wallet.data.amount, wallet.status, wallet.updated_at, { customerId: String(wallet.data.customer || ''), type: String(wallet.data.entry_type || '') }), wallet.entity, wallet.id, wallet);
  }
  return { candidates, issues };
}

function ledgerCandidatesFor(tenant: string, actor: string) {
  const candidates: LedgerCandidate[] = [];
  const issues: NormalizationIssue[] = [];
  for (const source of store.rowsOf(tenant, 'laundry_customer_ledger').filter((row) => row.status !== 'Cancelled')) {
    try {
      const debitPaise = amount(source.data.debit, `customer ledger debit ${source.id}`);
      const creditPaise = amount(source.data.credit, `customer ledger credit ${source.id}`);
      if ((debitPaise === 0) === (creditPaise === 0)) throw new Error('customer ledger row must contain exactly one debit or credit amount');
      const customerId = String(source.data.customer || '').trim();
      if (!customerId) throw new Error('customer ledger row has no customer');
      candidates.push({ source, entry: { id: source.id, tenant, storeId: store.currentStore(tenant), customerId, entryType: String(source.data.entry_type || 'Adjustment'), debitPaise, creditPaise, entryDate: String(source.data.entry_date || source.created_at).slice(0, 20), referenceType: String(source.data.reference_type || ''), referenceId: String(source.data.reference_id || ''), reason: String(source.data.reason || ''), actor, createdAt: source.created_at } });
    } catch (error: any) { issues.push({ sourceEntity: source.entity, sourceId: source.id, message: error.message }); }
  }
  return { candidates, issues };
}

function walletCandidatesFor(tenant: string, actor: string) {
  const candidates: WalletCandidate[] = [];
  const issues: NormalizationIssue[] = [];
  for (const source of store.rowsOf(tenant, 'laundry_wallet_entry').filter((row) => row.status !== 'Cancelled')) {
    try {
      const customerId = String(source.data.customer || '').trim();
      if (!customerId) throw new Error('wallet row has no customer');
      const entryType = String(source.data.entry_type || '').trim();
      if (!['Credit', 'Debit', 'Refund', 'Adjustment'].includes(entryType)) throw new Error(`wallet row has unsupported entry type '${entryType || 'missing'}'`);
      const amountPaise = amount(source.data.amount, `wallet ${source.id}`);
      if (amountPaise <= 0) throw new Error('wallet row amount must be greater than zero');
      candidates.push({ source, entry: { id: source.id, tenant, storeId: store.currentStore(tenant), customerId, entryType, amountPaise, entryDate: String(source.data.entry_date || source.created_at).slice(0, 20), referenceType: String(source.data.reference_type || ''), referenceId: String(source.data.reference_id || ''), reason: String(source.data.reason || ''), actor, createdAt: source.created_at } });
    } catch (error: any) { issues.push({ sourceEntity: source.entity, sourceId: source.id, message: error.message }); }
  }
  return { candidates, issues };
}

function cashCloseCandidatesFor(tenant: string) {
  const candidates: CashCloseCandidate[] = [];
  const issues: NormalizationIssue[] = [];
  const views = listCashShifts(tenant);
  for (const source of store.rowsOf(tenant, 'laundry_cash_shift').filter((row) => row.status === 'Closed')) {
    try {
      const view = views.find((candidate) => candidate?.id === source.id);
      if (!view || view.countedCash === null || view.expectedCash === null) throw new Error('closed cash shift has incomplete counted or expected cash');
      const toPaise = (value: unknown, label: string) => amount(value, `${label} ${source.id}`);
      const movementCounts = view.movementCounts || { collections: 0, expenses: 0, refunds: 0 };
      candidates.push({ source, close: {
        id: `cash-close:${source.id}`, tenant, storeId: store.currentStore(tenant), shiftId: source.id,
        register: String(view.register || 'Main counter'), businessDate: String(view.businessDate || source.created_at).slice(0, 10),
        openingCashPaise: toPaise(view.openingCash, 'opening cash'), collectionsPaise: toPaise(view.collections, 'collections'), expensesPaise: toPaise(view.expenses, 'expenses'), refundsPaise: toPaise(view.refunds, 'refunds'),
        expectedCashPaise: toPaise(view.expectedCash, 'expected cash'), countedCashPaise: toPaise(view.countedCash, 'counted cash'), variancePaise: parseMoney(view.variance || 0, `variance ${source.id}`, { allowZero: true, allowNegative: true }),
        collectionCount: Number(movementCounts.collections || 0), expenseCount: Number(movementCounts.expenses || 0), refundCount: Number(movementCounts.refunds || 0),
        closedAt: String(view.closedAt || source.updated_at), closedBy: String(view.closedBy || source.created_by), supervisorActor: view.varianceApprovedBy ? String(view.varianceApprovedBy) : undefined, note: String(view.closeNote || ''),
      } });
    } catch (error: any) { issues.push({ sourceEntity: source.entity, sourceId: source.id, message: error.message }); }
  }
  return { candidates, issues };
}

function conflictsFor(tenant: string, candidates: Candidate[], ledgerCandidates: LedgerCandidate[], cashCloseCandidates: CashCloseCandidate[] = [], walletCandidates: WalletCandidate[] = []) {
  const documents = new Map(store.listFinancialDocuments(tenant).map((document) => [`${document.documentType}:${document.sourceEntity}:${document.sourceId}`, document]));
  const entries = new Map(store.listFinancialEntries(tenant).map((entry) => [`${entry.kind}:${entry.sourceEntity}:${entry.sourceId}`, entry]));
  const conflicts: NormalizationIssue[] = [];
  for (const candidate of candidates) {
    const documentKey = `${candidate.document.documentType}:${candidate.document.sourceEntity}:${candidate.document.sourceId}`;
    const existingDocument = documents.get(documentKey);
    if (existingDocument && (existingDocument.amountPaise !== candidate.document.amountPaise || existingDocument.currency !== candidate.document.currency)) {
      conflicts.push({ sourceEntity: candidate.document.sourceEntity, sourceId: candidate.document.sourceId, message: `normalized ${candidate.document.documentType} mirror disagrees with source amount/currency` });
    }
    if (candidate.entry) {
      const entryKey = `${candidate.entry.kind}:${candidate.entry.sourceEntity}:${candidate.entry.sourceId}`;
      const existingEntry = entries.get(entryKey);
      if (existingEntry && (existingEntry.amountPaise !== candidate.entry.amountPaise || existingEntry.direction !== candidate.entry.direction || existingEntry.currency !== candidate.entry.currency)) {
        conflicts.push({ sourceEntity: candidate.entry.sourceEntity, sourceId: candidate.entry.sourceId, message: `normalized ${candidate.entry.kind} entry disagrees with source amount/direction/currency` });
      }
    }
    if (candidate.source?.amountPaise !== undefined && candidate.source.amountPaise !== candidate.document.amountPaise) {
      conflicts.push({ sourceEntity: candidate.source.entity, sourceId: candidate.source.id, message: `constrained source column disagrees with normalized amount` });
    }
  }
  const ledgers = new Map(store.listCustomerLedgerEntries(tenant).map((entry) => [entry.id, entry]));
  for (const candidate of ledgerCandidates) {
    const existing = ledgers.get(candidate.entry.id);
    if (existing && (existing.debitPaise !== candidate.entry.debitPaise || existing.creditPaise !== candidate.entry.creditPaise || existing.customerId !== candidate.entry.customerId || existing.referenceId !== candidate.entry.referenceId)) {
      conflicts.push({ sourceEntity: candidate.source.entity, sourceId: candidate.source.id, message: 'normalized customer ledger entry disagrees with source amount or reference' });
    }
    if (candidate.source.amountPaise !== undefined && candidate.source.amountPaise !== Math.max(candidate.entry.debitPaise, candidate.entry.creditPaise)) {
      conflicts.push({ sourceEntity: candidate.source.entity, sourceId: candidate.source.id, message: 'constrained customer ledger amount disagrees with normalized amount' });
    }
  }
  const cashCloses = new Map(store.listCashShiftCloses(tenant).map((close) => [close.shiftId, close]));
  const cashFields: Array<keyof CashShiftCloseRecord> = ['register', 'businessDate', 'openingCashPaise', 'collectionsPaise', 'expensesPaise', 'refundsPaise', 'expectedCashPaise', 'countedCashPaise', 'variancePaise', 'collectionCount', 'expenseCount', 'refundCount', 'closedAt', 'closedBy', 'supervisorActor', 'note'];
  for (const candidate of cashCloseCandidates) {
    const existing = cashCloses.get(candidate.close.shiftId);
    if (existing && cashFields.some((field) => existing[field] !== candidate.close[field])) conflicts.push({ sourceEntity: candidate.source.entity, sourceId: candidate.source.id, message: 'normalized cash close disagrees with the closed shift snapshot' });
  }
  const wallets = new Map(store.listWalletEntries(tenant).map((entry) => [entry.id, entry]));
  for (const candidate of walletCandidates) {
    const existing = wallets.get(candidate.entry.id);
    if (existing && (existing.customerId !== candidate.entry.customerId || existing.amountPaise !== candidate.entry.amountPaise || existing.entryType !== candidate.entry.entryType || existing.entryDate !== candidate.entry.entryDate || existing.referenceId !== candidate.entry.referenceId)) {
      conflicts.push({ sourceEntity: candidate.source.entity, sourceId: candidate.source.id, message: 'normalized wallet entry disagrees with source amount, customer or reference' });
    }
    if (candidate.source.amountPaise !== undefined && candidate.source.amountPaise !== candidate.entry.amountPaise) conflicts.push({ sourceEntity: candidate.source.entity, sourceId: candidate.source.id, message: 'constrained wallet amount disagrees with normalized amount' });
  }
  return conflicts;
}

export function previewFinancialNormalization(tenant: string) {
  const { candidates, issues } = candidatesFor(tenant, 'migration-preview');
  const ledgerResult = ledgerCandidatesFor(tenant, 'migration-preview');
  const cashCloseResult = cashCloseCandidatesFor(tenant);
  const walletResult = walletCandidatesFor(tenant, 'migration-preview');
  const allIssues = [...issues, ...ledgerResult.issues, ...cashCloseResult.issues, ...walletResult.issues];
  const existingDocuments = new Set(store.listFinancialDocuments(tenant).map((document) => `${document.documentType}:${document.sourceEntity}:${document.sourceId}`));
  const existingEntries = new Set(store.listFinancialEntries(tenant).map((entry) => `${entry.kind}:${entry.sourceEntity}:${entry.sourceId}`));
  const missingDocuments = candidates.filter(({ document }) => !existingDocuments.has(`${document.documentType}:${document.sourceEntity}:${document.sourceId}`));
  const missingEntries = candidates.filter(({ entry }) => entry && !existingEntries.has(`${entry.kind}:${entry.sourceEntity}:${entry.sourceId}`));
  const existingLedgers = new Set(store.listCustomerLedgerEntries(tenant).map((entry) => entry.id));
  const missingLedgerEntries = ledgerResult.candidates.filter(({ entry }) => !existingLedgers.has(entry.id));
  const existingCashCloses = new Set(store.listCashShiftCloses(tenant).map((close) => close.shiftId));
  const missingCashCloseSnapshots = cashCloseResult.candidates.filter(({ close }) => !existingCashCloses.has(close.shiftId));
  const existingWallets = new Set(store.listWalletEntries(tenant).map((entry) => entry.id));
  const missingWalletEntries = walletResult.candidates.filter(({ entry }) => !existingWallets.has(entry.id));
  const sourceIds = new Set([...candidates.filter(({ source }) => source && source.amountPaise === undefined).map(({ source }) => `${source!.entity}:${source!.id}`), ...ledgerResult.candidates.filter(({ source }) => source.amountPaise === undefined).map(({ source }) => `${source.entity}:${source.id}`), ...walletResult.candidates.filter(({ source }) => source.amountPaise === undefined).map(({ source }) => `${source.entity}:${source.id}`)]);
  const conflicts = conflictsFor(tenant, candidates, ledgerResult.candidates, cashCloseResult.candidates, walletResult.candidates);
  const latestCertifiedRun = store.listFinancialNormalizationRuns(tenant, 1)[0];
  return { candidates: candidates.length, ledgerCandidates: ledgerResult.candidates.length, walletCandidates: walletResult.candidates.length, cashCloseCandidates: cashCloseResult.candidates.length, missingDocuments: missingDocuments.length, missingEntries: missingEntries.length, missingLedgerEntries: missingLedgerEntries.length, missingWalletEntries: missingWalletEntries.length, missingCashCloseSnapshots: missingCashCloseSnapshots.length, missingSourceColumns: sourceIds.size, invalid: allIssues.length, conflicts: conflicts.length, issues: allIssues, conflictDetails: conflicts.slice(0, 200), documentIds: missingDocuments.slice(0, 200).map(({ document }) => document.id), entryIds: missingEntries.slice(0, 200).map(({ entry }) => entry!.id), ledgerEntryIds: missingLedgerEntries.slice(0, 200).map(({ entry }) => entry.id), walletEntryIds: missingWalletEntries.slice(0, 200).map(({ entry }) => entry.id), cashCloseIds: missingCashCloseSnapshots.slice(0, 200).map(({ close }) => close.id), latestCertifiedRun };
}

export function applyFinancialNormalization(tenant: string, actor: string) {
  return store.transaction(() => {
    const { candidates, issues } = candidatesFor(tenant, actor);
    const ledgerResult = ledgerCandidatesFor(tenant, actor);
    const cashCloseResult = cashCloseCandidatesFor(tenant);
    const walletResult = walletCandidatesFor(tenant, actor);
    const allIssues = [...issues, ...ledgerResult.issues, ...cashCloseResult.issues, ...walletResult.issues];
    if (allIssues.length) throw new Error(`financial normalization found ${allIssues.length} invalid source amount(s); no records were written`);
    const conflicts = conflictsFor(tenant, candidates, ledgerResult.candidates, cashCloseResult.candidates, walletResult.candidates);
    if (conflicts.length) throw new Error(`financial normalization found ${conflicts.length} source/mirror conflict(s); resolve them before applying`);
    const existingDocuments = new Set(store.listFinancialDocuments(tenant).map((document) => `${document.documentType}:${document.sourceEntity}:${document.sourceId}`));
    const existingEntries = new Set(store.listFinancialEntries(tenant).map((entry) => `${entry.kind}:${entry.sourceEntity}:${entry.sourceId}`));
    const existingLedgers = new Set(store.listCustomerLedgerEntries(tenant).map((entry) => entry.id));
    const existingCashCloses = new Set(store.listCashShiftCloses(tenant).map((close) => close.shiftId));
    const existingWallets = new Set(store.listWalletEntries(tenant).map((entry) => entry.id));
    let documentsApplied = 0; let entriesApplied = 0; let ledgerEntriesApplied = 0; let walletEntriesApplied = 0; let cashCloseSnapshotsApplied = 0; let sourceColumnsApplied = 0;
    for (const candidate of candidates) {
      const documentKey = `${candidate.document.documentType}:${candidate.document.sourceEntity}:${candidate.document.sourceId}`;
      if (!existingDocuments.has(documentKey)) { store.appendFinancialDocument({ ...candidate.document, actor }); documentsApplied += 1; }
      if (candidate.entry) {
        const entryKey = `${candidate.entry.kind}:${candidate.entry.sourceEntity}:${candidate.entry.sourceId}`;
        if (!existingEntries.has(entryKey)) { store.appendFinancialEntry({ ...candidate.entry, actor }); entriesApplied += 1; }
      }
      if (candidate.source && candidate.source.amountPaise === undefined) {
        candidate.source.amountPaise = candidate.document.amountPaise;
        candidate.source.amountCurrency = candidate.document.currency;
        store.updateRow(candidate.source);
        sourceColumnsApplied += 1;
      }
    }
    for (const candidate of ledgerResult.candidates) {
      if (!existingLedgers.has(candidate.entry.id)) { store.appendCustomerLedgerEntry(candidate.entry); ledgerEntriesApplied += 1; }
      if (candidate.source.amountPaise === undefined) { candidate.source.amountPaise = Math.max(candidate.entry.debitPaise, candidate.entry.creditPaise); candidate.source.amountDirection = candidate.entry.debitPaise > 0 ? 'DEBIT' : 'CREDIT'; candidate.source.amountCurrency = 'INR'; store.updateRow(candidate.source); sourceColumnsApplied += 1; }
    }
    for (const candidate of walletResult.candidates) {
      if (!existingWallets.has(candidate.entry.id)) { store.appendWalletEntry(candidate.entry); walletEntriesApplied += 1; }
      if (candidate.source.amountPaise === undefined) { candidate.source.amountPaise = candidate.entry.amountPaise; candidate.source.amountDirection = candidate.entry.entryType === 'Debit' ? 'DEBIT' : 'CREDIT'; candidate.source.amountCurrency = 'INR'; store.updateRow(candidate.source); sourceColumnsApplied += 1; }
    }
    for (const candidate of cashCloseResult.candidates) {
      if (!existingCashCloses.has(candidate.close.shiftId)) { store.appendCashShiftClose(candidate.close); cashCloseSnapshotsApplied += 1; }
    }
    // Treat the normalization as certified only when the read-only financial
    // control report is clean after the transaction's writes. Throwing here
    // rolls back the entire backfill instead of leaving a partially trusted
    // mirror set for operators to discover later.
    const reconciliation = laundryFinancialReconciliation(tenant);
    if (reconciliation.status !== 'Reconciled') throw new Error(`financial normalization could not certify reconciliation (${reconciliation.checks.issueCount} issue(s))`);
    const run = store.appendFinancialNormalizationRun({ id: `norm:${randomUUID()}`, tenant, storeId: store.currentStore(tenant), actor, status: 'certified', candidates: candidates.length, ledgerCandidates: ledgerResult.candidates.length, walletEntriesApplied, cashCloseCandidates: cashCloseResult.candidates.length, documentsApplied, entriesApplied, ledgerEntriesApplied, cashCloseSnapshotsApplied, sourceColumnsApplied, reconciliationStatus: reconciliation.status, reconciliationIssueCount: reconciliation.checks.issueCount, createdAt: new Date().toISOString() });
    audit(tenant, actor, 'ops:financial-normalization', { after: { runId: run.id, candidates: candidates.length, ledgerCandidates: ledgerResult.candidates.length, walletCandidates: walletResult.candidates.length, cashCloseCandidates: cashCloseResult.candidates.length, documentsApplied, entriesApplied, ledgerEntriesApplied, walletEntriesApplied, cashCloseSnapshotsApplied, sourceColumnsApplied, invalid: allIssues.length, reconciliation: { status: reconciliation.status, issueCount: reconciliation.checks.issueCount } } });
    return { candidates: candidates.length, ledgerCandidates: ledgerResult.candidates.length, walletCandidates: walletResult.candidates.length, cashCloseCandidates: cashCloseResult.candidates.length, documentsApplied, entriesApplied, ledgerEntriesApplied, walletEntriesApplied, cashCloseSnapshotsApplied, sourceColumnsApplied, invalid: allIssues.length, conflicts: conflicts.length, certified: true, runId: run.id, reconciliation: { status: reconciliation.status, issueCount: reconciliation.checks.issueCount }, issues: allIssues, conflictDetails: conflicts.slice(0, 200) };
  });
}
