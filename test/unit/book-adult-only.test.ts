import {
  beforeEach, describe, expect, it,
} from 'vitest';

import {
  parseBookAdultOnlyQuery,
  setBookAdultOnly,
} from '../../src/util/api/likernft/book/adultOnly';
import { likeNFTBookCollection } from '../../src/util/firebase';

const CLASS_ID = '0xadult';

async function getStored() {
  return (await likeNFTBookCollection.doc(CLASS_ID).get()).data();
}

describe('parseBookAdultOnlyQuery', () => {
  it('parses on and off, case-insensitively', () => {
    expect(parseBookAdultOnlyQuery([CLASS_ID, 'ON'])).toEqual({ classId: CLASS_ID, isAdultOnly: true });
    expect(parseBookAdultOnlyQuery([CLASS_ID, 'off'])).toEqual({ classId: CLASS_ID, isAdultOnly: false });
  });

  it.each([
    ['no params', []],
    ['a missing toggle', [CLASS_ID]],
    ['an unknown toggle', [CLASS_ID, 'yes']],
    ['extra params', [CLASS_ID, 'on', '1']],
  ])('rejects %s', (_label, params) => {
    expect(() => parseBookAdultOnlyQuery(params)).toThrow();
  });
});

describe('setBookAdultOnly', () => {
  beforeEach(async () => {
    await likeNFTBookCollection.doc(CLASS_ID).set({
      classId: CLASS_ID,
      name: 'Adult Book',
      isApprovedForAds: true,
    } as any);
  });

  it('marks the book adult only and denies ads', async () => {
    const result = await setBookAdultOnly({ classId: CLASS_ID, isAdultOnly: true });

    expect(result).toEqual({ classId: CLASS_ID, className: 'Adult Book', isAdultOnly: true });
    expect(await getStored()).toMatchObject({ isAdultOnly: true, isApprovedForAds: false });
  });

  it('clears adult only without restoring ad approval', async () => {
    await setBookAdultOnly({ classId: CLASS_ID, isAdultOnly: true });
    await setBookAdultOnly({ classId: CLASS_ID, isAdultOnly: false });

    expect(await getStored()).toMatchObject({ isAdultOnly: false, isApprovedForAds: false });
  });

  it('leaves ad approval untouched when turning off a book that was never adult only', async () => {
    await setBookAdultOnly({ classId: CLASS_ID, isAdultOnly: false });

    expect(await getStored()).toMatchObject({ isAdultOnly: false, isApprovedForAds: true });
  });

  it('throws for an unknown class', async () => {
    await expect(setBookAdultOnly({ classId: '0xmissing', isAdultOnly: true })).rejects.toThrow('not found');
  });
});
