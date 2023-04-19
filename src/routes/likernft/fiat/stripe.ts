import { Router } from 'express';
import bodyParser from 'body-parser';
import BigNumber from 'bignumber.js';
import uuidv4 from 'uuid/v4';

import stripe from '../../../util/stripe';
import { isValidLikeAddress } from '../../../util/cosmos';
import { likeNFTFiatCollection } from '../../../util/firebase';
import { fetchISCNPrefixFromChain } from '../../../middleware/likernft';
import { getFiatPriceStringForLIKE } from '../../../util/api/likernft/fiat';
import { processStripeFiatNFTPurchase, findPaymentFromStripeSessionId } from '../../../util/api/likernft/fiat/stripe';
import { getGasPrice, softGetLatestNFTPriceAndInfo } from '../../../util/api/likernft/purchase';
import { formatListingInfo, fetchNFTListingInfo, fetchNFTListingInfoByNFTId } from '../../../util/api/likernft/listing';
import { checkIsWritingNFT, DEFAULT_NFT_IMAGE_SIZE, parseImageURLFromMetadata } from '../../../util/api/likernft/metadata';
import { getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { filterLikeNFTFiatData } from '../../../util/ValidationHelper';
import { API_EXTERNAL_HOSTNAME, LIKER_LAND_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

import {
  STRIPE_WEBHOOK_SECRET,
  LIKER_NFT_FEE_ADDRESS,
} from '../../../../config/config';
import { processStripeNFTSubscriptionInvoice, processStripeNFTSubscriptionSession } from '../../../util/api/likernft/subscription/stripe';

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
        const {
          subscription: subscriptionId,
        } = session;
        if (subscriptionId) {
          await processStripeNFTSubscriptionSession(session, req);
        } else {
          await processStripeFiatNFTPurchase(session, req);
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object;
        const {
          subscription: subscriptionId,
        } = invoice;
        if (subscriptionId) {
          await processStripeNFTSubscriptionInvoice(invoice, req);
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

router.get(
  '/price',
  fetchISCNPrefixFromChain,
  async (req, res, next) => {
    try {
      const classId = req.query.class_id as string;
      const { iscnPrefix } = res.locals;
      const [
        purchaseInfo,
        listingInfo,
      ] = await Promise.all([
        iscnPrefix ? softGetLatestNFTPriceAndInfo(iscnPrefix, classId) : null,
        fetchNFTListingInfo(classId),
      ]);
      const firstListing = listingInfo
        .map(formatListingInfo)
        .sort((a, b) => a.price - b.price)[0];

      if (!purchaseInfo && !firstListing) {
        res.status(404).send('NFT_PRICE_NOT_FOUND');
        return;
      }

      const isListing = !purchaseInfo || (firstListing && firstListing.price <= purchaseInfo.price);
      const price = isListing ? firstListing.price : purchaseInfo.price;
      const gasFee = getGasPrice();
      const totalPrice = price + gasFee;
      const fiatPriceString = await getFiatPriceStringForLIKE(totalPrice);
      const payload: {
        LIKEPrice: number,
        fiatPrice: number,
        fiatPriceString: string,
        isListing: boolean,
        listingInfo: null | {
          nftId: string,
          seller: string,
        },
      } = {
        LIKEPrice: totalPrice,
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
        isListing,
        listingInfo: null,
      };
      if (isListing) {
        const { nftId, seller } = firstListing;
        payload.listingInfo = {
          nftId,
          seller,
        };
      }
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/new',
  fetchISCNPrefixFromChain,
  async (req, res, next) => {
    try {
      const classId = req.query.class_id as string;
      let { wallet } = req.query;
      const dummyWallet = LIKER_NFT_FEE_ADDRESS;
      if (!(wallet || dummyWallet) && !isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const isPendingClaim = !wallet;
      const { iscnPrefix } = res.locals;
      const promises = [getNFTClassDataById(classId)];
      const { nftId = '', seller = '', memo } = req.body;
      const isListing = !!(nftId && seller);
      if (!isListing && !iscnPrefix) {
        throw new ValidationError('NFT_PRICE_NOT_FOUND');
      }
      const getPriceInfoPromise = isListing
        ? fetchNFTListingInfoByNFTId(classId, nftId)
          .then((info) => {
            if (!info) throw new ValidationError('LISTING_NOT_FOUND');
            const listingInfo = formatListingInfo(info);
            if (!listingInfo) throw new ValidationError('LISTING_NOT_FOUND');
            if (listingInfo.seller !== seller) throw new ValidationError('LISTING_SELLER_NOT_MATCH');
            return listingInfo;
          })
        : softGetLatestNFTPriceAndInfo(iscnPrefix, classId);
      promises.push(getPriceInfoPromise);
      const [metadata, priceInfo] = await Promise.all(promises) as any;
      if (!priceInfo) throw new ValidationError('NFT_PRICE_NOT_FOUND');
      const { price } = priceInfo;
      let {
        name = '',
        description = '',
      } = metadata;
      const classMetadata = metadata.data.metadata;
      let { image } = classMetadata;
      const { is_custom_image: isCustomImage = false } = classMetadata;
      if (checkIsWritingNFT(classMetadata) && !isCustomImage) {
        image = `https://${API_EXTERNAL_HOSTNAME}/likernft/metadata/image/class_${classId}?size=${DEFAULT_NFT_IMAGE_SIZE}`;
      } else {
        image = parseImageURLFromMetadata(image);
      }
      if (!image) {
        image = 'https://static.like.co/primitive-nft.jpg';
      }
      const gasFee = getGasPrice();
      const totalPrice = price + gasFee;
      const fiatPriceString = await getFiatPriceStringForLIKE(totalPrice);
      const paymentId = uuidv4();
      name = name.length > 100 ? `${name.substring(0, 99)}…` : name;
      description = description.length > 200 ? `${description.substring(0, 199)}…` : description;
      if (!description) { description = undefined; } // stripe does not like empty string
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
          isListing,
          nftId,
          seller,
          memo,
          iscnPrefix,
          paymentId,
          isPendingClaim: isPendingClaim ? 'true' : undefined,
        },
      });
      const { url, id: sessionId } = session;
      if (isPendingClaim) {
        wallet = dummyWallet;
      }
      await likeNFTFiatCollection.doc(paymentId).create({
        type: 'stripe',
        sessionId,
        wallet,
        classId,
        isListing,
        nftId,
        seller,
        memo,
        iscnPrefix,
        LIKEPrice: totalPrice,
        fiatPrice: Number(fiatPriceString),
        fiatPriceString,
        status: 'new',
        timestamp: Date.now(),
        isPendingClaim,
      });
      const LIKEPrice = totalPrice;
      const fiatPrice = Number(fiatPriceString);
      res.json({
        id: sessionId,
        url,
        LIKEPrice,
        fiatPrice,
        fiatPriceString,
        isPendingClaim,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'LikerNFTFiatPaymentNew',
        type: 'stripe',
        paymentId,
        buyerWallet: wallet,
        buyerMemo: memo,
        isListing,
        sellerWallet: seller,
        nftId,
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
