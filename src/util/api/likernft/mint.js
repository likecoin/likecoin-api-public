import { parseTxInfoFromIndexedTx } from '@likecoin/iscn-js/dist/parsing';
import { db, likeNFTCollection } from '../../firebase';
import { getISCNQueryClient } from '../../cosmos/iscn';

export async function getNFTsByClassId(classId, address) {
  const client = await getISCNQueryClient();
  let nfts = [];
  let pagination;
  do {
    /* eslint-disable no-await-in-loop */
    const res = await client.nft.NFTs(classId, address);
    ({ pagination } = res);
    nfts = nfts.concat(res.nfts);
  } while (pagination);
  const nftIds = nfts.map(n => n.id);
  return { total: pagination.total, nftIds, nfts };
}

export async function parseNFTInformationFromTxHash(txHash, target) {
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
  const {
    classId,
    totalCount,
    currentPrice,
    basePrice,
    soldCount,
    uri,
  } = classData;
  likeNFTCollection.doc(iscnId).create({
    classId,
    totalCount,
    currentPrice,
    basePrice,
    soldCount,
    uri,
  });
  likeNFTCollection.doc(iscnId).collection('class').doc(classId).create({
    uri,
  });
  let batch = db.batch();
  for (let i = 0; i < nfts.length; i += 1) {
    const {
      id: nftId,
      uri: nftUri,
    } = nfts[i];
    batch.create(
      likeNFTCollection.doc(iscnId).collection('nft').doc(nftId),
      {
        uri: nftUri,
        price: null,
        sold: false,
      },
    );
    if (i % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
}
