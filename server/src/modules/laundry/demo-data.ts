import { randomUUID } from 'node:crypto';
import { store } from '../../kernel/store.js';
import { createRow } from '../../kernel/entity-service.js';
import { laundryCatalogue, bookLaundryOrder, assignLaundryOrder, transitionLaundryOrder, cancelLaundryOrder, scanLaundryGarment, createLaundryRider, createLaundryExpense, createLaundryPrintJob, saveLaundryRiderSettlement } from './domain.js';
import { markLaundryAttendance } from './management.js';
import { laundryBusinessDate } from './dates.js';
import { createServiceZone, createRouteRun, startRouteRun, completeRouteStop } from './routes.js';
import { openQualityClaim, resolveQualityClaim } from './quality.js';
import { requestLaundryReturn } from './returns.js';
import { saveMarketplaceAvailability } from '../marketplace/availability.js';
import { listMarketplaceCatalogueMappings, saveMarketplaceCatalogueMapping } from '../marketplace/catalogue.js';
import { createDeviceEnrollment, registerMarketplaceDevice, receiveMarketplaceOrder, queueMarketplaceEvent } from '../marketplace/edge-sync.js';
import { recordMarketplaceCashCollection, recordMarketplaceSettlement } from '../marketplace/settlements.js';
import { saveIncomeTaxTcsPolicy, recordTdsTransaction, recordTcsTransaction, prepareStatutoryReturn } from '../finance/statutory.js';
import { installIndia2026Baseline } from '../finance/regulatory-policy.js';
import { createTaxPolicyRule, approveTaxPolicyRule, saveSupplierTaxProfile, supplierTaxProfile } from '../gst/tax-policy.js';
import { calculateCanonicalTax } from '../gst/canonical-tax.js';
import { createCanonicalInvoiceSnapshot } from '../gst/invoice-snapshot.js';
import { createServicePackage, purchaseServicePackage, redeemServicePackage } from './packages.js';
import { applyWalletCommand, adjustRewards, saveLaundryCustomerAddress, updateLaundryCustomer } from './customers.js';

const TENANT_ACTOR = 'demo-seed';
const VERSION = 'DEMO-DATA-V4.6';
const markerId = 'demo_data_v4_6';

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
  // 160 deliberately varied operational orders, plus the core demo fixtures,
  // make every queue, dashboard chart and report useful during training.
  // The marker makes this additive and idempotent when an existing demo
  // workspace upgrades from an earlier seed version.
  for (let index = 0; index < 160; index += 1) {
    const marker = `DEMO_EXPANSION_V4_3:${index}`;
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

function seedLifecycleCoverage(tenant: string) {
  const catalogue = laundryCatalogue(tenant);
  const pairs = (catalogue.prices as Array<Record<string, any>>).filter((price) => {
    const garment = catalogue.garments.find((item) => item.id === price.garment);
    return Boolean(garment && ['Piece', 'Pair'].includes(String(garment.unit)) && catalogue.services.some((service) => service.id === price.service));
  });
  if (!pairs.length) return { created: 0, orderIds: [] as string[] };
  const pickupRider = store.rowsOf(tenant, 'laundry_rider').find((row) => String(row.data.name) === 'Demo Route Pickup');
  const deliveryRider = store.rowsOf(tenant, 'laundry_rider').find((row) => String(row.data.name) === 'Demo Route Delivery');
  const targets = ['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled', 'In Process'] as const;
  const orderIds: string[] = [];
  let created = 0;
  for (const [index, target] of targets.entries()) {
    const marker = `DEMO_LIFECYCLE_V4_7:${index}`;
    const existing = store.rowsOf(tenant, 'laundry_order').find((row) => String(row.data.notes || '').includes(marker));
    if (existing) { orderIds.push(existing.id); continue; }
    const price = pairs[(index + 3) % pairs.length];
    const garment = catalogue.garments.find((item) => item.id === price.garment);
    const service = catalogue.services.find((item) => item.id === price.service);
    if (!garment || !service) continue;
    try {
      const result = bookLaundryOrder(tenant, TENANT_ACTOR, {
        orderDate: day(-(index + 2)), expectedDeliveryDate: day(index + 2),
        customer: { name: `Lifecycle Demo Customer ${index + 1}`, phone: `900004${String(2000 + index).slice(-4)}`, email: `lifecycle${index + 1}@example.test`, address: `${index + 21} Lifecycle Lane, Kolkata` },
        items: [{ garment: garment.id, service: service.id, qty: index % 3 === 0 ? 2 : 1 }],
        fulfillmentMode: target === 'Picked Up' ? 'Pickup Order' : 'Home Delivery',
        paymentMode: index % 3 === 0 ? 'Pay Later' : index % 3 === 1 ? 'Cash' : 'UPI', taxRate: 18,
        serviceZone: index % 2 ? 'Central Kolkata' : 'North Kolkata', notes: `${marker} · lifecycle coverage fixture`,
      });
      const order = store.getRow(tenant, result.order.id);
      if (!order) continue;
      order.data.source = index % 2 ? 'Marketplace' : 'By Store'; order.data.marketplace_channel = index % 2 ? 'MARKETPLACE' : 'COUNTER'; order.data.demo_fixture = VERSION; order.updated_at = new Date().toISOString(); store.updateRow(order);
      orderIds.push(order.id); created += 1;
      if (target === 'Picked Up' && pickupRider) {
        assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'pickup', riderId: pickupRider.id });
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Picked Up', 'Demo lifecycle pickup evidence');
      } else if (target === 'In Process') {
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Picked Up', 'Demo lifecycle intake evidence');
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'In Process', 'Demo lifecycle production evidence');
        if (index === 2) {
          const unit = result.garmentUnits[0];
          if (unit) {
            scanLaundryGarment(tenant, TENANT_ACTOR, { tagCode: unit.tagCode, nextState: 'Sorted', location: 'Demo sorting station', note: marker });
            scanLaundryGarment(tenant, TENANT_ACTOR, { tagCode: unit.tagCode, nextState: 'Processing', location: 'Demo processing station', note: marker });
            scanLaundryGarment(tenant, TENANT_ACTOR, { tagCode: unit.tagCode, nextState: 'QC', location: 'Demo QC station', note: marker });
            scanLaundryGarment(tenant, TENANT_ACTOR, { tagCode: unit.tagCode, nextState: 'Rewash', location: 'Demo rewash station', note: marker });
          }
        }
      } else if (['Ready', 'Out for Delivery', 'Delivered'].includes(target)) {
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Picked Up', 'Demo lifecycle intake evidence');
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'In Process', 'Demo lifecycle production evidence');
        for (const [unitIndex, unit] of result.garmentUnits.entries()) for (const state of ['Sorted', 'Processing', 'QC', 'Assembly', 'Racked'] as const) scanLaundryGarment(tenant, TENANT_ACTOR, { tagCode: unit.tagCode, nextState: state, location: state === 'Racked' ? `DEMO-LIFECYCLE-RACK-${index + 1}-${unitIndex + 1}` : `Demo ${state} station`, note: marker });
        transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Ready', 'Demo lifecycle QC passed');
        if (target === 'Out for Delivery' && deliveryRider) {
          assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'delivery', riderId: deliveryRider.id });
          transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Out for Delivery', 'Demo lifecycle dispatch evidence');
        } else if (target === 'Delivered') transitionLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Delivered', 'Demo lifecycle handoff evidence');
      } else if (target === 'Cancelled') cancelLaundryOrder(tenant, TENANT_ACTOR, order.id, 'Customer cancelled before processing; demo lifecycle coverage');
    } catch (error) { console.warn(`[seed] lifecycle fixture ${index} skipped: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { created, orderIds };
}

function seedCustomerProgramCoverage(tenant: string) {
  const customers = store.rowsOf(tenant, 'party').filter((row) => row.data.is_customer && row.status !== 'Cancelled').slice(0, 8);
  let wallets = 0; let rewards = 0; let addresses = 0; let profiles = 0;
  for (const [index, customer] of customers.entries()) {
    const marker = `DEMO_CUSTOMER_PROGRAM_V4_8:${index}`;
    if (!String(customer.data.notes || '').includes(marker)) {
      updateLaundryCustomer(tenant, TENANT_ACTOR, customer.id, { preferredContact: index % 3 === 0 ? 'WhatsApp' : index % 3 === 1 ? 'Email' : 'Phone', marketingConsent: index % 2 === 0, servicePreferences: index % 2 ? 'Prefer evening pickup · handle delicate garments carefully' : 'Prefer WhatsApp updates · fold separately', notes: `${marker} · customer intelligence fixture` });
      profiles += 1;
    }
    if (!store.rowsOf(tenant, 'laundry_wallet_entry').some((row) => String(row.data.reason || '').startsWith(`${marker}:credit`))) {
      applyWalletCommand(tenant, TENANT_ACTOR, customer.id, { type: 'Credit', amount: 900 + index * 275, reason: `${marker}:credit · demo wallet top-up`, referenceType: 'demo', referenceId: marker });
      wallets += 1;
    }
    if (index < 5 && !store.rowsOf(tenant, 'laundry_wallet_entry').some((row) => String(row.data.reason || '').startsWith(`${marker}:debit`))) {
      applyWalletCommand(tenant, TENANT_ACTOR, customer.id, { type: 'Debit', amount: 150 + index * 50, reason: `${marker}:debit · demo wallet redemption`, referenceType: 'demo', referenceId: marker });
      wallets += 1;
    }
    if (index < 4 && !store.rowsOf(tenant, 'laundry_reward_entry').some((row) => String(row.data.reason || '').startsWith(`${marker}:rewards`))) {
      adjustRewards(tenant, TENANT_ACTOR, customer.id, { points: 120 + index * 85, reason: `${marker}:rewards · demo loyalty activity`, referenceType: 'demo', referenceId: marker });
      rewards += 1;
    }
    if (!store.listCustomerAddresses(tenant, customer.id).some((address) => address.line1.includes(marker))) {
      saveLaundryCustomerAddress(tenant, TENANT_ACTOR, customer.id, { label: 'Home', line1: `${index + 10} ${marker} Residency`, line2: 'Demo Park', city: 'Kolkata', state: 'West Bengal', postalCode: `7000${String(10 + index).slice(-2)}`, isDefault: true });
      addresses += 1;
      if (index < 3) { saveLaundryCustomerAddress(tenant, TENANT_ACTOR, customer.id, { label: 'Office', line1: `${index + 40} ${marker} Business Centre`, city: 'Kolkata', state: 'West Bengal', postalCode: `7000${String(40 + index).slice(-2)}` }); addresses += 1; }
    }
  }
  return { wallets, rewards, addresses, profiles, walletEntries: store.rowsOf(tenant, 'laundry_wallet_entry').filter((row) => row.status !== 'Cancelled').length, rewardEntries: store.rowsOf(tenant, 'laundry_reward_entry').filter((row) => row.status !== 'Cancelled').length, addressCount: store.listCustomerAddresses(tenant).length };
}

function seedPrintCoverage(tenant: string) {
  const order = store.rowsOf(tenant, 'laundry_order').find((row) => row.data.state !== 'Cancelled' && store.listGarmentUnits(tenant, { orderId: row.id }).length);
  if (!order) return { created: 0, total: store.listPrintJobs(tenant).length };
  const unit = store.listGarmentUnits(tenant, { orderId: order.id })[0];
  const jobs: Array<{ marker: string; documentType: string; status: 'Queued' | 'Rendering' | 'Printed' | 'Downloaded' | 'Failed' | 'Cancelled'; failureReason?: string; tagIds?: string[] }> = [
    { marker: 'DEMO_PRINT_V4_8:queued-tags', documentType: 'garment-tags', status: 'Queued', tagIds: [unit.activeTagCode] },
    { marker: 'DEMO_PRINT_V4_8:rendering-invoice', documentType: 'invoice', status: 'Rendering' },
    { marker: 'DEMO_PRINT_V4_8:printed-invoice', documentType: 'invoice', status: 'Printed' },
    { marker: 'DEMO_PRINT_V4_8:downloaded-mini', documentType: 'mini-invoice', status: 'Downloaded' },
    { marker: 'DEMO_PRINT_V4_8:failed-correction', documentType: 'correction', status: 'Failed', failureReason: 'Demo printer offline; retry from Print Centre' },
    { marker: 'DEMO_PRINT_V4_8:cancelled-invoice', documentType: 'invoice', status: 'Cancelled' },
  ];
  let created = 0;
  for (const job of jobs) {
    if (store.listPrintJobs(tenant).some((row) => String(row.evidence || '').startsWith(job.marker))) continue;
    try { createLaundryPrintJob(tenant, TENANT_ACTOR, { orderId: order.id, documentType: job.documentType, status: job.status, tagIds: job.tagIds, failureReason: job.failureReason, evidence: job.marker, requestedCopies: job.status === 'Printed' ? 2 : 1 }); created += 1; } catch (error) { console.warn(`[seed] print fixture ${job.marker} skipped: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { created, total: store.listPrintJobs(tenant).length };
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
  const configured = supplierTaxProfile(tenant);
  const profile = configured?.registrationStatus === 'Registered' && configured.gstin ? configured : ((saveSupplierTaxProfile(tenant, TENANT_ACTOR, { legalName: 'Epic Laundry Demo Workspace', tradeName: 'Epic Laundry Demo', address: 'Demo Operations Centre, Kolkata, West Bengal', stateCode: '29', pincode: '700001', registrationStatus: 'Registered', gstin: '29AAAAA0000A1Z5', invoiceSeries: 'DEMO', einvoiceState: 'Sandbox' }) as any).data);
  // This isolated seed intentionally opts the demo counter into its clearly
  // marked sandbox GST profile. Production remains fail-closed until its
  // owner supplies a real registered supplier profile.
  store.saveStoreSettings(tenant, TENANT_ACTOR, { taxMode: 'gst', gstin: profile.gstin || '' });
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

function seedWorkforce(tenant: string) {
  const staff = [
    ['Riya Sen', 'Front Desk', 'Counter lead', 26000], ['Arjun Das', 'Production', 'Wash & fold operator', 22000],
    ['Madhuri Roy', 'Production', 'Dry-clean specialist', 28000], ['Soham Ghosh', 'Production', 'Press operator', 21000],
    ['Nandita Paul', 'Quality', 'QC supervisor', 30000], ['Amit Dey', 'Dispatch', 'Route coordinator', 24000],
    ['Farhan Ali', 'Dispatch', 'Pickup rider', 19000], ['Priyanka Bose', 'Dispatch', 'Delivery rider', 19500],
    ['Kunal Saha', 'Production', 'Assembly operator', 20500], ['Ishita Mukherjee', 'Customer Care', 'Customer care executive', 23000],
    ['Debashis Mondal', 'Finance', 'Accounts assistant', 27000], ['Tania Gupta', 'Management', 'Store manager', 42000],
  ] as const;
  let employeesCreated = 0; let attendanceCreated = 0; let salaryDraftsCreated = 0;
  const employeeIds: string[] = [];
  for (const [index, [name, department, designation, basic]] of staff.entries()) {
    const marker = `DEMO_HR_V4_5:${index}`;
    const legacyMarker = `DEMO_HR_V4_4:${index}`;
    let employee = store.rowsOf(tenant, 'employee').find((row) => [marker, legacyMarker].includes(String(row.data.demo_fixture || '')));
    if (!employee) {
      const salary = createRow(tenant, TENANT_ACTOR, 'salary_structure', { name: `${name} · Demo FY26`, basic, hra: Math.round(basic * 0.4), da: Math.round(basic * 0.1), other_allowances: Math.round(basic * 0.08), pf_pct: 12, esi_pct: 3.25, tds_pct: 0, professional_tax: 200 });
      employee = createRow(tenant, TENANT_ACTOR, 'employee', { employee_code: `DEMO-EMP-${String(index + 1).padStart(3, '0')}`, name, department, designation, date_of_joining: day(-360 - index * 11), phone: `900003${String(1000 + index).slice(-4)}`, email: `demo.staff${index + 1}@example.test`, uan: `1000${String(index + 1).padStart(8, '0')}`, salary_structure: salary.id, is_active: true, demo_fixture: marker });
      employeesCreated += 1;
    }
    employeeIds.push(employee.id);
    for (let dayIndex = 0; dayIndex < 6; dayIndex += 1) {
      const attendanceDate = day(-dayIndex);
      if (store.rowsOf(tenant, 'attendance').some((row) => row.data.employee === employee!.id && row.data.date === attendanceDate && row.status !== 'Cancelled')) continue;
      const status = dayIndex === 0 ? (index % 7 === 0 ? 'On Leave' : index % 6 === 0 ? 'Absent' : index % 5 === 0 ? 'Half Day' : 'Present') : (index + dayIndex) % 9 === 0 ? 'Absent' : 'Present';
      try { markLaundryAttendance(tenant, TENANT_ACTOR, { employee: employee.id, date: attendanceDate, status, shift: index % 3 === 0 ? 'Morning' : 'Day', inTime: status === 'Present' ? '09:00' : '', outTime: status === 'Present' ? '18:00' : '', workingHours: status === 'Present' ? 8 : status === 'Half Day' ? 4 : 0, note: `Demo workforce evidence ${VERSION}` }); attendanceCreated += 1; } catch (error) { console.warn(`[seed] attendance fixture ${index}/${dayIndex} skipped: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const period = '2026-08';
    const salaryMarker = `DEMO_PAYROLL_V4_5:${index}`;
    const legacySalaryMarker = `DEMO_PAYROLL_V4_4:${index}`;
    if (!store.rowsOf(tenant, 'salary_slip').some((row) => [salaryMarker, legacySalaryMarker].includes(String(row.data.demo_fixture || '')))) { createRow(tenant, TENANT_ACTOR, 'salary_slip', { employee: employee.id, period, paid_days: 30, payment_mode: 'Bank', status: 'Draft', demo_fixture: salaryMarker }); salaryDraftsCreated += 1; }
  }
  const leaveTypes = [['Casual Leave', 12], ['Sick Leave', 10], ['Earned Leave', 15]] as const;
  const leaveIds = leaveTypes.map(([name, max]) => { const existing = store.rowsOf(tenant, 'leave_type').find((row) => String(row.data.demo_fixture || '') === `DEMO_LEAVE_TYPE_V4_4:${name}`); return existing || createRow(tenant, TENANT_ACTOR, 'leave_type', { name, max_days_per_year: max, is_carry_forward: name === 'Earned Leave', requires_approval: true, color: name === 'Sick Leave' ? '#d86b4d' : '#3a7d78', demo_fixture: `DEMO_LEAVE_TYPE_V4_4:${name}` }); });
  for (const [index, employeeId] of employeeIds.entries()) for (const [leaveIndex, leaveType] of leaveIds.entries()) if (index < 6 && !store.rowsOf(tenant, 'leave_balance').some((row) => row.data.employee === employeeId && row.data.leave_type === leaveType.id && row.data.fiscal_year === '2026-27')) createRow(tenant, TENANT_ACTOR, 'leave_balance', { employee: employeeId, leave_type: leaveType.id, fiscal_year: '2026-27', entitled_days: leaveTypes[leaveIndex][1], carried_forward: leaveIndex === 2 ? 2 : 0, availed_days: index % 4 === leaveIndex ? 1 : 0 });
  return { employeesCreated, attendanceCreated, salaryDraftsCreated, employees: employeeIds.length };
}

function seedHrDepthCoverage(tenant: string) {
  const employees = store.rowsOf(tenant, 'employee').filter((row) => row.data.is_active).slice(0, 8);
  const leaveTypes = store.rowsOf(tenant, 'leave_type').filter((row) => row.status !== 'Cancelled');
  let leaveApplications = 0; let expenseClaims = 0; let loans = 0; let jobOpenings = 0; let applicants = 0; let interviews = 0;
  if (employees.length && leaveTypes.length) {
    const leaveFixtures = [
      ['DEMO_HR_DEPTH_LEAVE:0', 0, '2026-09-14', '2026-09-15', 'Family commitment', 'Submitted'],
      ['DEMO_HR_DEPTH_LEAVE:1', 1, '2026-08-21', '2026-08-21', 'Medical appointment', 'Approved'],
      ['DEMO_HR_DEPTH_LEAVE:2', 2, '2026-07-06', '2026-07-08', 'Planned rest', 'Rejected'],
    ] as const;
    for (const [marker, employeeIndex, from, to, reason, status] of leaveFixtures) {
      if (store.rowsOf(tenant, 'leave_application').some((row) => row.data.demo_fixture === marker)) continue;
      createRow(tenant, TENANT_ACTOR, 'leave_application', { employee: employees[employeeIndex % employees.length].id, leave_type: leaveTypes[employeeIndex % leaveTypes.length].id, from_date: from, to_date: to, total_days: from === to ? 1 : 2, reason, status, demo_fixture: marker });
      leaveApplications += 1;
    }
  }
  for (let index = 0; index < Math.min(3, employees.length); index += 1) {
    const marker = `DEMO_HR_DEPTH_EXPENSE:${index}`;
    if (!store.rowsOf(tenant, 'expense_claim').some((row) => row.data.demo_fixture === marker)) { createRow(tenant, TENANT_ACTOR, 'expense_claim', { employee: employees[index].id, posting_date: day(-(index + 2)), items: [{ expense_category: index === 0 ? 'Travel' : index === 1 ? 'Meals' : 'Supplies', amount: 420 + index * 310, date: day(-(index + 2)), description: 'Demo reimbursable staff expense', receipt_attached: index !== 1 }], total_amount: 420 + index * 310, status: index === 0 ? 'Submitted' : index === 1 ? 'Approved' : 'Paid', payment_mode: index === 2 ? 'Bank' : undefined, demo_fixture: marker }); expenseClaims += 1; }
  }
  for (let index = 0; index < Math.min(2, employees.length); index += 1) {
    const marker = `DEMO_HR_DEPTH_LOAN:${index}`;
    if (!store.rowsOf(tenant, 'employee_loan').some((row) => row.data.demo_fixture === marker)) { const principal = 12000 + index * 8000; createRow(tenant, TENANT_ACTOR, 'employee_loan', { employee: employees[index].id, loan_type: index === 0 ? 'Salary Advance' : 'Personal Loan', principal_amount: principal, interest_rate: index === 0 ? 0 : 8, repayment_mode: 'Salary Deduction', installment_amount: Math.round(principal / (index === 0 ? 4 : 8)), start_date: day(-30), total_installments: index === 0 ? 4 : 8, paid_installments: index, balance_amount: Math.max(0, principal - index * Math.round(principal / (index === 0 ? 4 : 8))), status: 'Active', demo_fixture: marker }); loans += 1; }
  }
  const jobMarkers = ['DEMO_HR_DEPTH_JOB:0', 'DEMO_HR_DEPTH_JOB:1'];
  const jobIds: string[] = [];
  for (const [index, marker] of jobMarkers.entries()) {
    let job = store.rowsOf(tenant, 'job_opening').find((row) => row.data.demo_fixture === marker);
    if (!job) { job = createRow(tenant, TENANT_ACTOR, 'job_opening', { title: index === 0 ? 'Laundry Care Associate' : 'Route Operations Coordinator', department: index === 0 ? 'Production' : 'Dispatch', designation: index === 0 ? 'Care associate' : 'Route coordinator', description: 'Demo recruitment pipeline fixture', requirements: 'Customer care, laundry operations and shift discipline', min_experience: index, max_experience: index + 3, salary_min: 18000, salary_max: 32000, employment_type: 'Full-time', status: index === 0 ? 'Open' : 'On Hold', demo_fixture: marker }); job.data.demo_fixture = marker; job.updated_at = new Date().toISOString(); store.updateRow(job); jobOpenings += 1; }
    jobIds.push(job.id);
  }
  for (let index = 0; index < 4; index += 1) {
    const marker = `DEMO_HR_DEPTH_APPLICANT:${index}`;
    let applicant = store.rowsOf(tenant, 'job_applicant').find((row) => row.data.demo_fixture === marker);
    if (!applicant && jobIds.length) { applicant = createRow(tenant, TENANT_ACTOR, 'job_applicant', { job_opening: jobIds[index % jobIds.length], applicant_name: ['Ananya Ghosh', 'Rahul Nair', 'Meera Das', 'Vikram Saha'][index], email: `candidate${index + 1}@example.test`, phone: `900004${String(1000 + index).slice(-4)}`, experience_years: index + 1, current_ctc: 18000 + index * 2000, expected_ctc: 22000 + index * 2500, status: ['Applied', 'Screening', 'Interview', 'Offer'][index], applied_on: day(-(index + 5)), demo_fixture: marker }); applicant.data.demo_fixture = marker; applicant.updated_at = new Date().toISOString(); store.updateRow(applicant); applicants += 1; }
    if (applicant && index < 3 && employees.length && !store.rowsOf(tenant, 'interview').some((row) => row.data.demo_fixture === `DEMO_HR_DEPTH_INTERVIEW:${index}`)) { createRow(tenant, TENANT_ACTOR, 'interview', { job_applicant: applicant.id, round: index === 0 ? 'Screening' : index === 1 ? 'Technical 1' : 'HR', interviewer: employees[employees.length - 1].id, scheduled_on: day(index + 1), duration_minutes: 30, status: index === 2 ? 'Completed' : index === 1 ? 'Rescheduled' : 'Scheduled', feedback: index === 2 ? 'Demo interview completed; decision pending.' : undefined, rating: index === 2 ? 'Yes' : undefined, demo_fixture: `DEMO_HR_DEPTH_INTERVIEW:${index}` }); interviews += 1; }
  }
  return { leaveApplications, expenseClaims, loans, jobOpenings, applicants, interviews };
}

function seedCarePackages(tenant: string) {
  const catalogue = laundryCatalogue(tenant);
  const customers = store.rowsOf(tenant, 'party').filter((row) => row.data.is_customer && row.status !== 'Cancelled');
  const pairs = (catalogue.prices as Array<Record<string, any>>).filter((price) => catalogue.garments.some((item) => item.id === price.garment) && catalogue.services.some((item) => item.id === price.service));
  if (customers.length < 3 || pairs.length < 3) return { definitions: 0, assignments: 0, redemptions: 0, definitionsCreated: 0, assignmentsCreated: 0, redemptionsCreated: 0 };
  const definitions = [
    ['Fresh Fold Pass', 'A practical starter allowance for everyday counter customers.', 1499, 45, 0],
    ['Executive Care Club', 'Priority dry-clean care for repeat customers.', 3299, 60, 1],
    ['Home Linen Saver', 'A seasonal allowance for larger household pieces.', 2499, 90, 2],
  ] as const;
  const packageIds: string[] = [];
  let definitionsCreated = 0;
  for (const [name, description, price, validityDays, pairIndex] of definitions) {
    const marker = `DEMO_PACKAGE_DEF_V4_5:${pairIndex}`;
    let definition = store.rowsOf(tenant, 'service_package').find((row) => String(row.data.demo_fixture || '') === marker);
    if (!definition) {
      const pair = pairs[pairIndex % pairs.length];
      const created = createServicePackage(tenant, TENANT_ACTOR, { name, description, price, validityDays, services: [{ garment: String(pair.garment), service: String(pair.service), allowance: pairIndex === 2 ? 4 : pairIndex === 1 ? 3 : 5 }] });
      definition = store.getRow(tenant, created.id);
      if (definition) { definition.data.demo_fixture = marker; definition.updated_at = new Date().toISOString(); store.updateRow(definition); definitionsCreated += 1; }
    }
    if (definition) packageIds.push(definition.id);
  }
  let assignmentsCreated = 0; let redemptionsCreated = 0;
  const purchaseSpecs = [
    { customer: customers[0].id, packageIndex: 0, purchaseDate: day(-8), pricePaid: 1499, paymentMode: 'UPI' as const, redeemed: true },
    { customer: customers[1].id, packageIndex: 1, purchaseDate: day(-22), pricePaid: 1200, paymentMode: 'Cash' as const, redeemed: true },
    { customer: customers[2].id, packageIndex: 2, purchaseDate: day(-125), pricePaid: 2499, paymentMode: 'Card' as const, redeemed: false },
  ];
  for (const [index, spec] of purchaseSpecs.entries()) {
    const marker = `DEMO_PACKAGE_ASSIGNMENT_V4_5:${index}`;
    let assignment = store.rowsOf(tenant, 'customer_package').find((row) => String(row.data.demo_fixture || '') === marker);
    const packageId = packageIds[spec.packageIndex];
    if (!packageId) continue;
    if (!assignment) {
      const created = purchaseServicePackage(tenant, TENANT_ACTOR, { customer: spec.customer, servicePackage: packageId, purchaseDate: spec.purchaseDate, pricePaid: spec.pricePaid, paymentMode: spec.paymentMode, reason: 'Demo package desk fixture' });
      assignment = store.getRow(tenant, created.id);
      if (assignment) { assignment.data.demo_fixture = marker; assignment.updated_at = new Date().toISOString(); store.updateRow(assignment); assignmentsCreated += 1; }
    }
    if (assignment && spec.redeemed && !store.rowsOf(tenant, 'package_redemption').some((row) => String(row.data.demo_fixture || '') === marker)) {
      const pair = pairs[spec.packageIndex % pairs.length];
      try {
        const redemption = redeemServicePackage(tenant, TENANT_ACTOR, { customerPackage: assignment.id, garment: String(pair.garment), service: String(pair.service), quantity: 1, reason: 'Demo package redemption' });
        const latest = redemption.redemptions[redemption.redemptions.length - 1];
        const row = latest ? store.getRow(tenant, latest.id) : undefined;
        if (row) { row.data.demo_fixture = marker; row.updated_at = new Date().toISOString(); store.updateRow(row); redemptionsCreated += 1; }
      } catch (error) { console.warn(`[seed] package redemption ${index} skipped: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { definitions: store.rowsOf(tenant, 'service_package').filter((row) => row.status !== 'Cancelled').length, assignments: store.rowsOf(tenant, 'customer_package').filter((row) => row.status !== 'Cancelled').length, redemptions: store.rowsOf(tenant, 'package_redemption').filter((row) => row.status !== 'Cancelled').length, definitionsCreated, assignmentsCreated, redemptionsCreated };
}

function seedDeliveryControls(tenant: string) {
  const deliveryRider = store.rowsOf(tenant, 'laundry_rider').find((row) => String(row.data.name) === 'Demo Route Delivery');
  let routeCreated = 0; let settlementsCreated = 0;
  if (deliveryRider && !store.rowsOf(tenant, 'laundry_route_run').some((row) => String(row.data.demo_fixture || '') === 'DEMO_ROUTE_V4_6:DELIVERY')) {
    const readyCandidates = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode !== 'Pickup Order' && row.data.state === 'Ready' && !row.data.delivery_rider);
    const zone = String(readyCandidates[0]?.data.service_zone || 'Central Kolkata');
    const ready = readyCandidates.filter((row) => String(row.data.service_zone || 'Central Kolkata').toLowerCase() === zone.toLowerCase()).slice(0, 3);
    if (ready.length) {
      for (const order of ready) assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'delivery', riderId: deliveryRider.id });
      try {
        const run = createRouteRun(tenant, TENANT_ACTOR, { riderId: deliveryRider.id, stage: 'Delivery', routeDate: day(1), orderIds: ready.map((row) => row.id), zone, notes: `Demo planned delivery route ${VERSION}` });
        const row = store.getRow(tenant, run.id);
        if (row) { row.data.demo_fixture = 'DEMO_ROUTE_V4_6:DELIVERY'; row.updated_at = new Date().toISOString(); store.updateRow(row); routeCreated += 1; }
      } catch (error) { console.warn(`[seed] planned delivery route skipped: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  const assignedOrders = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.pickup_rider || row.data.delivery_rider).slice(0, 3);
  for (const [index, order] of assignedOrders.entries()) {
    const riderId = String(order.data.delivery_rider || order.data.pickup_rider || '');
    const rider = store.getRow(tenant, riderId);
    const marker = `DEMO_RIDER_SETTLEMENT_V4_6:${index}`;
    if (!rider || store.rowsOf(tenant, 'laundry_rider_settlement').some((row) => String(row.data.demo_fixture || '') === marker)) continue;
    try {
      const settlement = saveLaundryRiderSettlement(tenant, TENANT_ACTOR, { rider: rider.id, date: day(-index - 1), amount: 850 + index * 425, method: index === 0 ? 'Cash' : index === 1 ? 'UPI' : 'Bank', status: index === 0 ? 'Reconciled' : index === 1 ? 'Handed Over' : 'Pending', orderIds: [order.id], reference: `DEMO-HANDOVER-${index + 1}`, notes: `Demo rider settlement control ${VERSION}` });
      const row = store.getRow(tenant, settlement.id);
      if (row) { row.data.demo_fixture = marker; row.updated_at = new Date().toISOString(); store.updateRow(row); settlementsCreated += 1; }
    } catch (error) { console.warn(`[seed] rider settlement ${index} skipped: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { routes: store.rowsOf(tenant, 'laundry_route_run').filter((row) => row.status !== 'Cancelled').length, settlements: store.rowsOf(tenant, 'laundry_rider_settlement').filter((row) => row.status !== 'Cancelled').length, routeCreated, settlementsCreated };
}

function seedCompletedRouteCoverage(tenant: string) {
  const marker = 'DEMO_ROUTE_V4_9:COMPLETED';
  if (store.rowsOf(tenant, 'laundry_route_run').some((row) => row.data.demo_fixture === marker)) return false;
  const rider = store.rowsOf(tenant, 'laundry_rider').find((row) => row.data.name === 'Demo Route Delivery');
  const candidates = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode !== 'Pickup Order' && row.data.state === 'Ready' && !row.data.delivery_rider);
  const zone = String(candidates[0]?.data.service_zone || 'Central Kolkata');
  const ready = candidates.filter((row) => String(row.data.service_zone || zone) === zone).slice(0, 3);
  if (!rider || !ready.length) return false;
  for (const order of ready) assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'delivery', riderId: rider.id });
  try {
    const run = createRouteRun(tenant, TENANT_ACTOR, { riderId: rider.id, stage: 'Delivery', routeDate: day(-1), zone, startTime: '10:00', minutesPerStop: 20, orderIds: ready.map((row) => row.id), notes: 'Completed demo delivery run for route analytics' });
    const started = startRouteRun(tenant, TENANT_ACTOR, run.id, rider.id);
    for (const stop of started.stops) completeRouteStop(tenant, TENANT_ACTOR, started.id, stop.id, { note: 'Demo delivery completed with recipient handoff' }, rider.id);
    const stored = store.getRow(tenant, run.id);
    if (stored) { stored.data.demo_fixture = marker; stored.updated_at = new Date().toISOString(); store.updateRow(stored); }
    return true;
  } catch (error) { console.warn(`[seed] completed route fixture skipped: ${error instanceof Error ? error.message : String(error)}`); return false; }
}

/** Add one persisted, reasoned route exception without inventing unsupported failure states. */
function seedRouteExceptionCoverage(tenant: string) {
  const marker = 'DEMO_ROUTE_V4_10:SKIPPED_STOP';
  if (store.rowsOf(tenant, 'laundry_route_stop').some((row) => row.data.demo_fixture === marker)) return false;
  const run = store.rowsOf(tenant, 'laundry_route_run').find((row) => row.data.status === 'In Progress');
  const stop = run ? store.rowsOf(tenant, 'laundry_route_stop').find((row) => row.data.route_run === run.id && row.data.status === 'Planned') : undefined;
  if (!run || !stop) return false;
  try {
    completeRouteStop(tenant, TENANT_ACTOR, run.id, stop.id, { status: 'Skipped', note: 'Demo exception: customer unavailable at handoff; coordinator follow-up required.' }, String(run.data.rider || ''));
    const stored = store.getRow(tenant, stop.id);
    if (stored) { stored.data.demo_fixture = marker; stored.updated_at = new Date().toISOString(); store.updateRow(stored); }
    return true;
  } catch (error) { console.warn(`[seed] route exception fixture skipped: ${error instanceof Error ? error.message : String(error)}`); return false; }
}

function seedMarketplace(tenant: string) {
  let device = store.getMarketplaceDevice(tenant);
  if (!device) { const enrollment = createDeviceEnrollment(); device = registerMarketplaceDevice(tenant, TENANT_ACTOR, { deviceId: enrollment.deviceId, vendorId: 'DEMO-VENDOR-001', station: 'Demo counter station', capabilities: { marketplaceSync: true, onlineOrders: true, settlements: true }, softwareVersion: '0.1.0-demo', credentialRef: 'demo-only-protected-credential', publicKey: enrollment.publicKey, status: 'Registered' }); }
  try { saveMarketplaceAvailability(tenant, TENANT_ACTOR, { state: 'Open', timezone: 'Asia/Kolkata', serviceZones: ['Central Kolkata', 'North Kolkata', 'South Kolkata'], capacity: { orders: 80, bags: 35, kg: 250, stops: 24 }, leadTimeMinutes: 90, staleAfterMinutes: 45, capabilities: { express: true, pickup: true, delivery: true } }); } catch (error) { console.warn(`[seed] availability fixture skipped: ${error instanceof Error ? error.message : String(error)}`); }
  const catalogue = laundryCatalogue(tenant); const garment = catalogue.garments[0]; const service = catalogue.services[0];
  if (garment && service && !listMarketplaceCatalogueMappings(tenant).length) saveMarketplaceCatalogueMapping(tenant, TENANT_ACTOR, { vendorId: 'DEMO-VENDOR-001', garmentId: garment.id, serviceId: service.id, marketplaceCategoryId: 'laundry-care', marketplaceServiceId: 'wash-care', publicName: `${garment.name} · ${service.name}`, publicDescription: 'Demo marketplace catalogue mapping', pricePaise: Math.round(Number(garment.rate || 250) * 100), pricingUnit: String(garment.unit || 'Piece'), minQuantityMilli: 1000, turnaroundMinutes: 1440, expressEligible: true, marketplaceVisible: true, version: 1, effectiveFrom: '2026-04-01', approvalStatus: 'Approved' });
  for (let index = 0; index < 12; index += 1) {
    const externalOrderId = `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`; if (store.listMarketplaceOrderProjections(tenant).some((row) => row.externalOrderId === externalOrderId)) continue;
    const states = ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'IntakeRequired', 'CustomerApprovalRequired', 'Processing', 'Ready', 'DeliveryScheduled'] as const;
    const eventId = `demo-marketplace-event-v4-${index}`;
    receiveMarketplaceOrder(tenant, TENANT_ACTOR, { eventId, source: 'demo-cloud', tenantId: tenant, vendorId: device.vendorId, storeId: store.currentStore(tenant), deviceId: device.id, aggregateType: 'marketplace_order', aggregateId: externalOrderId, aggregateVersion: 1, eventType: 'marketplace.order.created.v1', eventVersion: 1, occurredAt: `${day(-index)}T08:00:00.000Z`, correlationId: `demo-correlation-${index}`, payload: { externalOrderId, externalCustomerId: `demo-cloud-customer-${index}`, orderNumber: `MKT-${String(index + 1).padStart(5, '0')}`, channel: index % 3 === 0 ? 'CUSTOMER_APP' : index % 3 === 1 ? 'WEBSITE' : 'MARKETPLACE', state: states[index % states.length], customer: { name: `Online Demo Customer ${index + 1}`, phone: `900002${String(1000 + index).slice(-4)}` }, pickup: { address: `${index + 1} Marketplace Lane, Kolkata`, serviceZone: index % 2 ? 'Central Kolkata' : 'North Kolkata', fulfillmentMode: 'Home Delivery' }, request: { estimatedItems: index + 2, bags: 1 + (index % 3), expectedDeliveryDate: day(Math.max(1, index % 5)), notes: 'Demo online request; physical intake may change final quote' }, paymentState: index % 4 === 0 ? 'Pending' : 'Captured', acceptanceDeadline: `${day(1)}T18:00:00.000Z`, preferences: 'Handle with care', notes: 'Demo marketplace order' } });
  }
  for (let index = 0; index < 6; index += 1) { const externalOrderId = `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`; if (store.rowsOf(tenant, 'marketplace_settlement').some((row) => row.data.externalOrderId === externalOrderId)) continue; const settlementInput = { externalOrderId, policyVersion: VERSION, customerCollectedPaise: 120_000 + index * 15_000, refundPaise: index % 3 === 0 ? 5_000 : 0, refundAllocations: index % 3 === 0 ? [{ allocationId: `demo-refund-${index}`, amountPaise: 5_000, responsibility: 'Vendor' as const, reason: 'Demo quality adjustment' }] : [], vendorServiceGrossPaise: 100_000 + index * 10_000, vendorFundedDiscountPaise: 2_000, platformFundedPromotionPaise: 5_000, commissionBps: 1500, paymentFeePaise: 1_500, withholdingPaise: 100, adjustmentsPaise: 0 }; recordMarketplaceSettlement(tenant, TENANT_ACTOR, settlementInput); if (index < 2) recordMarketplaceCashCollection(tenant, TENANT_ACTOR, { collectionId: `demo-cash-collection-v4-${index}`, externalOrderId, amountPaise: 120_000 + index * 15_000, method: index === 0 ? 'CashOnPickup' : 'CashOnDelivery', collectedBy: index === 0 ? 'Demo Route Pickup' : 'Demo Route Delivery', evidence: `DEMO-EVIDENCE-${index}` }); }
  for (let index = 0; index < 5; index += 1) { const externalOrderId = `DEMO-MKT-V4-${String(index + 1).padStart(3, '0')}`; const alreadyQueued = store.listSyncOutbox(tenant).some((event) => event.aggregateId === externalOrderId && event.eventType === 'marketplace.order.demo-note.v1'); if (!alreadyQueued) queueMarketplaceEvent(tenant, TENANT_ACTOR, { aggregateType: 'marketplace_order', aggregateId: externalOrderId, aggregateVersion: 2, eventType: 'marketplace.order.demo-note.v1', payload: { externalOrderId, demo: true, note: 'Pending demo outbound event for sync dashboard' } }); }
  return { projections: store.listMarketplaceOrderProjections(tenant).length, settlements: store.rowsOf(tenant, 'marketplace_settlement').length };
}

export function seedLaundryDemoExpansion(tenant: string) {
  if (tenant !== 'T1' || process.env.EPIC_WORKSPACE_MODE !== 'demo') return { seeded: false, reason: 'not-demo' };
  const existingMarker = store.getRow(tenant, markerId);
  if (existingMarker) return { seeded: false, reason: 'already-seeded', version: VERSION, counts: existingMarker.data.counts };
  const orders = expandOrders(tenant);
  const lifecycle = seedLifecycleCoverage(tenant);
  const financeOrders = seedCanonicalFinance(tenant, [...orders.orderIds, ...lifecycle.orderIds]);
  const expenses = seedExpenses(tenant);
  const statutory = seedStatutory(tenant);
  const quality = seedQualityAndReturns(tenant);
  const workforce = seedWorkforce(tenant);
  const hrDepth = seedHrDepthCoverage(tenant);
  const packages = seedCarePackages(tenant);
  const marketplace = seedMarketplace(tenant);
  const deliveryControls = seedDeliveryControls(tenant);
  const customerPrograms = seedCustomerProgramCoverage(tenant);
  const printCoverage = seedPrintCoverage(tenant);
  const pickupRider = store.rowsOf(tenant, 'laundry_rider').find((row) => row.data.name === 'Demo Route Pickup');
  const unassignedPickup = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode === 'Pickup Order' && row.data.state === 'Booked' && !row.data.pickup_rider);
  for (const order of unassignedPickup.slice(0, 2)) if (pickupRider) assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'pickup', riderId: pickupRider.id });
  const bookedPickup = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode === 'Pickup Order' && row.data.state === 'Booked' && row.data.pickup_rider);
  for (const zone of [['Central Kolkata', 'CENTRAL'], ['North Kolkata', 'NORTH']] as const) if (!store.rowsOf(tenant, 'laundry_service_zone').some((row) => String(row.data.name) === zone[0])) createServiceZone(tenant, TENANT_ACTOR, { name: zone[0], code: zone[1], pickupWindow: '09:00–13:00', deliveryWindow: '16:00–20:00', notes: 'Demo route planning zone' });
  if (bookedPickup.length && pickupRider && store.rowsOf(tenant, 'laundry_route_run').length === 0) { const routeZone = String(bookedPickup[0].data.service_zone || 'Central Kolkata'); const routeOrders = bookedPickup.filter((row) => String(row.data.service_zone || '') === routeZone).slice(0, 3); if (routeOrders.length) { const run = createRouteRun(tenant, TENANT_ACTOR, { riderId: pickupRider.id, stage: 'Pickup', routeDate: day(0), orderIds: routeOrders.map((row) => row.id), zone: routeZone, notes: `Demo route fixture ${VERSION}` }); const started = startRouteRun(tenant, TENANT_ACTOR, run.id, pickupRider.id); for (const stop of started.stops) completeRouteStop(tenant, TENANT_ACTOR, started.id, stop.id, { note: 'Demo pickup completed' }, pickupRider.id); } }
  if (store.rowsOf(tenant, 'laundry_route_run').length === 0) { const deliveryRider = store.rowsOf(tenant, 'laundry_rider').find((row) => row.data.name === 'Demo Route Delivery'); const readyOrders = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.fulfillment_mode !== 'Pickup Order' && row.data.state === 'Ready' && !row.data.delivery_rider); const routeZone = String(readyOrders[0]?.data.service_zone || 'Central Kolkata'); const deliveryOrders = readyOrders.filter((row) => String(row.data.service_zone || 'Central Kolkata') === routeZone).slice(0, 3); if (deliveryRider && deliveryOrders.length) { for (const order of deliveryOrders) assignLaundryOrder(tenant, TENANT_ACTOR, order.id, { stage: 'delivery', riderId: deliveryRider.id }); try { const run = createRouteRun(tenant, TENANT_ACTOR, { riderId: deliveryRider.id, stage: 'Delivery', routeDate: day(0), orderIds: deliveryOrders.map((row) => row.id), zone: routeZone, notes: `Demo delivery route fixture ${VERSION}` }); const started = startRouteRun(tenant, TENANT_ACTOR, run.id, deliveryRider.id); if (started.stops[0]) completeRouteStop(tenant, TENANT_ACTOR, started.id, started.stops[0].id, { note: 'Demo delivery completed' }, deliveryRider.id); } catch (error) { console.warn(`[seed] delivery route fixture skipped: ${error instanceof Error ? error.message : String(error)}`); } } }
  const stateBreakdown = store.rowsOf(tenant, 'laundry_order').reduce<Record<string, number>>((acc, row) => { const state = String(row.data.state || row.status || 'Booked'); acc[state] = (acc[state] || 0) + 1; return acc; }, {});
  const counts = { orders: store.rowsOf(tenant, 'laundry_order').length, newOrders: orders.created + lifecycle.created, lifecycleCoverageAdded: lifecycle.created, orderStateBreakdown: stateBreakdown, canonicalInvoices: store.rowsOf(tenant, 'canonical_invoice_snapshot').length, expenses: store.rowsOf(tenant, 'laundry_expense').length, tds: store.rowsOf(tenant, 'finance_tds_transaction').length, tcs: store.rowsOf(tenant, 'finance_tcs_transaction').length, returns: store.rowsOf(tenant, 'finance_statutory_return').length, qualityClaims: store.rowsOf(tenant, 'laundry_quality_claim').length, returnCases: store.rowsOf(tenant, 'laundry_return_case').length, marketplaceOrders: marketplace.projections, settlements: marketplace.settlements, marketplaceCashCollections: store.rowsOf(tenant, 'marketplace_cash_collection').length, routes: deliveryControls.routes, riderSettlements: deliveryControls.settlements, employees: workforce.employees, attendance: store.rowsOf(tenant, 'attendance').length, salaryDrafts: store.rowsOf(tenant, 'salary_slip').length, hrDepth, servicePackages: packages.definitions, customerPackages: packages.assignments, packageRedemptions: packages.redemptions, walletEntries: customerPrograms.walletEntries, rewardEntries: customerPrograms.rewardEntries, customerAddresses: customerPrograms.addressCount, printJobs: printCoverage.total, expensesAdded: expenses, statutoryTransactionsAdded: statutory, canonicalInvoicesAdded: financeOrders, qualityAdded: quality, workforceAdded: workforce, packagesAdded: packages, deliveryControlsAdded: deliveryControls, customerProgramsAdded: customerPrograms, printCoverageAdded: printCoverage };
  store.insertRow({ id: markerId, entity: 'demo_seed_marker', tenant, status: 'Active', version: 1, created_by: TENANT_ACTOR, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), data: { version: VERSION, counts, purpose: 'Expanded offline demo workspace for operational, finance, compliance and marketplace visualisation. Demo-only; no provider or filing evidence.' } });
  console.log(`[seed] ${VERSION} expanded demo dataset`, counts);
  return { seeded: true, version: VERSION, counts };
}

/** Additive lifecycle fixtures also run when an older demo seed is already installed. */
export function seedLaundryDemoLifecycleCoverage(tenant: string) {
  if (tenant !== 'T1' || process.env.EPIC_WORKSPACE_MODE !== 'demo') return { seeded: false, reason: 'not-demo' };
  const coverage = seedLifecycleCoverage(tenant);
  const canonicalInvoicesAdded = seedCanonicalFinance(tenant, coverage.orderIds);
  return { seeded: coverage.created > 0 || canonicalInvoicesAdded > 0, version: 'DEMO-DATA-V4.7', coverageAdded: coverage.created, canonicalInvoicesAdded };
}

/** Additive customer-program and print-history fixtures for older demo installs. */
export function seedLaundryDemoExperienceCoverage(tenant: string) {
  if (tenant !== 'T1' || process.env.EPIC_WORKSPACE_MODE !== 'demo') return { seeded: false, reason: 'not-demo' };
  const completedRoute = seedCompletedRouteCoverage(tenant);
  const routeException = seedRouteExceptionCoverage(tenant);
  const hrDepth = seedHrDepthCoverage(tenant);
  const customerPrograms = seedCustomerProgramCoverage(tenant);
  const printCoverage = seedPrintCoverage(tenant);
  return { seeded: completedRoute || routeException || hrDepth.leaveApplications > 0 || hrDepth.expenseClaims > 0 || hrDepth.loans > 0 || hrDepth.jobOpenings > 0 || customerPrograms.wallets > 0 || customerPrograms.addresses > 0 || printCoverage.created > 0, version: 'DEMO-DATA-V4.10', completedRoute, routeException, hrDepth, customerPrograms, printCoverage };
}
