import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const auditRoot = tmpdir();
const auditName = `epic-laundry-ui-${process.pid}`;
const localBrowser = [
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => candidate && existsSync(candidate));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3920',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(localBrowser ? { launchOptions: { executablePath: localBrowser } } : {}),
  },
  webServer: {
    command: 'npm --prefix ../server run start',
    url: 'http://127.0.0.1:3920/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3920',
      EPIC_WORKSPACE_MODE: 'demo',
      EPIC_DB_FILE: join(auditRoot, `${auditName}.sqlite`),
      EPIC_LEGACY_JSON_FILE: join(auditRoot, `${auditName}.json`),
      EPIC_REPORT_EXPORT_DIR: join(auditRoot, `${auditName}-report-exports`),
    },
  },
});
