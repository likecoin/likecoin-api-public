import { Router } from 'express';
import {
  MIN_BOOK_PRICE_DECIMAL,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
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
import { validateConnectedWallets } from '../../../util/api/likernft/book/user';
import publisher from '../../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../../constant';

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
        ownerWallet,
      } = b;
      const { stock, sold, prices } = parseBookSalesData(docPrices, true);
      const result: any = {
        classId: id,
        prices,
        pendingNFTCount,
        stock,
        sold,
        ownerWallet,
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
      connectedWallets,
    } = bookInfo;
    const isAuthorized = req.user
      && (req.user.wallet === ownerWallet || moderatorWallets.includes(req.user.wallet));
    const { stock, sold, prices } = parseBookSalesData(docPrices, isAuthorized);
    const payload: any = {
      prices,
      isSoldOut: stock <= 0,
      stock,
      ownerWallet,
    };
    if (isAuthorized) {
      payload.sold = sold;
      payload.pendingNFTCount = pendingNFTCount;
      payload.moderatorWallets = moderatorWallets;
      payload.notificationEmails = notificationEmails;
      payload.connectedWallets = connectedWallets;
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
      order,
    } = priceInfo;
    const price = priceInDecimal / 100;
    const payload: any = {
      index: priceIndex,
      name,
      price,
      priceInDecimal,
      isSoldOut: stock <= 0,
      stock,
      ownerWallet,
      order,
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

router.put('/:classId/price/:priceIndex/order', jwtOptionalAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const bookInfo = await getNftBookInfo(classId);

    if (!bookInfo) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }

    const priceIndex = Number(req.params.priceIndex);
    const {
      prices = [],
      ownerWallet,
    } = bookInfo;
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    if (req.user.wallet !== ownerWallet) {
      throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    }

    const { order: newOrderString } = req.body;
    const newOrder = Number(newOrderString);
    if (newOrder < 0 || newOrder >= prices.length) {
      throw new ValidationError('INVALID_NEW_PRICE_ORDER', 400);
    }
    const oldOrder = priceInfo.order;

    const reorderedPrices = prices.map(p => {
      let order = p.order;
      if (order === oldOrder) {
        order = newOrder;
      } else if (order < oldOrder && order >= newOrder) {
        order += 1;
      } else if (order > oldOrder && order <= newOrder) {
        order -= 1;
      }
      return {
        ...p,
        order,
      }
    })

    await updateNftBookSettings(classId, { prices: reorderedPrices });

    res.sendStatus(200);
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
      connectedWallets,
    } = req.body;
    if (!prices.length) throw new ValidationError('PRICES_ARE_EMPTY');
    const invalidPriceIndex = prices.findIndex((p) => {
      const {
        priceInDecimal,
        stock,
      } = p;
      return !(priceInDecimal > 0
        && stock > 0
        && (typeof priceInDecimal === 'number')
        && (typeof stock === 'number')
        && priceInDecimal >= MIN_BOOK_PRICE_DECIMAL);
    });
    if (invalidPriceIndex > -1) {
      throw new ValidationError(`INVALID_PRICE_in_${invalidPriceIndex}`);
    }
    const invalidNameIndex = prices.findIndex((p) => {
      const {
        name = {},
        description = {},
      } = p;
      return !(
        typeof name[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string'
        && Object.values(name).every((n) => typeof n === 'string')
        && (description[NFT_BOOK_TEXT_DEFAULT_LOCALE] && typeof description[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string'))
        && Object.values(description).every((d) => typeof d === 'string');
    });
    if (invalidNameIndex > -1) {
      throw new ValidationError(`INVALID_NAME_in_${invalidNameIndex}`);
    }
    const result = await getISCNFromNFTClassId(classId);
    if (!result) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const { owner: ownerWallet } = result;
    if (ownerWallet !== req.user.wallet) {
      throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    }
    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    await newNftBookInfo(classId, {
      ownerWallet,
      successUrl,
      cancelUrl,
      prices,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingCreate',
      wallet: ownerWallet,
      classId,
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
      connectedWallets,
    } = req.body;
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
    const {
      ownerWallet,
    } = bookInfo;
    if (ownerWallet !== req.user.wallet) throw new ValidationError('NOT_OWNER', 403);
    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    await updateNftBookSettings(classId, {
      notificationEmails,
      moderatorWallets,
      connectedWallets,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingUpdate',
      wallet: ownerWallet,
      classId,
    });

    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
