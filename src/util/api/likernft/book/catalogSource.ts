import {
  listLatestNFTBookInfo,
  getLocalizedTextWithFallback,
  getAuthorNameFromMetadata,
  getPublisherNameFromMetadata,
} from './index';
import type { NFTBookListingInfo, NFTBookPrice } from '../../../../types/book';

// Shared building blocks for product-catalog feeds (Meta, OpenAI). Each feed
// maps the same eligible books into its own schema, so keeping the fetch,
// filter, and per-variant helpers here stops the eligibility, stock, GTIN,
// price and brand rules from drifting apart between feeds.
const CATALOG_LOCALE = 'en';
const CATALOG_FALLBACK_BRAND = '3ook.com';

// Per the catalog specs, `brand` should be the product's real brand, not the
// storefront name. On an independent-author storefront the author is the
// strongest brand signal, so prefer author, fall back to publisher/imprint,
// then 3ook.com. Returns author/publisher too so feeds can also expose them
// as their own labels.
export function resolveCatalogBrand(book: NFTBookListingInfo): {
  author: string;
  publisher: string;
  brand: string;
} {
  const author = getAuthorNameFromMetadata(book.author);
  const publisher = getPublisherNameFromMetadata(book.publisher);
  return { author, publisher, brand: author || publisher || CATALOG_FALLBACK_BRAND };
}

// `price.stock` is a remaining counter (decremented at sale time in
// purchase.ts), not a total. Mirrors the sold-out check in cart.ts and
// ValidationHelper.ts (which express it as the inverse, isOutOfStock).
export function isBookPriceInStock(price: NFTBookPrice): boolean {
  return price.isAutoDeliver || price.stock === undefined || price.stock > 0;
}

export function getCatalogVariantTitle(baseTitle: string, price: NFTBookPrice): string {
  const priceName = price.name
    ? getLocalizedTextWithFallback(price.name, CATALOG_LOCALE)
    : '';
  return priceName ? `${baseTitle} - ${priceName}` : baseTitle;
}

// priceInDecimal is USD minor units (cents); feeds that want a display string
// use "<amount> USD" (the API model uses the raw integer instead).
export function formatCatalogPriceUSD(price: NFTBookPrice): string {
  return `${(price.priceInDecimal / 100).toFixed(2)} USD`;
}

// `book.isbn` holds an ISBN; only ISBN-13 (13 digits) is a valid GTIN. Strip
// hyphens and drop ISBN-10/malformed values rather than risk feed rejection.
export function normalizeISBNToGTIN(isbn?: string): string | undefined {
  if (!isbn) return undefined;
  const gtin = isbn.replace(/\D/g, '');
  return gtin.length === 13 ? gtin : undefined;
}

// Meta limits a single catalog feed to 200k products and OpenAI similarly
// bounds feed size; books listings are nowhere near that today, but cap
// defensively to keep the response bounded.
export const CATALOG_MAX_BOOKS = 5000;

export interface CatalogBook {
  book: NFTBookListingInfo;
  classId: string;
}

export async function listCatalogEligibleBooks(): Promise<CatalogBook[]> {
  const books = await listLatestNFTBookInfo({
    chain: 'base',
    limit: CATALOG_MAX_BOOKS,
  });
  const result: CatalogBook[] = [];
  books.forEach((book) => {
    const data = book as NFTBookListingInfo;
    // `isApprovedForAds === false` is an explicit admin denial; `undefined` means legacy/unset
    // and defaults to approved (see ValidationHelper.ts), so we filter only on the explicit false.
    if (
      data.isHidden
      || data.redirectClassId
      || data.isAdultOnly
      || data.isApprovedForAds === false
    ) return;
    result.push({ book: data, classId: data.classId || book.id });
  });
  return result;
}
