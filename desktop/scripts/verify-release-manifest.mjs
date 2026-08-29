import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(desktopDir, 'dist')
const manifestPath = path.join(distDir, 'release-manifest.json')

async function sha256(file) {
  const digest = createHash('sha256')
  digest.update(await fs.readFile(file))
  return digest.digest('hex')
}

try {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('unsupported or malformed release manifest')
  let failures = 0
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') { failures += 1; continue }
    const file = path.resolve(distDir, entry.path)
    if (!file.startsWith(`${path.resolve(distDir)}${path.sep}`)) { failures += 1; console.error(`Invalid manifest path: ${entry.path}`); continue }
    try {
      const actual = await sha256(file)
      if (actual !== entry.sha256) { failures += 1; console.error(`Checksum mismatch: ${entry.path}`) }
    } catch { failures += 1; console.error(`Missing release file: ${entry.path}`) }
  }
  if (failures) throw new Error(`${failures} release manifest entr${failures === 1 ? 'y' : 'ies'} failed verification`)
  console.log(`Verified ${manifest.files.length} release checksum entries`)
} catch (error) {
  console.error(`Release manifest verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
