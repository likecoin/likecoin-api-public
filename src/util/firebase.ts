import * as admin from 'firebase-admin';
import {
  FIREBASE_STORAGE_BUCKET,
  FIRESTORE_USER_ROOT,
  FIRESTORE_USER_AUTH_ROOT,
  FIRESTORE_SUBSCRIPTION_USER_ROOT,
  FIRESTORE_CIVIC_USER_METADATA_ROOT,
  FIRESTORE_SUPERLIKE_USER_ROOT,
  FIRESTORE_TX_ROOT,
  FIRESTORE_IAP_ROOT,
  FIRESTORE_MISSION_ROOT,
  FIRESTORE_PAYOUT_ROOT,
  FIRESTORE_COUPON_ROOT,
  FIRESTORE_CONFIG_ROOT,
  FIRESTORE_OAUTH_CLIENT_ROOT,
  FIRESTORE_LIKER_NFT_ROOT,
  FIRESTORE_LIKER_NFT_FIAT_ROOT,
  FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT,
  FIRESTORE_NFT_FREE_MINT_TX_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_USER_ROOT,
  FIRESTORE_LIKE_URL_ROOT,
  FIRESTORE_ISCN_INFO_ROOT,
  FIRESTORE_ISCN_LIKER_URL_ROOT,
} from '../../config/config';
import serviceAccount from '../../config/serviceAccountKey.json';

let database;
if (!process.env.CI) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as unknown as string),
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });

  database = admin.firestore();
}
export const db = database;

const getCollectionIfDefined = (root) => (root ? database.collection(root) : null);

export const userCollection = getCollectionIfDefined(FIRESTORE_USER_ROOT);
export const userAuthCollection = getCollectionIfDefined(FIRESTORE_USER_AUTH_ROOT);
export const subscriptionUserCollection = getCollectionIfDefined(FIRESTORE_SUBSCRIPTION_USER_ROOT);
export const civicUserMetadataCollection = getCollectionIfDefined(
  FIRESTORE_CIVIC_USER_METADATA_ROOT,
);
export const superLikeUserCollection = getCollectionIfDefined(FIRESTORE_SUPERLIKE_USER_ROOT);
export const txCollection = getCollectionIfDefined(FIRESTORE_TX_ROOT);
export const iapCollection = getCollectionIfDefined(FIRESTORE_IAP_ROOT);
export const missionCollection = getCollectionIfDefined(FIRESTORE_MISSION_ROOT);
export const payoutCollection = getCollectionIfDefined(FIRESTORE_PAYOUT_ROOT);
export const couponCollection = getCollectionIfDefined(FIRESTORE_COUPON_ROOT);
export const configCollection = getCollectionIfDefined(FIRESTORE_CONFIG_ROOT);
export const oAuthClientCollection = getCollectionIfDefined(FIRESTORE_OAUTH_CLIENT_ROOT);
export const likeNFTCollection = getCollectionIfDefined(FIRESTORE_LIKER_NFT_ROOT);
export const likeNFTFiatCollection = getCollectionIfDefined(FIRESTORE_LIKER_NFT_FIAT_ROOT);
export const likeNFTSubscriptionUserCollection = getCollectionIfDefined(
  FIRESTORE_NFT_SUBSCRIPTION_USER_ROOT,
);
export const likeNFTFreeMintTxCollection = getCollectionIfDefined(
  FIRESTORE_NFT_FREE_MINT_TX_ROOT,
);
export const likeNFTBookCollection = getCollectionIfDefined(FIRESTORE_LIKER_NFT_BOOK_ROOT);
export const likeNFTBookUserCollection = getCollectionIfDefined(
  FIRESTORE_LIKER_NFT_BOOK_USER_ROOT,
);
export const likeButtonUrlCollection = getCollectionIfDefined(FIRESTORE_LIKE_URL_ROOT);
export const iscnInfoCollection = getCollectionIfDefined(FIRESTORE_ISCN_INFO_ROOT);
export const iscnMappingCollection = getCollectionIfDefined(
  FIRESTORE_ISCN_LIKER_URL_ROOT,
);
export const bucket = FIREBASE_STORAGE_BUCKET ? admin.storage().bucket() : null;

export { admin };
export const { FieldValue } = admin.firestore;
