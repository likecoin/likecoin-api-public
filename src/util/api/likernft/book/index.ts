// eslint-disable-next-line import/no-extraneous-dependencies
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { MsgSend } from 'cosmjs-types/cosmos/nft/v1beta1/tx';
import type { Request } from 'express';
import { ValidationError } from '../../../ValidationError';
import {
  db,
  FieldValue,
  Timestamp,
  likeNFTBookCollection,
} from '../../../firebase';
import { LIKER_NFT_TARGET_ADDRESS, LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES } from '../../../../../config/config';
import {
  FIRESTORE_BATCH_SIZE,
  MIN_BOOK_PRICE_DECIMAL,
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
  getISCNFromNFTClassId,
  getNFTBalance,
  getNFTClassDataById as getLikeNFTClassDataById,
  getNFTISCNData,
  getNFTsByClassId,
} from '../../../cosmos/nft';
import { getClient } from '../../../cosmos/tx';
import { sleep } from '../../../misc';
import stripe from '../../../stripe';
import { parseImageURLFromMetadata } from '../metadata';
import { getLikerLandNFTClassPageURL } from '../../../liker-land';
import { updateAirtablePublicationRecord } from '../../../airtable';
import { checkIsTrustedPublisher } from './user';

function getAuthorNameFromMetadata(author: unknown): string {
  if (typeof author === 'string') {
    return author;
  }
  if (author && typeof author === 'object') {
    const authorObj = author as Record<string, unknown>;
    return (authorObj.name as string) || '';
  }
  return '';
}

export interface NFTClassData {
  name?: string;
  description?: string;
  uri?: string;
  uriHash?: string;
  iscnIdPrefix?: string;
  // Metadata fields
  image?: string;
  inLanguage?: string;
  keywords?: string;
  author?: string | Record<string, unknown>;
  publisher?: string;
  usageInfo?: string;
  isbn?: string;
  thumbnailUrl?: string;
  // Allow other metadata fields
  [key: string]: unknown;
}

export async function getNFTClassDataById(classId: string): Promise<NFTClassData | null> {
  if (isEVMClassId(classId)) {
    try {
      return (await getEVMNftClassDataById(classId)) as NFTClassData;
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
}, req: Request): boolean {
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
  field: Record<string, string>,
  locale: string,
): string {
  return field[locale] || field[NFT_BOOK_TEXT_DEFAULT_LOCALE] || '';
}

export function formatPriceInfo(price: unknown): Record<string, unknown> {
  const priceTyped = price as {
    name?: Record<string, string>;
    description?: Record<string, string>;
    priceInDecimal?: number;
    isAllowCustomPrice?: boolean;
    stock?: number;
    isAutoDeliver?: boolean;
    isUnlisted?: boolean;
    autoMemo?: string;
    [key: string]: unknown;
  };
  const {
    name: nameInput,
    description: descriptionInput,
    priceInDecimal,
    isAllowCustomPrice = false,
    stock,
    isAutoDeliver = false,
    isUnlisted = false,
    autoMemo = '',
  } = priceTyped;
  const name: Record<string, string> = {};
  const description: Record<string, string> = {};
  NFT_BOOK_TEXT_LOCALES.forEach((locale) => {
    if (nameInput) name[locale] = nameInput[locale];
    if (descriptionInput) description[locale] = descriptionInput[locale];
  });
  return {
    name,
    description,
    priceInDecimal,
    isAllowCustomPrice,
    stock,
    isAutoDeliver,
    isUnlisted,
    autoMemo,
  };
}

export async function createStripeProductFromNFTBookPrice(classId, priceIndex, {
  bookInfo,
  price,
  site,
}) {
  const {
    name,
    description,
    iscnIdPrefix,
    image,
  } = bookInfo;
  const images: string[] = [];
  if (image) images.push(parseImageURLFromMetadata(image));
  // if (thumbnailUrl) images.push(parseImageURLFromMetadata(thumbnailUrl));
  const metadata: Record<string, string> = {
    classId,
    priceIndex,
  };
  if (iscnIdPrefix) metadata.iscnIdPrefix = bookInfo.iscnIdPrefix;
  const stripeProduct = await stripe.products.create({
    name: [name, getLocalizedTextWithFallback(price.name, 'zh')].filter(Boolean).join(' - '),
    description: [getLocalizedTextWithFallback(price.description, 'zh'), description].filter(Boolean).join('\n') || undefined,
    id: `${classId}-${priceIndex}`,
    images,
    default_price_data: {
      currency: 'usd',
      unit_amount: price.priceInDecimal,
    },
    url: getLikerLandNFTClassPageURL({ classId, priceIndex, site }),
    metadata,
  });
  return {
    stripeProductId: stripeProduct.id,
    stripePriceId: stripeProduct.default_price,
  };
}

export async function newNftBookInfo(
  classId,
  data,
  apiWalletOwnedNFTIds: string[] = [],
  site = undefined,
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
    enableCustomMessagePage,
    enableSignatureImage,
    signedMessageText,
    tableOfContents,

    inLanguage,
    name,
    description,
    keywords,
    thumbnailUrl,
    author,
    publisher,
    usageInfo,
    isbn,

    iscnIdPrefix,
    image,
  } = data;

  const stripeProducts = await Promise.all(prices
    .map((p, index) => createStripeProductFromNFTBookPrice(classId, index, {
      bookInfo: data,
      price: p,
      site,
    })));
  const newPrices = prices.map((p, order) => ({
    order,
    sold: 0,
    ...stripeProducts[order],
    ...formatPriceInfo(p),
  }));

  const isFree = newPrices.every((p) => p.priceInDecimal === 0);

  const isTrustedPublisher = await checkIsTrustedPublisher(ownerWallet);

  const timestamp = FieldValue.serverTimestamp();
  const payload: any = {
    classId,
    pendingNFTCount: 0,
    prices: newPrices,
    ownerWallet,
    timestamp,
    chain: isEVMClassId(classId) ? 'base' : 'like',
    isApprovedForSale: isTrustedPublisher || isFree,
    isApprovedForIndexing: true,
    isApprovedForAds: isTrustedPublisher,
    approvalStatus: isTrustedPublisher ? 'approved' : 'pending',
  };
  if (iscnIdPrefix) payload.iscnIdPrefix = iscnIdPrefix;
  if (image) payload.image = image;
  if (inLanguage) payload.inLanguage = inLanguage;
  if (name) payload.name = name;
  if (description) payload.description = description;
  if (keywords) payload.keywords = keywords;
  if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
  if (author) payload.author = author;
  if (publisher) payload.publisher = publisher;
  if (usageInfo) payload.usageInfo = usageInfo;
  if (isbn) payload.isbn = isbn;
  if (successUrl) payload.successUrl = successUrl;
  if (cancelUrl) payload.cancelUrl = cancelUrl;
  if (moderatorWallets) payload.moderatorWallets = moderatorWallets;
  if (connectedWallets) payload.connectedWallets = connectedWallets;
  if (mustClaimToView !== undefined) payload.mustClaimToView = mustClaimToView;
  if (hideDownload !== undefined) payload.hideDownload = hideDownload;
  if (hideAudio !== undefined) payload.hideAudio = hideAudio;
  if (enableCustomMessagePage !== undefined) {
    payload.enableCustomMessagePage = enableCustomMessagePage;
  }
  if (enableSignatureImage !== undefined) payload.enableSignatureImage = enableSignatureImage;
  if (signedMessageText !== undefined) payload.signedMessageText = signedMessageText;
  if (tableOfContents) payload.tableOfContents = tableOfContents;
  let batch = db.batch();
  batch.create(likeNFTBookCollection.doc(classId), payload);
  if (apiWalletOwnedNFTIds.length) {
    for (let i = 0; i < apiWalletOwnedNFTIds.length; i += 1) {
      if ((i + 1) % FIRESTORE_BATCH_SIZE === 0) {
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
        // TODO: remove this after solving API CPU hang error
        await sleep(10);
        batch = db.batch();
      }
      batch.set(
        likeNFTBookCollection
          .doc(classId)
          .collection('nft')
          .doc(apiWalletOwnedNFTIds[i]),
        {
          isSold: false,
          isProcessing: false,
          timestamp,
        },
        {
          merge: true,
        },
      );
    }
  }
  await batch.commit();
  return {
    isAutoApproved: isTrustedPublisher,
  };
}

export async function getNftBookInfo(classId: string) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND');
  return doc.data();
}

export async function syncNFTBookInfoWithISCN(classId) {
  const [iscnInfo, classData, bookInfo] = await Promise.all([
    isEVMClassId(classId) ? {} as any : getISCNFromNFTClassId(classId),
    getNFTClassDataById(classId),
    getNftBookInfo(classId),
  ]);
  if (!iscnInfo) throw new ValidationError('ISCN_NOT_FOUND');
  const { iscnIdPrefix } = iscnInfo;
  let metadata = {
    ...(typeof classData === 'object' && classData !== null ? classData : {}),
  };
  if (iscnIdPrefix) {
    const { data: iscnData } = await getNFTISCNData(iscnIdPrefix);
    const iscnContentMetadata = iscnData?.contentMetadata || {};
    metadata = { ...metadata, ...iscnContentMetadata };
  }
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
  } = metadata as NFTClassData;
  if (!bookInfo) {
    throw new ValidationError('BOOK_INFO_NOT_FOUND');
  }
  const {
    prices = [],
  } = bookInfo;
  const keywords = Array.isArray(keywordString) ? keywordString : keywordString.split(',').map((k: string) => k.trim()).filter((k: string) => !!k);

  const payload: any = {};
  if (iscnIdPrefix) payload.iscnIdPrefix = iscnIdPrefix;
  if (inLanguage) payload.inLanguage = inLanguage;
  if (name) payload.name = name;
  if (description) payload.description = description;
  if (keywords) payload.keywords = keywords;
  if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
  if (author) payload.author = author;
  if (publisher) payload.publisher = publisher;
  if (usageInfo) payload.usageInfo = usageInfo;
  if (isbn) payload.isbn = isbn;
  if (image) payload.image = image;
  await likeNFTBookCollection.doc(classId).update(payload);
  await Promise.all(prices.map(async (p) => {
    if (p.stripeProductId) {
      const images: string[] = [];
      if (image) images.push(parseImageURLFromMetadata(image));
      if (thumbnailUrl) images.push(parseImageURLFromMetadata(thumbnailUrl));
      await stripe.products.update(p.stripeProductId, {
        name: [name, typeof p.name === 'object' ? getLocalizedTextWithFallback(p.name || {}, 'zh') : p.name].filter(Boolean).join(' - '),
        description: [typeof p.description === 'object' ? getLocalizedTextWithFallback(p.description || {}, 'zh') : p.description, description].filter(Boolean).join('\n'),
        images: images.length ? images : undefined,
      });
    }
  }));

  if (isEVMClassId(classId)) {
    try {
      await triggerNFTIndexerUpdate({ classId });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Failed to trigger NFT indexer update for class ${classId}:`, err);
    }
  }

  try {
    const { ownerWallet } = bookInfo;
    const minPrice = prices.reduce((min, p) => Math.min(min, p.priceInDecimal), Infinity) / 100;
    const maxPrice = prices.reduce((max, p) => Math.max(max, p.priceInDecimal), 0) / 100;
    await updateAirtablePublicationRecord({
      id: classId,
      name,
      description,
      iscnIdPrefix,
      ownerWallet,
      type: 'book',
      minPrice,
      maxPrice,
      imageURL: image,
      author: getAuthorNameFromMetadata(author),
      publisher,
      language: inLanguage,
      keywords,
      usageInfo,
      isbn,
      iscnObject: iscnInfo,
      iscnContentMetadata: metadata,
      metadata: classData,
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
  enableCustomMessagePage,
  enableSignatureImage,
  signedMessageText,
  tableOfContents,
}: {
  prices?: any[];
  moderatorWallets?: string[];
  connectedWallets?: string[];
  mustClaimToView?: boolean;
  hideDownload?: boolean;
  hideAudio?: boolean;
  enableCustomMessagePage?: boolean;
  enableSignatureImage?: boolean;
  signedMessageText?: string;
  tableOfContents?: string;
} = {}, newAPIWalletOwnedNFTIds: string[] = []) {
  const timestamp = FieldValue.serverTimestamp();
  const payload: any = {
    lastUpdateTimestamp: timestamp,
  };
  if (prices !== undefined) {
    payload.prices = prices;
    payload.stripeProductIds = prices.map((p) => p.stripeProductId).filter(Boolean);
    payload.stripePriceIds = prices.map((p) => p.stripePriceId).filter(Boolean);
  }
  if (moderatorWallets !== undefined) { payload.moderatorWallets = moderatorWallets; }
  if (connectedWallets !== undefined) { payload.connectedWallets = connectedWallets; }
  if (mustClaimToView !== undefined) { payload.mustClaimToView = mustClaimToView; }
  if (hideDownload !== undefined) { payload.hideDownload = hideDownload; }
  if (hideAudio !== undefined) { payload.hideAudio = hideAudio; }
  if (enableCustomMessagePage !== undefined) {
    payload.enableCustomMessagePage = enableCustomMessagePage;
  }
  if (enableSignatureImage !== undefined) { payload.enableSignatureImage = enableSignatureImage; }
  if (signedMessageText !== undefined) { payload.signedMessageText = signedMessageText; }
  if (tableOfContents !== undefined) { payload.tableOfContents = tableOfContents; }
  const classIdRef = likeNFTBookCollection.doc(classId);
  let batch = db.batch();
  batch.update(classIdRef, payload);
  if (newAPIWalletOwnedNFTIds?.length) {
    for (let i = 0; i < newAPIWalletOwnedNFTIds.length; i += 1) {
      if ((i + 1) % FIRESTORE_BATCH_SIZE === 0) {
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
        // TODO: remove this after solving API CPU hang error
        await sleep(10);
        batch = db.batch();
      }
      batch.set(
        likeNFTBookCollection
          .doc(classId)
          .collection('nft')
          .doc(newAPIWalletOwnedNFTIds[i]),
        {
          isSold: false,
          isProcessing: false,
          timestamp,
        },
        {
          merge: true,
        },
      );
    }
  }
  await batch.commit();
  await syncNFTBookInfoWithISCN(classId);
}

export async function listLatestNFTBookInfo({
  ownerWallet,
  excludedOwnerWallet,
  chain,
  before,
  limit,
  key,
}: {
  ownerWallet?: string;
  excludedOwnerWallet?: string;
  chain?: string;
  before?: number;
  limit?: number;
  key?: number;
} = {}) {
  let snapshot = likeNFTBookCollection.orderBy('timestamp', 'desc');
  if (ownerWallet) snapshot = snapshot.where('ownerWallet', '==', ownerWallet);
  if (excludedOwnerWallet) snapshot = snapshot.where('ownerWallet', '!=', excludedOwnerWallet);
  if (chain) snapshot = snapshot.where('chain', '==', chain);
  const tsNumber = before || key;
  if (tsNumber) {
    // HACK: bypass startAfter() type check
    const timestamp = Timestamp.fromMillis(tsNumber) as unknown as number;
    snapshot = snapshot.startAfter(timestamp);
  }
  if (limit) {
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
  let queryRef: any = likeNFTBookCollection;
  if (!LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(moderatorWallet)) {
    queryRef = queryRef
      .where('moderatorWallets', 'array-contains', moderatorWallet);
  }
  if (chain) {
    queryRef = queryRef.where('chain', '==', chain);
  }
  const query = await queryRef.limit(MAX_BOOK_ITEMS_LIMIT).get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
}

export function validatePrice(price: any) {
  const {
    autoMemo,
    order,
    stock,
    name = {},
    description = {},
    isAllowCustomPrice,
    isAutoDeliver,
    isUnlisted,
    priceInDecimal,
  } = price;
  if (!(
    typeof priceInDecimal === 'number'
    && priceInDecimal >= 0
    && (priceInDecimal === 0 || priceInDecimal >= MIN_BOOK_PRICE_DECIMAL)
  )) {
    throw new ValidationError('INVALID_PRICE');
  }
  if (!(typeof stock === 'number' && stock >= 0)) {
    throw new ValidationError('INVALID_PRICE_STOCK');
  }
  if (!(typeof name[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string'
    && Object.values(name).every((n) => typeof n === 'string'))) {
    throw new ValidationError('INVALID_PRICE_NAME');
  }
  if (!(typeof description[NFT_BOOK_TEXT_DEFAULT_LOCALE] === 'string'
    && Object.values(description).every((n) => typeof n === 'string'))) {
    throw new ValidationError('INVALID_PRICE_DESCRIPTION');
  }
  return {
    autoMemo,
    order,
    priceInDecimal,
    stock,
    name,
    description,
    isAutoDeliver,
    isUnlisted,
    isAllowCustomPrice,
  };
}

export function validatePrices(prices: any[]) {
  if (!prices.length) throw new ValidationError('PRICES_ARE_EMPTY');
  let i = 0;
  let autoDeliverTotalStock = 0;
  let manualDeliverTotalStock = 0;
  const outputPrices: any = [];
  try {
    for (i = 0; i < prices.length; i += 1) {
      const inputPrice = prices[i];
      const price = validatePrice(inputPrice);
      outputPrices.push(price);
      if (price.isAutoDeliver) {
        autoDeliverTotalStock += price.stock;
      } else {
        manualDeliverTotalStock += price.stock;
      }
    }
  } catch (err) {
    const errorMessage = `${(err as Error).message}_in_${i}`;
    throw new ValidationError(errorMessage);
  }
  return {
    prices: outputPrices,
    autoDeliverTotalStock,
    manualDeliverTotalStock,
  };
}

export async function validateStocks(
  classId: string,
  wallet: string,
  manualDeliverTotalStock: number,
  autoDeliverTotalStock: number,
) {
  let apiWalletOwnedNFTs: any[] = [];
  let apiWalletOwnedNFTCount = 0;
  if (!isEVMClassId(classId)) {
    apiWalletOwnedNFTCount = LIKER_NFT_TARGET_ADDRESS
      ? await getNFTBalance(classId, LIKER_NFT_TARGET_ADDRESS)
      : 0;
    if (apiWalletOwnedNFTCount < autoDeliverTotalStock) {
      throw new ValidationError(`NOT_ENOUGH_AUTO_DELIVER_NFT_COUNT: ${classId}, EXPECTED: ${autoDeliverTotalStock}, ACTUAL: ${apiWalletOwnedNFTCount}`, 403);
    }
    if (apiWalletOwnedNFTCount) {
      ({ nfts: apiWalletOwnedNFTs } = await getNFTsByClassId(classId, LIKER_NFT_TARGET_ADDRESS));
    }
  }

  return {
    apiWalletOwnedNFTs,
  };
}

async function parseNFTIdsMapFromTxHash(txHash: string, sender: string) {
  if (!txHash) throw new ValidationError('TX_HASH_IS_EMPTY');
  const client = await getClient();
  let tx;
  for (let tryCount = 0; tryCount < 4; tryCount += 1) {
    tx = await client.getTx(txHash);
    if (tx) break;
    await sleep(3000);
  }
  if (!tx) throw new ValidationError('TX_NOT_FOUND');
  const { code, tx: rawTx } = tx;
  if (code) throw new ValidationError('TX_FAILED');
  const { body } = decodeTxRaw(rawTx);
  const sendMessages = body.messages
    .filter((m) => m.typeUrl === '/cosmos.nft.v1beta1.MsgSend')
    .map(((m) => MsgSend.decode(m.value)))
    .filter((m) => m.sender === sender
      && m.receiver === LIKER_NFT_TARGET_ADDRESS);
  const nftIdsMap = {};
  sendMessages.forEach((m) => {
    nftIdsMap[m.classId] ??= [];
    nftIdsMap[m.classId].push(m.id);
  });
  return nftIdsMap;
}

export async function validateAutoDeliverNFTsTxHash(
  txHash: string,
  classId: string,
  sender: string,
  expectedNFTCount: number,
) {
  if (isEVMClassId(classId)) {
    // evm auto deliver nfts are minted on demand
    return [];
  }
  const nftIdsMap = await parseNFTIdsMapFromTxHash(txHash, sender);
  const nftIds = nftIdsMap[classId];
  if (!nftIds) {
    throw new ValidationError(`TX_SEND_NFT_CLASS_ID_NOT_FOUND: ${classId}`);
  }
  if (nftIds.length < expectedNFTCount) {
    throw new ValidationError(`TX_SEND_NFT_COUNT_NOT_ENOUGH: EXPECTED: ${expectedNFTCount}, ACTUAL: ${nftIds.length}`);
  }
  return nftIds;
}

// TODO: replace validateAutoDeliverNFTsTxHash with this
export async function validateAutoDeliverNFTsTxHashV2({
  txHash,
  sender,
  expectedNFTCountMap,
}: {
  txHash: string;
  sender: string;
  expectedNFTCountMap: Record<string, number>;
}) {
  const nftIdsMap = await parseNFTIdsMapFromTxHash(txHash, sender);
  Object.entries(expectedNFTCountMap).forEach(([classId, expectedNFTCount]) => {
    const nftIds = nftIdsMap[classId];
    if (!nftIds) {
      throw new ValidationError(`TX_SEND_NFT_CLASS_ID_NOT_FOUND: ${classId}`);
    }
    if (nftIds.length < expectedNFTCount) {
      throw new ValidationError(`TX_SEND_NFT_COUNT_NOT_ENOUGH: EXPECTED: ${expectedNFTCount}, ACTUAL: ${nftIds.length}`);
    }
  });
  return nftIdsMap;
}

export function getNFTBookStoreClassPageURL(classId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/my-books/status/${classId}`;
}

export function getNFTBookStoreSendPageURL(classId: string, paymentId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/my-books/send/${classId}/?payment_id=${paymentId}`;
}
