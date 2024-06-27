import crypto from 'crypto';
import uuidv4 from 'uuid/v4';

import { getNftBookInfo, NFT_BOOK_TEXT_DEFAULT_LOCALE } from '.';
import { NFT_BOOK_SALE_DESCRIPTION, MAXIMUM_CUSTOM_PRICE_IN_DECIMAL, NFT_BOOK_DEFAULT_FROM_CHANNEL } from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { getLikerLandCartURL, getLikerLandNFTClaimPageURL } from '../../../liker-land';
import { getBookCollectionInfoById } from '../collection/book';
import { parseImageURLFromMetadata } from '../metadata';
import {
  getCouponDiscountRate, formatStripeCheckoutSession, TransactionFeeInfo, createNewNFTBookPayment,
  ItemPriceInfo,
} from './purchase';
import { FieldValue, likeNFTBookCartCollection } from '../../../firebase';
import { createNewNFTBookCollectionPayment } from './collection/purchase';

export type CartItem = {
  collectionId?: string
  classId?: string
  priceIndex?: number
  coupon?: string
  customPriceInDecimal?: number
  quantity?: number
}

export type CartItemWithInfo = CartItem & {
  priceInDecimal: number;
  customPriceDiffInDecimal: number;
  stock: number;
  hasShipping: boolean;
  isPhysicalOnly: boolean;
  isAllowCustomPrice: boolean;
  name: string,
  description: string,
  images: string[],
  ownerWallet: string,
  shippingRates: any[],
  isLikerLandArt: boolean;
  coupons: any[],
  originalPriceInDecimal: number,
  collectionId?: string,
  classId?: string,
  priceIndex?: number,
  quantity: number,
}

export async function createNewNFTBookCartPayment(cartId: string, paymentId: string, {
  type,
  email = '',
  claimToken,
  sessionId = '',
  from = '',
  itemPrices,
  itemInfos,
  feeInfo,
}: {
  type: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  from?: string;
  itemPrices: ItemPriceInfo[];
  itemInfos: CartItemWithInfo[];
  feeInfo: TransactionFeeInfo,
}) {
  const classIdsWithPrice = itemPrices.filter((item) => !!item.classId).map((item) => ({
    classId: item.classId,
    priceIndex: item.priceIndex,
  }));
  const classIds = classIdsWithPrice.map((item) => item.classId);
  const collectionIds = itemPrices.filter((item) => !!item.collectionId)
    .map((item) => item.collectionId);
  const payload: any = {
    type,
    email,
    isPaid: false,
    isPendingClaim: false,
    claimToken,
    sessionId,
    from,
    status: 'new',
    itemPrices,
    classIds,
    classIdsWithPrice,
    collectionIds,
    timestamp: FieldValue.serverTimestamp(),
    feeInfo,
  };
  const {
    stripeFeeAmount: totalStripeFeeAmount,
    priceInDecimal: totalPriceInDecimal,
  } = feeInfo;
  await likeNFTBookCartCollection.doc(cartId).create(payload);
  itemPrices.map((item, index) => {
    const { coupon } = itemInfos[index];
    const {
      classId,
      collectionId,
      priceIndex,
      quantity,
      priceInDecimal,
      customPriceDiffInDecimal,
      originalPriceInDecimal,
      likerLandTipFeeAmount,
      likerLandFeeAmount,
      likerLandCommission,
      channelCommission,
      likerLandArtFee,
    } = item;
    const itemFeeInfo: TransactionFeeInfo = {
      stripeFeeAmount: (totalStripeFeeAmount * priceInDecimal) / totalPriceInDecimal,
      priceInDecimal,
      originalPriceInDecimal,
      customPriceDiff: customPriceDiffInDecimal,
      likerLandTipFeeAmount,
      likerLandFeeAmount,
      likerLandCommission,
      channelCommission,
      likerLandArtFee,
    };
    if (classId && priceIndex !== undefined) {
      return createNewNFTBookPayment(classId, paymentId, {
        type,
        email,
        claimToken,
        sessionId,
        priceInDecimal,
        originalPriceInDecimal,
        coupon,
        quantity,
        priceName: '',
        priceIndex,
        from,
        itemPrices: [item],
        feeInfo: itemFeeInfo,
      });
    } if (collectionId) {
      return createNewNFTBookCollectionPayment(collectionId, paymentId, {
        type,
        priceInDecimal,
        originalPriceInDecimal,
        coupon,
        quantity,
        claimToken,
        sessionId,
        from,
        itemPrices: [item],
        feeInfo: itemFeeInfo,
      });
    }
    throw new ValidationError('ITEM_ID_NOT_SET');
  });
}

export async function handleNewCartStripeCheckout(items: CartItem[], {
  gaClientId,
  gaSessionId,
  from: inputFrom,
  email,
  utm,
}: {
  gaClientId?: string,
  gaSessionId?: string,
  email?: string,
  from?: string,
  utm?: {
    campaign?: string,
    source?: string,
    medium?: string,
  },
} = {}) {
  const itemInfos: CartItemWithInfo[] = await Promise.all(items.map(async (item) => {
    const {
      classId,
      priceIndex,
      collectionId,
      coupon,
      customPriceInDecimal,
      quantity = 1,
    } = item;
    let info;
    if (classId && priceIndex !== undefined) {
      const [metadata, bookInfo] = await Promise.all([
        getNFTClassDataById(classId),
        getNftBookInfo(classId),
      ]);
      if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
      if (!metadata) throw new ValidationError('NFT_NOT_FOUND');
      const {
        prices,
        ownerWallet,
        shippingRates,
        isLikerLandArt,
        coupons,
      } = bookInfo;
      if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
      const {
        priceInDecimal: originalPriceInDecimal,
        stock,
        hasShipping,
        isPhysicalOnly,
        isAllowCustomPrice,
        name: priceNameObj,
        description: pricDescriptionObj,
      } = prices[priceIndex];
      let { name = '', description = '' } = metadata;
      const classMetadata = metadata.data.metadata;
      const iscnPrefix = metadata.data.parent.iscnIdPrefix || undefined;
      const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
      const priceDescription = typeof pricDescriptionObj === 'object' ? pricDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : pricDescriptionObj || '';
      if (priceName) {
        name = `${name} - ${priceName}`;
      }
      if (NFT_BOOK_SALE_DESCRIPTION[classId]) {
        description = NFT_BOOK_SALE_DESCRIPTION[classId];
      } else if (priceDescription) {
        description = `${description} - ${priceDescription}`;
      }
      const { image } = classMetadata;
      const images = [parseImageURLFromMetadata(image)];
      info = {
        stock,
        hasShipping,
        isPhysicalOnly,
        isAllowCustomPrice,
        name,
        description,
        images,
        ownerWallet,
        shippingRates,
        isLikerLandArt,
        coupons,
        originalPriceInDecimal,
        classId,
        iscnPrefix,
      };
    } else if (collectionId) {
      const collectionData = await getBookCollectionInfoById(collectionId);
      if (!collectionData) throw new ValidationError('NFT_NOT_FOUND');
      const { classIds } = collectionData;
      const { image } = collectionData;
      const {
        ownerWallet,
        shippingRates,
        isPhysicalOnly,
        isLikerLandArt,
        priceInDecimal: originalPriceInDecimal,
        coupons,
        isAllowCustomPrice,
        stock,
        hasShipping,
        name: collectionNameObj,
        description: collectionDescriptionObj,
      } = collectionData;

      if (hasShipping) throw new ValidationError('CART_ITEM_HAS_SHIPPING');

      const classDataList = await Promise.all(classIds.map((id) => getNFTClassDataById(id)));

      const images: string[] = [];
      if (image) images.push(parseImageURLFromMetadata(image));
      classDataList.forEach((data) => {
        if (data?.data?.metadata?.image) {
          images.push(parseImageURLFromMetadata(data.data.metadata.image));
        }
      });
      const name = typeof collectionNameObj === 'object' ? collectionNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionNameObj || '';
      const description = typeof collectionDescriptionObj === 'object' ? collectionDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionDescriptionObj || '';
      info = {
        stock,
        hasShipping,
        isPhysicalOnly,
        isAllowCustomPrice,
        name,
        description,
        images,
        ownerWallet,
        shippingRates,
        isLikerLandArt,
        coupons,
        originalPriceInDecimal,
        collectionId,
      };
    } else {
      throw new ValidationError('ITEM_ID_NOT_SET');
    }
    let {
      name,
      description,
    } = info;
    const {
      isAllowCustomPrice,
      originalPriceInDecimal,
      coupons,
      stock,
      hasShipping,
      isPhysicalOnly,
      images,
      ownerWallet,
      shippingRates,
      isLikerLandArt,
    } = info;

    name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
    description = description.length > 300
      ? `${description.substring(0, 299)}…`
      : description;
    if (!description) {
      description = undefined;
    } // stripe does not like empty string

    let priceInDecimal = originalPriceInDecimal;
    let discount = 1;
    if (coupon) {
      discount = getCouponDiscountRate(coupons, coupon as string);
    }
    priceInDecimal = Math.round(priceInDecimal * discount);

    let customPriceDiffInDecimal = 0;
    if (isAllowCustomPrice
        && customPriceInDecimal
        && customPriceInDecimal > priceInDecimal
        && customPriceInDecimal <= MAXIMUM_CUSTOM_PRICE_IN_DECIMAL) {
      customPriceDiffInDecimal = customPriceInDecimal - priceInDecimal;
      priceInDecimal = customPriceInDecimal;
    }
    if (priceInDecimal <= 0) throw new ValidationError('PRICE_INVALID');
    if (stock <= 0) throw new ValidationError('OUT_OF_STOCK');
    return {
      ...item,
      priceInDecimal,
      customPriceDiffInDecimal,
      stock,
      hasShipping,
      isPhysicalOnly,
      isAllowCustomPrice,
      name,
      description,
      images,
      ownerWallet,
      shippingRates,
      isLikerLandArt,
      coupons,
      originalPriceInDecimal,
      collectionId,
      classId,
      priceIndex,
      quantity,
    };
  }));

  const paymentId = uuidv4();
  const cartId = paymentId;
  const claimToken = crypto.randomBytes(32).toString('hex');
  const successUrl = getLikerLandNFTClaimPageURL({
    cartId,
    paymentId,
    token: claimToken,
    type: 'cart',
    redirect: true,
    utmCampaign: utm?.campaign,
    utmSource: utm?.source,
    utmMedium: utm?.medium,
    gaClientId,
    gaSessionId,
  });
  const cancelUrl = getLikerLandCartURL({
    utmCampaign: utm?.campaign,
    utmSource: utm?.source,
    utmMedium: utm?.medium,
    gaClientId,
    gaSessionId,
  });
  let from: string = inputFrom as string || '';
  if (!from || from === NFT_BOOK_DEFAULT_FROM_CHANNEL) {
    from = NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }

  const {
    session,
    itemPrices,
    feeInfo,
  } = await formatStripeCheckoutSession({
    cartId,
    paymentId,
    from,
    gaClientId,
    gaSessionId,
    email,
    utm,
  }, itemInfos.map((info) => {
    const {
      name,
      description,
      images,
      priceInDecimal,
      customPriceDiffInDecimal,
      isLikerLandArt,
      ownerWallet,
      quantity,
    } = info;
    return {
      name,
      description,
      images,
      priceInDecimal,
      customPriceDiffInDecimal,
      isLikerLandArt,
      quantity,
      ownerWallet,
    };
  }), {
    hasShipping: false,
    shippingRates: [],
    defaultPaymentCurrency: 'USD',
    successUrl,
    cancelUrl,
  });

  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookCartPayment(cartId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    from: from as string,
    itemInfos,
    itemPrices,
    feeInfo,
  });

  const {
    priceInDecimal,
    originalPriceInDecimal,
    customPriceDiff: customPriceDiffInDecimal,
  } = feeInfo;

  return {
    url,
    cartId,
    paymentId,
    sessionId,
    priceInDecimal,
    originalPriceInDecimal,
    customPriceDiffInDecimal,
  };
}
