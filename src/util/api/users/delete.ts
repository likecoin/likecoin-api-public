import Stripe from 'stripe';
import { FIRESTORE_BATCH_SIZE } from '../../../constant';
import {
  userCollection,
  userAuthCollection,
  subscriptionUserCollection,
  superLikeUserCollection,
  likeButtonUrlCollection,
  iscnMappingCollection,
  db,
} from '../../firebase';
import { getStripeClient } from '../../stripe';

const TERMINAL_SUBSCRIPTION_STATUSES: Stripe.Subscription.Status[] = ['canceled', 'incomplete_expired'];

// Deleting the Liker ID must also stop its active Plus subscription from
// renewing; otherwise Stripe keeps billing and future invoices can no longer
// resolve the now-deleted wallet, so the webhook drops them silently. Cancel at
// period end so the already-paid term is honoured.
async function cancelActivePlusSubscription(user) {
  const doc = await userCollection.doc(user).get();
  const { likerPlus } = doc.data() || {};
  const subscriptionId = likerPlus?.subscriptionId;
  if (!subscriptionId) return;
  if (likerPlus.provider && likerPlus.provider !== 'stripe') {
    // App-store IAP and other providers can't be cancelled through Stripe here.
    // eslint-disable-next-line no-console
    console.warn(`Skipping non-stripe Plus subscription ${subscriptionId} for deleted user ${user}`);
    return;
  }
  const stripe = getStripeClient();
  try {
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    // Subscription no longer exists in Stripe; nothing left to cancel.
    if (
      err instanceof Stripe.errors.StripeInvalidRequestError
      && err.code === 'resource_missing'
    ) return;
    // Stripe's terminal-status update error carries no machine-readable code,
    // so check the status to tell already-ended apart from a real failure.
    const status = await stripe.subscriptions.retrieve(subscriptionId)
      .then((subscription) => subscription.status)
      .catch(() => null);
    if (status && TERMINAL_SUBSCRIPTION_STATUSES.includes(status)) return;
    // Best-effort: don't block deletion on Stripe errors.
    // eslint-disable-next-line no-console
    console.error(`Failed to cancel Plus subscription ${subscriptionId} for deleted user ${user}:`, err);
  }
}

async function clearUserButtonData(user) {
  const query = await likeButtonUrlCollection
    .where('user', '==', user)
    .get();
  if (!query.docs.length) return;
  let batch = db.batch();
  let i;
  for (i = 0; i < query.docs.length; i += 1) {
    batch.delete(query.docs[i].ref);
    if (i % FIRESTORE_BATCH_SIZE === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (i % FIRESTORE_BATCH_SIZE) await batch.commit();
}

async function clearUserMappingData(user) {
  const query = await iscnMappingCollection
    .where('likerId', '==', user)
    .get();
  if (!query.docs.length) return;
  let batch = db.batch();
  let i;
  for (i = 0; i < query.docs.length; i += 1) {
    batch.delete(query.docs[i].ref);
    if (i % FIRESTORE_BATCH_SIZE === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (i % FIRESTORE_BATCH_SIZE) await batch.commit();
}

export async function deleteAllUserData(user) {
  await cancelActivePlusSubscription(user);
  await Promise.all([
    db.recursiveDelete(userCollection
      .doc(user)),
    db.recursiveDelete(userAuthCollection
      .doc(user)),
    db.recursiveDelete(subscriptionUserCollection
      .doc(user)),
    db.recursiveDelete(superLikeUserCollection
      .doc(user)),
    clearUserButtonData(user),
    clearUserMappingData(user),
  // eslint-disable-next-line no-console
  ].map((p) => p.catch((e) => console.error(e))));
  await userCollection
    .doc(user).set({ isDeleted: true, timestamp: Date.now() });
}

export default deleteAllUserData;
