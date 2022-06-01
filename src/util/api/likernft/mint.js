import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/parsing';
import { db, likeNFTCollection } from '../../firebase';
import { getISCNQueryClient, getISCNPrefix } from '../../cosmos/iscn';
import { LIKER_NFT_STARTING_PRICE, LIKER_NFT_TARGET_ADDRESS } from '../../../../config/config';

export function getISCNPrefixDocName(iscnId) {
  const prefix = getISCNPrefix(iscnId);
  return encodeURIComponent(prefix);
}

export async function getNFTsByClassId(classId, address = LIKER_NFT_TARGET_ADDRESS) {
  const c = await getISCNQueryClient();
  const client = await c.getQueryClient();
  let nfts = [];
  let pagination;
  do {
    /* eslint-disable no-await-in-loop */
    const res = await client.nft.NFTs(classId, address);
    ({ pagination } = res);
    nfts = nfts.concat(res.nfts);
  } while (pagination.nextKey && pagination.nextKey.length);
  const nftIds = nfts.map(n => n.id);
  return { total: Number(pagination.total), nftIds, nfts };
}

export async function parseNFTInformationFromTxHash(txHash, target = LIKER_NFT_TARGET_ADDRESS) {
  const client = await getISCNQueryClient();
  const q = await client.getStargateClient();
  const tx = await q.getTx(txHash);
  const parsed = parseTxInfoFromIndexedTx(tx);
  const messages = parsed.tx.body.messages
    .filter(m => m.typeUrl === '/cosmos.nft.v1beta1.MsgSend')
    .filter(m => m.value.receiver === target);
  const nftIds = messages.map(m => m.value.id);
  return {
    total: messages.length,
    classId: messages[0].value.classId,
    nftIds,
  };
}

export async function writeMintedFTInfo(iscnId, classData, nfts) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const {
    classId,
    totalCount,
    uri,
  } = classData;
  likeNFTCollection.doc(iscnPrefix).create({
    classId,
    classIds: [classId],
    totalCount,
    currentPrice: LIKER_NFT_STARTING_PRICE,
    basePrice: LIKER_NFT_STARTING_PRICE,
    soldCount: 0,
    uri,
    isProcessing: false,
  });
  likeNFTCollection.doc(iscnPrefix).collection('class').doc(classId).create({
    id: classId,
    uri,
  });
  let batch = db.batch();
  for (let i = 0; i < nfts.length; i += 1) {
    const {
      id: nftId,
      uri: nftUri,
    } = nfts[i];
    batch.create(
      likeNFTCollection.doc(iscnPrefix).collection('nft').doc(nftId),
      {
        id: nftId,
        uri: nftUri,
        price: 0,
        isSold: false,
        classId,
      },
    );
    if (i % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
}
