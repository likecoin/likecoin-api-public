import { ProductServiceClient } from '@google-cloud/retail';

import { LIKER_LAND_HOSTNAME, NFT_BOOK_TEXT_DEFAULT_LOCALE } from '../constant';
import { parseImageURLFromMetadata } from './api/likernft/metadata';
import { GOOGLE_RETAIL_PROJECT_ID } from '../../config/config';

const retailClient = new ProductServiceClient();

function getLocalizedTextWithFallback(field, locale) {
  return field[locale] || field[NFT_BOOK_TEXT_DEFAULT_LOCALE] || '';
}

function getCategoryFromName(name) {
  if (['大嶼小報', '角醒', '馬聞'].some((keyword) => name.includes(keyword))) {
    return 'eBook > Newspaper';
  }
  if (['Sportsoho', '山林印記', 'Breakazine', '雜誌'].some((keyword) => name.includes(keyword))) {
    return 'eBook > Magazine';
  }
  return 'eBook';
}

function formatCollectionData(data) {
  const {
    id,
    name,
    description,
    typePayload,
    image,
    timestamp,
  } = data;
  return [{
    id,
    type: 'PRIMARY',
    categories: ['eBook Collection'],
    title: getLocalizedTextWithFallback(name, 'zh'),
    description: getLocalizedTextWithFallback(description, 'zh'),
    priceInfo: {
      currencyCode: 'USD',
      price: typePayload.priceInDecimal / 100,
    },
    uri: `https://${LIKER_LAND_HOSTNAME}/nft/collection/${id}`,
    images: image ? [{
      uri: parseImageURLFromMetadata(image),
    }] : undefined,
    publishTime: new Date(timestamp).toISOString(),
  }];
}

function formatBookData(data) {
  const {
    id,
    prices,
    inLanguage,
    name,
    description,
    keywords,
    thumbnailUrl,
    author,
    isbn,
    image,
    timestamp,
  } = data;
  return prices.map((price) => ({
    id: `${id}-${price.index}`,
    type: 'PRIMARY',
    gtin: isbn,
    categories: getCategoryFromName(name),
    title: `${name} - ${getLocalizedTextWithFallback(price.name, 'zh')}`,
    description: [getLocalizedTextWithFallback(price.description, 'zh'), description].filter(Boolean).join('\n'),
    languageCode: inLanguage,
    attributes: author ? {
      author: {
        text: author,
      },
    } : undefined,
    tags: keywords,
    priceInfo: {
      currencyCode: 'USD',
      price: price.price,
    },
    uri: `https://${LIKER_LAND_HOSTNAME}/nft/class/${id}?price_index=${price.index}`,
    images: (image || thumbnailUrl) ? [{
      uri: image || parseImageURLFromMetadata(thumbnailUrl),
    }] : undefined,
    // conditions
    publishTime: new Date(timestamp).toISOString(),
  }));
}

async function importProductToRetailCatalog(products) {
  if (!GOOGLE_RETAIL_PROJECT_ID) {
    // eslint-disable-next-line no-console
    console.warn('GOOGLE_RETAIL_PROJECT_ID is not set');
    return;
  }
  // Construct request
  const parent = `projects/${GOOGLE_RETAIL_PROJECT_ID}/locations/global/catalogs/default_catalog/branches/0`;
  const request = {
    parent,
    inputConfig: {
      productInlineSource: {
        products,
      },
    },
  };
  await retailClient.importProducts(request);
}

export async function importProductFromBookListing(bookData) {
  const products = formatBookData(bookData);
  await importProductToRetailCatalog(products);
}

export async function importProductFromCollection(collectionData) {
  const products = formatCollectionData(collectionData);
  await importProductToRetailCatalog(products);
}
