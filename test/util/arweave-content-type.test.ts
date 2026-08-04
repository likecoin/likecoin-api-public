import { describe, it, expect } from 'vitest';

import { epubHeader } from '../stub/epub';
import {
  EPUB_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  detectEbookContentType,
} from '../../src/util/api/arweave/contentType';

describe('detectEbookContentType', () => {
  it('identifies an EPUB from its OCF mimetype entry', () => {
    expect(detectEbookContentType(epubHeader())).toBe(EPUB_CONTENT_TYPE);
  });

  // file-type only matches the media type at exactly offset 38 and calls this a
  // plain zip; the fallback is what keeps a malformed EPUB from being lost.
  it('tolerates an extra field between the name and the media type', () => {
    expect(detectEbookContentType(epubHeader({ extraFieldLength: 12 }))).toBe(EPUB_CONTENT_TYPE);
  });

  it('identifies a PDF from its magic bytes', () => {
    expect(detectEbookContentType(Buffer.from('%PDF-1.7\n%...'))).toBe(PDF_CONTENT_TYPE);
  });

  it('does not claim a plain zip is an EPUB', () => {
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(120),
    ]);
    expect(detectEbookContentType(zip)).toBeUndefined();
  });

  it('returns undefined for unknown bytes, rather than guessing', () => {
    expect(detectEbookContentType(Buffer.from('not an ebook at all'))).toBeUndefined();
    expect(detectEbookContentType(Buffer.alloc(0))).toBeUndefined();
  });

  // The media type sits at offset 38, so a marker past the window must not match
  // on the zip magic alone — otherwise a longer sniff would change the answer.
  it('ignores an EPUB marker beyond the sniff window', () => {
    const far = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(200),
      Buffer.from(EPUB_CONTENT_TYPE),
    ]);
    expect(detectEbookContentType(far)).toBeUndefined();
  });
});
