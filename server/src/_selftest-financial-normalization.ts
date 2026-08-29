import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-financial-normalization-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json');
process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
process.env.EPIC_LEGACY_JSON_FILE = join(tempDir, 'legacy.json');
let closeStore: (() => void) | undefined;

try {
  const { store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const { bookLaundryOrder, laundryCatalogue, seedLaundryDefaults } = await import('./modules/laundry/domain.js');
  const { applyWalletCommand } = await import('./modules/laundry/customers.js');
  const { openCashShift, closeCashShift, getCurrentCashShift } = await import('./modules/laundry/cash.js');
  const { applyFinancialNormalization, previewFinancialNormalization } = await import('./modules/ops/financial-normalization.js');
  const { laundryFinancialReconciliation } = await import('./modules/laundry/reconciliation.js');
  const tenant = 'FIN-NORMALIZE';
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => seedLaundryDefaults(tenant));
  const catalogue = store.withStoreScope(tenant, 'STORE-DEFAULT', () => laundryCatalogue(tenant));
  const garment = catalogue.garments[0];
  const service = catalogue.services.find((candidate: any) => catalogue.prices.some((price: any) => price.garment === garment.id && price.service === candidate.id))!;
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => openCashShift(tenant, 'normalization-owner', { openingCash: '100.00', register: 'Main counter' }));
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => bookLaundryOrder(tenant, 'normalization-owner', { customer: { name: 'Normalization Customer', phone: '9000000123' }, items: [{ garment: garment.id, service: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-08', fulfillmentMode: 'Home Delivery', paymentMode: 'Cash' }));
  const customerId = store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.rowsOf(tenant, 'party').find((row) => row.data.phone === '9000000123')!.id);
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyWalletCommand(tenant, 'normalization-owner', customerId, { type: 'Credit', amount: '25.00', reason: 'Normalization wallet fixture' }));
  const currentShift = store.withStoreScope(tenant, 'STORE-DEFAULT', () => getCurrentCashShift(tenant))!;
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => closeCashShift(tenant, 'normalization-owner', { countedCash: currentShift.expectedCash, note: 'Normalization fixture close' }));
  store.withStoreScope(tenant, 'STORE-DEFAULT', () => {
    const snapshot = store.snapshotFor(tenant, 'STORE-DEFAULT');
    snapshot.financialDocuments = [];
    snapshot.financialEntries = [];
    snapshot.customerLedgerEntries = [];
    snapshot.walletEntries = [];
    snapshot.cashShiftCloses = [];
    store.replaceScoped(tenant, 'STORE-DEFAULT', snapshot);
  });
  // Simulate an older installation whose compatibility JSON exists but v9
  // source columns have not yet been populated.
  const legacyDb = new Database(join(tempDir, 'epic.sqlite'));
  legacyDb.prepare('UPDATE entity_rows SET amount_paise = NULL WHERE tenant = ? AND store_id = ? AND entity IN (?, ?, ?, ?, ?, ?)').run(tenant, 'STORE-DEFAULT', 'sales_invoice', 'payment_entry', 'laundry_expense', 'customer_package', 'laundry_wallet_entry', 'laundry_customer_ledger');
  legacyDb.close();
  const preview = store.withStoreScope(tenant, 'STORE-DEFAULT', () => previewFinancialNormalization(tenant));
  assert.equal(preview.invalid, 0, 'valid legacy amounts are accepted by the normalization preview');
  assert.equal(preview.missingDocuments >= 2, true, 'preview identifies missing invoice and payment mirrors');
  assert.equal(preview.missingEntries >= 1, true, 'preview identifies the missing collection journal entry');
  assert.equal(preview.missingLedgerEntries >= 1, true, 'preview identifies missing normalized customer ledger entries');
  assert.equal(preview.missingWalletEntries >= 1, true, 'preview identifies missing normalized wallet entries');
  assert.equal(preview.missingCashCloseSnapshots, 1, 'preview identifies missing normalized cash-close snapshots');
  assert.equal(preview.missingSourceColumns >= 2, true, 'preview identifies missing constrained source columns');
  const applied = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyFinancialNormalization(tenant, 'normalization-owner'));
  assert.equal(applied.documentsApplied, preview.missingDocuments, 'apply writes every missing document exactly once');
  assert.equal(applied.entriesApplied, preview.missingEntries, 'apply writes every missing journal entry exactly once');
  assert.equal(applied.ledgerEntriesApplied, preview.missingLedgerEntries, 'apply writes every missing customer ledger entry exactly once');
  assert.equal(applied.walletEntriesApplied, preview.missingWalletEntries, 'apply writes every missing normalized wallet entry exactly once');
  assert.equal(applied.cashCloseSnapshotsApplied, 1, 'apply writes missing normalized cash-close snapshots exactly once');
  assert.equal(applied.sourceColumnsApplied >= 2, true, 'apply backfills constrained source columns atomically');
  assert.equal(applied.certified, true, 'apply certifies a clean financial reconciliation before committing');
  assert.match(applied.runId, /^norm:/, 'apply returns a durable normalization evidence run id');
  const firstEvidence = store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listFinancialNormalizationRuns(tenant));
  assert.equal(firstEvidence.length, 1, 'certified normalization evidence is persisted once');
  assert.equal(firstEvidence[0].reconciliationStatus, 'Reconciled', 'persisted normalization evidence carries the reconciliation certificate');
  assert.equal(laundryFinancialReconciliation(tenant).status, 'Reconciled', 'post-normalization financial control report is reconciled');
  const second = store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyFinancialNormalization(tenant, 'normalization-owner'));
  assert.equal(second.documentsApplied, 0, 'second normalization pass is idempotent for documents');
  assert.equal(second.entriesApplied, 0, 'second normalization pass is idempotent for journal entries');
  assert.equal(second.ledgerEntriesApplied, 0, 'second normalization pass is idempotent for customer ledger entries');
  assert.equal(second.walletEntriesApplied, 0, 'second normalization pass is idempotent for wallet entries');
  assert.equal(second.cashCloseSnapshotsApplied, 0, 'second normalization pass is idempotent for cash-close snapshots');
  assert.equal(second.sourceColumnsApplied, 0, 'second normalization pass is idempotent for source columns');
  assert.equal(store.withStoreScope(tenant, 'STORE-DEFAULT', () => store.listFinancialNormalizationRuns(tenant)).length, 2, 'each certified pass is retained as auditable evidence');
  const conflictPreview = store.withStoreScope(tenant, 'STORE-DEFAULT', () => {
    const snapshot = store.snapshotFor(tenant, 'STORE-DEFAULT');
    const invoice = snapshot.financialDocuments?.find((entry: any) => entry.documentType === 'invoice');
    if (invoice) invoice.amountPaise += 100;
    store.replaceScoped(tenant, 'STORE-DEFAULT', snapshot);
    return previewFinancialNormalization(tenant);
  });
  assert.equal(conflictPreview.conflicts >= 1, true, 'preview surfaces a normalized mirror conflict instead of hiding drift');
  assert.throws(() => store.withStoreScope(tenant, 'STORE-DEFAULT', () => applyFinancialNormalization(tenant, 'normalization-owner')), /conflict/, 'apply refuses to overwrite a conflicting normalized financial mirror');
  console.log('PASS  controlled financial normalization preview, backfill, and idempotency self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
