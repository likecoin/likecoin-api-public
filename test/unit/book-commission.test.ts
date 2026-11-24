import {
  beforeEach, describe, expect, it,
} from 'vitest';

import {
  parseBookCommissionQuery,
  setBookCommission,
} from '../../src/util/api/likernft/book/commission';
import { likeNFTBookCollection } from '../../src/util/firebase';

const MERCH_ID = 'boox-bundle';
const BOOK_ID = '0xbook';

async function getStored(classId: string) {
  return (await likeNFTBookCollection.doc(classId).get()).data();
}

describe('parseBookCommissionQuery', () => {
  it('parses both ratios', () => {
    expect(parseBookCommissionQuery([MERCH_ID, '0.3148', '0.1'], '/book')).toEqual({
      classId: MERCH_ID,
      ratios: { platformCommissionRatio: 0.3148, channelCommissionRatio: 0.1 },
    });
    expect(parseBookCommissionQuery([BOOK_ID, '0', '0'], '/book').ratios).toEqual({
      platformCommissionRatio: 0,
      channelCommissionRatio: 0,
    });
  });

  it('accepts ratios that sum to exactly 1 with the platform fee', () => {
    expect(parseBookCommissionQuery([MERCH_ID, '0.6', '0.35'], '/book').ratios).toEqual({
      platformCommissionRatio: 0.6,
      channelCommissionRatio: 0.35,
    });
  });

  it('parses reset, case-insensitively', () => {
    expect(parseBookCommissionQuery([BOOK_ID, 'RESET'], '/book')).toEqual({
      classId: BOOK_ID,
      ratios: null,
    });
  });

  it.each([
    ['no params', []],
    ['a missing channel ratio', [MERCH_ID, '0.3']],
    ['extra params', [MERCH_ID, '0.3', '0.1', '1']],
    ['reset with a ratio', [MERCH_ID, 'reset', '0.1']],
    ['a negative ratio', [MERCH_ID, '-0.1', '0']],
    ['a ratio above 1', [MERCH_ID, '1.5', '0']],
    ['a percentage', [MERCH_ID, '30%', '0']],
    ['a non-number', [MERCH_ID, 'abc', '0']],
    ['ratios exceeding 1 with the platform fee', [MERCH_ID, '0.9', '0.1']],
  ])('rejects %s', (_label, params) => {
    expect(() => parseBookCommissionQuery(params, '/book')).toThrow();
  });
});

describe('setBookCommission', () => {
  beforeEach(async () => {
    await likeNFTBookCollection.doc(MERCH_ID).set({
      classId: MERCH_ID,
      name: 'Boox Bundle',
      productType: 'merch',
    } as any);
    await likeNFTBookCollection.doc(BOOK_ID).set({
      classId: BOOK_ID,
      name: 'A Book',
    } as any);
  });

  it.each([
    [MERCH_ID, 'Boox Bundle'],
    [BOOK_ID, 'A Book'],
  ])('stores both ratios on %s', async (classId, className) => {
    const query = {
      classId,
      ratios: { platformCommissionRatio: 0.3148, channelCommissionRatio: 0.1 },
    };
    expect(await setBookCommission(query)).toEqual({ ...query, className });
    expect(await getStored(classId)).toMatchObject(query.ratios);
  });

  it('removes both fields on reset', async () => {
    await setBookCommission({
      classId: BOOK_ID,
      ratios: { platformCommissionRatio: 0, channelCommissionRatio: 0 },
    });
    expect(await setBookCommission({ classId: BOOK_ID, ratios: null }))
      .toEqual({ classId: BOOK_ID, className: 'A Book', ratios: null });
    const stored = await getStored(BOOK_ID);
    expect(stored).not.toHaveProperty('platformCommissionRatio');
    expect(stored).not.toHaveProperty('channelCommissionRatio');
  });

  it('throws for an unknown listing', async () => {
    await expect(setBookCommission({ classId: 'missing', ratios: null })).rejects.toThrow('not found');
  });
});
