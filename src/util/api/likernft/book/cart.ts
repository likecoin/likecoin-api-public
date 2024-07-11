import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';

import { getNftBookInfo, NFT_BOOK_TEXT_DEFAULT_LOCALE } from '.';
import {
  NFT_BOOK_SALE_DESCRIPTION,
  MAXIMUM_CUSTOM_PRICE_IN_DECIMAL,
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  USD_TO_HKD_RATIO,
  PUBSUB_TOPIC_MISC,
} from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { getLikerLandCartURL, getLikerLandNFTClaimPageURL } from '../../../liker-land';
import { getBookCollectionInfoById } from '../collection/book';
import { parseImageURLFromMetadata } from '../metadata';
import {
  getCouponDiscountRate,
  formatStripeCheckoutSession,
  TransactionFeeInfo,
  createNewNFTBookPayment,
  ItemPriceInfo,
  processNFTBookPurchaseTxUpdate,
  handleStripeConnectedAccount,
  sendNFTBookPurchaseEmail,
  convertUSDToCurrency,
  processNFTBookPurchaseTxGet,
} from './purchase';
import {
  db,
  FieldValue, likeNFTBookCartCollection,
} from '../../../firebase';
import {
  createNewNFTBookCollectionPayment,
  processNFTBookCollectionPurchaseTxGet,
  processNFTBookCollectionPurchaseTxUpdate,
  sendNFTBookCollectionPurchaseEmail,
} from './collection/purchase';
import stripe from '../../../stripe';
import { createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../airtable';
import { sendNFTBookSalesSlackNotification } from '../../../slack';
import publisher from '../../../gcloudPub';

export type CartItem = {
  collectionId?: string
  classId?: string
  priceIndex?: number
  coupon?: string
  customPriceInDecimal?: number
  quantity?: number
  from?: string
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
  iscnPrefix?: string,
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
    quantity: item.quantity,
    price: item.priceInDecimal / 100,
    priceInDecimal: item.priceInDecimal,
    originalPriceInDecimal: item.originalPriceInDecimal,
  }));
  const collectionIdsWithPrice = itemPrices.filter((item) => !!item.collectionId).map((item) => ({
    collectionId: item.collectionId,
    quantity: item.quantity,
    price: item.priceInDecimal / 100,
    priceInDecimal: item.priceInDecimal,
    originalPriceInDecimal: item.originalPriceInDecimal,
  }));
  const classIds = classIdsWithPrice.map((item) => item.classId);
  const collectionIds = collectionIdsWithPrice.map((item) => item.collectionId);
  const {
    stripeFeeAmount: totalStripeFeeAmount = 0,
    priceInDecimal: totalPriceInDecimal = 0,
    originalPriceInDecimal: totalOriginalPriceInDecimal = 0,
  } = feeInfo;
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
    collectionIdsWithPrice,
    timestamp: FieldValue.serverTimestamp(),
    price: totalPriceInDecimal / 100,
    priceInDecimal: totalPriceInDecimal,
    originalPriceInDecimal: totalOriginalPriceInDecimal,
    feeInfo,
  };
  await likeNFTBookCartCollection.doc(cartId).create(payload);
  await Promise.all(itemPrices.map((item, index) => {
    const { coupon, from: itemFrom } = itemInfos[index];
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
        from: itemFrom || from,
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
        from: itemFrom || from,
        itemPrices: [item],
        feeInfo: itemFeeInfo,
      });
    }
    throw new ValidationError('ITEM_ID_NOT_SET');
  }));
}

export async function processNFTBookCartPurchase({
  cartId,
  email,
  phone,
  paymentId,
}) {
  const cartRef = likeNFTBookCartCollection.doc(cartId);
  const infos = await db.runTransaction(async (t) => {
    const cartDoc = await t.get(cartRef);
    const cartData = cartDoc.data();
    if (!cartData) throw new ValidationError('CART_ID_NOT_FOUND');
    const {
      status,
      classIds,
      collectionIds,
    } = cartData;
    if (status !== 'new') throw new ValidationError('CART_STATUS_INVALID');

    const classInfos = await Promise.all(classIds.map(async (classId) => {
      const { listingData, txData } = await processNFTBookPurchaseTxGet(
        t,
        classId,
        paymentId,
        {
          email,
          phone,
          hasShipping: false,
          shippingDetails: null,
          shippingCost: null,
          execGrantTxHash: '',
        },
      );
      return {
        classId,
        listingData,
        txData,
      };
    }));
    const collectionInfos = await Promise.all(collectionIds.map(async (collectionId) => {
      const data = await processNFTBookCollectionPurchaseTxGet(
        t,
        collectionId,
        paymentId,
        {
          email,
          phone,
          hasShipping: false,
          shippingDetails: null,
          shippingCost: null,
          execGrantTxHash: '',
        },
      );
      return {
        collectionId,
        listingData: { ...data.listingData, ...data.typePayload },
        txData: data.txData,
      };
    }));

    await Promise.all(classInfos.map(async (info, index) => {
      await processNFTBookPurchaseTxUpdate(t, classIds[index], paymentId, info);
    }));

    await Promise.all(collectionInfos.map(async (info, index) => {
      await processNFTBookCollectionPurchaseTxUpdate(t, collectionIds[index], paymentId, info);
    }));
    t.update(cartRef, {
      status: 'paid',
      isPaid: true,
      isPendingClaim: true,
      email,
      hasShipping: false,
    });
    return {
      classInfos,
      collectionInfos,
    };
  });
  return infos;
}

export async function processNFTBookCartStripePurchase(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  const {
    metadata: {
      cartId,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    amount_total: amountTotal,
  } = session;
  const paymentId = cartId;
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  const { email, phone } = customer;
  try {
    const infos = await processNFTBookCartPurchase({
      cartId,
      email,
      phone,
      paymentId,
    });
    const capturedPaymentIntent = await stripe.paymentIntents.capture(paymentIntent as string, {
      expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
    });
    const balanceTx = (capturedPaymentIntent.latest_charge as Stripe.Charge)
      ?.balance_transaction as Stripe.BalanceTransaction;
    const currency = capturedPaymentIntent.currency || 'USD';
    const exchangeRate = balanceTx?.exchange_rate
      || (currency.toLowerCase() === 'hkd' ? 1 / USD_TO_HKD_RATIO : 1);

    const chargeId = typeof capturedPaymentIntent.latest_charge === 'string' ? capturedPaymentIntent.latest_charge : capturedPaymentIntent.latest_charge?.id;

    const {
      classInfos,
      collectionInfos,
    } = infos;
    for (const info of [...classInfos, ...collectionInfos]) {
      const {
        collectionId,
        classId,
        listingData,
        txData,
      } = info;
      const {
        notificationEmails = [],
        defaultPaymentCurrency = 'USD',
        connectedWallets,
        ownerWallet,
        mustClaimToView = false,
      } = listingData;
      const {
        claimToken,
        price,
        from,
        quantity,
        originalPriceInDecimal,
        priceIndex,
        priceName,
        feeInfo,
      } = txData;
      const {
        priceInDecimal,
        stripeFeeAmount,
        likerLandFeeAmount,
        likerLandTipFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
      } = feeInfo as TransactionFeeInfo;
      const bookId = collectionId || classId;
      const bookData = await (collectionId
        ? getBookCollectionInfoById(collectionId) : getNftBookInfo(classId));
      const bookName = bookData?.name?.[NFT_BOOK_TEXT_DEFAULT_LOCALE] || bookData?.name || bookId;
      const { transfers } = await handleStripeConnectedAccount(
        {
          classId,
          priceIndex,
          collectionId,
          paymentId,
          ownerWallet,
          bookName,
        },
        {
          amountTotal: priceInDecimal,
          chargeId,
          exchangeRate,
          currency,
          stripeFeeAmount,
          likerLandFeeAmount,
          likerLandTipFeeAmount,
          likerLandCommission,
          channelCommission,
          likerLandArtFee,
        },
        { connectedWallets, from },
      );

      const shippingCostAmount = 0;
      const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
      const convertedPriceInDecimal = convertUSDToCurrency(price, convertedCurrency);
      await Promise.all([
        collectionId ? sendNFTBookCollectionPurchaseEmail({
          email,
          notificationEmails,
          isGift: false,
          giftInfo: null,
          collectionId,
          collectionName: bookName,
          paymentId,
          claimToken,
          amountTotal: (amountTotal || 0) / 100,
          isPhysicalOnly: false,
          phone: phone || '',
          shippingDetails: null,
          shippingCost: shippingCostAmount,
          originalPrice: originalPriceInDecimal / 100,
        }) : sendNFTBookPurchaseEmail({
          email,
          phone: phone || '',
          shippingDetails: null,
          shippingCost: 0,
          originalPrice: originalPriceInDecimal / 100,
          isGift: false,
          giftInfo: null,
          notificationEmails,
          classId,
          bookName,
          priceName,
          paymentId,
          claimToken,
          amountTotal: (amountTotal || 0) / 100,
          mustClaimToView,
          isPhysicalOnly: false,
        }),
        sendNFTBookSalesSlackNotification({
          classId,
          bookName,
          paymentId,
          email,
          priceName,
          priceWithCurrency: `${convertedPriceInDecimal} ${convertedCurrency}`,
          method: 'Fiat',
          from,
        }),
        createAirtableBookSalesRecordFromStripePaymentIntent({
          pi: capturedPaymentIntent,
          quantity,
          feeInfo,
          transfers,
          shippingCountry: undefined,
          shippingCost: undefined,
        }),
      ]);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookNFTPurchaseCaptured',
        paymentId,
        cartId,
        fromChannel: from,
        sessionId: session.id,
        isGift: false,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseError',
      type: 'stripe',
      paymentId,
      cartId,
      error: (err as Error).toString(),
      errorMessage,
      errorStack,
    });
    await likeNFTBookCartCollection.doc(cartId).update({
      status: 'canceled',
      email,
    });
    await stripe.paymentIntents.cancel(paymentIntent as string)
      .catch((error) => console.error(error)); // eslint-disable-line no-console
  }
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
      from: itemFrom,
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
      if (itemFrom) description = `[${itemFrom}] ${description}`;
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
      let description = typeof collectionDescriptionObj === 'object' ? collectionDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : collectionDescriptionObj || '';
      if (itemFrom) description = `[${itemFrom}] ${description}`;
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
      classId,
      collectionId,
      priceIndex,
      iscnPrefix,
      from: itemFrom,
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
      classId,
      collectionId,
      priceIndex,
      iscnPrefix,
      from: itemFrom,
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
    from,
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
