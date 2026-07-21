import { Storage } from '@google-cloud/storage';
import type { Bucket } from '@google-cloud/storage';
import { CACHE_BUCKET } from '../constant';
import { EBOOK_PROTECTED_BUCKET } from '../../config/config';

import serviceAccount from '../../config/serviceAccountKey.json';

export const storage = new Storage({ credentials: serviceAccount });
export const bookCacheBucket = storage.bucket(CACHE_BUCKET);

export function isEbookProtectedBucketEnabled(): boolean {
  return !!EBOOK_PROTECTED_BUCKET;
}

// gs:// URI of an ingested protected file, for trusted readers (ebook-cors)
// to fetch plaintext directly; '' when not ingested or bucket unconfigured.
export function getProtectedContentUri(contentBucketPath?: string): string {
  if (!isEbookProtectedBucketEnabled() || !contentBucketPath) return '';
  return `gs://${EBOOK_PROTECTED_BUCKET}/${contentBucketPath}`;
}

// Lazy accessor — storage.bucket('') throws, and dev/test runs without the
// protected bucket configured must still import this module.
let ebookProtectedBucket: Bucket | undefined;
export function getEbookProtectedBucket(): Bucket {
  if (!isEbookProtectedBucketEnabled()) throw new Error('EBOOK_PROTECTED_BUCKET_NOT_CONFIGURED');
  if (!ebookProtectedBucket) {
    ebookProtectedBucket = storage.bucket(EBOOK_PROTECTED_BUCKET);
  }
  return ebookProtectedBucket;
}

// TTL only covers the resumable-session initiation POST; the session URI GCS
// hands back stays valid on its own (~1 week) for the actual byte PUTs.
const PROTECTED_UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

// v4 signed URL letting the publisher browser start a resumable upload of one
// specific object with a pinned content type. Single-path scope: the URL can
// only ever create/replace `objectPath`, nothing else in the bucket.
export async function getProtectedUploadSignedUrl(
  objectPath: string,
  contentType: string,
): Promise<string> {
  const [url] = await getEbookProtectedBucket().file(objectPath).getSignedUrl({
    version: 'v4',
    action: 'resumable',
    expires: Date.now() + PROTECTED_UPLOAD_URL_TTL_MS,
    contentType,
  });
  return url;
}

export default storage;
