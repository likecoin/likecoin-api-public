import { Router } from 'express';
import bodyParser from 'body-parser';

import stripe from '../../../util/stripe';
import { likeNFTFiatCollection } from '../../../util/firebase';
import { fetchISCNPrefixAndClassId } from '../../../middleware/likernft';
import { getFiatPriceForLIKE } from '../../../util/api/likernft/fiat';
import { getGasPrice, getLatestNFTPriceAndInfo } from '../../../util/api/likernft/purchase';
import { getClassMetadata } from '../../../util/api/likernft/metadata';
import { ValidationError } from '../../../util/ValidationError';
import { filterLikeNFTFiatData } from '../../../util/ValidationHelper';
import { LIKER_LAND_HOSTNAME } from '../../../constant';

import { STRIPE_WEBHOOK_SECRET } from '../../../../config/config';

const uuidv4 = require('uuid/v4');

const router = Router();

router.post(
  '/stripe/new',
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

export default router;
