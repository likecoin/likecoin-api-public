import { FIRESTORE_QUERY_DISJUNCTION_LIMIT } from '../../../../constant';

// "ISBN", "ISBN-13", or "ISBN-10", then a delimiter. The 10/13 counts as a
// label only when a separator follows it, so an ISBN-10 may start with those
// digits ("ISBN 1305504917").
const ISBN_LABEL = /^\s*isbn(?:[-\s]?(?:10|13)(?=[\s:]))?[\s:]*/i;

// Group lengths allowed by the ISBN standard: registration group 1-5 digits,
// registrant and publication 1-7, together the 9 digits before the check digit.
const GROUP_MIN = 1;
const GROUP_MAX = 5;
const REGISTRANT_MAX = 7;
const PUBLICATION_MAX = 7;
const BODY_LENGTH = 9;

function ISBN10CheckDigit(nine: string): string {
  let sum = 0;
  for (let i = 0; i < nine.length; i += 1) {
    sum += Number(nine[i]) * (10 - i);
  }
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

function ISBN13CheckDigit(twelve: string): string {
  let sum = 0;
  for (let i = 0; i < twelve.length; i += 1) {
    sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

function isValidISBN10(compact: string): boolean {
  return /^\d{9}[\dX]$/.test(compact) && ISBN10CheckDigit(compact.slice(0, 9)) === compact[9];
}

function isValidISBN13(compact: string): boolean {
  return /^\d{13}$/.test(compact) && ISBN13CheckDigit(compact.slice(0, 12)) === compact[12];
}

// Only a valid check digit converts. A typo must not land on a different book.
function toISBN13(isbn10: string): string | undefined {
  if (!isValidISBN10(isbn10)) return undefined;
  const body = `978${isbn10.slice(0, 9)}`;
  return `${body}${ISBN13CheckDigit(body)}`;
}

function toISBN10(isbn13: string): string | undefined {
  if (!isValidISBN13(isbn13) || !isbn13.startsWith('978')) return undefined;
  const body = isbn13.slice(3, 12);
  return `${body}${ISBN10CheckDigit(body)}`;
}

export function compactISBN(input: string): string {
  return input.trim().replace(ISBN_LABEL, '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

// Same digits, every standard hyphenation, plus the space-separated twin.
// Listings store whichever of these the metadata happened to use.
function addGroupedForms(forms: Set<string>, compact: string) {
  const is13 = compact.length === 13;
  const nine = is13 ? compact.slice(3, 12) : compact.slice(0, BODY_LENGTH);
  const check = is13 ? compact.slice(12) : compact.slice(BODY_LENGTH);
  const prefix = is13 ? compact.slice(0, 3) : '';
  for (let group = GROUP_MIN; group <= GROUP_MAX; group += 1) {
    for (let registrant = GROUP_MIN; registrant <= REGISTRANT_MAX; registrant += 1) {
      const publication = BODY_LENGTH - group - registrant;
      if (publication >= GROUP_MIN && publication <= PUBLICATION_MAX) {
        const hyphenatedBody = [
          nine.slice(0, group),
          nine.slice(group, group + registrant),
          nine.slice(group + registrant),
          check,
        ].join('-');
        const hyphenated = prefix ? `${prefix}-${hyphenatedBody}` : hyphenatedBody;
        forms.add(hyphenated);
        forms.add(hyphenated.replace(/-/g, ' '));
      }
    }
  }
}

function relatedCompacts(compact: string): string[] {
  if (isValidISBN13(compact)) {
    const as10 = toISBN10(compact);
    return as10 ? [compact, as10] : [compact];
  }
  if (isValidISBN10(compact)) {
    const as13 = toISBN13(compact);
    return as13 ? [compact, as13] : [compact];
  }
  // Bad check digit: still match this exact number, but do not convert it.
  if (/^\d{13}$/.test(compact) || /^\d{9}[\dX]$/.test(compact)) return [compact];
  return [];
}

// A listing may store the label the metadata arrived with. Equality cannot see
// through it, so each grouping is also queried with the usual prefixes.
function addLabelledForms(forms: Set<string>) {
  [...forms].forEach((form) => {
    if (/^\s*isbn/i.test(form)) return;
    const digits = form.replace(/[^0-9Xx]/g, '');
    let kind = '';
    if (digits.length === 13) kind = '13';
    else if (digits.length === 10) kind = '10';
    if (!kind) return;
    ['ISBN ', 'ISBN: ', `ISBN-${kind}: `, `ISBN-${kind} `].forEach((prefix) => {
      forms.add(`${prefix}${form}`);
    });
  });
}

// Listings keep the ISBN string metadata arrived with, so hyphens, spaces and
// ISBN-10 vs ISBN-13 are all stored. Expand the standard groupings and query
// those strings; a normalized column would miss every existing listing.
export function ISBNLookupCandidates(input: string): string[] {
  const compacts = relatedCompacts(compactISBN(input));
  if (!compacts.length) return [];
  const forms = new Set<string>();
  compacts.forEach((compact) => {
    forms.add(compact);
    addGroupedForms(forms, compact);
  });
  const trimmed = input.trim();
  if (trimmed) forms.add(trimmed);
  // Check digit X is stored in either case.
  [...forms].forEach((form) => {
    if (form.includes('X')) forms.add(form.replace(/X/g, 'x'));
  });
  addLabelledForms(forms);
  return [...forms];
}

// Firestore rejects an `in` filter past the disjunction limit, so callers
// issue one query per chunk and merge.
export function chunkISBNLookupCandidates(
  isbn: string,
  limit = FIRESTORE_QUERY_DISJUNCTION_LIMIT,
): string[][] {
  const candidates = ISBNLookupCandidates(isbn);
  const chunks: string[][] = [];
  for (let offset = 0; offset < candidates.length; offset += limit) {
    chunks.push(candidates.slice(offset, offset + limit));
  }
  return chunks;
}
