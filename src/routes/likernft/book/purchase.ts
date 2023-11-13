import crypto from 'crypto';
import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import {
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  claimNFTBook,
  createNewNFTBookPayment,
  getNftBookInfo,
  processNFTBookPurchase,
  sendNFTBookClaimedEmailNotification,
  sendNFTBookPurchaseEmail,
} from '../../../util/api/likernft/book';
import stripe from '../../../util/stripe';
import { encodedURL, parseImageURLFromMetadata } from '../../../util/api/likernft/metadata';
import { FieldValue, db, likeNFTBookCollection } from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import {
  LIST_OF_BOOK_SHIPPING_COUNTRY,
  NFT_BOOK_SALE_DESCRIPTION,
  PUBSUB_TOPIC_MISC,
  USD_TO_HKD_RATIO,
  W3C_EMAIL_REGEX,
} from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth } from '../../../middleware/jwt';
import { sendNFTBookShippedEmail } from '../../../util/ses';
import { getLikerLandNFTClaimPageURL, getLikerLandNFTClassPageURL } from '../../../util/liker-land';
import { calculateStripeFee } from '../../../util/api/likernft/purchase';
import { getStripeConnectAccountId } from '../../../util/api/likernft/book/user';
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../config/config';

const router = Router();

router.get('/:classId/new', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { from = '', price_index: priceIndexString = undefined } = req.query;
    const priceIndex = Number(priceIndexString) || 0;

    const promises = [getNFTClassDataById(classId), getNftBookInfo(classId)];
    const [metadata, bookInfo] = (await Promise.all(promises)) as any;
    if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');

    const paymentId = uuidv4();
    const claimToken = crypto.randomBytes(32).toString('hex');
    const {
      prices,
      successUrl = getLikerLandNFTClaimPageURL({
        classId,
        paymentId,
        token: claimToken,
        type: 'nft_book',
        redirect: true,
      }),
      cancelUrl = getLikerLandNFTClassPageURL({ classId }),
      ownerWallet,
      connectedWallets,
      shippingRates,
      defaultPaymentCurrency = 'USD',
    } = bookInfo;
    if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
    const {
      priceInDecimal,
      stock,
      hasShipping,
      name: priceNameObj,
      description: pricDescriptionObj,
    } = prices[priceIndex];
    if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
    if (priceInDecimal === 0) {
      const freePurchaseUrl = getLikerLandNFTClaimPageURL({
        classId,
        paymentId: '',
        token: '',
        type: 'nft_book',
        free: true,
        redirect: false,
        priceIndex,
        from: from as string,
      });
      res.redirect(freePurchaseUrl);
      return;
    }
    let { name = '', description = '' } = metadata;
    const classMetadata = metadata.data.metadata;
    const iscnPrefix = metadata.data.parent.iscnIdPrefix || undefined;
    let { image } = classMetadata;
    image = parseImageURLFromMetadata(image);
    name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
    const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
    const priceDescription = typeof pricDescriptionObj === 'object' ? pricDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : pricDescriptionObj || '';
    if (priceName) {
      name = `${name} - ${priceName}`;
    }
    if (NFT_BOOK_SALE_DESCRIPTION[classId]) {
      description = NFT_BOOK_SALE_DESCRIPTION[classId];
    } else if (priceDescription) {
      description = `${description} - ${priceDescription}`;
    }
    description = description.length > 300
      ? `${description.substring(0, 299)}…`
      : description;
    if (!description) {
      description = undefined;
    } // stripe does not like empty string
    const sessionMetadata: Stripe.MetadataParam = {
      store: 'book',
      classId,
      iscnPrefix,
      paymentId,
      priceIndex,
      ownerWallet,
    };
    if (from) sessionMetadata.from = from as string;
    const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = {
      capture_method: 'manual',
      metadata: sessionMetadata,
    };

    const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
    const shouldConvertUSDtoHKD = convertedCurrency === 'HKD';
    let convertedPriceInDecimal = priceInDecimal;
    if (shouldConvertUSDtoHKD) {
      convertedPriceInDecimal = Math.ceil(convertedPriceInDecimal * USD_TO_HKD_RATIO);
    }

    if (connectedWallets && Object.keys(connectedWallets).length) {
      const wallet = Object.keys(connectedWallets)[0];
      const stripeConnectAccountId = await getStripeConnectAccountId(wallet);
      if (stripeConnectAccountId) {
        const stripeFeeAmount = calculateStripeFee(convertedPriceInDecimal, convertedCurrency);
        const likerlandFeeAmount = Math.ceil(convertedPriceInDecimal * 0.05);
        // TODO: support connectedWallets +1
        paymentIntentData.application_fee_amount = stripeFeeAmount + likerlandFeeAmount;
        paymentIntentData.transfer_data = {
          destination: stripeConnectAccountId,
        };
      }
    }

    const checkoutPayload: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      success_url: `${successUrl}`,
      cancel_url: `${cancelUrl}`,
      line_items: [
        {
          price_data: {
            currency: convertedCurrency,
            product_data: {
              name,
              description,
              images: [encodedURL(image)],
              metadata: {
                iscnPrefix,
                classId: classId as string,
              },
            },
            unit_amount: convertedPriceInDecimal,
          },
          adjustable_quantity: {
            enabled: false,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: paymentIntentData,
      metadata: sessionMetadata,
    };
    if (hasShipping) {
      checkoutPayload.shipping_address_collection = {
        // eslint-disable-next-line max-len
        allowed_countries: LIST_OF_BOOK_SHIPPING_COUNTRY as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
      };
      if (shippingRates) {
        checkoutPayload.shipping_options = shippingRates.map((s) => {
          const { name: shippingName, priceInDecimal: shippingPriceInDecimal } = s;
          let convertedShippingPriceInDecimal = shippingPriceInDecimal;
          if (shouldConvertUSDtoHKD) {
            convertedShippingPriceInDecimal = Math.ceil(shippingPriceInDecimal * USD_TO_HKD_RATIO);
          }
          return {
            shipping_rate_data: {
              display_name: shippingName[NFT_BOOK_TEXT_DEFAULT_LOCALE],
              type: 'fixed_amount',
              fixed_amount: {
                amount: convertedShippingPriceInDecimal,
                currency: convertedCurrency,
              },
            },
          };
        });
      }
    }
    const session = await stripe.checkout.sessions.create(checkoutPayload);
    const { url, id: sessionId } = session;
    if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

    await createNewNFTBookPayment(classId, paymentId, {
      type: 'stripe',
      claimToken,
      sessionId,
      priceInDecimal,
      priceName,
      priceIndex,
      from: from as string,
    });

    res.redirect(url);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseNew',
      type: 'stripe',
      paymentId,
      classId,
      priceName,
      priceIndex,
      price: priceInDecimal / 100,
      sessionId,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:classId/new/free',
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { from = '', price_index: priceIndexString = undefined } = req.query;
      const {
        email = '',
        wallet,
        message,
      } = req.body;

      if (!email && !wallet) throw new ValidationError('REQUIRE_WALLET_OR_EMAIL');
      if (email) {
        const isEmailInvalid = !W3C_EMAIL_REGEX.test(email);
        if (isEmailInvalid) throw new ValidationError('INVALID_EMAIL');
      }

      const priceIndex = Number(priceIndexString) || 0;

      const promises = [getNFTClassDataById(classId), getNftBookInfo(classId)];
      const [metadata, bookInfo] = (await Promise.all(promises)) as any;
      if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
      const {
        prices,
        notificationEmails,
        mustClaimToView = false,
      } = bookInfo;
      if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
      const {
        priceInDecimal,
        stock,
        name: priceNameObj,
      } = prices[priceIndex];
      const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
      if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
      if (priceInDecimal > 0) throw new ValidationError('NOT_FREE_PRICE');

      const bookRef = likeNFTBookCollection.doc(classId);
      if (email) {
        const query = await bookRef.collection('transactions')
          .where('email', '==', email)
          .where('type', '==', 'free')
          .limit(1)
          .get();
        if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
      }
      if (wallet) {
        const query = await bookRef.collection('transactions')
          .where('wallet', '==', wallet)
          .where('type', '==', 'free')
          .limit(1)
          .get();
        if (query.docs.length) throw new ValidationError('ALREADY_PURCHASED');
      }

      const paymentId = uuidv4();
      const claimToken = crypto.randomBytes(32).toString('hex');

      await createNewNFTBookPayment(classId, paymentId, {
        type: 'free',
        email,
        claimToken,
        priceInDecimal,
        priceName,
        priceIndex,
        from: from as string,
      });

      await processNFTBookPurchase({
        classId,
        email,
        paymentId,
        priceIndex,
        shippingDetails: null,
        shippingCost: null,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTFreePurchaseNew',
        paymentId,
        classId,
        email,
      });

      const className = metadata?.name || classId;
      await sendNFTBookPurchaseEmail({
        email,
        notificationEmails,
        classId,
        className,
        paymentId,
        claimToken,
        amountTotal: 0,
        mustClaimToView,
      });

      if (wallet) {
        await claimNFTBook(
          classId,
          paymentId,
          {
            message,
            wallet,
            token: claimToken as string,
          },
        );

        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'BookNFTClaimed',
          paymentId,
          classId,
          wallet,
          email,
          message,
        });

        await sendNFTBookClaimedEmailNotification(
          classId,
          paymentId,
          {
            message,
            wallet,
            email,
          },
        );
      }

      res.json({ claimed: !!wallet });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:classId/status/:paymentId',
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const doc = await likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).get();
      const docData = doc.data();
      if (!docData) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      res.json(filterBookPurchaseData(docData));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:classId/claim/:paymentId',
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { token } = req.query;
      const { wallet, message } = req.body;

      const email = await claimNFTBook(
        classId,
        paymentId,
        {
          message,
          wallet,
          token: token as string,
        },
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTClaimed',
        paymentId,
        classId,
        wallet,
        email,
        message,
      });
      await sendNFTBookClaimedEmailNotification(
        classId,
        paymentId,
        {
          message,
          wallet,
          email,
        },
      );

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:classId/sent/:paymentId',
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { txHash } = req.body;
      // TODO: check tx content contains valid nft info and address
      const bookRef = likeNFTBookCollection.doc(classId);
      const bookDoc = await bookRef.get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
        // TODO: check tx is sent by req.user.wallet
        throw new ValidationError('NOT_OWNER', 403);
      }
      const paymentDocRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);

      await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          status,
        } = docData;
        if (status !== 'pendingNFT') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        t.update(paymentDocRef, {
          status: 'completed',
          txHash,
        });
        t.update(bookRef, {
          pendingNFTCount: FieldValue.increment(-1),
        });
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTSentUpdate',
        paymentId,
        classId,
        // TODO: parse nftId and wallet from txHash,
        txHash,
      });

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:classId/shipping/sent/:paymentId',
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { classId, paymentId } = req.params;
      const { message } = req.body;
      // TODO: check tx content contains valid nft info and address
      const bookRef = likeNFTBookCollection.doc(classId);
      const bookDoc = await bookRef.get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
        // TODO: check tx is sent by req.user.wallet
        throw new ValidationError('NOT_OWNER', 403);
      }
      const paymentDocRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);

      const { email } = await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          shippingStatus,
          hasShipping,
        } = docData;
        if (!hasShipping) {
          throw new ValidationError('PAYMENT_DOES_NOT_HAS_SHIPPING', 409);
        }
        if (shippingStatus !== 'pending') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        t.update(paymentDocRef, {
          shippingStatus: 'shipped',
          shippingMessage: message,
        });
        return docData;
      });

      if (email) {
        const classData = await getNFTClassDataById(classId).catch(() => null);
        const className = classData?.name || classId;
        await sendNFTBookShippedEmail({
          email,
          classId,
          className,
          message,
        });
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTShippingUpdate',
        paymentId,
        classId,
        shippingMessage: message,
      });

      res.sendStatus(200);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:classId/orders',
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const bookDoc = await likeNFTBookCollection.doc(classId).get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet, moderatorWallets = [] } = bookDocData;
      const { wallet } = req.user;
      if (
        ownerWallet !== wallet
        && !moderatorWallets.includes(wallet)
        && !LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(wallet)
      ) {
        throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
      }
      const query = await likeNFTBookCollection.doc(classId).collection('transactions')
        .where('isPaid', '==', true)
        .get();
      const docDatas = query.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json({
        orders: docDatas.map((d) => filterBookPurchaseData(d)),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/:classId/messages',
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const bookDoc = await likeNFTBookCollection.doc(classId).get();
      if (!bookDoc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const query = await likeNFTBookCollection.doc(classId).collection('transactions')
        .where('status', '==', 'completed')
        .get();
      const data = query.docs.map((d) => {
        const {
          wallet,
          txHash,
          timestamp,
          message,
        } = d.data();
        return {
          wallet,
          txHash,
          timestamp: timestamp?.toMillis(),
          message,
        };
      });
      res.json({
        messages: data,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
