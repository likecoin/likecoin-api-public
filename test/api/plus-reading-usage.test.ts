import { describe, it, expect } from 'vitest';
import axiosist from './axiosist';
import mockEVMAddress from './address';
import { likeNFTBookCollection } from '../../src/util/firebase';

const PATH = '/api/plus/reading/usage';
const AUTH = 'test-plus-reading-service-token'; // matches PLUS_READING_SERVICE_TOKEN in test/setup.ts
const AUTH_HEADER = { Authorization: `Bearer ${AUTH}` };
const CLASS_ID = mockEVMAddress(0x11);
const READER = mockEVMAddress(0x22);
const OWNER = mockEVMAddress(0x33);

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
      occurredAt: Date.UTC(2026, 2, 10, 8), // 2026-03-10
    }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      success: true,
      dayId: '2026-03-10',
      results: [{ dayId: '2026-03-10', applied: true }],
    });

    const doc = await likeNFTBookCollection
      .doc(lowerClassId)
      .collection('plusUsage')
      .doc('2026-03-10')
      .get();
    // increment() is identity in the stub, so a single write stores the posted value.
    const data = doc.data() as any;
    expect(data.readingTimeMs).toBe(1500);
    expect(data.ttsTimeMs).toBe(4200);
    // Start-of-day ms stamped so settlement can filter rollups by range.
    expect(data.dayMs).toBe(Date.UTC(2026, 2, 10));
  });

  it('records non-library engagement on the day rollup but not the per-reader grain', async () => {
    const classId = '0xbcdef22222222222222222222222222222222222';
    await likeNFTBookCollection.doc(classId)
      .set({ classId, ownerWallet: OWNER } as any);

    // Owned/non-Plus read: only the non-library fields are populated.
    const res = await post({
      readerWallet: READER,
      classId,
      readingTimeMs: 0,
      ttsTimeMs: 0,
      nonLibraryReadingTimeMs: 900,
      nonLibraryTtsTimeMs: 300,
      occurredAt: Date.UTC(2026, 2, 11, 8), // 2026-03-11
    }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      success: true,
      dayId: '2026-03-11',
      results: [{ dayId: '2026-03-11', applied: true }],
    });

    const dayDocRef = likeNFTBookCollection.doc(classId).collection('plusUsage').doc('2026-03-11');
    const day = (await dayDocRef.get()).data() as any;
    expect(day.nonLibraryReadingTimeMs).toBe(900);
    expect(day.nonLibraryTtsTimeMs).toBe(300);
    expect(day.readingTimeMs).toBe(0);
    expect(day.ttsTimeMs).toBe(0);
    // No rev-share-eligible time → no per-reader audit doc spawned at all.
    const readers = await dayDocRef.collection('readers').get();
    expect(readers.size).toBe(0);
  });

  it('rejects usage for a class id with no book doc', async () => {
    const orphanClassId = mockEVMAddress(0x44);
    const res = await post({
      readerWallet: READER,
      classId: orphanClassId,
      readingTimeMs: 1000,
      ttsTimeMs: 0,
      occurredAt: Date.UTC(2026, 2, 10),
    }, AUTH_HEADER);
    expect(res.status).toBe(404);
  });

  it('acks a no-op (zero duration) without requiring a book', async () => {
    const res = await post({
      readerWallet: READER,
      classId: CLASS_ID,
      readingTimeMs: 0,
      ttsTimeMs: 0,
      occurredAt: Date.UTC(2026, 4, 1), // 2026-05-01
    }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      success: true,
      dayId: '2026-05-01',
      results: [{ dayId: '2026-05-01', applied: false }],
    });
  });

  it('dedups a retried delta by idempotency id (no double-count)', async () => {
    const classId = mockEVMAddress(0x55);
    await likeNFTBookCollection.doc(classId).set({ classId, ownerWallet: OWNER } as any);
    const occurredAt = Date.UTC(2026, 2, 10, 8);
    const entry = (id: string, readingTimeMs: number) => ({
      id, readerWallet: READER, classId, readingTimeMs, ttsTimeMs: 0, occurredAt,
    });
    // Re-resolve the ref each read; the stub snapshots a doc at ref-creation time.
    const readDayReading = async () => (await likeNFTBookCollection
      .doc(classId).collection('plusUsage').doc('2026-03-10')
      .get()).data()?.readingTimeMs;

    const first = await post(entry('key-1', 1000), AUTH_HEADER);
    expect(first.data.results).toEqual([{ dayId: '2026-03-10', applied: true }]);
    expect(await readDayReading()).toBe(1000);

    // Same id, different value: deduped, so the rollup must NOT change (stub increment
    // is identity, so a non-deduped re-write would overwrite to 5000).
    const dup = await post(entry('key-1', 5000), AUTH_HEADER);
    expect(dup.data.results).toEqual([{ dayId: '2026-03-10', applied: false }]);
    expect(await readDayReading()).toBe(1000);

    // A fresh id applies again.
    const fresh = await post(entry('key-2', 5000), AUTH_HEADER);
    expect(fresh.data.results).toEqual([{ dayId: '2026-03-10', applied: true }]);
    expect(await readDayReading()).toBe(5000);
  });

  it('records a batch of entries in one request', async () => {
    const classId = mockEVMAddress(0x66);
    await likeNFTBookCollection.doc(classId).set({ classId, ownerWallet: OWNER } as any);

    const res = await post({
      entries: [
        {
          id: 'b-1', readerWallet: READER, classId, readingTimeMs: 100, ttsTimeMs: 0, occurredAt: Date.UTC(2026, 2, 10),
        },
        {
          id: 'b-2', readerWallet: READER, classId, readingTimeMs: 0, ttsTimeMs: 0, nonLibraryReadingTimeMs: 200, occurredAt: Date.UTC(2026, 2, 11),
        },
      ],
    }, AUTH_HEADER);
    expect(res.status).toBe(200);
    expect(res.data.results).toEqual([
      { dayId: '2026-03-10', applied: true },
      { dayId: '2026-03-11', applied: true },
    ]);
  });
});
