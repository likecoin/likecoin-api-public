// eslint-disable-next-line import/no-extraneous-dependencies
import { decodeTxRaw } from '@cosmjs/proto-signing';
import { MsgSend } from 'cosmjs-types/cosmos/nft/v1beta1/tx';
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
  LIKER_LAND_HOSTNAME,
  MIN_BOOK_PRICE_DECIMAL,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
  NFT_BOOK_TEXT_LOCALES,
  NFT_BOOKSTORE_HOSTNAME,
} from '../../../../constant';
import {
  getISCNFromNFTClassId, getNFTClassDataById, getNFTISCNData, getNFTsByClassId,
} from '../../../cosmos/nft';
import { getClient } from '../../../cosmos/tx';
import { sleep } from '../../../misc';
import stripe from '../../../stripe';
import { parseImageURLFromMetadata } from '../metadata';
import { filterNFTBookListingInfo } from '../../../ValidationHelper';
import { importGoogleRetailProductFromBookListing } from '../../../googleRetail';

export function getLocalizedTextWithFallback(field, locale) {
  return field[locale] || field[NFT_BOOK_TEXT_DEFAULT_LOCALE] || '';
}

export function formatPriceInfo(price) {
  const {
    name: nameInput,
    description: descriptionInput,
    priceInDecimal,
    hasShipping = false,
    isPhysicalOnly = false,
    isAllowCustomPrice = false,
    stock,
    isAutoDeliver = false,
    isUnlisted = false,
    autoMemo = '',
  } = price;
  const name = {};
  const description = {};
  NFT_BOOK_TEXT_LOCALES.forEach((locale) => {
    name[locale] = nameInput[locale];
    description[locale] = descriptionInput[locale];
  });
  return {
    name,
    description,
    priceInDecimal,
    hasShipping,
    isPhysicalOnly,
    isAllowCustomPrice,
    stock,
    isAutoDeliver,
    isUnlisted,
    autoMemo,
  };
}

export function formatShippingRateInfo(shippingRate) {
  const {
    name: nameInput,
    priceInDecimal,
  } = shippingRate;
  const name = {};
  NFT_BOOK_TEXT_LOCALES.forEach((locale) => {
    name[locale] = nameInput[locale];
  });
  return {
    name,
    priceInDecimal,
  };
}

export async function createStripeProductFromNFTBookPrice(classId, priceIndex, {
  bookInfo,
  price,
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
  const stripeProduct = await stripe.products.create({
    name: [name, getLocalizedTextWithFallback(price.name, 'zh')].filter(Boolean).join(' - '),
    description: [getLocalizedTextWithFallback(price.description, 'zh'), description].filter(Boolean).join('\n') || undefined,
    id: `${classId}-${priceIndex}`,
    images,
    shippable: price.hasShipping,
    default_price_data: {
      currency: 'usd',
      unit_amount: price.priceInDecimal,
    },
    url: `https://${LIKER_LAND_HOSTNAME}/nft/class/${classId}?price_index=${priceIndex}`,
    metadata: {
      classId,
      iscnIdPrefix,
      priceIndex,
    },
  });
  return {
    stripeProductId: stripeProduct.id,
    stripePriceId: stripeProduct.default_price,
  };
}

export async function newNftBookInfo(classId, data, apiWalletOwnedNFTIds: string[] = []) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (doc.exists) throw new ValidationError('CLASS_ID_ALREADY_EXISTS', 409);
  const {
    prices,
    ownerWallet,
    successUrl,
    cancelUrl,
    notificationEmails,
    moderatorWallets,
    connectedWallets,
    shippingRates,
    mustClaimToView,
    hideDownload,
    enableCustomMessagePage,

    inLanguage,
    name,
    description,
    keywords,
    thumbnailUrl,
    author,
    usageInfo,
    isbn,

    iscnIdPrefix,
    image,
  } = data;

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

  const timestamp = FieldValue.serverTimestamp();
  const payload: any = {
    classId,
    pendingNFTCount: 0,
    prices: newPrices,
    ownerWallet,
    timestamp,
  };
  if (iscnIdPrefix) payload.iscnIdPrefix = iscnIdPrefix;
  if (image) payload.image = image;
  if (inLanguage) payload.inLanguage = inLanguage;
  if (name) payload.name = name;
  if (description) payload.description = description;
  if (keywords) payload.keywords = keywords;
  if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
  if (author) payload.author = author;
  if (usageInfo) payload.usageInfo = usageInfo;
  if (isbn) payload.isbn = isbn;
  if (successUrl) payload.successUrl = successUrl;
  if (cancelUrl) payload.cancelUrl = cancelUrl;
  if (moderatorWallets) payload.moderatorWallets = moderatorWallets;
  if (notificationEmails) payload.notificationEmails = notificationEmails;
  if (connectedWallets) payload.connectedWallets = connectedWallets;
  if (shippingRates) payload.shippingRates = shippingRates.map((s) => formatShippingRateInfo(s));
  if (mustClaimToView !== undefined) payload.mustClaimToView = mustClaimToView;
  if (hideDownload !== undefined) payload.hideDownload = hideDownload;
  if (enableCustomMessagePage !== undefined) {
    payload.enableCustomMessagePage = enableCustomMessagePage;
  }
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
}

export async function getNftBookInfo(classId) {
  const doc = await likeNFTBookCollection.doc(classId).get();
  if (!doc.exists) throw new ValidationError('CLASS_ID_NOT_FOUND');
  return doc.data();
}

export async function syncNFTBookInfoWithISCN(classId) {
  const [iscnInfo, metadata, bookInfo] = await Promise.all([
    getISCNFromNFTClassId(classId),
    getNFTClassDataById(classId),
    getNftBookInfo(classId),
  ]);
  if (!iscnInfo) throw new ValidationError('ISCN_NOT_FOUND');
  const { iscnIdPrefix } = iscnInfo;
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
  const {
    prices,
  } = bookInfo;
  const keywords = keywordString.split(',').map((k: string) => k.trim()).filter((k: string) => !!k);
  const image = metadata?.data?.metadata?.image;

  const payload: any = { iscnIdPrefix };
  if (inLanguage) payload.inLanguage = inLanguage;
  if (name) payload.name = name;
  if (description) payload.description = description;
  if (keywords) payload.keywords = keywords;
  if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
  if (author) payload.author = author;
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
        name: [name, getLocalizedTextWithFallback(p.name, 'zh')].filter(Boolean).join(' - '),
        description: [getLocalizedTextWithFallback(p.description, 'zh'), description].filter(Boolean).join('\n'),
        images: images.length ? images : undefined,
      });
    }
  }));
  try {
    await importGoogleRetailProductFromBookListing(
      filterNFTBookListingInfo({ id: classId, ...bookInfo, ...payload })
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

export async function updateNftBookInfo(classId: string, {
  prices,
  notificationEmails,
  moderatorWallets,
  connectedWallets,
  shippingRates,
  mustClaimToView,
  hideDownload,
  enableCustomMessagePage,
}: {
  prices?: any[];
  notificationEmails?: string[];
  moderatorWallets?: string[];
  connectedWallets?: string[];
  shippingRates?: any[];
  mustClaimToView?: boolean;
  hideDownload?: boolean;
  enableCustomMessagePage?: boolean;
} = {}, newAPIWalletOwnedNFTIds: string[] = []) {
  await syncNFTBookInfoWithISCN(classId);

  const timestamp = FieldValue.serverTimestamp();
  const payload: any = {
    lastUpdateTimestamp: timestamp,
  };
  if (prices !== undefined) { payload.prices = prices; }
  if (notificationEmails !== undefined) { payload.notificationEmails = notificationEmails; }
  if (moderatorWallets !== undefined) { payload.moderatorWallets = moderatorWallets; }
  if (connectedWallets !== undefined) { payload.connectedWallets = connectedWallets; }
  if (shippingRates !== undefined) {
    payload.shippingRates = shippingRates.map((s) => formatShippingRateInfo(s));
  }
  if (mustClaimToView !== undefined) { payload.mustClaimToView = mustClaimToView; }
  if (hideDownload !== undefined) { payload.hideDownload = hideDownload; }
  if (enableCustomMessagePage !== undefined) {
    payload.enableCustomMessagePage = enableCustomMessagePage;
  }
  const classIdRef = likeNFTBookCollection.doc(classId);
  let batch = db.batch();
  batch.update(classIdRef, payload);
  if (newAPIWalletOwnedNFTIds.length) {
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
}

export async function listLatestNFTBookInfo({
  ownerWallet,
  excludedOwnerWallet,
  before,
  limit,
  key,
}: {
  ownerWallet?: string;
  excludedOwnerWallet?: string;
  before?: number;
  limit?: number;
  key?: number;
} = {}) {
  let snapshot = likeNFTBookCollection.orderBy('timestamp', 'desc');
  if (ownerWallet) snapshot = snapshot.where('ownerWallet', '==', ownerWallet);
  if (excludedOwnerWallet) snapshot = snapshot.where('ownerWallet', '!=', excludedOwnerWallet);
  const tsNumber = before || key;
  if (tsNumber) {
    // HACK: bypass startAfter() type check
    const timestamp = Timestamp.fromMillis(tsNumber) as unknown as number;
    snapshot = snapshot.startAfter(timestamp);
  }
  snapshot = snapshot.limit(limit);
  const query = await snapshot.get();
  return query.docs.map((doc) => {
    const docData = doc.data();
    return { id: doc.id, ...docData };
  });
}

export async function listNftBookInfoByModeratorWallet(moderatorWallet: string) {
  const MAX_BOOK_ITEMS_LIMIT = 256;
  const query = LIKER_NFT_BOOK_GLOBAL_READONLY_MODERATOR_ADDRESSES.includes(moderatorWallet)
    ? await likeNFTBookCollection.limit(MAX_BOOK_ITEMS_LIMIT).get()
    : await likeNFTBookCollection.where('moderatorWallets', 'array-contains', moderatorWallet).limit(MAX_BOOK_ITEMS_LIMIT).get();
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
    hasShipping,
    isPhysicalOnly,
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
  if (!hasShipping && isPhysicalOnly) {
    throw new ValidationError('PHYSICAL_ONLY_BUT_NO_SHIPPING');
  }
  return {
    autoMemo,
    order,
    priceInDecimal,
    stock,
    name,
    description,
    isPhysicalOnly,
    isAutoDeliver,
    isUnlisted,
    hasShipping,
    isAllowCustomPrice,
  };
}

export function validatePrices(prices: any[], classId: string, wallet: string) {
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
  const [
    { nfts: userWalletOwnedNFTs },
    { nfts: apiWalletOwnedNFTs },
  ] = await Promise.all([
    getNFTsByClassId(classId, wallet),
    getNFTsByClassId(classId, LIKER_NFT_TARGET_ADDRESS),
  ]);
  if (userWalletOwnedNFTs.length < manualDeliverTotalStock) {
    throw new ValidationError(`NOT_ENOUGH_MANUAL_DELIVER_NFT_COUNT: ${classId}, EXPECTED: ${manualDeliverTotalStock}, ACTUAL: ${userWalletOwnedNFTs.length}`, 403);
  }
  if (apiWalletOwnedNFTs.length < autoDeliverTotalStock) {
    throw new ValidationError(`NOT_ENOUGH_AUTO_DELIVER_NFT_COUNT: ${classId}, EXPECTED: ${autoDeliverTotalStock}, ACTUAL: ${apiWalletOwnedNFTs.length}`, 403);
  }
  return {
    userWalletOwnedNFTs,
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
  return `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/status/${classId}`;
}

export function getNFTBookStoreCollectionPageURL(collectionId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/collection/status/${collectionId}`;
}

export function getNFTBookStoreSendPageURL(classId: string, paymentId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/send/${classId}/?payment_id=${paymentId}`;
}

export function getNFTBookStoreCollectionSendPageURL(collectionId: string, paymentId: string) {
  return `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/collection/send/${collectionId}/?payment_id=${paymentId}`;
}
