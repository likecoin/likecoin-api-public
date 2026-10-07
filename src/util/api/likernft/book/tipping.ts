import { db, FieldValue, likeNFTBookCollection } from '../../../firebase';
import type { NFTBookPrice } from '../../../../types/book';

export interface BookTippingQuery {
  classId: string;
  isTippingEnabled: boolean;
  priceIndex?: number;
}

export interface BookTippingResult {
  classId: string;
  className: string;
  prices: Pick<NFTBookPrice, 'name' | 'priceInDecimal' | 'isAllowCustomPrice' | 'isTippingEnabled'>[];
}

export const BOOK_TIPPING_USAGE = '/book tipping <classId> <on|off> [priceIndex]';

export function parseBookTippingQuery(params: string[]): BookTippingQuery {
  const [classId, toggle, priceIndexText, ...rest] = params;
  if (!classId || !toggle || rest.length) {
    throw new Error(`Invalid params. Usage: ${BOOK_TIPPING_USAGE}`);
  }
  const normalizedToggle = toggle.toLowerCase();
  if (normalizedToggle !== 'on' && normalizedToggle !== 'off') {
    throw new Error(`Invalid toggle: ${toggle}. Must be on or off`);
  }
  if (priceIndexText !== undefined && !/^\d+$/.test(priceIndexText)) {
    throw new Error(`Invalid priceIndex: ${priceIndexText}. Must be a non-negative integer`);
  }
  return {
    classId,
    isTippingEnabled: normalizedToggle === 'on',
    priceIndex: priceIndexText === undefined ? undefined : Number(priceIndexText),
  };
}

// Most books have only one edition, so priceIndex is optional.
export async function setBookTippingEnabled({
  classId,
  isTippingEnabled,
  priceIndex,
}: BookTippingQuery): Promise<BookTippingResult> {
  const bookRef = likeNFTBookCollection.doc(classId);
  return db.runTransaction(async (t) => {
    const bookData = (await t.get(bookRef)).data();
    if (!bookData) {
      throw new Error(`Book class ${classId} not found`);
    }
    const { prices = [] } = bookData;
    if (!prices.length) {
      throw new Error(`Book class ${classId} has no editions`);
    }
    if (priceIndex !== undefined && !prices[priceIndex]) {
      throw new Error(`Invalid priceIndex: ${priceIndex}. Book has ${prices.length} edition(s), 0 to ${prices.length - 1}`);
    }
    const updatedPrices = prices.map((price, index) => (
      priceIndex === undefined || index === priceIndex
        ? { ...price, isTippingEnabled }
        : price
    ));
    t.update(bookRef, {
      prices: updatedPrices,
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    });
    return {
      classId,
      className: bookData.name || classId,
      prices: updatedPrices,
    };
  });
}
