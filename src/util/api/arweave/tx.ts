import uuidv4 from 'uuid/v4';
import { FieldValue, iscnArweaveTxCollection } from '../../firebase';
import type { ArweaveTxData } from '../../../types/transaction';

export async function createNewArweaveTx(txHash: string, {
  ipfsHash,
  fileSize,
  ownerWallet,
}: {
  ipfsHash: string;
  fileSize: number;
  ownerWallet: string;
}): Promise<string> {
  const token = uuidv4();
  await iscnArweaveTxCollection.doc(txHash).create({
    token,
    ipfsHash,
    fileSize,
    ownerWallet,
    status: 'pending',
    timestamp: FieldValue.serverTimestamp(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
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
}): Promise<void> {
  await iscnArweaveTxCollection.doc(txHash).update({
    status: 'complete',
    arweaveId,
    isRequireAuth,
    ownerWallet,
    key,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}
