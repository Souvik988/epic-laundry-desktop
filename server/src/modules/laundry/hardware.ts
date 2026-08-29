import { createHash } from 'node:crypto';
import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';

export type HardwareReceiptInput = { kind?: string; operation?: string; status?: string; device?: string; sourceEntity?: string; sourceId?: string; evidence?: string };

export function hardwareCapabilities() {
  return [
    { kind: 'scanner', adapter: 'keyboard-wedge', status: 'available', evidence: 'Garment Tracking accepts scanner keystrokes and validates the tag server-side.' },
    { kind: 'receipt-printer', adapter: 'electron-system-dialog', status: 'available', evidence: 'Print Centre invokes the native Electron print dialog and records its result.' },
    { kind: 'tag-printer', adapter: 'electron-system-dialog', status: 'available', evidence: 'Tag sheets use the same controlled native print boundary; thermal command mode is not configured.' },
    { kind: 'weighing-scale', adapter: 'none', status: 'not_configured', evidence: 'No scale provider is configured; weight quantities remain explicit operator input.' },
    { kind: 'cash-drawer', adapter: 'none', status: 'not_configured', evidence: 'Cash closing records counts but does not claim drawer actuation.' },
    { kind: 'rfid', adapter: 'none', status: 'not_configured', evidence: 'No RFID reader is configured.' },
  ];
}

export function recordHardwareReceipt(tenant: string, actor: string, input: HardwareReceiptInput) {
  const kind = String(input.kind || '').trim().slice(0, 60); const operation = String(input.operation || '').trim().slice(0, 80); const status = String(input.status || '').trim(); const device = String(input.device || '').trim().slice(0, 120); const evidence = String(input.evidence || '').trim().slice(0, 500);
  if (!kind || !operation || !device || !evidence) throw new Error('hardware receipt requires kind, operation, device, and evidence');
  if (!['Completed', 'Failed', 'Cancelled'].includes(status)) throw new Error('invalid hardware receipt status');
  if (status === 'Completed' && evidence.length < 8) throw new Error('completed hardware receipts require concrete evidence');
  const recordedAt = new Date().toISOString();
  const row = createRow(tenant, actor, 'laundry_hardware_receipt', { kind, operation, status, device, source_entity: String(input.sourceEntity || '').trim().slice(0, 80), source_id: String(input.sourceId || '').trim().slice(0, 120), evidence, recorded_at: recordedAt, recorded_by: actor, evidence_hash: createHash('sha256').update(evidence, 'utf8').digest('hex') });
  row.status = status; row.updated_at = recordedAt; store.updateRow(row);
  audit(tenant, actor, 'laundry:hardware-receipt-recorded', { entity: row.entity, row_id: row.id, after: { kind, operation, status, device, sourceId: input.sourceId || '', evidenceHash: row.data.evidence_hash } });
  return { id: row.id, kind, operation, status, device, sourceEntity: input.sourceEntity || '', sourceId: input.sourceId || '', evidence, evidenceHash: row.data.evidence_hash, recordedAt, recordedBy: actor };
}

export function listHardwareReceipts(tenant: string) {
  return store.rowsOf(tenant, 'laundry_hardware_receipt').sort((a, b) => b.created_at.localeCompare(a.created_at)).map((row) => ({ id: row.id, kind: String(row.data.kind), operation: String(row.data.operation), status: String(row.data.status), device: String(row.data.device), sourceEntity: String(row.data.source_entity || ''), sourceId: String(row.data.source_id || ''), evidence: String(row.data.evidence), evidenceHash: String(row.data.evidence_hash || ''), recordedAt: String(row.data.recorded_at || row.created_at), recordedBy: String(row.data.recorded_by || row.created_by) }));
}

/** Per-branch health projection for support and setup readiness. This remains
 * evidence-based: an available adapter with no receipt is awaiting evidence,
 * while not-configured devices are never presented as connected. */
export function hardwareStatus(tenant: string) {
  const receipts = listHardwareReceipts(tenant);
  return hardwareCapabilities().map((capability) => {
    const observed = receipts.filter((receipt) => receipt.kind === capability.kind);
    const latest = observed[0];
    const failed = observed.filter((receipt) => receipt.status === 'Failed').length;
    const health = capability.status === 'not_configured'
      ? 'not_configured'
      : failed > 0 && latest?.status === 'Failed'
        ? 'degraded'
        : latest
          ? 'evidence_seen'
          : 'awaiting_evidence';
    return {
      ...capability,
      health,
      receiptCount: observed.length,
      failedReceipts: failed,
      lastReceiptAt: latest?.recordedAt || null,
      lastReceiptStatus: latest?.status || null,
      lastDevice: latest?.device || null,
    };
  });
}
