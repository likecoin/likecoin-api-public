import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { NextFunction, Request, Response } from 'express';

import {
  likeNFTSubscriptionUserCollection,
  likeNFTSubscriptionTxCollection,
  FieldValue,
  db,
} from '../../../firebase';
import {
  LIKER_NFT_SUBSCRIPTION_MINT_SECRET,
} from '../../../../../config/config';
import { ValidationError } from '../../../ValidationError';

const MINT_STATUS = [
  'new',
  'arweave',
  'iscn',
  'nftCover',
  'nftClass',
  'nftMint',
  'done',
];

export function createMintAuthenticationToken(sessionId: string): string {
  const hmac = createHmac('sha256', LIKER_NFT_SUBSCRIPTION_MINT_SECRET);
  hmac.update(sessionId);
  return hmac.digest('base64');
}

export function verifyAuthorizationHeader(req: Request, res: Response, next: NextFunction): void {
  const { statusId } = req.params;
  const { authorization } = req.headers;
  if (!authorization || !statusId || createMintAuthenticationToken(statusId) !== authorization) {
    res.sendStatus(401);
  }
  next();
}

export async function checkUserIsActiveNFTSubscriber(wallet: string)
  : Promise<{ isActive: boolean; stripe?: any; }> {
  const doc = await likeNFTSubscriptionUserCollection.doc(wallet).get();
  const docData = doc.data();
  if (!docData) return { isActive: false };
  const { currentPeriodStart, currentPeriodEnd, stripe } = docData;
  const now = Date.now() / 1000;
  return {
    isActive: currentPeriodStart < now && currentPeriodEnd > now,
    stripe,
  };
}

export async function createNewMintTransaction(wallet: string)
  : Promise<{ statusId: string; statusSecret: string; }> {
  const statusId = uuidv4();
  const statusSecret = createMintAuthenticationToken(statusId);
  await Promise.all([
    likeNFTSubscriptionTxCollection.doc(statusId).create({
      wallet,
      status: 'new',
      statusSecret,
      isProcessing: false,
      lastUpdatedTimestamp: FieldValue.serverTimestamp(),
      timestamp: FieldValue.serverTimestamp(),
    }),
    likeNFTSubscriptionUserCollection.doc(wallet).update({
      currentPeriodMints: FieldValue.increment(1),
      totalMints: FieldValue.increment(1),
    }),
  ]);

  return {
    statusId,
    statusSecret,
  };
}

export async function getAllMintTransaction(wallet: string) {
  const res = await likeNFTSubscriptionTxCollection.where('wallet', '==', wallet).orderBy('timestamp', 'desc').get();
  const docs = res.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return docs;
}

export async function checkAndLockMintStatus(statusId: string, status: string) {
  const data = await db.runTransaction(async (t) => {
    const doc = await t.get(likeNFTSubscriptionTxCollection.doc(statusId));
    const docData = doc.data();
    if (!docData) throw new ValidationError('MINT_STATUS_NOT_FOUND');
    const { isProcessing, status: dbStatus, ...otherDocData } = docData;
    if (MINT_STATUS.findIndex((s) => s === dbStatus)
      >= MINT_STATUS.findIndex((s) => s === status)) {
      throw new ValidationError('INVALID_MINT_STATUS');
    }
    if (isProcessing) throw new ValidationError('MINT_ALREADY_PROCESSING');
    t.update(
      likeNFTSubscriptionTxCollection.doc(statusId),
      {
        isProcessing: true,
        lastUpdatedTimestamp: FieldValue.serverTimestamp(),
      },
    );
    return otherDocData;
  });
  return data;
}

export async function updateAndUnlockMintStatus(
  statusId: string,
  status: string,
  statusData?: {[key: string]: string;},
  rootData?: {[key: string]: string;},
) {
  let payload = {
    isProcessing: false,
    status,
    lastUpdatedTimestamp: FieldValue.serverTimestamp(),
  };
  if (statusData) {
    payload[status] = statusData;
  }
  if (rootData) {
    payload = {
      ...payload,
      ...rootData,
    };
  }
  await likeNFTSubscriptionTxCollection.doc(statusId).update(payload);
}

export async function unlockMintStatus(
  statusId: string,
) {
  const payload = {
    isProcessing: false,
    lastUpdatedTimestamp: FieldValue.serverTimestamp(),
  };
  await likeNFTSubscriptionTxCollection.doc(statusId).update(payload);
}

export default checkUserIsActiveNFTSubscriber;
