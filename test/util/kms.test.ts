import {
  describe, it, expect, vi,
} from 'vitest';

// Resolve to the in-repo config path (unlike test/setup.ts, whose mock path
// lands outside the repo) so this mock actually reaches src/util/kms.ts and
// makes it treat KMS as configured.
vi.mock('../../config/config', () => ({
  ARWEAVE_KEY_KMS_NAME: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
}));

// In-memory KMS that enforces AAD: ciphertext carries both the plaintext and
// the AAD, and decrypt rejects when the supplied AAD differs.
vi.mock('@google-cloud/kms', () => {
  class KeyManagementServiceClient {
    // eslint-disable-next-line class-methods-use-this
    async encrypt({ plaintext, additionalAuthenticatedData }) {
      const payload = JSON.stringify({
        p: Buffer.from(plaintext).toString('utf8'),
        a: Buffer.from(additionalAuthenticatedData).toString('utf8'),
      });
      return [{ ciphertext: Buffer.from(payload, 'utf8') }];
    }

    // eslint-disable-next-line class-methods-use-this
    async decrypt({ ciphertext, additionalAuthenticatedData }) {
      const { p, a } = JSON.parse(Buffer.from(ciphertext).toString('utf8'));
      if (a !== Buffer.from(additionalAuthenticatedData).toString('utf8')) {
        throw new Error('AAD mismatch');
      }
      return [{ plaintext: Buffer.from(p, 'utf8') }];
    }
  }
  return { KeyManagementServiceClient };
});

// eslint-disable-next-line import/first
import { wrapKey, unwrapKey } from '../../src/util/kms';

describe('kms key wrapping', () => {
  it('round-trips a content key under the same AAD', async () => {
    const key = 'a'.repeat(64); // 32-byte key, hex-encoded
    const wrapped = await wrapKey(key, 'tx-hash-1');
    expect(wrapped).not.toBe(key);
    const unwrapped = await unwrapKey(wrapped, 'tx-hash-1');
    expect(unwrapped).toBe(key);
  });

  it('rejects unwrapping with a different AAD (anti-transplant)', async () => {
    const wrapped = await wrapKey('secret', 'tx-hash-1');
    await expect(unwrapKey(wrapped, 'tx-hash-2')).rejects.toThrow();
  });
});
