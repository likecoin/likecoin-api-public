import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/messages/parsing';
import { getISCNPrefixDocName } from '.';
import { db, likeNFTCollection } from '../../firebase';
import { getNFTQueryClient, getNFTISCNData } from '../../cosmos/nft';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../../config/config';
import { getNFTBatchInfo } from './purchase';
import {
  AVATAR_DEFAULT_PATH,
  APP_LIKE_CO_ISCN_VIEW_URL,
  LIKECOIN_DARK_GREEN_THEME_COLOR,
} from '../../../constant';

export async function parseNFTInformationFromSendTxHash(txHash, target = LIKER_NFT_TARGET_ADDRESS) {
  const client = await getNFTQueryClient();
  const q = await client.getStargateClient();
  const tx = await q.getTx(txHash);
  const parsed = parseTxInfoFromIndexedTx(tx);
  const messages = parsed.tx.body.messages
    .filter(m => m.typeUrl === '/cosmos.nft.v1beta1.MsgSend')
    .filter(m => m.value.receiver === target);
  if (!messages.length) return null;
  const nftIds = messages.map(m => m.value.id);
  return {
    fromWallet: messages[0].value.sender,
    total: messages.length,
    classId: messages[0].value.classId,
    nftIds,
  };
}

export async function writeMintedNFTInfo(iscnPrefix, classData, nfts) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnPrefix);
  const {
    owner: sellerWallet,
    data: iscnData,
  } = await getNFTISCNData(iscnPrefix);
  const url = iscnData.contentMetadata && iscnData.contentMetadata.url;
  const timestamp = Date.now();
  const {
    classId,
    name = '',
    description = '',
    totalCount,
    uri = '',
  } = classData;
  const currentBatch = 0;
  const { price, count } = getNFTBatchInfo(currentBatch);
  const iscnRef = likeNFTCollection.doc(iscnPrefixDocName);
  await Promise.all([
    iscnRef.create({
      classId,
      classes: [classId],
      totalCount,
      nftRemainingCount: nfts.length,
      currentPrice: price,
      currentBatch,
      batchRemainingCount: count,
      basePrice: price,
      soldCount: 0,
      classUri: uri,
      creatorWallet: sellerWallet,
      ownerWallet: sellerWallet,
      processingCount: 0,
      timestamp,
    }),
    iscnRef.collection('class').doc(classId).create({
      id: classId,
      uri,
      lastSoldPrice: 0,
      soldCount: 0,
      creatorWallet: sellerWallet,
      timestamp,
      metadata: {
        image: AVATAR_DEFAULT_PATH, // TODO: replace with default NFT image
        externalUrl: url || `${APP_LIKE_CO_ISCN_VIEW_URL}${encodeURIComponent(iscnPrefix)}`,
        description,
        name,
        backgroundColor: LIKECOIN_DARK_GREEN_THEME_COLOR,
      },
    }),
  ]);
  let batch = db.batch();
  for (let i = 0; i < nfts.length; i += 1) {
    const {
      id: nftId,
      uri: nftUri,
    } = nfts[i];
    batch.create(
      iscnRef
        .collection('class').doc(classId)
        .collection('nft')
        .doc(nftId),
      {
        id: nftId,
        uri: nftUri,
        price: 0,
        soldCount: 0,
        isSold: false,
        isProcessing: false,
        classId,
        sellerWallet,
        ownerWallet: LIKER_NFT_TARGET_ADDRESS,
        timestamp,
      },
    );
    if (i % 500 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  return {
    sellerWallet,
  };
}
