import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-management-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'legacy.json'); process.env.EPIC_DB_FILE = join(tempDir, 'epic.sqlite');
let closeStore: (() => void) | undefined;
try {
  const { store } = await import('./kernel/store.js'); closeStore = () => store.close();
  const { createRow } = await import('./kernel/entity-service.js');
  const { seedLaundryDefaults, laundryCatalogue, bookLaundryOrder } = await import('./modules/laundry/domain.js');
  const { laundryWorkforceDashboard, markLaundryAttendance, laundryManagementSnapshot } = await import('./modules/laundry/management.js');
  const { requestLaundryReturn, listLaundryReturns } = await import('./modules/laundry/returns.js');
  const tenant = 'MANAGEMENT'; const actor = 'owner';
  seedLaundryDefaults(tenant);
  const employee = createRow(tenant, actor, 'employee', { name: 'Anita Operator', department: 'Production', designation: 'Press operator', is_active: true });
  const first = markLaundryAttendance(tenant, actor, { employee: employee.id, date: '2026-09-03', status: 'Present', shift: 'Day', workingHours: 8 });
  assert.equal(first.attendance.status, 'Submitted', 'Laundry attendance is submitted evidence, not a draft');
  assert.equal(laundryWorkforceDashboard(tenant, '2026-09-03').statusCounts.Present, 1, 'workforce dashboard derives current capacity from submitted attendance');
  assert.equal(markLaundryAttendance(tenant, actor, { employee: employee.id, date: '2026-09-03', status: 'Present' }).duplicate, true, 'same attendance retry is idempotent');
  assert.throws(() => markLaundryAttendance(tenant, actor, { employee: employee.id, date: '2026-09-03', status: 'Absent' }), /ALREADY_MARKED/, 'conflicting daily attendance cannot silently overwrite evidence');
  const catalogue = laundryCatalogue(tenant); const garment = catalogue.garments[0]; const service = catalogue.services.find((candidate: any) => catalogue.prices.some((price: any) => price.garment === garment.id && price.service === candidate.id))!;
  const booking = bookLaundryOrder(tenant, actor, { customer: { name: 'Return Customer', phone: '9000000123' }, items: [{ garment: garment.id, service: service.id, qty: 1 }], expectedDeliveryDate: '2026-09-05', fulfillmentMode: 'Pickup Order', paymentMode: 'Pay Later' });
  const request = requestLaundryReturn(tenant, actor, { orderId: booking.order.id, amount: 1, reason: 'Quality issue', note: 'Counter evidence' });
  assert.equal(request.returnCase.data.status, 'Requested', 'return request does not fabricate a completed refund');
  assert.equal(requestLaundryReturn(tenant, actor, { orderId: booking.order.id, amount: 1, reason: 'Quality issue' }).duplicate, true, 'same return retry does not duplicate a case');
  assert.throws(() => requestLaundryReturn(tenant, actor, { orderId: booking.order.id, amount: booking.order.grandTotal + 1, reason: 'Quality issue' }), /EXCEEDS/, 'return request cannot exceed the original order value');
  assert.equal(listLaundryReturns(tenant).length, 1, 'return case is durable and queryable');
  const snapshot = laundryManagementSnapshot(tenant);
  assert.equal(snapshot.ebitda.state, 'NOT_READY', 'management dashboard never invents EBITDA without classified costs');
  assert.equal(snapshot.withholding.state, 'NOT_CONFIGURED', 'TDS/TCS starts visibly unconfigured until a CA-approved policy exists');
  console.log('PASS  Laundry management workforce, return and finance-readiness self-test complete');
} finally { closeStore?.(); rmSync(tempDir, { recursive: true, force: true }); }
