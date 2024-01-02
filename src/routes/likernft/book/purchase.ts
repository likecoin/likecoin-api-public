import crypto from 'crypto';
import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import { getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import {
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  getNftBookInfo,
} from '../../../util/api/likernft/book';
import { FieldValue, db, likeNFTBookCollection } from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import {
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
} from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth } from '../../../middleware/jwt';
import { sendNFTBookGiftSentEmail, sendNFTBookShippedEmail } from '../../../util/ses';
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../config/config';
import {
  handleNewStripeCheckout,
  claimNFTBook,
  execGrant,
  createNewNFTBookPayment,
  processNFTBookPurchase,
  sendNFTBookClaimedEmailNotification,
  sendNFTBookPurchaseEmail,
} from '../../../util/api/likernft/book/purchase';
import { calculatePayment } from '../../../util/api/likernft/fiat';
import { checkTxGrantAndAmount } from '../../../util/api/likernft/purchase';
import { sendNFTBookSalesSlackNotification } from '../../../util/slack';

const router = Router();

router.get('/:classId/new', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      from,
      ga_client_id: gaClientId = '',
      price_index: priceIndexString = undefined,
    } = req.query;
    const priceIndex = Number(priceIndexString) || 0;

    const {
      url,
      paymentId,
      priceName,
      priceInDecimal,
      sessionId,
    } = await handleNewStripeCheckout(classId, priceIndex, {
      gaClientId: gaClientId as string,
      from: from as string,
    });
    res.redirect(url);

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        classId,
        priceName,
        priceIndex,
        price: priceInDecimal / 100,
        sessionId,
        isGift: false,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.post('/:classId/new', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      from,
      price_index: priceIndexString = undefined,
    } = req.query;
    const priceIndex = Number(priceIndexString) || 0;
    const {
      gaClientId,
      giftInfo,
    } = req.body;

    if (giftInfo && !giftInfo.toEmail) {
      throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
    }

    const {
      url,
      paymentId,
      priceName,
      priceInDecimal,
      sessionId,
    } = await handleNewStripeCheckout(classId, priceIndex, {
      gaClientId: gaClientId as string,
      from: from as string,
      giftInfo,
    });
    res.json({ url });

    if (priceInDecimal) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseNew',
        type: 'stripe',
        paymentId,
        classId,
        priceName,
        priceIndex,
        price: priceInDecimal / 100,
        sessionId,
        isGift: !!giftInfo,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:classId/price',
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { price_index: priceIndexString } = req.query;
      const bookInfo = await getNftBookInfo(classId);

      const priceIndex = Number(priceIndexString);
      const { prices, canPayByLIKE } = bookInfo;
      if (prices.length <= priceIndex) {
        throw new ValidationError('PRICE_NOT_FOUND', 404);
      }

      const { priceInDecimal } = prices[priceIndex];
      const price = priceInDecimal / 100;

      const {
        totalLIKEPricePrediscount,
        totalLIKEPrice,
        totalFiatPriceString,
      } = await calculatePayment([price]);
      const payload = {
        LIKEPricePrediscount: canPayByLIKE ? totalLIKEPricePrediscount : null,
        LIKEPrice: canPayByLIKE ? totalLIKEPrice : null,
        fiatPrice: Number(totalFiatPriceString),
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

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
        isPhysicalOnly = false,
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
        isPhysicalOnly,
        from: from as string,
      });

      await processNFTBookPurchase({
        classId,
        email,
        paymentId,
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
      await Promise.all([
        sendNFTBookPurchaseEmail({
          email,
          notificationEmails,
          classId,
          className,
          priceName,
          paymentId,
          claimToken,
          amountTotal: 0,
          mustClaimToView,
          isPhysicalOnly,
        }),
        sendNFTBookSalesSlackNotification({
          classId,
          className,
          paymentId,
          email,
          priceName,
          priceWithCurrency: 'FREE',
          method: 'free',
        }),
      ]);

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

router.post(
  '/:classId/new/like',
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const { from: inputFrom = '', price_index: priceIndexString } = req.query;
      const {
        email,
        txHash: grantTxHash,
        giftInfo,
      } = req.body;

      const isEmailInvalid = !W3C_EMAIL_REGEX.test(email);
      if (isEmailInvalid) throw new ValidationError('INVALID_EMAIL');

      const priceIndex = Number(priceIndexString);
      if (Number.isNaN(priceIndex)) throw new ValidationError('INVALID_PRICE_INDEX');

      if (giftInfo && !giftInfo.toEmail) {
        throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
      }

      const [metadata, bookInfo] = await Promise.all([
        getNFTClassDataById(classId).catch(() => null),
        getNftBookInfo(classId),
      ]);

      const {
        ownerWallet,
        prices,
        defaultPaymentCurrency,
        defaultFromChannel = NFT_BOOK_DEFAULT_FROM_CHANNEL,
      } = bookInfo;
      if (prices.length <= priceIndex) {
        throw new ValidationError('PRICE_NOT_FOUND', 404);
      }
      let from: string = inputFrom as string || '';
      if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
        from = defaultFromChannel || NFT_BOOK_DEFAULT_FROM_CHANNEL;
      }
      const {
        priceInDecimal,
        isPhysicalOnly = false,
        name: { en: priceNameEn },
      } = prices[priceIndex];
      const price = priceInDecimal / 100;

      const { totalLIKEPrice: LIKEPrice } = await calculatePayment([price]);

      const checkResult = await checkTxGrantAndAmount(grantTxHash, LIKEPrice);
      if (!checkResult) throw new ValidationError('SEND_GRANT_NOT_FOUND');
      const {
        granter: granterWallet,
        memo: message,
      } = checkResult;

      const paymentId = uuidv4();
      const claimToken = crypto.randomBytes(32).toString('hex');

      await createNewNFTBookPayment(classId, paymentId, {
        type: 'LIKE',
        email,
        claimToken,
        priceInDecimal,
        priceName: priceNameEn,
        priceIndex,
        giftInfo,
        from,
        isPhysicalOnly,
      });
      const execGrantTxHash = await execGrant(granterWallet, ownerWallet, LIKEPrice, from);
      const { listingData } = await processNFTBookPurchase({
        classId,
        email,
        paymentId,
        shippingDetails: null,
        shippingCost: null,
        execGrantTxHash,
      });
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTLIKEPurchaseNew',
        paymentId,
        classId,
        wallet: granterWallet,
        email,
      });
      const className = metadata?.name || classId;
      await sendNFTBookSalesSlackNotification({
        classId,
        className,
        paymentId,
        email,
        priceName: priceNameEn,
        priceWithCurrency: `${LIKEPrice} LIKE (${price} ${defaultPaymentCurrency || 'USD'})`,
        method: 'LIKE',
      });

      let claimed = false;
      if (!giftInfo) {
        await claimNFTBook(classId, paymentId, {
          message,
          wallet: granterWallet,
          token: claimToken,
        });
        claimed = true;
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'BookNFTClaimed',
          paymentId,
          classId,
          wallet: granterWallet,
          email,
          message,
        });
      } else {
        const {
          notificationEmails = [],
          mustClaimToView = false,
        } = listingData;
        await sendNFTBookPurchaseEmail({
          email,
          isGift: !!giftInfo,
          giftInfo,
          notificationEmails,
          classId,
          className,
          priceName: priceNameEn,
          paymentId,
          claimToken,
          amountTotal: price,
          mustClaimToView,
          isPhysicalOnly,
        });
      }
      res.json({ claimed });
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

      const { email, isGift, giftInfo } = await db.runTransaction(async (t) => {
        const doc = await t.get(paymentDocRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          status,
          isPhysicalOnly,
        } = docData;
        if (status !== 'pendingNFT') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        if (isPhysicalOnly) {
          throw new ValidationError('CANNOT_SEND_PHYSICAL_ONLY', 409);
        }
        t.update(paymentDocRef, {
          status: 'completed',
          txHash,
        });
        t.update(bookRef, {
          pendingNFTCount: FieldValue.increment(-1),
        });
        return docData;
      });

      if (isGift && giftInfo) {
        const {
          fromName,
          toName,
        } = giftInfo;
        const classData = await getNFTClassDataById(classId).catch(() => null);
        const className = classData?.name || classId;
        await sendNFTBookGiftSentEmail({
          fromEmail: email,
          fromName,
          toName,
          className,
          txHash,
        });
      }

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTSentUpdate',
        paymentId,
        classId,
        // TODO: parse nftId and wallet from txHash,
        txHash,
        isGift,
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
          isPhysicalOnly,
          hasShipping,
        } = docData;
        if (!hasShipping) {
          throw new ValidationError('PAYMENT_DOES_NOT_HAS_SHIPPING', 409);
        }
        if (shippingStatus !== 'pending') {
          throw new ValidationError('STATUS_IS_ALREADY_SENT', 409);
        }
        const updatePayload: any = {
          shippingStatus: 'shipped',
          shippingMessage: message,
        };
        if (isPhysicalOnly) updatePayload.status = 'completed';
        t.update(paymentDocRef, updatePayload);
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
