import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { likeNFTBookCollection } from '../../src/util/firebase';
import { getPlusReadingStatsForWallet, summarizePlusReadingStats } from '../../src/util/api/plus/stats';

const OWNER = '0x1234123412341234123412341234123412341234';
const OTHER = '0x5678567856785678567856785678567856785678';

describe('summarizePlusReadingStats', () => {
  it('sums durations and counts distinct books and periods', () => {
    expect(summarizePlusReadingStats([
      {
        classId: '0xa', periodId: '2026-03', readingTimeMs: 100, ttsTimeMs: 50,
      },
      {
        classId: '0xb', periodId: '2026-03', readingTimeMs: 200, ttsTimeMs: 0,
      },
      {
        classId: '0xa', periodId: '2026-02', readingTimeMs: 30, ttsTimeMs: 10,
      },
    ])).toEqual({
      totalReadingTimeMs: 330,
      totalTTSTimeMs: 60,
      bookCount: 2,
      periodCount: 2,
    });
  });

  it('returns zeros for an empty list', () => {
    expect(summarizePlusReadingStats([])).toEqual({
      totalReadingTimeMs: 0,
      totalTTSTimeMs: 0,
      bookCount: 0,
      periodCount: 0,
    });
  });
});

describe('getPlusReadingStatsForWallet', () => {
  // Usage is bucketed daily (`YYYY-MM-DD` + dayMs); the endpoint rolls days up to their month
  // by default. Book A's two March days sum to 6000/1000 — the same totals the monthly view
  // reports. Reseeded per test (the firebase stub clears these collections before each test).
  async function day(classId, dayId, dayMs, readingTimeMs, ttsTimeMs) {
    await likeNFTBookCollection.doc(classId).collection('plusUsage').doc(dayId)
      .set({ readingTimeMs, ttsTimeMs, dayMs } as any);
  }
  // Pin "now" so the default trailing window (DEFAULT_STATS_WINDOW_MONTHS) always spans the
  // seeded 2026-02/03 usage; otherwise the no-period tests would flap once wall-clock time
  // moves past the window. Only Date is faked, leaving the seeding's async awaits untouched.
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 25)));
    // Book A (owned) — March across two days + one February day.
    await likeNFTBookCollection.doc('0xaaa').set({ ownerWallet: OWNER, classId: '0xaaa' } as any);
    await day('0xaaa', '2026-03-05', Date.UTC(2026, 2, 5), 4000, 600);
    await day('0xaaa', '2026-03-20', Date.UTC(2026, 2, 20), 2000, 400);
    await day('0xaaa', '2026-02-10', Date.UTC(2026, 1, 10), 3000, 0);
    // Book B (owned) — one March day.
    await likeNFTBookCollection.doc('0xbbb').set({ ownerWallet: OWNER, classId: '0xbbb' } as any);
    await day('0xbbb', '2026-03-15', Date.UTC(2026, 2, 15), 2000, 500);
    // Book C (owned) — no usage, must be excluded.
    await likeNFTBookCollection.doc('0xccc').set({ ownerWallet: OWNER, classId: '0xccc' } as any);
    // Book D (other owner) — must not leak into OWNER's stats.
    await likeNFTBookCollection.doc('0xddd').set({ ownerWallet: OTHER, classId: '0xddd' } as any);
    await day('0xddd', '2026-03-01', Date.UTC(2026, 2, 1), 9999, 9999);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rolls daily usage up to its month, sorted newest period first then by book', async () => {
    const { stats, summary } = await getPlusReadingStatsForWallet(OWNER);
    expect(stats.map((s) => `${s.periodId}/${s.classId}`)).toEqual([
      '2026-03/0xaaa',
      '2026-03/0xbbb',
      '2026-02/0xaaa',
    ]);
    // Book A's two March days summed into one month entry.
    expect(stats[0]).toMatchObject({ readingTimeMs: 6000, ttsTimeMs: 1000 });
    expect(summary).toEqual({
      totalReadingTimeMs: 11000,
      totalTTSTimeMs: 1500,
      bookCount: 2,
      periodCount: 2,
    });
  });

  it('sums a whole month when given a YYYY-MM period', async () => {
    const { stats, summary } = await getPlusReadingStatsForWallet(OWNER, { periodId: '2026-03' });
    expect(stats).toHaveLength(2);
    expect(stats.every((s) => s.periodId === '2026-03')).toBe(true);
    expect(summary).toMatchObject({
      totalReadingTimeMs: 8000,
      totalTTSTimeMs: 1500,
      bookCount: 2,
      periodCount: 1,
    });
  });

  it('reads a single day when given a YYYY-MM-DD period', async () => {
    const { stats, summary } = await getPlusReadingStatsForWallet(OWNER, { periodId: '2026-03-05' });
    expect(stats).toEqual([{
      classId: '0xaaa', periodId: '2026-03-05', readingTimeMs: 4000, ttsTimeMs: 600,
    }]);
    expect(summary).toMatchObject({
      totalReadingTimeMs: 4000,
      totalTTSTimeMs: 600,
      bookCount: 1,
      periodCount: 1,
    });
  });

  it('narrows to one owned book when given a classId', async () => {
    const { stats, summary } = await getPlusReadingStatsForWallet(OWNER, { classId: '0xaaa' });
    expect(stats.map((s) => `${s.periodId}/${s.classId}`)).toEqual([
      '2026-03/0xaaa',
      '2026-02/0xaaa',
    ]);
    expect(summary).toMatchObject({ bookCount: 1, periodCount: 2 });
  });

  it('does not leak another wallet\'s book when filtered by its classId', async () => {
    const { stats, summary } = await getPlusReadingStatsForWallet(OWNER, { classId: '0xddd' });
    expect(stats).toEqual([]);
    expect(summary).toMatchObject({ bookCount: 0, periodCount: 0 });
  });

  it('returns empty stats for a wallet that owns no books', async () => {
    const { stats, summary } = await getPlusReadingStatsForWallet('0x0000000000000000000000000000000000000000');
    expect(stats).toEqual([]);
    expect(summary).toEqual({
      totalReadingTimeMs: 0,
      totalTTSTimeMs: 0,
      bookCount: 0,
      periodCount: 0,
    });
  });
});
