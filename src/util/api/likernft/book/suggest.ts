import { likeNFTBookCollection } from '../../../firebase';
import { getVertexGenAIClient } from '../../../vertexAI';
import { VERTEX_AI_GEMINI_MODEL } from '../../../../../config/config';
import type { BookMetadataSuggestBody } from './schemas';

// Keep in sync with BOOK_CATEGORIES in publish-3ook-com app/constant/index.ts;
// values are the stored genre strings, so drift breaks the author-facing dropdown.
export const BOOK_CATEGORY_VALUES = [
  'Antiques & Collectibles', 'Architecture', 'Art', 'Bibles',
  'Biography & Autobiography', 'Business & Economics', 'Comics & Graphic Novels',
  'Computers', 'Cooking', 'Crafts & Hobbies', 'Design', 'Drama', 'Education',
  'Family & Relationships', 'Fiction', 'Games & Activities', 'Gardening',
  'Health & Fitness', 'History', 'House & Home', 'Humor', 'Juvenile Fiction',
  'Juvenile Nonfiction', 'Language Arts & Disciplines', 'Language Study', 'Law',
  'Literary Collections', 'Literary Criticism', 'Mathematics', 'Medical',
  'Mind, Body, Spirit', 'Music', 'Nature', 'Performing Arts', 'Pets',
  'Philosophy', 'Photography', 'Poetry', 'Political Science', 'Psychology',
  'Reference', 'Religion', 'Science', 'Self-Help', 'Social Science',
  'Sports & Recreation', 'Study Aids', 'Technology & Engineering',
  'Transportation', 'Travel', 'True Crime', 'Young Adult Fiction',
  'Young Adult Nonfiction', 'Other',
] as const;

const VOCAB_MAX_SIZE = 300;
const VOCAB_SCAN_LIMIT = 2000;
const VOCAB_CACHE_TTL_MS = 60 * 60 * 1000;

// NFKC also folds width variants (ＡＩ vs AI), so visually identical
// keywords collapse onto one canonical entry.
function normalizeKeyword(raw: unknown): string {
  return typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';
}

interface KeywordVocabularyEntry {
  keyword: string;
  count: number;
}

let vocabCache: {
  fetchedAt: number;
  entries: Promise<KeywordVocabularyEntry[]>;
} | null = null;

// Scan cost stays flat as the catalog grows: only the newest VOCAB_SCAN_LIMIT
// listings are read, and recent books carry the vocabulary authors reuse.
// It runs at most once per TTL per instance and the promise is cached, so
// concurrent misses share one scan; hourly staleness is fine for hints.
export async function getKeywordVocabulary(): Promise<KeywordVocabularyEntry[]> {
  if (vocabCache && Date.now() - vocabCache.fetchedAt < VOCAB_CACHE_TTL_MS) {
    return vocabCache.entries;
  }
  const entries = (async () => {
    const snapshot = await likeNFTBookCollection
      .orderBy('timestamp', 'desc')
      .limit(VOCAB_SCAN_LIMIT)
      .select('keywords')
      .get();
    const counts = new Map<string, KeywordVocabularyEntry>();
    snapshot.docs.forEach((doc) => {
      const { keywords } = doc.data();
      if (!Array.isArray(keywords)) return;
      keywords.forEach((raw) => {
        const keyword = normalizeKeyword(raw);
        if (!keyword) return;
        const key = keyword.toLowerCase();
        const entry = counts.get(key);
        if (entry) {
          entry.count += 1;
        } else {
          counts.set(key, { keyword, count: 1 });
        }
      });
    });
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, VOCAB_MAX_SIZE);
  })();
  vocabCache = { fetchedAt: Date.now(), entries };
  try {
    return await entries;
  } catch (err) {
    vocabCache = null;
    throw err;
  }
}

// Snap suggestions onto the catalog's exact string form when they match an
// existing keyword (case-insensitively, width-folded), deduplicating.
function snapKeywordsToVocabulary(
  keywords: string[],
  vocabulary: KeywordVocabularyEntry[],
): string[] {
  const canonicalByKey = new Map(
    vocabulary.map(({ keyword }) => [keyword.toLowerCase(), keyword]),
  );
  const seen = new Set<string>();
  const result: string[] = [];
  keywords.forEach((raw) => {
    const keyword = normalizeKeyword(raw);
    if (!keyword) return;
    const canonical = canonicalByKey.get(keyword.toLowerCase()) || keyword;
    const canonicalKey = canonical.toLowerCase();
    if (seen.has(canonicalKey)) return;
    seen.add(canonicalKey);
    result.push(canonical);
  });
  return result;
}

const SYSTEM_PROMPT = [
  'You are a librarian for an ebook store that mainly carries Traditional Chinese and English books.',
  'Given a book\'s metadata and content excerpt, classify it into exactly one genre and suggest 3 to 8 search keywords.',
  'Keywords must be in the same language as the book content.',
  'When a keyword you would suggest is semantically close to one of the existing catalog keywords provided, use the existing keyword\'s exact string form instead of inventing a variant.',
  'Only introduce a new keyword when nothing in the existing list fits.',
  'Prefer keywords readers would actually search for; do not repeat the genre name as a keyword.',
].join(' ');

export interface BookMetadataSuggestion {
  genre: typeof BOOK_CATEGORY_VALUES[number];
  keywords: string[];
}

export async function suggestBookMetadata({
  title,
  description = '',
  language = '',
  tableOfContents = '',
  contentExcerpt = '',
  existingKeywords = [],
}: BookMetadataSuggestBody): Promise<BookMetadataSuggestion> {
  // Type must come via dynamic import: @google/genai is ESM-only to tsc.
  const [vocabulary, client, { Type }] = await Promise.all([
    getKeywordVocabulary(),
    getVertexGenAIClient(),
    import('@google/genai'),
  ]);
  const vocabularyBlock = vocabulary.length
    ? `Existing catalog keywords (with usage counts):\n${vocabulary
      .map(({ keyword, count }) => `${keyword} (${count})`)
      .join(', ')}`
    : 'The catalog has no existing keywords yet.';
  const bookBlock = [
    `Title: ${title}`,
    language ? `Language: ${language}` : '',
    description ? `Description:\n${description}` : '',
    existingKeywords.length ? `Author-entered keywords: ${existingKeywords.join(', ')}` : '',
    tableOfContents ? `Table of contents:\n${tableOfContents}` : '',
    contentExcerpt ? `Content excerpt:\n${contentExcerpt}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await client.models.generateContent({
    model: VERTEX_AI_GEMINI_MODEL,
    contents: `${vocabularyBlock}\n\n---\n\n${bookBlock}`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          genre: { type: Type.STRING, enum: [...BOOK_CATEGORY_VALUES] },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['genre', 'keywords'],
      },
    },
  });
  const { text } = response;
  if (!text) {
    throw new Error('BOOK_METADATA_SUGGEST_FAILED: empty model response');
  }
  // responseSchema does not guarantee parseable output: hitting maxOutputTokens
  // truncates the JSON mid-string, so surface that instead of a bare SyntaxError.
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`BOOK_METADATA_SUGGEST_FAILED: unparseable model response: ${text.slice(0, 200)}`);
  }
  const genre = BOOK_CATEGORY_VALUES.find((value) => value === parsed.genre) || 'Other';
  const keywords = snapKeywordsToVocabulary(
    Array.isArray(parsed.keywords) ? parsed.keywords : [],
    vocabulary,
  ).slice(0, 8);
  return { genre, keywords };
}

export default suggestBookMetadata;
