import { Router } from 'express';
import {
  validateStocks,
  formatPriceInfo,
  getNftBookInfo,
  listLatestNFTBookInfo,
  listNftBookInfoByModeratorWallet,
  newNftBookInfo,
  updateNftBookInfo,
  validatePrice,
  validatePrices,
  validateAutoDeliverNFTsTxHash,
  getLocalizedTextWithFallback,
  createStripeProductFromNFTBookPrice,
  checkIsAuthorized,
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
import stripe from '../../../util/stripe';
import { filterNFTBookListingInfo, filterNFTBookPricesInfo } from '../../../util/ValidationHelper';

const router = Router();

router.get('/search', async (req, res, next) => {
  try {
    const {
      q,
      fields: fieldsString,
    } = req.query;
    let fields;
    if (Array.isArray(fieldsString)) {
      fields = fieldsString;
    } else if (typeof fieldsString === 'string') {
      fields = fieldsString.split(',').map((f) => f.trim());
    }
    if (!q) throw new ValidationError('INVALID_SEARCH_QUERY');
    const list = await queryAirtableForPublication({ query: q, fields });
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
        const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
        return isAuthorized || !isHidden;
      })
      .map((b) => {
        const {
          moderatorWallets = [],
          ownerWallet,
        } = b;
        const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
        const result = filterNFTBookListingInfo(b, isAuthorized);
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
        pendingNFTCount,
        id,
        ownerWallet,
      } = b;
      const { stock, sold, prices } = filterNFTBookPricesInfo(docPrices, true);
      const result: any = {
        classId: id,
        prices,
        shippingRates,
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
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    const payload = filterNFTBookListingInfo(bookInfo, isAuthorized);
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
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    const { prices: [price] } = filterNFTBookPricesInfo([{
      ...priceInfo,
      index: priceIndex,
    }], isAuthorized);
    res.json({
      ownerWallet,
      shippingRates,
      ...price,
    });
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
    const {
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    const {
      prices = [],
    } = bookInfo;
    if (priceIndex !== prices.length) {
      throw new ValidationError('INVALID_PRICE_INDEX', 400);
    }
    const {
      stripeProductId,
      stripePriceId,
    } = await createStripeProductFromNFTBookPrice(classId, priceIndex, {
      bookInfo,
      price,
    });
    const newPrice: any = {
      stripeProductId,
      stripePriceId,
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

    const {
      prices = [],
      name,
      description,
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
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

    const newPriceInfo = {
      ...oldPriceInfo,
      ...formatPriceInfo(price),
    };

    if (oldPriceInfo.stripeProductId) {
      await stripe.products.update(oldPriceInfo.stripeProductId, {
        name: [name, getLocalizedTextWithFallback(newPriceInfo.name, 'zh')].filter(Boolean).join(' - '),
        description: [getLocalizedTextWithFallback(newPriceInfo.description, 'zh'), description].filter(Boolean).join('\n'),
        shippable: newPriceInfo.hasShipping,
      });
      if (oldPriceInfo.stripePriceId) {
        if (oldPriceInfo.priceInDecimal !== newPriceInfo.priceInDecimal) {
          const newStripePrice = await stripe.prices.create({
            product: oldPriceInfo.stripeProductId,
            currency: 'usd',
            unit_amount: price.priceInDecimal,
          });
          await stripe.products.update(
            oldPriceInfo.stripeProductId,
            { default_price: newStripePrice.id },
          );
          await stripe.prices.update(
            oldPriceInfo.stripePriceId,
            { active: false },
          );
          newPriceInfo.stripePriceId = newStripePrice.id;
        }
      }
    }
    prices[priceIndex] = newPriceInfo;

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
      throw new ValidationError('BOOK_NOT_FOUND', 404);
    }

    const priceIndex = Number(req.params.priceIndex);
    const {
      prices = [],
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);

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
    const bookInfo = await getNftBookInfo(classId);

    if (!bookInfo) {
      throw new ValidationError('BOOK_NOT_FOUND', 404);
    }
    const {
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;

    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);

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
      notificationEmails = [],
      moderatorWallets = [],
      connectedWallets,
      shippingRates,
      mustClaimToView = false,
      hideDownload = false,
      enableCustomMessagePage = false,
      tableOfContents,
      autoDeliverNFTsTxHash,
    } = req.body;
    const [iscnInfo, metadata] = await Promise.all([
      getISCNFromNFTClassId(classId),
      getNFTClassDataById(classId),
    ]);
    if (!iscnInfo) throw new ValidationError('CLASS_ID_NOT_FOUND');
    const { owner: ownerWallet, iscnIdPrefix } = iscnInfo;

    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);

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
      publisher: iscnPublisher,
      usageInfo,
      isbn,
    } = iscnContentMetadata;
    const keywords = keywordString.split(',').map((k: string) => k.trim()).filter((k: string) => !!k);
    const image = metadata?.data?.metadata?.image;

    await newNftBookInfo(classId, {
      iscnIdPrefix,
      ownerWallet,
      successUrl,
      cancelUrl,
      prices,
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      shippingRates,
      mustClaimToView,
      enableCustomMessagePage,
      tableOfContents,
      hideDownload,

      // From ISCN content metadata
      inLanguage,
      name,
      description,
      keywords,
      thumbnailUrl,
      author,
      publisher: iscnPublisher,
      usageInfo,
      isbn,
      image,
    }, apiWalletOwnedNFTIds);

    const className = metadata?.name || classId;
    await Promise.all([
      sendNFTBookListingEmail({ classId, bookName: className }),
      sendNFTBookNewListingSlackNotification({
        wallet: ownerWallet,
        classId,
        className,
        prices,
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
        imageURL: image,
        language: inLanguage,
        keywords,
        author: typeof author === 'string' ? author : author?.name || '',
        publisher: iscnPublisher,
        usageInfo,
        isbn,
        isDRMFree: !hideDownload,
      }),
    ]);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingCreate',
      wallet: ownerWallet,
      classId,
      mustClaimToView,
      hideDownload,
      enableCustomMessagePage,
      tableOfContents,
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
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      shippingRates,
      mustClaimToView,
      hideDownload,
      enableCustomMessagePage,
      tableOfContents,
    } = req.body;
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
    const {
      ownerWallet,
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    await updateNftBookInfo(classId, {
      notificationEmails,
      moderatorWallets,
      connectedWallets,
      shippingRates,
      mustClaimToView,
      hideDownload,
      enableCustomMessagePage,
      tableOfContents,
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
