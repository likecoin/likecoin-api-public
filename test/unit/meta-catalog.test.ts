import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { getMetaProductCatalogItems, formatMetaProductCatalogCSV } from '../../src/util/api/likernft/book/metaCatalog';
import type { MetaCatalogItem } from '../../src/util/api/likernft/book/metaCatalog';
import { listLatestNFTBookInfo } from '../../src/util/api/likernft/book/index';
import type { NFTBookListingInfo } from '../../src/types/book';

// Mock only the data fetch; keep the real pure helpers
// (getAuthorNameFromMetadata, getLocalizedTextWithFallback) so the mapping
// logic is exercised end-to-end.
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

async function expectCatalogItemIds(
  books: Array<Partial<NFTBookListingInfo>>,
  expectedIds: string[],
) {
  setBooks(books);
  const items = await getMetaProductCatalogItems();
  expect(items.map((i) => i.id)).toEqual(expectedIds);
}

describe('getMetaProductCatalogItems', () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it('fetches Base book listings up to the catalog cap', async () => {
    setBooks([]);
    await getMetaProductCatalogItems();
    expect(mockedList).toHaveBeenCalledWith({ chain: 'base', limit: 5000 });
  });

  it('maps a listed price into a Meta catalog item with normalized fields', async () => {
    setBooks([{
      id: 'class-a',
      classId: 'class-a',
      name: 'The Great Book',
      image: 'https://img.example/a.jpg',
      author: 'Jane Doe',
      publisher: 'Penguin',
      isbn: '978-3-16-148410-0', // ISBN-13 with hyphens
      ownerWallet: '0xabc',
      descriptionFull: 'Full description',
      prices: [{ priceInDecimal: 1500, name: 'Hardcover', stock: 5 }],
    }]);

    const items = await getMetaProductCatalogItems();

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.id).toBe('class-a-0');
    expect(item.title).toBe('The Great Book - Hardcover');
    expect(item.description).toBe('Full description');
    expect(item.availability).toBe('in stock');
    expect(item.condition).toBe('new');
    expect(item.price).toBe('15.00 USD');
    // publisher wins over author for `brand`
    expect(item.brand).toBe('Penguin');
    expect(item.item_group_id).toBe('class-a');
    expect(item.google_product_category).toBe('Media > Books > E-Books');
    expect(item.fb_product_category).toBe('Media > Books');
    // hyphenated ISBN-13 normalized to a 13-digit GTIN
    expect(item.gtin).toBe('9783161484100');
    expect(item.custom_label_0).toBe('0xabc');
    expect(item.link).toContain('/store/class-a');
  });

  it('falls back brand to author, then 3ook.com, and drops invalid GTINs', async () => {
    setBooks([
      {
        id: 'class-f',
        classId: 'class-f',
        name: 'Solo Work',
        image: 'https://img.example/f.jpg',
        author: 'Solo Writer', // no publisher → author
        isbn: '0-306-40615-2', // ISBN-10 (10 digits) → not a valid GTIN length
        ownerWallet: '0xfff',
        description: 'short',
        prices: [{ priceInDecimal: 999, stock: 0, isAutoDeliver: false }],
      },
      {
        id: 'class-i',
        classId: 'class-i',
        name: 'Anonymous',
        image: 'https://img.example/i.jpg',
        ownerWallet: '0xiii', // no author, no publisher → 3ook.com
        description: 'desc',
        prices: [{ priceInDecimal: 500, stock: 3 }],
      },
    ]);

    const items = await getMetaProductCatalogItems();

    const solo = items.find((i) => i.id === 'class-f-0');
    expect(solo?.brand).toBe('Solo Writer');
    expect(solo?.gtin).toBeUndefined();
    expect(solo?.availability).toBe('out of stock');
    expect(solo?.price).toBe('9.99 USD');
    expect(solo?.title).toBe('Solo Work');

    const anon = items.find((i) => i.id === 'class-i-0');
    expect(anon?.brand).toBe('3ook.com');
  });

  it('skips hidden, redirected, adult, and ads-denied books', async () => {
    await expectCatalogItemIds([
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
    await expectCatalogItemIds([{
      id: 'legacy', classId: 'legacy', name: 'Legacy', image: 'https://img/l.jpg', prices: [{ priceInDecimal: 100 }],
    }], ['legacy-0']);
  });

  it('drops unlisted, non-positive, nameless, and imageless price variants', async () => {
    await expectCatalogItemIds([
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
        id: 'noname', classId: 'noname', image: 'https://img/n.jpg', prices: [{ priceInDecimal: 1000 }], // missing name → dropped
      },
      {
        id: 'noimage', classId: 'noimage', name: 'No Image', prices: [{ priceInDecimal: 1000 }], // missing image → dropped
      },
    ], ['mixed-0']);
  });
});

describe('formatMetaProductCatalogCSV', () => {
  const baseItem: MetaCatalogItem = {
    id: 'class-a-0',
    title: 'The Great Book',
    description: 'Full description',
    availability: 'in stock',
    condition: 'new',
    price: '15.00 USD',
    link: 'https://3ook.com/store/class-a?priceIndex=0',
    image_link: 'https://img.example/a.jpg',
    brand: 'Penguin',
    item_group_id: 'class-a',
    google_product_category: 'Media > Books > E-Books',
    fb_product_category: 'Media > Books',
    gtin: '9783161484100',
    custom_label_0: '0xabc',
  };

  it('emits the template header in column order', () => {
    const [header] = formatMetaProductCatalogCSV([]).split('\n');
    expect(header).toBe(
      'id,title,description,availability,condition,price,link,image_link,brand,'
      + 'google_product_category,fb_product_category,item_group_id,gtin,custom_label_0',
    );
  });

  it('serializes an item into a row matching the header order', () => {
    const [, row] = formatMetaProductCatalogCSV([baseItem]).split('\n');
    expect(row).toBe(
      'class-a-0,The Great Book,Full description,in stock,new,15.00 USD,'
      + 'https://3ook.com/store/class-a?priceIndex=0,https://img.example/a.jpg,Penguin,'
      + 'Media > Books > E-Books,Media > Books,class-a,9783161484100,0xabc',
    );
  });

  it('quotes and escapes fields containing commas, quotes, and newlines', () => {
    const csv = formatMetaProductCatalogCSV([{
      ...baseItem,
      title: 'Book, "Special" Edition',
      description: 'Line one\nLine two',
    }]);
    // Don't split on '\n' here: the escaped description legitimately contains one.
    expect(csv).toContain('class-a-0,"Book, ""Special"" Edition","Line one\nLine two",');
  });

  it('defangs spreadsheet formula injection in publisher-supplied fields', () => {
    const csv = formatMetaProductCatalogCSV([{
      ...baseItem,
      title: '=HYPERLINK("http://evil")',
      brand: '@SUM(A1)',
    }]);
    // Leading formula triggers get a single-quote prefix; the '=' value also
    // contains a comma/quote so it is additionally RFC 4180 quoted.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(csv).toContain(",'@SUM(A1),");
  });

  it('leaves optional columns blank when absent', () => {
    const withoutOptional: MetaCatalogItem = { ...baseItem };
    delete withoutOptional.gtin;
    delete withoutOptional.custom_label_0;
    const [, row] = formatMetaProductCatalogCSV([withoutOptional]).split('\n');
    // trailing gtin and custom_label_0 columns are empty
    expect(row.endsWith('class-a,,')).toBe(true);
  });
});
