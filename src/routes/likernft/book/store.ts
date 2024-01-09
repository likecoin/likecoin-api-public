import { Router } from 'express';
import {
  validateStocks,
  formatPriceInfo,
  getNftBookInfo,
  listLatestNFTBookInfo,
  listNftBookInfoByModeratorWallet,
  newNftBookInfo,
  parseBookSalesData,
  updateNftBookInfo,
  validatePrice,
  validatePrices,
  validateSendNFTsToAPIWalletTxHash,
} from '../../../util/api/likernft/book';
import { getISCNFromNFTClassId, getNFTClassDataById } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { validateConnectedWallets } from '../../../util/api/likernft/book/user';
import publisher from '../../../util/gcloudPub';
import { sendNFTBookListingEmail } from '../../../util/ses';
import { sendNFTBookNewListingSlackNotification } from '../../../util/slack';
import { PUBSUB_TOPIC_MISC } from '../../../constant';

const router = Router();

router.get('/list', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const {
      wallet,
      before: beforeString,
      limit: limitString,
      key: keyString,
    } = req.query;
    const conditions = {
      ownerWallet: wallet as string,
      before: beforeString ? Number(beforeString) : undefined,
      limit: limitString ? Number(limitString) : 10,
      key: keyString ? Number(keyString) : undefined,
    };
    if (conditions.limit > 100) throw new ValidationError('LIMIT_TOO_LARGE', 400);

    const ownedBookInfos = await listLatestNFTBookInfo(conditions);
    const list = ownedBookInfos.map((b) => {
      const {
        prices: docPrices = [],
        shippingRates,
        pendingNFTCount,
        defaultPaymentCurrency,
        moderatorWallets,
        ownerWallet,
        id,
        timestamp,
      } = b;
      const isAuthorized = req.user
        && (req.user.wallet === ownerWallet || moderatorWallets.includes(req.user.wallet));
      const { stock, sold, prices } = parseBookSalesData(docPrices, isAuthorized);
      const result: any = {
        classId: id,
        prices,
        stock,
        shippingRates,
        defaultPaymentCurrency,
        timestamp: timestamp.toMillis(),
      };
      if (req.user && req.user.wallet === wallet) {
        result.pendingNFTCount = pendingNFTCount;
        result.sold = sold;
      }
      return result;
    });
    const nextKey = list.length < conditions.limit ? null : list[list.length - 1].timestamp;
    if (req.user) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set('Cache-Control', 'public, max-age=60, s-maxage=60, stale-if-error=600');
    }
    res.json({ list, nextKey });
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
        shippingRates,
        defaultPaymentCurrency,
        pendingNFTCount,
        id,
        ownerWallet,
      } = b;
      const { stock, sold, prices } = parseBookSalesData(docPrices, true);
      const result: any = {
        classId: id,
        prices,
        shippingRates,
        defaultPaymentCurrency,
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

router.get(['/:classId', '/class/:classId'], jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const bookInfo = await getNftBookInfo(classId);

    if (!bookInfo) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }
    const {
      prices: docPrices = [],
      shippingRates,
      pendingNFTCount,
      ownerWallet,
      defaultPaymentCurrency,
      moderatorWallets = [],
      notificationEmails,
      connectedWallets,
      mustClaimToView = false,
      hideDownload = false,
      canPayByLIKE = false,
    } = bookInfo;
    const isAuthorized = req.user
      && (req.user.wallet === ownerWallet || moderatorWallets.includes(req.user.wallet));
    const { stock, sold, prices } = parseBookSalesData(docPrices, isAuthorized);
    const payload: any = {
      prices,
      defaultPaymentCurrency,
      shippingRates,
      isSoldOut: stock <= 0,
      stock,
      ownerWallet,
      mustClaimToView,
      hideDownload,
      canPayByLIKE,
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

router.get(['/:classId/price/:priceIndex', '/class/:classId/price/:priceIndex'], jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
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
      shippingRates,
      defaultPaymentCurrency,
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    const {
      name,
      priceInDecimal,
      hasShipping,
      isPhysicalOnly,
      stock,
      isAutoDeliver,
      autoMemo,
      sold,
      order,
    } = priceInfo;
    const price = priceInDecimal / 100;
    const payload: any = {
      index: priceIndex,
      name,
      defaultPaymentCurrency,
      price,
      priceInDecimal,
      hasShipping,
      isPhysicalOnly,
      isSoldOut: stock <= 0,
      stock,
      isAutoDeliver,
      autoMemo,
      ownerWallet,
      shippingRates,
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

router.post(['/:classId/price/:priceIndex', '/class/:classId/price/:priceIndex'], jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId, priceIndex: priceIndexString } = req.params;
    const priceIndex = Number(priceIndexString);
    const { price, sendNFTsToAPIWalletTxHash } = req.body;
    validatePrice(price);

    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('BOOK_NOT_FOUND', 404);

    const { prices = [] } = bookInfo;
    if (priceIndex !== prices.length) {
      throw new ValidationError('INVALID_PRICE_INDEX', 400);
    }
    const newPrice = {
      order: prices.length,
      sold: 0,
      ...formatPriceInfo(price),
    };
    prices.push(newPrice);

    let newNFTIds: string[] = [];
    if (price.isAutoDeliver && price.stock > 0) {
      newNFTIds = await validateSendNFTsToAPIWalletTxHash(
        sendNFTsToAPIWalletTxHash,
        classId,
        req.user.wallet,
        price.stock,
      );
    }
    await updateNftBookInfo(classId, { prices }, newNFTIds);
    res.json({
      index: prices.length - 1,
    });
  } catch (err) {
    next(err);
  }
});

router.put(['/:classId/price/:priceIndex', '/class/:classId/price/:priceIndex'], jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId, priceIndex: priceIndexString } = req.params;
    const { price } = req.body;
    validatePrice(price);

    const priceIndex = Number(priceIndexString);
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('BOOK_NOT_FOUND', 404);

    const { prices = [] } = bookInfo;
    const oldPriceInfo = prices[priceIndex];
    if (!oldPriceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    if (Boolean(oldPriceInfo.isAutoDeliver) !== Boolean(price.isAutoDeliver)) {
      throw new ValidationError('CANNOT_CHANGE_DELIVER_METHOD', 403);
    }

    prices[priceIndex] = {
      ...oldPriceInfo,
      ...formatPriceInfo(price),
    };

    await updateNftBookInfo(classId, { prices });
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.put(['/:classId/price/:priceIndex/order', '/class/:classId/price/:priceIndex/order'], jwtAuth('write:nftbook'), async (req, res, next) => {
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

    const reorderedPrices = prices.map((p) => {
      let { order } = p;
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
      };
    });

    await updateNftBookInfo(classId, { prices: reorderedPrices });

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post(['/:classId/new', '/class/:classId/new'], jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      successUrl,
      cancelUrl,
      prices = [],
      defaultPaymentCurrency,
      notificationEmails = [],
      moderatorWallets = [],
      connectedWallets,
      shippingRates,
      mustClaimToView = false,
      hideDownload = false,
      canPayByLIKE = false,
      sendNFTsToAPIWalletTxHash,
    } = req.body;
    const [iscnInfo, metadata] = await Promise.all([
      getISCNFromNFTClassId(classId),
      getNFTClassDataById(classId),
    ]);
    if (!iscnInfo) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const { owner: ownerWallet } = iscnInfo;
    if (ownerWallet !== req.user.wallet) {
      throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    }
    const {
      autoDeliverTotalStock,
      manualDeliverTotalStock,
    } = validatePrices(prices, classId, req.user.wallet);
    if (autoDeliverTotalStock > 0) {
      await validateSendNFTsToAPIWalletTxHash(
        sendNFTsToAPIWalletTxHash,
        classId,
        req.user.wallet,
        autoDeliverTotalStock,
      );
    }
    const { apiWalletOwnedNFTs } = await validateStocks(
      classId,
      req.user.wallet,
      autoDeliverTotalStock,
      manualDeliverTotalStock,
    );
    const apiWalletOwnedNFTIds = apiWalletOwnedNFTs.map((n) => n.id);
    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    await newNftBookInfo(classId, {
      ownerWallet,
      successUrl,
      cancelUrl,
      prices,
      defaultPaymentCurrency,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      shippingRates,
      mustClaimToView,
      hideDownload,
      canPayByLIKE,
    }, apiWalletOwnedNFTIds);

    const className = metadata?.name || classId;
    await Promise.all([
      sendNFTBookListingEmail({ classId, bookName: className }),
      sendNFTBookNewListingSlackNotification({
        wallet: ownerWallet,
        classId,
        className,
        currency: defaultPaymentCurrency,
        prices,
        canPayByLIKE,
      }),
    ]);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingCreate',
      wallet: ownerWallet,
      classId,
      mustClaimToView,
      hideDownload,
      canPayByLIKE,
    });

    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/:classId/settings', '/class/:classId/settings'], jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const {
      notificationEmails = [],
      moderatorWallets = [],
      connectedWallets,
      defaultPaymentCurrency,
      shippingRates,
      mustClaimToView,
      hideDownload,
      canPayByLIKE,
    } = req.body;
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
    const {
      ownerWallet,
    } = bookInfo;
    if (ownerWallet !== req.user.wallet) throw new ValidationError('NOT_OWNER', 403);
    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    await updateNftBookInfo(classId, {
      notificationEmails,
      defaultPaymentCurrency,
      moderatorWallets,
      connectedWallets,
      shippingRates,
      mustClaimToView,
      hideDownload,
      canPayByLIKE,
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
