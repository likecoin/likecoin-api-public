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
import { LIKER_LAND_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

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
      console.error(JSON.stringify({
        message: err, stack: err.stack,
      }));
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

router.get(
  '/price',
  fetchISCNPrefixAndClassId,
  async (_, res, next) => {
    try {
      const { classId, iscnPrefix } = res.locals;
      const {
        price,
        // nextPriceLevel,
      } = await getLatestNFTPriceAndInfo(iscnPrefix, classId);
      const gasFee = getGasPrice();
      const totalPrice = price + gasFee;
      const fiatPriceString = await getFiatPriceStringForLIKE(totalPrice);
      res.json({
        LIKEPrice: totalPrice,
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
      });
    } catch (err) {
      next(err);
    }
  },
);

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
      let { name = '', description = '' } = metadata;
      const { image } = metadata;
      const gasFee = getGasPrice();
      const totalPrice = price + gasFee;
      const fiatPriceString = await getFiatPriceStringForLIKE(totalPrice);
      const paymentId = uuidv4();
      name = name.length > 100 ? `${name.substring(0, 99)}…` : name;
      description = description.length > 200 ? `${description.substring(0, 199)}…` : description;
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: `https://${LIKER_LAND_HOSTNAME}/nft/fiat/stripe?class_id=${classId}&payment_id=${paymentId}`,
        cancel_url: `https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}`,
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
              unit_amount: Number(new BigNumber(fiatPriceString).shiftedBy(2).toFixed(0)),
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
      const { url, id: sessionId } = session;
      await likeNFTFiatCollection.doc(paymentId).create({
        type: 'stripe',
        sessionId,
        wallet,
        classId,
        iscnPrefix,
        LIKEPrice: totalPrice,
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
        status: 'new',
        timestamp: Date.now(),
      });
      const LIKEPrice = totalPrice;
      const fiatPrice = Number(fiatPriceString);
      res.json({
        id: sessionId,
        url,
        LIKEPrice,
        fiatPrice,
        fiatPriceString,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTFiatPaymentNew',
        type: 'stripe',
        paymentId,
        buyerWallet: wallet,
        classId,
        iscnPrefix,
        fiatPrice,
        LIKEPrice,
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
