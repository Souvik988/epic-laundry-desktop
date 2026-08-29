import { createHash, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SIGNATURE_SCHEMA_VERSION = 1
export const SIGNATURE_ALGORITHM = 'ed25519'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
function safeManifestPath(manifestPath, signaturePath) {
  const resolvedManifest = path.resolve(manifestPath)
  const resolvedSignature = path.resolve(signaturePath)
  if (resolvedManifest === resolvedSignature) throw new Error('signature artifact must not overwrite the manifest')
  return resolvedManifest
}

export async function signReleaseManifest({ manifestPath, signaturePath, privateKeyPem }) {
  if (!privateKeyPem) throw new Error('release signing requires EPIC_RELEASE_PRIVATE_KEY_PEM or EPIC_RELEASE_PRIVATE_KEY_FILE')
  const resolvedManifest = safeManifestPath(manifestPath, signaturePath)
  const bytes = await fs.readFile(resolvedManifest)
  const privateKey = createPrivateKey(privateKeyPem)
  if (privateKey.asymmetricKeyType !== SIGNATURE_ALGORITHM) throw new Error(`release key must be ${SIGNATURE_ALGORITHM}`)
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
  const signature = sign(null, bytes, privateKey).toString('base64')
  const payload = {
    schemaVersion: SIGNATURE_SCHEMA_VERSION,
    algorithm: SIGNATURE_ALGORITHM,
    manifest: path.basename(resolvedManifest),
    manifestSha256: sha256(bytes),
    publicKeyPem,
    signature,
    signedAt: new Date().toISOString(),
  }
  await fs.writeFile(signaturePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

export async function verifyReleaseSignature({ manifestPath, signaturePath, expectedPublicKeyPem }) {
  if (!expectedPublicKeyPem) throw new Error('signature verification requires EPIC_RELEASE_PUBLIC_KEY_PEM or EPIC_RELEASE_PUBLIC_KEY_FILE')
  const resolvedManifest = safeManifestPath(manifestPath, signaturePath)
  const signaturePayload = JSON.parse(await fs.readFile(signaturePath, 'utf8'))
  if (signaturePayload?.schemaVersion !== SIGNATURE_SCHEMA_VERSION || signaturePayload?.algorithm !== SIGNATURE_ALGORITHM) throw new Error('unsupported or malformed release signature')
  if (signaturePayload.manifest !== path.basename(resolvedManifest)) throw new Error('release signature targets a different manifest')
  const bytes = await fs.readFile(resolvedManifest)
  if (sha256(bytes) !== signaturePayload.manifestSha256) throw new Error('release manifest digest does not match its signature')
  const expectedKey = createPublicKey(expectedPublicKeyPem)
  const embeddedKey = createPublicKey(String(signaturePayload.publicKeyPem || ''))
  const expectedDer = expectedKey.export({ type: 'spki', format: 'der' })
  const embeddedDer = embeddedKey.export({ type: 'spki', format: 'der' })
  if (!expectedDer.equals(embeddedDer)) throw new Error('release signature key is not trusted')
  if (!verify(null, bytes, expectedKey, Buffer.from(String(signaturePayload.signature || ''), 'base64'))) throw new Error('release signature verification failed')
  return signaturePayload
}
