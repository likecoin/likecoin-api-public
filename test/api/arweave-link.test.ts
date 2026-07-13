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

  // ebook-cors reads the key back off `link`, so the JSON branch keeps it. A browser
  // never decrypts, so it must get neither the key in a JSON body nor a redirect that
  // leaks it to history, the Referer chain and the gateway's logs. Real Accept header:
  // the */* in it satisfies accepts('application/json') on its own.
  it('never hands the key to a browser navigation', async () => {
    const res = await axiosist.get(`/api/arweave/v2/link/${TX_HASH}`, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      maxRedirects: 0,
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(ARWEAVE_ID);
    expect(res.headers.location).not.toContain('key=');
    expect(res.headers.location).not.toContain(encodeURIComponent(CONTENT_KEY));
  });

  // axios (like ebook-cors) sends `application/json, text/plain, */*` — JSON outranks
  // HTML, so the programmatic caller must keep getting the key.
  it('still serves JSON with the key to an axios-style caller', async () => {
    const res = await axiosist.get(`/api/arweave/v2/link/${TX_HASH}`, {
      headers: { Accept: 'application/json, text/plain, */*' },
    }).catch((err) => (err as any).response);

    expect(res.status).toBe(200);
    expect(res.data.key).toBe(CONTENT_KEY);
    expect(res.data.link).toContain(`key=${encodeURIComponent(CONTENT_KEY)}`);
  });

  it('returns 404 for an unknown tx', async () => {
    const res = await axiosist.get('/api/arweave/v2/link/0xunknown')
      .catch((err) => (err as any).response);

    expect(res.status).toBe(404);
  });
});
