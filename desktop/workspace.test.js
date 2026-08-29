const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readWorkspace, selectWorkspace, workspacePaths, resetDemoWorkspace } = require('./workspace');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-workspace-test-'));
try {
  assert.equal(readWorkspace(directory).mode, 'production', 'first launch defaults to production');
  assert.equal(selectWorkspace(directory, 'demo').mode, 'demo', 'demo selection persists');
  assert.equal(readWorkspace(directory).mode, 'demo', 'selection survives a restart');
  const demo = workspacePaths(directory, 'demo');
  const production = workspacePaths(directory, 'production');
  const external = path.join(directory, 'usb-backups');
  const configured = workspacePaths(directory, 'production', external);
  assert.equal(configured.backupsDir, path.join(external, 'Epic Laundry', 'production'), 'configured recovery destination is namespaced by product and workspace');
  assert.notEqual(configured.backupsDir, workspacePaths(directory, 'demo', external).backupsDir, 'production and demo never share an external recovery folder');
  assert.equal(selectWorkspace(directory, 'production', external).backupDirectory, path.normalize(external), 'backup destination persists as a normalized absolute path');
  assert.equal(readWorkspace(directory).backupDirectory, path.normalize(external), 'backup destination survives a restart');
  assert.notEqual(demo.databaseFile, production.databaseFile, 'demo and production never share a database');
  fs.writeFileSync(demo.databaseFile, 'demo');
  fs.writeFileSync(production.databaseFile, 'production');
  resetDemoWorkspace(directory);
  assert.equal(fs.existsSync(demo.databaseFile), false, 'demo reset removes only demo data');
  assert.equal(fs.readFileSync(production.databaseFile, 'utf8'), 'production', 'demo reset cannot touch production data');
  assert.throws(() => selectWorkspace(directory, 'anything-else'), /workspace mode/, 'invalid modes are rejected');
  console.log('PASS workspace isolation test complete');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
