import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { Readable } from 'stream';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import { testingWallet1, testingLikeWallet1 } from './data';
import { iscnArweaveTxCollection } from '../../src/util/firebase';

const OPEN_ID = 'files-open-cover';
const PROTECTED_ID = 'files-protected-ebook';
const PENDING_ID = 'files-pending-cover';
const PLAINTEXT = Buffer.from('fake-jpeg-bytes');

const reads: string[] = [];
let bytesPulled = 0;
let readError: { code: number } | null = null;

// Per-file for the same reason as arweave-content.test.ts: a global stub would
// make the protected bucket look configured to unrelated suites.
vi.mock('../../src/util/gcloudStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/gcloudStorage')>();
  return {
    ...actual,
    isEbookTierBucketEnabled: () => true,
    getTierFileStream: async (tier: string, objectPath: string) => {
      reads.push(`${tier}:${objectPath}`);
      if (readError) throw readError;
      // Pulled lazily so a HEAD that never reads the body leaves the count at zero.
      return {
        stream: Readable.from((function* yieldOnce() {
          bytesPulled += PLAINTEXT.length;
          yield PLAINTEXT;
        }())),
        contentType: 'application/octet-stream',
        size: PLAINTEXT.length,
      };
    },
  };
});

describe('Public files API', () => {
  const getFile = (id: string, config = {}) => axiosist
    .request({ url: `/api/files/${id}`, responseType: 'arraybuffer', ...config })
    .catch((err) => (err as any).response);

  beforeEach(async () => {
    reads.length = 0;
    bytesPulled = 0;
    readError = null;
    await iscnArweaveTxCollection.doc(OPEN_ID).set({
      tier: 'open',
      status: 'complete',
      isRequireAuth: false,
      contentBucketPath: OPEN_ID,
      contentType: 'image/jpeg',
      fileSize: PLAINTEXT.length,
    });
    await iscnArweaveTxCollection.doc(PROTECTED_ID).set({
      tier: 'protected',
      status: 'complete',
      isRequireAuth: true,
      ownerWallet: testingLikeWallet1,
      contentBucketPath: PROTECTED_ID,
      contentType: 'application/epub+zip',
    });
    await iscnArweaveTxCollection.doc(PENDING_ID).set({
      tier: 'open',
      status: 'pending',
      isRequireAuth: false,
      contentBucketPath: PENDING_ID,
    });
  });

  it('serves a public open-tier file with cache and CORS headers', async () => {
    const res = await getFile(OPEN_ID, { headers: { Origin: 'https://publish.3ook.com' } });

    expect(res.status).toBe(200);
    expect(Buffer.from(res.data)).toEqual(PLAINTEXT);
    expect(reads).toEqual([`open:${OPEN_ID}`]);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404 for a protected file, even to its owner', async () => {
    const res = await getFile(PROTECTED_ID, {
      headers: { Authorization: `Bearer ${jwtSign({ wallet: testingWallet1, permissions: ['read:iscn'] })}` },
    });

    expect(res.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('answers 404 for a pending upload and for an unknown id', async () => {
    expect((await getFile(PENDING_ID)).status).toBe(404);
    expect((await getFile('no-such-id')).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('answers 404 without a cacheable header when the object is gone', async () => {
    readError = { code: 404 };
    const res = await getFile(OPEN_ID);

    expect(res.status).toBe(404);
    expect(String(res.headers['cache-control'])).not.toContain('immutable');
  });

  it('HEAD returns headers without reading the object body', async () => {
    const res = await getFile(OPEN_ID, { method: 'head' });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(PLAINTEXT.length));
    expect(bytesPulled).toBe(0);
  });
});
