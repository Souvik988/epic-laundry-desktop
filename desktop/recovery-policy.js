/**
 * A restore is destructive. The rollback snapshot is therefore a hard
 * prerequisite, not a best-effort side effect. Kept dependency-free so it can
 * be unit-tested without loading Electron.
 */
async function createPreRestoreSnapshot(writeBackup, targetPath) {
  try {
    await writeBackup(targetPath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`restore aborted: safety snapshot could not be saved (${detail})`)
  }
}

module.exports = { createPreRestoreSnapshot }
