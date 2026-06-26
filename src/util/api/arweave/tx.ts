import uuidv4 from 'uuid/v4';
import { FieldValue, iscnArweaveTxCollection } from '../../firebase';
import { wrapKey, unwrapKey } from '../../kms';
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
}: {
  arweaveId: string;
  ownerWallet: string;
  key?: string;
  isRequireAuth?: boolean;
}): Promise<string> {
  const accessToken = uuidv4();
  // Wrap the content key at rest. AAD = txHash binds it to this doc.
  // Empty key (DRM-free) is left unset so existing `if (key)` guards hold.
  const keyFields = key
    ? { encryptedKey: await wrapKey(key, txHash) }
    : {};
  await iscnArweaveTxCollection.doc(txHash).update({
    status: 'complete',
    arweaveId,
    isRequireAuth,
    ownerWallet,
    ...keyFields,
    accessToken,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return accessToken;
}

// Dual-read content-key resolver. New docs carry `encryptedKey` (KMS-wrapped,
// AAD = txHash); legacy docs carry plaintext `key`. txHash is the doc ID, not a
// stored field, so callers must pass it explicitly for AAD to bind correctly.
export async function resolveArweaveTxKey(
  tx: ArweaveTxData,
  txHash: string,
): Promise<string> {
  if (tx.encryptedKey) return unwrapKey(tx.encryptedKey, txHash);
  return tx.key || '';
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
