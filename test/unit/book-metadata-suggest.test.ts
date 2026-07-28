import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

import { likeNFTBookCollection } from '../../src/util/firebase';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  Type: {
    OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY',
  },
}));

vi.mock('../../src/util/vertexAI', () => ({
  getVertexGenAIClient: vi.fn(async () => ({ models: { generateContent } })),
}));

// eslint-disable-next-line import/first
import { suggestBookMetadata } from '../../src/util/api/likernft/book/suggest';

const BOOKS = [
  { id: '0xaaa', keywords: ['Web3', '香港文學', 'AI'] },
  { id: '0xbbb', keywords: ['web3', 'ＡＩ'] },
  { id: '0xccc', keywords: ['Web3 ', 'Cooking'] },
  { id: '0xddd', keywords: 'not-an-array' },
  { id: '0xeee', keywords: [null, '', '   '] },
];

function mockModelJSON(payload: unknown) {
  generateContent.mockResolvedValueOnce({ text: JSON.stringify(payload) });
}

const promptOf = () => generateContent.mock.calls[0][0].contents as string;

describe('book metadata suggestion', () => {
  beforeEach(async () => {
    // Reseeded every test because setup.ts clears the stub; the vocabulary
    // cache in suggest.ts is module-level, so the data must stay identical.
    await Promise.all(BOOKS.map(({ id, ...data }) => (
      likeNFTBookCollection.doc(id).set({ classId: id, timestamp: 1, ...data } as any)
    )));
  });

  it('folds case and width variants into one counted vocabulary entry', async () => {
    mockModelJSON({ genre: 'Fiction', keywords: [] });
    await suggestBookMetadata({ title: 'Book' } as any);

    const prompt = promptOf();
    expect(prompt).toContain('Web3 (3)');
    expect(prompt).toContain('AI (2)');
    expect(prompt).toContain('香港文學 (1)');
    // 'web3' and 'ＡＩ' are folded away, never offered as separate options.
    expect(prompt).not.toContain('web3 (');
    expect(prompt).not.toContain('ＡＩ (');
  });

  it('skips documents whose keywords field is absent or malformed', async () => {
    mockModelJSON({ genre: 'Fiction', keywords: [] });
    await suggestBookMetadata({ title: 'Book' } as any);

    const prompt = promptOf();
    expect(prompt).not.toContain('not-an-array');
    expect(prompt).not.toContain('null');
  });

  it('includes the supplied book metadata in the prompt', async () => {
    mockModelJSON({ genre: 'Fiction', keywords: [] });
    await suggestBookMetadata({
      title: 'The Book',
      language: 'zh-Hant',
      description: 'A description',
      existingKeywords: ['author-keyword'],
    } as any);

    const prompt = promptOf();
    expect(prompt).toContain('Title: The Book');
    expect(prompt).toContain('Language: zh-Hant');
    expect(prompt).toContain('A description');
    expect(prompt).toContain('author-keyword');
  });

  it('snaps suggestions onto the catalog spelling and deduplicates', async () => {
    mockModelJSON({ genre: 'Fiction', keywords: ['web3', 'WEB3', 'ＡＩ', 'AI', 'brand new'] });
    const { keywords } = await suggestBookMetadata({ title: 'Book' } as any);

    expect(keywords).toEqual(['Web3', 'AI', 'brand new']);
  });

  it('caps the returned keywords at 8', async () => {
    mockModelJSON({
      genre: 'Fiction',
      keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    });
    const { keywords } = await suggestBookMetadata({ title: 'Book' } as any);

    expect(keywords).toHaveLength(8);
  });

  it('falls back to Other when the model answers outside the category list', async () => {
    mockModelJSON({ genre: 'Sci-Fi', keywords: [] });
    const { genre } = await suggestBookMetadata({ title: 'Book' } as any);

    expect(genre).toBe('Other');
  });

  it('keeps a genre that matches the category list exactly', async () => {
    mockModelJSON({ genre: 'Cooking', keywords: [] });
    const { genre } = await suggestBookMetadata({ title: 'Book' } as any);

    expect(genre).toBe('Cooking');
  });

  it('tolerates a response missing the keywords array', async () => {
    mockModelJSON({ genre: 'Fiction' });
    const { keywords } = await suggestBookMetadata({ title: 'Book' } as any);

    expect(keywords).toEqual([]);
  });

  it('reports truncated JSON as a suggest failure, not a bare SyntaxError', async () => {
    generateContent.mockResolvedValueOnce({ text: '{"genre":"Fiction","keywords":["half' });

    await expect(suggestBookMetadata({ title: 'Book' } as any))
      .rejects.toThrow(/BOOK_METADATA_SUGGEST_FAILED: unparseable model response/);
  });

  it('reports an empty model response', async () => {
    generateContent.mockResolvedValueOnce({ text: '' });

    await expect(suggestBookMetadata({ title: 'Book' } as any))
      .rejects.toThrow(/BOOK_METADATA_SUGGEST_FAILED: empty model response/);
  });
});
