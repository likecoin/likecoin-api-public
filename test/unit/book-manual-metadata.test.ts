import { describe, expect, it } from 'vitest';

import {
  resolveListingMetadata,
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
