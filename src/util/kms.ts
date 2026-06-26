import { KeyManagementServiceClient } from '@google-cloud/kms';
import { ARWEAVE_KEY_KMS_NAME } from '../../config/config';

import serviceAccount from '../../config/serviceAccountKey.json';

// Lazily construct the client so dev/test runs without KMS configured never
// build a KMS client or open a network connection. (The service-account JSON
// is still loaded at module import — only the client/network is deferred.)
let client: KeyManagementServiceClient | undefined;
function getClient(): KeyManagementServiceClient {
  if (!client) {
    client = new KeyManagementServiceClient({ credentials: serviceAccount });
  }
  return client;
}

// Whether KMS wrapping is active. When false, wrapKey/unwrapKey passthrough
// and callers should store the content key in the legacy plaintext field.
export function isKMSEnabled(): boolean {
  return !!ARWEAVE_KEY_KMS_NAME;
}

// Wrap a plaintext content key with Cloud KMS, returning base64 ciphertext
// (or the plaintext unchanged when KMS is unconfigured — passthrough).
// `aad` (the txHash) binds the ciphertext to its document — a wrapped key
// copied to another doc fails to decrypt.
export async function wrapKey(plaintext: string, aad: string): Promise<string> {
  if (!ARWEAVE_KEY_KMS_NAME) return plaintext;
  const [result] = await getClient().encrypt({
    name: ARWEAVE_KEY_KMS_NAME,
    plaintext: Buffer.from(plaintext, 'utf8'),
    additionalAuthenticatedData: Buffer.from(aad, 'utf8'),
  });
  if (!result.ciphertext) throw new Error('KMS_ENCRYPT_EMPTY_CIPHERTEXT');
  return Buffer.from(result.ciphertext).toString('base64');
}

// Unwrap a base64 ciphertext produced by wrapKey. The same `aad` must be
// supplied or KMS rejects the decrypt. Passthrough when KMS is unconfigured.
export async function unwrapKey(ciphertextB64: string, aad: string): Promise<string> {
  if (!ARWEAVE_KEY_KMS_NAME) return ciphertextB64;
  const [result] = await getClient().decrypt({
    name: ARWEAVE_KEY_KMS_NAME,
    ciphertext: Buffer.from(ciphertextB64, 'base64'),
    additionalAuthenticatedData: Buffer.from(aad, 'utf8'),
  });
  if (!result.plaintext) throw new Error('KMS_DECRYPT_EMPTY_PLAINTEXT');
  return Buffer.from(result.plaintext).toString('utf8');
}
