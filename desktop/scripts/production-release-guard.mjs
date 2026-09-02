import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function assertProductionEnvironment(env = process.env, packageJson = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'))) {
  const missing = []
  if (String(env.EPIC_RELEASE_CONFIRMATION || '') !== 'PRODUCTION') missing.push('EPIC_RELEASE_CONFIRMATION=PRODUCTION')
  if (String(env.EPIC_RELEASE_APPROVED_VERSION || '') !== String(packageJson.version)) missing.push(`EPIC_RELEASE_APPROVED_VERSION=${packageJson.version}`)
  if (!String(env.CSC_LINK || '').trim()) missing.push('CSC_LINK')
  if (!String(env.CSC_KEY_PASSWORD || '').trim()) missing.push('CSC_KEY_PASSWORD')
  if (!String(env.EPIC_RELEASE_PRIVATE_KEY_PEM || env.EPIC_RELEASE_PRIVATE_KEY_FILE || '').trim()) missing.push('EPIC_RELEASE_PRIVATE_KEY_PEM or EPIC_RELEASE_PRIVATE_KEY_FILE')
  if (!String(env.EPIC_RELEASE_PUBLIC_KEY_PEM || env.EPIC_RELEASE_PUBLIC_KEY_FILE || '').trim()) missing.push('EPIC_RELEASE_PUBLIC_KEY_PEM or EPIC_RELEASE_PUBLIC_KEY_FILE')
  const feed = String(env.EPIC_UPDATE_FEED_URL || '').trim()
  try {
    const url = new URL(feed)
    if (url.protocol !== 'https:' || url.hostname !== 'updates.epicbos.app') throw new Error('invalid')
  } catch { missing.push('EPIC_UPDATE_FEED_URL (https://updates.epicbos.app/...)') }
  if (missing.length) throw new Error(`PRODUCTION_RELEASE_BLOCKED: missing or invalid ${missing.join(', ')}`)
  return { version: packageJson.version, updateFeed: feed, signing: 'Authenticode + Ed25519 manifest' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const result = assertProductionEnvironment()
    console.log(`Production release prerequisites verified for Epic Laundry ${result.version}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
