import { Router } from 'express';

import { isValidLikeAddress } from '../../../util/cosmos';
import {
  likeNFTSubscriptionTxCollection,
} from '../../../util/firebase';
import { ValidationError } from '../../../util/ValidationError';
import { checkUserIsActiveNFTSubscriber, createNewMintTransaction, getAllMintTransaction } from '../../../util/api/likernft/subscription';

const router = Router();

router.post(
  '/mint/new',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const isActiveUser = await checkUserIsActiveNFTSubscriber(wallet as string);
      if (!isActiveUser) throw new ValidationError('NOT_SUBSCRIBED');
      const statusId = await createNewMintTransaction(wallet as string);
      res.json({
        statusId,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/mint/status/:statusId',
  async (req, res, next) => {
    try {
      const { statusId } = req.params;
      const doc = await likeNFTSubscriptionTxCollection.doc(statusId).get();
      const docData = doc.data();
      if (!docData) {
        res.status(404).send('PAYMENT_ID_NOT_FOUND');
        return;
      }
      res.json(docData);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/mint/status/list',
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!isValidLikeAddress(wallet)) throw new ValidationError('INVALID_WALLET');
      const list = await getAllMintTransaction(wallet as string);
      res.json({ list });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
