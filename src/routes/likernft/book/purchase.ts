import crypto from 'crypto';
import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { getNftBookInfo } from '../../../util/api/likernft/book';
import stripe from '../../../util/stripe';
import { encodedURL, parseImageURLFromMetadata } from '../../../util/api/likernft/metadata';
import { FieldValue, db, likeNFTBookCollection } from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth } from '../../../middleware/jwt';
import { sendNFTBookClaimedEmail } from '../../../util/ses';
import { getLikerLandNFTClaimPageURL, getLikerLandNFTClassPageURL } from '../../../util/liker-land';

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
      }),
      cancelUrl = getLikerLandNFTClassPageURL({ classId }),
      ownerWallet,
    } = bookInfo;
    if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
    const {
      priceInDecimal,
      stock,
      name: priceName,
    } = prices[priceIndex];
    if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
    let { name = '', description = '' } = metadata;
    const classMetadata = metadata.data.metadata;
    let { image } = classMetadata;
    image = parseImageURLFromMetadata(image);
    name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
    if (priceName) {
      name = `${name} - ${priceName}`;
    }
    description = description.length > 200
      ? `${description.substring(0, 199)}…`
      : description;
    if (!description) {
      description = undefined;
    } // stripe does not like empty string
    const sessionMetadata: Stripe.MetadataParam = {
      store: 'book',
      classId,
      paymentId,
      priceIndex,
      ownerWallet,
    };
    if (from) sessionMetadata.from = from as string;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${successUrl}`,
      cancel_url: `${cancelUrl}`,
      line_items: [
        {
          price_data: {
            currency: 'USD',
            product_data: {
              name,
              description,
              images: [encodedURL(image)],
              metadata: {
                classId: classId as string,
              },
            },
            unit_amount: priceInDecimal,
          },
          adjustable_quantity: {
            enabled: false,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        capture_method: 'manual',
        metadata: sessionMetadata,
      },
      metadata: sessionMetadata,
    });
    const { url, id: sessionId } = session;
    if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');
    await likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).create({
      type: 'stripe',
      isPaid: false,
      isPendingClaim: false,
      claimToken,
      sessionId,
      classId,
      priceInDecimal,
      price: priceInDecimal / 100,
      priceName,
      priceIndex,
      from,
      status: 'new',
      timestamp: FieldValue.serverTimestamp(),
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
      const bookRef = likeNFTBookCollection.doc(classId);
      const docRef = likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId);

      const { email } = await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        const docData = doc.data();
        if (!docData) {
          throw new ValidationError('PAYMENT_ID_NOT_FOUND', 404);
        }
        const {
          claimToken,
          status,
        } = docData;
        if (token !== claimToken) {
          throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
        }
        if (status !== 'paid') {
          throw new ValidationError('PAYMENT_ALREADY_CLAIMED', 409);
        }
        t.update(docRef, {
          status: 'pendingNFT',
          wallet,
          message: message || '',
        });
        t.update(bookRef, {
          pendingNFTCount: FieldValue.increment(1),
        });
        return docData;
      });

      const doc = await bookRef.get();
      const docData = doc.data();
      if (!docData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { notificationEmails } = docData;
      await sendNFTBookClaimedEmail({
        emails: notificationEmails,
        classId,
        paymentId,
        wallet,
        buyerEmail: email,
        message,
      })

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
      const bookRef = likeNFTBookCollection.doc(classId);
      const bookDoc = await bookRef.get();
      const bookDocData = bookDoc.data();
      if (!bookDocData) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const { ownerWallet } = bookDocData;
      if (ownerWallet !== req.user.wallet) throw new ValidationError('NOT_OWNER', 403);

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
      if (ownerWallet !== req.user.wallet && !moderatorWallets.includes(req.user.wallet)) {
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

export default router;
