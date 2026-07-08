import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';

import { decryptContentBuffer, ingestProtectedContent } from '../../src/util/api/arweave/ingest';

// Reproduce publish-3ook-com encryptDataWithAES (arweavekit layout):
// 12-byte IV ‖ WebCrypto AES-256-GCM output (ciphertext ‖ 16-byte tag).
async function encryptLikeClient(plaintext: Buffer) {
  const cryptoKey = await webcrypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext);
  const rawKey = await webcrypto.subtle.exportKey('raw', cryptoKey);
  return {
    keyBase64: Buffer.from(rawKey).toString('base64'),
    combined: Buffer.concat([Buffer.from(iv), Buffer.from(encrypted)]),
  };
}

describe('decryptContentBuffer', () => {
  it('decrypts the client-side AES-256-GCM format', async () => {
    const plaintext = Buffer.from('protected ebook bytes');
    const { keyBase64, combined } = await encryptLikeClient(plaintext);
    const decrypted = decryptContentBuffer(combined, keyBase64);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('rejects tampered ciphertext (GCM auth)', async () => {
    const { keyBase64, combined } = await encryptLikeClient(Buffer.from('content'));
    combined[combined.length - 20] = combined[combined.length - 20] === 0 ? 1 : 0;
    expect(() => decryptContentBuffer(combined, keyBase64)).toThrow();
  });

  it('rejects a wrong-length key', () => {
    const combined = Buffer.alloc(40);
    expect(() => decryptContentBuffer(combined, Buffer.alloc(16).toString('base64')))
      .toThrow('INVALID_CONTENT_KEY');
  });

  it('rejects payloads shorter than IV + tag', () => {
    expect(() => decryptContentBuffer(Buffer.alloc(10), Buffer.alloc(32).toString('base64')))
      .toThrow('INVALID_ENCRYPTED_PAYLOAD');
  });
});

describe('ingestProtectedContent', () => {
  it('is a no-op when the protected bucket is not configured', async () => {
    const result = await ingestProtectedContent('tx-hash', {
      arweaveId: 'ar-id',
      key: Buffer.alloc(32).toString('base64'),
    });
    expect(result).toBeNull();
  });
});
