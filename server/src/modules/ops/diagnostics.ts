import { store } from '../../kernel/store.js';
import { hardwareCapabilities } from '../laundry/hardware.js';

const VERSION = process.env.EPIC_APP_VERSION || '0.1.0';

/** Return a support bundle safe to copy into a ticket. No names, phone numbers, payloads, tokens or paths. */
export function buildDiagnostics(tenant: string, storeId: string) {
  return {
    format: 'epic-laundry-diagnostics',
    version: 1,
    generatedAt: new Date().toISOString(),
    application: { name: 'Epic Laundry', version: VERSION, server: '0.0.1-phase0' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    workspace: { tenant, storeId, mode: process.env.EPIC_WORKSPACE_MODE === 'demo' ? 'demo' : 'production' },
    health: { status: 'ok' },
    migrations: store.migrationStatus(),
    counts: store.diagnosticsFor(tenant, storeId),
    hardware: hardwareCapabilities().map(({ kind, adapter, status }) => ({ kind, adapter, status })),
    redaction: { customerData: 'excluded', credentials: 'excluded', sessionTokens: 'excluded', databasePath: 'excluded', financialAmounts: 'excluded' },
  };
}
