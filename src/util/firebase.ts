import * as admin from 'firebase-admin';
import {
  FIREBASE_STORAGE_BUCKET,
  FIRESTORE_USER_ROOT,
  FIRESTORE_USER_AUTH_ROOT,
  FIRESTORE_SUBSCRIPTION_USER_ROOT,
  FIRESTORE_SUPERLIKE_USER_ROOT,
  FIRESTORE_TX_ROOT,
  FIRESTORE_IAP_ROOT,
  FIRESTORE_MISSION_ROOT,
  FIRESTORE_PAYOUT_ROOT,
  FIRESTORE_COUPON_ROOT,
  FIRESTORE_CONFIG_ROOT,
  FIRESTORE_OAUTH_CLIENT_ROOT,
  FIRESTORE_LIKER_NFT_ROOT,
  FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT,
  FIRESTORE_NFT_FREE_MINT_TX_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_CART_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_USER_ROOT,
  FIRESTORE_LIKE_URL_ROOT,
  FIRESTORE_ISCN_INFO_ROOT,
  FIRESTORE_ISCN_ARWEAVE_TX_ROOT,
  FIRESTORE_ISCN_LIKER_URL_ROOT,
} from '../../config/config';
import serviceAccount from '../../config/serviceAccountKey.json';

let database: admin.firestore.Firestore | undefined;
if (!process.env.CI) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as unknown as string),
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });

  database = admin.firestore();
}

if (!database && !process.env.CI) {
  throw new Error('Firebase database not initialized');
}

export const db = database as admin.firestore.Firestore;

function getCollection(root: string | undefined): admin.firestore.CollectionReference {
  if (!root) {
    throw new Error('Firestore collection root not defined');
  }
  if (!database) {
    throw new Error('Firebase database not initialized');
  }
  return database.collection(root);
}

export const userCollection = getCollection(FIRESTORE_USER_ROOT);
export const userAuthCollection = getCollection(FIRESTORE_USER_AUTH_ROOT);
export const subscriptionUserCollection = getCollection(FIRESTORE_SUBSCRIPTION_USER_ROOT);
export const superLikeUserCollection = getCollection(FIRESTORE_SUPERLIKE_USER_ROOT);
export const txCollection = getCollection(FIRESTORE_TX_ROOT);
export const iapCollection = getCollection(FIRESTORE_IAP_ROOT);
export const missionCollection = getCollection(FIRESTORE_MISSION_ROOT);
export const payoutCollection = getCollection(FIRESTORE_PAYOUT_ROOT);
export const couponCollection = getCollection(FIRESTORE_COUPON_ROOT);
export const configCollection = getCollection(FIRESTORE_CONFIG_ROOT);
export const oAuthClientCollection = getCollection(FIRESTORE_OAUTH_CLIENT_ROOT);
export const likeNFTCollection = getCollection(FIRESTORE_LIKER_NFT_ROOT);
export const likeNFTSubscriptionUserCollection = getCollection(
  FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT,
);
export const likeNFTFreeMintTxCollection = getCollection(FIRESTORE_NFT_FREE_MINT_TX_ROOT);
export const likeNFTBookCartCollection = getCollection(FIRESTORE_LIKER_NFT_BOOK_CART_ROOT);
export const likeNFTBookCollection = getCollection(FIRESTORE_LIKER_NFT_BOOK_ROOT);
export const likeNFTBookUserCollection = getCollection(FIRESTORE_LIKER_NFT_BOOK_USER_ROOT);
export const likeButtonUrlCollection = getCollection(FIRESTORE_LIKE_URL_ROOT);
export const iscnInfoCollection = getCollection(FIRESTORE_ISCN_INFO_ROOT);
export const iscnArweaveTxCollection = getCollection(FIRESTORE_ISCN_ARWEAVE_TX_ROOT);
export const iscnMappingCollection = getCollection(FIRESTORE_ISCN_LIKER_URL_ROOT);

function getBucket(): ReturnType<admin.storage.Storage['bucket']> {
  if (!FIREBASE_STORAGE_BUCKET) {
    throw new Error('Firebase storage bucket not defined');
  }
  return admin.storage().bucket();
}

export const bucket = getBucket();

export { admin };
export const { FieldValue, Timestamp } = admin.firestore;
