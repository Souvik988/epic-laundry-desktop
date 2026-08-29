import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'epic-catalogue-test-'));
process.env.EPIC_DATA_FILE = join(tempDir, 'epic.json');
let closeStore: (() => void) | undefined;

try {
  const { store } = await import('./kernel/store.js');
  closeStore = () => store.close();
  const {
    bookLaundryOrder, importLaundryCatalogue, importLaundryPrices, laundryCatalogue, listLaundryImportJobs, quoteLaundryOrder,
    saveLaundryCategory, saveLaundryChargeRule, saveLaundryDiscountRule, saveLaundryGarment, saveLaundryPrice,
    saveLaundryService, saveLaundryTaxRule, seedLaundryDefaults,
  } = await import('./modules/laundry/domain.js');

  const tenant = 'CATALOGUE';
  const actor = 'catalogue-owner';
  seedLaundryDefaults(tenant);
  const initial = laundryCatalogue(tenant);
  const mensWear = initial.categories.find((category: any) => category.name === "Men's Wear")!;
  const steamIron = initial.services.find((service: any) => service.name === 'Steam Iron')!;
  const shirt = initial.garments.find((garment: any) => garment.name === 'Shirt / T-shirt')!;

  const category = saveLaundryCategory(tenant, actor, { name: 'Delicate items', color: '#664CF0', sortOrder: 8 });
  assert.equal((category as any).color, '#664CF0', 'category metadata is persisted');
  assert.throws(() => saveLaundryCategory(tenant, actor, { name: 'delicate ITEMS' }), /already exists/, 'category names are constrained case-insensitively');

  const service = saveLaundryService(tenant, actor, { name: 'Premium Steam', description: 'Finishing for delicate fabrics', units: ['Piece', 'Pair'] });
  const garment = saveLaundryGarment(tenant, actor, { name: 'Silk scarf', code: 'SILK-SCARF', category: category.id, unit: 'Piece', photo: '/ui/app/garments/lndry-folded-shirt-v3.png' });
  assert.equal((garment as any).photo, '/ui/app/garments/lndry-folded-shirt-v3.png', 'only approved local garment assets are accepted');
  const uploadedGarment = saveLaundryGarment(tenant, actor, { name: 'Upload-safe tie', code: 'UPLOAD-TIE', category: category.id, unit: 'Piece', photo: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.match(String((uploadedGarment as any).photo), /^data:image\/png;base64,/, 'validated local image data can be stored with garment metadata');
  assert.throws(() => saveLaundryGarment(tenant, actor, { name: 'Unsafe asset', category: category.id, unit: 'Piece', photo: 'https://example.test/image.png' }), /approved local application asset/, 'external image URLs cannot be stored as attachment metadata');

  const generalPrice = saveLaundryPrice(tenant, actor, { garment: garment.id, service: service.id, rate: 89 });
  assert.equal((generalPrice as any).rate, 89, 'general price rule is persisted');
  assert.throws(() => saveLaundryPrice(tenant, actor, { garment: garment.id, service: service.id, rate: 99 }), /matching general/, 'duplicate price rules are rejected');
  const seededCustomerOrder = bookLaundryOrder(tenant, actor, { customer: { name: 'Special price customer', phone: '9000000501' }, items: [{ garment: shirt.id, service: steamIron.id, qty: 1 }], expectedDeliveryDate: '2026-09-01', fulfillmentMode: 'Home Delivery' });
  const customer = seededCustomerOrder.order.customer.id ? store.getRow(tenant, seededCustomerOrder.order.customer.id) : undefined;
  if (!customer) throw new Error('customer booking setup failed');
  const specialPrice = saveLaundryPrice(tenant, actor, { garment: garment.id, service: service.id, customer: customer.id, rate: 69 });
  const specialQuote = quoteLaundryOrder(tenant, { items: [{ garment: garment.id, service: service.id, qty: 1 }] }, customer.id);
  assert.equal(specialQuote.items[0].rate, 69, 'customer-specific price takes precedence');
  assert.equal(specialQuote.items[0].priceRule, specialPrice.id, 'quoted item persists the applied price rule identity');

  const charge = saveLaundryChargeRule(tenant, actor, { name: 'Express handling', type: 'Percentage', amount: 10 });
  const discount = saveLaundryDiscountRule(tenant, actor, { name: 'Loyalty saving', type: 'Flat', amount: 5 });
  const tax = saveLaundryTaxRule(tenant, actor, { name: 'Standard GST', rate: 5 });
  const governedQuote = quoteLaundryOrder(tenant, { items: [{ garment: garment.id, service: service.id, qty: 1 }], chargeRuleIds: [charge.id], discountRuleIds: [discount.id], taxRuleId: tax.id }, customer.id);
  assert.deepEqual({ charges: governedQuote.charges, discounts: governedQuote.discounts, taxRate: governedQuote.taxRate, grandTotal: governedQuote.grandTotal }, { charges: 6.9, discounts: 5, taxRate: 5, grandTotal: 74.45 }, 'selected charge, discount, and tax rules calculate server-side');

  const booked = bookLaundryOrder(tenant, actor, { customer: { name: 'Historic rate customer', phone: '9000000551' }, items: [{ garment: shirt.id, service: steamIron.id, qty: 1 }], expectedDeliveryDate: '2026-09-01', fulfillmentMode: 'Home Delivery' });
  const existingShirtPrice = initial.prices.find((price: any) => price.garment === shirt.id && price.service === steamIron.id)!;
  saveLaundryPrice(tenant, actor, { garment: shirt.id, service: steamIron.id, rate: 32 }, existingShirtPrice.id);
  const historical = store.getRow(tenant, booked.order.id)!;
  assert.equal(historical.data.items[0].rate, 16, 'later master-price edits never rewrite booked order prices');
  assert.equal(Boolean(historical.data.items[0].priceRule), true, 'booked items retain their applied price-rule reference');

  const imported = importLaundryPrices(tenant, actor, [
    { garmentName: 'Imported cover', categoryName: 'Household', serviceName: 'Dry Cleaning', rate: 120, unit: 'Piece' },
    { garmentName: '', serviceName: 'Dry Cleaning', rate: 120 },
  ]);
  assert.equal(imported.errors.length, 1, 'imports report row-level validation errors');
  assert.equal(imported.job?.status, 'Completed with errors', 'imports create a durable job record');
  const jobs = listLaundryImportJobs(tenant, 'prices');
  assert.equal(jobs[0]?.skippedRows, 1, 'import history retains actionable rejection counts');
  assert.equal(jobs[0]?.errors[0]?.row, 3, 'import history retains worksheet row references');
  const importedCatalogue = importLaundryCatalogue(tenant, actor, {
    categories: [{ id: 'owner-category-1', name: 'Imported premium', color: '#123456' }],
    services: [{ id: 'owner-service-1', name: 'Imported care', description: 'Owner supplied care', units: ['Piece'] }],
    garments: [{ id: 'owner-garment-1', name: 'Imported coat', code: 'IMPORTED-COAT', category: 'Imported premium', unit: 'Piece', hsn: '9997', gstRate: 5, photo: '/ui/app/garments/lndry-folded-blazer-v1.png' }],
    prices: [{ id: 'owner-price-1', garment: 'Imported coat', service: 'Imported care', rate: 275 }],
    taxRules: [{ id: 'owner-tax-1', name: 'Imported GST', rate: 5 }],
  });
  assert.equal(importedCatalogue.created >= 5, true, 'owner catalogue import creates the complete scoped master set');
  assert.equal(laundryCatalogue(tenant).prices.some((price: any) => price.garmentName === 'Imported coat' && price.serviceName === 'Imported care' && price.rate === 275), true, 'owner catalogue import resolves name references into active price rules');
  assert.equal(listLaundryImportJobs(tenant, 'catalogue')[0]?.status, 'Completed', 'owner catalogue import creates a durable completed import job');
  const beforeFailedImport = laundryCatalogue(tenant).garments.length;
  assert.throws(() => importLaundryCatalogue(tenant, actor, { garments: [{ name: 'Should roll back', category: 'Missing category', unit: 'Piece' }] }), /not found/, 'invalid owner catalogue references are rejected');
  assert.equal(laundryCatalogue(tenant).garments.length, beforeFailedImport, 'failed catalogue import restores the pre-import branch snapshot');
  assert.equal(laundryCatalogue(tenant).serviceUnits.includes('Kilogram'), true, 'all required service units are exposed to the owner desk');
  assert.equal(mensWear.id.length > 0, true, 'default catalogue remains readable after owner configuration commands');

  console.log('PASS  catalogue commands, governed pricing, snapshots, and import jobs self-test complete');
} finally {
  closeStore?.();
  rmSync(tempDir, { recursive: true, force: true });
}
