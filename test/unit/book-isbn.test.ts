import { describe, expect, it } from 'vitest';
import { FIRESTORE_QUERY_DISJUNCTION_LIMIT } from '../../src/constant';
import {
  chunkIsbnLookupCandidates,
  compactIsbn,
  isbnLookupCandidates,
} from '../../src/util/api/likernft/book/isbn';

const TAIWAN_13 = '9786266531625';
const TAIWAN_10 = '6266531623';
const CANON_13 = '9780306406157';
const CANON_10 = '0306406152';

describe('compactIsbn', () => {
  it('drops hyphens, spaces and an ISBN label without keeping the label digits', () => {
    expect(compactIsbn('978-626-653-162-5')).toBe(TAIWAN_13);
    expect(compactIsbn('978 626 653 162 5')).toBe(TAIWAN_13);
    expect(compactIsbn('ISBN-13: 978-626-653-162-5')).toBe(TAIWAN_13);
    expect(compactIsbn('ISBN-10: 0-306-40615-2')).toBe(CANON_10);
    expect(compactIsbn('isbn13 9780306406157')).toBe(CANON_13);
  });
});

describe('isbnLookupCandidates', () => {
  it('includes compact, hyphenated, spaced and ISBN-10 forms of one number', () => {
    const candidates = isbnLookupCandidates(TAIWAN_13);
    expect(candidates).toContain(TAIWAN_13);
    expect(candidates).toContain('978-626-653-162-5');
    expect(candidates).toContain('978 626 653 162 5');
    expect(candidates).toContain(TAIWAN_10);
    expect(candidates).not.toContain('0-306-40615-2');
  });

  it('matches a hyphenated query to the same set of strings', () => {
    const fromCompact = new Set(isbnLookupCandidates(TAIWAN_13));
    const fromHyphen = isbnLookupCandidates('978-626-653-162-5');
    fromHyphen.forEach((candidate) => expect(fromCompact.has(candidate)).toBe(true));
  });

  it('converts a canonical ISBN-10 and keeps a lowercase check digit', () => {
    const candidates = isbnLookupCandidates('0-8044-2957-x');
    expect(candidates).toContain('080442957X');
    expect(candidates).toContain('080442957x');
    expect(candidates).toContain('0-8044-2957-X');
    expect(candidates).toContain('0-8044-2957-x');
    expect(candidates).toContain('9780804429573');
  });

  it('does not convert a check-digit typo into a different ISBN', () => {
    const candidates = isbnLookupCandidates('9786266531626');
    expect(candidates).toContain('9786266531626');
    expect(candidates).not.toContain(TAIWAN_13);
    expect(candidates).not.toContain(TAIWAN_10);
  });

  it('returns nothing for a string that is not 10 or 13 digits', () => {
    expect(isbnLookupCandidates('not-an-isbn')).toEqual([]);
    expect(isbnLookupCandidates('978-626')).toEqual([]);
  });

  it('chunks every candidate under the Firestore disjunction limit', () => {
    const candidates = isbnLookupCandidates('ISBN: 978-0-306-40615-7');
    const chunks = chunkIsbnLookupCandidates('ISBN: 978-0-306-40615-7');
    expect(candidates.length).toBeGreaterThan(FIRESTORE_QUERY_DISJUNCTION_LIMIT);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(FIRESTORE_QUERY_DISJUNCTION_LIMIT);
    });
    expect(chunks.flat()).toEqual(candidates);
    expect(candidates).toContain(CANON_13);
    expect(candidates).toContain(CANON_10);
    expect(candidates).toContain('978-0-306-40615-7');
    expect(candidates).toContain('0-306-40615-2');
  });
});
