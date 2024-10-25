import uuidv4 from 'uuid/v4';
import { FieldValue, iscnArweaveTxCollection } from '../../firebase';

export async function createNewArweaveTx(txHash, { ipfsHash, fileSize }) {
  const token = uuidv4();
  await iscnArweaveTxCollection.doc(txHash).create({
    token,
    ipfsHash,
    fileSize,
    status: 'pending',
    timestamp: FieldValue.serverTimestamp(),
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
  return token;
}

export async function getArweaveTxInfo(txHash) {
  const doc = await iscnArweaveTxCollection.doc(txHash).get();
  return doc.data();
}

export async function updateArweaveTxStatus(txHash, {
  arweaveId,
  ownerWallet,
  isRequireAuth = false,
}) {
  await iscnArweaveTxCollection.doc(txHash).update({
    status: 'complete',
    arweaveId,
    isRequireAuth,
    ownerWallet,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}
