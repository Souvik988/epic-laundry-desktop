import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyReleaseSignature } from './release-signature.mjs'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(desktopDir, 'dist')
const manifestPath = path.join(distDir, 'release-manifest.json')
const signaturePath = path.join(distDir, 'release-manifest.sig.json')

try {
  const publicKeyPem = process.env.EPIC_RELEASE_PUBLIC_KEY_PEM || (process.env.EPIC_RELEASE_PUBLIC_KEY_FILE ? await fs.readFile(process.env.EPIC_RELEASE_PUBLIC_KEY_FILE, 'utf8') : '')
  const payload = await verifyReleaseSignature({ manifestPath, signaturePath, expectedPublicKeyPem: publicKeyPem })
  console.log(`Verified ${payload.algorithm} release signature for ${payload.manifest}`)
} catch (error) {
  console.error(`Release signature verification failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
