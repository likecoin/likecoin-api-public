import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';

import { getNftBookInfo, NFT_BOOK_TEXT_DEFAULT_LOCALE } from '.';
import {
  NFT_BOOK_SALE_DESCRIPTION,
  MAXIMUM_CUSTOM_PRICE_IN_DECIMAL,
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  PUBSUB_TOPIC_MISC,
} from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import { getNFTClassDataById } from '../../../cosmos/nft';
import { getLikerLandCartURL, getLikerLandNFTClaimPageURL, getLikerLandNFTGiftPageURL } from '../../../liker-land';
import { getBookCollectionInfoById } from '../collection/book';
import { parseImageURLFromMetadata } from '../metadata';
import {
  formatStripeCheckoutSession,
  TransactionFeeInfo,
  createNewNFTBookPayment,
  ItemPriceInfo,
  processNFTBookPurchaseTxUpdate,
  handleStripeConnectedAccount,
  processNFTBookPurchaseTxGet,
  claimNFTBook,
  calculateFeeAndDiscountFromBalanceTx,
  DISCOUNTED_FEE_TYPES,
  calculateCommissionWithDiscount,
} from './purchase';
import {
  db,
  FieldValue, likeNFTBookCartCollection,
  likeNFTBookCollection,
  likeNFTCollectionCollection,
} from '../../../firebase';
import {
  claimNFTBookCollection,
  createNewNFTBookCollectionPayment,
  processNFTBookCollectionPurchaseTxGet,
  processNFTBookCollectionPurchaseTxUpdate,
} from './collection/purchase';
import stripe, { getStripePromotoionCodesFromCheckoutSession } from '../../../stripe';
import { createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../airtable';
import { sendNFTBookOutOfStockSlackNotification, sendNFTBookSalesSlackNotification } from '../../../slack';
import publisher from '../../../gcloudPub';
import {
  sendNFTBookCartGiftPendingClaimEmail,
  sendNFTBookCartPendingClaimEmail,
  sendNFTBookOutOfStockEmail,
  sendNFTBookSalesEmail,
} from '../../../ses';
import { getReaderSegmentNameFromAuthorWallet, upsertCrispProfile } from '../../../crisp';
import logPixelEvents from '../../../fbq';
import { getBookUserInfoFromWallet } from './user';
import {
  SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD,
} from '../../../../../config/config';

export type CartItem = {
  collectionId?: string
  classId?: string
  priceIndex?: number
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
  originalPriceInDecimal: number,
  collectionId?: string,
  classId?: string,
  priceIndex?: number,
  iscnPrefix?: string,
  priceName?: string,
  stripePriceId?: string,
  quantity: number,
}

export async function createNewNFTBookCartPayment(cartId: string, paymentId: string, {
  type,
  email = '',
  claimToken,
  sessionId = '',
  from = '',
  giftInfo,
  itemPrices,
  itemInfos,
  feeInfo,
  coupon,
}: {
  type: string;
  email?: string;
  claimToken: string;
  sessionId?: string;
  from?: string;
  giftInfo?: {
    toName: string,
    toEmail: string,
    fromName: string,
    message?: string,
  };
  itemPrices: ItemPriceInfo[];
  itemInfos: CartItemWithInfo[];
  feeInfo: TransactionFeeInfo,
  coupon?: string,
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
    coupon,
  };
  const isGift = !!giftInfo;
  if (isGift) {
    const {
      toEmail = '',
      toName = '',
      fromName = '',
      message = '',
    } = giftInfo;
    payload.isGift = true;
    payload.giftInfo = {
      toEmail,
      toName,
      fromName,
      message,
    };
  }
  await likeNFTBookCartCollection.doc(cartId).create(payload);
  await Promise.all(itemPrices.map((item, index) => {
    const {
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
      stripeFeeAmount: Math.ceil((totalStripeFeeAmount * priceInDecimal * quantity)
        / totalPriceInDecimal),
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
        giftInfo,
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
        giftInfo,
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
        ...data,
        listingData: { ...data.listingData, ...data.typePayload },
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

async function updateNFTBookCartPostCheckoutFeeInfo({
  cartId,
  paymentId,
  amountSubtotal,
  amountTotal,
  shippingCost,
  balanceTx,
  feeInfo,
  coupon: existingCoupon,
  sessionId,
}) {
  const {
    isStripeFeeUpdated,
    isAmountFeeUpdated,
    stripeFeeCurrency,
    newFeeInfo,
    shippingCostAmount,
    discountRate,
  } = calculateFeeAndDiscountFromBalanceTx({
    paymentId,
    amountSubtotal,
    amountTotal,
    shippingCost,
    balanceTx,
    feeInfo,
  });

  let coupon = existingCoupon;
  if (isAmountFeeUpdated) {
    [coupon = ''] = await getStripePromotoionCodesFromCheckoutSession(sessionId);
  }
  if (isStripeFeeUpdated || isAmountFeeUpdated) {
    const payload: any = {
      feeInfo: newFeeInfo,
      shippingCost: shippingCostAmount / 100,
    };
    if (coupon) payload.coupon = coupon;
    await likeNFTBookCartCollection.doc(cartId).update(payload);
  }
  return {
    ...newFeeInfo,
    coupon,
    stripeFeeCurrency,
    discountRate,
    isAmountFeeUpdated,
    isStripeFeeUpdated,
  };
}

export async function processNFTBookCartStripePurchase(
  session: Stripe.Checkout.Session,
  req: Express.Request,
) {
  const {
    metadata: {
      cartId,
      userAgent,
      clientIp,
      referrer,
      fbClickId,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    amount_total: amountTotal,
    amount_subtotal: amountSubtotal,
    shipping_cost: shippingCost,
    id: sessionId,
  } = session;
  const paymentId = cartId;
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');
  if (!paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  const { email, phone } = customer;
  let capturedPaymentIntent: Stripe.Response<Stripe.PaymentIntent> | null = null;
  try {
    const infos = await processNFTBookCartPurchase({
      cartId,
      email,
      phone,
      paymentId,
    });
    const {
      classInfos,
      collectionInfos,
      txData: cartData,
    } = infos;
    const {
      claimToken,
      feeInfo: totalFeeInfo,
      isGift: cartIsGift,
      giftInfo: cartGiftInfo,
      coupon: docCoupon,
    } = cartData;
    capturedPaymentIntent = await stripe.paymentIntents.capture(paymentIntent as string, {
      expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
    });
    const balanceTx = (capturedPaymentIntent.latest_charge as Stripe.Charge)
      ?.balance_transaction as Stripe.BalanceTransaction;

    const {
      stripeFeeAmount: totalStripeFeeAmount,
      stripeFeeCurrency,
      discountRate,
      isAmountFeeUpdated,
      isStripeFeeUpdated,
      coupon,
    } = await updateNFTBookCartPostCheckoutFeeInfo({
      cartId,
      paymentId,
      amountSubtotal,
      amountTotal,
      sessionId,
      balanceTx,
      feeInfo: totalFeeInfo,
      shippingCost,
      coupon: docCoupon,
    });
    const chargeId = typeof capturedPaymentIntent.latest_charge === 'string' ? capturedPaymentIntent.latest_charge : capturedPaymentIntent.latest_charge?.id;

    const infoList = [...classInfos, ...collectionInfos];
    const bookNames: string[] = [];
    for (let itemIndex = 0; itemIndex < infoList.length; itemIndex += 1) {
      const info = infoList[itemIndex];
      const {
        collectionId,
        classId,
        listingData,
        txData,
      } = info;
      const {
        notificationEmails = [],
        connectedWallets,
        ownerWallet,
        prices,
        typePayload,
      } = listingData;
      const {
        price,
        from,
        quantity,
        originalPriceInDecimal,
        priceIndex,
        priceName,
        isGift,
        giftInfo,
        feeInfo: docFeeInfo,
      } = txData;
      const stock = typePayload?.stock || prices?.[priceIndex]?.stock;
      const isOutOfStock = stock <= 0;
      const {
        priceInDecimal,
        stripeFeeAmount: documentStripeFeeAmount,
        likerLandFeeAmount,
        likerLandTipFeeAmount,
        likerLandCommission,
        channelCommission,
        likerLandArtFee,
      } = docFeeInfo as TransactionFeeInfo;
      // use pre-discounted price for fee ratio calculation
      const prediscountTotal = amountSubtotal || totalFeeInfo.priceInDecimal;
      const stripeFeeAmount = Math.ceil((totalStripeFeeAmount * priceInDecimal)
        / prediscountTotal) || documentStripeFeeAmount;
      const feeInfo: TransactionFeeInfo = {
        ...docFeeInfo,
      };
      if (isAmountFeeUpdated) {
        DISCOUNTED_FEE_TYPES.forEach((key) => {
          if (typeof feeInfo[key] === 'number') {
            feeInfo[key] = Math.round(feeInfo[key] * discountRate);
          }
        });
        if (channelCommission) {
          feeInfo.channelCommission = calculateCommissionWithDiscount({
            paymentId: `${paymentId}-${itemIndex}`,
            discountRate,
            originalPriceInDecimal,
            commission: channelCommission,
          });
        } else if (likerLandCommission) {
          feeInfo.likerLandCommission = calculateCommissionWithDiscount({
            paymentId: `${paymentId}-${itemIndex}`,
            discountRate,
            originalPriceInDecimal,
            commission: likerLandCommission,
          });
        } else {
          // eslint-disable-next-line no-console
          console.error(`No commission found but discounted in cart ${cartId} for item ${classId || collectionId}`);
        }
      }
      if (isStripeFeeUpdated || isAmountFeeUpdated) {
        const payload: any = { feeInfo };
        if (coupon) payload.coupon = coupon;
        if (collectionId) {
          await likeNFTCollectionCollection.doc(collectionId)
            .collection('transactions').doc(paymentId).update(payload);
        } else if (classId) {
          await likeNFTBookCollection.doc(classId)
            .collection('transactions').doc(paymentId).update(payload);
        }
      }

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
          buyerEmail: email,
          paymentIntentId: paymentIntent as string,
        },
        {
          amountTotal: priceInDecimal,
          chargeId,
          stripeFeeAmount,
          likerLandFeeAmount,
          likerLandTipFeeAmount,
          likerLandCommission,
          channelCommission,
          likerLandArtFee,
        },
        { connectedWallets, from },
      );

      const notifications: Promise<any>[] = [
        sendNFTBookSalesEmail({
          buyerEmail: email,
          isGift,
          giftToEmail: (giftInfo as any)?.toEmail,
          giftToName: (giftInfo as any)?.toName,
          emails: notificationEmails,
          bookName,
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
          priceWithCurrency: `${price} USD`,
          method: 'Fiat',
          from,
        }),
        createAirtableBookSalesRecordFromStripePaymentIntent({
          pi: capturedPaymentIntent,
          paymentId,
          classId,
          collectionId,
          priceIndex,
          itemIndex,
          stripeFeeAmount,
          stripeFeeCurrency,
          from,
          quantity,
          feeInfo,
          transfers,
          shippingCountry: undefined,
          shippingCost: undefined,
          coupon,
        }),
      ];
      if (stock <= SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD) {
        notifications.push(sendNFTBookOutOfStockSlackNotification({
          classId,
          className: bookName,
          priceName,
          priceIndex,
          notificationEmails,
          wallet: ownerWallet,
          stock,
        }));
      }
      if (isOutOfStock) {
        notifications.push(sendNFTBookOutOfStockEmail({
          emails: notificationEmails,
          classId,
          collectionId,
          bookName,
          priceName,
        // eslint-disable-next-line no-console
        }).catch((err) => console.error(err)));
      }
      await Promise.all(notifications);
    }

    if (email) {
      const segments = ['purchaser'];
      if (totalFeeInfo.customPriceDiff) segments.push('tipper');
      infoList.forEach((info) => {
        const { ownerWallet } = info.listingData;
        const readerSegment = getReaderSegmentNameFromAuthorWallet(ownerWallet);
        if (readerSegment) segments.push(readerSegment);
      });
      try {
        await upsertCrispProfile(email, { segments });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
      }
    }

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseCaptured',
      paymentId,
      cartId,
      sessionId: session.id,
      isGift: cartIsGift,
    });
    if (cartIsGift && cartGiftInfo) {
      const {
        fromName,
        toName,
        toEmail,
        message,
      } = cartGiftInfo;
      await sendNFTBookCartGiftPendingClaimEmail({
        fromName,
        toName,
        toEmail,
        message,
        cartId,
        bookNames,
        paymentId,
        claimToken,
      });
    } else {
      await sendNFTBookCartPendingClaimEmail({
        email,
        cartId,
        bookNames,
        paymentId,
        claimToken,
      });
    }
    await logPixelEvents('Purchase', {
      email: email || undefined,
      items: infoList.map((item) => ({
        productId: item.classId || item.collectionId,
        priceIndex: item.priceIndex,
        quantity: item.txData.quantity,
      })),
      userAgent,
      clientIp,
      value: (amountTotal || 0) / 100,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    const errorMessage = (err as Error).message;
    const errorStack = (err as Error).stack;
    if (!capturedPaymentIntent && errorMessage !== 'PAYMENT_ALREADY_PROCESSED') {
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
  gadClickId,
  gadSource,
  fbClickId,
  likeWallet,
  email,
  from: inputFrom,
  coupon,
  giftInfo,
  utm,
  referrer,
  userAgent,
  clientIp,
}: {
  gaClientId?: string,
  gaSessionId?: string,
  gadClickId?: string,
  gadSource?: string,
  fbClickId?: string,
  email?: string,
  likeWallet?: string,
  from?: string,
  coupon?: string,
  giftInfo?: {
    toEmail: string,
    toName: string,
    fromName: string,
    message?: string,
  },
  utm?: {
    campaign?: string,
    source?: string,
    medium?: string,
  },
  referrer?: string,
  userAgent?: string,
  clientIp?: string,
} = {}) {
  const itemInfos: CartItemWithInfo[] = await Promise.all(items.map(async (item) => {
    const {
      classId,
      priceIndex: inputPriceIndex,
      collectionId,
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
    const priceIndex = inputPriceIndex || 0;
    if (priceIndex !== undefined
        && (!Number.isInteger(priceIndex) || priceIndex < 0)) {
      throw new ValidationError('PRICE_INDEX_INVALID');
    }
    if (classId) {
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
        stripePriceId,
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
        originalPriceInDecimal,
        classId,
        iscnPrefix,
        priceName,
        stripePriceId,
      };
    } else if (collectionId) {
      const collectionData = await getBookCollectionInfoById(collectionId);
      if (!collectionData) throw new ValidationError('NFT_NOT_FOUND');
      const {
        classIds,
        image,
        ownerWallet,
        shippingRates,
        isPhysicalOnly,
        isLikerLandArt,
        priceInDecimal: originalPriceInDecimal,
        isAllowCustomPrice,
        stock,
        hasShipping,
        name: collectionNameObj,
        description: collectionDescriptionObj,
        stripePriceId,
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
        originalPriceInDecimal,
        collectionId,
        stripePriceId,
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
      stock,
      hasShipping,
      isPhysicalOnly,
      images,
      ownerWallet,
      shippingRates,
      isLikerLandArt,
      priceName = '',
      stripePriceId,
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
      originalPriceInDecimal,
      collectionId,
      classId,
      priceIndex,
      quantity,
      stripePriceId,
    };
  }));

  let customerEmail = email;
  let customerId;
  if (likeWallet) {
    const res = await getBookUserInfoFromWallet(likeWallet);
    const { bookUserInfo, likerUserInfo } = res || {};
    const { email: userEmail, isEmailVerified } = likerUserInfo || {};
    customerId = bookUserInfo?.stripeCustomerId;
    customerEmail = isEmailVerified ? userEmail : email;
  }
  const paymentId = uuidv4();
  const cartId = paymentId;
  const claimToken = crypto.randomBytes(32).toString('hex');
  const successUrl = giftInfo ? getLikerLandNFTGiftPageURL({
    cartId,
    paymentId,
    type: 'nft_book',
    redirect: true,
    utmCampaign: utm?.campaign,
    utmSource: utm?.source,
    utmMedium: utm?.medium,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
  }) : getLikerLandNFTClaimPageURL({
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
    gadClickId,
    gadSource,
  });
  const cancelUrl = getLikerLandCartURL({
    type: 'book',
    utmCampaign: utm?.campaign,
    utmSource: utm?.source,
    utmMedium: utm?.medium,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
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
    coupon,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    likeWallet,
    customerId,
    email: customerEmail,
    giftInfo,
    utm,
    referrer,
    userAgent,
    clientIp,
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
      stripePriceId,
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
      stripePriceId,
      from: itemFrom,
    };
  }), {
    hasShipping: false,
    shippingRates: [],
    successUrl,
    cancelUrl,
  });

  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  await createNewNFTBookCartPayment(cartId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    giftInfo,
    from,
    itemInfos,
    itemPrices,
    feeInfo,
    coupon,
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
  {
    message,
    wallet,
    token,
    loginMethod,
  }: {
    message: string,
    wallet: string,
    token: string,
    loginMethod?: string,
  },
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
      const { nftId } = await claimNFTBook(
        classId,
        cartId,
        {
          message, wallet, token, loginMethod,
        },
        req,
      );
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
      const { nftIds } = await claimNFTBookCollection(
        collectionId,
        cartId,
        {
          message, wallet, token, loginMethod,
        },
        req,
      );
      newClaimedNFTs.push({ collectionId, nftIds });
      await cartRef.update({ claimedCollectionIds: FieldValue.arrayUnion(collectionId) });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      errors.push({ collectionId, error: (err as Error).toString() });
    }
  }));

  const allItemsAutoClaimed = newClaimedNFTs.filter(
    (nft) => !!(nft.nftIds?.length || nft.nftId),
  ).length === (unclaimedClassIds.length + unclaimedCollectionIds.length);
  if (!errors.length) {
    await cartRef.update({
      status: allItemsAutoClaimed ? 'completed' : 'pending',
      isPendingClaim: false,
      errors: FieldValue.delete(),
      loginMethod: loginMethod || '',
    });
  } else {
    await cartRef.update({
      errors,
      loginMethod: loginMethod || '',
    });
  }

  return {
    email,
    classIds: claimedClassIds,
    collectionIds: claimedCollectionIds,
    newClaimedNFTs,
    allItemsAutoClaimed,
    errors,
  };
}
