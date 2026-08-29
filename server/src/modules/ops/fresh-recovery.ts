import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store, type DbShape } from '../../kernel/store.js';

/**
 * Restore a validated snapshot into a brand-new isolated SQLite file, inspect
 * the durable records, then remove the temporary file. The live Store is never
 * opened for writes, so this is safe to run from a scheduled verifier.
 */
export function freshDatabaseRestoreRehearsal(tenant: string, storeId: string, snapshot: DbShape) {
  const directory = mkdtempSync(join(tmpdir(), 'epic-laundry-recovery-'));
  const file = join(directory, 'rehearsal.sqlite');
  const isolated = new Store(file, { skipLegacyImport: true });
  try {
    isolated.replaceScoped(tenant, storeId, snapshot);
    const restored = isolated.snapshotFor(tenant, storeId);
    const counts = { rows: restored.rows.length, gl: restored.gl.length, audit: restored.audit.length, outbox: restored.outbox.length, stock: restored.stock.length, ims: restored.ims.length, garmentUnits: restored.garmentUnits?.length || 0, garmentUnitEvents: restored.garmentUnitEvents?.length || 0, tagReprints: restored.tagReprints?.length || 0, financialEntries: restored.financialEntries?.length || 0, financialDocuments: restored.financialDocuments?.length || 0, customerLedgerEntries: restored.customerLedgerEntries?.length || 0, walletEntries: restored.walletEntries?.length || 0, customerAddresses: restored.customerAddresses?.length || 0, orderHolds: restored.orderHolds?.length || 0, cashShiftCloses: restored.cashShiftCloses?.length || 0, financialNormalizationRuns: restored.financialNormalizationRuns?.length || 0, normalizedCustomers: restored.normalizedCustomers?.length || 0, normalizedOrders: restored.normalizedOrders?.length || 0 };
    const expected = { rows: snapshot.rows?.length || 0, gl: snapshot.gl?.length || 0, audit: snapshot.audit?.length || 0, outbox: snapshot.outbox?.length || 0, stock: snapshot.stock?.length || 0, ims: snapshot.ims?.length || 0, garmentUnits: snapshot.garmentUnits?.length || 0, garmentUnitEvents: snapshot.garmentUnitEvents?.length || 0, tagReprints: snapshot.tagReprints?.length || 0, financialEntries: snapshot.financialEntries?.length || 0, financialDocuments: snapshot.financialDocuments?.length || 0, customerLedgerEntries: snapshot.customerLedgerEntries?.length || 0, walletEntries: snapshot.walletEntries?.length || 0, customerAddresses: snapshot.customerAddresses?.length || 0, orderHolds: snapshot.orderHolds?.length || 0, cashShiftCloses: snapshot.cashShiftCloses?.length || 0, financialNormalizationRuns: snapshot.financialNormalizationRuns?.length || 0, normalizedCustomers: snapshot.normalizedCustomers?.length || 0, normalizedOrders: snapshot.normalizedOrders?.length || 0 };
    if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error('fresh-database rehearsal count mismatch');
    return { ok: true, isolatedDatabase: true, verifiedAt: new Date().toISOString(), counts, digest: createHash('sha256').update(JSON.stringify(restored)).digest('hex') };
  } finally { isolated.close(); try { rmSync(directory, { recursive: true, force: true }); } catch { /* best effort cleanup; result remains non-destructive */ } }
}
