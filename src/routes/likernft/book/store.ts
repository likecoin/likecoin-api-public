import { Router } from 'express';
import { getNftBookInfo, listNftBookInfoByOwnerWallet, newNftBookInfo } from '../../../util/api/likernft/book';
import { getISCNFromNFTClassId } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth } from '../../../middleware/jwt';

const router = Router();

router.get('/list', async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet) throw new ValidationError('INVALID_WALLET');
    const bookInfos = await listNftBookInfoByOwnerWallet(wallet as string);

    const list = bookInfos.map((b) => {
      const {
        priceInDecimal,
        stock,
        sold,
        id,
      } = b;
      const price = priceInDecimal / 100;
      return {
        classId: id,
        price,
        priceInDecimal,
        sold,
        stock,
      };
    });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

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
      sold,
    } = bookInfo;
    const price = priceInDecimal / 100;
    res.json({
      price,
      priceInDecimal,
      sold,
      stock,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:classId/new', jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      successUrl,
      cancelUrl,
      priceInDecimal,
      stock,
    } = req.body;
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
