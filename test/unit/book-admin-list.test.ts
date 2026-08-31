import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import {
  BOOK_LIST_DEFAULT_LIMIT,
  BOOK_LIST_MAX_LIMIT,
  describeBookListQuery,
  listBooksForAdmin,
  parseBookListQuery,
} from '../../src/util/api/likernft/book/adminList';
import { likeNFTBookCollection } from '../../src/util/firebase';
import type { AdminBookListItem } from '../../src/util/api/likernft/book/adminList';
import { createBookListSlackBlocks } from '../../src/util/slack';

function book(overrides: Partial<AdminBookListItem> = {}): AdminBookListItem {
  return { classId: 'class-a', name: 'A Book', ...overrides };
}

describe('parseBookListQuery', () => {
  it('defaults to newest first with no filters', () => {
    const query = parseBookListQuery([]);
    expect(query).toEqual({
      order: 'desc',
      limit: BOOK_LIST_DEFAULT_LIMIT,
      flags: [],
    });
  });

  it('parses order, flags and key:value tokens', () => {
    const query = parseBookListQuery(['asc', 'PENDING', 'noads', 'owner:0xAbC', 'limit:5']);
    expect(query.order).toBe('asc');
    expect(query.flags).toEqual(['pending', 'noads']);
    // wallets keep their original case
    expect(query.owner).toBe('0xAbC');
    expect(query.limit).toBe(5);
  });

  it('accepts a repeated flag without duplicating it', () => {
    expect(parseBookListQuery(['pending', 'pending']).flags).toEqual(['pending']);
  });

  it('clamps limit to the maximum', () => {
    expect(parseBookListQuery(['limit:999']).limit).toBe(BOOK_LIST_MAX_LIMIT);
  });

  it.each([
    ['unknown token', ['nonsense']],
    ['unknown key:value', ['status:live']],
    ['non-numeric limit', ['limit:abc']],
    ['zero limit', ['limit:0']],
    ['an inverted flag, which is no longer a thing', ['no-hidden']],
    ['a price filter, which is no longer a thing', ['free']],
  ])('rejects %s', (_label, params) => {
    expect(() => parseBookListQuery(params)).toThrow();
  });

  it('describes the query, always naming the chain scope', () => {
    const description = describeBookListQuery(parseBookListQuery(['pending', 'asc']));
    expect(description).toContain('chain base');
    expect(description).toContain('pending');
    expect(description).toContain('oldest first');
  });
});

describe('createBookListSlackBlocks', () => {
  it('renders a line per book with its notable flags', () => {
    const blocks = createBookListSlackBlocks(parseBookListQuery(['pending']), {
      books: [book({
        classId: 'class-a',
        minPriceInDecimal: 1250,
        isPendingReview: true,
        isApprovedForAds: false,
        restrictedTerritories: ['HK', 'CN'],
        timestamp: { toMillis: () => Date.UTC(2026, 7, 14) },
      })],
      total: 1,
      isScanCapped: false,
    });
    const text = JSON.stringify(blocks);
    expect(text).toContain('*1 book(s)*');
    expect(text).toContain('class-a');
    expect(text).toContain('US$12.50');
    expect(text).toContain('2026-08-14');
    expect(text).toContain('⏳pending');
    expect(text).toContain('🚫no-ads');
    expect(text).toContain('🌏HK,CN');
    // an unset flag is not an exception worth labelling
    expect(text).not.toContain('no-index');
  });

  it('escapes mrkdwn in author-supplied names', () => {
    const blocks = createBookListSlackBlocks(parseBookListQuery([]), {
      books: [book({ name: '<!channel> free books' })],
      total: 1,
      isScanCapped: false,
    });
    expect(JSON.stringify(blocks)).not.toContain('<!channel>');
  });

  it('reports the total when more matched than are shown', () => {
    const blocks = createBookListSlackBlocks(parseBookListQuery([]), {
      books: [book()],
      total: 42,
      isScanCapped: false,
    });
    expect(JSON.stringify(blocks)).toContain('showing first 1');
  });

  it('says so plainly when nothing matches', () => {
    const blocks = createBookListSlackBlocks(parseBookListQuery(['geoblocked']), {
      books: [],
      total: 0,
      isScanCapped: false,
    });
    expect(blocks).toHaveLength(1);
    const text = JSON.stringify(blocks);
    expect(text).toContain('No books found');
    // the header names the filters that produced the empty result
    expect(text).toContain('geoblocked');
  });

  // Names are author-supplied and unbounded, so this is the case that breaks
  // both of Slack's caps at once if the name is not truncated.
  it('stays within Slack block limits for pathologically long names', () => {
    const books = Array.from({ length: 50 }, (_, index) => book({
      classId: `class-${index}`,
      name: `Book ${index} `.padEnd(4000, '&'),
    }));
    const blocks = createBookListSlackBlocks(parseBookListQuery(['limit:50']), {
      books,
      total: 50,
      isScanCapped: false,
    });
    expect(blocks.length).toBeLessThanOrEqual(50);
    const sections = blocks.filter((block) => block.type === 'section');
    expect(sections.length).toBeGreaterThan(1);
    sections.forEach((block) => expect(block.text.text.length).toBeLessThanOrEqual(3000));
  });

  it('flags a capped scan so a partial result is never read as complete', () => {
    const blocks = createBookListSlackBlocks(parseBookListQuery([]), {
      books: [book()],
      total: 5000,
      isScanCapped: true,
    });
    const text = JSON.stringify(blocks);
    expect(text).toContain('Scan cap reached');
    // a capped count is a floor, so it must not be stated as an exact total
    expect(text).toContain('5000+ book(s)');
  });
});

describe('listBooksForAdmin', () => {
  const ts = (day: number) => ({ toMillis: () => Date.UTC(2026, 7, day) });

  beforeEach(async () => {
    await Promise.all([
      likeNFTBookCollection.doc('0xold').set({
        classId: '0xold', chain: 'base', timestamp: ts(1), ownerWallet: '0xAbC',
      } as any),
      likeNFTBookCollection.doc('0xnew').set({
        classId: '0xnew', chain: 'base', timestamp: ts(3), isPendingReview: true,
      } as any),
      likeNFTBookCollection.doc('0xmid').set({
        classId: '0xmid', chain: 'base', timestamp: ts(2), isApprovedForAds: false,
      } as any),
      likeNFTBookCollection.doc('likenft1legacy').set({
        classId: 'likenft1legacy', chain: 'like', timestamp: ts(4), isPendingReview: true,
      } as any),
    ]);
  });

  it('never returns legacy like-chain listings', async () => {
    const { books, total } = await listBooksForAdmin(parseBookListQuery([]));
    expect(total).toBe(3);
    expect(books.map((b) => b.classId)).not.toContain('likenft1legacy');
  });

  it('filters through the query, not in memory', async () => {
    const pending = await listBooksForAdmin(parseBookListQuery(['pending']));
    expect(pending.books.map((b) => b.classId)).toEqual(['0xnew']);
    expect(pending.total).toBe(1);
    const noAds = await listBooksForAdmin(parseBookListQuery(['noads']));
    expect(noAds.books.map((b) => b.classId)).toEqual(['0xmid']);
  });

  // An unset approval flag means legacy-approved, and `== false` never matches a
  // doc missing the field — so the tri-state is handled by Firestore itself.
  it('leaves a listing with no approval flag out of noads', async () => {
    await likeNFTBookCollection.doc('0xexplicit').set({
      classId: '0xexplicit', chain: 'base', timestamp: ts(5), isApprovedForAds: true,
    } as any);
    const { books } = await listBooksForAdmin(parseBookListQuery(['noads']));
    expect(books.map((b) => b.classId)).toEqual(['0xmid']);
  });

  it('matches an owner wallet exactly, as stored', async () => {
    const found = await listBooksForAdmin(parseBookListQuery(['owner:0xAbC']));
    expect(found.books.map((b) => b.classId)).toEqual(['0xold']);
    const missed = await listBooksForAdmin(parseBookListQuery(['owner:0xabc']));
    expect(missed.books).toHaveLength(0);
  });

  it('explains a missing composite index instead of leaking a gRPC error', async () => {
    const failure = Object.assign(new Error('The query requires an index. Create it here: https://x'), { code: 9 });
    const rejecting: any = {
      where: () => rejecting,
      orderBy: () => rejecting,
      limit: () => rejecting,
      select: () => rejecting,
      count: () => rejecting,
      get: () => Promise.reject(failure),
    };
    const spy = vi.spyOn(likeNFTBookCollection, 'where').mockReturnValueOnce(rejecting);
    await expect(listBooksForAdmin(parseBookListQuery(['pending'])))
      .rejects.toThrow(/needs a one-off Firestore index[\s\S]*Create it here/);
    spy.mockRestore();
  });

  it('reads a nested flag path for aireview', async () => {
    await likeNFTBookCollection.doc('0xai').set({
      classId: '0xai', chain: 'base', timestamp: ts(6), aiReview: { needsHumanReview: true },
    } as any);
    const { books } = await listBooksForAdmin(parseBookListQuery(['aireview']));
    expect(books.map((b) => b.classId)).toEqual(['0xai']);
  });

  describe('geoblocked', () => {
    beforeEach(async () => {
      await Promise.all([
        likeNFTBookCollection.doc('0xgeo1').set({
          classId: '0xgeo1', chain: 'base', timestamp: ts(10), restrictedTerritories: ['HK', 'CN'],
        } as any),
        likeNFTBookCollection.doc('0xgeo2').set({
          classId: '0xgeo2', chain: 'base', timestamp: ts(20), restrictedTerritories: ['HK'],
        } as any),
      ]);
    });

    // `!= null` matches a present-but-empty array, and the label predicate is
    // derived from that same clause, so the row is listed and labelled alike.
    it('treats an empty territory list the same way the query does', async () => {
      await likeNFTBookCollection.doc('0xempty').set({
        classId: '0xempty', chain: 'base', timestamp: ts(30), restrictedTerritories: [],
      } as any);
      const { books, total } = await listBooksForAdmin(parseBookListQuery(['geoblocked']));
      expect(books.map((b) => b.classId)).toContain('0xempty');
      expect(total).toBe(3);
      const blocks = createBookListSlackBlocks(parseBookListQuery(['geoblocked']), {
        books, total, isScanCapped: false,
      });
      expect(JSON.stringify(blocks)).toContain('🌏');
    });

    it('selects only listings that carry the field', async () => {
      const { books, total } = await listBooksForAdmin(parseBookListQuery(['geoblocked']));
      expect(total).toBe(2);
      expect(books.map((b) => b.classId).sort()).toEqual(['0xgeo1', '0xgeo2']);
    });

    // The inequality makes Firestore order by restrictedTerritories first, so
    // this branch sorts and slices in memory; a server-side limit would take
    // the wrong slice.
    it('orders by publish time in memory, both directions', async () => {
      const newest = await listBooksForAdmin(parseBookListQuery(['geoblocked']));
      expect(newest.books.map((b) => b.classId)).toEqual(['0xgeo2', '0xgeo1']);
      const oldest = await listBooksForAdmin(parseBookListQuery(['geoblocked', 'asc']));
      expect(oldest.books.map((b) => b.classId)).toEqual(['0xgeo1', '0xgeo2']);
    });

    it('takes the far end of the set for asc, not the near end reversed', async () => {
      const { books, total } = await listBooksForAdmin(parseBookListQuery(['geoblocked', 'asc', 'limit:1']));
      expect(books.map((b) => b.classId)).toEqual(['0xgeo1']);
      expect(total).toBe(2);
    });
  });
});
