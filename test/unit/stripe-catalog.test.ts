import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { getStripeFeedItems, formatStripeFeedCSV } from '../../src/util/api/likernft/book/stripeCatalog';
import type { StripeFeedItem } from '../../src/util/api/likernft/book/stripeCatalog';
import { listLatestNFTBookInfo } from '../../src/util/api/likernft/book/index';
import type { NFTBookListingInfo } from '../../src/types/book';

// Mock only the data fetch; keep the real pure helpers so the mapping logic is
// exercised end-to-end.
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

describe('getStripeFeedItems', () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it('maps each price into a Stripe row with the Google-Shopping dialect', async () => {
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

    const items = await getStripeFeedItems();
    expect(items).toHaveLength(2);
    const [first] = items;
    expect(first.id).toBe('class-a-0');
    expect(first.title).toBe('The Great Book - Hardcover');
    expect(first.link).toContain('/store/class-a');
    expect(first.image_link).toBe('https://img.example/a.jpg');
    expect(first.price).toBe('15.00 USD');
    // underscore enum, unlike the Meta feed's "in stock"
    expect(first.availability).toBe('in_stock');
    expect(first.condition).toBe('new');
    // author wins over publisher for brand (shared resolveCatalogBrand)
    expect(first.brand).toBe('Jane Doe');
    expect(first.gtin).toBe('9783161484100');
    expect(first.item_group_id).toBe('class-a');
    expect(first.item_group_title).toBe('The Great Book');
    // digital-goods + discovery-only flags
    expect(first.inventory_not_tracked).toBe('true');
    expect(first.disable_checkout).toBe('true');
    // tax code omitted by default
    expect(first.stripe_product_tax_code).toBeUndefined();

    expect(items[1].availability).toBe('out_of_stock');
  });

  it('drops invalid GTINs (ISBN-10) and keeps the row', async () => {
    setBooks([{
      id: 'class-f',
      classId: 'class-f',
      name: 'Solo Work',
      image: 'https://img.example/f.jpg',
      isbn: '0-306-40615-2', // ISBN-10 → not a valid GTIN length
      description: 'short',
      prices: [{ priceInDecimal: 999, stock: 3 }],
    }]);

    const [item] = await getStripeFeedItems();
    expect(item.gtin).toBeUndefined();
    expect(item.brand).toBe('3ook.com'); // no author/publisher → fallback
  });

  it('applies the same eligibility and variant drop rules as the other feeds', async () => {
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
    const items = await getStripeFeedItems();
    expect(items.map((i) => i.id)).toEqual(['ok-1']);
  });
});

describe('formatStripeFeedCSV', () => {
  const baseItem: StripeFeedItem = {
    id: 'class-a-0',
    title: 'The Great Book',
    description: 'Full description',
    link: 'https://3ook.com/store/class-a',
    image_link: 'https://img.example/a.jpg',
    price: '15.00 USD',
    availability: 'in_stock',
    inventory_not_tracked: 'true',
    condition: 'new',
    brand: 'Jane Doe',
    google_product_category: 'Media > Books > E-Books',
    item_group_id: 'class-a',
    item_group_title: 'The Great Book',
    disable_checkout: 'true',
    gtin: '9783161484100',
  };

  it('emits the header in column order', () => {
    const [header] = formatStripeFeedCSV([]).split('\n');
    expect(header).toBe(
      'id,title,description,link,image_link,price,availability,inventory_not_tracked,'
      + 'condition,brand,gtin,google_product_category,item_group_id,item_group_title,'
      + 'disable_checkout,stripe_product_tax_code',
    );
  });

  it('quotes fields with commas and defangs formula injection', () => {
    const csv = formatStripeFeedCSV([{
      ...baseItem,
      title: '=HYPERLINK("http://evil")',
    }]);
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")"');
    // category contains '>' but no comma/quote, so it is not quoted
    expect(csv).toContain('Media > Books > E-Books');
  });

  it('leaves an absent tax code blank in the trailing column', () => {
    const [, row] = formatStripeFeedCSV([baseItem]).split('\n');
    expect(row.endsWith(',')).toBe(true);
  });
});
