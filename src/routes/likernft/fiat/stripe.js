import { Router } from 'express';
import bodyParser from 'body-parser';
import BigNumber from 'bignumber.js';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { likeNFTFiatCollection } from '../../../util/firebase';
import { fetchISCNPrefixAndClassId } from '../../../middleware/likernft';
import { getFiatPriceStringForLIKE } from '../../../util/api/likernft/fiat';
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
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      res.sendStatus(400);
      return;
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await processStripeFiatNFTPurchase(session, req);
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
      const { wallet } = req.query;
      if (!wallet || !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const { classId, iscnPrefix } = res.locals;
      const [{
        price,
        // nextPriceLevel,
      }, {
        classData,
        chainData,
        dynamicData,
      }] = await Promise.all([
        getLatestNFTPriceAndInfo(iscnPrefix, classId),
        getClassMetadata({ classId, iscnPrefix }),
      ]);
      const metadata = {
        ...(classData.metadata || {}),
        ...chainData,
        ...dynamicData,
      };
      const { image, name, description } = metadata;
      const gasFee = getGasPrice();
      const totalPrice = price + gasFee;
      const fiatPriceString = await getFiatPriceStringForLIKE(totalPrice);
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
                  iscnPrefix,
                  classId,
                },
              },
              unit_amount: new BigNumber(fiatPriceString).shiftedBy(2).toNumber(),
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
          iscnPrefix,
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
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
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
