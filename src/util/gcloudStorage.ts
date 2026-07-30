import { Storage } from '@google-cloud/storage';
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

export default storage;
