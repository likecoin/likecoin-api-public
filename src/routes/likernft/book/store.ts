import { Router } from 'express';
import multer from 'multer';
import {
  formatPriceInfo,
  getNftBookInfo,
  listLatestNFTBookInfo,
  listNftBookInfoByModeratorWallet,
  newNftBookInfo,
  updateNftBookInfo,
  validatePrice,
  validatePrices,
  getLocalizedTextWithFallback,
  createStripeProductFromNFTBookPrice,
  checkIsAuthorized,
  syncNFTBookInfoWithISCN,
  getStripeProductMetadata,
} from '../../../util/api/likernft/book';
import {
  getNFTClassDataById as getEVMNFTClassDataById,
  getNFTClassOwner as getEVMNFTClassOwner,
  triggerNFTIndexerUpdate,
} from '../../../util/evm/nft';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { validateConnectedWallets } from '../../../util/api/likernft/book/user';
import publisher from '../../../util/gcloudPub';
import { sendNFTBookListingEmail } from '../../../util/ses';
import { sendNFTBookNewListingSlackNotification } from '../../../util/slack';
import { ONE_DAY_IN_S, PUBSUB_TOPIC_MISC, MAX_PNG_FILE_SIZE } from '../../../constant';
import { createAirtablePublicationRecord, queryAirtableForPublication } from '../../../util/airtable';
import stripe from '../../../util/stripe';
import { filterNFTBookListingInfo, filterNFTBookPricesInfo } from '../../../util/ValidationHelper';
import type { NFTBookListingInfo, NFTBookPrice } from '../../../types/book';
import { uploadImageBufferToCache } from '../../../util/fileupload';

const router = Router();
const pngUpload = multer({
  limits: {
    fileSize: MAX_PNG_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG files are allowed'), false);
    }
  },
});

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
      chain,
      exclude_wallet: excludedWallet,
      before: beforeString,
      limit: limitString,
      key: keyString,
    } = req.query;
    const conditions = {
      ownerWallet: wallet as string,
      chain: chain as string,
      excludedOwnerWallet: excludedWallet as string,
      before: beforeString ? Number(beforeString) : undefined,
      limit: limitString ? Number(limitString) : 10,
      key: keyString ? Number(keyString) : undefined,
    };
    if (conditions.limit > 100) throw new ValidationError('LIMIT_TOO_LARGE', 400);

    const ownedBookInfos = await listLatestNFTBookInfo(conditions);
    const list = ownedBookInfos
      .filter((b: NFTBookListingInfo) => {
        const {
          isHidden,
          redirectClassId,
          moderatorWallets = [],
          ownerWallet,
        } = b;
        const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
        return (isAuthorized || !isHidden) && !redirectClassId;
      })
      .map((b: NFTBookListingInfo) => {
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
    const { wallet, chain } = req.query;
    if (!wallet) throw new ValidationError('INVALID_WALLET');
    const moderatedBookInfos = await listNftBookInfoByModeratorWallet(
      req.user.wallet,
      { chain: chain as string },
    );
    const list = moderatedBookInfos
      .filter((b) => !b.redirectClassId)
      .map((b) => {
        const {
          prices: docPrices = [],
          pendingNFTCount,
          id,
          ownerWallet,
        } = b;
        const { stock, sold, prices } = filterNFTBookPricesInfo(docPrices, true);
        const result: Record<string, unknown> = {
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
    const {
      price: inputPrice,
    } = req.body;
    const price = validatePrice(inputPrice);

    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('BOOK_NOT_FOUND', 404);
    const {
      ownerWallet,
      moderatorWallets = [],
      enableCustomMessagePage: docEnableCustomMessagePage,
      enableSignatureImage,
      signedMessageText,
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

    const newPrice: NFTBookPrice = {
      stripeProductId,
      stripePriceId,
      order: prices.length,
      sold: 0,
      ...formatPriceInfo(price),
    };
    prices.push(newPrice);

    const enableCustomMessagePage = docEnableCustomMessagePage
      || enableSignatureImage
      || !!signedMessageText
      || prices.some((p) => !p.isAutoDeliver);
    await updateNftBookInfo(
      classId,
      { prices, enableCustomMessagePage },
    );

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPriceCreate',
      wallet: req.user.wallet,
      classId,
      priceIndex: prices.length - 1,
      priceInDecimal: price.priceInDecimal,
      stock: price.stock,
      isAutoDeliver: price.isAutoDeliver,
    });

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
    const {
      price: inputPrice,
    } = req.body;
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
      enableCustomMessagePage: docEnableCustomMessagePage,
      enableSignatureImage,
      signedMessageText,
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    const oldPriceInfo = prices[priceIndex];
    if (!oldPriceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);

    if (oldPriceInfo.isAutoDeliver && !price.isAutoDeliver) {
      throw new ValidationError('CANNOT_CHANGE_DELIVERY_METHOD_OF_AUTO_DELIVER_PRICE', 403);
    }

    const newPriceInfo = {
      ...oldPriceInfo,
      ...formatPriceInfo(price),
    };

    if (oldPriceInfo.stripeProductId) {
      const metadata = getStripeProductMetadata(classId, priceIndex, bookInfo);
      await stripe.products.update(oldPriceInfo.stripeProductId, {
        name: [name, typeof newPriceInfo.name === 'object' ? getLocalizedTextWithFallback(newPriceInfo.name || {}, 'zh') : newPriceInfo.name].filter(Boolean).join(' - '),
        description: [typeof newPriceInfo.description === 'object' ? getLocalizedTextWithFallback(newPriceInfo.description || {}, 'zh') : newPriceInfo.description, description].filter(Boolean).join('\n'),
        metadata,
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
    const enableCustomMessagePage = docEnableCustomMessagePage
      || enableSignatureImage
      || !!signedMessageText
      || prices.some((p) => !p.isAutoDeliver);
    await updateNftBookInfo(
      classId,
      { prices, enableCustomMessagePage },
    );

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPriceUpdate',
      wallet: req.user.wallet,
      classId,
      priceIndex,
      priceInDecimal: price.priceInDecimal,
      stock: price.stock,
      isAutoDeliver: price.isAutoDeliver,
      stockChanged: price.stock !== oldPriceInfo.stock,
      priceChanged: price.priceInDecimal !== oldPriceInfo.priceInDecimal,
    });

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
      let { order = 0 } = p;
      if (order === oldOrder) {
        order = newOrder;
      } else if (order < (oldOrder ?? 0) && order >= newOrder) {
        order += 1;
      } else if (order > (oldOrder ?? 0) && order <= newOrder) {
        order -= 1;
      }
      return {
        ...p,
        order,
      };
    });

    await updateNftBookInfo(classId, { prices: reorderedPrices });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPriceReorder',
      wallet: req.user.wallet,
      classId,
      priceIndex,
      newOrder,
      totalPrices: prices.length,
    });

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post('/class/:classId/refresh', jwtAuth('write:nftbook'), async (req, res, next) => {
  try {
    const { classId } = req.params;
    const bookInfo = await getNftBookInfo(classId);
    if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
    const {
      ownerWallet,
      moderatorWallets = [],
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
    await syncNFTBookInfoWithISCN(classId);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTRefresh',
      wallet: req.user.wallet,
      classId,
    });

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
      prices: inputPrices = [],
      moderatorWallets = [],
      connectedWallets,
      mustClaimToView = false,
      hideDownload = false,
      hideAudio = false,
      hideUpsell = false,
      enableCustomMessagePage = false,
      tableOfContents,
    } = req.body;

    let ownerWallet = '';

    const [classData, classOwner] = await Promise.all([
      getEVMNFTClassDataById(classId),
      getEVMNFTClassOwner(classId),
    ]);
    const metadata = classData;
    ownerWallet = classOwner;

    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);

    const {
      prices,
      autoDeliverTotalStock,
      manualDeliverTotalStock,
    } = validatePrices(inputPrices);

    if (connectedWallets) await validateConnectedWallets(connectedWallets);
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
      image,
    } = metadata;
    const keywords = Array.isArray(keywordString) ? keywordString : keywordString.split(',').map((k: string) => k.trim()).filter((k: string) => !!k);

    const { isAutoApproved } = await newNftBookInfo(classId, {
      iscnIdPrefix: metadata.iscnIdPrefix,
      ownerWallet,
      successUrl,
      cancelUrl,
      prices,
      moderatorWallets,
      connectedWallets,
      mustClaimToView,
      enableCustomMessagePage,
      tableOfContents,
      hideDownload,
      hideAudio,
      hideUpsell,

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
    });

    const className = metadata?.name || classId;
    await Promise.all([
      sendNFTBookListingEmail({ classId, bookName: className }),
      sendNFTBookNewListingSlackNotification({
        wallet: ownerWallet,
        classId,
        className,
        prices,
        isAutoApproved,
      }),
      createAirtablePublicationRecord({
        id: classId,
        timestamp: new Date(),
        name: className,
        description: metadata?.description || '',
        iscnIdPrefix: metadata.iscnIdPrefix,
        iscnObject: null,
        iscnContentMetadata: metadata,
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
        isHidden: false, // Don't hide new listing until hidden
      }),
    ]);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingCreate',
      wallet: ownerWallet,
      classId,
      mustClaimToView,
      hideDownload,
      hideAudio,
      hideUpsell,
      enableCustomMessagePage,
      totalPrices: prices.length,
      autoDeliverTotalStock,
      manualDeliverTotalStock,
    });

    try {
      await triggerNFTIndexerUpdate();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to trigger NFT indexer update for class ${classId}:`, err);
    }

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
      moderatorWallets,
      connectedWallets,
      mustClaimToView,
      hideDownload,
      hideAudio,
      hideUpsell,
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
      moderatorWallets,
      connectedWallets,
      mustClaimToView,
      hideDownload,
      hideAudio,
      hideUpsell,
      enableCustomMessagePage,
      tableOfContents,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTListingUpdate',
      wallet: ownerWallet,
      classId,
      mustClaimToView,
      hideDownload,
      hideAudio,
      hideUpsell,
      enableCustomMessagePage,
      moderatorWalletCount: moderatorWallets ? moderatorWallets.length : 0,
      connectedWalletCount: connectedWallets ? connectedWallets.length : 0,
    });

    res.json({
      classId,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:classId/image/upload',
  jwtAuth('write:nftbook'),
  pngUpload.fields([
    { name: 'signImage', maxCount: 1 },
    { name: 'memoImage', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const { classId } = req.params;
      const bookInfo = await getNftBookInfo(classId);
      if (!bookInfo) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
      const {
        ownerWallet,
        moderatorWallets = [],
      } = bookInfo;
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);
      const signedMessageText = req.body.signedMessageText || '';
      const files = req.files as unknown as { [fieldname: string]: any[] };
      const signFile = files?.signImage?.[0];
      const memoFile = files?.memoImage?.[0];

      if (!signFile && !memoFile) {
        throw new ValidationError('NO_IMAGE_PROVIDED', 400);
      }

      let enableSignatureImage = false;
      let signedTextToSave = '';

      const [signResult, memoResult] = await Promise.all([
        signFile
          ? uploadImageBufferToCache({
            buffer: signFile.buffer,
            path: `${classId}/sign.png`,
          })
          : Promise.resolve(false),
        memoFile
          ? uploadImageBufferToCache({
            buffer: memoFile.buffer,
            path: `${classId}/memo.png`,
          })
          : Promise.resolve(false),
      ]);

      if (signResult) enableSignatureImage = true;
      if (memoResult && signedMessageText) {
        signedTextToSave = signedMessageText;
      }

      await updateNftBookInfo(classId, {
        enableSignatureImage,
        signedMessageText: signedTextToSave,
        enableCustomMessagePage: enableSignatureImage || !!signedMessageText,
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTImageUpload',
        wallet: req.user.wallet,
        classId,
        enableSignatureImage,
        hasSignedMessageText: !!signedTextToSave,
        signImageUploaded: !!signResult,
        memoImageUploaded: !!memoResult,
      });

      res.json({
        enableSignatureImage,
        signedMessageText: signedTextToSave,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
