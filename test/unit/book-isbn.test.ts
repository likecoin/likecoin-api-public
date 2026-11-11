import { describe, expect, it } from 'vitest';
import { FIRESTORE_QUERY_DISJUNCTION_LIMIT } from '../../src/constant';
import {
  chunkISBNLookupCandidates,
  compactISBN,
  ISBNLookupCandidates,
} from '../../src/util/api/likernft/book/isbn';

const TAIWAN_13 = '9786266531625';
const TAIWAN_10 = '6266531623';
const CANON_13 = '9780306406157';
const CANON_10 = '0306406152';

describe('compactISBN', () => {
  it('drops hyphens, spaces and an ISBN label without keeping the label digits', () => {
    expect(compactISBN('978-626-653-162-5')).toBe(TAIWAN_13);
    expect(compactISBN('978 626 653 162 5')).toBe(TAIWAN_13);
    expect(compactISBN('ISBN-13: 978-626-653-162-5')).toBe(TAIWAN_13);
    expect(compactISBN('ISBN-10: 0-306-40615-2')).toBe(CANON_10);
    expect(compactISBN('isbn13 9780306406157')).toBe(CANON_13);
    // The label's "13" must not eat an ISBN-10 that itself starts with 13.
    expect(compactISBN('ISBN 1305504917')).toBe('1305504917');
    expect(compactISBN('ISBN 1041234567')).toBe('1041234567');
  });
});

describe('ISBNLookupCandidates', () => {
  it('includes compact, hyphenated, spaced and ISBN-10 forms of one number', () => {
    const candidates = ISBNLookupCandidates(TAIWAN_13);
    expect(candidates).toContain(TAIWAN_13);
    expect(candidates).toContain('978-626-653-162-5');
    expect(candidates).toContain('978 626 653 162 5');
    expect(candidates).toContain(TAIWAN_10);
    expect(candidates).not.toContain('0-306-40615-2');
  });

  it('matches a hyphenated query to the same set of strings', () => {
    const fromCompact = new Set(ISBNLookupCandidates(TAIWAN_13));
    const fromHyphen = ISBNLookupCandidates('978-626-653-162-5');
    fromHyphen.forEach((candidate) => expect(fromCompact.has(candidate)).toBe(true));
  });

  it('converts a canonical ISBN-10 and keeps a lowercase check digit', () => {
    const candidates = ISBNLookupCandidates('0-8044-2957-x');
    expect(candidates).toContain('080442957X');
    expect(candidates).toContain('080442957x');
    expect(candidates).toContain('0-8044-2957-X');
    expect(candidates).toContain('0-8044-2957-x');
    expect(candidates).toContain('9780804429573');
  });

  it('does not convert a check-digit typo into a different ISBN', () => {
    const candidates = ISBNLookupCandidates('9786266531626');
    expect(candidates).toContain('9786266531626');
    expect(candidates).not.toContain(TAIWAN_13);
    expect(candidates).not.toContain(TAIWAN_10);
  });

  it('keeps an ISBN-10 that starts with the label digits 10 or 13', () => {
    const candidates = ISBNLookupCandidates('ISBN 1305504917');
    expect(candidates).toContain('1305504917');
    expect(candidates).not.toContain('05504917');
  });

  it('includes a label-prefixed hyphenation for a bare ISBN query', () => {
    const candidates = ISBNLookupCandidates(TAIWAN_13);
    expect(candidates).toContain('ISBN-13: 978-626-653-162-5');
    expect(candidates).toContain('ISBN: 9786266531625');
    expect(candidates).toContain(`ISBN-10: ${TAIWAN_10}`);
  });

  it('returns nothing for a string that is not 10 or 13 digits', () => {
    expect(ISBNLookupCandidates('not-an-isbn')).toEqual([]);
    expect(ISBNLookupCandidates('978-626')).toEqual([]);
  });

  it('chunks every candidate under the Firestore disjunction limit', () => {
    const candidates = ISBNLookupCandidates('ISBN: 978-0-306-40615-7');
    const chunks = chunkISBNLookupCandidates('ISBN: 978-0-306-40615-7');
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
