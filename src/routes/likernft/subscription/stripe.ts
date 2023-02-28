import { Router } from 'express';
import bodyParser from 'body-parser';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { likeNFTSubscriptionCollection } from '../../../util/firebase';
import { processStripeNFTSubscriptionInvoice, processStripeNFTSubscriptionSession } from '../../../util/api/likernft/subscription/stripe';
import { ValidationError } from '../../../util/ValidationError';
import { APP_LIKE_CO_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import {
  STRIPE_WEBHOOK_SECRET,
  LIKER_NFT_SUBSCRIPTION_PRICE_ID,
} from '../../../../config/config';

const router = Router();

router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        message: err, stack: (err as Error).stack,
      }));
      res.sendStatus(400);
      return;
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await processStripeNFTSubscriptionSession(session, req);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        await processStripeNFTSubscriptionInvoice(invoice, req);
        break;
      }
      default: {
        res.sendStatus(415);
        return;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

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
      const doc = await likeNFTSubscriptionCollection.doc(wallet).get();
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
