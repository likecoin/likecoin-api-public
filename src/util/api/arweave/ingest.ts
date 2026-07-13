import crypto from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ARWEAVE_GATEWAYS } from '../../../constant';
import { fetchStreamWithFallback } from '../../fetchStream';
import { getEbookProtectedBucket, isEbookProtectedBucketEnabled } from '../../gcloudStorage';
import { ARWEAVE_MAX_SIZE_V2 } from './index';
import { markArweaveTxIngested } from './tx';

const AES_GCM_IV_LENGTH = 12;
const AES_GCM_TAG_LENGTH = 16;
const DOWNLOAD_TIMEOUT_MS = 120000;
const STAGING_PREFIX = 'staging/';

/**
 * Decrypt the client-side AES-256-GCM format produced by publish-3ook-com
 * (arweavekit layout): 12-byte IV ‖ ciphertext ‖ 16-byte auth tag.
 *
 * The tag only arrives with the final 16 bytes, so this withholds a rolling
 * tail and authenticates in flush(). Plaintext is therefore emitted before it
 * is known to be authentic — callers must stage the output and only promote it
 * once the stream completes without error.
 */
export function createGcmDecryptTransform(keyBase64: string): Transform {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('INVALID_CONTENT_KEY');
  let decipher: crypto.DecipherGCM | undefined;
  // Holds the IV until the decipher exists, then the withheld tail candidate.
  let pending = Buffer.alloc(0);
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        let body = chunk as Buffer;
        if (!decipher) {
          body = Buffer.concat([pending, body]);
          pending = Buffer.alloc(0);
          if (body.length < AES_GCM_IV_LENGTH) {
            pending = body;
            callback();
            return;
          }
          const iv = body.subarray(0, AES_GCM_IV_LENGTH);
          decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
          body = body.subarray(AES_GCM_IV_LENGTH);
        } else if (pending.length) {
          // A chunk at least as long as the tag proves the withheld tail is not
          // the tag, so release it instead of concatenating it onto every chunk.
          if (body.length >= AES_GCM_TAG_LENGTH) this.push(decipher.update(pending));
          else body = Buffer.concat([pending, body]);
          pending = Buffer.alloc(0);
        }
        if (body.length <= AES_GCM_TAG_LENGTH) {
          // Copy, so the tail stops pinning the whole chunk allocation.
          pending = Buffer.from(body);
          callback();
          return;
        }
        const cut = body.length - AES_GCM_TAG_LENGTH;
        pending = Buffer.from(body.subarray(cut));
        callback(null, decipher.update(body.subarray(0, cut)));
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        if (!decipher || pending.length !== AES_GCM_TAG_LENGTH) {
          throw new Error('INVALID_ENCRYPTED_PAYLOAD');
        }
        decipher.setAuthTag(pending);
        callback(null, decipher.final());
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

// Hash the plaintext as it streams past, leaving the bytes untouched. Only read
// the digest once the pipeline has resolved.
function createHashTransform(hash: crypto.Hash): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

/**
 * Ingest a protected upload into the private CMEK bucket (ADR 0001 Phase 3),
 * storing plaintext-at-rest under a key-free path. No-op when the bucket is
 * unconfigured. Gateway fallback only covers opening the stream; once bytes are
 * flowing into GCS a mid-stream failure aborts rather than restarting.
 */
export async function ingestProtectedContent(txHash: string, {
  arweaveId,
  key,
  ipfsHash,
  fileSize,
  fileSHA256,
}: {
  arweaveId: string;
  key: string;
  ipfsHash?: string;
  fileSize?: number;
  fileSHA256?: string;
}): Promise<{ contentBucketPath: string; fileSHA256: string } | null> {
  if (!isEbookProtectedBucketEnabled() || !arweaveId || !key) return null;
  // txHash is the object name; callers only ever mint an on-chain hash or a
  // sponsored-<uuid>, so reject anything that could collide with STAGING_PREFIX.
  if (!/^[A-Za-z0-9_-]+$/.test(txHash)) throw new Error('INVALID_TX_HASH');
  // Ciphertext is plaintext + 28 bytes; fileSize may be either, so pad 1MB.
  const maxContentLength = (fileSize || ARWEAVE_MAX_SIZE_V2) + (1024 * 1024);
  // Throws INVALID_CONTENT_KEY before any network or storage work happens.
  const decrypt = createGcmDecryptTransform(key);
  const hash = crypto.createHash('sha256');
  const bucket = getEbookProtectedBucket();
  const stagingFile = bucket.file(`${STAGING_PREFIX}${txHash}`);
  const { stream, contentType: fetchedContentType } = await fetchStreamWithFallback(
    ARWEAVE_GATEWAYS.map((gateway) => `${gateway}${arweaveId}`),
    { timeout: DOWNLOAD_TIMEOUT_MS, maxContentLength },
  );
  const contentType = fetchedContentType || 'application/octet-stream';
  try {
    await pipeline(
      stream,
      decrypt,
      createHashTransform(hash),
      stagingFile.createWriteStream({ resumable: false, metadata: { contentType } }),
    );
    const computedSHA256 = hash.digest('hex');
    if (fileSHA256 && fileSHA256.toLowerCase() !== computedSHA256) {
      throw new Error('PLAINTEXT_HASH_MISMATCH');
    }
    const contentBucketPath = txHash;
    await stagingFile.copy(bucket.file(contentBucketPath), {
      contentType,
      metadata: {
        arweaveId,
        ...(ipfsHash ? { ipfsHash } : {}),
        fileSHA256: computedSHA256,
      },
    });
    await markArweaveTxIngested(txHash, {
      contentBucketPath,
      contentType,
      // Only backfill the doc hash when the client supplied none; a client
      // anchor was already stored at register and verified above.
      ...(fileSHA256 ? {} : { fileSHA256: computedSHA256 }),
    });
    return { contentBucketPath, fileSHA256: computedSHA256 };
  } finally {
    // pipeline() destroys the source on its own error paths, but not if
    // createWriteStream() throws before it ever runs.
    if (!stream.destroyed) stream.destroy();
    // Swallow: a failed cleanup would mask the real error, and the bucket's
    // staging/ lifecycle rule sweeps whatever is left behind.
    await stagingFile.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}
