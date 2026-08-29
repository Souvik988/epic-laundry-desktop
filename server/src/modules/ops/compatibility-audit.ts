import { store } from '../../kernel/store.js';

type CompatibilityDefinition = {
  entity: string;
  target: string;
  normalizedCount: (counts: ReturnType<typeof store.diagnosticsFor>) => number;
  status: 'dual_read' | 'compatibility';
  retirementBlocker: string;
};

const definitions: CompatibilityDefinition[] = [
  { entity: 'party', target: 'customers', normalizedCount: (counts) => counts.normalizedCustomers, status: 'dual_read', retirementBlocker: 'Customer profile reads and writes still use the generic party row until all writes dual-write and a cutover is certified.' },
  { entity: 'laundry_order', target: 'laundry_orders + laundry_order_items', normalizedCount: (counts) => counts.normalizedOrders, status: 'dual_read', retirementBlocker: 'Order/item source payload remains the compatibility record until all writes dual-write and a cutover is certified.' },
  { entity: 'sales_invoice', target: 'financial_documents', normalizedCount: (counts) => Number(counts.financialDocumentSources.sales_invoice || 0), status: 'dual_read', retirementBlocker: 'Invoice source fields remain until certified source-column retirement.' },
  { entity: 'payment_entry', target: 'financial_entries', normalizedCount: (counts) => Number(counts.financialEntrySources.payment_entry || 0), status: 'dual_read', retirementBlocker: 'Payment source fields remain until certified source-column retirement.' },
  { entity: 'laundry_customer_ledger', target: 'customer_ledger_entries', normalizedCount: (counts) => counts.customerLedgerEntries, status: 'dual_read', retirementBlocker: 'Legacy ledger rows remain readable for historical reconciliation.' },
  { entity: 'laundry_wallet_entry', target: 'wallet_entries', normalizedCount: (counts) => counts.walletEntries, status: 'dual_read', retirementBlocker: 'Legacy wallet rows remain readable for historical reconciliation.' },
  { entity: 'laundry_expense', target: 'financial_entries', normalizedCount: (counts) => Number(counts.financialEntrySources.laundry_expense || 0), status: 'dual_read', retirementBlocker: 'Expense source fields remain until certified source-column retirement.' },
  { entity: 'laundry_cash_shift', target: 'cash_shift_closes', normalizedCount: (counts) => counts.cashShiftCloses, status: 'dual_read', retirementBlocker: 'Mutable shift source rows remain until close-history migration is complete.' },
  { entity: 'laundry_garment', target: 'garment_units', normalizedCount: (counts) => counts.garmentUnits, status: 'dual_read', retirementBlocker: 'Catalogue records and physical unit records have different lifecycles.' },
  { entity: 'laundry_fulfillment_event', target: 'garment_unit_events', normalizedCount: (counts) => counts.garmentUnitEvents, status: 'dual_read', retirementBlocker: 'Historical fulfilment events require reviewed unit linkage before retirement.' },
];

/**
 * Read-only migration preflight. It deliberately returns counts and blockers,
 * never generic payloads, so an owner can review retirement readiness without
 * leaking customer, financial, or operational data into diagnostics.
 */
export function compatibilityRetirementAudit(tenant: string, storeId: string) {
  const counts = store.diagnosticsFor(tenant, storeId);
  const items = definitions
    .map((definition) => {
      const compatibilityRows = Number(counts.entityCounts[definition.entity] || 0);
      const normalizedRows = definition.normalizedCount(counts);
      return {
        entity: definition.entity,
        target: definition.target,
        compatibilityRows,
        normalizedRows,
        status: compatibilityRows === 0 ? 'clear' : definition.status,
        retirementBlocker: compatibilityRows === 0 ? null : definition.retirementBlocker,
      };
    })
    .filter((item) => item.compatibilityRows > 0 || item.normalizedRows > 0);
  const compatibilityRows = items.reduce((sum, item) => sum + item.compatibilityRows, 0);
  const dualReadRows = items.filter((item) => item.status === 'dual_read').reduce((sum, item) => sum + item.compatibilityRows, 0);
  const unresolvedRows = items.filter((item) => item.status === 'compatibility').reduce((sum, item) => sum + item.compatibilityRows, 0);
  return {
    format: 'epic-laundry-compatibility-retirement-audit',
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: { tenant, storeId },
    source: 'entity_rows compatibility payloads',
    summary: { entitiesReviewed: definitions.length, entitiesPresent: items.length, compatibilityRows, dualReadRows, unresolvedRows, retirementReady: unresolvedRows === 0 && compatibilityRows === 0 },
    items,
    policy: 'No compatibility field or generic source is retired from this read-only preflight. A later owner-approved migration must reconcile every item, record a rollback snapshot, and certify zero unresolved rows before removal.',
  };
}
