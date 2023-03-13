import { Router } from 'express';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { likeNFTSubscriptionUserCollection } from '../../../util/firebase';
import { ValidationError } from '../../../util/ValidationError';
import { APP_LIKE_CO_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import {
  LIKER_NFT_SUBSCRIPTION_PRICE_ID,
} from '../../../../config/config';

const router = Router();

router.post(
  '/new',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!wallet || !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        success_url: `https://${APP_LIKE_CO_HOSTNAME}/nft/subscription/success`,
        cancel_url: `https://${APP_LIKE_CO_HOSTNAME}/nft/subscription/cancel`,
        line_items: [
          {
            price: LIKER_NFT_SUBSCRIPTION_PRICE_ID,
            quantity: 1,

          },
        ],
        metadata: {
          wallet,
        },
        subscription_data: {
          wallet,
        },
      });
      const { url, id: sessionId } = session;
      res.json({
        id: sessionId,
        url,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTSubscriptionNewSession',
        type: 'stripe',
        wallet,
        planId: LIKER_NFT_SUBSCRIPTION_PRICE_ID,
        sessionId,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/status',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const doc = await likeNFTSubscriptionUserCollection.doc(wallet).get();
      if (!doc.data()) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      const {
        currentPeriodEnd,
        currentPeriodStart,
      } = doc.data();
      const isActive = currentPeriodStart < Date.now()
        && currentPeriodEnd > Date.now();
      res.json({ isActive });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
