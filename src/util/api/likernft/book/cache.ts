import { pipeline } from 'stream/promises';
import type { File } from '@google-cloud/storage';

import { ARWEAVE_GATEWAY, ARWEAVE_GATEWAYS, API_HOSTNAME } from '../../../../constant';
import { fetchStreamWithFallback } from '../../../fetchStream';
import { bookCacheBucket } from '../../../gcloudStorage';
import { getArweaveTxInfo } from '../../arweave/tx';
import type { NFTClassData } from './index';

// Mirrors the gateway lists in likecoin-cloud-functions/ebook-cors/nft/http.js.
// The resolved URLs we cache always live on these gateways, so their cache time
// is the permanent one (matching ebook-cors getUrlCacheTime()).
const PERMANENT_CACHE_TIME_IN_S = 31536000;

const LIKECOIN_API_LINK_PREFIX = `https://${API_HOSTNAME}/arweave/v2/link/`;

// IPFS gateway fallbacks, same ordering as ebook-cors. The Arweave set is
// shared with the protected-content ingest; only membership matters here.
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://w3s.link/ipfs/', 'https://gateway.irys.xyz/ipfs/'];

// A real book class points at a handful of files (e.g. epub + pdf). Cap the
// fan-out so malformed/abusive metadata can't spawn an unbounded number of
// concurrent downloads — pre-warming is best-effort and ebook-cors still
// serves any uncached file on demand.
const MAX_CACHE_FILES_PER_CLASS = 10;

// Ceiling on a single cached file; axios defaults maxContentLength to unlimited,
// so without this a gateway could stream any amount into the bucket.
const MAX_CACHE_FILE_BYTES = 1024 * 1024 * 1024;

// A key in an object name would sit in bucket listings and audit logs beside the
// ciphertext it opens. Key-less URLs are returned verbatim rather than
// re-serialised, so objects cached before this existed stay addressable.
function stripKeyFromCacheURL(url: string): string {
  if (!url.includes('key=')) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('key')) return url;
    parsed.searchParams.delete('key');
    return parsed.toString();
  } catch {
    return url;
  }
}

// Must match ebook-cors nft/cache.js exactly — both repos address the same GCS
// objects, so any drift is a permanent cache miss on every protected book.
// Exported to keep that contract pinned by test.
export function getCacheFilePath(classId: string, url: string) {
  return `${classId}/${encodeURIComponent(stripKeyFromCacheURL(url))}`;
}

function getFallbackURLs(url: string): string[] {
  const arweaveGateway = ARWEAVE_GATEWAYS.find((g) => url.startsWith(g));
  if (arweaveGateway) {
    const id = url.replace(arweaveGateway, '');
    return ARWEAVE_GATEWAYS.filter((g) => g !== arweaveGateway).map((g) => `${g}${id}`);
  }
  const ipfsGateway = IPFS_GATEWAYS.find((g) => url.startsWith(g));
  if (ipfsGateway) {
    const cid = url.replace(ipfsGateway, '');
    return IPFS_GATEWAYS.filter((g) => g !== ipfsGateway).map((g) => `${g}${cid}`);
  }
  return [];
}

/**
 * Reproduces ebook-cors nft/index.js parseNFTMetadataURL() so the cache key we
 * write is byte-for-byte identical to the one ebook-cors will look up.
 *
 * The api/arweave/v2/link/<txHash> case is resolved locally via Firestore
 * (getArweaveTxInfo) instead of an HTTP round-trip. That endpoint's link also
 * carries ?key=, but we cache ciphertext and strip the key from the path, so it
 * is never unwrapped here.
 */
export async function resolveBookFileCacheURL(
  targetURI: string,
): Promise<string | undefined> {
  if (!targetURI) return undefined;
  let parsedURL: URL;
  try {
    parsedURL = new URL(targetURI);
  } catch {
    return undefined;
  }

  if (targetURI.startsWith(LIKECOIN_API_LINK_PREFIX)) {
    const txHash = targetURI
      .slice(LIKECOIN_API_LINK_PREFIX.length)
      .split('?')[0]
      .split('/')[0];
    if (!txHash) return undefined;
    const tx = await getArweaveTxInfo(txHash);
    if (!tx?.arweaveId) return undefined;
    parsedURL = new URL(`${ARWEAVE_GATEWAY}/${tx.arweaveId}`);
  }

  // Legacy metadata embeds ?key= in the URL itself. We cache ciphertext, so the
  // gateway never needs it — dropping it keeps the key out of the gateway's access
  // logs too. Guarded: delete() re-serialises the whole query (%20 becomes +) even
  // when nothing matches, which would rename already-cached objects.
  if (parsedURL.searchParams.has('key')) parsedURL.searchParams.delete('key');

  switch (parsedURL.protocol) {
    case 'ar:':
      return `${ARWEAVE_GATEWAY}/${parsedURL.host}`;
    case 'ipfs:':
      return `https://w3s.link/ipfs/${parsedURL.host}`;
    default: {
      const resolved = parsedURL.toString();
      // Only pre-warm URLs that point at gateways we know — anything else (incl.
      // internal hosts that could enable SSRF) is dropped. ebook-cors will still
      // serve them on demand if they turn out to be legitimate.
      const isAllowedGateway = [...ARWEAVE_GATEWAYS, ...IPFS_GATEWAYS]
        .some((prefix) => resolved.startsWith(prefix));
      return isAllowedGateway ? resolved : undefined;
    }
  }
}

function assertSupportedContentType(contentType: string) {
  if (!contentType.includes('pdf') && !contentType.includes('epub')) {
    throw new Error(`Content Type ${contentType} not supported`);
  }
}

async function isAlreadyCached(fileRef: File): Promise<boolean> {
  try {
    const [metadata] = await fileRef.getMetadata();
    // ebook-cors only treats an entry as a hit if contentType is set.
    return !!metadata.contentType;
  } catch (err) {
    if ((err as { code?: number }).code === 404) return false;
    throw err;
  }
}

async function cacheBookFile(classId: string, targetURI: string) {
  const url = await resolveBookFileCacheURL(targetURI);
  if (!url) return;
  const fileRef = bookCacheBucket.file(getCacheFilePath(classId, url));
  if (await isAlreadyCached(fileRef)) return;

  const { stream, contentType } = await fetchStreamWithFallback(
    [url, ...getFallbackURLs(url)],
    {
      timeout: 60000,
      maxContentLength: MAX_CACHE_FILE_BYTES,
      headers: { accept: 'application/pdf, application/epub+zip' },
    },
  );
  try {
    assertSupportedContentType(contentType);
  } catch (err) {
    // Nothing will consume the response, so release the socket rather than
    // leaving it open until the gateway or the timeout closes it.
    stream.destroy();
    throw err;
  }

  // Stream straight to GCS (the raw, still-encrypted bytes — ebook-cors caches
  // before decryption) so large ebooks never get fully buffered in memory.
  await pipeline(stream, fileRef.createWriteStream({
    metadata: {
      contentType,
      cacheControl: `public, max-age=${PERMANENT_CACHE_TIME_IN_S}`,
    },
  }));
}

function getTargetURIsFromNFTClassMetadata(metadata?: NFTClassData): string[] {
  if (!metadata) return [];
  const { potentialAction, sameAs } = metadata;
  if (potentialAction) {
    // potentialAction is either an array of actions (use ReadAction) or a
    // single action object; the typed shape only models the latter.
    const actions = potentialAction as { name?: string; target?: unknown[] }[]
      | { target?: unknown[] };
    const target = Array.isArray(actions)
      ? actions.find((a) => a?.name === 'ReadAction')?.target
      : actions.target;
    if (Array.isArray(target)) {
      return target
        .map((t) => (t as { url?: string })?.url)
        .filter((u): u is string => !!u);
    }
    return [];
  }
  if (Array.isArray(sameAs)) {
    return sameAs.filter((u): u is string => !!u);
  }
  return [];
}

/**
 * Pre-warms the shared ebook cache bucket (the same bucket ebook-cors reads
 * from) with every file referenced by an NFT class's metadata. Intended to be
 * called fire-and-forget when a book listing is created or its on-chain
 * metadata/file path is refreshed.
 */
export async function cacheBookFilesFromNFTClassMetadata(
  classId: string,
  metadata?: NFTClassData,
) {
  const targetURIs = Array.from(
    new Set(getTargetURIsFromNFTClassMetadata(metadata)),
  ).slice(0, MAX_CACHE_FILES_PER_CLASS);
  await Promise.all(
    targetURIs.map((targetURI) => cacheBookFile(classId, targetURI).catch((err) => {
      // Strip the query string before logging — it may carry a decryption ?key=.
      const safeURI = targetURI.split('?')[0];
      // eslint-disable-next-line no-console
      console.error(`Failed to cache book file for ${classId} (${safeURI}):`, err);
    })),
  );
}

export default cacheBookFilesFromNFTClassMetadata;
