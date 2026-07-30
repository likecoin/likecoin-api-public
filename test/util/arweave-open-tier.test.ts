import {
  describe, expect, it, vi,
} from 'vitest';

import { getDeterministicAnchor } from '../../src/util/arweave/upload';
import { assertValidArweaveId } from '../../src/util/api/arweave/ingest';
import { getTierContentUri } from '../../src/util/gcloudStorage';

// The open tier keys GCS objects by arweaveId, and ebook-cors derives the same
// path from an ar:// target without asking us. These are the two halves of that
// contract that a change could silently break.
describe('open-tier arweaveId namespace', () => {
  it('accepts a real 43-char Base64URL id', () => {
    const id = 'Ab3-dEf_GhIjKlMnOpQrStUvWxYz0123456789_-xyZ';
    expect(id).toHaveLength(43);
    expect(assertValidArweaveId(id)).toBe(id);
  });

  it('rejects anything that could address another object', () => {
    // The length bound is what separates a real id from a path fragment using the
    // same alphabet — without it, `..` and prefixes would pass the charset test.
    const rejected = [
      '',
      'short',
      '..',
      'Ab3-dEf_GhIjKlMnOpQrStUvWxYz0123456789_-xy', // 42
      'Ab3-dEf_GhIjKlMnOpQrStUvWxYz0123456789_-xyZa', // 44
      'Ab3-dEf_GhIjKlMnOpQrStUvWxYz0123456789_-xy/', // 43 with a separator
      'staging/Ab3-dEf_GhIjKlMnOpQrStUvWxYz0123456789',
    ];
    rejected.forEach((id) => {
      expect(() => assertValidArweaveId(id), id).toThrow('INVALID_ARWEAVE_ID');
    });
  });
});

describe('getDeterministicAnchor', () => {
  // ANS-104 requires exactly 32 bytes, and arbundles throws on any other length.
  it('is exactly 32 bytes', () => {
    expect(Buffer.from(getDeterministicAnchor('gcs-abc')).byteLength).toBe(32);
  });

  // This is the whole point: a retry of the same upload must produce the same
  // DataItem id, so it cannot be charged twice under two different names.
  it('is stable for one upload and distinct across uploads', () => {
    expect(getDeterministicAnchor('gcs-abc')).toBe(getDeterministicAnchor('gcs-abc'));
    expect(getDeterministicAnchor('gcs-abc')).not.toBe(getDeterministicAnchor('gcs-abd'));
  });
});

// The open flow keys its upload doc on gcs-<uuid>, not on the payment hash, so it
// loses the doc-id uniqueness that gives /v2/register replay protection for free.
// checkArweaveTxV2 is pure read-only verification and passes the same hash twice,
// so the claim below is the only thing stopping N staged uploads settling against
// one payment.
// The live SDK carries the gRPC code and a message that names no error at all;
// only older shapes spell ALREADY_EXISTS out. Both must map to 429, so pin each.
const duplicateErrors = [
  ['gRPC code', Object.assign(new Error('Document already exists'), { code: 6 })],
  ['legacy message', new Error('6 ALREADY_EXISTS: entity already exists')],
] as const;

describe('claimArweaveTxPayment', () => {
  it.each(duplicateErrors)('maps a duplicate claim (%s) to 429 TX_HASH_ALREADY_USED', async (_label, error) => {
    const { claimArweaveTxPayment } = await import('../../src/util/api/arweave/tx');
    const { iscnArweaveTxCollection } = await import('../../src/util/firebase');
    vi.spyOn(iscnArweaveTxCollection, 'doc').mockReturnValue({
      create: () => Promise.reject(error),
    } as never);
    try {
      await expect(
        claimArweaveTxPayment('0xpay', { uploadId: 'gcs-1', ownerWallet: '0xowner' }),
      ).rejects.toMatchObject({ message: 'TX_HASH_ALREADY_USED', status: 429 });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('getTierContentUri', () => {
  // Neither bucket is configured in tests, so both tiers must degrade to '' —
  // the same signal that keeps the link API from advertising a copy that the
  // reader cannot open.
  it('returns empty when the tier bucket is unconfigured', () => {
    expect(getTierContentUri('open', 'some-id')).toBe('');
    expect(getTierContentUri('protected', 'some-id')).toBe('');
  });

  it('returns empty for a missing path even when configured', () => {
    expect(getTierContentUri('open', undefined)).toBe('');
  });
});
