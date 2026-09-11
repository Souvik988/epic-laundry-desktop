/* Controlled local fallback when an encrypted automatic backup key is no
 * longer decryptable. It preserves the corrupt SQLite files and rebuilds the
 * production database from the older JSON snapshot without exposing secrets. */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const userData = path.join(process.env.APPDATA || '', 'epic-laundry-desktop');
const password = String(process.env.EPIC_RECOVERY_OWNER_PASSWORD || '');
if (password.length < 12) throw new Error('EPIC_RECOVERY_OWNER_PASSWORD must contain at least 12 characters');
const backupDir = path.join(userData, 'backups', 'production');
const databaseFile = path.join(userData, 'epic.sqlite');
const legacyFile = path.join(userData, 'epic.json');
const reportFile = path.join(userData, 'production-recovery-last-run.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function writeReport(value) { fs.writeFileSync(reportFile, JSON.stringify({ timestamp: new Date().toISOString(), ...value }, null, 2), { encoding: 'utf8', mode: 0o600 }); }
function moveIfPresent(file, destination) { if (fs.existsSync(file)) fs.renameSync(file, path.join(destination, path.basename(file))); }
function requestJson(url, options) {
  return fetch(url, options).then(async (response) => {
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${options.method || 'GET'} ${new URL(url).pathname} -> ${response.status}: ${body.error || text}`);
    return { body, headers: response.headers };
  });
}
function startServer() {
  const secret = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const serverDir = path.join(__dirname, '..', '..', 'server');
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: serverDir,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', EPIC_DB_FILE: databaseFile, EPIC_DATA_FILE: legacyFile, EPIC_LEGACY_JSON_FILE: legacyFile, EPIC_WORKSPACE_MODE: 'production', EPIC_INTERNAL_API_KEY: crypto.randomBytes(32).toString('base64url'), EPIC_STARTUP_SECRET: secret, EPIC_STARTUP_NONCE: nonce },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-2000)}`)), 30_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('EPIC_READY ')) continue;
        const ready = JSON.parse(line.slice('EPIC_READY '.length));
        const proof = crypto.createHmac('sha256', secret).update(`${nonce}:${ready.port}`).digest('hex');
        if (proof !== ready.proof) return reject(new Error('local server startup proof mismatch'));
        clearTimeout(timeout); resolve({ child, port: ready.port });
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.on('exit', (code) => reject(new Error(`server exited before startup (${code ?? 'unknown'}): ${output.slice(-2000)}`)));
  });
}
async function stopServer(child) { if (!child || child.exitCode !== null) return; child.kill(); await new Promise((resolve) => child.once('exit', resolve)); }

(async () => {
  writeReport({ state: 'STARTED', recoverySource: 'legacy-json' });
  if (!fs.existsSync(legacyFile)) throw new Error('legacy production snapshot is missing');
  const source = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  if (!Array.isArray(source.rows) || source.rows.length === 0) throw new Error('legacy production snapshot has no operational rows');
  const preserved = path.join(backupDir, `corrupt-production-${stamp}`);
  fs.mkdirSync(preserved, { recursive: true });
  moveIfPresent(databaseFile, preserved); moveIfPresent(`${databaseFile}-wal`, preserved); moveIfPresent(`${databaseFile}-shm`, preserved);
  const running = await startServer();
  try {
    const bootstrap = await requestJson(`http://127.0.0.1:${running.port}/api/auth/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin@laundry.com', password, tenant: 'T1', storeId: 'STORE-DEFAULT', businessName: 'Epic Laundry' }) });
    if (!bootstrap.headers.get('set-cookie')) throw new Error('owner bootstrap did not establish a local session');
  } finally { await stopServer(running.child); }
  const Database = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'better-sqlite3'));
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  const importedRows = Number(db.prepare('select count(*) as count from entity_rows').get().count);
  const owner = db.prepare("select username from auth_identities where enabled = 1 and roles_json like '%owner%' limit 1").get();
  db.close();
  if (!importedRows || !owner?.username) throw new Error('fresh production database did not contain imported operational data and an owner');
  fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ mode: 'production' }, null, 2), { encoding: 'utf8', mode: 0o600 });
  writeReport({ ok: true, state: 'RECOVERED_FROM_LEGACY_JSON', importedRows, ownerUsername: owner.username, corruptFilesPreservedAt: preserved, encryptedBackupState: 'KEY_UNRECOVERABLE' });
  console.log(`RECOVERED_FROM_LEGACY_JSON rows=${importedRows} owner=${owner.username}`);
})().catch((error) => { writeReport({ ok: false, state: 'FAILED', error: error.stack || error.message }); console.error(error.stack || error.message); process.exitCode = 1; });
