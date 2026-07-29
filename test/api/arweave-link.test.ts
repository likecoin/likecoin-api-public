import {
  describe, it, expect, beforeEach,
} from 'vitest';
import axiosist from './axiosist';
import { jwtSign } from './jwt';
import mockEVMAddress from './address';
// Both wallets of the same `testing` user, so a cross-wallet match is expected.
import { testingWallet1, testingLikeWallet1 } from './data';
import { iscnArweaveTxCollection } from '../../src/util/firebase';

const TX_HASH = '0xarweavelinktest';
const ARWEAVE_ID = 'test-arweave-id';
const CONTENT_KEY = Buffer.alloc(32, 1).toString('base64');
const DOC_TOKEN = 'doc-upload-token';

describe('Arweave link API', () => {
  const getLink = (txHash: string, config = {}) => axiosist
    .get(`/api/arweave/v2/link/${txHash}`, config)
    .catch((err) => (err as any).response);

  beforeEach(async () => {
    await iscnArweaveTxCollection.doc(TX_HASH).set({
      arweaveId: ARWEAVE_ID,
      status: 'complete',
      isRequireAuth: false,
      key: CONTENT_KEY,
      token: DOC_TOKEN,
    });
  });

  it('returns key and gateway link for a registered tx', async () => {
    const res = await getLink(TX_HASH);

    expect(res.status).toBe(200);
    expect(res.data.arweaveId).toBe(ARWEAVE_ID);
    expect(res.data.txHash).toBe(TX_HASH);
    expect(res.data.key).toBe(CONTENT_KEY);
    expect(res.data.link).toContain(ARWEAVE_ID);
    expect(res.data.link).toContain(`key=${encodeURIComponent(CONTENT_KEY)}`);
    expect(res.data.hasPublicCopy).toBe(true);
  });

  // Each case seeds its own doc — the stub's set() appends rather than replaces,
  // so a doc the shared beforeEach touched cannot be reshaped in place.
  describe('hasPublicCopy', () => {
    const seed = async (txHash: string, doc: Record<string, unknown>) => {
      await iscnArweaveTxCollection.doc(txHash).set({
        status: 'complete',
        isRequireAuth: false,
        ...doc,
      });
    };

    it('is false when an encrypted doc has no resolvable key', async () => {
      // A KMS-written doc read with KMS off: resolveArweaveTxKey yields '' and
      // the link goes out without a key, so it serves only ciphertext.
      const txHash = '0xarweavelinkwrapped';
      await seed(txHash, { arweaveId: ARWEAVE_ID, encryptedKey: 'wrapped' });
      const res = await getLink(txHash);

      expect(res.status).toBe(200);
      expect(res.data.link).toContain(ARWEAVE_ID);
      expect(res.data.link).not.toContain('key=');
      expect(res.data.hasPublicCopy).toBe(false);
    });

    it('is true for an unencrypted doc, which needs no key', async () => {
      const txHash = '0xarweavelinkplain';
      await seed(txHash, { arweaveId: ARWEAVE_ID });
      const res = await getLink(txHash);

      expect(res.status).toBe(200);
      expect(res.data.hasPublicCopy).toBe(true);
    });

    it('is false for a GCS-direct doc, which has no link to fall back to', async () => {
      const txHash = '0xarweavelinkgcs';
      await seed(txHash, {
        source: 'gcs',
        contentBucketPath: txHash,
        contentType: 'application/epub+zip',
      });
      const res = await getLink(txHash);

      expect(res.status).toBe(200);
      expect(res.data.link).toBeUndefined();
      expect(res.data.hasPublicCopy).toBe(false);
    });
  });

  it('omits contentUri when the protected bucket is not configured', async () => {
    // The doc records an ingested copy, but EBOOK_PROTECTED_BUCKET is unset in
    // tests, so the response must not advertise an unreadable gs:// URI.
    await iscnArweaveTxCollection.doc(TX_HASH).update({
      contentBucketPath: TX_HASH,
      contentType: 'application/epub+zip',
    });
    const res = await getLink(TX_HASH);

    expect(res.status).toBe(200);
    expect(res.data.contentUri).toBeUndefined();
    expect(res.data.contentType).toBeUndefined();
  });

  // ebook-cors reads the key back off `link`, so the JSON branch keeps it. A browser
  // never decrypts, so it must get neither the key in a JSON body nor a redirect that
  // leaks it to history, the Referer chain and the gateway's logs. Real Accept header:
  // the */* in it satisfies accepts('application/json') on its own.
  it('never hands the key to a browser navigation', async () => {
    const res = await getLink(TX_HASH, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      maxRedirects: 0,
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(ARWEAVE_ID);
    expect(res.headers.location).not.toContain('key=');
    expect(res.headers.location).not.toContain(encodeURIComponent(CONTENT_KEY));
  });

  // axios (like ebook-cors) sends `application/json, text/plain, */*` — JSON outranks
  // HTML, so the programmatic caller must keep getting the key.
  it('still serves JSON with the key to an axios-style caller', async () => {
    const res = await getLink(TX_HASH, {
      headers: { Accept: 'application/json, text/plain, */*' },
    });

    expect(res.status).toBe(200);
    expect(res.data.key).toBe(CONTENT_KEY);
    expect(res.data.link).toContain(`key=${encodeURIComponent(CONTENT_KEY)}`);
  });

  it('returns 404 for an unknown tx', async () => {
    const res = await getLink('0xunknown');

    expect(res.status).toBe(404);
  });

  // Ownership must survive a Cosmos↔EVM migration: a legacy upload stamped with
  // like1… is still owned by the same identity now authenticating with evmWallet.
  describe('isRequireAuth ownership', () => {
    const getWithWallet = (wallet: string) => getLink(TX_HASH, {
      headers: { Authorization: `Bearer ${jwtSign({ wallet, permissions: ['read:iscn'] })}` },
    });

    beforeEach(async () => {
      await iscnArweaveTxCollection.doc(TX_HASH).update({
        isRequireAuth: true,
        ownerWallet: testingLikeWallet1,
      });
    });

    it('accepts the linked evmWallet for a likeWallet-owned tx', async () => {
      const res = await getWithWallet(testingWallet1);

      expect(res.status).toBe(200);
      expect(res.data.arweaveId).toBe(ARWEAVE_ID);
    });

    it('accepts the linked likeWallet for an evmWallet-owned tx', async () => {
      await iscnArweaveTxCollection.doc(TX_HASH).update({ ownerWallet: testingWallet1 });
      const res = await getWithWallet(testingLikeWallet1);

      expect(res.status).toBe(200);
      expect(res.data.arweaveId).toBe(ARWEAVE_ID);
    });

    it('rejects an unrelated wallet', async () => {
      const res = await getWithWallet(mockEVMAddress('dead'));

      expect(res.status).toBe(403);
    });

    it('accepts the upload token in place of wallet auth', async () => {
      const res = await getLink(TX_HASH, { params: { token: DOC_TOKEN } });

      expect(res.status).toBe(200);
    });

    it('rejects an unauthenticated request', async () => {
      const res = await getLink(TX_HASH);

      expect(res.status).toBe(401);
    });
  });
});
