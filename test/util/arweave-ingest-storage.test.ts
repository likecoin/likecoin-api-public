import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { webcrypto, createHash } from 'crypto';
import { Readable, PassThrough } from 'stream';

const calls: string[] = [];
const objects = new Map<string, Buffer>();
const copyOptions = new Map<string, unknown>();

function makeFile(path: string) {
  return {
    createWriteStream: () => {
      const pass = new PassThrough();
      const chunks: Buffer[] = [];
      pass.on('data', (c) => chunks.push(Buffer.from(c)));
      pass.on('end', () => {
        objects.set(path, Buffer.concat(chunks));
        calls.push(`write:${path}`);
      });
      return pass;
    },
    copy: async (dest: { name: string }, options: unknown) => {
      calls.push(`copy:${path}->${dest.name}`);
      copyOptions.set(dest.name, options);
      objects.set(dest.name, objects.get(path) as Buffer);
    },
    delete: async () => {
      calls.push(`delete:${path}`);
      objects.delete(path);
    },
    name: path,
  };
}

vi.mock('../../src/util/gcloudStorage', () => ({
  isEbookProtectedBucketEnabled: () => true,
  getEbookProtectedBucket: () => ({ file: (p: string) => makeFile(p) }),
}));

vi.mock('../../src/util/api/arweave/tx', () => ({
  markArweaveTxIngested: async (...args: unknown[]) => {
    calls.push(`mark:${JSON.stringify(args[1])}`);
  },
}));

// Override only `get` — ingest.ts also imports the named AxiosError export.
const axiosGet = vi.fn();
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => axiosGet(...a) } };
});

const { ingestProtectedContent } = await import('../../src/util/api/arweave/ingest');

const PLAINTEXT = Buffer.from(Array.from({ length: 50000 }, (_, i) => i % 256));

async function encrypted() {
  const cryptoKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const enc = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, PLAINTEXT);
  const raw = await webcrypto.subtle.exportKey('raw', cryptoKey);
  return {
    keyBase64: Buffer.from(raw).toString('base64'),
    combined: Buffer.concat([Buffer.from(iv), Buffer.from(enc)]),
  };
}

describe('ingestProtectedContent (staging → verify → promote)', () => {
  beforeEach(() => {
    calls.length = 0;
    objects.clear();
    copyOptions.clear();
  });

  it('stages, verifies, promotes, and cleans up', async () => {
    const { keyBase64, combined } = await encrypted();
    const sha = createHash('sha256').update(PLAINTEXT).digest('hex');
    axiosGet.mockResolvedValue({
      data: Readable.from([combined], { objectMode: false }),
      headers: { 'content-type': 'application/pdf' },
    });

    const result = await ingestProtectedContent('txhash1', {
      arweaveId: 'ar1', key: keyBase64, ipfsHash: 'ipfs1', fileSHA256: sha,
    });

    expect(result).toEqual({ contentBucketPath: 'txhash1', fileSHA256: sha });
    expect(calls).toEqual([
      'write:staging/txhash1',
      'copy:staging/txhash1->txhash1',
      `mark:${JSON.stringify({ contentBucketPath: 'txhash1', contentType: 'application/pdf' })}`,
      'delete:staging/txhash1',
    ]);
    expect((objects.get('txhash1') as Buffer).equals(PLAINTEXT)).toBe(true);
    // copy() nests custom metadata differently from createWriteStream() — pin it.
    expect(copyOptions.get('txhash1')).toEqual({
      contentType: 'application/pdf',
      metadata: { arweaveId: 'ar1', ipfsHash: 'ipfs1', fileSHA256: sha },
    });
  });

  it('leaves nothing at the canonical path when the hash anchor mismatches', async () => {
    const { keyBase64, combined } = await encrypted();
    axiosGet.mockResolvedValue({
      data: Readable.from([combined], { objectMode: false }),
      headers: { 'content-type': 'application/pdf' },
    });

    await expect(ingestProtectedContent('txhash2', {
      arweaveId: 'ar1', key: keyBase64, fileSHA256: 'deadbeef',
    })).rejects.toThrow('PLAINTEXT_HASH_MISMATCH');

    expect(objects.has('txhash2')).toBe(false);
    expect(calls).toEqual(['write:staging/txhash2', 'delete:staging/txhash2']);
  });

  it('leaves nothing at the canonical path when the GCM tag is tampered', async () => {
    const { keyBase64, combined } = await encrypted();
    const i = combined.length - 30;
    combined[i] = combined[i] === 0 ? 1 : 0;
    axiosGet.mockResolvedValue({
      data: Readable.from([combined], { objectMode: false }),
      headers: { 'content-type': 'application/pdf' },
    });

    await expect(ingestProtectedContent('txhash3', {
      arweaveId: 'ar1', key: keyBase64,
    })).rejects.toThrow();

    expect(objects.has('txhash3')).toBe(false);
    expect(calls).toContain('delete:staging/txhash3');
    expect(calls).not.toContain('copy:staging/txhash3->txhash3');
  });
});
