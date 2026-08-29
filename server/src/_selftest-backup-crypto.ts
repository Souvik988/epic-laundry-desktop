import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup } from './modules/ops/backup-crypto.js';

const payload = { rows: [{ id: 'safe-row', data: { amount: 12.5 } }], financialDocuments: [{ amountPaise: 1250 }], seq: { invoice: 3 } };
const secret = 'Correct Horse Battery 26';
const envelope = encryptBackup(payload, secret, 'CRYPTO', 'STORE-DEFAULT');
assert.equal(envelope.backupFormat, 'epic-laundry-encrypted-backup');
assert.equal(envelope.cipher, 'aes-256-gcm');
assert.deepEqual(decryptBackup(envelope, secret), payload, 'encrypted backup round-trips exactly');
assert.throws(() => decryptBackup(envelope, 'wrong passphrase'), /could not be decrypted/, 'wrong passphrase fails closed');
const tampered = { ...envelope, ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}` };
assert.throws(() => decryptBackup(tampered, secret), /could not be decrypted|checksum mismatch/, 'tampered ciphertext fails closed');
assert.throws(() => encryptBackup(payload, 'short', 'CRYPTO', 'STORE-DEFAULT'), /passphrase must be/, 'weak passphrase rejected');
console.log('PASS  encrypted backup AES-GCM round-trip and tamper self-test complete');
