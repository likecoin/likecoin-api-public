import Stripe from 'stripe';
import stripe from '../../../stripe';
import { FieldValue, likeNFTSubscriptionUserCollection } from '../../../firebase';
import publisher from '../../../gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../../../constant';
import { ValidationError } from '../../../ValidationError';

export async function processStripeNFTSubscriptionSession(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  const {
    subscription: subscriptionId,
    customer: customerId,
    customer_email: customerEmail,
    customer_details: customerDetails,
  } = session;
  const email = customerEmail || customerDetails?.email || null;
  if (!subscriptionId) return false;
  const subscription: Stripe.Subscription = typeof subscriptionId === 'string' ? await stripe.subscriptions.retrieve(subscriptionId) : subscriptionId;
  const {
    items: { data: items },
    metadata: { wallet, creatorWallet },
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
  } = subscription;
  const priceId = items[0].price.id;
  const productId = items[0].price.product;
  try {
    await likeNFTSubscriptionUserCollection.doc(wallet).set({
      customer: {
        email,
        customerId,
      },
      [creatorWallet]: {
        currentPeriodStart,
        currentPeriodEnd,
        subscriptionId,
        productId,
        priceId,
      },
      timestamp: FieldValue.serverTimestamp(),
    }, { merge: true });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTSubscriptionCreated',
      type: 'stripe',
      subscriptionId,
      creatorWallet,
      customerId,
      wallet,
      email,
      currentPeriodStart,
      currentPeriodEnd,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatSubscriptionError',
      type: 'stripe',
      subscriptionId,
      priceId,
      wallet,
      error: (error as Error).toString(),
      errorMessage,
      errorStack,
    });
    return false;
  }
  return true;
}

export async function processStripeNFTSubscriptionInvoice(
  invoice: Stripe.Invoice,
  req: Express.Request,
) {
  const {
    customer: customerId,
    subscription: subscriptionId,
  } = invoice;
  if (!subscriptionId) return false;
  const subscription: Stripe.Subscription = typeof subscriptionId === 'string'
    ? await stripe.subscriptions.retrieve(subscriptionId)
    : subscriptionId;
  const {
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    metadata: { wallet, creatorWallet },
    items: { data: items },
  } = subscription;
  const customer: Stripe.Customer | Stripe.DeletedCustomer = await stripe.customers.retrieve(
    customerId as string,
  );
  if (customer.deleted) throw new ValidationError(`Customer ${customerId} is deleted`);
  const { email } = customer;
  const priceId = items[0].price.id;
  const productId = items[0].price.product;
  try {
    await likeNFTSubscriptionUserCollection.doc(wallet).update({
      [creatorWallet]: {
        currentPeriodStart,
        currentPeriodEnd,
        subscriptionId,
        productId,
        priceId,
      },
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTSubscriptionRenewed',
      type: 'stripe',
      subscriptionId,
      wallet,
      email,
      currentPeriodStart,
      currentPeriodEnd,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'LikerNFTFiatSubscriptionError',
      type: 'stripe',
      subscriptionId,
      wallet,
      error: (error as Error).toString(),
      errorMessage,
      errorStack,
    });
    return false;
  }
  return true;
}
