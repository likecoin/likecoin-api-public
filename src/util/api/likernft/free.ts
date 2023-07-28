import uuidv4 from 'uuid/v4';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Transaction, DocumentReference, Query } from '@google-cloud/firestore';
import { FieldValue, likeNFTFreeMintTxCollection } from '../../firebase';
import { ValidationError } from '../../ValidationError';

export type FREE_MINT_TYPE = 'free' | 'subscription'

export async function checkFreeMintExists(wallet: string, classId: string, count = 1) {
  const mintQuery = await likeNFTFreeMintTxCollection
    .where('wallet', '==', wallet)
    .where('classId', '==', classId).limit(count).get();
  const hasAlreadyMinted = mintQuery.docs.length >= count;
  return hasAlreadyMinted;
}

export async function checkFreeMintTransaction(t: Transaction, {
  wallet,
  classId,
  count = 1,
}: {
  wallet: string,
  classId: string,
  count?: number,
}) {
  const mintQuery = await t.get(likeNFTFreeMintTxCollection
    .where('wallet', '==', wallet)
    .where('classId', '==', classId)
    .limit(count) as Query);
  if (mintQuery.docs.length >= count) throw new ValidationError('ALREADY_MINTED', 409);
}

export function startFreeMintTransaction(t: Transaction, {
  wallet,
  creatorWallet,
  classId,
  type,
}: {
  wallet: string,
  creatorWallet: string,
  classId: string,
  type: FREE_MINT_TYPE,
}) {
  const docId = uuidv4();
  t.create(likeNFTFreeMintTxCollection.doc(docId) as unknown as DocumentReference, {
    wallet,
    classId,
    creatorWallet,
    type,
    status: 'new',
    timestamp: FieldValue.serverTimestamp(),
  });
  return docId;
}

export function resetFreeMintTransaction(t: Transaction, {
  mintId,
}: {
  mintId: string,
}) {
  t.delete(likeNFTFreeMintTxCollection.doc(mintId) as unknown as DocumentReference);
}

export function completeFreeMintTransaction(t: Transaction, {
  mintId,
  classId,
  nftId,
  txHash,
}: {
  mintId: string,
  classId: string
  nftId: string,
  txHash: string,
}) {
  t.update(likeNFTFreeMintTxCollection.doc(mintId) as unknown as DocumentReference, {
    classId,
    nftId,
    status: 'complete',
    txHash,
    lastUpdateTimestamp: FieldValue.serverTimestamp(),
  });
}
