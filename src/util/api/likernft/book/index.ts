// eslint-disable-next-line import/no-extraneous-dependencies
import type { Request } from 'express';
import type { Query } from 'firebase-admin/firestore';
import { ValidationError } from '../../../ValidationError';
import {
  FieldValue,
  Timestamp,
  likeNFTBookCollection,
} from '../../../firebase';
import { LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../../config/config';
import {
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  NFT_BOOK_TEXT_LOCALES,
  NFT_BOOKSTORE_HOSTNAME,
} from '../../../../constant';
import {
  getNFTClassDataById as getEVMNftClassDataById,
  isEVMClassId,
  triggerNFTIndexerUpdate,
} from '../../../evm/nft';
import {
  getNFTClassDataById as getLikeNFTClassDataById,
} from '../../../cosmos/nft';
import { getStripeClient } from '../../../stripe';
import { parseImageURLFromMetadata } from '../metadata';
import { getBook3NFTClassPageURL } from '../../../liker-land';
import { updateAirtablePublicationRecord } from '../../../airtable';
import { checkIsTrustedPublisher } from './user';
import { cacheBookFilesFromNFTClassMetadata } from './cache';
import type {
  BookContributor, BookSignatureImage, NFTBookListingInfo, NFTBookPrice,
} from '../../../../types/book';
import { getBookPriceRangeByCurrency, getStripeCurrencyOptionsFromNFTBookPrice } from '../../../pricing';

export function getNameFromMetadata(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const valueObj = value as Record<string, unknown>;
    if (typeof valueObj.name === 'string') {
      return valueObj.name;
    }
  }
  return '';
}

export function getAuthorNameFromMetadata(author: unknown): string {
  return getNameFromMetadata(author);
}

export function getPublisherNameFromMetadata(publisher: unknown): string {
  return getNameFromMetadata(publisher);
}

export function getStripeProductMetadata(
  classId: string,
  priceIndex: number,
  bookInfo: NFTBookListingInfo,
): Record<string, string> {
  return {
    classId,
    priceIndex: priceIndex.toString(),
    author: getAuthorNameFromMetadata(bookInfo.author),
    publisher: getPublisherNameFromMetadata(bookInfo.publisher),
    inLanguage: bookInfo.inLanguage || '',
    keywords: bookInfo.keywords ? bookInfo.keywords.join(', ') : '',
    usageInfo: bookInfo.usageInfo || '',
  };
}

export interface NFTClassDataHasPart {
  '@type'?: string;
  isAccessibleForFree?: boolean;
  text?: string;
}

export interface NFTClassData {
  '@type'?: string;
  name?: string;
  description?: string;
  descriptionFull?: string;
  alternativeHeadline?: string;
  url?: string;
  uri?: string;
  uriHash?: string;
  iscnIdPrefix?: string;
  // Metadata fields
  image?: string;
  inLanguage?: string;
  datePublished?: string;
  keywords?: string | string[];
  author?: BookContributor;
  publisher?: BookContributor;
  usageInfo?: string;
  isbn?: string;
  thumbnailUrl?: string;
  genre?: string;
  contentFingerprints?: string[];
  sameAs?: string[];
  potentialAction?: { '@type'?: string; target?: unknown[] };
  hasPart?: NFTClassDataHasPart | NFTClassDataHasPart[];
  recordNotes?: string;
  // Allow other metadata fields
  [key: string]: unknown;
}

export function getPreviewContentFromHasPart(
  hasPart?: NFTClassData['hasPart'],
): string | undefined {
  if (!hasPart) return undefined;
  const parts = Array.isArray(hasPart) ? hasPart : [hasPart];
  const previewPart = parts.find(
    (p) => p.isAccessibleForFree === true && !!p.text,
  );
  return previewPart?.text;
}

export async function getNFTClassDataById(
  classId: string,
  { skipCache = false }: { skipCache?: boolean } = {},
): Promise<NFTClassData | null> {
  if (isEVMClassId(classId)) {
    try {
      return (await getEVMNftClassDataById(classId, { skipCache })) as NFTClassData;
    } catch (error) {
      return null;
    }
  }
  const data = await getLikeNFTClassDataById(classId);
  if (!data) return null;
  const {
    name,
    description,
    uri,
    uriHash,
    data: { metadata = {}, parent } = {},
  } = data;
  return {
    name,
    description,
    uri,
    uriHash,
    ...metadata,
    iscnIdPrefix: parent?.iscnIdPrefix,
  } as NFTClassData;
}

export function checkIsAuthorized({
  ownerWallet,
  moderatorWallets = [],
} : {
  ownerWallet: string;
  moderatorWallets?: string[];
}, req: Pick<Request, 'user'>): boolean {
  if (!req.user) return false;
  const {
    wallet,
    likeWallet,
    evmWallet,
  } = req.user;
  return [wallet, likeWallet, evmWallet]
    .some((w) => w && (w === ownerWallet || moderatorWallets.includes(w)));
}

export function getLocalizedTextWithFallback(
  field: string | Record<string, string>,
  locale: string,
): string {
  if (typeof field === 'string') {
    return field;
  }
  return field[locale] || field[NFT_BOOK_TEXT_DEFAULT_LOCALE] || '';
}

export function formatPriceInfo(price: NFTBookPrice): NFTBookPrice {
  const {
    name: nameInput,
    description: descriptionInput,
    priceInDecimal,
    priceInDecimalByCurrency,
    isAllowCustomPrice = false,
    stock,
    isAutoDeliver = false,
    isUnlisted = false,
    autoMemo = '',
  } = price;
  const name: Record<string, string> = {};
  const description: Record<string, string> = {};
  NFT_BOOK_TEXT_LOCALES.forEach((locale) => {
    if (nameInput) name[locale] = nameInput[locale];
    if (descriptionInput) description[locale] = descriptionInput[locale];
  });
  const formatted: NFTBookPrice = {
    name,
    description,
    priceInDecimal,
    isAllowCustomPrice,
    stock,
    isAutoDeliver,
    isUnlisted,
    autoMemo,
  };
  if (priceInDecimalByCurrency) formatted.priceInDecimalByCurrency = priceInDecimalByCurrency;
  return formatted;
}

// Cheapest customer-visible (non-unlisted) priceInDecimal across a book's prices,
// or undefined when there is no listed price.
// Denormalized onto the book doc so free books (== 0) can be queried directly.
export function getMinListedPriceInDecimal(prices: NFTBookPrice[] = []) {
  // Number.isFinite rejects NaN and ±Infinity;
  // `typeof === 'number'` lets NaN through and would poison the reducer.
  const listed = prices.filter(
    (p) => !p.isUnlisted && Number.isFinite(p.priceInDecimal),
  );
  if (!listed.length) return undefined;
  return listed.reduce((min, p) => Math.min(min, p.priceInDecimal), Infinity);
}

export async function createStripeProductFromNFTBookPrice(classId: string, priceIndex: number, {
  bookInfo,
  price,
}: {
  bookInfo: NFTBookListingInfo;
  price: NFTBookPrice;
}) {
  const {
    name,
    description,
    image,
  } = bookInfo;
  const images: string[] = [];
  if (image) images.push(parseImageURLFromMetadata(image));
  // if (thumbnailUrl) images.push(parseImageURLFromMetadata(thumbnailUrl));
  const metadata = getStripeProductMetadata(classId, priceIndex, bookInfo);
  const stripeProduct = await getStripeClient().products.create({
    name: [name, getLocalizedTextWithFallback(price.name || '', 'zh')].filter(Boolean).join(' - '),
    description: [getLocalizedTextWithFallback(price.description || '', 'zh'), description].filter(Boolean).join('\n') || undefined,
    id: `${classId}-${priceIndex}`,
    images,
    default_price_data: {
      currency: 'usd',
      unit_amount: price.priceInDecimal,
      currency_options: getStripeCurrencyOptionsFromNFTBookPrice(
        price.priceInDecimal,
        price.priceInDecimalByCurrency,
      ),
    },
    url: getBook3NFTClassPageURL({ classId, priceIndex }),
    metadata,
  });
  return {
    stripeProductId: stripeProduct.id,
    stripePriceId: stripeProduct.default_price as string,
  };
}

export async function newNftBookInfo(
  classId,
  data,
) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (doc.exists) throw new ValidationError('CLASS_ID_ALREADY_EXISTS', 409);
  const {
    prices,
    ownerWallet,
    successUrl,
    cancelUrl,
    moderatorWallets,
    connectedWallets,
    mustClaimToView,
    hideDownload,
    hideAudio,
    hideUpsell,
    enableCustomMessagePage,
    enableSignatureImage,
    signedMessageText,
    tableOfContents,

    inLanguage,
    name,
    description,
    descriptionFull,
    keywords,
    thumbnailUrl,
    author,
    publisher,
    usageInfo,
    isbn,
    genre,
    hasPart,

    image,
    isAdultOnly,
    isPlusReadingEnabled,
  } = data;
  const previewContent = getPreviewContentFromHasPart(hasPart);

  const stripeProducts = await Promise.all(prices
    .map((p, index) => createStripeProductFromNFTBookPrice(classId, index, {
      bookInfo: data,
      price: p,
    })));
  const newPrices = prices.map((p, order) => ({
    order,
    sold: 0,
    ...stripeProducts[order],
    ...formatPriceInfo(p),
  }));

  const isTrustedPublisher = await checkIsTrustedPublisher(ownerWallet);

  const timestamp = FieldValue.serverTimestamp();
  const payload: NFTBookListingInfo = {
    classId,
    pendingNFTCount: 0,
    prices: newPrices,
    ownerWallet,
    timestamp: timestamp as any,
    chain: isEVMClassId(classId) ? 'base' : 'like',
    // Default new listings to on-shelf: sellable and indexed, but not promoted.
    // Ads are auto-approved only for trusted publishers (never for adult content);
    // everyone else stays `pending` until an admin grants ads via `/book approve`.
    isApprovedForSale: true,
    isApprovedForIndexing: true,
    isApprovedForAds: (isAdultOnly ? false : isTrustedPublisher),
    approvalStatus: isTrustedPublisher ? 'approved' : 'pending',
  };
  const minPriceInDecimal = getMinListedPriceInDecimal(newPrices);
  if (minPriceInDecimal !== undefined) payload.minPriceInDecimal = minPriceInDecimal;
  if (image) payload.image = image;
  if (inLanguage) payload.inLanguage = inLanguage;
  if (name) payload.name = name;
  if (description) payload.description = description;
  if (descriptionFull) payload.descriptionFull = descriptionFull;
  if (previewContent) payload.previewContent = previewContent;
  if (keywords) payload.keywords = keywords;
  if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
  if (author) payload.author = author;
  if (publisher) payload.publisher = publisher;
  if (usageInfo) payload.usageInfo = usageInfo;
  if (isbn) payload.isbn = isbn;
  if (genre) payload.genre = genre;
  if (successUrl) payload.successUrl = successUrl;
  if (cancelUrl) payload.cancelUrl = cancelUrl;
  if (moderatorWallets) payload.moderatorWallets = moderatorWallets;
  if (connectedWallets) payload.connectedWallets = connectedWallets;
  if (mustClaimToView !== undefined) payload.mustClaimToView = mustClaimToView;
  if (hideDownload !== undefined) payload.hideDownload = hideDownload;
  if (hideAudio !== undefined) payload.hideAudio = hideAudio;
  if (hideUpsell !== undefined) payload.hideUpsell = hideUpsell;
  if (enableCustomMessagePage !== undefined) {
    payload.enableCustomMessagePage = enableCustomMessagePage;
  }
  if (enableSignatureImage !== undefined) payload.enableSignatureImage = enableSignatureImage;
  if (signedMessageText !== undefined) payload.signedMessageText = signedMessageText;
  if (tableOfContents) payload.tableOfContents = tableOfContents;
  if (isAdultOnly !== undefined) payload.isAdultOnly = isAdultOnly;
  if (isPlusReadingEnabled !== undefined) payload.isPlusReadingEnabled = isPlusReadingEnabled;
  await likeNFTBookCollection.doc(classId).create(payload);
  return {
    isAutoApproved: isTrustedPublisher,
  };
}

export async function getNftBookInfo(classId: string): Promise<NFTBookListingInfo> {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND', 404);
  return doc.data()!;
}

export async function syncNFTBookInfoWithISCN(classId) {
  // Bypass cache: this sync runs after the user updated on-chain metadata,
  // so it must read fresh chain data to refresh the DB.
  const [classData, bookInfo] = await Promise.all([
    getNFTClassDataById(classId, { skipCache: true }),
    getNftBookInfo(classId),
  ]);
  const metadata = {
    ...(typeof classData === 'object' && classData !== null ? classData : {}),
  };
  const {
    inLanguage,
    name,
    description,
    keywords: keywordString = '',
    thumbnailUrl,
    author,
    publisher,
    usageInfo,
    isbn,
    image,
    genre,
    hasPart,
  } = metadata as NFTClassData;
  const previewContent = getPreviewContentFromHasPart(hasPart);
  if (!bookInfo) {
    throw new ValidationError('BOOK_INFO_NOT_FOUND');
  }
  const {
    prices = [],
  } = bookInfo;
  const keywords = Array.isArray(keywordString) ? keywordString : keywordString.split(',').map((k: string) => k.trim()).filter((k: string) => !!k);

  const payload: any = {};
  if (inLanguage) payload.inLanguage = inLanguage;
  if (name) payload.name = name;
  if (description) payload.description = description;
  // descriptionFull is now a listing-owned field edited via /settings; do not
  // overwrite it from on-chain metadata on refresh.
  payload.previewContent = previewContent || FieldValue.delete();
  if (keywords) payload.keywords = keywords;
  if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
  if (author) payload.author = author;
  if (publisher) payload.publisher = publisher;
  if (usageInfo) payload.usageInfo = usageInfo;
  if (isbn) payload.isbn = isbn;
  if (image) payload.image = image;
  if (genre) payload.genre = genre;
  await likeNFTBookCollection.doc(classId).update(payload);
  await Promise.all(prices.map(async (p, priceIndex) => {
    if (p.stripeProductId) {
      const stripeMetadata = getStripeProductMetadata(classId, priceIndex, bookInfo);
      const images: string[] = [];
      if (image) images.push(parseImageURLFromMetadata(image));
      if (thumbnailUrl) images.push(parseImageURLFromMetadata(thumbnailUrl));
      await getStripeClient().products.update(p.stripeProductId, {
        name: [name, typeof p.name === 'object' ? getLocalizedTextWithFallback(p.name || {}, 'zh') : p.name].filter(Boolean).join(' - '),
        description: [typeof p.description === 'object' ? getLocalizedTextWithFallback(p.description || {}, 'zh') : p.description, description].filter(Boolean).join('\n'),
        images: images.length ? images : undefined,
        metadata: stripeMetadata,
      });
    }
  }));

  try {
    await triggerNFTIndexerUpdate({ classId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Failed to trigger NFT indexer update for class ${classId}:`, err);
  }

  // The on-chain metadata (including file paths) may have changed; re-warm the
  // shared ebook cache bucket. Fire-and-forget: must not block the sync.
  cacheBookFilesFromNFTClassMetadata(classId, metadata).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`Failed to cache book files for class ${classId}:`, err);
  });

  try {
    const {
      ownerWallet,
      hideDownload,
      isHidden,
      isAdultOnly,
      isPlusReadingEnabled,
    } = bookInfo;
    const minPrice = prices.reduce((min, p) => Math.min(min, p.priceInDecimal), Infinity) / 100;
    const maxPrice = prices.reduce((max, p) => Math.max(max, p.priceInDecimal), 0) / 100;
    const priceRangeByCurrency = getBookPriceRangeByCurrency(prices);
    await updateAirtablePublicationRecord({
      id: classId,
      name,
      description,
      iscnIdPrefix: '',
      ownerWallet,
      type: 'book',
      minPrice,
      maxPrice,
      priceRangeByCurrency,
      imageURL: image,
      author: getAuthorNameFromMetadata(author),
      publisher: getPublisherNameFromMetadata(publisher),
      language: inLanguage,
      keywords,
      usageInfo,
      isbn,
      genre,
      iscnObject: null,
      iscnContentMetadata: metadata,
      metadata: classData,
      isDRMFree: !hideDownload,
      isHidden: !!isHidden,
      isAdultOnly: !!isAdultOnly,
      isPlusReadingEnabled: !!isPlusReadingEnabled,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to sync NFT Book info with Airtable publication record:', err);
  }
}

export async function updateNftBookInfo(classId: string, {
  prices,
  moderatorWallets,
  connectedWallets,
  mustClaimToView,
  hideDownload,
  hideAudio,
  hideUpsell,
  enableCustomMessagePage,
  enableSignatureImage,
  signedMessageText,
  tableOfContents,
  descriptionFull,
  isAdultOnly,
  isPlusReadingEnabled,
}: {
  prices?: NFTBookPrice[];
  moderatorWallets?: string[];
  connectedWallets?: string[];
  mustClaimToView?: boolean;
  hideDownload?: boolean;
  hideAudio?: boolean;
  hideUpsell?: boolean;
  enableCustomMessagePage?: boolean;
  enableSignatureImage?: BookSignatureImage;
  signedMessageText?: string;
  tableOfContents?: string;
  descriptionFull?: string;
  isAdultOnly?: boolean;
  isPlusReadingEnabled?: boolean;
} = {}) {
  const timestamp = FieldValue.serverTimestamp();
  const payload: any = {
    lastUpdateTimestamp: timestamp,
  };
  if (prices !== undefined) {
    payload.prices = prices;
    payload.stripeProductIds = prices.map((p) => p.stripeProductId).filter(Boolean);
    payload.stripePriceIds = prices.map((p) => p.stripePriceId).filter(Boolean);
    const minPriceInDecimal = getMinListedPriceInDecimal(prices);
    payload.minPriceInDecimal = minPriceInDecimal === undefined
      ? FieldValue.delete()
      : minPriceInDecimal;
  }
  if (moderatorWallets !== undefined) { payload.moderatorWallets = moderatorWallets; }
  if (connectedWallets !== undefined) { payload.connectedWallets = connectedWallets; }
  if (mustClaimToView !== undefined) { payload.mustClaimToView = mustClaimToView; }
  if (hideDownload !== undefined) { payload.hideDownload = hideDownload; }
  if (hideAudio !== undefined) { payload.hideAudio = hideAudio; }
  if (hideUpsell !== undefined) { payload.hideUpsell = hideUpsell; }
  if (enableCustomMessagePage !== undefined) {
    payload.enableCustomMessagePage = enableCustomMessagePage;
  }
  if (enableSignatureImage !== undefined) { payload.enableSignatureImage = enableSignatureImage; }
  if (signedMessageText !== undefined) { payload.signedMessageText = signedMessageText; }
  if (tableOfContents !== undefined) { payload.tableOfContents = tableOfContents; }
  if (descriptionFull !== undefined) { payload.descriptionFull = descriptionFull; }
  if (isAdultOnly !== undefined) {
    payload.isAdultOnly = isAdultOnly;
    if (isAdultOnly) { payload.isApprovedForAds = false; }
  }
  if (isPlusReadingEnabled !== undefined) { payload.isPlusReadingEnabled = isPlusReadingEnabled; }
  await likeNFTBookCollection.doc(classId).update(payload);
  await syncNFTBookInfoWithISCN(classId);
}

export async function listLatestNFTBookInfo({
  ownerWallet,
  chain,
  isPlusReadingEnabled,
  before,
  limit,
  key,
}: {
  ownerWallet?: string;
  chain?: string;
  isPlusReadingEnabled?: boolean;
  before?: number;
  limit?: number;
  key?: number;
} = {}) {
  let snapshot = likeNFTBookCollection.orderBy('timestamp', 'desc');
  if (ownerWallet) snapshot = snapshot.where('ownerWallet', '==', ownerWallet);
  if (chain) snapshot = snapshot.where('chain', '==', chain);
  if (isPlusReadingEnabled !== undefined) {
    snapshot = snapshot.where('isPlusReadingEnabled', '==', isPlusReadingEnabled);
  }
  // `??` (not `||`) so a legitimate cursor of 0 is preserved; routes are
  // expected to reject NaN/array inputs before reaching this function.
  const tsNumber = before ?? key;
  if (tsNumber !== undefined) {
    snapshot = snapshot.startAfter(Timestamp.fromMillis(tsNumber));
  }
  if (limit !== undefined) {
    snapshot = snapshot.limit(limit);
  }
  const query = await snapshot.get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
}

export async function listFilteredNFTBookInfo({
  filter,
  isPlusReadingEnabled,
  before,
  limit,
  key,
}: {
  filter: 'free' | 'drm-free';
  isPlusReadingEnabled?: boolean;
  before?: number;
  limit?: number;
  key?: number;
}) {
  let snapshot = filter === 'free'
    ? likeNFTBookCollection.where('minPriceInDecimal', '==', 0)
    : likeNFTBookCollection.where('hideDownload', '==', false);
  if (isPlusReadingEnabled !== undefined) {
    snapshot = snapshot.where('isPlusReadingEnabled', '==', isPlusReadingEnabled);
  }
  snapshot = snapshot.orderBy('timestamp', 'desc');
  const tsNumber = before ?? key;
  if (tsNumber !== undefined) {
    snapshot = snapshot.startAfter(Timestamp.fromMillis(tsNumber));
  }
  if (limit !== undefined) {
    snapshot = snapshot.limit(limit);
  }
  const query = await snapshot.get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
}

export async function listNftBookInfoByModeratorWallet(
  moderatorWallet: string,
  { chain = '' } = {},
) {
  const MAX_BOOK_ITEMS_LIMIT = 256;
  let queryRef: Query = likeNFTBookCollection;
  if (!LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(moderatorWallet)) {
    queryRef = queryRef
      .where('moderatorWallets', 'array-contains', moderatorWallet);
  }
  if (chain) {
    queryRef = queryRef.where('chain', '==', chain);
  }
  const query = await queryRef.limit(MAX_BOOK_ITEMS_LIMIT).get();
  return query.docs.map((doc) => {
    const docData = doc.data() as NFTBookListingInfo;
    return { id: doc.id, ...docData };
  });
}

export function getNFTBookStoreClassPageURL(classId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/my-books/status/${classId}`;
}

export function getNFTBookStoreSendPageURL(classId: string, paymentId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/my-books/send/${classId}/?payment_id=${paymentId}`;
}
