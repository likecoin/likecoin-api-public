import { Router } from 'express';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { ValidationError } from '../../../util/ValidationError';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import { getLikerLandNFTPortfolioPageURL, getLikerLandNFTSubscriptionSuccessPageURL, getLikerLandURL } from '../../../util/liker-land';
import { getUserStripeConnectInfo } from '../../../util/api/likernft/connect';
import { getSubscriptionUserInfo } from '../../../util/api/likernft/subscription/readers';
import { jwtAuth } from '../../../middleware/jwt';

const router = Router();

router.post(
  '/new',
  async (req, res, next) => {
    try {
      const creatorWallet = req.query.creator_wallet as string;
      // TODO: use req.user for wallet instead of query string
      const { wallet, plan } = req.query;

      if (!(creatorWallet) && !isValidLikeAddress(creatorWallet)) throw new ValidationError('INVALID_CREATOR_WALLET');
      if (!(wallet) && !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const {
        email,
      } = req.body;
      const [creatorData, readerData] = await Promise.all([
        getUserStripeConnectInfo(creatorWallet),
        getSubscriptionUserInfo(wallet as string),
      ]);
      if (!creatorData) { throw new ValidationError('CREATOR_NOT_SETUP_ACCOUNT', 409); }
      const {
        defaultStripePriceId,
        stripePriceIds = [],
        stripeConnectAccountId,
        isStripeConnectReady,
      } = creatorData;
      if (!isStripeConnectReady) { throw new ValidationError('CREATOR_NOT_SETUP_ACCOUNT', 409); }
      if (!defaultStripePriceId || !stripePriceIds.length) { throw new ValidationError('CREATOR_NOT_SETUP_ANY_PLANS', 404); }
      let priceId = plan;
      if (!priceId || !stripePriceIds.includes(priceId)) {
        priceId = defaultStripePriceId;
      }

      let customerId;
      let customerEmail = email;
      if (readerData?.customer?.customerId) {
        customerId = readerData?.customer?.customerId;
        customerEmail = undefined;
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            price: priceId as string,
            quantity: 1,
          },
        ],
        success_url: getLikerLandNFTSubscriptionSuccessPageURL({
          creatorWallet,
        }),
        customer: customerId,
        customer_email: customerEmail,
        cancel_url: getLikerLandNFTPortfolioPageURL({ wallet: creatorWallet }),
        metadata: {
          store: 'likerland',
          type: 'subscription',
          wallet: wallet as string,
          creatorWallet,
        },
        subscription_data: {
          application_fee_percent: 10, // TODO: calculate flat stripe fee
          metadata: {
            wallet: wallet as string,
            creatorWallet,
          },
          transfer_data: {
            destination: stripeConnectAccountId,
          },
        },
      });
      const { url, id: sessionId } = session;
      res.json({
        id: sessionId,
        url,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTSubscriptionNew',
        type: 'stripe',
        buyerWallet: wallet,
        creatorWallet,
        sessionId,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/portal',
  jwtAuth('write:nft_reader'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const {
        customer: {
          customerId = '',
        } = {},
      } = await getSubscriptionUserInfo(wallet as string);
      if (!customerId) throw new ValidationError('NO_STRIPE_CUSTOMER_ID');
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: getLikerLandURL('/dashboard'),
      });
      const { url, id: sessionId } = session;
      res.json({
        id: sessionId,
        url,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTSubscriptionPortalSession',
        type: 'stripe',
        wallet,
        sessionId,
        customerId,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
