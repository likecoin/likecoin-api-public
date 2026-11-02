import {
  describe, it, expect, beforeEach,
} from 'vitest';
import {
  getBookInfoForAdmin,
  parseBookInfoClassId,
} from '../../src/util/api/likernft/book/adminInfo';
import { likeNFTBookCollection } from '../../src/util/firebase';
import { createBookInfoSlackBlocks } from '../../src/util/slack';

const CLASS_ID = '0x1234567890abcdef1234567890abcdef12345678';

describe('parseBookInfoClassId', () => {
  it.each([
    ['a bare EVM class id', CLASS_ID],
    ['a legacy cosmos class id', 'likenft1acdefgh'],
  ])('accepts %s', (_label, input) => {
    expect(parseBookInfoClassId(input)).toBe(input);
  });

  it.each([
    ['a store URL', `https://3ook.com/store/${CLASS_ID}`],
    ['a localized store URL', `https://3ook.com/en/store/${CLASS_ID}`],
    ['a store URL with tracking params', `https://3ook.com/store/${CLASS_ID}?from=abc&price_index=1`],
    // Slack wraps a pasted URL in angle brackets, and adds |label once rendered.
    ['a Slack-wrapped URL', `<https://3ook.com/store/${CLASS_ID}>`],
    ['a Slack-wrapped labelled URL', `<https://3ook.com/store/${CLASS_ID}|3ook.com>`],
  ])('extracts the class id from %s', (_label, input) => {
    expect(parseBookInfoClassId(input)).toBe(CLASS_ID);
  });

  it('lowercases a checksummed EVM class id', () => {
    expect(parseBookInfoClassId('0x1234567890ABCDEF1234567890abcdef12345678')).toBe(CLASS_ID);
  });

  it.each([
    ['no argument', undefined],
    ['an empty string', '  '],
    ['a truncated address', '0x1234'],
    ['an unrelated URL', 'https://3ook.com/shelf'],
    ['a bare word', 'nonsense'],
  ])('rejects %s', (_label, input) => {
    expect(() => parseBookInfoClassId(input)).toThrow();
  });
});

describe('getBookInfoForAdmin', () => {
  beforeEach(async () => {
    await likeNFTBookCollection.doc(CLASS_ID).set({
      chain: 'base', name: 'A Book', ownerWallet: '0xAbC',
    } as any);
  });

  it('falls back to the doc id for listings predating the classId field', async () => {
    const book = await getBookInfoForAdmin(CLASS_ID);
    expect(book.classId).toBe(CLASS_ID);
    expect(book.name).toBe('A Book');
  });

  it('names the missing class rather than returning an empty listing', async () => {
    await expect(getBookInfoForAdmin('0xmissing')).rejects.toThrow(/0xmissing.*not found/);
  });
});

describe('createBookInfoSlackBlocks', () => {
  it('renders metadata, status flags and every edition', () => {
    const blocks = createBookInfoSlackBlocks({
      classId: CLASS_ID,
      name: 'A Book',
      chain: 'base',
      author: { name: 'An Author' },
      publisher: 'A Publisher',
      ownerWallet: '0xAbC',
      inLanguage: 'zh',
      isbn: '978-000',
      approvalStatus: 'approved',
      isPendingReview: true,
      minPriceInDecimal: 0,
      timestamp: { toMillis: () => Date.UTC(2026, 7, 14) },
      prices: [
        { name: { zh: '免費版' }, priceInDecimal: 0, sold: 3 },
        {
          name: 'Deluxe', priceInDecimal: 1250, sold: 7, stock: 5,
        },
        {
          name: 'Auto', priceInDecimal: 500, sold: 1, stock: 0, isAutoDeliver: true,
        },
      ],
    });
    const text = JSON.stringify(blocks);
    expect(text).toContain(CLASS_ID);
    expect(text).toContain('An Author');
    expect(text).toContain('A Publisher');
    expect(text).toContain('2026-08-14');
    expect(text).toContain('⏳pending');
    expect(text).toContain('3 edition(s)');
    expect(text).toContain('免費版');
    expect(text).toContain('US$12.50');
    expect(text).toContain('stock 5');
    // auto-deliver mints on demand, so its stored stock must not read as sold out
    expect(text).toContain('auto-deliver');
    expect(text).toContain('Total sold: 11');
  });

  it('escapes mrkdwn in author-supplied names', () => {
    const blocks = createBookInfoSlackBlocks({
      classId: CLASS_ID,
      name: '<!channel> free books',
      author: '<!here>',
      prices: [{ name: '<!everyone>', priceInDecimal: 0 }],
    });
    const text = JSON.stringify(blocks);
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<!here>');
    expect(text).not.toContain('<!everyone>');
  });

  it('stays within Slack block limits for a pathologically long edition list', () => {
    const blocks = createBookInfoSlackBlocks({
      classId: CLASS_ID,
      name: 'A Book',
      prices: Array.from({ length: 100 }, (_, index) => ({
        name: `Edition ${index} `.padEnd(400, '&'),
        priceInDecimal: index,
      })),
    });
    expect(blocks.length).toBeLessThanOrEqual(50);
    blocks
      .filter((block) => block.type === 'section' && block.text)
      .forEach((block) => expect(block.text.text.length).toBeLessThanOrEqual(3000));
    const fieldSections = blocks.filter((block) => block.fields);
    fieldSections.forEach((block) => expect(block.fields.length).toBeLessThanOrEqual(10));
  });

  it('caps author-supplied metadata fields within Slack field limits', () => {
    const long = '&'.repeat(5000);
    const blocks = createBookInfoSlackBlocks({
      classId: CLASS_ID,
      author: long,
      publisher: long,
      inLanguage: long,
      isbn: long,
    } as any);
    blocks
      .filter((block) => block.fields)
      .flatMap((block) => block.fields)
      .forEach((field) => expect(field.text.length).toBeLessThanOrEqual(2000));
  });
});
