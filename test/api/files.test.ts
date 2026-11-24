import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';
import { Socket } from 'net';
import express, { type NextFunction, type Request, type Response } from 'express';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import { testingWallet1, testingLikeWallet1 } from './data';
import { iscnArweaveTxCollection } from '../../src/util/firebase';
import { serveTierFile } from '../../src/util/api/arweave/serve';

const OPEN_ID = 'files-open-cover';
const PROTECTED_ID = 'files-protected-ebook';
const PENDING_ID = 'files-pending-cover';
const NO_TIER_ID = 'files-no-tier';
const PROTECTED_PUBLIC_ID = 'files-protected-tier-public-flag';
const ARWEAVE_ID = 'A'.repeat(43);
const GONE_ARWEAVE_ID = 'B'.repeat(43);
const PROTECTED_ARWEAVE_ID = 'C'.repeat(43);
const PENDING_ARWEAVE_ID = 'D'.repeat(43);
const UUID_ID = '123e4567-e89b-42d3-a456-426614174000';
const PLAINTEXT = Buffer.from('fake-jpeg-bytes');

const reads: string[] = [];
let bytesPulled = 0;
let readError: { code: number } | null = null;
let streamError: { code: number } | null = null;
let missingObjects: string[] = [];

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
      if (missingObjects.includes(objectPath)) throw Object.assign(new Error('No such object'), { code: 404 });
      // Pulled lazily so a HEAD that never reads the body leaves the count at zero.
      return {
        stream: streamError
          ? new Readable({ read() { this.destroy(Object.assign(new Error('gone'), streamError)); } })
          : Readable.from((function* yieldOnce() {
            bytesPulled += PLAINTEXT.length;
            yield PLAINTEXT;
          }())),
        contentType: objectPath === ARWEAVE_ID ? 'image/png' : 'application/octet-stream',
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
    streamError = null;
    missingObjects = [GONE_ARWEAVE_ID];
    await iscnArweaveTxCollection.doc(PROTECTED_ARWEAVE_ID).set({
      tier: 'protected',
      status: 'complete',
      isRequireAuth: true,
      contentBucketPath: PROTECTED_ARWEAVE_ID,
    });
    await iscnArweaveTxCollection.doc(PENDING_ARWEAVE_ID).set({
      tier: 'open',
      status: 'pending',
      isRequireAuth: false,
      contentBucketPath: PENDING_ARWEAVE_ID,
    });
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
    await iscnArweaveTxCollection.doc(NO_TIER_ID).set({
      status: 'complete',
      isRequireAuth: false,
      contentBucketPath: NO_TIER_ID,
      contentType: 'application/epub+zip',
    });
    await iscnArweaveTxCollection.doc(PROTECTED_PUBLIC_ID).set({
      tier: 'protected',
      status: 'complete',
      isRequireAuth: false,
      contentBucketPath: PROTECTED_PUBLIC_ID,
      contentType: 'application/epub+zip',
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

  it('answers 404 unless the record is explicitly open-tier', async () => {
    expect((await getFile(NO_TIER_ID)).status).toBe(404);
    expect((await getFile(PROTECTED_PUBLIC_ID)).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('answers 404 for an id that cannot exist, without reading anything', async () => {
    const res = await getFile('a%2Fb');
    const tooLong = await getFile('a'.repeat(129));

    expect(res.status).toBe(404);
    expect(tooLong.status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('answers 404 without a cacheable header when the object is gone', async () => {
    readError = { code: 404 };
    const res = await getFile(OPEN_ID);

    expect(res.status).toBe(404);
    expect(String(res.headers['cache-control'])).not.toContain('immutable');
  });

  it('serves the open-bucket object named by an Arweave id that has no record', async () => {
    const res = await getFile(ARWEAVE_ID, { headers: { Origin: 'https://publish.3ook.com' } });

    expect(res.status).toBe(200);
    expect(Buffer.from(res.data)).toEqual(PLAINTEXT);
    expect(reads).toEqual([`open:${ARWEAVE_ID}`]);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404 without a cacheable header for an Arweave id with no record and no object', async () => {
    const res = await getFile(GONE_ARWEAVE_ID);

    expect(res.status).toBe(404);
    expect(String(res.headers['cache-control'])).not.toContain('immutable');
  });

  it('never reads the bucket for a record-less id that is not Arweave-shaped', async () => {
    expect((await getFile(UUID_ID)).status).toBe(404);
    expect((await getFile(`gcs-${UUID_ID}`)).status).toBe(404);
    expect((await getFile('A'.repeat(42))).status).toBe(404);
    expect((await getFile('A'.repeat(44))).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('does not fall back when a record exists but is protected or pending', async () => {
    expect((await getFile(PROTECTED_ARWEAVE_ID)).status).toBe(404);
    expect((await getFile(PENDING_ARWEAVE_ID)).status).toBe(404);
    expect(reads).toEqual([]);
  });

  it('HEAD on an Arweave id fallback does not read the body', async () => {
    const res = await getFile(ARWEAVE_ID, { method: 'head' });

    expect(res.status).toBe(200);
    expect(bytesPulled).toBe(0);
  });

  it('HEAD returns headers without reading the object body', async () => {
    const res = await getFile(OPEN_ID, { method: 'head' });

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(PLAINTEXT.length));
    expect(bytesPulled).toBe(0);
  });
});

// Driven without HTTP: once the stream errors, pipeline destroys the socket in the
// same tick, so whether the error page reaches a client depends on router timing.
// The header state at the moment the error is forwarded is what a cache would see.
describe('serveTierFile when the stream fails before the first byte', () => {
  const serve = async (code: number) => {
    streamError = { code };
    const res = Object.setPrototypeOf(
      new ServerResponse(new IncomingMessage(new Socket())),
      express.response,
    ) as Response;
    type Forwarded = { error: unknown; cacheControl: unknown };
    const forwarded = await new Promise<Forwarded>((resolve, reject) => {
      const next = ((error: unknown) => resolve({
        error,
        cacheControl: res.getHeader('Cache-Control'),
      })) as NextFunction;
      serveTierFile({ method: 'GET', destroyed: false } as Request, res, next, {
        tier: 'open',
        objectPath: OPEN_ID,
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
      }).catch(reject);
    });
    return forwarded;
  };

  it('forwards a not-found as 404 with no-store', async () => {
    const { error, cacheControl } = await serve(404);

    expect(error).toMatchObject({ status: 404, message: 'CONTENT_OBJECT_NOT_FOUND' });
    expect(cacheControl).toBe('no-store');
  });

  it('forwards any other error with no-store', async () => {
    const { error, cacheControl } = await serve(500);

    expect(error).toMatchObject({ message: 'gone' });
    expect(cacheControl).toBe('no-store');
  });
});
