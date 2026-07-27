import * as admin from 'firebase-admin';
import {
  FIREBASE_STORAGE_BUCKET,
  FIRESTORE_USER_ROOT,
  FIRESTORE_TX_ROOT,
  FIRESTORE_CONFIG_ROOT,
  FIRESTORE_OAUTH_CLIENT_ROOT,
  FIRESTORE_LIKER_NFT_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_CART_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_CMS_TAG_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_ROOT,
  FIRESTORE_LIKER_NFT_BOOK_USER_ROOT,
  FIRESTORE_LIKER_PLUS_GIFT_CART_ROOT,
  FIRESTORE_ISCN_INFO_ROOT,
  FIRESTORE_ISCN_ARWEAVE_TX_ROOT,
} from '../../config/config';
import serviceAccount from '../../config/serviceAccountKey.json';
import type { UserData } from '../types/user';
import type {
  NFTBookListingInfo,
  BookPurchaseCartData,
  NFTBookUserData,
  PlusGiftCartData,
  NFTBookCMSTag,
} from '../types/book';
import type { LikeNFTISCNData } from '../types/nft';
import type { TxData, ArweaveTxData } from '../types/transaction';
import type {
  ConfigData,
  OAuthClientInfo,
  ISCNInfoData,
} from '../types/firestore';

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

function getCollection<T = admin.firestore.DocumentData>(
  root: string | undefined,
): admin.firestore.CollectionReference<T> {
  // In CI environment, allow undefined collections (they won't be used)
  if (process.env.CI) {
    return {} as admin.firestore.CollectionReference<T>;
  }

  // In non-CI environments, validate configuration
  if (!root) {
    throw new Error('Firestore collection root not defined');
  }
  if (!database) {
    throw new Error('Firebase database not initialized');
  }

  return database.collection(root) as admin.firestore.CollectionReference<T>;
}

export const userCollection = getCollection<UserData>(FIRESTORE_USER_ROOT);
export const txCollection = getCollection<TxData>(FIRESTORE_TX_ROOT);
export const configCollection = getCollection<ConfigData>(
  FIRESTORE_CONFIG_ROOT,
);
export const oAuthClientCollection = getCollection<OAuthClientInfo>(
  FIRESTORE_OAUTH_CLIENT_ROOT,
);
export const likeNFTCollection = getCollection<LikeNFTISCNData>(
  FIRESTORE_LIKER_NFT_ROOT,
);
export const likeNFTBookCartCollection = getCollection<BookPurchaseCartData>(
  FIRESTORE_LIKER_NFT_BOOK_CART_ROOT,
);
export const likeNFTBookCollection = getCollection<NFTBookListingInfo>(
  FIRESTORE_LIKER_NFT_BOOK_ROOT,
);
export const likeNFTBookCMSTagCollection = getCollection<NFTBookCMSTag>(
  FIRESTORE_LIKER_NFT_BOOK_CMS_TAG_ROOT,
);
export const likeNFTBookUserCollection = getCollection<NFTBookUserData>(
  FIRESTORE_LIKER_NFT_BOOK_USER_ROOT,
);
export const likePlusGiftCartCollection = getCollection<PlusGiftCartData>(
  FIRESTORE_LIKER_PLUS_GIFT_CART_ROOT,
);
export const iscnInfoCollection = getCollection<ISCNInfoData>(
  FIRESTORE_ISCN_INFO_ROOT,
);
export const iscnArweaveTxCollection = getCollection<ArweaveTxData>(
  FIRESTORE_ISCN_ARWEAVE_TX_ROOT,
);

function getBucket(): ReturnType<admin.storage.Storage['bucket']> {
  // In CI environment, allow undefined bucket (it won't be used)
  if (process.env.CI) {
    return {} as ReturnType<admin.storage.Storage['bucket']>;
  }
  if (!FIREBASE_STORAGE_BUCKET) {
    throw new Error('Firebase storage bucket not defined');
  }
  return admin.storage().bucket();
}

export const bucket = getBucket();

export { admin };
export const { FieldValue, Timestamp, Filter } = admin.firestore;
