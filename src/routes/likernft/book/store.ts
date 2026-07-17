import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import multer from 'multer';
import {
  formatPriceInfo,
  getNftBookInfo,
  listLatestNFTBookInfo,
  listFilteredNFTBookInfo,
  listPopularNFTBookInfo,
  listNftBookInfoByModeratorWallet,
  newNftBookInfo,
  updateNftBookInfo,
  getLocalizedTextWithFallback,
  createStripeProductFromNFTBookPrice,
  checkIsAuthorized,
  syncNFTBookInfoWithISCN,
  getStripeProductMetadata,
  getAuthorNameFromMetadata,
  getPublisherNameFromMetadata,
} from '../../../util/api/likernft/book';
import {
  syncNFTBookCMSTagEntries,
  bulkSetNFTBookCMSTagOrder,
  listNFTBookInfoByCMSTag,
  upsertNFTBookCMSTag,
  listNFTBookCMSTags,
  getNFTBookCMSTag,
} from '../../../util/api/likernft/book/cms';
import {
  ImageUploadBodySchema,
  ListingSettingsBodySchema,
  NewListingBodySchema,
  PriceMutationBodySchema,
  PriceReorderBodySchema,
  BookClassIdParamsSchema,
  BookClassIdPriceIndexParamsSchema,
  BookSearchQuerySchema,
  BookListQuerySchema,
  BookCatalogQuerySchema,
  BookCatalogMetaResponseSchema,
  BookCatalogOpenAIResponseSchema,
  BookCatalogOpenAIFeedResponseSchema,
  BookCatalogStripeResponseSchema,
  BookCatalogGoogleResponseSchema,
  BookListResponseSchema,
  BookPopularListQuerySchema,
  type BookPopularListQuery,
  BookPopularListResponseSchema,
  BookListModeratedResponseSchema,
  BookSearchResponseSchema,
  BookInfoResponseSchema,
  BookPriceInfoResponseSchema,
  PriceCreateResponseSchema,
  ImageUploadResponseSchema,
  NewListingResponseSchema,
  ListingSettingsResponseSchema,
  type BookListQuery,
  BookListPaginationQuerySchema,
  type BookListPaginationQuery,
  BookCMSTagSyncBodySchema,
  BookCMSTagBulkBodySchema,
  BookCMSTagUpsertBodySchema,
  BookCMSTagIdParamsSchema,
  BookCMSTagListQuerySchema,
  type BookCMSTagListQuery,
  BookCMSTagResponseSchema,
  BookCMSTagListResponseSchema,
  BookCMSTagBulkResponseSchema,
  BookCMSTagBookListResponseSchema,
} from '../../../util/api/likernft/book/schemas';
import { validateBody, validateParams, validateQuery } from '../../../middleware/validate';
import { airtableAutomationAuth } from '../../../middleware/airtable-automation-auth';
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
import {
  API_HOSTNAME, ARWEAVE_GATEWAY, ONE_DAY_IN_S, ONE_HOUR_IN_S, PUBSUB_TOPIC_MISC, MAX_PNG_FILE_SIZE,
} from '../../../constant';
import { getArweaveTxAccessToken } from '../../../util/api/arweave/tx';
import { createAirtablePublicationRecord, queryAirtableForPublication } from '../../../util/airtable';
import { getStripeClient } from '../../../util/stripe';
import { filterNFTBookListingInfo, filterNFTBookPricesInfo, sendValidatedJSON } from '../../../util/ValidationHelper';
import type { NFTBookListingInfo, NFTBookPrice } from '../../../types/book';
import { uploadImageBufferToCache } from '../../../util/fileupload';
import {
  BOOK_PRICE_OVERRIDE_CURRENCIES,
  getBookPriceRangeByCurrency,
  getStripeCurrencyOptionsFromNFTBookPrice,
} from '../../../util/pricing';
import { cacheBookFilesFromNFTClassMetadata } from '../../../util/api/likernft/book/cache';
import { getMetaProductCatalogItems, formatMetaProductCatalogCSV } from '../../../util/api/likernft/book/metaCatalog';
import {
  getOpenAIProductCatalogItems,
  getOpenAIFeedItems,
  formatOpenAIFeedCSV,
} from '../../../util/api/likernft/book/openaiCatalog';
import { getStripeFeedItems, formatStripeFeedCSV } from '../../../util/api/likernft/book/stripeCatalog';
import { getGoogleMerchantFeedItems, formatGoogleMerchantFeedXML } from '../../../util/api/likernft/book/googleMerchantCatalog';
import { normalizeClassIdParam } from '../../../middleware/likernft';

const router = Router();

// Request whose query has been narrowed by a validateQuery zod schema
type QueryRequest<Q> = Request<ParamsDictionary, unknown, unknown, Q>;

router.param('classId', normalizeClassIdParam);

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

router.get('/search', validateQuery(BookSearchQuerySchema), async (req, res, next) => {
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
    sendValidatedJSON(res, BookSearchResponseSchema, { list });
  } catch (err) {
    next(err);
  }
});

router.get('/catalog/meta', validateQuery(BookCatalogQuerySchema), async (req, res, next) => {
  try {
    const items = await getMetaProductCatalogItems();
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    if (req.query.format === 'csv') {
      res.type('text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="meta-catalog.csv"');
      res.send(formatMetaProductCatalogCSV(items));
      return;
    }
    sendValidatedJSON(res, BookCatalogMetaResponseSchema, { items });
  } catch (err) {
    next(err);
  }
});

// Search-only OpenAI catalog. `format` selects the representation, mirroring
// the Meta route: default → flat file-upload feed (JSON), `csv` → that feed as
// CSV, `api` → the nested API model (Product → Variant) JSON.
router.get('/catalog/openai', validateQuery(BookCatalogQuerySchema), async (req, res, next) => {
  try {
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    if (req.query.format === 'api') {
      const products = await getOpenAIProductCatalogItems();
      sendValidatedJSON(res, BookCatalogOpenAIResponseSchema, { products });
      return;
    }
    const items = await getOpenAIFeedItems();
    if (req.query.format === 'csv') {
      res.type('text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="openai-catalog.csv"');
      res.send(formatOpenAIFeedCSV(items));
      return;
    }
    sendValidatedJSON(res, BookCatalogOpenAIFeedResponseSchema, { products: items });
  } catch (err) {
    next(err);
  }
});

// Stripe Agentic Commerce product feed (Google-Shopping field dialect, uploaded
// via Stripe's product_catalog import API). Mirrors the Meta route: default
// JSON, `csv` returns the upload file.
router.get('/catalog/stripe', validateQuery(BookCatalogQuerySchema), async (req, res, next) => {
  try {
    const items = await getStripeFeedItems();
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    if (req.query.format === 'csv') {
      res.type('text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="stripe-catalog.csv"');
      res.send(formatStripeFeedCSV(items));
      return;
    }
    sendValidatedJSON(res, BookCatalogStripeResponseSchema, { products: items });
  } catch (err) {
    next(err);
  }
});

// Google Merchant Center product feed (RSS 2.0 XML in the Google-Shopping field
// dialect). Google fetches this URL on a schedule; default returns XML, and
// `?format=json` returns the same items as JSON for debugging.
router.get('/catalog/google', validateQuery(BookCatalogQuerySchema), async (req, res, next) => {
  try {
    const items = await getGoogleMerchantFeedItems();
    res.set('Cache-Control', `public, max-age=${ONE_HOUR_IN_S}, s-maxage=${ONE_HOUR_IN_S}, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    if (req.query.format === 'json') {
      sendValidatedJSON(res, BookCatalogGoogleResponseSchema, { products: items });
      return;
    }
    res.type('application/xml; charset=utf-8');
    res.send(formatGoogleMerchantFeedXML(items));
  } catch (err) {
    next(err);
  }
});

router.get('/list', jwtOptionalAuth('read:nftbook'), validateQuery(BookListQuerySchema), async (req: QueryRequest<BookListQuery>, res, next) => {
  try {
    const {
      wallet,
      chain,
      library,
      before,
      limit,
      key,
    } = req.query;
    const conditions = {
      ownerWallet: wallet,
      chain,
      isPlusReadingEnabled: library === '1' || undefined,
      before,
      limit,
      key,
    };

    const ownedBookInfos = await listLatestNFTBookInfo(conditions);
    const list = ownedBookInfos.flatMap((b: NFTBookListingInfo) => {
      const {
        isHidden,
        isPendingReview,
        redirectClassId,
        moderatorWallets = [],
        ownerWallet,
      } = b;
      if (redirectClassId) return [];
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized && (isHidden || isPendingReview)) return [];
      return [filterNFTBookListingInfo(b, isAuthorized)];
    });
    // Use the unfiltered Firestore result for the cursor — filtered-out
    // docs (hidden / redirected) must not end pagination early. Coalesce to
    // null so the response shape matches `nextKey: number | null` even when
    // the page is empty or a doc is missing a timestamp.
    const lastBookInfo = ownedBookInfos[ownedBookInfos.length - 1];
    const nextKey = ownedBookInfos.length < conditions.limit
      ? null
      : (lastBookInfo?.timestamp?.toMillis() ?? null);
    if (req.user) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    }
    sendValidatedJSON(res, BookListResponseSchema, { list, nextKey });
  } catch (err) {
    next(err);
  }
});

function createDerivedListHandler(filter: 'free' | 'drm-free') {
  return async (
    req: QueryRequest<BookListPaginationQuery>,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const {
        library,
        before,
        limit,
        key,
      } = req.query;
      const conditions = {
        filter,
        isPlusReadingEnabled: library === '1' || undefined,
        before,
        limit,
        key,
      };

      const bookInfos = await listFilteredNFTBookInfo(conditions);
      const list = bookInfos.flatMap((b: NFTBookListingInfo) => {
        const {
          isHidden, isPendingReview, redirectClassId, moderatorWallets = [], ownerWallet,
        } = b;
        if (redirectClassId) return [];
        const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
        if (!isAuthorized && (isHidden || isPendingReview)) return [];
        return [filterNFTBookListingInfo(b, isAuthorized)];
      });
      // Use the unfiltered Firestore result for the cursor:
      // filtered-out docs (hidden / redirected) must not end pagination early.
      // Coalesce to null so the response shape matches `nextKey: number | null` on empty pages.
      const lastBookInfo = bookInfos[bookInfos.length - 1];
      const nextKey = bookInfos.length < conditions.limit
        ? null
        : (lastBookInfo?.timestamp?.toMillis() ?? null);
      if (req.user) {
        res.set('Cache-Control', 'no-store');
      } else {
        res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
      }
      sendValidatedJSON(res, BookListResponseSchema, { list, nextKey });
    } catch (err) {
      next(err);
    }
  };
}

router.get('/list/free', jwtOptionalAuth('read:nftbook'), validateQuery(BookListPaginationQuerySchema), createDerivedListHandler('free'));
router.get('/list/drm-free', jwtOptionalAuth('read:nftbook'), validateQuery(BookListPaginationQuerySchema), createDerivedListHandler('drm-free'));

// Books ranked by lifetime reading + TTS time; `library=1` scopes it to Plus-reading titles.
// Separate from createDerivedListHandler because it paginates by class-id cursor rather
// than by timestamp key, so its `nextKey` is a string.
router.get('/list/popular', jwtOptionalAuth('read:nftbook'), validateQuery(BookPopularListQuerySchema), async (req: QueryRequest<BookPopularListQuery>, res, next) => {
  try {
    const { library, limit, key } = req.query;
    const bookInfos = await listPopularNFTBookInfo({
      isPlusReadingEnabled: library === '1' || undefined,
      limit,
      key,
    });
    const list = bookInfos.flatMap((b: NFTBookListingInfo) => {
      const {
        isHidden, isPendingReview, redirectClassId, moderatorWallets = [], ownerWallet,
      } = b;
      if (redirectClassId) return [];
      const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
      if (!isAuthorized && (isHidden || isPendingReview)) return [];
      return [filterNFTBookListingInfo(b, isAuthorized)];
    });
    // Cursor off the unfiltered Firestore result: filtered-out docs (hidden / redirected)
    // must not end pagination early, and the next page resumes from the last doc read.
    const lastBookInfo = bookInfos[bookInfos.length - 1];
    const nextKey = bookInfos.length < limit ? null : (lastBookInfo?.id ?? null);
    if (req.user) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    }
    sendValidatedJSON(res, BookPopularListResponseSchema, { list, nextKey });
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
        return {
          classId: id,
          prices,
          pendingNFTCount,
          stock,
          sold,
          ownerWallet,
        };
      });
    sendValidatedJSON(res, BookListModeratedResponseSchema, { list });
  } catch (err) {
    next(err);
  }
});

router.put('/:classId/cms/tags', airtableAutomationAuth, validateParams(BookClassIdParamsSchema), validateBody(BookCMSTagSyncBodySchema), async (req, res, next) => {
  try {
    const { classId } = req.params as Record<string, string>;
    const { tagIds } = req.body;
    await syncNFTBookCMSTagEntries(classId, tagIds);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post('/bulk/cms/tags', airtableAutomationAuth, validateBody(BookCMSTagBulkBodySchema), async (req, res, next) => {
  try {
    const { entries } = req.body;
    if (!entries.length) {
      sendValidatedJSON(res, BookCMSTagBulkResponseSchema, { updated: 0 });
      return;
    }
    const result = await bulkSetNFTBookCMSTagOrder(entries);
    sendValidatedJSON(res, BookCMSTagBulkResponseSchema, result);
  } catch (err) {
    next(err);
  }
});

router.post('/cms/tags/:tagId', airtableAutomationAuth, validateParams(BookCMSTagIdParamsSchema), validateBody(BookCMSTagUpsertBodySchema), async (req, res, next) => {
  try {
    const { tagId } = req.params as Record<string, string>;
    await upsertNFTBookCMSTag(tagId, req.body);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.get('/cms/tags', async (_, res, next) => {
  try {
    const tags = await listNFTBookCMSTags();
    res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    sendValidatedJSON(res, BookCMSTagListResponseSchema, { list: tags });
  } catch (err) {
    next(err);
  }
});

router.get('/cms/tags/:tagId', validateParams(BookCMSTagIdParamsSchema), async (req, res, next) => {
  try {
    const { tagId } = req.params as Record<string, string>;
    const tag = await getNFTBookCMSTag(tagId);
    if (!tag) {
      res.status(404).send('TAG_NOT_FOUND');
      return;
    }
    res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    sendValidatedJSON(res, BookCMSTagResponseSchema, tag);
  } catch (err) {
    next(err);
  }
});

router.get('/cms/list', validateQuery(BookCMSTagListQuerySchema), async (req: QueryRequest<BookCMSTagListQuery>, res, next) => {
  try {
    const {
      tag,
      library,
      offset,
      limit,
    } = req.query;
    const tagDoc = await getNFTBookCMSTag(tag);
    if (!tagDoc) throw new ValidationError('TAG_NOT_FOUND', 404);
    const books = await listNFTBookInfoByCMSTag(tag, { offset, limit });
    const isLibraryOnly = library === '1';
    const list = books
      .filter((b) => (
        !b.isHidden
        && !b.isPendingReview
        && !b.redirectClassId
        && (!isLibraryOnly || b.isPlusReadingEnabled)))
      .map((b) => filterNFTBookListingInfo(b, false));

    res.set('Cache-Control', `public, max-age=60, s-maxage=60, stale-while-revalidate=${ONE_DAY_IN_S}, stale-if-error=${ONE_DAY_IN_S}`);
    sendValidatedJSON(res, BookCMSTagBookListResponseSchema, {
      list,
      nextOffset: books.length < limit ? null : offset + limit,
    });
  } catch (err) {
    next(err);
  }
});

router.get(['/:classId', '/class/:classId'], jwtOptionalAuth('read:nftbook'), validateParams(BookClassIdParamsSchema), async (req, res, next) => {
  try {
    const { classId } = req.params as Record<string, string>;
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
      isPendingReview,
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized && isPendingReview) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }
    const payload = filterNFTBookListingInfo(bookInfo, isAuthorized);
    sendValidatedJSON(res, BookInfoResponseSchema, payload);
  } catch (err) {
    next(err);
  }
});

router.get(['/:classId/price/:priceIndex', '/class/:classId/price/:priceIndex'], jwtOptionalAuth('read:nftbook'), validateParams(BookClassIdPriceIndexParamsSchema), async (req, res, next) => {
  try {
    const { classId, priceIndex: priceIndexString } = req.params as Record<string, string>;
    const priceIndex = Number(priceIndexString);
    const bookInfo = await getNftBookInfo(classId);
    const {
      prices = [],
      ownerWallet,
      moderatorWallets = [],
      isPendingReview,
    } = bookInfo;
    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets }, req);
    if (!isAuthorized && isPendingReview) {
      res.status(404).send('BOOK_NOT_FOUND');
      return;
    }
    const priceInfo = prices[priceIndex];
    if (!priceInfo) throw new ValidationError('PRICE_NOT_FOUND', 404);
    const { prices: [price] } = filterNFTBookPricesInfo([{
      ...priceInfo,
      index: priceIndex,
    }], isAuthorized);
    sendValidatedJSON(res, BookPriceInfoResponseSchema, {
      ownerWallet,
      ...price,
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/:classId/price/:priceIndex', '/class/:classId/price/:priceIndex'], jwtAuth('write:nftbook'), validateParams(BookClassIdPriceIndexParamsSchema), validateBody(PriceMutationBodySchema), async (req, res, next) => {
  try {
    const { classId, priceIndex: priceIndexString } = req.params as Record<string, string>;
    const priceIndex = Number(priceIndexString);
    const { price } = req.body;

    const bookInfo = await getNftBookInfo(classId);
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
      || !!enableSignatureImage
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
      amountUSD: price.priceInDecimal / 100,
      stock: price.stock,
      isAutoDeliver: price.isAutoDeliver,
    });

    sendValidatedJSON(res, PriceCreateResponseSchema, {
      index: prices.length - 1,
    });
  } catch (err) {
    next(err);
  }
});

router.put(['/:classId/price/:priceIndex', '/class/:classId/price/:priceIndex'], jwtAuth('write:nftbook'), validateParams(BookClassIdPriceIndexParamsSchema), validateBody(PriceMutationBodySchema), async (req, res, next) => {
  try {
    const { classId, priceIndex: priceIndexString } = req.params as Record<string, string>;
    const { price } = req.body;

    const priceIndex = Number(priceIndexString);
    const bookInfo = await getNftBookInfo(classId);
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
    if (!price.priceInDecimalByCurrency) {
      delete newPriceInfo.priceInDecimalByCurrency;
    }

    if (oldPriceInfo.stripeProductId) {
      const stripe = getStripeClient();
      const metadata = getStripeProductMetadata(classId, priceIndex, bookInfo);
      await stripe.products.update(oldPriceInfo.stripeProductId, {
        name: [name, typeof newPriceInfo.name === 'object' ? getLocalizedTextWithFallback(newPriceInfo.name || {}, 'zh') : newPriceInfo.name].filter(Boolean).join(' - '),
        description: [typeof newPriceInfo.description === 'object' ? getLocalizedTextWithFallback(newPriceInfo.description || {}, 'zh') : newPriceInfo.description, description].filter(Boolean).join('\n'),
        metadata,
      });
      if (oldPriceInfo.stripePriceId) {
        const oldCurrencyOverride = oldPriceInfo.priceInDecimalByCurrency || {};
        const newCurrencyOverride = newPriceInfo.priceInDecimalByCurrency || {};
        const isCurrencyOverrideChanged = BOOK_PRICE_OVERRIDE_CURRENCIES.some(
          (currency) => oldCurrencyOverride[currency] !== newCurrencyOverride[currency],
        );
        if (
          oldPriceInfo.priceInDecimal !== newPriceInfo.priceInDecimal
          || isCurrencyOverrideChanged
        ) {
          const newStripePrice = await stripe.prices.create({
            product: oldPriceInfo.stripeProductId,
            currency: 'usd',
            unit_amount: price.priceInDecimal,
            currency_options: getStripeCurrencyOptionsFromNFTBookPrice(
              price.priceInDecimal,
              newPriceInfo.priceInDecimalByCurrency,
            ),
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
      || !!enableSignatureImage
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
      amountUSD: price.priceInDecimal / 100,
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

router.put(['/:classId/price/:priceIndex/order', '/class/:classId/price/:priceIndex/order'], jwtAuth('write:nftbook'), validateParams(BookClassIdPriceIndexParamsSchema), validateBody(PriceReorderBodySchema), async (req, res, next) => {
  try {
    const { classId } = req.params as Record<string, string>;
    const bookInfo = await getNftBookInfo(classId);

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

    const { order: newOrder } = req.body;
    if (newOrder >= prices.length) {
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

router.post('/class/:classId/refresh', jwtAuth('write:nftbook'), validateParams(BookClassIdParamsSchema), async (req, res, next) => {
  try {
    const { classId } = req.params as Record<string, string>;
    const bookInfo = await getNftBookInfo(classId);
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

router.post(['/:classId/new', '/class/:classId/new'], jwtAuth('write:nftbook'), validateParams(BookClassIdParamsSchema), validateBody(NewListingBodySchema), async (req, res, next) => {
  try {
    const { classId } = req.params as Record<string, string>;
    const {
      successUrl,
      cancelUrl,
      prices,
      moderatorWallets = [],
      connectedWallets,
      mustClaimToView = false,
      hideDownload = false,
      hideAudio = false,
      hideUpsell = false,
      enableCustomMessagePage = false,
      tableOfContents,
      descriptionFull,
      isAdultOnly = false,
      isPlusReadingEnabled = false,
      isPreviewEnabled = false,
      previewPercentage,
    } = req.body;

    let ownerWallet = '';

    // Bypass cache: a stale owner could let a prior owner pass the
    // authorization check below for up to 10 min after a transfer.
    const [classData, classOwner] = await Promise.all([
      getEVMNFTClassDataById(classId, { skipCache: true }),
      getEVMNFTClassOwner(classId, { skipCache: true }),
    ]);
    const metadata = classData;
    ownerWallet = classOwner;

    const isAuthorized = checkIsAuthorized({ ownerWallet, moderatorWallets: [] }, req);
    if (!isAuthorized) throw new ValidationError('NOT_OWNER_OF_NFT_CLASS', 403);

    let autoDeliverTotalStock = 0;
    let manualDeliverTotalStock = 0;
    for (const p of prices) {
      if (p.isAutoDeliver) autoDeliverTotalStock += p.stock;
      else manualDeliverTotalStock += p.stock;
    }

    if (connectedWallets) await validateConnectedWallets(connectedWallets);
    const {
      inLanguage,
      name,
      description,
      descriptionFull: iscnDescriptionFull,
      keywords: keywordString = '',
      thumbnailUrl,
      author,
      publisher: iscnPublisher,
      usageInfo,
      isbn,
      image,
      genre,
      hasPart,
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
      // descriptionFull is listing-owned now; fall back to on-chain metadata
      // for legacy classes that still carry it.
      descriptionFull: descriptionFull ?? iscnDescriptionFull,
      hideDownload,
      hideAudio,
      hideUpsell,
      isAdultOnly,
      isPlusReadingEnabled,
      isPreviewEnabled,
      previewPercentage,

      // From ISCN content metadata
      inLanguage,
      name,
      description,
      hasPart,
      keywords,
      thumbnailUrl,
      author,
      publisher: iscnPublisher,
      usageInfo,
      isbn,
      image,
      genre,
    });

    const { potentialAction, contentFingerprints } = metadata as any;
    const targets = potentialAction?.target || [];
    const fileRecords = (await Promise.all(targets.map(async (t) => {
      const originalUrl = t.url || '';
      let url = originalUrl;
      if (originalUrl) {
        try {
          const parsed = new URL(originalUrl);
          if (
            parsed.protocol === 'https:'
            && parsed.hostname === API_HOSTNAME
            && parsed.pathname.startsWith('/arweave/v2/link/')
          ) {
            const txHash = parsed.pathname.split('/arweave/v2/link/')[1];
            if (txHash) {
              const docAccessToken = await getArweaveTxAccessToken(txHash);
              if (docAccessToken) {
                parsed.searchParams.set('token', docAccessToken);
                url = parsed.toString();
              }
            }
          }
        } catch {
          // non-URL value, fall through
        }
      }
      if (url.startsWith('ar://')) {
        url = url.replace('ar://', `${ARWEAVE_GATEWAY}/`);
      }
      return {
        url,
        name: t.name,
        contentType: t.contentType,
        isEncrypted: !!t.encodingType,
      };
    }))).filter((r) => r.url);

    const className = metadata?.name || classId;
    await Promise.all([
      sendNFTBookListingEmail({ classId, bookName: className }),
      sendNFTBookNewListingSlackNotification({
        wallet: ownerWallet,
        classId,
        className,
        prices,
        isAutoApproved,
        isAdultOnly,
        fileRecords,
        contentFingerprints,
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
        priceRangeByCurrency: getBookPriceRangeByCurrency(prices),
        imageURL: image,
        language: inLanguage,
        keywords,
        author: getAuthorNameFromMetadata(author),
        publisher: getPublisherNameFromMetadata(iscnPublisher),
        usageInfo,
        isbn,
        genre,
        isDRMFree: !hideDownload,
        isHidden: false, // Don't hide new listing until hidden
        isAdultOnly,
        isPlusReadingEnabled,
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
      isAdultOnly,
      isPlusReadingEnabled,
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

    // Pre-warm the shared ebook cache bucket (read by the ebook-cors service)
    // with the listing's files. Fire-and-forget: must not block the response.
    cacheBookFilesFromNFTClassMetadata(classId, metadata).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`Failed to cache book files for class ${classId}:`, err);
    });

    sendValidatedJSON(res, NewListingResponseSchema, {
      classId,
    });
  } catch (err) {
    next(err);
  }
});

router.post(['/:classId/settings', '/class/:classId/settings'], jwtAuth('write:nftbook'), validateParams(BookClassIdParamsSchema), validateBody(ListingSettingsBodySchema), async (req, res, next) => {
  try {
    const { classId } = req.params as Record<string, string>;
    const {
      moderatorWallets,
      connectedWallets,
      mustClaimToView,
      hideDownload,
      hideAudio,
      hideUpsell,
      enableCustomMessagePage,
      tableOfContents,
      descriptionFull,
      isAdultOnly,
      isPlusReadingEnabled,
      isPreviewEnabled,
      previewPercentage,
    } = req.body;
    const bookInfo = await getNftBookInfo(classId);
    const {
      ownerWallet,
      moderatorWallets: existingModeratorWallets = [],
    } = bookInfo;
    const isAuthorized = checkIsAuthorized(
      { ownerWallet, moderatorWallets: existingModeratorWallets },
      req,
    );
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
      descriptionFull,
      isAdultOnly,
      isPlusReadingEnabled,
      isPreviewEnabled,
      previewPercentage,
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
      isAdultOnly,
      isPlusReadingEnabled,
      moderatorWalletCount: moderatorWallets ? moderatorWallets.length : 0,
      connectedWalletCount: connectedWallets ? connectedWallets.length : 0,
    });

    sendValidatedJSON(res, ListingSettingsResponseSchema, {
      classId,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:classId/image/upload',
  jwtAuth('write:nftbook'),
  validateParams(BookClassIdParamsSchema),
  pngUpload.fields([
    { name: 'signImage', maxCount: 1 },
    { name: 'memoImage', maxCount: 1 },
  ]),
  validateBody(ImageUploadBodySchema),
  async (req, res, next) => {
    try {
      const { classId } = req.params as Record<string, string>;
      const bookInfo = await getNftBookInfo(classId);
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

      sendValidatedJSON(res, ImageUploadResponseSchema, {
        enableSignatureImage,
        signedMessageText: signedTextToSave,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
