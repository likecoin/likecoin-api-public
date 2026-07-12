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
  if (!EBOOK_PROTECTED_BUCKET) throw new Error('EBOOK_PROTECTED_BUCKET_NOT_CONFIGURED');
  if (!ebookProtectedBucket) {
    ebookProtectedBucket = storage.bucket(EBOOK_PROTECTED_BUCKET);
  }
  return ebookProtectedBucket;
}

export default storage;
