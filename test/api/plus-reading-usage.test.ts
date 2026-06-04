import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import { likeNFTBookCollection } from '../../src/util/firebase';

const PATH = '/api/plus/reading/usage';
const AUTH = 'test-plus-reading-service-token'; // matches PLUS_READING_SERVICE_TOKEN in test/setup.ts
const AUTH_HEADER = { Authorization: `Bearer ${AUTH}` };
const CLASS_ID = '0x1111111111111111111111111111111111111111';
const READER = '0x2222222222222222222222222222222222222222';
const OWNER = '0x3333333333333333333333333333333333333333';

const post = (body: Record<string, unknown>, headers?: Record<string, string>) => axiosist
  .post(PATH, body, headers ? { headers } : undefined)
  .catch((err) => (err as any).response);

describe('POST /plus/reading/usage', () => {
  it('rejects requests without the service token', async () => {
    const noAuth = await post({
      readerWallet: READER, classId: CLASS_ID, readingTimeMs: 1000, ttsTimeMs: 0,
    });
    expect(noAuth.status).toBe(401);
  });

  it('rejects an invalid reader wallet', async () => {
    const res = await post({
      readerWallet: 'not-a-wallet', classId: CLASS_ID, readingTimeMs: 1000, ttsTimeMs: 0,
    }, AUTH_HEADER);
    expect(res.status).toBe(400);
  });

  it('records usage into the book rollup under the lowercase class id', async () => {
    // Post a mixed-case (EIP-55) class id; the ledger key must be lowercased.
    const mixedCaseClassId = '0xAbCdEf1111111111111111111111111111111111';
    const lowerClassId = mixedCaseClassId.toLowerCase();
    await likeNFTBookCollection.doc(lowerClassId)
      .set({ classId: lowerClassId, ownerWallet: OWNER } as any);

    const res = await post({
      readerWallet: READER,
      classId: mixedCaseClassId,
      readingTimeMs: 1500,
      ttsTimeMs: 4200,
      occurredAt: Date.UTC(2026, 2, 10, 8), // 2026-03
    }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ success: true, periodId: '2026-03' });

    const doc = await likeNFTBookCollection
      .doc(lowerClassId)
      .collection('plusUsage')
      .doc('2026-03')
      .get();
    // increment() is identity in the stub, so a single write stores the posted value.
    const data = doc.data() as any;
    expect(data.readingTimeMs).toBe(1500);
    expect(data.ttsTimeMs).toBe(4200);
  });

  it('acks a no-op (zero duration) without requiring a book', async () => {
    const res = await post({
      readerWallet: READER,
      classId: CLASS_ID,
      readingTimeMs: 0,
      ttsTimeMs: 0,
      occurredAt: Date.UTC(2026, 4, 1), // 2026-05
    }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ success: true, periodId: '2026-05' });
  });
});
