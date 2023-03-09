import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { firestore } from 'firebase-admin';
import { NextFunction, Request, Response } from 'express';

import {
  likeNFTSubscriptionUserCollection,
  likeNFTSubscriptionTxCollection,
  FieldValue,
} from '../../../firebase';
import {
  LIKER_NFT_SUBSCRIPTION_MINT_SECRET,
} from '../../../../../config/config';

export function createMintAutheticationToken(sessionId: string): string {
  const hmac = createHmac('sha256', LIKER_NFT_SUBSCRIPTION_MINT_SECRET);
  hmac.update(sessionId);
  return hmac.digest('base64');
}

export function verifyAuthorizationHeader(req: Request, res: Response, next: NextFunction): void {
  const { statusId } = req.params;
  const { authorization } = req.headers;
  if (!authorization || !statusId || createMintAutheticationToken(statusId) !== authorization) {
    res.sendStatus(401);
  }
  next();
}

export async function checkUserIsActiveNFTSubscriber(wallet: string): Promise<boolean> {
  const doc = await likeNFTSubscriptionUserCollection().doc(wallet).get();
  const docData = doc.data();
  if (!docData) return false;
  const { currentPeriodStart, currentPeriodEnd } = docData;
  const now = Date.now();
  return currentPeriodStart < now && currentPeriodEnd > now;
}

export async function createNewMintTransaction(wallet: string)
  : Promise<{ statusId: string; statusSecret: string; }> {
  const statusId = uuidv4();
  const statusSecret = createMintAutheticationToken(statusId);
  const res = await likeNFTSubscriptionTxCollection().doc(statusId).create({
    wallet,
    status: 'new',
    statusSecret,
    isProcessing: false,
    timestamp: FieldValue.serverTimestamp,
  });
  return {
    statusId: res.id,
    statusSecret,
  };
}

export async function getAllMintTransaction(wallet: string) {
  const res: firestore.QuerySnapshot = await likeNFTSubscriptionTxCollection().where(wallet).orderBy('timestamp', 'desc').get();
  const docs = res.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return docs;
}

export default checkUserIsActiveNFTSubscriber;
