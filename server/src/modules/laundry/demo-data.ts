import { randomUUID } from 'node:crypto';
import { store } from '../../kernel/store.js';
import { createRow } from '../../kernel/entity-service.js';
import { laundryCatalogue, bookLaundryOrder, assignLaundryOrder, transitionLaundryOrder, scanLaundryGarment, createLaundryRider, createLaundryExpense } from './domain.js';
import { laundryBusinessDate } from './dates.js';
import { createServiceZone, createRouteRun, startRouteRun, completeRouteStop } from './routes.js';
import { openQualityClaim, resolveQualityClaim } from './quality.js';
import { requestLaundryReturn } from './returns.js';
import { saveMarketplaceAvailability } from '../marketplace/availability.js';
import { saveMarketplaceCatalogueMapping } from '../marketplace/catalogue.js';
import { createDeviceEnrollment, registerMarketplaceDevice, receiveMarketplaceOrder, queueMarketplaceEvent } from '../marketplace/edge-sync.js';
import { recordMarketplaceCashCollection, recordMarketplaceSettlement } from '../marketplace/settlements.js';
import { saveIncomeTaxTcsPolicy, recordTdsTransaction, recordTcsTransaction, prepareStatutoryReturn } from '../finance/statutory.js';
import { installIndia2026Baseline } from '../finance/regulatory-policy.js';
import { createTaxPolicyRule, approveTaxPolicyRule, saveSupplierTaxProfile, supplierTaxProfile } from '../gst/tax-policy.js';
import { calculateCanonicalTax } from '../gst/canonical-tax.js';
import { createCanonicalInvoiceSnapshot } from '../gst/invoice-snapshot.js';

const TENANT_ACTOR = 'demo-seed';
const VERSION = 'DEMO-DATA-V4.1';
const markerId = 'demo_data_v4_1';

function day(offset: number) {
  const today = laundryBusinessDate();
  const value = new Date(`${today}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function money(value: unknown) { return Math.max(0, Math.round(Number(value || 0) * 100)); }
function noteExists(tenant: string, entity: string, prefix: string) { return store.rowsOf(tenant, entity).some((row) => String(row.data.notes || '').startsWith(prefix) || String(row.data.description || '').startsWith(prefix)); }
function existingSource(tenant: string, entity: string, key: string, value: string) { return store.rowsOf(tenant, entity).some((row) => String(row.data[key] || '') === value); }

function expandOrders(tenant: string) {
  const catalogue = laundryCatalogue(tenant);
  const pairs = (catalogue.prices as Array<Record<string, any>>).filter((price) => {
    const garment = catalogue.garments.find((item) => item.id === price.garment);
    return Boolean(garment && ['Piece', 'Pair'].includes(String(garment.unit)) && catalogue.services.some((service) => service.id === price.service));
  });
  if (!pairs.length) return { created: 0, orderIds: [] as string[] };
  let pickupRider = store.rowsOf(tenant, 'laundry_rider').find((row) => String(row.data.name) === 'Demo Route Pickup');
  let deliveryRider = store.rowsOf(tenant, 'laundry_rider').find((row) => String(row.data.name) === 'Demo Route Delivery');
  if (!pickupRider) pickupRider = store.getRow(tenant, createLaundryRider(tenant, TENANT_ACTOR, { name: 'Demo Route Pickup', phone: '9000000201' }).id);
  if (!deliveryRider) deliveryRider = store.getRow(tenant, createLaundryRider(tenant, TENANT_ACTOR, { name: 'Demo Route Delivery', phone: '9000000202' }).id);
  const channels = ['By Store', 'Customer App', 'Website', 'Marketplace'] as const;
  const orderIds: string[] = [];
  let created = 0;
  for (let index = 0; index < 52; index += 1) {
    const marker = `DEMO_EXPANSION_V4:${index}`;
    const existing = store.rowsOf(tenant, 'laundry_order').find((row) => String(row.data.notes || '').includes(marker));
    if (existing) { orderIds.push(existing.id); continue; }
    const price = pairs[index % pairs.length];
    const garment = catalogue.garments.find((item) => item.id === price.garment)!;
    const service = catalogue.services.find((item) => item.id === price.service)!;
    const mode = index % 5 === 0 ? 'Pickup Order' : index % 7 === 0 ? 'Express Delivery' : 'Home Delivery';
    const paymentMode = index % 6 === 0 ? 'Pay Later' : index % 3 === 0 ? 'UPI' : index % 3 === 1 ? 'Cash' : 'Card';
    const result = bookLaundryOrder(tenant, TENANT_ACTOR, {
      orderDate: day(-((index * 3) % 90)), expectedDeliveryDate: day(Math.max(1, (index % 6) - 1)),
      customer: { name: `Demo Finance Customer ${String(index + 1).padStart(2, '0')}`, phone: `900001${String(1000 + index).slice(-4)}`, email: `demo.customer${index + 1}@example.test`, address: `${index + 11} Demo Avenue, Kolkata` },
      items: [{ garment: garment.id, service: service.id, qty: index % 4 === 0 ? 2 : 1 }],
      fulfillmentMode: mode, paymentMode, taxRate: 18, serviceZone: index % 2 ? 'Central Kolkata' : 'North Kolkata', notes: `${marker} · Finance workbench fixture`, placeOfSupply: index % 4 === 0 ? '19' : '29',
    });
    const order = store.getRow(tenant, result.order.id);
    if (!order) continue;
    order.data.source = channels[index % channels.length]; order.data.marketplace_channel = channels[index % channels.length]; order.data.demo_fixture = VERSION; order.updated_at = new Date().toISOString(); store.updateRow(order);
    orderIds.push(order.id); created += 1;
    const desired = index % 8;
    try {
      if (desired >= 1) {
        if (mode === 'Pickup Order') assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'pickup', riderId: pickupRider!.id });
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Picked Up', 'Demo intake event');
      }
      if (desired >= 2) transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'In Process', 'Demo production started');
      if (desired >= 4) {
        for (const [unitIndex, unit] of result.garmentUnits.entries()) for (const state of ['Sorted', 'Processing', 'QC', 'Assembly', 'Racked'] as const) scanLaundryGarment(tenant, TENANT_ACTOR, { tagCode: unit.tagCode, nextState: state, location: state === 'Racked' ? `DEMO-RACK-${String(index + 1).padStart(2, '0')}-${unitIndex + 1}` : `Demo ${state}`, note: `Demo fixture ${VERSION}` });
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Ready', 'Demo QC passed');
      }
      if (desired === 6) { assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'delivery', riderId: deliveryRider!.id }); transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Out for Delivery', 'Demo dispatch'); }
      if (desired === 7) transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Delivered', 'Demo handoff completed');
    } catch (error) { console.warn(`[seed] order ${index} state fixture skipped: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { created, orderIds };
}

function seedExpenses(tenant: string) {
  const categories = ['PROCESSING', 'LOGISTICS', 'MARKETPLACE', 'RENT', 'UTILITIES', 'SOFTWARE', 'MARKETING', 'MAINTENANCE', 'ADMIN', 'CAPEX', 'FINANCE', 'TAX'] as const;
  let created = 0;
  for (let index = 0; index < 24; index += 1) {
    const prefix = `DEMO_EXPENSE_V4:${index}`;
    if (noteExists(tenant, 'laundry_expense', prefix)) continue;
    createLaundryExpense(tenant, TENANT_ACTOR, { expenseName: `Demo ${categories[index % categories.length].toLowerCase()} expense ${index + 1}`, expenseDate: day(-((index * 7) % 120)), amount: 1800 + index * 475, financeCategory: categories[index % categories.length], paymentMode: index % 3 === 0 ? 'Cash' : index % 3 === 1 ? 'UPI' : 'Bank', paymentReceiver: `Demo Supplier ${index + 1}`, invoiceNumber: `DEMO-EXP-${String(index + 1).padStart(4, '0')}`, isTaxPaid: index % 2 === 0, notes: `${prefix} · management reporting fixture` });
    created += 1;
  }
  return created;
}

function seedCanonicalFinance(tenant: string, orderIds: string[]) {
  const profile = supplierTaxProfile(tenant) || ((saveSupplierTaxProfile(tenant, TENANT_ACTOR, { legalName: 'Epic Laundry Demo Workspace', tradeName: 'Epic Laundry Demo', address: 'Demo Operations Centre, Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered', gstin: '29AAAAA0000A1Z5', invoiceSeries: 'DEMO', einvoiceState: 'Sandbox' }) as any).data);
  let rule = store.rowsOf(tenant, 'tax_policy_rule').find((row) => row.data.classificationCode === '9997' && row.data.approvalStatus === 'Approved');
  if (!rule) { const draft = createTaxPolicyRule(tenant, TENANT_ACTOR, { classificationType: 'SAC', classificationCode: '9997', description: 'Laundry and cleaning service', supplyType: 'Service', rateBps: 1800, validFrom: '2026-04-01', sourceNote: 'Demo workspace only; CBIC-aligned test policy; not live filing evidence.', version: 'DEMO-IND-2026.1' }); rule = approveTaxPolicyRule(tenant, TENANT_ACTOR, draft.id); }
  let created = 0;
  for (const id of orderIds) {
    if (store.rowsOf(tenant, 'canonical_invoice_snapshot').some((row) => row.data.sourceOrderId === id)) continue;
    const order = store.getRow(tenant, id); if (!order || order.data.state === 'Cancelled') continue;
    const customer = store.getRow(tenant, String(order.data.customer || ''));
    const items = Array.isArray(order.data.items) ? order.data.items as Array<Record<string, any>> : [];
    const lines = items.map((item, index) => ({ id: `line-${id}-${index}`, description: `${item.garmentName || 'Garment'} · ${item.serviceName || 'Laundry service'}`, classificationType: 'SAC' as const, classificationCode: '9997', quantityMilli: Math.max(1, Math.round(Number(item.qty || 1) * 1000)), unit: String(item.unit || 'Piece'), unitPricePaise: Math.max(0, Math.round(Number(item.rate || 0) * 100)), taxRateBps: 1800 }));
    if (!lines.length) continue;
    const tax = calculateCanonicalTax({ supplierStateCode: profile.stateCode, placeOfSupplyStateCode: String(order.data.place_of_supply || profile.stateCode), lines });
    const paidPaise = store.rowsOf(tenant, 'payment_entry').filter((payment) => payment.data.against_sales === order.data.invoice && payment.status === 'Submitted').reduce((sum, payment) => sum + money(payment.data.amount), 0);
    createCanonicalInvoiceSnapshot(tenant, TENANT_ACTOR, { sourceOrderId: id, issuedAt: `${String(order.data.order_date || day(0))}T10:00:00.000Z`, supplier: profile, customer: { name: String(customer?.data.name || 'Demo customer'), address: String(order.data.delivery_address || ''), stateCode: String(order.data.place_of_supply || profile.stateCode) }, tax, paidPaise: Math.min(paidPaise, tax.totals.totalPaise) });
    created += 1;
  }
  return created;
}

function seedStatutory(tenant: string) {
  installIndia2026Baseline(tenant, TENANT_ACTOR);
  if (!store.rowsOf(tenant, 'finance_income_tax_tcs_policy').some((row) => row.data.policyKey === 'DEMO_ECOMMERCE_TDS_2026')) saveIncomeTaxTcsPolicy(tenant, TENANT_ACTOR, { policyKey: 'DEMO_ECOMMERCE_TDS_2026', rateBps: 10, effectiveFrom: '2026-04-01', calculationBasis: 'Demo-only e-commerce participant withholding policy; requires actual business-model and legal configuration.', sourceNote: 'Demo workspace only; no filing or provider evidence.', status: 'APPROVED', version: VERSION });
  const tds: Array<{ category: any; basePaise: number; aggregatePaise?: number; payeeType?: any; panStatus?: any; buyerTurnoverPaise?: number }> = [
    { category: 'CONTRACTOR', basePaise: 1_500_000, aggregatePaise: 12_000_000, payeeType: 'INDIVIDUAL_HUF', panStatus: 'VALID' }, { category: 'CONTRACTOR', basePaise: 2_000_000, aggregatePaise: 12_000_000, payeeType: 'OTHER', panStatus: 'MISSING' }, { category: 'COMMISSION', basePaise: 3_000_000, aggregatePaise: 3_000_000, panStatus: 'VALID' }, { category: 'RENT_PROPERTY', basePaise: 6_000_000, aggregatePaise: 6_000_000, panStatus: 'VALID' }, { category: 'RENT_EQUIPMENT', basePaise: 6_000_000, aggregatePaise: 6_000_000, panStatus: 'VALID' }, { category: 'PROFESSIONAL', basePaise: 6_000_000, aggregatePaise: 6_000_000, panStatus: 'VALID' }, { category: 'TECHNICAL', basePaise: 6_000_000, aggregatePaise: 6_000_000, panStatus: 'INOPERATIVE' }, { category: 'GOODS_PURCHASE', basePaise: 12_000_000, aggregatePaise: 60_000_000, buyerTurnoverPaise: 1_200_000_000, panStatus: 'VALID' }, { category: 'ECOMMERCE', basePaise: 4_000_000, aggregatePaise: 4_000_000, panStatus: 'VALID' },
  ];
  let created = 0;
  for (let index = 0; index < 18; index += 1) { const spec = tds[index % tds.length]; const sourceReference = `DEMO-TDS-V4-${index}`; if (existingSource(tenant, 'finance_tds_transaction', 'sourceReference', sourceReference)) continue; recordTdsTransaction(tenant, TENANT_ACTOR, { ...spec, sourceReference, postingDate: day(-((index * 9) % 120)), payeeName: `Demo statutory payee ${index + 1}` }); created += 1; }
  for (let index = 0; index < 12; index += 1) { const sourceReference = `DEMO-GST-TCS-V4-${index}`; if (existingSource(tenant, 'finance_tcs_transaction', 'sourceReference', sourceReference)) continue; recordTcsTransaction(tenant, TENANT_ACTOR, { sourceReference, postingDate: day(-((index * 6) % 90)), category: 'GST_ECO_TCS', taxableSupplyPaise: 250_000 + index * 35_000, returnedSupplyPaise: index % 4 === 0 ? 20_000 : 0, intraState: index % 3 !== 0 }); created += 1; }
  for (let index = 0; index < 8; index += 1) { const sourceReference = `DEMO-INCOME-TCS-V4-${index}`; if (existingSource(tenant, 'finance_tcs_transaction', 'sourceReference', sourceReference)) continue; recordTcsTransaction(tenant, TENANT_ACTOR, { sourceReference, postingDate: day(-((index * 11) % 90)), category: 'INCOME_TAX_TCS', taxableSupplyPaise: 500_000 + index * 55_000, policyKey: 'DEMO_ECOMMERCE_TDS_2026' }); created += 1; }
  const returns: Array<['TDS_138' | 'TDS_140' | 'TCS_143' | 'GSTR_8', string, string]> = [['TDS_138', '2026-04-01', '2026-06-30'], ['TDS_140', '2026-04-01', '2026-06-30'], ['TCS_143', '2026-04-01', '2026-06-30'], ['GSTR_8', '2026-07-01', '2026-07-31'], ['TDS_138', '2026-07-01', '2026-09-30'], ['TDS_140', '2026-07-01', '2026-09-30'], ['TCS_143', '2026-07-01', '2026-09-30'], ['GSTR_8', '2026-08-01', '2026-08-31']];
  for (const [returnType, periodStart, periodEnd] of returns) prepareStatutoryReturn(tenant, TENANT_ACTOR, { returnType, periodStart, periodEnd });
  return created;
}

function seedQualityAndReturns(tenant: string) {
  const units = store.listGarmentUnits(tenant);
  let claims = 0; let returns = 0;
  for (let index = 0; index < Math.min(8, units.length); index += 1) {
    const unit = units[index]; const prefix = `DEMO_QC_V4:${index}`;
    if (!noteExists(tenant, 'laundry_quality_claim', prefix)) { try { const claim = openQualityClaim(tenant, TENANT_ACTOR, { garmentUnitId: unit.id, category: index % 2 ? 'Rewash' : 'Stain', severity: index % 3 ? 'Medium' : 'High', description: `${prefix} recorded quality review for demo visualisation` }); if (index % 2 === 1) resolveQualityClaim(tenant, TENANT_ACTOR, claim.id, 'Release', `${prefix} reviewed and released for demo workflow`); claims += 1; } catch (error) { console.warn(`[seed] quality fixture ${index} skipped: ${error instanceof Error ? error.message : String(error)}`); } }
  }
  const delivered = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.state === 'Delivered');
  for (let index = 0; index < Math.min(6, delivered.length); index += 1) { const order = delivered[index]; const prefix = `DEMO_RETURN_V4:${index}`; if (store.rowsOf(tenant, 'laundry_return_case').some((row) => String(row.data.note || '').startsWith(prefix))) continue; requestLaundryReturn(tenant, TENANT_ACTOR, { orderId: order.id, amount: Math.max(1, Math.round(Number(order.data.grand_total || 1) * (index % 2 ? 0.15 : 0.08))), reason: index % 2 ? 'Quality issue' : 'Duplicate charge', note: `${prefix} customer return workflow fixture` }); returns += 1; }
  return { claims, returns };
}

function seedMarketplace(tenant: string) {
  let device = store.getMarketplaceDevice(tenant);
  if (!device) { const enrollment = createDeviceEnrollment(); device = registerMarketplaceDevice(tenant, TENANT_ACTOR, { deviceId: enrollment.deviceId, vendorId: 'DEMO-VENDOR-001', station: 'Demo counter station', capabilities: { marketplaceSync: true, onlineOrders: true, settlements: true }, softwareVersion: '0.1.0-demo', credentialRef: 'demo-only-protected-credential', publicKey: enrollment.publicKey, status: 'Registered' }); }
  try { saveMarketplaceAvailability(tenant, TENANT_ACTOR, { state: 'Open', timezone: 'Asia/Kolkata', serviceZones: ['Central Kolkata', 'North Kolkata', 'South Kolkata'], capacity: { orders: 80, bags: 35, kg: 250, stops: 24 }, leadTimeMinutes: 90, staleAfterMinutes: 45, capabilities: { express: true, pickup: true, delivery: true } }); } catch (error) { console.warn(`[seed] availability fixture skipped: ${error instanceof Error ? error.message : String(error)}`); }
  const catalogue = laundryCatalogue(tenant); const garment = catalogue.garments[0]; const service = catalogue.services[0];
  if (garment && service && !store.rowsOf(tenant, 'marketplace_catalogue_mapping').length) saveMarketplaceCatalogueMapping(tenant, TENANT_ACTOR, { vendorId: 'DEMO-VENDOR-001', garmentId: garment.id, serviceId: service.id, marketplaceCategoryId: 'laundry-care', marketplaceServiceId: 'wash-care', publicName: `${garment.name} · ${service.name}`, publicDescription: 'Demo marketplace catalogue mapping', pricePaise: Math.round(Number(garment.rate || 250) * 100), pricingUnit: String(garment.unit || 'Piece'), minQuantityMilli: 1000, turnaroundMinutes: 1440, expressEligible: true, marketplaceVisible: true, version: 1, effectiveFrom: '2026-04-01', approvalStatus: 'Approved' });
  for (let index = 0; index < 12; index += 1) {
    const externalOrderId = `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`; if (store.listMarketplaceOrderProjections(tenant).some((row) => row.externalOrderId === externalOrderId)) continue;
    const states = ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'IntakeRequired', 'CustomerApprovalRequired', 'Processing', 'Ready', 'DeliveryScheduled'] as const;
    const eventId = `demo-marketplace-event-v4-${index}`;
    receiveMarketplaceOrder(tenant, TENANT_ACTOR, { eventId, source: 'demo-cloud', tenantId: tenant, vendorId: device.vendorId, storeId: store.currentStore(tenant), deviceId: device.id, aggregateType: 'marketplace_order', aggregateId: externalOrderId, aggregateVersion: 1, eventType: 'marketplace.order.created.v1', eventVersion: 1, occurredAt: `${day(-index)}T08:00:00.000Z`, correlationId: `demo-correlation-${index}`, payload: { externalOrderId, externalCustomerId: `demo-cloud-customer-${index}`, orderNumber: `MKT-${String(index + 1).padStart(5, '0')}`, channel: index % 3 === 0 ? 'CUSTOMER_APP' : index % 3 === 1 ? 'WEBSITE' : 'MARKETPLACE', state: states[index % states.length], customer: { name: `Online Demo Customer ${index + 1}`, phone: `900002${String(1000 + index).slice(-4)}` }, pickup: { address: `${index + 1} Marketplace Lane, Kolkata`, serviceZone: index % 2 ? 'Central Kolkata' : 'North Kolkata', fulfillmentMode: 'Home Delivery' }, request: { estimatedItems: index + 2, bags: 1 + (index % 3), expectedDeliveryDate: day(Math.max(1, index % 5)), notes: 'Demo online request; physical intake may change final quote' }, paymentState: index % 4 === 0 ? 'Pending' : 'Captured', acceptanceDeadline: `${day(1)}T18:00:00.000Z`, preferences: 'Handle with care', notes: 'Demo marketplace order' } });
  }
  for (let index = 0; index < 6; index += 1) { const externalOrderId = `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`; const settlementInput = { externalOrderId, policyVersion: VERSION, customerCollectedPaise: 120_000 + index * 15_000, refundPaise: index % 3 === 0 ? 5_000 : 0, refundAllocations: index % 3 === 0 ? [{ allocationId: `demo-refund-${index}`, amountPaise: 5_000, responsibility: 'Vendor' as const, reason: 'Demo quality adjustment' }] : [], vendorServiceGrossPaise: 100_000 + index * 10_000, vendorFundedDiscountPaise: 2_000, platformFundedPromotionPaise: 5_000, commissionBps: 1500, paymentFeePaise: 1_500, withholdingPaise: 100, adjustmentsPaise: 0 }; recordMarketplaceSettlement(tenant, TENANT_ACTOR, settlementInput); if (index < 2) recordMarketplaceCashCollection(tenant, TENANT_ACTOR, { collectionId: `demo-cash-collection-v4-${index}`, externalOrderId, amountPaise: 120_000 + index * 15_000, method: index === 0 ? 'CashOnPickup' : 'CashOnDelivery', collectedBy: index === 0 ? 'Demo Route Pickup' : 'Demo Route Delivery', evidence: `DEMO-EVIDENCE-${index}` }); }
  for (let index = 0; index < 5; index += 1) queueMarketplaceEvent(tenant, TENANT_ACTOR, { aggregateType: 'marketplace_order', aggregateId: `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`, aggregateVersion: 2, eventType: 'marketplace.order.demo-note.v1', payload: { externalOrderId: `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`, demo: true, note: 'Pending demo outbound event for sync dashboard' } });
  return { projections: store.listMarketplaceOrderProjections(tenant).length, settlements: store.rowsOf(tenant, 'marketplace_settlement').length };
}

export function seedLaundryDemoExpansion(tenant: string) {
  if (tenant !== 'T1' || process.env.EPIC_WORKSPACE_MODE !== 'demo') return { seeded: false, reason: 'not-demo' };
  const existingMarker = store.getRow(tenant, markerId);
  if (existingMarker) return { seeded: false, reason: 'already-seeded', version: VERSION, counts: existingMarker.data.counts };
  const orders = expandOrders(tenant);
  const financeOrders = seedCanonicalFinance(tenant, orders.orderIds);
  const expenses = seedExpenses(tenant);
  const statutory = seedStatutory(tenant);
  const quality = seedQualityAndReturns(tenant);
  const marketplace = seedMarketplace(tenant);
  const pickupRider = store.rowsOf(tenant, 'laundry_rider').find((row) => row.data.name === 'Demo Route Pickup');
  const unassignedPickup = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode === 'Pickup Order' && row.data.state === 'Booked' && !row.data.pickup_rider);
  for (const order of unassignedPickup.slice(0, 2)) if (pickupRider) assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'pickup', riderId: pickupRider.id });
  const bookedPickup = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode === 'Pickup Order' && row.data.state === 'Booked' && row.data.pickup_rider);
  for (const zone of [['Central Kolkata', 'CENTRAL'], ['North Kolkata', 'NORTH']] as const) if (!store.rowsOf(tenant, 'laundry_service_zone').some((row) => String(row.data.name) === zone[0])) createServiceZone(tenant, TENANT_ACTOR, { name: zone[0], code: zone[1], pickupWindow: '09:00–13:00', deliveryWindow: '16:00–20:00', notes: 'Demo route planning zone' });
  if (bookedPickup.length && pickupRider && store.rowsOf(tenant, 'laundry_route_run').length === 0) { const routeZone = String(bookedPickup[0].data.service_zone || 'Central Kolkata'); const routeOrders = bookedPickup.filter((row) => String(row.data.service_zone || '') === routeZone).slice(0, 3); if (routeOrders.length) { const run = createRouteRun(tenant, TENANT_ACTOR, { riderId: pickupRider.id, stage: 'Pickup', routeDate: day(0), orderIds: routeOrders.map((row) => row.id), zone: routeZone, notes: `Demo route fixture ${VERSION}` }); const started = startRouteRun(tenant, TENANT_ACTOR, run.id, pickupRider.id); for (const stop of started.stops) completeRouteStop(tenant, TENANT_ACTOR, started.id, stop.id, { note: 'Demo pickup completed' }, pickupRider.id); } }
  if (store.rowsOf(tenant, 'laundry_route_run').length === 0) { const deliveryRider = store.rowsOf(tenant, 'laundry_rider').find((row) => row.data.name === 'Demo Route Delivery'); const readyOrders = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode !== 'Pickup Order' && row.data.state === 'Ready' && !row.data.delivery_rider); const routeZone = String(readyOrders[0]?.data.service_zone || 'Central Kolkata'); const deliveryOrders = readyOrders.filter((row) => String(row.data.service_zone || 'Central Kolkata') === routeZone).slice(0, 3); if (deliveryRider && deliveryOrders.length) { for (const order of deliveryOrders) assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'delivery', riderId: deliveryRider.id }); try { const run = createRouteRun(tenant, TENANT_ACTOR, { riderId: deliveryRider.id, stage: 'Delivery', routeDate: day(0), orderIds: deliveryOrders.map((row) => row.id), zone: routeZone, notes: `Demo delivery route fixture ${VERSION}` }); const started = startRouteRun(tenant, TENANT_ACTOR, run.id, deliveryRider.id); if (started.stops[0]) completeRouteStop(tenant, TENANT_ACTOR, started.id, started.stops[0].id, { note: 'Demo delivery completed' }, deliveryRider.id); } catch (error) { console.warn(`[seed] delivery route fixture skipped: ${error instanceof Error ? error.message : String(error)}`); } } }
  const counts = { orders: store.rowsOf(tenant, 'laundry_order').length, newOrders: orders.created, canonicalInvoices: store.rowsOf(tenant, 'canonical_invoice_snapshot').length, expenses: store.rowsOf(tenant, 'laundry_expense').length, tds: store.rowsOf(tenant, 'finance_tds_transaction').length, tcs: store.rowsOf(tenant, 'finance_tcs_transaction').length, returns: store.rowsOf(tenant, 'finance_statutory_return').length, qualityClaims: store.rowsOf(tenant, 'laundry_quality_claim').length, returnCases: store.rowsOf(tenant, 'laundry_return_case').length, marketplaceOrders: marketplace.projections, settlements: marketplace.settlements, marketplaceCashCollections: store.rowsOf(tenant, 'marketplace_cash_collection').length, routes: store.rowsOf(tenant, 'laundry_route_run').length, expensesAdded: expenses, statutoryTransactionsAdded: statutory, canonicalInvoicesAdded: financeOrders, qualityAdded: quality };
  store.insertRow({ id: markerId, entity: 'demo_seed_marker', tenant, status: 'Active', version: 1, created_by: TENANT_ACTOR, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), data: { version: VERSION, counts, purpose: 'Expanded offline demo workspace for operational, finance, compliance and marketplace visualisation. Demo-only; no provider or filing evidence.' } });
  console.log(`[seed] ${VERSION} expanded demo dataset`, counts);
  return { seeded: true, version: VERSION, counts };
}
