import { listCatalogVariants } from './catalogSource';
import type { CatalogVariant } from './catalogSource';
import { buildCatalogCSV } from './catalogCSV';

// Stripe Agentic Commerce product feed
// (https://docs.stripe.com/agentic-commerce/product-feed): a flat CSV in the
// Google-Shopping field dialect (id/link/image_link/item_group_id), uploaded via
// POST /v2/commerce/product_catalog/imports. Same lineage as the Meta feed, so
// it reuses the shared catalog source and helpers; only field names and the
// digital-goods/checkout flags differ. This module only builds the payload;
// uploading it to Stripe is a separate integration.
const STRIPE_FEED_CATEGORY = 'Media > Books > E-Books';
// Books are digital downloads: inventory isn't tracked and there is no shipping,
// so `availability` alone conveys sold-out state.
const STRIPE_FEED_INVENTORY_NOT_TRACKED = 'true';
// Discovery-only until the seller is enabled for agentic checkout: `true` makes
// agents link out to the product page instead of checking out in-agent. Flip to
// 'false' once ACP checkout is approved.
const STRIPE_FEED_DISABLE_CHECKOUT = 'true';
// Set to a Stripe digital-goods product tax code (e.g. 'txcd_10503000') if the
// account uses Stripe Tax; left blank otherwise (column present, value empty).
const STRIPE_FEED_TAX_CODE = '';

/* eslint-disable camelcase -- Stripe product feed column names are snake_case per spec */
export interface StripeFeedItem {
  id: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  price: string;
  availability: 'in_stock' | 'out_of_stock';
  inventory_not_tracked: string;
  condition: string;
  brand: string;
  google_product_category: string;
  item_group_id: string;
  item_group_title: string;
  disable_checkout: string;
  gtin?: string;
  stripe_product_tax_code?: string;
}

const STRIPE_FEED_CSV_COLUMNS: Array<keyof StripeFeedItem> = [
  'id',
  'title',
  'description',
  'link',
  'image_link',
  'price',
  'availability',
  'inventory_not_tracked',
  'condition',
  'brand',
  'gtin',
  'google_product_category',
  'item_group_id',
  'item_group_title',
  'disable_checkout',
  'stripe_product_tax_code',
];
/* eslint-enable camelcase */

function buildFeedItem(v: CatalogVariant): StripeFeedItem {
  const item: StripeFeedItem = {
    id: v.id,
    title: v.title,
    description: v.description,
    link: v.link,
    image_link: v.image,
    price: v.priceUSD,
    availability: v.inStock ? 'in_stock' : 'out_of_stock',
    inventory_not_tracked: STRIPE_FEED_INVENTORY_NOT_TRACKED,
    condition: 'new',
    brand: v.brand,
    google_product_category: STRIPE_FEED_CATEGORY,
    item_group_id: v.classId,
    item_group_title: v.baseTitle,
    disable_checkout: STRIPE_FEED_DISABLE_CHECKOUT,
  };
  if (v.gtin) item.gtin = v.gtin;
  if (STRIPE_FEED_TAX_CODE) item.stripe_product_tax_code = STRIPE_FEED_TAX_CODE;
  return item;
}

export async function getStripeFeedItems(): Promise<StripeFeedItem[]> {
  const variants = await listCatalogVariants();
  return variants.map(buildFeedItem);
}

export function formatStripeFeedCSV(items: StripeFeedItem[]): string {
  return buildCatalogCSV(STRIPE_FEED_CSV_COLUMNS, items);
}
