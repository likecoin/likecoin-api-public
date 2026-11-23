import {
  beforeEach, describe, expect, it,
} from 'vitest';

import {
  parseBookMetadataQuery,
  resolveListingMetadata,
  setBookManualMetadata,
  updateListingWithChainMetadata,
} from '../../src/util/api/likernft/book/manualMetadata';
import { likeNFTBookCollection } from '../../src/util/firebase';

describe('resolveListingMetadata', () => {
  const listing = { name: 'Listing Name', isbn: '9789570000000' };

  it('takes chain values for fields not marked manual', () => {
    expect(resolveListingMetadata({ name: 'Chain Name', isbn: '9789571111111' }, listing))
      .toEqual({ name: 'Chain Name', isbn: '9789571111111' });
  });

  it('keeps listing values for fields marked manual', () => {
    expect(resolveListingMetadata(
      { name: 'Chain Name', isbn: '9789571111111' },
      { ...listing, manualMetadataFields: ['isbn'] },
    )).toEqual({ name: 'Chain Name', isbn: '9789570000000' });
  });

  it('keeps listing values when chain has none or a non-string', () => {
    expect(resolveListingMetadata({ name: '', isbn: 123 }, listing)).toEqual(listing);
  });

  it('resolves alternativeHeadline like the other fields', () => {
    expect(resolveListingMetadata(
      { alternativeHeadline: 'Chain Subtitle' },
      { alternativeHeadline: 'Listing Subtitle', manualMetadataFields: ['alternativeHeadline'] },
    )).toEqual({ alternativeHeadline: 'Listing Subtitle' });
    expect(resolveListingMetadata({ alternativeHeadline: 'Chain Subtitle' }, {}))
      .toEqual({ alternativeHeadline: 'Chain Subtitle' });
  });

  it('omits fields neither side has', () => {
    expect(resolveListingMetadata({}, {})).toEqual({});
  });
});

describe('updateListingWithChainMetadata', () => {
  const CLASS_ID = '0xrefresh';

  it('resolves against the listing as stored at write time', async () => {
    await likeNFTBookCollection.doc(CLASS_ID).set({
      classId: CLASS_ID,
      name: 'Fixed Name',
      isbn: '9789570000000',
      manualMetadataFields: ['name'],
    } as any);

    const resolved = await updateListingWithChainMetadata(
      CLASS_ID,
      { name: 'Chain Name', isbn: '9789571111111' },
      { inLanguage: 'zh' },
    );

    expect(resolved).toEqual({ name: 'Fixed Name', isbn: '9789571111111' });
    expect((await likeNFTBookCollection.doc(CLASS_ID).get()).data()).toMatchObject({
      name: 'Fixed Name', isbn: '9789571111111', inLanguage: 'zh',
    });
  });
});

const CLASS_ID = '0x1111111111111111111111111111111111111111';

describe('parseBookMetadataQuery', () => {
  it('joins a value that Slack split on spaces', () => {
    expect(parseBookMetadataQuery([CLASS_ID, 'set', 'alternativeHeadline', 'A', 'Long', 'Subtitle'], '/book'))
      .toEqual({
        classId: CLASS_ID, action: 'set', field: 'alternativeHeadline', value: 'A Long Subtitle',
      });
  });

  it('stores a valid ISBN without hyphens', () => {
    expect(parseBookMetadataQuery([CLASS_ID, 'set', 'isbn', '978-626-653-162-5'], '/book'))
      .toEqual({
        classId: CLASS_ID, action: 'set', field: 'isbn', value: '9786266531625',
      });
  });

  it('lowercases a checksummed class ID', () => {
    expect(parseBookMetadataQuery(['0xAbCdEf0000000000000000000000000000000000', 'reset', 'name'], '/book'))
      .toEqual({ classId: '0xabcdef0000000000000000000000000000000000', action: 'reset', field: 'name' });
  });

  it('parses reset', () => {
    expect(parseBookMetadataQuery([CLASS_ID, 'reset', 'name'], '/book'))
      .toEqual({ classId: CLASS_ID, action: 'reset', field: 'name' });
  });

  it.each([
    ['no params', []],
    ['a missing field', [CLASS_ID, 'set']],
    ['an unknown field', [CLASS_ID, 'set', 'author', 'Someone']],
    ['an unknown action', [CLASS_ID, 'clear', 'name']],
    ['a missing value', [CLASS_ID, 'set', 'name']],
    ['a value on reset', [CLASS_ID, 'reset', 'name', 'Book']],
    ['a bad ISBN check digit', [CLASS_ID, 'set', 'isbn', '9786266531626']],
  ])('rejects %s', (_label, params) => {
    expect(() => parseBookMetadataQuery(params, '/book')).toThrow();
  });
});

describe('setBookManualMetadata', () => {
  async function getStored() {
    return (await likeNFTBookCollection.doc(CLASS_ID).get()).data();
  }

  beforeEach(async () => {
    await likeNFTBookCollection.doc(CLASS_ID).set({
      classId: CLASS_ID,
      name: 'Chain Name',
      isbn: '9780306406157',
    } as any);
  });

  it('writes the value and marks the field manual', async () => {
    const result = await setBookManualMetadata({
      classId: CLASS_ID, action: 'set', field: 'name', value: 'Fixed Name',
    });

    expect(result).toEqual({
      classId: CLASS_ID, className: 'Fixed Name', manualMetadataFields: ['name'],
    });
    expect(await getStored()).toMatchObject({ name: 'Fixed Name', manualMetadataFields: ['name'] });
  });

  it('adds to the fields already marked manual', async () => {
    await setBookManualMetadata({
      classId: CLASS_ID, action: 'set', field: 'name', value: 'Fixed Name',
    });
    await setBookManualMetadata({
      classId: CLASS_ID, action: 'set', field: 'isbn', value: '9786266531625',
    });

    expect(await getStored()).toMatchObject({
      isbn: '9786266531625', manualMetadataFields: ['name', 'isbn'],
    });
  });

  it('unmarks the field on reset and keeps the value until refresh', async () => {
    await setBookManualMetadata({
      classId: CLASS_ID, action: 'set', field: 'isbn', value: '9786266531625',
    });
    const result = await setBookManualMetadata({ classId: CLASS_ID, action: 'reset', field: 'isbn' });

    expect(result.manualMetadataFields).toEqual([]);
    const stored = await getStored();
    expect(stored?.isbn).toBe('9786266531625');
    expect(stored?.manualMetadataFields).toBeUndefined();
  });

  it('throws for an unknown class', async () => {
    await expect(setBookManualMetadata({ classId: '0xmissing', action: 'reset', field: 'name' }))
      .rejects.toThrow('not found');
  });
});
