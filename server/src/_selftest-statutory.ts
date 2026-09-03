import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-statutory-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json'); process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
let closeStore: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); closeStore = () => store.close();
  const { calculateGstEcoTcs, calculateTds, prepareStatutoryReturn, recordTcsTransaction, recordTdsTransaction, statutoryDashboard, updateStatutoryReturn } = await import('./modules/finance/statutory.js');
  const tdsPreview = calculateTds({ postingDate: '2026-09-03', category: 'CONTRACTOR', payeeType: 'OTHER', basePaise: 100_000_00, aggregatePaise: 100_000_00, panStatus: 'VALID' });
  assert.equal(tdsPreview.amountPaise, 200_000, 'contractor TDS uses the other-payee 2% rate in fixed paise');
  assert.equal(calculateTds({ postingDate: '2026-09-03', category: 'COMMISSION', basePaise: 10_000_00, aggregatePaise: 10_000_00, panStatus: 'VALID' }).status, 'NOT_APPLICABLE', 'commission threshold is enforced');
  const tcsPreview = calculateGstEcoTcs({ taxableSupplyPaise: 100_000_00, returnedSupplyPaise: 10_000_00, intraState: true });
  assert.equal(tcsPreview.amountPaise, 45_000, 'GST ECO TCS uses the net taxable supply at 0.50%');
  const tds = recordTdsTransaction('STATUTORY', 'owner', { sourceReference: 'BILL-001', postingDate: '2026-09-03', category: 'CONTRACTOR', payeeType: 'OTHER', basePaise: 100_000_00, aggregatePaise: 100_000_00, panStatus: 'VALID' });
  assert.equal(recordTdsTransaction('STATUTORY', 'owner', { sourceReference: 'BILL-001', postingDate: '2026-09-03', category: 'CONTRACTOR', payeeType: 'OTHER', basePaise: 100_000_00, aggregatePaise: 100_000_00, panStatus: 'VALID' }).id, tds.id, 'TDS source retries are idempotent');
  recordTcsTransaction('STATUTORY', 'owner', { sourceReference: 'MARKET-001', postingDate: '2026-09-03', category: 'GST_ECO_TCS', taxableSupplyPaise: 100_000_00, returnedSupplyPaise: 10_000_00, intraState: true });
  const dashboard = statutoryDashboard('STATUTORY', { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(dashboard.liabilities.tdsPaise, 200_000); assert.equal(dashboard.liabilities.tcsPaise, 45_000); assert.equal(dashboard.transactions.tdsCount, 1); assert.equal(dashboard.transactions.tcsCount, 1);
  const prepared = prepareStatutoryReturn('STATUTORY', 'owner', { returnType: 'TDS_140', periodStart: '2026-09-01', periodEnd: '2026-09-30' });
  assert.equal(prepared.data.amountPaise, 200_000); assert.throws(() => updateStatutoryReturn('STATUTORY', 'owner', prepared.id, { state: 'Accepted' }), /STATUTORY_RETURN_EVIDENCE_REQUIRED/);
  updateStatutoryReturn('STATUTORY', 'owner', prepared.id, { state: 'Accepted', evidence: 'CA-PORTAL-ACK-001', acknowledgement: 'ACK-001' });
  assert.equal(statutoryDashboard('STATUTORY', { from: '2026-09-01', to: '2026-09-30' }).returns[0].state, 'Accepted');
  console.log('PASS fixed-scale TDS/TCS liabilities, idempotency and return-evidence self-test complete');
} finally { closeStore?.(); rmSync(tempDir, { recursive: true, force: true }); }
