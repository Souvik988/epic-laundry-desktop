import { workerData } from 'node:worker_threads';

const input = workerData as { tenant: string; storeId: string; id: string; databaseFile?: string };
if (input.databaseFile) process.env.EPIC_DB_FILE = input.databaseFile;
const { runExportInWorker } = await import('./report-exports.js');
runExportInWorker(input.tenant, input.storeId, input.id);
