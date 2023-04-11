import { Router } from 'express';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { ValidationError } from '../../../util/ValidationError';
import { APP_LIKE_CO_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import {
  LIKER_NFT_SUBSCRIPTION_PRICE_ID,
} from '../../../../config/config';
import { checkUserIsActiveNFTSubscriber } from '../../../util/api/likernft/subscription';
import { checkCosmosSignPayload } from '../../../util/api/users';

const router = Router();

router.post(
  '/new',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const { isActive: isActiveUser } = await checkUserIsActiveNFTSubscriber(wallet as string);
      if (isActiveUser) throw new ValidationError('ALREADY_SUBSCRIBED');
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
          metadata: {
            wallet,
          },
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

router.post(
  '/portal',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const { signature, publicKey, message } = req.body;
      if (!checkCosmosSignPayload({
        signature, publicKey, message, inputWallet: wallet as string, action: 'subscription_portal',
      })) {
        throw new ValidationError('INVALID_SIGN', 401);
      }
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const {
        isActive: isActiveUser,
        stripe: stripeData,
      } = await checkUserIsActiveNFTSubscriber(wallet as string);
      if (!isActiveUser) throw new ValidationError('NOT_SUBSCRIBED');
      if (!stripeData?.customerId) throw new ValidationError('NO_STRIPE_CUSTOMER_ID');
      const { customerId } = stripeData;
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `https://${APP_LIKE_CO_HOSTNAME}/nft/subscription`,
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
