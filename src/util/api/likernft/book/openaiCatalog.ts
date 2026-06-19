import { getBook3NFTClassPageURL, getBook3URL } from '../../../liker-land';
import { parseImageURLFromMetadata } from '../metadata';
import { buildItemId } from '../../../analyticsEvents';
import {
  listCatalogEligibleBooks,
  isBookPriceInStock,
  getCatalogVariantTitle,
  formatCatalogPriceUSD,
  normalizeISBNToGTIN,
  resolveCatalogBrand,
} from './catalogSource';
import { buildCatalogCSV } from './catalogCSV';
import type { NFTBookListingInfo, NFTBookPrice } from '../../../../types/book';

// Search-only feed shaped for OpenAI's commerce *API* product schema
// (https://developers.openai.com/commerce/specs/api/products): a nested
// Product → Variant model, distinct from the flat Meta catalog. This module
// only builds the payload; pushing it to OpenAI (POST /product_feeds + upsert)
// is a separate integration. Checkout fields (seller, returns, policies) are
// intentionally omitted — this feed is discovery-only.
//
// OpenAI's Category inner shape is not fully pinned down in the public spec;
// `{ name }` with a `>`-separated path mirrors the file-upload taxonomy and is
// the best-effort representation pending validation against the real ingester.
const OPENAI_CATALOG_CATEGORY = 'Media > Books > E-Books';

/* eslint-disable camelcase -- OpenAI product API field names are snake_case per spec */
export interface OpenAIDescription {
  plain: string;
}

export interface OpenAIMedia {
  type: 'image';
  url: string;
}

export interface OpenAIPrice {
  // ISO 4217 minor units (cents) — matches NFTBookPrice.priceInDecimal directly,
  // so unlike the Meta feed no "$X.XX USD" string formatting is needed.
  amount: number;
  currency: string;
}

export interface OpenAIAvailability {
  available: boolean;
  status: 'in_stock' | 'out_of_stock';
}

export interface OpenAIBarcode {
  type: string;
  value: string;
}

export interface OpenAICategory {
  name: string;
}

export interface OpenAIVariant {
  id: string;
  title: string;
  url: string;
  price: OpenAIPrice;
  availability: OpenAIAvailability;
  condition: string[];
  categories: OpenAICategory[];
  media: OpenAIMedia[];
  barcodes?: OpenAIBarcode[];
}

export interface OpenAIProduct {
  id: string;
  title: string;
  description: OpenAIDescription;
  url: string;
  media: OpenAIMedia[];
  variants: OpenAIVariant[];
}
/* eslint-enable camelcase */

function buildVariant(
  book: NFTBookListingInfo,
  baseTitle: string,
  classId: string,
  price: NFTBookPrice,
  priceIndex: number,
  image: string,
): OpenAIVariant | null {
  if (price.isUnlisted) return null;
  if (!Number.isFinite(price.priceInDecimal) || price.priceInDecimal <= 0) return null;

  const inStock = isBookPriceInStock(price);
  const variant: OpenAIVariant = {
    id: buildItemId(classId, priceIndex),
    title: getCatalogVariantTitle(baseTitle, price),
    url: getBook3NFTClassPageURL({ classId, priceIndex }),
    price: {
      amount: price.priceInDecimal,
      currency: 'USD',
    },
    availability: {
      available: inStock,
      status: inStock ? 'in_stock' : 'out_of_stock',
    },
    condition: ['new'],
    categories: [{ name: OPENAI_CATALOG_CATEGORY }],
    media: [{ type: 'image', url: image }],
  };
  const gtin = normalizeISBNToGTIN(book.isbn);
  if (gtin) variant.barcodes = [{ type: 'gtin', value: gtin }];
  return variant;
}

function buildProduct(
  book: NFTBookListingInfo,
  classId: string,
): OpenAIProduct | null {
  const baseTitle = book.name;
  if (!baseTitle) return null;
  const imageSource = book.image || book.thumbnailUrl;
  if (!imageSource) return null;
  const image = parseImageURLFromMetadata(imageSource);

  const variants = (book.prices || [])
    .map((p, priceIndex) => buildVariant(book, baseTitle, classId, p, priceIndex, image))
    .filter((v): v is OpenAIVariant => v !== null);
  if (!variants.length) return null;

  return {
    id: classId,
    title: baseTitle,
    description: { plain: book.descriptionFull || book.description || baseTitle },
    url: getBook3NFTClassPageURL({ classId }),
    media: [{ type: 'image', url: image }],
    variants,
  };
}

export async function getOpenAIProductCatalogItems(): Promise<OpenAIProduct[]> {
  const books = await listCatalogEligibleBooks();
  const products: OpenAIProduct[] = [];
  books.forEach(({ book, classId }) => {
    const product = buildProduct(book, classId);
    if (product) products.push(product);
  });
  return products;
}

// ---------------------------------------------------------------------------
// File-upload feed (flat schema)
// ---------------------------------------------------------------------------
// OpenAI's other ingestion path is a flat product feed file
// (https://developers.openai.com/commerce/specs/file-upload/products), shaped
// like the Meta catalog: one row per variant, snake_case columns, CSV or JSON.
// Unlike the API model, this feed marks brand, seller_*, return_policy and geo
// as Required even for a search-only listing, so they are always populated.
const OPENAI_FEED_CATEGORY = 'Media > Books > E-Books';
const OPENAI_FEED_SELLER_NAME = '3ook.com';
const OPENAI_FEED_SELLER_URL = getBook3URL('');
// `return_policy` is a Required URL even for search-only — the published
// shipping/return/refund policy linked from the store footer.
const OPENAI_FEED_RETURN_POLICY_URL = 'https://link.3ook.com/shipping-return-refund';
// `store_country` is the seller-of-record's country (the operating entity, not
// the HK team). Default 'US' matches the feed's USD pricing; switch to 'TW' if
// the Stripe merchant of record for these books is the TW entity instead.
const OPENAI_FEED_STORE_COUNTRY = 'US';
// `target_countries` is Required per the file-upload spec, but it is
// first-entry-used: pinning a country would narrow targeting to that market,
// which contradicts selling these digital ebooks worldwide. So we leave it
// empty (blank in CSV / omitted in JSON) to keep availability global. If OpenAI's ingester
// rejects rows without it, set a value here (e.g. 'TW,HK,US') to populate it.
const OPENAI_FEED_TARGET_COUNTRIES = '';

/* eslint-disable camelcase -- OpenAI file-upload feed field names are snake_case per spec */
export interface OpenAIFeedItem {
  item_id: string;
  title: string;
  description: string;
  url: string;
  brand: string;
  image_url: string;
  price: string;
  availability: 'in_stock' | 'out_of_stock';
  condition: string;
  product_category: string;
  group_id: string;
  listing_has_variations: string;
  is_digital: string;
  is_eligible_search: string;
  is_eligible_checkout: string;
  seller_name: string;
  seller_url: string;
  return_policy: string;
  store_country: string;
  target_countries?: string;
  gtin?: string;
}

// Required columns first, then the optional/recommended ones. Boolean and list
// fields are emitted as strings so the same item serializes to CSV or JSON.
const OPENAI_FEED_CSV_COLUMNS: Array<keyof OpenAIFeedItem> = [
  'item_id',
  'title',
  'description',
  'url',
  'brand',
  'image_url',
  'price',
  'availability',
  'is_eligible_search',
  'is_eligible_checkout',
  'seller_name',
  'seller_url',
  'return_policy',
  'store_country',
  'target_countries',
  'condition',
  'product_category',
  'group_id',
  'listing_has_variations',
  'is_digital',
  'gtin',
];
/* eslint-enable camelcase */

function buildFeedItem(
  book: NFTBookListingInfo,
  baseTitle: string,
  description: string,
  brand: string,
  image: string,
  classId: string,
  hasVariations: boolean,
  price: NFTBookPrice,
  priceIndex: number,
): OpenAIFeedItem | null {
  if (price.isUnlisted) return null;
  if (!Number.isFinite(price.priceInDecimal) || price.priceInDecimal <= 0) return null;

  const inStock = isBookPriceInStock(price);
  const item: OpenAIFeedItem = {
    item_id: buildItemId(classId, priceIndex),
    title: getCatalogVariantTitle(baseTitle, price),
    description,
    url: getBook3NFTClassPageURL({ classId, priceIndex }),
    brand,
    image_url: image,
    price: formatCatalogPriceUSD(price),
    availability: inStock ? 'in_stock' : 'out_of_stock',
    condition: 'new',
    product_category: OPENAI_FEED_CATEGORY,
    group_id: classId,
    listing_has_variations: hasVariations ? 'true' : 'false',
    is_digital: 'true',
    is_eligible_search: 'true',
    is_eligible_checkout: 'false',
    seller_name: OPENAI_FEED_SELLER_NAME,
    seller_url: OPENAI_FEED_SELLER_URL,
    return_policy: OPENAI_FEED_RETURN_POLICY_URL,
    store_country: OPENAI_FEED_STORE_COUNTRY,
  };
  // Omitted by default to keep availability global (see constant above).
  if (OPENAI_FEED_TARGET_COUNTRIES) item.target_countries = OPENAI_FEED_TARGET_COUNTRIES;
  const gtin = normalizeISBNToGTIN(book.isbn);
  if (gtin) item.gtin = gtin;
  return item;
}

export async function getOpenAIFeedItems(): Promise<OpenAIFeedItem[]> {
  const books = await listCatalogEligibleBooks();
  const items: OpenAIFeedItem[] = [];
  books.forEach(({ book, classId }) => {
    const baseTitle = book.name;
    if (!baseTitle) return;
    const imageSource = book.image || book.thumbnailUrl;
    if (!imageSource) return;
    const image = parseImageURLFromMetadata(imageSource);
    const { brand } = resolveCatalogBrand(book);
    const description = book.descriptionFull || book.description || baseTitle;
    const prices = book.prices || [];
    const hasVariations = prices.length > 1;
    prices.forEach((p, priceIndex) => {
      const item = buildFeedItem(
        book,
        baseTitle,
        description,
        brand,
        image,
        classId,
        hasVariations,
        p,
        priceIndex,
      );
      if (item) items.push(item);
    });
  });
  return items;
}

export function formatOpenAIFeedCSV(items: OpenAIFeedItem[]): string {
  return buildCatalogCSV(OPENAI_FEED_CSV_COLUMNS, items);
}
