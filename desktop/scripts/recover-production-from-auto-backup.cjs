/*
 * Local production recovery helper.
 *
 * It is intentionally explicit: the operator supplies a new owner password,
 * the current database is moved (never deleted), the encrypted automatic
 * snapshot is rehearsed in an isolated SQLite file, and only then restored.
 * The auto-backup passphrase remains in memory and is never printed.
 */
const { app, safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const userData = path.join(process.env.APPDATA || '', 'epic-laundry-desktop');
const newOwnerPassword = String(process.env.EPIC_RECOVERY_OWNER_PASSWORD || '');
if (newOwnerPassword.length < 12) throw new Error('EPIC_RECOVERY_OWNER_PASSWORD must contain at least 12 characters');
const reportPath = path.join(userData, 'production-recovery-last-run.json');

function report(value) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), ...value }, null, 2), { encoding: 'utf8', mode: 0o600 });
}

app.setPath('userData', userData);

const now = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${new URL(url).pathname} -> ${response.status}: ${body.error || text.slice(0, 200)}`);
  return { body, headers: response.headers };
}

function startServer(databaseFile, legacyFile) {
  const secret = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  const env = {
    ...process.env,
    PORT: '0', HOST: '127.0.0.1', EPIC_DB_FILE: databaseFile,
    EPIC_DATA_FILE: legacyFile, EPIC_LEGACY_JSON_FILE: legacyFile,
    EPIC_WORKSPACE_MODE: 'production', EPIC_INTERNAL_API_KEY: crypto.randomBytes(32).toString('base64url'),
    EPIC_STARTUP_SECRET: secret, EPIC_STARTUP_NONCE: nonce,
  };
  // `__dirname` is inside app.asar in a packaged run; the server is an
  // Electron extraResource beside that archive, not inside it.
  const serverDir = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..', '..', 'server');
  const nodeCandidates = process.platform === 'win32'
    ? [process.env.ProgramW6432, process.env.ProgramFiles, 'C:\\Program Files'].filter(Boolean).map((base) => path.join(base, 'nodejs', 'node.exe'))
    : [];
  const systemNode = nodeCandidates.find((candidate) => fs.existsSync(candidate)) || 'node';
  const child = spawn(systemNode, ['dist/index.js'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output.slice(-800)}`)), 30_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('EPIC_READY ')) continue;
        try {
          const value = JSON.parse(line.slice('EPIC_READY '.length));
          const proof = crypto.createHmac('sha256', secret).update(`${nonce}:${value.port}`).digest('hex');
          if (value.proof !== proof) throw new Error('invalid local startup proof');
          clearTimeout(timeout); resolve({ child, port: value.port });
        } catch (error) { clearTimeout(timeout); reject(error); }
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.on('exit', (code) => reject(new Error(`server exited before startup (${code ?? 'unknown'}): ${output.slice(-800)}`)));
  });
  return ready;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) await delay(100);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function bootstrap(port, username = 'recovery-owner') {
  const { body, headers } = await requestJson(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: newOwnerPassword, tenant: 'T1', storeId: 'STORE-DEFAULT', businessName: 'Epic Laundry Recovery' }),
  });
  const cookie = headers.get('set-cookie');
  if (!cookie) throw new Error('recovery bootstrap did not return a local session');
  return { body, cookie: cookie.split(';')[0] };
}

async function verifyAndRehearse(envelope, passphrase, databaseFile, legacyFile) {
  const { child, port } = await startServer(databaseFile, legacyFile);
  try {
    const session = await bootstrap(port);
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session.cookie }, body: JSON.stringify({ backup: envelope, passphrase }) };
    const verify = await requestJson(`http://127.0.0.1:${port}/api/ops/restore/encrypted/verify`, options);
    const rehearsal = await requestJson(`http://127.0.0.1:${port}/api/ops/restore/encrypted/rehearse`, options);
    if (rehearsal.body?.ok !== true) throw new Error('isolated restore rehearsal did not complete');
    return { verify: verify.body, rehearsal: rehearsal.body };
  } finally { await stopServer(child); }
}

function moveIfPresent(source, destinationDirectory) {
  if (!fs.existsSync(source)) return;
  fs.renameSync(source, path.join(destinationDirectory, path.basename(source)));
}

function resetRecoveredOwner(databaseFile) {
  const Database = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'better-sqlite3'));
  const db = new Database(databaseFile);
  const owner = db.prepare("select id, username from auth_identities where enabled = 1 and roles_json like '%owner%' order by created_at asc limit 1").get();
  if (!owner) throw new Error('restored database has no enabled owner account');
  const changed = db.prepare('update auth_identities set password_hash = ? where id = ?').run(passwordHash(newOwnerPassword), owner.id).changes;
  db.close();
  if (changed !== 1) throw new Error('could not reset recovered owner credential');
  return owner.username;
}

async function restoreFromLegacySnapshot(reason) {
  const backupDirectory = path.join(userData, 'backups', 'production');
  const recoveryDir = path.join(backupDirectory, `corrupt-production-${now()}`);
  const databaseFile = path.join(userData, 'epic.sqlite');
  const legacyFile = path.join(userData, 'epic.json');
  if (!fs.existsSync(legacyFile)) throw new Error(`encrypted recovery key is unavailable and no legacy snapshot exists: ${reason}`);
  fs.mkdirSync(recoveryDir, { recursive: true });
  moveIfPresent(databaseFile, recoveryDir); moveIfPresent(`${databaseFile}-wal`, recoveryDir); moveIfPresent(`${databaseFile}-shm`, recoveryDir);
  const running = await startServer(databaseFile, legacyFile);
  try {
    await bootstrap(running.port, 'admin@laundry.com');
  } finally { await stopServer(running.child); }
  const Database = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'better-sqlite3'));
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  const rowCount = Number(db.prepare('select count(*) as count from entity_rows').get().count);
  db.close();
  if (!rowCount) throw new Error('legacy snapshot imported no operational records');
  fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ mode: 'production' }, null, 2), { encoding: 'utf8', mode: 0o600 });
  const summary = { ok: true, state: 'RECOVERED_FROM_LEGACY_JSON', importedRows: rowCount, ownerUsername: 'admin@laundry.com', corruptFilesPreservedAt: recoveryDir, encryptedBackupState: 'KEY_UNRECOVERABLE', reason };
  report(summary);
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  report({ state: 'STARTED' });
  await app.whenReady();
  if (!safeStorage.isEncryptionAvailable()) return restoreFromLegacySnapshot('Windows credential protection is unavailable for the automatic backup key');
  const keyPath = path.join(userData, 'auto-backup-key.bin');
  const backupDirectory = path.join(userData, 'backups', 'production');
  const backupPath = fs.readdirSync(backupDirectory).filter((name) => /^autobackup-.*\.epicbackup$/.test(name)).sort().at(-1);
  if (!fs.existsSync(keyPath) || !backupPath) throw new Error('automatic encrypted production backup or its protected key is missing');
  let passphrase;
  try { passphrase = safeStorage.decryptString(Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64')); }
  catch (error) { return restoreFromLegacySnapshot(`automatic encrypted key cannot be decrypted: ${error.message}`); }
  const envelope = JSON.parse(fs.readFileSync(path.join(backupDirectory, backupPath), 'utf8'));

  const verificationDir = path.join(backupDirectory, `recovery-rehearsal-${now()}`);
  fs.mkdirSync(verificationDir, { recursive: true });
  const rehearsal = await verifyAndRehearse(envelope, passphrase, path.join(verificationDir, 'isolated.sqlite'), path.join(verificationDir, 'isolated.json'));

  const recoveryDir = path.join(backupDirectory, `corrupt-production-${now()}`);
  fs.mkdirSync(recoveryDir, { recursive: true });
  const databaseFile = path.join(userData, 'epic.sqlite');
  const legacyFile = path.join(userData, 'epic.json');
  moveIfPresent(databaseFile, recoveryDir); moveIfPresent(`${databaseFile}-wal`, recoveryDir); moveIfPresent(`${databaseFile}-shm`, recoveryDir); moveIfPresent(legacyFile, recoveryDir);

  let restored;
  try {
    const running = await startServer(databaseFile, legacyFile);
    try {
      const session = await bootstrap(running.port);
      const response = await requestJson(`http://127.0.0.1:${running.port}/api/ops/restore/encrypted`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: session.cookie }, body: JSON.stringify({ backup: envelope, passphrase }) });
      restored = response.body;
    } finally { await stopServer(running.child); }
  } catch (error) {
    throw new Error(`recovery restore failed after a successful isolated rehearsal; corrupt files remain in ${recoveryDir}: ${error.message}`);
  }
  const username = resetRecoveredOwner(databaseFile);
  fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ mode: 'production' }, null, 2), { encoding: 'utf8', mode: 0o600 });
  const summary = { ok: true, state: 'RECOVERED', restoredRows: restored?.rows ?? null, verifiedRows: rehearsal.verify?.rows ?? null, ownerUsername: username, corruptFilesPreservedAt: recoveryDir };
  report(summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { report({ ok: false, state: 'FAILED', error: error.stack || error.message }); console.error(error.stack || error.message); process.exitCode = 1; }).finally(() => app.quit());
