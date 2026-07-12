import {
  describe, it, expect, beforeEach,
} from 'vitest';
import axiosist from './axiosist';
import { iscnArweaveTxCollection } from '../../src/util/firebase';

const TX_HASH = '0xarweavelinktest';
const ARWEAVE_ID = 'test-arweave-id';
const CONTENT_KEY = Buffer.alloc(32, 1).toString('base64');

describe('Arweave link API', () => {
  beforeEach(async () => {
    await iscnArweaveTxCollection.doc(TX_HASH).set({
      arweaveId: ARWEAVE_ID,
      status: 'complete',
      isRequireAuth: false,
      key: CONTENT_KEY,
    });
  });

  it('returns key and gateway link for a registered tx', async () => {
    const res = await axiosist.get(`/api/arweave/v2/link/${TX_HASH}`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.arweaveId).toBe(ARWEAVE_ID);
    expect(res.data.txHash).toBe(TX_HASH);
    expect(res.data.key).toBe(CONTENT_KEY);
    expect(res.data.link).toContain(ARWEAVE_ID);
    expect(res.data.link).toContain(`key=${encodeURIComponent(CONTENT_KEY)}`);
  });

  it('omits contentUri when the protected bucket is not configured', async () => {
    // The doc records an ingested copy, but EBOOK_PROTECTED_BUCKET is unset in
    // tests, so the response must not advertise an unreadable gs:// URI.
    await iscnArweaveTxCollection.doc(TX_HASH).update({
      contentBucketPath: TX_HASH,
      contentType: 'application/epub+zip',
    });
    const res = await axiosist.get(`/api/arweave/v2/link/${TX_HASH}`)
      .catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.contentUri).toBeUndefined();
    expect(res.data.contentType).toBeUndefined();
  });

  it('returns 404 for an unknown tx', async () => {
    const res = await axiosist.get('/api/arweave/v2/link/0xunknown')
      .catch((err) => (err as any).response);

    expect(res.status).toBe(404);
  });
});
