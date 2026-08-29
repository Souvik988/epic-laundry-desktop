import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(desktopDir, 'dist')
const manifestPath = path.join(distDir, 'release-manifest.json')

async function filesUnder(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(absolute))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

async function sha256(file) {
  const digest = createHash('sha256')
  digest.update(await fs.readFile(file))
  return digest.digest('hex')
}

try {
  const files = (await filesUnder(distDir))
    .filter((file) => ![manifestPath, path.join(distDir, 'release-manifest.sig.json')].some((excluded) => path.resolve(file) === path.resolve(excluded)))
    .sort((a, b) => a.localeCompare(b))
  const entries = []
  for (const file of files) {
    entries.push({ path: path.relative(distDir, file).replaceAll(path.sep, '/'), sha256: await sha256(file) })
  }
  const packageJson = JSON.parse(await fs.readFile(path.join(desktopDir, 'package.json'), 'utf8'))
  const manifest = { schemaVersion: 1, product: packageJson.build?.productName || packageJson.productName || packageJson.name, version: packageJson.version, generatedAt: new Date().toISOString(), files: entries }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${path.relative(desktopDir, manifestPath)} with ${entries.length} checksum entries`)
} catch (error) {
  console.error(`Release manifest generation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
