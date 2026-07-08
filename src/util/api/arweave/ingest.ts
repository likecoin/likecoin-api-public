import axios from 'axios';
import crypto from 'crypto';
import { ARWEAVE_GATEWAY } from '../../../constant';
import { getEbookProtectedBucket, isEbookProtectedBucketEnabled } from '../../gcloudStorage';
import { markArweaveTxIngested } from './tx';

// Same gateway set as ebook-cors/book cache; the Irys gateway is the bundler
// we upload through, so it serves fresh uploads without propagation lag.
const ARWEAVE_GATEWAY_PREFIXES = [`${ARWEAVE_GATEWAY}/`, 'https://arweave.net/'];

const AES_GCM_IV_LENGTH = 12;
const AES_GCM_TAG_LENGTH = 16;
const DOWNLOAD_TIMEOUT_MS = 120000;

async function downloadArweaveData(
  arweaveId: string,
  fileSize?: number,
): Promise<{ data: Buffer; contentType: string }> {
  // Ciphertext is plaintext + 28 bytes; fileSize may be either, so pad 1MB.
  const maxContentLength = fileSize ? fileSize + (1024 * 1024) : 1024 * 1024 * 1024;
  let lastError: unknown;
  for (const prefix of ARWEAVE_GATEWAY_PREFIXES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await axios.get(`${prefix}${arweaveId}`, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxContentLength,
      });
      const contentTypeHeader = res.headers['content-type'];
      return {
        data: Buffer.from(res.data),
        contentType: typeof contentTypeHeader === 'string' && contentTypeHeader
          ? contentTypeHeader : 'application/octet-stream',
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Decrypt the client-side AES-256-GCM format produced by publish-3ook-com
// (arweavekit layout): 12-byte IV ‖ ciphertext ‖ 16-byte auth tag.
export function decryptContentBuffer(combined: Buffer, keyBase64: string): Buffer {
  if (combined.length < AES_GCM_IV_LENGTH + AES_GCM_TAG_LENGTH) {
    throw new Error('INVALID_ENCRYPTED_PAYLOAD');
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('INVALID_CONTENT_KEY');
  const iv = combined.subarray(0, AES_GCM_IV_LENGTH);
  const authTag = combined.subarray(combined.length - AES_GCM_TAG_LENGTH);
  const ciphertext = combined.subarray(AES_GCM_IV_LENGTH, combined.length - AES_GCM_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Ingest a protected upload into the private CMEK bucket (ADR 0001 Phase 3):
 * fetch ciphertext from Arweave, decrypt with the content key, verify the
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
  const { data, contentType } = await downloadArweaveData(arweaveId, fileSize);
  const plaintext = decryptContentBuffer(data, key);
  const computedSHA256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  if (fileSHA256 && fileSHA256.toLowerCase() !== computedSHA256) {
    throw new Error('PLAINTEXT_HASH_MISMATCH');
  }
  const contentBucketPath = txHash;
  await getEbookProtectedBucket().file(contentBucketPath).save(plaintext, {
    contentType,
    resumable: false,
    metadata: {
      metadata: {
        arweaveId,
        ...(ipfsHash ? { ipfsHash } : {}),
        fileSHA256: computedSHA256,
      },
    },
  });
  await markArweaveTxIngested(txHash, {
    contentBucketPath,
    // Only backfill the doc hash when the client supplied none; a client
    // anchor was already stored at register and verified above.
    ...(fileSHA256 ? {} : { fileSHA256: computedSHA256 }),
  });
  return { contentBucketPath, fileSHA256: computedSHA256 };
}
