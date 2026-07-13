import { describe, it, expect } from 'vitest';

import { getCacheFilePath, resolveBookFileCacheURL } from '../../src/util/api/likernft/book/cache';

const CLASS_ID = '0xabc';
const AES_KEY = 'ZmFrZS1hZXMta2V5LWRvLW5vdC11c2U=';

const pathFor = (url: string) => `${CLASS_ID}/${encodeURIComponent(url)}`;

describe('book cache file path', () => {
  it('keeps the decryption key out of the object name', () => {
    const path = getCacheFilePath(CLASS_ID, `https://gateway.irys.xyz/txid123?key=${AES_KEY}`);
    expect(path).not.toContain(AES_KEY);
    expect(path).toBe(pathFor('https://gateway.irys.xyz/txid123'));
  });

  it('preserves non-key query params so distinct files cannot collide', () => {
    const path = getCacheFilePath(CLASS_ID, `https://w3s.link/ipfs/cid?key=${AES_KEY}&filename=book.epub`);
    expect(path).not.toContain(AES_KEY);
    expect(path).toBe(pathFor('https://w3s.link/ipfs/cid?filename=book.epub'));
  });

  // ebook-cors reads what this writes, so a URL carrying no key must round-trip
  // byte-identically — re-serialising it would orphan every object cached so far.
  it('leaves key-less URLs untouched, including ones that merely contain "key="', () => {
    const plain = 'https://gateway.irys.xyz/txid123';
    expect(getCacheFilePath(CLASS_ID, plain)).toBe(pathFor(plain));

    const lookalike = 'https://gateway.irys.xyz/tx?monkey=1';
    expect(getCacheFilePath(CLASS_ID, lookalike)).toBe(pathFor(lookalike));
  });

  it('maps one arweaveId to one object regardless of the key it carries', () => {
    const a = getCacheFilePath(CLASS_ID, `https://gateway.irys.xyz/txid123?key=${AES_KEY}`);
    const b = getCacheFilePath(CLASS_ID, 'https://gateway.irys.xyz/txid123?key=Um90YXRlZEtleQ==');
    expect(a).toBe(b);
  });

  it('distinguishes different files that share a class', () => {
    const a = getCacheFilePath(CLASS_ID, `https://gateway.irys.xyz/aaa?key=${AES_KEY}`);
    const b = getCacheFilePath(CLASS_ID, `https://gateway.irys.xyz/bbb?key=${AES_KEY}`);
    expect(a).not.toBe(b);
  });

  it('falls back to the raw string when the URL will not parse', () => {
    expect(getCacheFilePath(CLASS_ID, 'not a url ?key=abc')).toBe(pathFor('not a url ?key=abc'));
  });
});

// The resolver, not getCacheFilePath, is where a stray searchParams.delete() would
// silently re-encode a query (%20 -> +) and rename every warm object under it.
describe('book cache URL resolution', () => {
  it('drops an embedded key from legacy metadata URLs', async () => {
    const resolved = await resolveBookFileCacheURL(`https://arweave.net/txid123?key=${AES_KEY}`);
    expect(resolved).toBe('https://arweave.net/txid123');
  });

  it('leaves a key-less query byte-identical', async () => {
    const url = 'https://w3s.link/ipfs/cid?filename=my%20book.epub';
    expect(await resolveBookFileCacheURL(url)).toBe(url);
  });

  it('resolves ar:// and ipfs:// to the gateways ebook-cors uses', async () => {
    expect(await resolveBookFileCacheURL('ar://txid123')).toBe('https://gateway.irys.xyz/txid123');
    expect(await resolveBookFileCacheURL('ipfs://cid123')).toBe('https://w3s.link/ipfs/cid123');
  });

  it('drops URLs that point outside the known gateways', async () => {
    expect(await resolveBookFileCacheURL('https://evil.example/x.epub')).toBeUndefined();
  });
});
