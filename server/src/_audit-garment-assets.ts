import { auditGarmentAssets } from './modules/laundry/garment-assets.js';
import { store } from './kernel/store.js';

const tenant = process.env.EPIC_TENANT || 'T1';
const report = store.withStoreScope(tenant, process.env.EPIC_STORE_ID || 'STORE-DEFAULT', () => auditGarmentAssets(tenant));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
