import { Router } from 'express';
import { getNftBookInfo, listNftBookInfoByOwnerWallet, newNftBookInfo } from '../../../util/api/likernft/book';
import { getISCNFromNFTClassId } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';

const router = Router();

router.get('/list', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet) throw new ValidationError('INVALID_WALLET');
    const bookInfos = await listNftBookInfoByOwnerWallet(wallet as string);
    const list = bookInfos.map((b) => {
      const {
        prices: docPrices = [],
        pendingNFTCount,
        id,
      } = b;
      let sold = 0;
      let stock = 0;
      const prices: any[] = [];
      docPrices.forEach((p) => {
        const {
          priceInDecimal,
          sold: pSold = 0,
          stock: pStock = 0,
          ...data
        } = p;
        const price = priceInDecimal / 100;
        const payload = {
          price,
          priceInDecimal,
          ...data,
        };
        if (req.user && req.user.wallet === wallet) {
          payload.sold = pSold;
          payload.stock = pStock;
        }
        prices.push(payload);
        sold += pSold;
        stock += pStock;
      });

      const result: any = {
        classId: id,
        prices,
        pendingNFTCount,
      };
      if (req.user && req.user.wallet === wallet) {
        result.sold = sold;
        result.stock = stock;
      }
      return result;
    });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.get('/:classId', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const bookInfo = await getNftBookInfo(classId);

    if (!bookInfo) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }
    const {
      prices: docPrices = [],
      pendingNFTCount,
      ownerWallet,
    } = bookInfo;

    let sold = 0;
    let stock = 0;
    const prices: any[] = [];
    docPrices.forEach((p) => {
      const {
        name,
        priceInDecimal,
        sold: pSold = 0,
        stock: pStock = 0,
      } = p;
      const price = priceInDecimal / 100;
      const payload: any = { price, name, isSoldOut: stock <= 0 };
      if (req.user && req.user.wallet === ownerWallet) {
        payload.sold = pSold;
        payload.stock = pStock;
      }
      prices.push(payload);
      sold += pSold;
      stock += pStock;
    });
    const payload: any = {
      prices,
      isSoldOut: stock <= 0,
    };
    if (req.user && req.user.wallet === ownerWallet) {
      payload.sold = sold;
      payload.stock = stock;
      payload.pendingNFTCount = pendingNFTCount;
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/:classId/price/:priceIndex', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { classId, priceIndex: priceIndexString } = req.params;
    const priceIndex = Number(priceIndexString);
    const bookInfo = await getNftBookInfo(classId);

    if (!bookInfo) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }
    const {
      prices = [],
      ownerWallet,
    } = bookInfo;
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    const {
      name,
      priceInDecimal,
      stock,
      sold,
    } = priceInfo;
    const price = priceInDecimal / 100;
    const payload: any = {
      name,
      price,
      priceInDecimal,
      isSoldOut: stock <= 0,
    };
    if (req.user && req.user.wallet === ownerWallet) {
      payload.sold = sold;
      payload.stock = stock;
    }
    res.json(payload);
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
      prices = [],
    } = req.body;
    if (!prices.length) throw new ValidationError('PRICES_ARE_EMPTY');
    const invalidPriceIndex = prices.findIndex((p) => {
      const {
        name,
        priceInDecimal,
        stock,
      } = p;
      return (!(Number(priceInDecimal) > 0 && Number(stock) > 0)) && (!name || typeof name === 'string');
    });
    if (invalidPriceIndex > -1) {
      throw new ValidationError(`INVALID_PRICE_in_${invalidPriceIndex}`);
    }
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
      prices,
    });
    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
