import { Router } from 'express';
import { getNftBookInfo, newNftBookInfo } from '../../../util/api/likernft/book';
import { getISCNFromNFTClassId } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';

const router = Router();

router.get('/:classId', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const bookInfo = await getNftBookInfo(classId);

    if (!bookInfo) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }
    const {
      priceInDecimal,
      stock,
    } = bookInfo;
    const price = priceInDecimal / 100;
    res.json({
      price,
      priceInDecimal,
      stock,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:classId/new', async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { payload } = req.body;
    const {
      successUrl,
      cancelUrl,
      priceInDecimal,
      stock,
    } = payload;
    const result = await getISCNFromNFTClassId(classId);
    if (!result) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const { owner: ownerWallet } = result;
    if (ownerWallet !== req.user.wallet) {
      throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    }
    await newNftBookInfo(classId, {
      ownerWallet,
      successUrl,
      cancelUrl,
      priceInDecimal,
      stock,
    });
    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
