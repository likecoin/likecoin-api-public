import { Router } from 'express';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { ValidationError } from '../../../util/ValidationError';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import { getLikerLandNFTPortfolioPageURL, getLikerLandNFTSubscriptionSuccessPageURL } from '../../../util/liker-land';
import { getUserStripeConnectInfo } from '../../../util/api/likernft/connect';

const router = Router();

router.post(
  '/new',
  async (req, res, next) => {
    try {
      const creatorWallet = req.query.creator_wallet as string;
      const { wallet, plan } = req.query;

      if (!(wallet) && !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const {
        email,
      } = req.body;
      const userData = await getUserStripeConnectInfo(creatorWallet);
      if (!userData) { throw new ValidationError('CREATOR_NOT_SETUP_ACCOUNT', 409); }
      const {
        defaultStripePriceId,
        stripePriceIds = [],
        stripeConnectAccountId,
        isStripeConnectReady,
      } = userData;
      if (!isStripeConnectReady) { throw new ValidationError('CREATOR_NOT_SETUP_ACCOUNT', 409); }
      if (!defaultStripePriceId || !stripePriceIds.length) { throw new ValidationError('CREATOR_NOT_SETUP_ANY_PLANS', 404); }
      let priceId = plan;
      if (!priceId || !stripePriceIds.includes(priceId)) {
        priceId = defaultStripePriceId;
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
        customer_email: email,
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

export default router;
