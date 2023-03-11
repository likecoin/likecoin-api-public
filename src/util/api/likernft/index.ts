import { parseNFTClassDataFields } from '@likecoin/iscn-js/dist/messages/parsing';
import { getISCNPrefix } from '../../cosmos/iscn';
import { ValidationError } from '../../ValidationError';
import { likeNFTCollection } from '../../firebase';
import { getNFTClassDataById, getNFTQueryClient } from '../../cosmos/nft';

export function getISCNPrefixDocName(iscnId) {
  const prefix = getISCNPrefix(iscnId);
  return encodeURIComponent(prefix);
}

export async function getCurrentClassIdByISCNId(iscnId) {
  const iscnPrefixDocName = getISCNPrefixDocName(iscnId);
  const iscnDoc = await likeNFTCollection.doc(iscnPrefixDocName).get();
  const iscnData = iscnDoc.data();
  if (!iscnData) {
    throw new ValidationError('ISCN_NFT_NOT_FOUND', 404);
  }
  return iscnData.classId;
}

export async function getISCNDocByClassId(classId) {
  const iscnQuery = await likeNFTCollection.where('classId', '==', classId).limit(1).get();
  if (!iscnQuery.docs.length) {
    throw new ValidationError('NFT_CLASS_NOT_FOUND', 404);
  }
  return iscnQuery.docs[0];
}

export async function getISCNPrefixByClassId(classId) {
  const doc = await getISCNDocByClassId(classId);
  return decodeURIComponent(doc.id);
}

export async function getISCNPrefixByClassIdFromChain(classId) {
  const data = await getNFTClassDataById(classId);
  if (!data) {
    throw new ValidationError('NFT_CLASS_NOT_FOUND', 404);
  }
  return data.data.parent.iscnIdPrefix;
}

export async function getNFTClassByClassId(classId) {
  const c = await getNFTQueryClient();
  const client = await c.getQueryClient();
  const res = await client.nft.class(classId);
  if (!res.class) throw new Error('CLASS_NOT_FOUND');
  return parseNFTClassDataFields(res.class);
}
