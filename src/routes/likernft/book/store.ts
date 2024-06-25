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
  validateAutoDeliverNFTsTxHash,
  validateCoupons,
} from '../../../util/api/likernft/book';
import { getISCNFromNFTClassId, getNFTClassDataById, getNFTISCNData } from '../../../util/cosmos/nft';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { validateConnectedWallets } from '../../../util/api/likernft/book/user';
import publisher from '../../../util/gcloudPub';
import { sendNFTBookListingEmail } from '../../../util/ses';
import { sendNFTBookNewListingSlackNotification } from '../../../util/slack';
import { ONE_DAY_IN_S, PUBSUB_TOPIC_MISC } from '../../../constant';
import { handleGiftBook } from '../../../util/api/likernft/book/store';
import { createAirtablePublicationRecord, queryAirtableForPublication } from '../../../util/airtable';

const router = Router();

router.get('/search', async (req, res, next) => {
  try {
    const {
      q,
    } = req.query;
    if (!q) throw new ValidationError('INVALID_SEARCH_QUERY');
    const list = await queryAirtableForPublication({ query: q });
    res.json({ list });
  } catch (err) {
    next(err);
  }
});

router.get('/list', jwtOptionalAuth('read:nftbook'), async (req, res, next) => {
  try {
    const {
      wallet,
      exclude_wallet: excludedWallet,
      before: beforeString,
      limit: limitString,
      key: keyString,
    } = req.query;
    const conditions = {
      ownerWallet: wallet as string,
      excludedOwnerWallet: excludedWallet as string,
      before: beforeString ? Number(beforeString) : undefined,
      limit: limitString ? Number(limitString) : 10,
      key: keyString ? Number(keyString) : undefined,
    };
    if (conditions.limit > 100) throw new ValidationError('LIMIT_TOO_LARGE', 400);

    const ownedBookInfos = await listLatestNFTBookInfo(conditions);
    const list = ownedBookInfos
      .filter((b) => {
        const {
          isHidden,
          moderatorWallets = [],
          ownerWallet,
        } = b;
        const isAuthorized = req.user
          && (req.user.wallet === ownerWallet || moderatorWallets?.includes(req.user.wallet));
        return isAuthorized || !isHidden;
      })
      .map((b) => {
        const {
          prices: docPrices = [],
          shippingRates,
          pendingNFTCount,
          defaultPaymentCurrency,
          moderatorWallets = [],
          ownerWallet,
          id,
          hideDownload,
          timestamp,
        } = b;
        const isAuthorized = req.user
          && (req.user.wallet === ownerWallet || moderatorWallets?.includes(req.user.wallet));
        const { stock, sold, prices } = parseBookSalesData(docPrices, isAuthorized);
        const result: any = {
          classId: id,
          ownerWallet,
          prices,
          stock,
          shippingRates,
          defaultPaymentCurrency,
          hideDownload,
          timestamp: timestamp.toMillis(),
        };
        if (isAuthorized) {
          result.pendingNFTCount = pendingNFTCount;
          result.sold = sold;
        }
        return result;
      });
    const nextKey = list.length < conditions.limit ? null : list[list.length - 1].timestamp;
    if (req.user) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set(`Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
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
    let bookInfo;
    try {
      bookInfo = await getNftBookInfo(classId);
    } catch (err) {
      if ((err as Error).message !== 'CLASS_ID_NOT_FOUND') throw err;
    }
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
      enableCustomMessagePage,
      coupons,
      inLanguage,
      name,
      description,
      keywords,
      thumbnailUrl,
      author,
      usageInfo,
      isbn,
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
      enableCustomMessagePage,
      inLanguage,
      name,
      description,
      keywords,
      thumbnailUrl,
      author,
      usageInfo,
      isbn,
    };
    if (isAuthorized) {
      payload.sold = sold;
      payload.pendingNFTCount = pendingNFTCount;
      payload.moderatorWallets = moderatorWallets;
      payload.notificationEmails = notificationEmails;
      payload.connectedWallets = connectedWallets;
      payload.coupons = coupons;
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
      isAllowCustomPrice,
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
      isAllowCustomPrice,
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
    const { price: inputPrice, autoDeliverNFTsTxHash } = req.body;
    const price = validatePrice(inputPrice);

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
      newNFTIds = await validateAutoDeliverNFTsTxHash(
        autoDeliverNFTsTxHash,
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
    const { price: inputPrice, autoDeliverNFTsTxHash } = req.body;
    const price = validatePrice(inputPrice);

    const priceIndex = Number(priceIndexString);
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('BOOK_NOT_FOUND', 404);

    const { prices = [] } = bookInfo;
    const oldPriceInfo = prices[priceIndex];
    if (!oldPriceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    if (oldPriceInfo.isAutoDeliver && !price.isAutoDeliver) {
      throw new ValidationError('CANNOT_CHANGE_DELIVERY_METHOD_OF_AUTO_DELIVER_PRICE', 403);
    }

    if (oldPriceInfo.isAutoDeliver && price.stock < oldPriceInfo.stock) {
      throw new ValidationError('CANNOT_DECREASE_STOCK_OF_AUTO_DELIVERY_PRICE', 403);
    }

    let expectedNFTCount = 0;
    if (price.isAutoDeliver) {
      expectedNFTCount = oldPriceInfo.isAutoDeliver
        ? price.stock - oldPriceInfo.stock
        : price.stock;
    }

    let newNFTIds: string[] = [];
    if (expectedNFTCount > 0) {
      newNFTIds = await validateAutoDeliverNFTsTxHash(
        autoDeliverNFTsTxHash,
        classId,
        req.user.wallet,
        expectedNFTCount,
      );
    }

    prices[priceIndex] = {
      ...oldPriceInfo,
      ...formatPriceInfo(price),
    };

    await updateNftBookInfo(classId, { prices }, newNFTIds);
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

router.post(['/:classId/price/:priceIndex/gift', '/class/:classId/price/:priceIndex/gift'], jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const priceIndex = Number(req.params.priceIndex);
    const {
      receivers,
      giftInfo: {
        toName: defaultToName,
        fromName: defaultFromName,
        message: defaultMessage,
      },
    } = req.body;
    if (!receivers || !Array.isArray(receivers) || receivers.length === 0) {
      throw new ValidationError('INVALID_RECEIVERS', 400);
    }
    if (!defaultFromName || !defaultToName || !defaultMessage) {
      throw new ValidationError('INVALID_GIFT_MESSAGE_INFO', 400);
    }
    const result = await handleGiftBook(
      classId,
      priceIndex,
      receivers,
      {
        defaultToName,
        defaultFromName,
        defaultMessage,
      },
      req,
    );
    res.json({
      result,
    });
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
      prices: inputPrices = [],
      defaultPaymentCurrency,
      notificationEmails = [],
      moderatorWallets = [],
      connectedWallets,
      shippingRates,
      mustClaimToView = false,
      hideDownload = false,
      canPayByLIKE = false,
      enableCustomMessagePage = false,
      autoDeliverNFTsTxHash,
      coupons,
    } = req.body;
    const [iscnInfo, metadata] = await Promise.all([
      getISCNFromNFTClassId(classId),
      getNFTClassDataById(classId),
    ]);
    if (!iscnInfo) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const { owner: ownerWallet, iscnIdPrefix } = iscnInfo;
    if (ownerWallet !== req.user.wallet) {
      throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    }
    const {
      prices,
      autoDeliverTotalStock,
      manualDeliverTotalStock,
    } = validatePrices(inputPrices, classId, req.user.wallet);
    if (autoDeliverTotalStock > 0) {
      await validateAutoDeliverNFTsTxHash(
        autoDeliverNFTsTxHash,
        classId,
        req.user.wallet,
        autoDeliverTotalStock,
      );
    }
    const { apiWalletOwnedNFTs } = await validateStocks(
      classId,
      req.user.wallet,
      manualDeliverTotalStock,
      autoDeliverTotalStock,
    );

    if (coupons?.length) validateCoupons(coupons);

    const apiWalletOwnedNFTIds = apiWalletOwnedNFTs.map((n) => n.id);
    if (connectedWallets) await validateConnectedWallets(connectedWallets);

    const { data: iscnData } = await getNFTISCNData(iscnIdPrefix);
    const iscnContentMetadata = iscnData?.contentMetadata || {};
    const {
      inLanguage,
      name,
      description,
      keywords: keywordString = '',
      thumbnailUrl,
      author,
      usageInfo,
      isbn,
    } = iscnContentMetadata;
    const keywords = keywordString.split(',').map((k: string) => k.trim());

    await newNftBookInfo(classId, {
      iscnIdPrefix,
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
      enableCustomMessagePage,
      hideDownload,
      canPayByLIKE,
      coupons,

      // From ISCN content metadata
      inLanguage,
      name,
      description,
      keywords,
      thumbnailUrl,
      author,
      usageInfo,
      isbn,
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
      createAirtablePublicationRecord({
        id: classId,
        timestamp: new Date(),
        name: className,
        description: metadata?.description || '',
        iscnIdPrefix: iscnInfo.iscnIdPrefix,
        iscnObject: iscnInfo,
        iscnContentMetadata,
        metadata,
        ownerWallet,
        type: metadata?.data?.metadata?.nft_meta_collection_id,
        minPrice: prices.reduce((min, p) => Math.min(min, p.priceInDecimal), Infinity) / 100,
        maxPrice: prices.reduce((max, p) => Math.max(max, p.priceInDecimal), 0) / 100,
        imageURL: metadata?.data?.metadata?.image,
        language: inLanguage,
        keywords,
        author,
        usageInfo,
        isbn,
      }),
    ]);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingCreate',
      wallet: ownerWallet,
      classId,
      mustClaimToView,
      hideDownload,
      enableCustomMessagePage,
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
      enableCustomMessagePage,
      coupons,
    } = req.body;
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
    const {
      ownerWallet,
    } = bookInfo;
    if (ownerWallet !== req.user.wallet) throw new ValidationError('NOT_OWNER', 403);
    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    if (coupons?.length) validateCoupons(coupons);
    await updateNftBookInfo(classId, {
      notificationEmails,
      defaultPaymentCurrency,
      moderatorWallets,
      connectedWallets,
      shippingRates,
      mustClaimToView,
      hideDownload,
      canPayByLIKE,
      enableCustomMessagePage,
      coupons,
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
