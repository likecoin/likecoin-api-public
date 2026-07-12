import uuidv4 from 'uuid/v4';
import { FieldValue, iscnArweaveTxCollection } from '../../firebase';
import { wrapKey, unwrapKey, isKMSEnabled } from '../../kms';
import type { ArweaveTxData } from '../../../types/transaction';

export async function createNewArweaveTx(docId: string, {
  ipfsHash,
  fileSize,
  ownerWallet,
  isSponsored,
  sponsoredETH,
}: {
  ipfsHash: string;
  fileSize: number;
  ownerWallet: string;
  isSponsored?: boolean;
  sponsoredETH?: string;
}): Promise<string> {
  const token = uuidv4();
  const data: ArweaveTxData = {
    token,
    ipfsHash,
    fileSize,
    ownerWallet,
    status: 'pending',
    timestamp: FieldValue.serverTimestamp(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
    ...(isSponsored ? { isSponsored: true, sponsoredETH } : {}),
  };
  await iscnArweaveTxCollection.doc(docId).create(data);
  return token;
}

export async function getArweaveTxInfo(txHash: string): Promise<ArweaveTxData | undefined> {
  const doc = await iscnArweaveTxCollection.doc(txHash).get();
  return doc.data();
}

export async function updateArweaveTxStatus(txHash: string, {
  arweaveId,
  ownerWallet,
  key = '',
  isRequireAuth = false,
  fileSHA256 = '',
}: {
  arweaveId: string;
  ownerWallet: string;
  key?: string;
  isRequireAuth?: boolean;
  fileSHA256?: string;
}): Promise<string> {
  const accessToken = uuidv4();
  // Under KMS store wrapped ciphertext in `encryptedKey` (AAD = txHash); in
  // passthrough store plaintext in legacy `key` so enabling KMS later never
  // decrypts non-ciphertext. Delete the opposite field to leave no plaintext.
  let keyFields = {};
  if (key) {
    keyFields = isKMSEnabled()
      ? { encryptedKey: await wrapKey(key, txHash), key: FieldValue.delete() }
      : { key, encryptedKey: FieldValue.delete() };
  }
  await iscnArweaveTxCollection.doc(txHash).update({
    status: 'complete',
    arweaveId,
    isRequireAuth,
    ownerWallet,
    ...keyFields,
    ...(fileSHA256 ? { fileSHA256: fileSHA256.toLowerCase() } : {}),
    accessToken,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return accessToken;
}

// Record the outcome of a protected-content ingest: where the plaintext lives
// in the private bucket, its MIME type (so readers can skip a GCS metadata
// round-trip), and the plaintext hash when it was computed server-side
// (i.e. the client never supplied a provenance anchor).
export async function markArweaveTxIngested(txHash: string, {
  contentBucketPath,
  contentType,
  fileSHA256,
}: {
  contentBucketPath: string;
  contentType: string;
  fileSHA256?: string;
}): Promise<void> {
  await iscnArweaveTxCollection.doc(txHash).update({
    contentBucketPath,
    contentType,
    ...(fileSHA256 ? { fileSHA256: fileSHA256.toLowerCase() } : {}),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

// Dual-read: KMS-wrapped `encryptedKey` (AAD = txHash) vs legacy plaintext `key`.
// Gate unwrap on isKMSEnabled() — a passthrough unwrapKey returns ciphertext
// verbatim, so a KMS-written doc read without KMS yields '' not leaked ciphertext.
export async function resolveArweaveTxKey(
  tx: ArweaveTxData,
  txHash: string,
): Promise<string> {
  if (tx.encryptedKey && isKMSEnabled()) return unwrapKey(tx.encryptedKey, txHash);
  return tx.key || '';
}

// Persist the funding top-up tx on the upload doc BEFORE notifying the Irys indexer,
// so a crash/5xx between send and notify still leaves a replayable record.
export async function setArweaveTxFundingSent(docId: string, {
  fundingTxHash,
  fundingETH,
}: {
  fundingTxHash: string;
  fundingETH: string;
}): Promise<void> {
  await iscnArweaveTxCollection.doc(docId).update({
    fundingTxHash,
    fundingETH,
    fundingStatus: 'sent',
    fundingTimestamp: FieldValue.serverTimestamp(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

export async function markArweaveTxFundingCredited(docId: string): Promise<void> {
  await iscnArweaveTxCollection.doc(docId).update({
    fundingStatus: 'credited',
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}

// Uploads whose funding was sent but never confirmed credited — the reconcile job
// re-notifies these (idempotent) newest-first.
export async function getPendingFundingArweaveTxs(
  limit = 100,
): Promise<Array<{ id: string; fundingTxHash: string }>> {
  const snapshot = await iscnArweaveTxCollection
    .where('fundingStatus', '==', 'sent')
    .orderBy('fundingTimestamp', 'desc')
    .limit(limit)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, fundingTxHash: doc.data()?.fundingTxHash }))
    .filter((d): d is { id: string; fundingTxHash: string } => !!d.fundingTxHash);
}

export async function rotateArweaveTxAccessToken(txHash: string): Promise<string> {
  const accessToken = uuidv4();
  await iscnArweaveTxCollection.doc(txHash).update({
    accessToken,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return accessToken;
}

export async function getArweaveTxAccessToken(txHash: string): Promise<string | undefined> {
  const doc = await iscnArweaveTxCollection.doc(txHash).get();
  const data = doc.data();
  return data?.accessToken;
}
