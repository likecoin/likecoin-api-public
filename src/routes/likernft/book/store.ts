import { Router } from 'express';
import {
  getNftBookInfo,
  listNftBookInfoByModeratorWallet,
  listNftBookInfoByOwnerWallet,
  newNftBookInfo,
  parseBookSalesData,
  updateNftBookSettings,
} from '../../../util/api/likernft/book';
import { getISCNFromNFTClassId } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';

const router = Router();

router.get('/list', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet) throw new ValidationError('INVALID_WALLET');
    const ownedBookInfos = await listNftBookInfoByOwnerWallet(wallet as string);
    const list = ownedBookInfos.map((b) => {
      const {
        prices: docPrices = [],
        pendingNFTCount,
        moderatorWallets,
        ownerWallet,
        id,
      } = b;
      const isAuthorized = req.user
        && (req.user.wallet === ownerWallet || moderatorWallets.includes(req.user.wallet));
      const { stock, sold, prices } = parseBookSalesData(docPrices, isAuthorized);
      const result: any = {
        classId: id,
        prices,
        stock,
      };
      if (req.user && req.user.wallet === wallet) {
        result.pendingNFTCount = pendingNFTCount;
        result.sold = sold;
      }
      return result;
    });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.get('/list/moderated', jwtAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet) throw new ValidationError('INVALID_WALLET');
    const moderatedBookInfos = await listNftBookInfoByModeratorWallet(req.user.wallet);
    const list = moderatedBookInfos.map((b) => {
      const {
        prices: docPrices = [],
        pendingNFTCount,
        id,
      } = b;
      const { stock, sold, prices } = parseBookSalesData(docPrices, true);
      const result: any = {
        classId: id,
        prices,
        pendingNFTCount,
        stock,
        sold,
      };
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
      moderatorWallets = [],
      notificationEmails,
    } = bookInfo;
    const isAuthorized = req.user
      && (req.user.wallet === ownerWallet || moderatorWallets.includes(req.user.wallet));
    const { stock, sold, prices } = parseBookSalesData(docPrices, isAuthorized);
    const payload: any = {
      prices,
      isSoldOut: stock <= 0,
      stock,
    };
    if (isAuthorized) {
      payload.sold = sold;
      payload.pendingNFTCount = pendingNFTCount;
      payload.moderatorWallets = moderatorWallets;
      payload.notificationEmails = notificationEmails;
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
      moderatorWallets = [],
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
      stock,
    };
    const isAuthorized = req.user
      && (req.user.wallet === ownerWallet || moderatorWallets.includes(req.user.wallet));
    if (isAuthorized) {
      payload.sold = sold;
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
      notificationEmails = [],
      moderatorWallets = [],
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
      notificationEmails,
      moderatorWallets,
    });
    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:classId/settings', jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      notificationEmails = [],
      moderatorWallets = [],
    } = req.body;
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
    const {
      ownerWallet,
    } = bookInfo;
    if (ownerWallet !== req.user.wallet) throw new ValidationError('NOT_OWNER', 403);
    await updateNftBookSettings(classId, {
      notificationEmails,
      moderatorWallets,
    });
    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
