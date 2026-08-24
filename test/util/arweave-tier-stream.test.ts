import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { Readable } from 'stream';

// The route-level suite stubs getTierFileStream out entirely, so the generation
// pin and the contentEncoding guard are only reachable from here.
const fileCalls: Array<{ path: string, options?: { generation?: string | number } }> = [];
let metadata: Record<string, unknown> = {};

function makeBucket() {
  return {
    file: (path: string, options?: { generation?: string | number }) => {
      fileCalls.push({ path, options });
      return {
        getMetadata: async () => [metadata],
        createReadStream: () => Readable.from([Buffer.from('bytes')]),
      };
    },
  };
}

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    // eslint-disable-next-line class-methods-use-this
    bucket() { return makeBucket(); }
  },
}));

// Spread the real config so only the bucket name changes — a bare factory would
// drop every other key this module tree reads.
vi.mock('../../config/config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EBOOK_PROTECTED_BUCKET: 'protected-test-bucket',
}));

const { getTierFileStream } = await import('../../src/util/gcloudStorage');

describe('getTierFileStream', () => {
  beforeEach(() => {
    fileCalls.length = 0;
    metadata = { size: '5', contentType: 'application/epub+zip', generation: '1700000000000001' };
  });

  // Without the pin, an object replaced between the metadata call and the read
  // streams new bytes under the previous Content-Length.
  it('reads the generation its metadata describes', async () => {
    const { size, contentType } = await getTierFileStream('protected', 'book-path');

    expect(size).toBe(5);
    expect(contentType).toBe('application/epub+zip');
    expect(fileCalls).toHaveLength(2);
    expect(fileCalls[0]?.options?.generation).toBeUndefined();
    expect(fileCalls[1]).toEqual({
      path: 'book-path',
      options: { generation: '1700000000000001' },
    });
  });

  it('rejects a gzip-encoded object rather than truncate it', async () => {
    metadata = { ...metadata, contentEncoding: 'gzip' };

    await expect(getTierFileStream('protected', 'book-path'))
      .rejects.toThrow('UNSUPPORTED_CONTENT_ENCODING: gzip');
  });

  // Number(undefined) is NaN, which must not reach Content-Length.
  it('omits size when the object metadata carries none', async () => {
    metadata = { contentType: 'application/pdf', generation: '2' };

    const { size } = await getTierFileStream('protected', 'book-path');

    expect(size).toBeUndefined();
  });
});
