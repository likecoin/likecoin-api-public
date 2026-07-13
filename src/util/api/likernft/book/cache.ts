import axios, { AxiosError } from 'axios';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { File } from '@google-cloud/storage';

import { ARWEAVE_GATEWAY, API_HOSTNAME } from '../../../../constant';
import { bookCacheBucket } from '../../../gcloudStorage';
import { getArweaveTxInfo, resolveArweaveTxKey } from '../../arweave/tx';
import type { NFTClassData } from './index';

// Mirrors the gateway lists in likecoin-cloud-functions/ebook-cors/nft/http.js.
// The resolved URLs we cache always live on these gateways, so their cache time
// is the permanent one (matching ebook-cors getUrlCacheTime()).
const PERMANENT_CACHE_TIME_IN_S = 31536000;

const LIKECOIN_API_LINK_PREFIX = `https://${API_HOSTNAME}/arweave/v2/link/`;

// Arweave / IPFS gateway fallbacks, same ordering as ebook-cors.
const ARWEAVE_GATEWAYS = ['https://arweave.net/', 'https://gateway.irys.xyz/'];
const IPFS_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://w3s.link/ipfs/', 'https://gateway.irys.xyz/ipfs/'];

// A real book class points at a handful of files (e.g. epub + pdf). Cap the
// fan-out so malformed/abusive metadata can't spawn an unbounded number of
// concurrent downloads — pre-warming is best-effort and ebook-cors still
// serves any uncached file on demand.
const MAX_CACHE_FILES_PER_CLASS = 10;

// Ceiling on a single cached file; axios defaults maxContentLength to unlimited,
// so without this a gateway could stream any amount into the bucket.
const MAX_CACHE_FILE_BYTES = 1024 * 1024 * 1024;

function getCacheFilePath(classId: string, url: string) {
  // Must match ebook-cors nft/cache.js getCacheFilePath() exactly.
  return `${classId}/${encodeURIComponent(url)}`;
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
 * (getArweaveTxInfo) instead of an HTTP round-trip — it yields the same
 * `${ARWEAVE_GATEWAY}/${arweaveId}` (+ ?key=) link the endpoint returns.
 */
async function resolveBookFileCacheURL(
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
    const link = new URL(`${ARWEAVE_GATEWAY}/${tx.arweaveId}`);
    const key = await resolveArweaveTxKey(tx, txHash);
    if (key) link.searchParams.set('key', key);
    parsedURL = link;
  }

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

async function fetchStreamWithFallback(url: string, fallbackURLs: string[]) {
  try {
    return await axios.get<Readable>(url, {
      responseType: 'stream',
      timeout: 60000,
      maxContentLength: MAX_CACHE_FILE_BYTES,
      headers: { accept: 'application/pdf, application/epub+zip' },
    });
  } catch (err) {
    // A stream response body is left open on a non-2xx; drop it or the socket
    // is held until the gateway times out.
    (err as AxiosError<Readable>).response?.data?.destroy?.();
    if (fallbackURLs.length > 0) {
      return fetchStreamWithFallback(fallbackURLs[0], fallbackURLs.slice(1));
    }
    throw err;
  }
}

async function cacheBookFile(classId: string, targetURI: string) {
  const url = await resolveBookFileCacheURL(targetURI);
  if (!url) return;
  const fileRef = bookCacheBucket.file(getCacheFilePath(classId, url));
  if (await isAlreadyCached(fileRef)) return;

  const { data, headers } = await fetchStreamWithFallback(url, getFallbackURLs(url));
  const contentType = String(headers['content-type'] || '');
  try {
    assertSupportedContentType(contentType);
  } catch (err) {
    // Nothing will consume the response, so release the socket rather than
    // leaving it open until the gateway or the timeout closes it.
    data.destroy();
    throw err;
  }

  // Stream straight to GCS (the raw, still-encrypted bytes — ebook-cors caches
  // before decryption) so large ebooks never get fully buffered in memory.
  await pipeline(data, fileRef.createWriteStream({
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
