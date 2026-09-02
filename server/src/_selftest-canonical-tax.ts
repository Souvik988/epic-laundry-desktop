import assert from 'node:assert/strict';
const { calculateCanonicalTax } = await import('./modules/gst/canonical-tax.js');
const lines = [{ id: 'service', description: 'Laundry service', classificationType: 'SAC' as const, classificationCode: '9997', quantityMilli: 1500, unit: 'kg', unitPricePaise: 10000, discountPaise: 250, taxRateBps: 1800 }, { id: 'product', description: 'Laundry bag', classificationType: 'HSN' as const, classificationCode: '4202', quantityMilli: 1_000, unit: 'piece', unitPricePaise: 5000, taxRateBps: 1200 }];
const intra = calculateCanonicalTax({ supplierStateCode: '29', placeOfSupplyStateCode: '29', lines });
assert.equal(intra.intraState, true); assert.equal(intra.totals.igstPaise, 0); assert.equal(intra.totals.totalPaise, intra.totals.taxablePaise + intra.totals.cgstPaise + intra.totals.sgstPaise);
const inter = calculateCanonicalTax({ supplierStateCode: '29', placeOfSupplyStateCode: '07', lines });
assert.equal(inter.intraState, false); assert.equal(inter.totals.cgstPaise + inter.totals.sgstPaise, 0); assert.ok(inter.totals.igstPaise > 0);
assert.throws(() => calculateCanonicalTax({ supplierStateCode: '29', placeOfSupplyStateCode: '29', lines: [{ ...lines[0], classificationCode: '' }] }), /TAX_CLASSIFICATION_MISSING/);
console.log('PASS canonical line-level fixed-scale tax self-test complete');
