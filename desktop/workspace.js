const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'workspace.json';
const MODES = new Set(['production', 'demo']);

function ensureMode(mode) {
  if (!MODES.has(mode)) throw new Error('workspace mode must be production or demo');
  return mode;
}

function configPath(userDataDir) { return path.join(userDataDir, CONFIG_FILE); }

function readWorkspace(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(userDataDir), 'utf8'));
    if (parsed && MODES.has(parsed.mode)) return { mode: parsed.mode, backupDirectory: typeof parsed.backupDirectory === 'string' && path.isAbsolute(parsed.backupDirectory) ? path.normalize(parsed.backupDirectory) : undefined };
  } catch { /* first run or a corrupt non-critical preference file */ }
  return { mode: 'production' };
}

function selectWorkspace(userDataDir, mode, backupDirectory) {
  const next = { mode: ensureMode(mode), ...(typeof backupDirectory === 'string' && path.isAbsolute(backupDirectory) ? { backupDirectory: path.normalize(backupDirectory) } : {}) };
  fs.mkdirSync(userDataDir, { recursive: true });
  const temporary = `${configPath(userDataDir)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, configPath(userDataDir));
  return next;
}

function workspacePaths(userDataDir, mode, backupDirectory) {
  const safeMode = ensureMode(mode);
  const suffix = safeMode === 'demo' ? '-demo' : '';
  const backupRoot = typeof backupDirectory === 'string' && path.isAbsolute(backupDirectory)
    ? path.join(path.normalize(backupDirectory), 'Epic Laundry', safeMode)
    : path.join(userDataDir, 'backups', safeMode);
  return {
    mode: safeMode,
    databaseFile: path.join(userDataDir, `epic${suffix}.sqlite`),
    legacyFile: path.join(userDataDir, `epic${suffix}.json`),
    backupDirectory: typeof backupDirectory === 'string' && path.isAbsolute(backupDirectory) ? path.normalize(backupDirectory) : undefined,
    backupsDir: backupRoot,
  };
}

function resetDemoWorkspace(userDataDir) {
  const paths = workspacePaths(userDataDir, 'demo');
  for (const file of [paths.databaseFile, `${paths.databaseFile}-wal`, `${paths.databaseFile}-shm`, paths.legacyFile]) {
    try { fs.rmSync(file, { force: true }); } catch { /* best-effort cleanup; caller can retry after server shutdown */ }
  }
  return paths;
}

module.exports = { readWorkspace, selectWorkspace, workspacePaths, resetDemoWorkspace };
