import uuidv4 from 'uuid/v4';
import { FieldValue, iscnArweaveTxCollection } from '../../firebase';

export async function createNewArweaveTx(txHash, { ipfsHash, fileSize }) {
  const token = uuidv4();
  await iscnArweaveTxCollection.create(txHash, {
    token,
    ipfsHash,
    fileSize,
    status: 'pending',
    timestamp: FieldValue.serverTimestamp,
    lastUpdateTimestamp: FieldValue.serverTimestamp,
  });
  return token;
}

export async function getArweaveTxInfo(txHash) {
  const doc = await iscnArweaveTxCollection.get(txHash);
  return doc.data();
}

export async function updateArweaveTxStatus(txHash, {
  arweaveId,
  ownerWallet,
  isRequireAuth = false,
}) {
  await iscnArweaveTxCollection.update(txHash, {
    status: 'complete',
    arweaveId,
    isRequireAuth,
    ownerWallet,
    lastUpdateTimestamp: FieldValue.serverTimestamp,
  });
}
