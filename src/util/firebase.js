import * as admin from 'firebase-admin';
import {
  FIREBASE_STORAGE_BUCKET,
  FIRESTORE_USER_ROOT,
  FIRESTORE_USER_AUTH_ROOT,
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

export const userCollection = FIRESTORE_USER_ROOT ? db.collection(FIRESTORE_USER_ROOT) : null;
export const userAuthCollection = FIRESTORE_USER_AUTH_ROOT
  ? db.collection(FIRESTORE_USER_ROOT) : null;
export const txCollection = FIRESTORE_TX_ROOT ? db.collection(FIRESTORE_TX_ROOT) : null;
export const iapCollection = FIRESTORE_IAP_ROOT
  ? db.collection(FIRESTORE_IAP_ROOT) : null;
export const missionCollection = FIRESTORE_MISSION_ROOT
  ? db.collection(FIRESTORE_MISSION_ROOT) : null;
export const payoutCollection = FIRESTORE_PAYOUT_ROOT ? db.collection(FIRESTORE_PAYOUT_ROOT) : null;
export const configCollection = FIRESTORE_CONFIG_ROOT ? db.collection(FIRESTORE_CONFIG_ROOT) : null;
export const bucket = FIREBASE_STORAGE_BUCKET ? admin.storage().bucket() : null;

export { admin };
export const FieldValue = admin.firestore;
