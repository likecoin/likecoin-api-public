import { db, likeNFTCollection } from '../../firebase';
import { ValidationError } from '../../ValidationError';
import { getISCNPrefixDocName } from '.';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../../config/config';

export async function updateSellNFTInfo(iscnPrefix, {
  classId,
  nftId,
  price,
  sellerWallet,
  txTimestamp,
}) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const iscnRef = likeNFTCollection.doc(iscnPrefixDocName);
  const classRef = iscnRef.collection('class').doc(classId);
  const nftRef = classRef.collection('nft').doc(nftId);
  await db.runTransaction(async (t) => {
    const nftDoc = await t.get(nftRef);
    if (!nftDoc.exists) throw new ValidationError('NFT_NOT_FOUND');
    const { lastUpdateTimestamp: dbTimestamp = 0, isProcessing } = nftDoc.data();
    if (txTimestamp <= dbTimestamp) throw new ValidationError('OUTDATED_TRANSFER_DATA');
    if (isProcessing) throw new ValidationError('NFT_PROCESSING');
    t.update(nftRef, {
      price,
      isSold: false,
      isProcessing: false,
      classId,
      sellerWallet,
      ownerWallet: LIKER_NFT_TARGET_ADDRESS,
      lastUpdateTimestamp: txTimestamp,
    });
  });
}

export default updateSellNFTInfo;
