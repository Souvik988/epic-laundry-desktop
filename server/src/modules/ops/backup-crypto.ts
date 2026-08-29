import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

const FORMAT = 'epic-laundry-encrypted-backup';
const VERSION = 1;
const MIN_PASSPHRASE_LENGTH = 12;
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;

export type EncryptedBackupEnvelope = {
  backupFormat: typeof FORMAT;
  backupVersion: typeof VERSION;
  tenant: string;
  storeId: string;
  kdf: 'scrypt';
  cipher: 'aes-256-gcm';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  plaintextChecksum: string;
};

function passphrase(value: unknown) {
  const result = String(value || '');
  if (result.length < MIN_PASSPHRASE_LENGTH || result.length > 256) throw new Error(`backup passphrase must be ${MIN_PASSPHRASE_LENGTH}-256 characters`);
  return result;
}

function keyFor(secret: string, salt: Buffer) {
  return scryptSync(secret, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encryptBackup(payload: unknown, secretInput: unknown, tenant: string, storeId: string): EncryptedBackupEnvelope {
  const secret = passphrase(secretInput);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error('backup payload is too large to encrypt');
  const salt = randomBytes(16); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { backupFormat: FORMAT, backupVersion: VERSION, tenant, storeId, kdf: 'scrypt', cipher: 'aes-256-gcm', salt: salt.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url'), plaintextChecksum: createHash('sha256').update(plaintext).digest('hex') };
}

export function decryptBackup(envelope: Partial<EncryptedBackupEnvelope>, secretInput: unknown) {
  const secret = passphrase(secretInput);
  if (envelope.backupFormat !== FORMAT || envelope.backupVersion !== VERSION || envelope.kdf !== 'scrypt' || envelope.cipher !== 'aes-256-gcm') throw new Error('invalid encrypted backup envelope');
  const fields = [envelope.salt, envelope.iv, envelope.tag, envelope.ciphertext, envelope.plaintextChecksum];
  if (fields.some((field) => typeof field !== 'string' || !field) || !/^[a-f0-9]{64}$/.test(String(envelope.plaintextChecksum))) throw new Error('encrypted backup envelope is incomplete');
  let plaintext: Buffer;
  try {
    const salt = Buffer.from(envelope.salt!, 'base64url'); const iv = Buffer.from(envelope.iv!, 'base64url'); const tag = Buffer.from(envelope.tag!, 'base64url'); const ciphertext = Buffer.from(envelope.ciphertext!, 'base64url');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PAYLOAD_BYTES) throw new Error('encrypted backup field size is invalid');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, salt), iv); decipher.setAuthTag(tag); plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch { throw new Error('encrypted backup could not be decrypted; check the passphrase or file integrity'); }
  if (plaintext.length > MAX_PAYLOAD_BYTES || createHash('sha256').update(plaintext).digest('hex') !== envelope.plaintextChecksum) throw new Error('encrypted backup checksum mismatch');
  try { return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>; } catch { throw new Error('encrypted backup payload is not valid JSON'); }
}
