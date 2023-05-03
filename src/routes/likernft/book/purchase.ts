import { Router } from 'express';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';
import { getISCNFromNFTClassId, getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { getNftBookInfo } from '../../../util/api/likernft/book';
import stripe from '../../../util/stripe';
import { parseImageURLFromMetadata } from '../../../util/api/likernft/metadata';
import { FieldValue, likeNFTBookCollection } from '../../../util/firebase';
import publisher from '../../../util/gcloudPub';
import { NFT_BOOKSTORE_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import { filterBookPurchaseData } from '../../../util/ValidationHelper';
import { jwtAuth } from '../../../middleware/jwt';

const router = Router();

router.post('/:classId/new', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { from = '' } = req.query;

    const promises = [getNFTClassDataById(classId)];
    const getBookInfoPromise = getNftBookInfo(classId);
    promises.push(getBookInfoPromise);
    const [metadata, bookInfo] = (await Promise.all(promises)) as any;
    if (!bookInfo) throw new ValidationError('NFT_PRICE_NOT_FOUND');

    const paymentId = uuidv4();
    const {
      priceInDecimal,
      stock,
      successUrl = `https://${NFT_BOOKSTORE_HOSTNAME}/nft/fiat/stripe`,
      cancelUrl = `https://${NFT_BOOKSTORE_HOSTNAME}/nft/class/${classId}`,
      ownerWallet,
    } = bookInfo;
    if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
    let { name = '', description = '' } = metadata;
    const classMetadata = metadata.data.metadata;
    let { image } = classMetadata;
    image = parseImageURLFromMetadata(image);
    name = name.length > 100 ? `${name.substring(0, 99)}…` : name;
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
      ownerWallet,
    };
    if (from) sessionMetadata.from = from as string;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${successUrl}?class_id=${classId}&payment_id=${paymentId}`,
      cancel_url: `${cancelUrl}`,
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
      },
      metadata: sessionMetadata,
    });
    const { url, id: sessionId } = session;
    await likeNFTBookCollection.doc(classId).collection('transactions').doc(paymentId).create({
      type: 'stripe',
      isPaid: false,
      isPendingClaim: false,
      sessionId,
      classId,
      priceInDecimal,
      price: priceInDecimal / 100,
      from,
      status: 'new',
      timestamp: FieldValue.serverTimestamp(),
    });
    res.json({
      id: sessionId,
      url,
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseNew',
      type: 'stripe',
      paymentId,
      classId,
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
      if (!doc.data()) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      const docData = doc.data();
      res.json(filterBookPurchaseData(docData));
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
      const result = await getISCNFromNFTClassId(classId);
      if (!result) throw new ValidationError('CLASS_ID_NOT_FOUND');
      const { owner: ownerWallet } = result;
      if (ownerWallet !== req.user.wallet) {
        throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
      }
      const query = await likeNFTBookCollection.doc(classId).collection('transactions')
        .where('isPaid', '==', true)
        .get();
      const docDatas = query.docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json(docDatas.map((d) => filterBookPurchaseData(d)));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
