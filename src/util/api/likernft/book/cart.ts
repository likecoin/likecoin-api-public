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
  convertUSDToCurrency,
  processNFTBookPurchaseTxGet,
  claimNFTBook,
} from './purchase';
import {
  db,
  FieldValue, likeNFTBookCartCollection,
} from '../../../firebase';
import {
  claimNFTBookCollection,
  createNewNFTBookCollectionPayment,
  processNFTBookCollectionPurchaseTxGet,
  processNFTBookCollectionPurchaseTxUpdate,
} from './collection/purchase';
import stripe from '../../../stripe';
import { createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../airtable';
import { sendNFTBookSalesSlackNotification } from '../../../slack';
import publisher from '../../../gcloudPub';
import { sendNFTBookCartPendingClaimEmail, sendNFTBookSalesEmail } from '../../../ses';

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
  priceName?: string,
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
    const {
      coupon,
      from: itemFrom,
      priceName = '',
    } = itemInfos[index];
    const {
      classId,
      collectionId,
      priceIndex,
      quantity = 1,
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
      stripeFeeAmount: (totalStripeFeeAmount * priceInDecimal * quantity) / totalPriceInDecimal,
      priceInDecimal: priceInDecimal * quantity,
      originalPriceInDecimal: originalPriceInDecimal * quantity,
      customPriceDiff: customPriceDiffInDecimal * quantity,
      likerLandTipFeeAmount: likerLandTipFeeAmount * quantity,
      likerLandFeeAmount: likerLandFeeAmount * quantity,
      likerLandCommission: likerLandCommission * quantity,
      channelCommission: channelCommission * quantity,
      likerLandArtFee: likerLandArtFee * quantity,
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
        priceName,
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
    if (status !== 'new') throw new ValidationError('PAYMENT_ALREADY_PROCESSED');

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
    const updatePayload = {
      status: 'paid',
      isPaid: true,
      isPendingClaim: true,
      email,
      hasShipping: false,
    };
    t.update(cartRef, updatePayload);

    return {
      txData: {
        ...cartData,
        ...updatePayload,
      },
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

    const stripeFeeDetails = balanceTx.fee_details.find((fee) => fee.type === 'stripe_fee');
    const stripeFeeCurrency = stripeFeeDetails?.currency || 'USD';
    const totalStripeFeeAmount = stripeFeeDetails?.amount || 0;

    const currency = capturedPaymentIntent.currency || 'USD';
    const exchangeRate = balanceTx?.exchange_rate
      || (currency.toLowerCase() === 'hkd' ? 1 / USD_TO_HKD_RATIO : 1);

    const chargeId = typeof capturedPaymentIntent.latest_charge === 'string' ? capturedPaymentIntent.latest_charge : capturedPaymentIntent.latest_charge?.id;

    const {
      classInfos,
      collectionInfos,
      txData: cartData,
    } = infos;
    const { claimToken } = cartData;

    const infoList = [...classInfos, ...collectionInfos];
    const bookNames: string[] = [];
    for (const info of infoList) {
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
      } = listingData;
      const {
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
        stripeFeeAmount: documentStripeFeeAmount,
        likerLandFeeAmount,
        likerLandTipFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
      } = feeInfo as TransactionFeeInfo;
      const stripeFeeAmount = ((totalStripeFeeAmount * priceInDecimal)
        / (amountTotal || priceInDecimal)) || documentStripeFeeAmount;
      const bookId = collectionId || classId;
      const bookData = await (collectionId
        ? getBookCollectionInfoById(collectionId) : getNftBookInfo(classId));
      const bookName = bookData?.name?.[NFT_BOOK_TEXT_DEFAULT_LOCALE] || bookData?.name || bookId;
      bookNames.push(bookName);
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

      const convertedCurrency = defaultPaymentCurrency === 'HKD' ? 'HKD' : 'USD';
      const convertedPriceInDecimal = convertUSDToCurrency(price, convertedCurrency);
      await Promise.all([
        await sendNFTBookSalesEmail({
          buyerEmail: email,
          emails: notificationEmails,
          bookName,
          isGift: false,
          giftToEmail: '',
          giftToName: '',
          amount: priceInDecimal / 100,
          phone,
          shippingDetails: '',
          shippingCost: 0,
          originalPrice: originalPriceInDecimal / 100,
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
          classId,
          collectionId,
          priceIndex,
          stripeFeeAmount,
          stripeFeeCurrency,
          from,
          quantity,
          feeInfo,
          transfers,
          shippingCountry: undefined,
          shippingCost: undefined,
        }),
      ]);
    }
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseCaptured',
      paymentId,
      cartId,
      sessionId: session.id,
      isGift: false,
    });
    await sendNFTBookCartPendingClaimEmail({
      email,
      cartId,
      bookNames,
      paymentId,
      claimToken,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    if (errorMessage !== 'PAYMENT_ALREADY_PROCESSED') {
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
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError('QUANTITY_INVALID');
    }
    if (customPriceInDecimal
      && (!Number.isInteger(customPriceInDecimal) || customPriceInDecimal < 0)) {
      throw new ValidationError('CUSTOM_PRICE_INVALID');
    }
    if (priceIndex && (!Number.isInteger(priceIndex) || priceIndex < 0)) {
      throw new ValidationError('PRICE_INDEX_INVALID');
    }
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
        priceName,
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
      priceName = '',
    } = info;

    if (hasShipping) throw new ValidationError('CART_ITEM_HAS_SHIPPING');

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
    if (stock < quantity) throw new ValidationError('OUT_OF_STOCK');
    return {
      ...item,
      priceName,
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
    type: 'nft_book',
    redirect: true,
    utmCampaign: utm?.campaign,
    utmSource: utm?.source,
    utmMedium: utm?.medium,
    gaClientId,
    gaSessionId,
  });
  const cancelUrl = getLikerLandCartURL({
    type: 'book',
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

export async function claimNFTBookCart(
  cartId: string,
  { message, wallet, token }: { message: string, wallet: string, token: string },
  req,
) {
  const cartRef = likeNFTBookCartCollection.doc(cartId);
  const cartDoc = await cartRef.get();
  const cartData = cartDoc.data();
  const {
    email,
    classIds,
    collectionIds,
    claimedClassIds = [],
    claimedCollectionIds = [],
    claimToken,
    status,
  } = cartData;

  if (status !== 'paid') {
    throw new ValidationError('CART_ALREADY_CLAIMED', 403);
  }
  if (token !== claimToken) {
    throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
  }
  const unclaimedClassIds = classIds.filter((id) => !claimedClassIds.includes(id));
  const unclaimedCollectionIds = collectionIds.filter((id) => !claimedCollectionIds.includes(id));
  const errors: any = [];
  const newClaimedNFTs: any = [];
  await Promise.all(unclaimedClassIds.map(async (classId) => {
    try {
      const { nftId } = await claimNFTBook(classId, cartId, { message, wallet, token }, req);
      newClaimedNFTs.push({ classId, nftId });
      await cartRef.update({ claimedClassIds: FieldValue.arrayUnion(classId) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      errors.push({ classId, error: (err as Error).toString() });
    }
  }));
  await Promise.all(unclaimedCollectionIds.map(async (collectionId) => {
    try {
      await claimNFTBookCollection(collectionId, cartId, { message, wallet, token });
      newClaimedNFTs.push({ collectionId });
      await cartRef.update({ claimedCollectionIds: FieldValue.arrayUnion(collectionId) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      errors.push({ collectionId, error: (err as Error).toString() });
    }
  }));

  if (!errors.length) {
    await cartRef.update({
      status: 'pending',
      isPendingClaim: false,
      errors: FieldValue.delete(),
    });
  } else {
    await cartRef.update({
      errors,
    });
  }

  return {
    email,
    classIds: claimedClassIds,
    collectionIds: claimedCollectionIds,
    newClaimedNFTs,
    errors,
  };
}
