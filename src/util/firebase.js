import * as admin from 'firebase-admin';
import {
  FIREBASE_STORAGE_BUCKET,
  FIRESTORE_USER_ROOT,
  FIRESTORE_USER_AUTH_ROOT,
  FIRESTORE_SUBSCRIPTION_USER_ROOT,
  FIRESTORE_TX_ROOT,
  FIRESTORE_IAP_ROOT,
  FIRESTORE_MISSION_ROOT,
  FIRESTORE_PAYOUT_ROOT,
  FIRESTORE_CONFIG_ROOT,
} from '../../config/config';
import serviceAccount from '../../config/serviceAccountKey.json';

let db;
if (!process.env.CI) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });

  db = admin.firestore();
  db.settings({ timestampsInSnapshots: true });
}

const getCollectionIfDefined = root => (root ? db.collection(root) : null);

export const userCollection = getCollectionIfDefined(FIRESTORE_USER_ROOT);
export const userAuthCollection = getCollectionIfDefined(FIRESTORE_USER_AUTH_ROOT);
export const subscriptionUserCollection = getCollectionIfDefined(FIRESTORE_SUBSCRIPTION_USER_ROOT);
export const txCollection = getCollectionIfDefined(FIRESTORE_TX_ROOT);
export const iapCollection = getCollectionIfDefined(FIRESTORE_IAP_ROOT);
export const missionCollection = getCollectionIfDefined(FIRESTORE_MISSION_ROOT);
export const payoutCollection = getCollectionIfDefined(FIRESTORE_PAYOUT_ROOT);
export const configCollection = getCollectionIfDefined(FIRESTORE_CONFIG_ROOT);
export const bucket = FIREBASE_STORAGE_BUCKET ? admin.storage().bucket() : null;

export { admin };
export const FieldValue = admin.firestore;
