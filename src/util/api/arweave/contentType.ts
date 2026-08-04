import fileType from 'file-type';

export const EPUB_CONTENT_TYPE = 'application/epub+zip';
export const PDF_CONTENT_TYPE = 'application/pdf';

// What an unidentified object is stored as. Legacy ingests recorded this for
// every protected upload — the Arweave gateway describes the AES-GCM blob, not
// the ebook inside it — so it doubles as the marker the one-off relabel script
// selects on (likecoin-misc-services backfillProtectedContentType.js).
export const PLACEHOLDER_CONTENT_TYPE = 'application/octet-stream';

export const EBOOK_CONTENT_TYPES = [EPUB_CONTENT_TYPE, PDF_CONTENT_TYPE] as const;

export type EbookContentType = typeof EBOOK_CONTENT_TYPES[number];

// file-type's own minimumBytes is 4100, but PDF needs 5 and EPUB 58: the OCF
// media type sits at offset 38. Revisit this if EBOOK_CONTENT_TYPES ever grows
// a format whose signature lands later, or detection will silently under-read.
export const CONTENT_SNIFF_LENGTH = 128;

function isEbookContentType(mime?: string): mime is EbookContentType {
  return !!mime && (EBOOK_CONTENT_TYPES as readonly string[]).includes(mime);
}

/**
 * Identify an ebook from its leading bytes. The protected tier only ever holds
 * the two types the upload schema accepts, so anything else returns undefined
 * for the caller to fall back on rather than being guessed at.
 */
export function detectEbookContentType(head: Buffer): EbookContentType | undefined {
  const window = head.subarray(0, CONTENT_SNIFF_LENGTH);
  const mime = fileType(window)?.mime;
  if (isEbookContentType(mime)) return mime;
  // OCF requires the first zip entry to be an uncompressed `mimetype` file whose
  // data is the media type, and file-type only matches it at exactly offset 38.
  // An EPUB that pads its local header with an extra field is malformed but still
  // readable, and reports as a plain zip — recognise it rather than lose it.
  if (mime === 'application/zip' && window.includes(EPUB_CONTENT_TYPE)) {
    return EPUB_CONTENT_TYPE;
  }
  return undefined;
}

export default detectEbookContentType;
