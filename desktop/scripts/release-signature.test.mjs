import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { signReleaseManifest, verifyReleaseSignature } from './release-signature.mjs'

const temp = await mkdtemp(path.join(tmpdir(), 'epic-release-signature-'))
try {
  const manifestPath = path.join(temp, 'release-manifest.json')
  const signaturePath = path.join(temp, 'release-manifest.sig.json')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await writeFile(manifestPath, '{"schemaVersion":1,"files":[{"path":"Epic Laundry.exe","sha256":"abc"}]}\n', 'utf8')
  await signReleaseManifest({ manifestPath, signaturePath, privateKeyPem })
  const verified = await verifyReleaseSignature({ manifestPath, signaturePath, expectedPublicKeyPem: publicKeyPem })
  assert.equal(verified.algorithm, 'ed25519')
  await writeFile(manifestPath, '{"tampered":true}\n', 'utf8')
  await assert.rejects(() => verifyReleaseSignature({ manifestPath, signaturePath, expectedPublicKeyPem: publicKeyPem }), /digest does not match/)
  await writeFile(manifestPath, '{"schemaVersion":1,"files":[{"path":"Epic Laundry.exe","sha256":"abc"}]}\n', 'utf8')
  const foreign = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await assert.rejects(() => verifyReleaseSignature({ manifestPath, signaturePath, expectedPublicKeyPem: foreign }), /not trusted/)
  const payload = JSON.parse(await readFile(signaturePath, 'utf8'))
  assert.equal(payload.schemaVersion, 1)
  console.log('PASS release signature tamper and trust-anchor self-test complete')
} finally {
  await rm(temp, { recursive: true, force: true })
}
