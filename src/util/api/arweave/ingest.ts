import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { ARWEAVE_GATEWAY } from '../../../constant';
import { getEbookProtectedBucket, isEbookProtectedBucketEnabled } from '../../gcloudStorage';
import { ARWEAVE_MAX_SIZE_V2 } from './index';
import { markArweaveTxIngested } from './tx';

// Same gateway set as ebook-cors/book cache; the Irys gateway is the bundler
// we upload through, so it serves fresh uploads without propagation lag.
const ARWEAVE_GATEWAY_PREFIXES = [`${ARWEAVE_GATEWAY}/`, 'https://arweave.net/'];

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
          pending = Buffer.concat([pending, body]);
          if (pending.length < AES_GCM_IV_LENGTH) {
            callback();
            return;
          }
          const iv = pending.subarray(0, AES_GCM_IV_LENGTH);
          decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
          body = pending.subarray(AES_GCM_IV_LENGTH);
          pending = Buffer.alloc(0);
        }
        // A chunk at least as long as the tag proves the withheld tail is not
        // the tag, so release it and withhold this chunk's last 16 bytes — the
        // steady state, and the reason this doesn't concat per chunk.
        if (body.length >= AES_GCM_TAG_LENGTH) {
          if (pending.length) this.push(decipher.update(pending));
          const cut = body.length - AES_GCM_TAG_LENGTH;
          // Copy, so the tail stops pinning the whole chunk allocation.
          pending = Buffer.from(body.subarray(cut));
          if (!cut) {
            callback();
            return;
          }
          callback(null, decipher.update(body.subarray(0, cut)));
          return;
        }
        const buffered = Buffer.concat([pending, body]);
        if (buffered.length <= AES_GCM_TAG_LENGTH) {
          pending = buffered;
          callback();
          return;
        }
        const cut = buffered.length - AES_GCM_TAG_LENGTH;
        pending = Buffer.from(buffered.subarray(cut));
        callback(null, decipher.update(buffered.subarray(0, cut)));
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

// Gateway fallback only covers the request itself; once bytes are flowing into
// GCS a mid-stream failure aborts the ingest rather than restarting the upload.
async function openArweaveStream(
  arweaveId: string,
  maxContentLength: number,
): Promise<{ stream: Readable; contentType: string }> {
  let lastError: unknown;
  for (const prefix of ARWEAVE_GATEWAY_PREFIXES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await axios.get<Readable>(`${prefix}${arweaveId}`, {
        responseType: 'stream',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxContentLength,
      });
      const contentTypeHeader = res.headers['content-type'];
      return {
        stream: res.data,
        contentType: typeof contentTypeHeader === 'string' && contentTypeHeader
          ? contentTypeHeader : 'application/octet-stream',
      };
    } catch (error) {
      // A stream response body is left open on a non-2xx; drop it or the socket
      // is held until the gateway times out.
      (error as AxiosError<Readable>).response?.data?.destroy?.();
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Ingest a protected upload into the private CMEK bucket (ADR 0001 Phase 3):
 * stream the ciphertext from Arweave, decrypt with the content key, verify the
 * plaintext SHA-256 against the client-supplied provenance anchor when one
 * exists (record the computed hash otherwise), and store plaintext-at-rest
 * under a key-free path. No-op when the bucket is not configured.
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
  // Ciphertext is plaintext + 28 bytes; fileSize may be either, so pad 1MB.
  const maxContentLength = (fileSize || ARWEAVE_MAX_SIZE_V2) + (1024 * 1024);
  // Throws INVALID_CONTENT_KEY before any network or storage work happens.
  const decrypt = createGcmDecryptTransform(key);
  const hash = crypto.createHash('sha256');
  const bucket = getEbookProtectedBucket();
  const stagingFile = bucket.file(`${STAGING_PREFIX}${txHash}`);
  const { stream, contentType } = await openArweaveStream(arweaveId, maxContentLength);
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
    // Swallow: a failed cleanup would mask the real error, and the bucket's
    // staging/ lifecycle rule sweeps whatever is left behind.
    await stagingFile.delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}
