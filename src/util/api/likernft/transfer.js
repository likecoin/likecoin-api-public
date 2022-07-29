import { db, likeNFTCollection } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from '.';

export async function processNFTTransfer({
  newOwnerAddress,
  iscnId,
  classId,
  nftId,
  txTimestamp,
}) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const iscnRef = likeNFTCollection.doc(iscnPrefix);
  const classRef = iscnRef.collection('class').doc(classId);
  const nftRef = classRef.collection('nft').doc(nftId);
  await db.runTransaction(async (t) => {
    const nftDoc = await t.get(nftRef);
    if (!nftDoc.exists) throw new ValidationError('NFT_NOT_FOUND');
    const { timestamp: dbTimestamp } = nftDoc.data();
    if (txTimestamp <= dbTimestamp) throw new ValidationError('OUTDATED_TRANSFER_DATA');
    t.update(nftRef, {
      ownerWallet: newOwnerAddress,
      timestamp: txTimestamp,
    });
  });
}

export function a() { }
