import { getBook3NFTClassPageURL } from '../../../liker-land';
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
// Category mirrors `product:category` in liker-land-v3's use-structured-data.ts.
const META_CATALOG_GOOGLE_PRODUCT_CATEGORY = 'Media > Books > E-Books';
// `fb_product_category` uses Meta's own product taxonomy (distinct from Google's
// taxonomy above) and is a required column in Meta's official catalog CSV
// template. Books map to "Media > Books".
const META_CATALOG_FB_PRODUCT_CATEGORY = 'Media > Books';

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
  custom_label_1?: string;
  custom_label_2?: string;
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
  'custom_label_1',
  'custom_label_2',
];
/* eslint-enable camelcase */

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

  const description = book.descriptionFull || book.description || baseTitle;
  const inStock = isBookPriceInStock(price);
  const { author, publisher, brand } = resolveCatalogBrand(book);

  const item: MetaCatalogItem = {
    id: buildItemId(classId, priceIndex),
    title: getCatalogVariantTitle(baseTitle, price),
    description,
    availability: inStock ? 'in stock' : 'out of stock',
    condition: 'new',
    price: formatCatalogPriceUSD(price),
    link: getBook3NFTClassPageURL({ classId, priceIndex }),
    image_link: image,
    brand,
    item_group_id: classId,
    google_product_category: META_CATALOG_GOOGLE_PRODUCT_CATEGORY,
    fb_product_category: META_CATALOG_FB_PRODUCT_CATEGORY,
  };
  // Mirrors `product:custom_label_0` in liker-land-v3 (owner wallet address).
  if (book.ownerWallet) item.custom_label_0 = book.ownerWallet;
  // Expose author/publisher as their own labels (separate from `brand`) so both
  // stay filterable in Commerce Manager regardless of which won the brand slot.
  if (author) item.custom_label_1 = author;
  if (publisher) item.custom_label_2 = publisher;
  const gtin = normalizeISBNToGTIN(book.isbn);
  if (gtin) item.gtin = gtin;
  return item;
}

export async function getMetaProductCatalogItems(): Promise<MetaCatalogItem[]> {
  const books = await listCatalogEligibleBooks();
  const items: MetaCatalogItem[] = [];
  books.forEach(({ book, classId }) => {
    (book.prices || []).forEach((p, priceIndex) => {
      const item = buildItem(book, classId, p, priceIndex);
      if (item) items.push(item);
    });
  });
  return items;
}

export function formatMetaProductCatalogCSV(items: MetaCatalogItem[]): string {
  return buildCatalogCSV(META_CATALOG_CSV_COLUMNS, items);
}
