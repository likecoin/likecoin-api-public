import { getBook3NFTClassPageURL } from '../../../liker-land';
import { parseImageURLFromMetadata } from '../metadata';
import { buildItemId } from '../../../analyticsEvents';
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
// then 3ook.com. This must stay in sync with the storefront landing page brand
// (liker-land-v3 use-book-info.ts `brandName`), since Google Merchant Center
// compares the feed `brand` against the crawled page. Returns author/publisher
// too so feeds can also expose them as their own labels.
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
      || data.isPendingReview
      || data.redirectClassId
      || data.isAdultOnly
      || data.isApprovedForAds === false
    ) return;
    result.push({ book: data, classId: data.classId || book.id });
  });
  return result;
}

// A single sellable variant, normalized once so the flat feeds (Meta, OpenAI,
// Stripe) are pure schema mappers and share one definition of which variants
// are valid (listed, positively priced, on a book with a name and image).
export interface CatalogVariant {
  book: NFTBookListingInfo;
  classId: string;
  priceIndex: number;
  price: NFTBookPrice;
  id: string;
  title: string;
  baseTitle: string;
  description: string;
  link: string;
  image: string;
  brand: string;
  author: string;
  publisher: string;
  inStock: boolean;
  priceUSD: string;
  hasVariations: boolean;
  gtin?: string;
}

export async function listCatalogVariants(): Promise<CatalogVariant[]> {
  const books = await listCatalogEligibleBooks();
  const variants: CatalogVariant[] = [];
  books.forEach(({ book, classId }) => {
    const baseTitle = book.name;
    if (!baseTitle) return;
    const imageSource = book.image || book.thumbnailUrl;
    if (!imageSource) return;
    const image = parseImageURLFromMetadata(imageSource);
    const { author, publisher, brand } = resolveCatalogBrand(book);
    const description = book.descriptionFull || book.description || baseTitle;
    const gtin = normalizeISBNToGTIN(book.isbn);
    // Keep the original priceIndex (used for ids/URLs) while filtering to the
    // sellable prices, so hasVariations reflects emitted variants, not raw count.
    const eligiblePrices = (book.prices || [])
      .map((price, priceIndex) => ({ price, priceIndex }))
      .filter(({ price }) => !price.isUnlisted
        && Number.isFinite(price.priceInDecimal)
        && price.priceInDecimal > 0);
    const hasVariations = eligiblePrices.length > 1;
    eligiblePrices.forEach(({ price, priceIndex }) => {
      variants.push({
        book,
        classId,
        priceIndex,
        price,
        id: buildItemId(classId, priceIndex),
        title: getCatalogVariantTitle(baseTitle, price),
        baseTitle,
        description,
        link: getBook3NFTClassPageURL({ classId, priceIndex }),
        image,
        brand,
        author,
        publisher,
        inStock: isBookPriceInStock(price),
        priceUSD: formatCatalogPriceUSD(price),
        hasVariations,
        gtin,
      });
    });
  });
  return variants;
}
