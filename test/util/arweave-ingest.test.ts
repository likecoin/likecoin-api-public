import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { createGcmDecryptTransform, ingestProtectedContent } from '../../src/util/api/arweave/ingest';

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

function split(buffer: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buffer.length; i += chunkSize) {
    chunks.push(buffer.subarray(i, i + chunkSize));
  }
  return chunks;
}

async function collect(source: Buffer[], transform: NodeJS.ReadWriteStream): Promise<Buffer> {
  const output: Buffer[] = [];
  await pipeline(
    Readable.from(source, { objectMode: false }),
    transform,
    async (result) => {
      for await (const chunk of result) output.push(Buffer.from(chunk as Buffer));
    },
  );
  return Buffer.concat(output);
}

describe('createGcmDecryptTransform', () => {
  it('decrypts the client-side AES-256-GCM format', async () => {
    const plaintext = Buffer.from('protected ebook bytes');
    const { keyBase64, combined } = await encryptLikeClient(plaintext);
    const decrypted = await collect([combined], createGcmDecryptTransform(keyBase64));
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  // The IV heads the stream and the auth tag trails it, so chunk boundaries that
  // land inside either one are the failure mode this transform exists to handle.
  it.each([1, 7, 12, 13, 16, 17, 4096])('decrypts in %i-byte chunks', async (chunkSize) => {
    const plaintext = Buffer.from(Array.from({ length: 20000 }, (_, i) => i % 256));
    const { keyBase64, combined } = await encryptLikeClient(plaintext);
    const decrypted = await collect(
      split(combined, chunkSize),
      createGcmDecryptTransform(keyBase64),
    );
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('rejects tampered ciphertext (GCM auth)', async () => {
    const { keyBase64, combined } = await encryptLikeClient(Buffer.from('content'));
    combined[combined.length - 20] = combined[combined.length - 20] === 0 ? 1 : 0;
    await expect(collect(split(combined, 8), createGcmDecryptTransform(keyBase64)))
      .rejects.toThrow();
  });

  it('rejects a wrong-length key', () => {
    expect(() => createGcmDecryptTransform(Buffer.alloc(16).toString('base64')))
      .toThrow('INVALID_CONTENT_KEY');
  });

  // 10 bytes never yields an IV; 20 bytes yields one but leaves a short tail.
  it.each([10, 20])('rejects a %i-byte payload (shorter than IV + tag)', async (size) => {
    const key = Buffer.alloc(32).toString('base64');
    await expect(collect([Buffer.alloc(size)], createGcmDecryptTransform(key)))
      .rejects.toThrow('INVALID_ENCRYPTED_PAYLOAD');
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
