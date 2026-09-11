import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const emptyAuditRoot = tmpdir()
const emptyAuditName = `epic-laundry-empty-${process.pid}`
const localBrowser = [
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((candidate) => candidate && existsSync(candidate))

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3921',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    ...(localBrowser ? { launchOptions: { executablePath: localBrowser } } : {}),
  },
  webServer: {
    command: 'npm --prefix ../server run start',
    url: 'http://127.0.0.1:3921/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '3921',
      EPIC_WORKSPACE_MODE: 'production',
      EPIC_DB_FILE: join(emptyAuditRoot, `${emptyAuditName}.sqlite`),
      EPIC_LEGACY_JSON_FILE: join(emptyAuditRoot, `${emptyAuditName}.json`),
      EPIC_REPORT_EXPORT_DIR: join(emptyAuditRoot, `${emptyAuditName}-report-exports`),
    },
  },
})
