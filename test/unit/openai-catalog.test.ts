import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import {
  getOpenAIProductCatalogItems,
  getOpenAIFeedItems,
  formatOpenAIFeedCSV,
} from '../../src/util/api/likernft/book/openaiCatalog';
import type { OpenAIFeedItem } from '../../src/util/api/likernft/book/openaiCatalog';
import { listLatestNFTBookInfo } from '../../src/util/api/likernft/book/index';
import type { NFTBookListingInfo } from '../../src/types/book';

// Mock only the data fetch; keep the real pure helpers
// (getLocalizedTextWithFallback) so the mapping logic is exercised end-to-end.
vi.mock('../../src/util/api/likernft/book/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/util/api/likernft/book/index')>();
  return {
    ...actual,
    listLatestNFTBookInfo: vi.fn(),
  };
});

const mockedList = vi.mocked(listLatestNFTBookInfo);

function setBooks(books: Array<Partial<NFTBookListingInfo>>) {
  mockedList.mockResolvedValue(books as any);
}

async function expectProductIds(
  books: Array<Partial<NFTBookListingInfo>>,
  expectedIds: string[],
) {
  setBooks(books);
  const products = await getOpenAIProductCatalogItems();
  expect(products.map((p) => p.id)).toEqual(expectedIds);
}

describe('getOpenAIProductCatalogItems', () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it('fetches Base book listings up to the catalog cap', async () => {
    setBooks([]);
    await getOpenAIProductCatalogItems();
    expect(mockedList).toHaveBeenCalledWith({ chain: 'base', limit: 5000 });
  });

  it('maps a book into a nested Product with one Variant per price', async () => {
    setBooks([{
      id: 'class-a',
      classId: 'class-a',
      name: 'The Great Book',
      image: 'https://img.example/a.jpg',
      isbn: '978-3-16-148410-0', // ISBN-13 with hyphens
      descriptionFull: 'Full description',
      prices: [
        { priceInDecimal: 1500, name: 'Hardcover', stock: 5 },
        { priceInDecimal: 999, stock: 0, isAutoDeliver: false },
      ],
    }]);

    const products = await getOpenAIProductCatalogItems();

    expect(products).toHaveLength(1);
    const [product] = products;
    expect(product.id).toBe('class-a');
    expect(product.title).toBe('The Great Book');
    expect(product.description).toEqual({ plain: 'Full description' });
    expect(product.url).toContain('/store/class-a');
    expect(product.media).toEqual([{ type: 'image', url: 'https://img.example/a.jpg' }]);

    expect(product.variants).toHaveLength(2);
    const [first, second] = product.variants;
    expect(first.id).toBe('class-a-0');
    expect(first.title).toBe('The Great Book - Hardcover');
    // price is ISO 4217 minor units, no string formatting
    expect(first.price).toEqual({ amount: 1500, currency: 'USD' });
    expect(first.availability).toEqual({ available: true, status: 'in_stock' });
    expect(first.condition).toEqual(['new']);
    expect(first.categories).toEqual([{ name: 'Media > Books > E-Books' }]);
    // hyphenated ISBN-13 normalized to a 13-digit GTIN barcode
    expect(first.barcodes).toEqual([{ type: 'gtin', value: '9783161484100' }]);

    // second variant has no name and is out of stock
    expect(second.id).toBe('class-a-1');
    expect(second.title).toBe('The Great Book');
    expect(second.availability).toEqual({ available: false, status: 'out_of_stock' });
  });

  it('falls back description to short description then title, and drops invalid GTINs', async () => {
    setBooks([{
      id: 'class-f',
      classId: 'class-f',
      name: 'Solo Work',
      image: 'https://img.example/f.jpg',
      isbn: '0-306-40615-2', // ISBN-10 → not a valid GTIN length
      description: 'short',
      prices: [{ priceInDecimal: 999, stock: 3 }],
    }]);

    const [product] = await getOpenAIProductCatalogItems();
    expect(product.description).toEqual({ plain: 'short' });
    expect(product.variants[0].barcodes).toBeUndefined();
  });

  it('skips hidden, redirected, adult, and ads-denied books', async () => {
    await expectProductIds([
      {
        id: 'hidden', classId: 'hidden', name: 'Hidden', image: 'https://img/x.jpg', isHidden: true, prices: [{ priceInDecimal: 100 }],
      },
      {
        id: 'redirect', classId: 'redirect', name: 'Redirect', image: 'https://img/x.jpg', redirectClassId: 'other', prices: [{ priceInDecimal: 100 }],
      },
      {
        id: 'adult', classId: 'adult', name: 'Adult', image: 'https://img/x.jpg', isAdultOnly: true, prices: [{ priceInDecimal: 100 }],
      },
      {
        id: 'denied', classId: 'denied', name: 'Denied', image: 'https://img/x.jpg', isApprovedForAds: false, prices: [{ priceInDecimal: 100 }],
      },
    ], []);
  });

  it('includes books where isApprovedForAds is unset (legacy default approved)', async () => {
    await expectProductIds([{
      id: 'legacy', classId: 'legacy', name: 'Legacy', image: 'https://img/l.jpg', prices: [{ priceInDecimal: 100 }],
    }], ['legacy']);
  });

  it('drops unlisted and non-positive variants, and books with no valid variant', async () => {
    await expectProductIds([
      {
        id: 'mixed',
        classId: 'mixed',
        name: 'Mixed Prices',
        image: 'https://img/m.jpg',
        prices: [
          { priceInDecimal: 1000 }, // index 0 → kept
          { priceInDecimal: 0 }, // index 1 → dropped (non-positive)
          { priceInDecimal: 2000, isUnlisted: true }, // index 2 → dropped (unlisted)
        ],
      },
      {
        // all variants invalid → whole product dropped
        id: 'empty', classId: 'empty', name: 'Empty', image: 'https://img/e.jpg', prices: [{ priceInDecimal: 0 }],
      },
      {
        id: 'noimage', classId: 'noimage', name: 'No Image', prices: [{ priceInDecimal: 1000 }], // missing image → dropped
      },
    ], ['mixed']);
    const products = await getOpenAIProductCatalogItems();
    const mixed = products.find((p) => p.id === 'mixed');
    expect(mixed?.variants.map((v) => v.id)).toEqual(['mixed-0']);
  });
});

describe('getOpenAIFeedItems (flat file-upload feed)', () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it('maps each price into a flat row with required search/seller/geo fields', async () => {
    setBooks([{
      id: 'class-a',
      classId: 'class-a',
      name: 'The Great Book',
      image: 'https://img.example/a.jpg',
      author: 'Jane Doe',
      publisher: 'Penguin',
      isbn: '978-3-16-148410-0',
      descriptionFull: 'Full description',
      prices: [
        { priceInDecimal: 1500, name: 'Hardcover', stock: 5 },
        { priceInDecimal: 999, stock: 0, isAutoDeliver: false },
      ],
    }]);

    const items = await getOpenAIFeedItems();
    expect(items).toHaveLength(2);
    const [first] = items;
    expect(first.item_id).toBe('class-a-0');
    expect(first.title).toBe('The Great Book - Hardcover');
    // flat feed uses a "<amount> <currency>" string, not minor units
    expect(first.price).toBe('15.00 USD');
    expect(first.availability).toBe('in_stock');
    // author wins over publisher for brand (shared resolveCatalogBrand)
    expect(first.brand).toBe('Jane Doe');
    expect(first.gtin).toBe('9783161484100');
    expect(first.group_id).toBe('class-a');
    expect(first.listing_has_variations).toBe('true');
    // required-for-search fields are always populated
    expect(first.is_eligible_search).toBe('true');
    expect(first.is_eligible_checkout).toBe('false');
    expect(first.is_digital).toBe('true');
    expect(first.seller_name).toBe('3ook.com');
    expect(first.seller_url).toContain('3ook.com');
    expect(first.return_policy).toBe('https://link.3ook.com/shipping-return-refund');
    expect(first.store_country).toBe('US');
    // target_countries is omitted by default to keep availability global
    expect(first.target_countries).toBeUndefined();

    expect(items[1].availability).toBe('out_of_stock');
  });

  it('marks single-price books as having no variations', async () => {
    setBooks([{
      id: 'solo', classId: 'solo', name: 'Solo', image: 'https://img/s.jpg', prices: [{ priceInDecimal: 500 }],
    }]);
    const [item] = await getOpenAIFeedItems();
    expect(item.listing_has_variations).toBe('false');
  });

  it('applies the same eligibility and variant drop rules as the API model', async () => {
    setBooks([
      {
        id: 'hidden', classId: 'hidden', name: 'Hidden', image: 'https://img/x.jpg', isHidden: true, prices: [{ priceInDecimal: 100 }],
      },
      {
        id: 'noimage', classId: 'noimage', name: 'No Image', prices: [{ priceInDecimal: 100 }],
      },
      {
        id: 'ok', classId: 'ok', name: 'OK', image: 'https://img/o.jpg', prices: [{ priceInDecimal: 100, isUnlisted: true }, { priceInDecimal: 200 }],
      },
    ]);
    const items = await getOpenAIFeedItems();
    expect(items.map((i) => i.item_id)).toEqual(['ok-1']);
  });
});

describe('formatOpenAIFeedCSV', () => {
  const baseItem: OpenAIFeedItem = {
    item_id: 'class-a-0',
    title: 'The Great Book',
    description: 'Full description',
    url: 'https://3ook.com/store/class-a',
    brand: 'Penguin',
    image_url: 'https://img.example/a.jpg',
    price: '15.00 USD',
    availability: 'in_stock',
    condition: 'new',
    product_category: 'Media > Books > E-Books',
    group_id: 'class-a',
    listing_has_variations: 'false',
    is_digital: 'true',
    is_eligible_search: 'true',
    is_eligible_checkout: 'false',
    seller_name: '3ook.com',
    seller_url: 'https://3ook.com',
    return_policy: 'https://link.3ook.com/shipping-return-refund',
    store_country: 'US',
    gtin: '9783161484100',
  };

  it('emits the header in column order', () => {
    const [header] = formatOpenAIFeedCSV([]).split('\n');
    expect(header).toBe(
      'item_id,title,description,url,brand,image_url,price,availability,'
      + 'is_eligible_search,is_eligible_checkout,seller_name,seller_url,return_policy,'
      + 'store_country,target_countries,condition,product_category,group_id,'
      + 'listing_has_variations,is_digital,gtin',
    );
  });

  it('quotes fields with commas and defangs formula injection', () => {
    const csv = formatOpenAIFeedCSV([{
      ...baseItem,
      product_category: 'Media > Books > E-Books',
      title: '=HYPERLINK("http://evil")',
    }]);
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
  });

  it('leaves an absent gtin blank in the trailing column', () => {
    const withoutGtin: OpenAIFeedItem = { ...baseItem };
    delete withoutGtin.gtin;
    const [, row] = formatOpenAIFeedCSV([withoutGtin]).split('\n');
    expect(row.endsWith(',')).toBe(true);
  });
});
