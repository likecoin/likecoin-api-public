import crypto from 'crypto';
import { Transform, pipeline as pipelineCallback } from 'stream';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ARWEAVE_GATEWAYS } from '../../../constant';
import { fetchStreamWithFallback } from '../../fetchStream';
import {
  getEbookTierBucket,
  getTierUploadSignedUrl,
  isEbookTierBucketEnabled,
} from '../../gcloudStorage';
import type { ContentTier } from '../../gcloudStorage';
import { ValidationError } from '../../ValidationError';
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
export function createHashTransform(hash: crypto.Hash): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

// txHash doubles as the object name; callers only ever mint an on-chain hash,
// sponsored-<uuid> or gcs-<uuid>, so reject anything that could traverse paths
// or collide with the staging prefix. Every staging-path composition goes
// through here so all call sites share the same defense.
function stagedObjectPath(txHash: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(txHash)) throw new ValidationError('INVALID_TX_HASH');
  return `${STAGING_PREFIX}${txHash}`;
}

// Arweave/Irys ids are Base64URL of a SHA-256 digest: exactly 43 chars from
// [A-Za-z0-9_-]. The length bound is what separates a real id from a path
// fragment using the same alphabet, and the id becomes an object name.
// Mirrors ebook-cors nft/open.js, which derives the same path on the read side.
export function assertValidArweaveId(arweaveId?: string): string {
  if (!arweaveId || !/^[A-Za-z0-9_-]{43}$/.test(arweaveId)) throw new ValidationError('INVALID_ARWEAVE_ID');
  return arweaveId;
}

// `generation` pins reads to one version of the object. The open tier signs one
// pass and uploads another, and the caller still holds a live resumable URL for
// the same path — without pinning, an overwrite between passes would have us sign
// one payload and upload a different one under the signed id.
function getStagedFile(txHash: string, tier: ContentTier, generation?: string) {
  return getEbookTierBucket(tier).file(
    stagedObjectPath(txHash),
    generation ? { generation } : undefined,
  );
}

function toStagedFileError(error: unknown): unknown {
  if ((error as { code?: number }).code === 404) {
    return new ValidationError('STAGED_FILE_NOT_FOUND', 404);
  }
  return error;
}

// Staging-layout knowledge stays in this module: routes mint the id, this
// composes the object path the browser's resumable upload writes to. Each tier
// stages in its own bucket, so both stay homogeneous for the Phase 4 sweep.
export function getStagedUploadSignedUrl(
  txHash: string,
  tier: ContentTier,
  contentType: string,
): Promise<string> {
  return getTierUploadSignedUrl(tier, stagedObjectPath(txHash), contentType);
}

// Size check alone, plus the generation to pin later reads to. Runs before any
// byte transfer, so a client size bug costs one round-trip rather than a full read.
export async function verifyStagedObjectSize(
  txHash: string,
  tier: ContentTier,
  fileSize?: number,
): Promise<{ stagedSize: number; generation: string }> {
  let metadata: { size?: string | number; generation?: string | number };
  try {
    ([metadata] = await getStagedFile(txHash, tier).getMetadata());
  } catch (error) {
    throw toStagedFileError(error);
  }
  const stagedSize = Number(metadata.size);
  if (fileSize && stagedSize !== fileSize) {
    throw new ValidationError('FILE_SIZE_MISMATCH');
  }
  return { stagedSize, generation: String(metadata.generation) };
}

// A fresh read of the staged object. Signing an ANS-104 DataItem needs two passes
// over the payload (one to hash, one to send), and each must start from zero — so
// callers take one stream per pass rather than sharing one.
export function getStagedReadStream(
  txHash: string,
  tier: ContentTier,
  generation?: string,
): Readable {
  return getStagedFile(txHash, tier, generation).createReadStream();
}

// Read that also hashes, for the signing pass. Built with pipeline() rather than
// pipe() because pipe() forwards no errors: a failed GCS read would reach a
// consumer that never sees `end` or `error`, hanging it forever — and the raw
// source, having no listener of its own, would take the process down first.
// Teardown is transitive too: destroying the returned stream destroys the GCS
// read behind it, which is how callers abort a read they no longer need.
export function getStagedHashingReadStream(
  txHash: string,
  tier: ContentTier,
  hash: crypto.Hash,
  generation?: string,
): Readable {
  const hashed = createHashTransform(hash);
  // The callback only stops pipeline() from throwing; the error surfaces on
  // `hashed`, which is what the caller is consuming.
  pipelineCallback(getStagedReadStream(txHash, tier, generation), hashed, () => {});
  return hashed;
}

/**
 * Verify a client-staged object (GCS-direct flow) against the size and plaintext
 * hash declared at upload_init. The signed URL alone bounds neither, so both
 * checks run here before the object can be promoted. Mismatches leave staging in
 * place — the age-1 lifecycle rule sweeps it. Hashed as it streams, so memory
 * stays flat at any file size.
 *
 * The generation comes back out so the caller can pin the promote to the version
 * that was verified: the caller still holds a live resumable URL for the same
 * path, and an overwrite landing between here and the copy would promote bytes
 * this never saw under the hash it just checked.
 */
export async function verifyStagedObject(txHash: string, tier: ContentTier, {
  fileSize,
  fileSHA256,
}: {
  fileSize?: number;
  fileSHA256?: string;
}): Promise<{ computedSHA256: string; generation: string }> {
  const { generation } = await verifyStagedObjectSize(txHash, tier, fileSize);
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of getStagedReadStream(txHash, tier, generation)) hash.update(chunk);
  } catch (error) {
    throw toStagedFileError(error);
  }
  const computedSHA256 = hash.digest('hex');
  if (fileSHA256 && fileSHA256.toLowerCase() !== computedSHA256) {
    throw new ValidationError('PLAINTEXT_HASH_MISMATCH');
  }
  return { computedSHA256, generation };
}

// Promote a fully-verified staged object to its final key-free path, stamping
// provenance metadata. Never deletes staging — callers own that cleanup, since
// the legacy ingest sweeps it in a finally while finalize deletes on success.
//
// The open tier is keyed by its arweaveId (itself a content hash) so readers
// derive the path from an ar:// target with no lookup; the protected tier by
// txHash.
export async function promoteStagedObject(txHash: string, tier: ContentTier, {
  contentType,
  fileSHA256,
  arweaveId,
  ipfsHash,
  generation,
}: {
  contentType: string;
  fileSHA256: string;
  arweaveId?: string;
  ipfsHash?: string;
  generation?: string;
}): Promise<string> {
  const bucket = getEbookTierBucket(tier);
  const contentBucketPath = tier === 'open' ? assertValidArweaveId(arweaveId) : txHash;
  await getStagedFile(txHash, tier, generation).copy(bucket.file(contentBucketPath), {
    contentType,
    metadata: {
      ...(arweaveId ? { arweaveId } : {}),
      ...(ipfsHash ? { ipfsHash } : {}),
      fileSHA256,
    },
  });
  return contentBucketPath;
}

// Best-effort staging cleanup after a successful promote; a failure is
// swallowed because the staging lifecycle rule sweeps leftovers anyway.
export async function deleteStagedObject(
  txHash: string,
  tier: ContentTier,
): Promise<void> {
  await getStagedFile(txHash, tier)
    .delete({ ignoreNotFound: true })
    .catch(() => undefined);
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
  if (!isEbookTierBucketEnabled('protected') || !arweaveId || !key) return null;
  // Ciphertext is plaintext + 28 bytes; fileSize may be either, so pad 1MB.
  const maxContentLength = (fileSize || ARWEAVE_MAX_SIZE_V2) + (1024 * 1024);
  // Throws INVALID_CONTENT_KEY before any network or storage work happens.
  const decrypt = createGcmDecryptTransform(key);
  const hash = crypto.createHash('sha256');
  const stagingFile = getStagedFile(txHash, 'protected');
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
    const contentBucketPath = await promoteStagedObject(txHash, 'protected', {
      contentType,
      fileSHA256: computedSHA256,
      arweaveId,
      ipfsHash,
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
