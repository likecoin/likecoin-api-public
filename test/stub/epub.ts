// Zip local file header for the uncompressed `mimetype` entry OCF requires
// first, so the media type lands at offset 38 exactly as in a real EPUB.
// `extraFieldLength` pushes it past that, which is malformed but does occur.
export function epubHeader({ extraFieldLength = 0 } = {}): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt32LE(20, 18); // compressed size
  header.writeUInt32LE(20, 22); // uncompressed size
  header.writeUInt16LE(8, 26); // file name length: 'mimetype'
  header.writeUInt16LE(extraFieldLength, 28);
  return Buffer.concat([
    header,
    Buffer.from('mimetype'),
    Buffer.alloc(extraFieldLength),
    Buffer.from('application/epub+zip'),
    Buffer.from('...rest of the archive...'),
  ]);
}

export default epubHeader;
