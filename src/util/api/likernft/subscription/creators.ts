import { ValidationError } from '../../../ValidationError';
import { FieldValue, likeNFTConnectedUserCollection } from '../../../firebase';
import { getLikerLandNFTPortfolioPageURL } from '../../../liker-land';
import stripe from '../../../stripe';
import { getUserWithCivicLikerPropertiesByWallet } from '../../users/getPublicInfo';
import { getUserStripeConnectInfo } from '../connect';

export const MIN_SUBSCRIPTION_PLAN_PRICE_DECIMAL = 90; // 0.90 USD
export const NFT_SUBSCRIPTION_PLAN_TEXT_LOCALES = ['en', 'zh'];
export const NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE = NFT_SUBSCRIPTION_PLAN_TEXT_LOCALES[0];

export async function getCreatorSubscriptionPlans(wallet: string) {
  const planDoc = await likeNFTConnectedUserCollection
    .doc(wallet)
    .collection('plans')
    .get();
  const planData = planDoc.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return planData;
}

export async function getCreatorSubscriptionPlan(wallet: string, planId: string) {
  const planDoc = await likeNFTConnectedUserCollection
    .doc(wallet)
    .collection('plans')
    .doc(planId)
    .get();
  const planData = planDoc.data();
  return planData;
}

export async function newCreatorSubscriptionPlan(wallet: string, payload) {
  const userData = await getUserStripeConnectInfo(wallet);
  const userInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
  const likerId = userInfo?.user || '';
  const displayName = userInfo?.displayName || wallet;
  const images = userInfo?.avatar ? [userInfo?.avatar] : [];
  const {
    isStripeConnectReady,
    stripeConnectAccountId,
    defaultStripeProductId,
    defaultStripePriceId,
  } = userData;
  if (!isStripeConnectReady || !stripeConnectAccountId) {
    throw new ValidationError('STRIPE_ACCOUNT_NOT_CONNECTED');
  }
  const {
    priceInDecimal,
    name,
    description,
    canFreeMintWNFT = true,
  } = payload;
  const product = await stripe.products.create({
    name: `${name[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE]} - ${displayName}`,
    description: description[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE] || '',
    metadata: {
      creatorWallet: wallet,
      stripeConnectAccountId,
      likerId,
    },
    images,
    url: getLikerLandNFTPortfolioPageURL({ wallet }),
    default_price_data: {
      unit_amount: priceInDecimal,
      currency: 'usd',
      recurring: { interval: 'month' },
    },
  });
  const stripeProductId = product.id;
  const stripePriceId = product.default_price;
  await likeNFTConnectedUserCollection
    .doc(wallet)
    .collection('plans')
    .doc(stripeProductId)
    .create({
      name,
      description,
      priceInDecimal,
      canFreeMintWNFT,
      stripeProductId,
      stripePriceId,
      timestamp: FieldValue.serverTimestamp(),
    });
  await likeNFTConnectedUserCollection
    .doc(wallet)
    .update({
      defaultStripeProductId: defaultStripeProductId || stripeProductId,
      defaultStripePriceId: defaultStripePriceId || stripePriceId,
      stripeProductIds: FieldValue.arrayUnion(stripeProductId),
      stripePriceIds: FieldValue.arrayUnion(stripePriceId),
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    });
  return { stripeProductId, stripePriceId };
}

export async function updateCreatorSubscriptionPlan(wallet: string, planId: string, payload) {
  const userData = await getUserStripeConnectInfo(wallet);
  const {
    isStripeConnectReady,
    stripeConnectAccountId,
  } = userData;
  if (!isStripeConnectReady || !stripeConnectAccountId) {
    throw new ValidationError('STRIPE_ACCOUNT_NOT_CONNECTED');
  }
  const currentPlanData = await getCreatorSubscriptionPlan(wallet, planId);
  const {
    stripeProductId,
  } = currentPlanData;
  const {
    name,
    description,
    canFreeMintWNFT,
  } = payload;
  await stripe.products.update(stripeProductId, {
    name: name[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE],
    description: description[NFT_SUBSCRIPTION_PLAN_TEXT_DEFAULT_LOCALE] || '',
  });
  await likeNFTConnectedUserCollection
    .doc(wallet)
    .collection('plans')
    .doc(stripeProductId)
    .create({
      name,
      description,
      canFreeMintWNFT,
      lastUpdateTimestamp: FieldValue.serverTimestamp(),
    });
  return {
    name,
    description,
    canFreeMintWNFT,
  };
}
