import { parseTxInfoFromIndexedTx, parseNFTClassDataFields } from '@likecoin/iscn-js/dist/messages/parsing';
import { PageRequest } from 'cosmjs-types/cosmos/base/query/v1beta1/pagination';
import { db, likeNFTCollection } from '../../firebase';
import { getISCNPrefix } from '../../cosmos/iscn';
import { getNFTQueryClient, getNFTISCNData } from '../../cosmos/nft';
import { LIKER_NFT_STARTING_PRICE, LIKER_NFT_TARGET_ADDRESS } from '../../../../config/config';
import {
  AVATAR_DEFAULT_PATH,
  APP_LIKE_CO_ISCN_VIEW_URL,
  LIKECOIN_DARK_GREEN_THEME_COLOR,
} from '../../../constant';

export function getISCNPrefixDocName(iscnId) {
  const prefix = getISCNPrefix(iscnId);
  return encodeURIComponent(prefix);
}

export async function getNFTClassByClassId(classId) {
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  const res = await client.nft.class(classId);
  return parseNFTClassDataFields(res);
}

export async function getNFTsByClassId(classId, address = LIKER_NFT_TARGET_ADDRESS) {
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  let nfts = [];
  let next = new Uint8Array([0x00]);
  do {
    /* eslint-disable no-await-in-loop */
    const res = await client.nft.NFTs(classId, address, PageRequest.fromPartial({ key: next }));
    ({ nextKey: next } = res.pagination);
    nfts = nfts.concat(res.nfts);
  } while (next && next.length);
  const nftIds = nfts.map(n => n.id);
  return { nftIds, nfts };
}

export async function getNFTClassIdByISCNId(iscnId) {
  const iscnPrefix = getISCNPrefix(iscnId);
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  const res = await client.likenft.classesByISCN(iscnPrefix);
  if (!res || !res.classes || !res.classes[0]) return '';
  return res.classes[0].id;
}

export async function parseNFTInformationFromTxHash(txHash, target = LIKER_NFT_TARGET_ADDRESS) {
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

export async function writeMintedFTInfo(iscnId, classData, nfts) {
  const iscnPrefix = getISCNPrefixDocName(iscnId);
  const {
    owner: sellerWallet,
    data: iscnData,
  } = await getNFTISCNData(iscnId);
  const url = iscnData.contentMetadata && iscnData.contentMetadata.url;
  const {
    classId,
    name = '',
    description = '',
    totalCount,
    uri = '',
  } = classData;
  await Promise.all([
    likeNFTCollection.doc(iscnPrefix).create({
      classId,
      classes: [classId],
      totalCount,
      currentPrice: LIKER_NFT_STARTING_PRICE,
      basePrice: LIKER_NFT_STARTING_PRICE,
      soldCount: 0,
      classUri: uri,
      creatorWallet: sellerWallet,
      isProcessing: false,
    }),
    likeNFTCollection.doc(iscnPrefix).collection('class').doc(classId).create({
      id: classId,
      uri,
      lastSoldPrice: 0,
      soldCount: 0,
      creatorWallet: sellerWallet,
      metadata: {
        image: AVATAR_DEFAULT_PATH, // TODO: replace with default NFT image
        externalUrl: url || `${APP_LIKE_CO_ISCN_VIEW_URL}${encodeURIComponent(iscnId)}`,
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
      likeNFTCollection.doc(iscnPrefix)
        .collection('class').doc(classId)
        .collection('nft')
        .doc(nftId),
      {
        id: nftId,
        uri: nftUri,
        price: 0,
        isSold: false,
        classId,
        sellerWallet,
      },
    );
    if (i % 500 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
}
