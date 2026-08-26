import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { z } from 'zod';
import type { Response } from 'express';
import { filterNFTBookListingInfo, sendValidatedJSON } from '../../src/util/ValidationHelper';

function mockRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  return res as Response & { json: ReturnType<typeof vi.fn> };
}

const schema = z.object({ id: z.string(), count: z.number() });

describe('sendValidatedJSON', () => {
  it('sends data that matches the schema', () => {
    const res = mockRes();
    const data = { id: 'abc', count: 3 };
    sendValidatedJSON(res, schema, data);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('strips undeclared keys from the response', () => {
    const res = mockRes();
    sendValidatedJSON(res, schema, { id: 'abc', count: 3, secret: 'leak' } as any);
    expect(res.json).toHaveBeenCalledWith({ id: 'abc', count: 3 });
  });

  it('keeps undeclared keys on .passthrough() schemas', () => {
    const res = mockRes();
    const passthrough = schema.passthrough();
    const data = { id: 'abc', count: 3, extra: 'kept' };
    sendValidatedJSON(res, passthrough, data);
    expect(res.json).toHaveBeenCalledWith(data);
  });

  it('throws RESPONSE_SCHEMA_MISMATCH and does not send when data violates the schema', () => {
    const res = mockRes();
    expect(() => sendValidatedJSON(res, schema, { id: 'abc', count: 'nope' } as any))
      .toThrow(/RESPONSE_SCHEMA_MISMATCH/);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('sendValidatedJSON in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('enforces the schema in prod too (parses unconditionally, throws on mismatch)', async () => {
    // Re-import with a production-like env to confirm enforcement no longer hinges
    // on TEST_MODE: a response-schema mismatch throws RESPONSE_SCHEMA_MISMATCH in
    // prod, surfacing drift instead of shipping malformed data silently.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CI', '');
    const { sendValidatedJSON: prodSend } = await import('../../src/util/ValidationHelper');
    const res = mockRes();
    expect(() => prodSend(res, schema, { id: 'abc', count: 'nope' } as any))
      .toThrow(/RESPONSE_SCHEMA_MISMATCH/);
    expect(res.json).not.toHaveBeenCalled();
  });
});

function bookInfo(prices: any[]) {
  return {
    classId: '0xabc',
    ownerWallet: '0xowner',
    prices,
    isPlusReadingEnabled: true,
    isPreviewEnabled: true,
  } as any;
}

const LISTED = { priceInDecimal: 100, stock: 1, isUnlisted: false };
const UNLISTED = { priceInDecimal: 100, stock: 1, isUnlisted: true };

describe('filterNFTBookListingInfo library and preview masking', () => {
  it('reports borrowing and preview off when no edition is listed', () => {
    const payload = filterNFTBookListingInfo(bookInfo([UNLISTED, UNLISTED]));
    expect(payload.isPlusReadingEnabled).toBe(false);
    expect(payload.isPreviewEnabled).toBe(false);
  });

  it('leaves both on when at least one edition is listed', () => {
    const payload = filterNFTBookListingInfo(bookInfo([UNLISTED, LISTED]));
    expect(payload.isPlusReadingEnabled).toBe(true);
    expect(payload.isPreviewEnabled).toBe(true);
  });

  // Only an author's own unlisting counts. A listing always carries at least one
  // edition (NFTBookPricesSchema.min(1)), so an empty set is a broken doc rather
  // than a book taken off the shelf, and is left as it is.
  it('leaves a book with no editions at all alone', () => {
    const payload = filterNFTBookListingInfo(bookInfo([]));
    expect(payload.isPlusReadingEnabled).toBe(true);
    expect(payload.isPreviewEnabled).toBe(true);
  });

  // The owner reads the stored values: publish.3ook.com seeds its settings form
  // from this payload, so a masked false would be saved back over their opt-in.
  it('keeps the stored values for the owner', () => {
    const payload = filterNFTBookListingInfo(bookInfo([UNLISTED]), true);
    expect(payload.isPlusReadingEnabled).toBe(true);
    expect(payload.isPreviewEnabled).toBe(true);
  });

  it('does not turn a stored false into true', () => {
    const info = { ...bookInfo([LISTED]), isPlusReadingEnabled: false, isPreviewEnabled: false };
    const payload = filterNFTBookListingInfo(info);
    expect(payload.isPlusReadingEnabled).toBe(false);
    expect(payload.isPreviewEnabled).toBe(false);
  });
});
