import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/messages/parsing';
import { getISCNPrefixDocName } from '.';
import { db, likeNFTCollection } from '../../firebase';
import { getNFTQueryClient, getNFTISCNData } from '../../cosmos/nft';
import { LIKER_NFT_TARGET_ADDRESS } from '../../../../config/config';
import { getNFTBatchInfo } from './purchase';
import {
  WNFT_DEFAULT_PATH,
  APP_LIKE_CO_ISCN_VIEW_URL,
  LIKECOIN_DARK_GREEN_THEME_COLOR,
  FIRESTORE_BATCH_SIZE,
} from '../../../constant';
import { sleep } from '../../misc';

export async function parseNFTInformationFromSendTxHash(txHash, target = LIKER_NFT_TARGET_ADDRESS) {
  const client = await getNFTQueryClient();
  const q = await client.getStargateClient();
  const tx = await q.getTx(txHash);
  if (!tx) return null;
  const parsed = parseTxInfoFromIndexedTx(tx);
  const messages = parsed.tx.body.messages
    .filter((m) => m.typeUrl === '/cosmos.nft.v1beta1.MsgSend')
    .filter((m) => m.value.receiver === target);
  if (!messages.length) return null;
  const nftIds = messages.map((m) => m.value.id);
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
  if (!iscnData) throw new Error('ISCN_DATA_NOT_FOUND');
  const url = iscnData.contentMetadata && iscnData.contentMetadata.url;
  const timestamp = Date.now();
  const {
    classId,
    name = '',
    description = '',
    totalCount,
    uri = '',
    metadata = {},
    platform = '',
    initialBatch = 0,
    isFree,
  } = classData;
  const currentBatch = isFree ? -1 : initialBatch;
  const { price, count } = getNFTBatchInfo(currentBatch);
  const iscnRef = likeNFTCollection.doc(iscnPrefixDocName);
  const {
    external_url: externalUrl,
    background_color: backgroundColor,
    image,
    ...otherData
  } = metadata;
  let batch = db.batch();
  batch.create(iscnRef, {
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
    platform,
  });
  batch.create(iscnRef.collection('class').doc(classId), {
    id: classId,
    uri,
    lastSoldPrice: 0,
    soldCount: 0,
    creatorWallet: sellerWallet,
    timestamp,
    platform,
    metadata: {
      ...otherData,
      image: image || WNFT_DEFAULT_PATH, // TODO: replace with default NFT image
      externalUrl: externalUrl || url || `${APP_LIKE_CO_ISCN_VIEW_URL}${encodeURIComponent(iscnPrefix)}`,
      description,
      name,
      backgroundColor: backgroundColor || LIKECOIN_DARK_GREEN_THEME_COLOR,
    },
  });
  // 2 batched create calls above
  for (let i = 2; i < nfts.length + 2; i += 1) {
    const {
      id: nftId,
      uri: nftUri,
    } = nfts[i - 2];
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
    if (i % FIRESTORE_BATCH_SIZE === FIRESTORE_BATCH_SIZE - 1) {
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
      // TODO: remove this after solving API CPU hang error
      await sleep(10);
      batch = db.batch();
    }
  }
  await batch.commit();
  return {
    sellerWallet,
    basePrice: price,
  };
}
