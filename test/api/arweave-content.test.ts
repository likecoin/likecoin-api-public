import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { Readable } from 'stream';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import mockEVMAddress from './address';
// Both wallets of the same `testing` user, so a cross-wallet match is expected.
import { testingWallet1, testingLikeWallet1 } from './data';
import { iscnArweaveTxCollection } from '../../src/util/firebase';

const TX_HASH = 'gcs-arweave-content-test';
const BUCKET_PATH = TX_HASH;
const DOC_TOKEN = 'doc-upload-token';
const PLAINTEXT = Buffer.from('PKfake-epub-bytes');

const reads: string[] = [];
let lastStream: Readable | null = null;
let readError: { code: number } | null = null;
let streamError: { code: number } | null = null;
let payload: Buffer = PLAINTEXT;
let bytesPulled = 0;

// Per-file rather than in setup.ts: a global stub would make the protected bucket
// look configured to arweave-link.test.ts, whose contentUri case asserts it is not.
// importOriginal keeps bookCacheBucket and friends real for the rest of the routes.
vi.mock('../../src/util/gcloudStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/gcloudStorage')>();
  return {
    ...actual,
    isEbookTierBucketEnabled: () => true,
    getTierFileStream: async (tier: string, objectPath: string) => {
      reads.push(`${tier}:${objectPath}`);
      if (readError) throw readError;
      if (objectPath !== BUCKET_PATH) throw new Error('NOT_FOUND');
      // Counted on pull, from a lazy generator: attaching a 'data' listener here
      // would flip the stream into flowing mode and drain it before the route
      // decides HEAD vs GET, measuring the probe rather than the route.
      lastStream = streamError
        ? new Readable({ read() { this.destroy(Object.assign(new Error('gone'), streamError)); } })
        : Readable.from((function* yieldOnce() {
          bytesPulled += payload.length;
          yield payload;
        }()));
      return {
        stream: lastStream,
        contentType: 'application/octet-stream',
        size: payload.length,
      };
    },
  };
});

describe('Arweave content API', () => {
  // request(), not get(): axios's get() merges { method: 'get' } OVER the caller's
  // config, so a method override here would be silently discarded.
  const getContent = (txHash: string, config = {}) => axiosist
    .request({ url: `/api/arweave/v2/content/${txHash}`, responseType: 'arraybuffer', ...config })
    .catch((err) => (err as any).response);

  const getWithWallet = (wallet?: string) => getContent(TX_HASH, {
    headers: { Authorization: `Bearer ${jwtSign({ wallet, permissions: ['read:iscn'] })}` },
  });

  beforeEach(async () => {
    reads.length = 0;
    lastStream = null;
    readError = null;
    streamError = null;
    payload = PLAINTEXT;
    bytesPulled = 0;
    await iscnArweaveTxCollection.doc(TX_HASH).set({
      source: 'gcs',
      tier: 'protected',
      status: 'complete',
      isRequireAuth: true,
      ownerWallet: testingLikeWallet1,
      contentBucketPath: BUCKET_PATH,
      contentType: 'application/epub+zip',
      token: DOC_TOKEN,
    });
  });

  it('streams the ingested plaintext to the owner', async () => {
    const res = await getWithWallet(testingWallet1);

    expect(res.status).toBe(200);
    expect(Buffer.from(res.data)).toEqual(PLAINTEXT);
    expect(reads).toEqual([`protected:${BUCKET_PATH}`]);
  });

  // The doc's recorded type wins over the bucket's: ingest sniffs the plaintext,
  // while a staged object can still carry the placeholder it was copied with.
  it('serves the content type recorded on the doc', async () => {
    const res = await getWithWallet(testingWallet1);

    expect(res.headers['content-type']).toContain('application/epub+zip');
    expect(res.headers['content-length']).toBe(String(PLAINTEXT.length));
  });

  // ingestProtectedContent decrypts on the way into the bucket, so a legacy doc
  // that still carries an encryptedKey has plaintext at rest. Gating this route on
  // isArweaveTxEncrypted would lock the publisher out of exactly those books.
  it('serves a legacy doc that still carries an encryptedKey', async () => {
    await iscnArweaveTxCollection.doc(TX_HASH).update({ encryptedKey: 'wrapped' });
    const res = await getWithWallet(testingWallet1);

    expect(res.status).toBe(200);
    expect(Buffer.from(res.data)).toEqual(PLAINTEXT);
  });

  it('never puts a key on the response', async () => {
    await iscnArweaveTxCollection.doc(TX_HASH).update({ key: Buffer.alloc(32, 1).toString('base64') });
    const res = await getWithWallet(testingWallet1);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.headers)).not.toContain('key');
  });

  it('accepts the upload token in place of wallet auth', async () => {
    const res = await getContent(TX_HASH, { params: { token: DOC_TOKEN } });

    expect(res.status).toBe(200);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await getContent(TX_HASH);

    expect(res.status).toBe(401);
    expect(reads).toEqual([]);
  });

  it('rejects an unrelated wallet', async () => {
    const res = await getWithWallet(mockEVMAddress('dead'));

    expect(res.status).toBe(403);
    expect(reads).toEqual([]);
  });

  it('returns 404 for a doc with no ingested copy', async () => {
    const txHash = 'gcs-arweave-content-noingest';
    await iscnArweaveTxCollection.doc(txHash).set({
      status: 'complete',
      isRequireAuth: false,
      arweaveId: 'legacy-arweave-id',
    });
    const res = await getContent(txHash);

    expect(res.status).toBe(404);
  });

  // Express routes HEAD to the GET handler, and res.write() discards a HEAD body
  // while still draining the source — so the read must be torn down, not piped.
  it('answers HEAD without draining the object', async () => {
    const res = await getContent(TX_HASH, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${jwtSign({ wallet: testingWallet1, permissions: ['read:iscn'] })}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(PLAINTEXT.length));
    // A fully-consumed stream self-destroys, so `destroyed` alone cannot tell a
    // torn-down HEAD from a drained GET — assert nothing was pulled.
    expect(bytesPulled).toBe(0);
    expect(lastStream?.destroyed).toBe(true);
  });

  it('maps a deleted bucket object to 404, not 500', async () => {
    readError = { code: 404 };
    const res = await getWithWallet(testingWallet1);

    expect(res.status).toBe(404);
  });

  // pipeline() destroys `res` before its callback runs, so a status written from
  // there reaches a dead socket. This asserts the caller sees a real response.
  it('answers 404 when the object read fails after the metadata probe', async () => {
    streamError = { code: 404 };
    const res = await getWithWallet(testingWallet1);

    expect(res.status).toBe(404);
    expect(String(res.data)).toContain('CONTENT_OBJECT_NOT_FOUND');
  });

  // A known length of zero is still a known length; truthiness would drop it and
  // leave HEAD unable to report the object's size.
  it('reports Content-Length for a zero-byte object', async () => {
    payload = Buffer.alloc(0);
    const res = await getWithWallet(testingWallet1);

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('0');
  });

  it('returns 404 for an unknown tx', async () => {
    const res = await getContent('gcs-unknown');

    expect(res.status).toBe(404);
  });
});
