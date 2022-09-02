import { Router } from 'express';
import bodyParser from 'body-parser';

import stripe from '../../../util/stripe';
import { likeNFTFiatCollection } from '../../../util/firebase';
import { fetchISCNPrefixAndClassId } from '../../../middleware/likernft';
import { getFiatPriceForLIKE } from '../../../util/api/likernft/fiat';
import { processStripeFiatNFTPurchase, findPaymentFromStripeSessionId } from '../../../util/api/likernft/fiat/stripe';
import { getGasPrice, getLatestNFTPriceAndInfo } from '../../../util/api/likernft/purchase';
import { getClassMetadata } from '../../../util/api/likernft/metadata';
import { ValidationError } from '../../../util/ValidationError';
import { filterLikeNFTFiatData } from '../../../util/ValidationHelper';
import { LIKER_LAND_HOSTNAME } from '../../../constant';

import { STRIPE_WEBHOOK_SECRET } from '../../../../config/config';

const uuidv4 = require('uuid/v4');

const router = Router();

router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.sendStatus(400);
      return;
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.payment_status === 'paid') {
          await processStripeFiatNFTPurchase(session, req);
        }
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
  fetchISCNPrefixAndClassId,
  async (req, res, next) => {
    try {
      const {
        wallet,
      } = req.query;
      const { classId, iscnPrefix } = res.locals;
      const [{
        price,
        // nextPriceLevel,
      }, {
        image,
        description,
        name,
        iscnId,
      }] = await Promise.all([
        getLatestNFTPriceAndInfo(iscnPrefix, classId),
        getClassMetadata({ classId, iscnPrefix }),
      ]);
      const gasFee = getGasPrice();
      const totalPrice = price + gasFee;
      const fiatPrice = getFiatPriceForLIKE(totalPrice);
      const paymentId = uuidv4();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: `https://${LIKER_LAND_HOSTNAME}/nft/fiat/stripe?class_id=${classId}&payment_id=${paymentId}`,
        cancel_url: `https://${LIKER_LAND_HOSTNAME}/nft/${classId}`,
        line_items: [
          {
            // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
            price_data: {
              currency: 'USD',
              product_data: {
                name,
                description,
                images: [image],
                metadata: {
                  iscnId,
                  classId,
                },
              },
              unit_amount: fiatPrice * 100,
            },
            adjustable_quantity: {
              enabled: false,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          capture_method: 'manual',
        },
        metadata: {
          wallet,
          classId,
          iscnId,
          paymentId,
        },
      });
      const { url, id } = session;
      await likeNFTFiatCollection.doc(paymentId).create({
        type: 'stripe',
        sessionId: id,
        wallet,
        classId,
        iscnPrefix,
        LIKEPrice: totalPrice,
        fiatPrice,
        status: 'new',
        timestamp: Date.now(),
      });
      res.json({
        id,
        url,
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
      const { payment_id: paymentId, session_id: sessionId } = req.query;
      if (!paymentId && !sessionId) throw new ValidationError('PAYMENT_ID_NEEDED');
      let doc;
      if (paymentId) {
        doc = await likeNFTFiatCollection.doc(paymentId).get();
      } else {
        doc = await findPaymentFromStripeSessionId(sessionId);
      }
      if (!doc.data()) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      const docData = doc.data();
      res.json(filterLikeNFTFiatData(docData));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
