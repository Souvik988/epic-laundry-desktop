import assert from 'node:assert/strict'
import { assertProductionEnvironment } from './production-release-guard.mjs'

const packageJson = { version: '0.1.0' }
assert.throws(() => assertProductionEnvironment({}, packageJson), /PRODUCTION_RELEASE_BLOCKED/)
assert.throws(() => assertProductionEnvironment({ EPIC_RELEASE_CONFIRMATION: 'PRODUCTION', EPIC_RELEASE_APPROVED_VERSION: '0.1.0', CSC_LINK: 'cert.p12', CSC_KEY_PASSWORD: 'secret', EPIC_RELEASE_PRIVATE_KEY_PEM: 'private', EPIC_RELEASE_PUBLIC_KEY_PEM: 'public', EPIC_UPDATE_FEED_URL: 'http://updates.epicbos.app/' }, packageJson), /PRODUCTION_RELEASE_BLOCKED/)
const verified = assertProductionEnvironment({ EPIC_RELEASE_CONFIRMATION: 'PRODUCTION', EPIC_RELEASE_APPROVED_VERSION: '0.1.0', CSC_LINK: 'cert.p12', CSC_KEY_PASSWORD: 'secret', EPIC_RELEASE_PRIVATE_KEY_PEM: 'private', EPIC_RELEASE_PUBLIC_KEY_PEM: 'public', EPIC_UPDATE_FEED_URL: 'https://updates.epicbos.app/stable/' }, packageJson)
assert.equal(verified.signing, 'Authenticode + Ed25519 manifest')
console.log('PASS production release prerequisite gate and trusted-feed validation self-test complete')
