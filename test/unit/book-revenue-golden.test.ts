// Rules mirrored client-side in publish-3ook-com/app/utils/book-revenue.ts. On failure,
// regenerate the fixture, copy it to publish-3ook-com/test/fixtures/, and update the mirror.
// Editing the fixture alone is what defeats the check.
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { calculateStripeFee } from '../../src/util/stripe';
import { calculateItemPrices } from '../../src/util/api/likernft/book/price';
import { calculateItemFeeInfo } from '../../src/util/api/likernft/book/payment';
import type { CartItemWithInfo } from '../../src/util/api/likernft/book/type';
import {
  NFT_BOOK_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO,
  NFT_BOOK_LIKER_LAND_COMMISSION_RATIO,
  NFT_BOOK_LIKER_LAND_ART_FEE_RATIO,
} from '../../config/config';

// Bump alongside the fixture's `version` when the rules change, so a stale copy
// on either side fails loudly instead of drifting.
const EXPECTED_FIXTURE_VERSION = 1;

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../data/book-revenue.golden.json'),
  'utf-8',
));

// Cart plumbing the fee rules never read, supplied so the item typechecks.
const baseItem = {
  stock: 1,
  isAllowCustomPrice: false,
  name: '',
  description: '',
  images: [] as string[],
  ownerWallet: '',
  chain: 'evm' as const,
};

type FixtureItem = Pick<CartItemWithInfo,
  'quantity' | 'priceInDecimal' | 'originalPriceInDecimal' | 'customPriceDiffInDecimal' | 'isLikerLandArt'>;

const makeItem = (item: FixtureItem): CartItemWithInfo => ({ ...baseItem, ...item });

function feeInfoFor(item: FixtureItem, from: string, currency: string) {
  const [itemPrice] = calculateItemPrices([makeItem(item)], from);
  const totalPriceInDecimal = item.priceInDecimal * item.quantity;
  return calculateItemFeeInfo(itemPrice, {
    totalStripeFeeAmount: calculateStripeFee(totalPriceInDecimal, currency),
    totalPriceInDecimal,
  });
}

// What the wizard's estimateAuthorRevenue() composes, once per channel.
function authorRevenueFor(priceInDecimal: number, currency: string) {
  const forChannel = (from: string) => {
    const { royaltyToSplit } = feeInfoFor({
      quantity: 1,
      priceInDecimal,
      originalPriceInDecimal: priceInDecimal,
      customPriceDiffInDecimal: 0,
      isLikerLandArt: false,
    }, from, currency);
    return {
      royaltyInDecimal: royaltyToSplit,
      ratio: priceInDecimal > 0 ? royaltyToSplit / priceInDecimal : 0,
    };
  };
  return { direct: forChannel(''), likerLand: forChannel('liker_land') };
}

describe('book revenue golden fixture', () => {
  it('matches the version this test was written against', () => {
    expect(fixture.version).toBe(EXPECTED_FIXTURE_VERSION);
  });

  it('matches the fee ratios in config', () => {
    expect(fixture.constants.likerLandFeeRatio).toBe(NFT_BOOK_LIKER_LAND_FEE_RATIO);
    expect(fixture.constants.tipFeeRatio).toBe(NFT_BOOK_TIP_LIKER_LAND_FEE_RATIO);
    expect(fixture.constants.commissionRatio).toBe(NFT_BOOK_LIKER_LAND_COMMISSION_RATIO);
    expect(fixture.constants.artFeeRatio).toBe(NFT_BOOK_LIKER_LAND_ART_FEE_RATIO);
  });

  // The Stripe rates are inline literals in calculateStripeFee, so pin the fixture's
  // copies to the real formula rather than restating them as literals here.
  it('reproduces calculateStripeFee from the fixture constants', () => {
    const {
      stripePercentageFee, stripeInternationalFee, stripeFxFee, stripeFlatFee,
    } = fixture.constants;
    const rateFor = (currency: string) => stripePercentageFee + stripeInternationalFee
      + (currency === 'usd' ? 0 : stripeFxFee);
    const fromConstants = (amount: number, currency: string) => (
      amount === 0 ? 0 : Math.ceil(amount * rateFor(currency) + stripeFlatFee)
    );
    [0, 1, 99, 333, 500, 1000, 5000, 99900].forEach((amount) => {
      ['usd', 'hkd'].forEach((currency) => {
        expect(fromConstants(amount, currency)).toBe(calculateStripeFee(amount, currency));
      });
    });
  });

  describe('calculateStripeFee', () => {
    fixture.stripeFee.forEach(({
      name, inputAmount, currency, expected,
    }) => {
      it(name, () => {
        expect(calculateStripeFee(inputAmount, currency)).toBe(expected);
      });
    });
  });

  describe('calculateItemPrices', () => {
    fixture.itemPrices.forEach(({
      name, item, from, expected,
    }) => {
      it(name, () => {
        expect(calculateItemPrices([makeItem(item)], from)[0]).toEqual(expected);
      });
    });
  });

  describe('calculateItemFeeInfo', () => {
    fixture.feeInfo.forEach(({
      name, item, from, currency, expected,
    }) => {
      it(name, () => {
        expect(feeInfoFor(item, from, currency)).toEqual(expected);
      });
    });
  });

  describe('author revenue by channel', () => {
    fixture.authorRevenue.forEach(({
      name, priceInDecimal, currency, expected,
    }) => {
      it(name, () => {
        const actual = authorRevenueFor(priceInDecimal, currency);
        expect(actual.direct.royaltyInDecimal).toBe(expected.direct.royaltyInDecimal);
        expect(actual.likerLand.royaltyInDecimal).toBe(expected.likerLand.royaltyInDecimal);
        // Ratios are derived, so compare with a tolerance: a harmless
        // reordering of the division must not fail the check.
        expect(actual.direct.ratio).toBeCloseTo(expected.direct.ratio, 12);
        expect(actual.likerLand.ratio).toBeCloseTo(expected.likerLand.ratio, 12);
      });
    });
  });
});
