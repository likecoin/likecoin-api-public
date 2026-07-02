import xml from 'xml';
import { BOOK3_HOSTNAME } from '../../../../constant';
import { listCatalogVariants } from './catalogSource';
import type { CatalogVariant } from './catalogSource';

// Google Merchant Center product feed
// (https://support.google.com/merchants/answer/7052112). Same lineage as the
// Meta/OpenAI/Stripe feeds, so it reuses the shared catalog source and helpers;
// only the field names, the RSS 2.0 serialization, and the books-specific
// identifier rules differ. Google fetches the hosted feed URL on a schedule.

// Exact Google product taxonomy value for digital books (ID 543542). Note the
// lowercase "b" — this differs from the Meta/Stripe feeds' "E-Books", which use
// their own validators; Google validates against its own taxonomy.
const GOOGLE_MERCHANT_PRODUCT_CATEGORY = 'Media > Books > E-books';
// Google enforces max 150 chars on title and 5000 on description.
const GOOGLE_MERCHANT_TITLE_MAX = 150;
const GOOGLE_MERCHANT_DESCRIPTION_MAX = 5000;

const GOOGLE_MERCHANT_FEED_TITLE = '3ook.com';
const GOOGLE_MERCHANT_FEED_LINK = `https://${BOOK3_HOSTNAME}`;
const GOOGLE_MERCHANT_FEED_DESCRIPTION = 'Books on 3ook.com';

/* eslint-disable camelcase -- Google product feed attribute names are snake_case per spec */
export interface GoogleMerchantItem {
  id: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  price: string;
  availability: 'in_stock' | 'out_of_stock';
  condition: 'new';
  brand: string;
  google_product_category: string;
  gtin?: string;
  // Books have no brand/mpn/gtin fallback, so Google requires identifier_exists
  // to be "no" when there is no valid GTIN (ISBN-13); otherwise the item is rejected.
  identifier_exists?: 'no';
  // Present only for multi-edition books, to group their variants.
  item_group_id?: string;
  item_group_title?: string;
}
/* eslint-enable camelcase */

function truncate(text: string, max: number): string {
  return text.slice(0, max);
}

function buildItem(v: CatalogVariant): GoogleMerchantItem {
  const item: GoogleMerchantItem = {
    id: v.id,
    title: truncate(v.title, GOOGLE_MERCHANT_TITLE_MAX),
    description: truncate(v.description, GOOGLE_MERCHANT_DESCRIPTION_MAX),
    link: v.link,
    image_link: v.image,
    price: v.priceUSD,
    availability: v.inStock ? 'in_stock' : 'out_of_stock',
    condition: 'new',
    brand: v.brand,
    google_product_category: GOOGLE_MERCHANT_PRODUCT_CATEGORY,
  };
  if (v.gtin) {
    item.gtin = v.gtin;
  } else {
    item.identifier_exists = 'no';
  }
  if (v.hasVariations) {
    item.item_group_id = v.classId;
    item.item_group_title = v.baseTitle;
  }
  return item;
}

export async function getGoogleMerchantFeedItems(): Promise<GoogleMerchantItem[]> {
  const variants = await listCatalogVariants();
  return variants.map(buildItem);
}

// RSS 2.0 with Google's `g:` namespace. The core RSS elements (title, link,
// description) carry the product's title/URL/description; every other attribute
// uses the `g:` prefix per Google's spec.
function buildItemNodes(item: GoogleMerchantItem) {
  const nodes: Array<Record<string, string>> = [
    { 'g:id': item.id },
    { title: item.title },
    { description: item.description },
    { link: item.link },
    { 'g:image_link': item.image_link },
    { 'g:price': item.price },
    { 'g:availability': item.availability },
    { 'g:condition': item.condition },
    { 'g:brand': item.brand },
    { 'g:google_product_category': item.google_product_category },
  ];
  // Serialize the identifier and grouping fields buildItem already decided, so
  // the XML and JSON (?format=json) representations can't diverge on Google's rules.
  if (item.gtin) nodes.push({ 'g:gtin': item.gtin });
  if (item.identifier_exists) nodes.push({ 'g:identifier_exists': item.identifier_exists });
  if (item.item_group_id) nodes.push({ 'g:item_group_id': item.item_group_id });
  if (item.item_group_title) nodes.push({ 'g:item_group_title': item.item_group_title });
  return nodes;
}

export function formatGoogleMerchantFeedXML(items: GoogleMerchantItem[]): string {
  const channel: Array<unknown> = [
    { title: GOOGLE_MERCHANT_FEED_TITLE },
    { link: GOOGLE_MERCHANT_FEED_LINK },
    { description: GOOGLE_MERCHANT_FEED_DESCRIPTION },
    ...items.map((item) => ({ item: buildItemNodes(item) })),
  ];
  const feed = {
    rss: [
      { _attr: { version: '2.0', 'xmlns:g': 'http://base.google.com/ns/1.0' } },
      { channel },
    ],
  };
  return xml(feed, { declaration: { encoding: 'utf-8' } });
}
