import {
  beforeEach, describe, expect, it,
} from 'vitest';

import {
  parseBookTippingQuery,
  setBookTippingEnabled,
} from '../../src/util/api/likernft/book/tipping';
import { likeNFTBookCollection } from '../../src/util/firebase';
import { formatBookTippingSlackText } from '../../src/util/slack';

const CLASS_ID = '0xtipping';

async function getStoredPrices() {
  return (await likeNFTBookCollection.doc(CLASS_ID).get()).data()?.prices || [];
}

describe('parseBookTippingQuery', () => {
  it('parses on and off, case-insensitively', () => {
    expect(parseBookTippingQuery([CLASS_ID, 'ON'])).toEqual({
      classId: CLASS_ID,
      isTippingEnabled: true,
      priceIndex: undefined,
    });
    expect(parseBookTippingQuery([CLASS_ID, 'off', '2'])).toEqual({
      classId: CLASS_ID,
      isTippingEnabled: false,
      priceIndex: 2,
    });
  });

  it.each([
    ['no params', []],
    ['a missing toggle', [CLASS_ID]],
    ['an unknown toggle', [CLASS_ID, 'yes']],
    ['a negative priceIndex', [CLASS_ID, 'on', '-1']],
    ['a non-numeric priceIndex', [CLASS_ID, 'on', 'first']],
    ['a fractional priceIndex', [CLASS_ID, 'on', '1.5']],
    ['extra params', [CLASS_ID, 'on', '0', '1']],
  ])('rejects %s', (_label, params) => {
    expect(() => parseBookTippingQuery(params)).toThrow();
  });
});

describe('setBookTippingEnabled', () => {
  beforeEach(async () => {
    await likeNFTBookCollection.doc(CLASS_ID).set({
      classId: CLASS_ID,
      name: 'Tipping Book',
      prices: [
        { name: { zh: '標準版' }, priceInDecimal: 999, isAllowCustomPrice: true },
        {
          name: { zh: '簽名版' },
          priceInDecimal: 1999,
          isAllowCustomPrice: true,
          isTippingEnabled: true,
        },
      ],
    } as any);
  });

  it('sets every edition when no priceIndex is given', async () => {
    const result = await setBookTippingEnabled({ classId: CLASS_ID, isTippingEnabled: true });

    expect(result.className).toBe('Tipping Book');
    expect(result.prices.map((p) => p.isTippingEnabled)).toEqual([true, true]);
    expect((await getStoredPrices()).map((p) => p.isTippingEnabled)).toEqual([true, true]);
  });

  it('sets only the given edition and keeps its other fields', async () => {
    await setBookTippingEnabled({ classId: CLASS_ID, isTippingEnabled: false, priceIndex: 1 });

    const prices = await getStoredPrices();
    expect(prices[0].isTippingEnabled).toBeUndefined();
    expect(prices[1]).toMatchObject({
      priceInDecimal: 1999,
      isAllowCustomPrice: true,
      isTippingEnabled: false,
    });
  });

  it('rejects a priceIndex past the last edition without writing', async () => {
    await expect(setBookTippingEnabled({
      classId: CLASS_ID,
      isTippingEnabled: true,
      priceIndex: 2,
    })).rejects.toThrow('Invalid priceIndex');
    expect((await getStoredPrices())[0].isTippingEnabled).toBeUndefined();
  });

  it('rejects an unknown class', async () => {
    await expect(setBookTippingEnabled({
      classId: '0xmissing',
      isTippingEnabled: true,
    })).rejects.toThrow('not found');
  });
});

describe('formatBookTippingSlackText', () => {
  it('renders a line per edition with both flags', () => {
    const text = formatBookTippingSlackText({
      classId: CLASS_ID,
      className: 'Tipping Book',
      prices: [
        {
          name: { zh: '標準版' }, priceInDecimal: 999, isAllowCustomPrice: true, isTippingEnabled: true,
        },
        {
          name: '簽名版', priceInDecimal: 1999, isTippingEnabled: true,
        },
      ],
    });
    const lines = text.split('\n');
    expect(lines[0]).toContain('Tipping Book');
    expect(lines[1]).toContain(CLASS_ID);
    expect(lines[2]).toContain('#0* 標準版');
    expect(lines[2]).toContain('US$9.99');
    expect(lines[2]).toContain('isAllowCustomPrice: `on`');
    expect(lines[2]).toContain('isTippingEnabled: `on`');
    expect(lines[2]).not.toContain('⚠️');
    expect(lines[3]).toContain('isAllowCustomPrice: `off`');
    expect(lines[3]).toContain('⚠️');
  });

  it('flags a free edition as read as on', () => {
    const text = formatBookTippingSlackText({
      classId: CLASS_ID,
      className: 'Free Book',
      prices: [{
        priceInDecimal: 0, isAllowCustomPrice: true, isTippingEnabled: false,
      }],
    });
    expect(text).toContain('(unnamed)');
    expect(text).toContain('free, read as on');
  });

  it('escapes mrkdwn in author-supplied names', () => {
    const text = formatBookTippingSlackText({
      classId: CLASS_ID,
      className: '<!channel> book',
      prices: [{ name: '<!here>', priceInDecimal: 999 }],
    });
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<!here>');
  });
});
