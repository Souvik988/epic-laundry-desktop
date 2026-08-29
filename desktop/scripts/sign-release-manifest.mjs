import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signReleaseManifest } from './release-signature.mjs'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(desktopDir, 'dist')
const manifestPath = path.join(distDir, 'release-manifest.json')
const signaturePath = path.join(distDir, 'release-manifest.sig.json')

try {
  const privateKeyPem = process.env.EPIC_RELEASE_PRIVATE_KEY_PEM || (process.env.EPIC_RELEASE_PRIVATE_KEY_FILE ? await fs.readFile(process.env.EPIC_RELEASE_PRIVATE_KEY_FILE, 'utf8') : '')
  const payload = await signReleaseManifest({ manifestPath, signaturePath, privateKeyPem })
  console.log(`Signed ${path.relative(desktopDir, manifestPath)} with ${payload.algorithm}; wrote ${path.relative(desktopDir, signaturePath)}`)
} catch (error) {
  console.error(`Release signature generation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
