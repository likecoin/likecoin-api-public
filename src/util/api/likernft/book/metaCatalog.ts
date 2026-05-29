import { getBook3NFTClassPageURL } from '../../../liker-land';
import { parseImageURLFromMetadata } from '../metadata';
import { buildItemId } from '../../../analyticsEvents';
import {
  getAuthorNameFromMetadata,
  getPublisherNameFromMetadata,
  getLocalizedTextWithFallback,
  listLatestNFTBookInfo,
} from './index';
import type { NFTBookListingInfo, NFTBookPrice } from '../../../../types/book';

const META_CATALOG_LOCALE = 'en';
// Per Meta's catalog spec, `brand` should be the product's real brand, not the
// storefront name. For books the brand convention is the publisher/imprint, so
// prefer publisher, fall back to author (self-published), then `3ook.com` as a
// last resort. Category mirrors `product:category` in liker-land-v3's
// use-structured-data.ts.
const META_CATALOG_FALLBACK_BRAND = '3ook.com';
const META_CATALOG_GOOGLE_PRODUCT_CATEGORY = 'Media > Books > E-Books';
// `fb_product_category` uses Meta's own product taxonomy (distinct from Google's
// taxonomy above) and is a required column in Meta's official catalog CSV
// template. Books map to "Media > Books".
const META_CATALOG_FB_PRODUCT_CATEGORY = 'Media > Books';
// Meta limits a single catalog feed to 200k products; books listings are
// nowhere near that today, but cap defensively to keep the response bounded.
const META_CATALOG_MAX_BOOKS = 5000;

/* eslint-disable camelcase -- Meta product catalog field names must be snake_case per spec */
export interface MetaCatalogItem {
  id: string;
  title: string;
  description: string;
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  price: string;
  link: string;
  image_link: string;
  brand: string;
  item_group_id: string;
  google_product_category: string;
  fb_product_category: string;
  gtin?: string;
  custom_label_0?: string;
}
/* eslint-enable camelcase */

// Column order follows Meta's official catalog CSV template (Commerce Manager →
// Data sources → "Use template"). We emit only the columns we populate; Meta
// treats absent optional columns as empty. `custom_label_0` is a standard Meta
// feed column used for product-set filtering even though it is not pre-printed
// in the downloadable template.
/* eslint-disable camelcase -- Meta product catalog field names must be snake_case per spec */
const META_CATALOG_CSV_COLUMNS: Array<keyof MetaCatalogItem> = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'brand',
  'google_product_category',
  'fb_product_category',
  'item_group_id',
  'gtin',
  'custom_label_0',
];
/* eslint-enable camelcase */

function formatPrice(price: NFTBookPrice): string {
  // priceInDecimal is in USD minor units (cents) — matches the Stripe
  // product created in createStripeProductFromNFTBookPrice.
  return `${(price.priceInDecimal / 100).toFixed(2)} USD`;
}

function buildItem(
  book: NFTBookListingInfo,
  classId: string,
  price: NFTBookPrice,
  priceIndex: number,
): MetaCatalogItem | null {
  if (price.isUnlisted) return null;
  if (!Number.isFinite(price.priceInDecimal) || price.priceInDecimal <= 0) return null;
  const baseTitle = book.name;
  if (!baseTitle) return null;
  const imageSource = book.image || book.thumbnailUrl;
  if (!imageSource) return null;
  const image = parseImageURLFromMetadata(imageSource);

  const priceName = price.name
    ? getLocalizedTextWithFallback(price.name, META_CATALOG_LOCALE)
    : '';
  const title = priceName ? `${baseTitle} - ${priceName}` : baseTitle;
  const description = book.descriptionFull || book.description || baseTitle;
  // `price.stock` is a remaining counter (decremented at sale time in
  // purchase.ts), not a total. Mirrors the canonical sold-out check in
  // cart.ts and ValidationHelper.ts.
  const inStock = price.isAutoDeliver || price.stock === undefined || price.stock > 0;
  const author = getAuthorNameFromMetadata(book.author);
  const publisher = getPublisherNameFromMetadata(book.publisher);
  const brand = publisher || author || META_CATALOG_FALLBACK_BRAND;

  const item: MetaCatalogItem = {
    id: buildItemId(classId, priceIndex),
    title,
    description,
    availability: inStock ? 'in stock' : 'out of stock',
    condition: 'new',
    price: formatPrice(price),
    link: getBook3NFTClassPageURL({ classId, priceIndex }),
    image_link: image,
    brand,
    item_group_id: classId,
    google_product_category: META_CATALOG_GOOGLE_PRODUCT_CATEGORY,
    fb_product_category: META_CATALOG_FB_PRODUCT_CATEGORY,
  };
  // Mirrors `product:custom_label_0` in liker-land-v3 (owner wallet address).
  if (book.ownerWallet) item.custom_label_0 = book.ownerWallet;
  // `book.isbn` holds an ISBN, and only ISBN-13 (13 digits) is a valid GTIN.
  // Normalize to bare digits and drop hyphenated/ISBN-10/malformed values
  // rather than risk Meta feed validation errors.
  if (book.isbn) {
    const gtin = book.isbn.replace(/\D/g, '');
    if (gtin.length === 13) item.gtin = gtin;
  }
  return item;
}

export async function getMetaProductCatalogItems(): Promise<MetaCatalogItem[]> {
  const books = await listLatestNFTBookInfo({
    chain: 'base',
    limit: META_CATALOG_MAX_BOOKS,
  });
  const items: MetaCatalogItem[] = [];
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
    const classId = data.classId || book.id;
    (data.prices || []).forEach((p, priceIndex) => {
      const item = buildItem(data, classId, p, priceIndex);
      if (item) items.push(item);
    });
  });
  return items;
}

// Defang spreadsheet formula injection (CWE-1236): publisher-supplied fields
// (title/description/brand) could start with a formula trigger. Meta ingests
// the value as-is, but an admin opening the downloaded feed in Excel/Sheets
// would otherwise evaluate it. Prefix a single quote per OWASP, before the
// RFC 4180 quoting below so quoted cells are defanged too.
// RFC 4180: wrap a field in double quotes when it contains a comma, quote, or
// line break, and escape embedded quotes by doubling them. Book descriptions
// routinely contain all three, so this keeps columns from shifting.
function escapeCSVField(value: string | undefined): string {
  if (!value) return '';
  const defanged = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defanged) ? `"${defanged.replace(/"/g, '""')}"` : defanged;
}

export function formatMetaProductCatalogCSV(items: MetaCatalogItem[]): string {
  const header = META_CATALOG_CSV_COLUMNS.join(',');
  const rows = items.map((item) => META_CATALOG_CSV_COLUMNS
    .map((col) => escapeCSVField(item[col]))
    .join(','));
  return `${header}\n${rows.join('\n')}`;
}
