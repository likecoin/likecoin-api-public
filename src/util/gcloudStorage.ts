import { Storage } from '@google-cloud/storage';
import type { Readable } from 'stream';
import type { Bucket } from '@google-cloud/storage';
import { CACHE_BUCKET } from '../constant';
import { EBOOK_OPEN_BUCKET, EBOOK_PROTECTED_BUCKET } from '../../config/config';

import serviceAccount from '../../config/serviceAccountKey.json';

export const storage = new Storage({ credentials: serviceAccount });
export const bookCacheBucket = storage.bucket(CACHE_BUCKET);

// Which ebook store a record lives in. `protected` is the private CMEK bucket
// (ADR 0001 Phase 3); `open` is the unencrypted DRM-free mirror added by the
// Phase 3 amendment. Absent on a doc means `protected` — that tier shipped first.
export const CONTENT_TIERS = ['protected', 'open'] as const;
export type ContentTier = typeof CONTENT_TIERS[number];

function getTierBucketName(tier: ContentTier): string {
  return tier === 'open' ? EBOOK_OPEN_BUCKET : EBOOK_PROTECTED_BUCKET;
}

export function isEbookTierBucketEnabled(tier: ContentTier): boolean {
  return !!getTierBucketName(tier);
}

// gs:// URI of an ingested file, for trusted readers (ebook-cors) to fetch
// plaintext directly; '' when not ingested or the tier's bucket is unconfigured.
export function getTierContentUri(tier: ContentTier, contentBucketPath?: string): string {
  const bucketName = getTierBucketName(tier);
  if (!bucketName || !contentBucketPath) return '';
  return `gs://${bucketName}/${contentBucketPath}`;
}

// Lazy accessor — storage.bucket('') throws, and dev/test runs without these
// buckets configured must still import this module.
const tierBuckets = new Map<ContentTier, Bucket>();
export function getEbookTierBucket(tier: ContentTier): Bucket {
  const bucketName = getTierBucketName(tier);
  if (!bucketName) throw new Error(`EBOOK_${tier.toUpperCase()}_BUCKET_NOT_CONFIGURED`);
  let bucket = tierBuckets.get(tier);
  if (!bucket) {
    bucket = storage.bucket(bucketName);
    tierBuckets.set(tier, bucket);
  }
  return bucket;
}

// TTL only covers the resumable-session initiation POST; the session URI GCS
// hands back stays valid on its own (~1 week) for the actual byte PUTs.
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

// v4 signed URL letting the publisher browser start a resumable upload of one
// specific object with a pinned content type. Single-path scope: the URL can
// only ever create/replace `objectPath`, nothing else in the bucket.
export async function getTierUploadSignedUrl(
  tier: ContentTier,
  objectPath: string,
  contentType: string,
): Promise<string> {
  const [url] = await getEbookTierBucket(tier).file(objectPath).getSignedUrl({
    version: 'v4',
    action: 'resumable',
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType,
  });
  return url;
}

// Plaintext read of an ingested object, for an owner-authed passthrough. Mirrors
// getProtectedFileStream in likecoin-cloud-functions/ebook-cors/nft/protected.js.
// The metadata call is awaited first so it doubles as an existence and permission
// probe: an unreadable object throws before anything reaches the response.
export async function getTierFileStream(
  tier: ContentTier,
  objectPath: string,
): Promise<{ stream: Readable; contentType?: string; size?: number }> {
  const bucket = getEbookTierBucket(tier);
  const [metadata] = await bucket.file(objectPath).getMetadata();
  // A gzip-encoded object streams out decompressed while `size` counts the
  // stored bytes, so Content-Length would understate the body and silently
  // truncate the file. Ingestion stores plaintext, so this is drift.
  if (metadata.contentEncoding) throw new Error(`UNSUPPORTED_CONTENT_ENCODING: ${metadata.contentEncoding}`);
  const size = Number(metadata.size);
  return {
    // Pinned to the generation the metadata describes: a re-ingest between the two
    // calls would otherwise stream new bytes under the previous Content-Length.
    // Generation scopes the file ref — createReadStream has no such option.
    stream: bucket.file(objectPath, { generation: metadata.generation }).createReadStream(),
    contentType: metadata.contentType,
    ...(Number.isFinite(size) ? { size } : {}),
  };
}

export default storage;
