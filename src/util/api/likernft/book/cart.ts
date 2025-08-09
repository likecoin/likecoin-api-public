import crypto from 'crypto';
import uuidv4 from 'uuid/v4';
import Stripe from 'stripe';

import { getNFTClassDataById, getNftBookInfo } from '.';
import {
  MAXIMUM_CUSTOM_PRICE_IN_DECIMAL,
  NFT_BOOK_DEFAULT_FROM_CHANNEL,
  STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
  PUBSUB_TOPIC_MISC,
  NFT_BOOK_TEXT_DEFAULT_LOCALE,
} from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import { getLikerLandCartURL, getLikerLandNFTClaimPageURL, getLikerLandNFTGiftPageURL } from '../../../liker-land';
import { getBookCollectionInfoById } from '../collection/book';
import { parseImageURLFromMetadata } from '../metadata';
import {
  formatStripeCheckoutSession,
  createNewNFTBookPayment,
  processNFTBookPurchaseTxUpdate,
  handleStripeConnectedAccount,
  processNFTBookPurchaseTxGet,
  claimNFTBook,
  calculateItemPrices,
} from './purchase';
import {
  db,
  FieldValue,
  likeNFTBookCartCollection,
} from '../../../firebase';
import {
  claimNFTBookCollection,
  createNewNFTBookCollectionPayment,
  processNFTBookCollectionPurchaseTxGet,
  processNFTBookCollectionPurchaseTxUpdate,
} from './collection/purchase';
import stripe, { getStripeFeeFromCheckoutSession, getStripePromotoionCodesFromCheckoutSession } from '../../../stripe';
import { createAirtableBookSalesRecordFromFreePurchase, createAirtableBookSalesRecordFromStripePaymentIntent } from '../../../airtable';
import { sendNFTBookOutOfStockSlackNotification, sendNFTBookSalesSlackNotification } from '../../../slack';
import publisher from '../../../gcloudPub';
import {
  sendNFTBookCartGiftPendingClaimEmail,
  sendNFTBookCartPendingClaimEmail,
  sendNFTBookOutOfStockEmail,
  sendNFTBookSalesEmail,
} from '../../../ses';
import logPixelEvents from '../../../fbq';
import { getBookUserInfoFromWallet } from './user';
import {
  SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD,
  LIKER_PLUS_20_COUPON_ID,
} from '../../../../../config/config';
import {
  CartItem, CartItemWithInfo, ItemPriceInfo, TransactionFeeInfo,
} from './type';
import { isEVMClassId } from '../../../evm/nft';
import { isLikeNFTClassId } from '../../../cosmos/nft';

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
  };
  if (coupon) payload.coupon = coupon;
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
        / totalPriceInDecimal) || 0,
      priceInDecimal: priceInDecimal * quantity,
      originalPriceInDecimal: originalPriceInDecimal * quantity,
      customPriceDiffInDecimal: customPriceDiffInDecimal * quantity,
      likerLandTipFeeAmount: likerLandTipFeeAmount * quantity,
      likerLandFeeAmount: likerLandFeeAmount * quantity,
      likerLandCommission: likerLandCommission * quantity,
      channelCommission: channelCommission * quantity,
      likerLandArtFee: likerLandArtFee * quantity,
    };
    if (classId && priceIndex !== undefined) {
      return createNewNFTBookPayment(classId, paymentId, {
        type,
        cartId,
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
        cartId,
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

  const cartData = await db.runTransaction(async (t) => {
    const cartDoc = await t.get(cartRef);
    if (!cartDoc.exists) throw new ValidationError('CART_ID_NOT_FOUND');
    const docData = cartDoc.data();
    if (!docData) throw new ValidationError('CART_ID_NOT_FOUND');
    const {
      claimToken,
      status,
      wallet: claimedWallet,
    } = docData;

    if (claimedWallet && claimedWallet !== wallet) {
      throw new ValidationError('CART_ALREADY_CLAIMED_BY_OTHER', 403);
    }

    if (status !== 'paid') {
      if (claimedWallet) {
        throw new ValidationError('CART_ALREADY_CLAIMED_BY_WALLET', 409);
      }
      throw new ValidationError('CART_ALREADY_CLAIMED', 403);
    }

    if (token !== claimToken) {
      throw new ValidationError('INVALID_CLAIM_TOKEN', 403);
    }

    t.update(cartRef, {
      status: 'pending',
    });
    return docData;
  });

  const {
    status: oldStatus,
    email,
    classIds,
    collectionIds,
    claimedClassIds = [],
    claimedCollectionIds = [],
  } = cartData;

  const unclaimedClassIds: string[] = classIds.filter((id) => !claimedClassIds.includes(id));
  const unclaimedCollectionIds: string[] = collectionIds
    .filter((id) => !claimedCollectionIds.includes(id));
  const errors: any = [];
  const newClaimedNFTs: any = [];
  for (const classId of unclaimedClassIds) {
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
  }
  for (const collectionId of unclaimedCollectionIds) {
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
  }

  const allItemsAutoClaimed = newClaimedNFTs.filter(
    (nft) => !!(nft.nftIds?.length || nft.nftId !== undefined),
  ).length === (unclaimedClassIds.length + unclaimedCollectionIds.length);
  if (!errors.length) {
    await cartRef.update({
      status: allItemsAutoClaimed ? 'completed' : 'pending',
      wallet,
      isPendingClaim: false,
      errors: FieldValue.delete(),
      loginMethod: loginMethod || '',
    });
  } else {
    await cartRef.update({
      status: oldStatus,
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

export async function processNFTBookCartPurchase({
  cartId,
  email,
  phone,
  paymentId,
  shippingDetails,
  shippingCostAmount,
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
          shippingDetails,
          shippingCostAmount,
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
          shippingDetails,
          shippingCostAmount,
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
      hasShipping: classInfos.some((info) => info.txData.hasShipping)
        || collectionInfos.some((info) => info.txData.hasShipping),
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
    amount_total: amountTotal,
    metadata: {
      cartId = uuidv4(),
      userAgent,
      clientIp,
      referrer,
      fbClickId,
      utmSource,
      utmCampaign,
      utmMedium,
      gaClientId,
      gaSessionId,
      claimToken = uuidv4(),
      from,
      giftToEmail,
      giftToName,
      giftMessage,
      giftFromName,
      site,
      evmWallet,
    } = {} as any,
    customer_details: customer,
    payment_intent: paymentIntent,
    currency_conversion: currencyConversion,
    shipping_cost: shippingCost,
    shipping_details: shippingDetails,
    id: sessionId,
  } = session;
  const paymentId = cartId;
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');

  const isFree = amountTotal === 0;
  if (!isFree && !paymentIntent) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');

  const { email, phone } = customer;

  let shippingCostAmount = 0;
  if (shippingCost) {
    shippingCostAmount = shippingCost.amount_total / 100;
  }
  if (currencyConversion) {
    if (currencyConversion.fx_rate !== undefined && shippingCost?.amount_total) {
      shippingCostAmount = Math.round(
        shippingCost.amount_total / Number(currencyConversion.fx_rate),
      ) / 100;
    }
  }

  const {
    itemInfos,
    itemPrices,
    feeInfo: totalFeeInfo,
    coupon,
  // eslint-disable-next-line no-use-before-define
  } = await formatCartItemInfosFromSession(session);

  if (!itemInfos?.length) return;

  await createNewNFTBookCartPayment(cartId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    giftInfo: giftToEmail ? {
      toEmail: giftToEmail,
      toName: giftToName,
      message: giftMessage,
      fromName: giftFromName,
    } : undefined,
    from,
    itemInfos,
    itemPrices,
    feeInfo: totalFeeInfo,
    coupon,
  });

  try {
    const infos = await processNFTBookCartPurchase({
      cartId,
      email,
      phone,
      paymentId,
      shippingDetails,
      shippingCostAmount,
    });
    const {
      classInfos,
      collectionInfos,
      txData: cartData,
    } = infos;
    const {
      isGift: cartIsGift,
      giftInfo: cartGiftInfo,
    } = cartData;
    let expandedPaymentIntent: Stripe.PaymentIntent | null = null;
    if (paymentIntent) {
      expandedPaymentIntent = await stripe.paymentIntents.retrieve(paymentIntent as string, {
        expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
      });
    }

    let chargeId: string | undefined;
    if (expandedPaymentIntent) {
      chargeId = typeof expandedPaymentIntent.latest_charge === 'string' ? expandedPaymentIntent.latest_charge : expandedPaymentIntent.latest_charge?.id;
    }

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
        quantity,
        originalPriceInDecimal,
        priceIndex,
        priceName,
        isGift,
        giftInfo,
        feeInfo,
        hasShipping,
        from: itemFrom,
      } = txData;
      const stock = typePayload?.stock || prices?.[priceIndex]?.stock;
      const isOutOfStock = stock <= 0;
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
      bookNames.push(bookName);
      const shippingCostAmountInDecimal = hasShipping ? shippingCostAmount * 100 : 0;
      const amountWithShipping = priceInDecimal + shippingCostAmountInDecimal;
      const { transfers } = await handleStripeConnectedAccount(
        {
          classId,
          priceIndex,
          collectionId,
          paymentId,
          ownerWallet,
          bookName,
          buyerEmail: email,
          shippingCostAmountInDecimal,
          paymentIntentId: paymentIntent as string,
          site,
        },
        {
          amountTotal: amountWithShipping,
          chargeId,
          stripeFeeAmount,
          likerLandFeeAmount,
          likerLandTipFeeAmount,
          likerLandCommission,
          channelCommission,
          likerLandArtFee,
        },
        { connectedWallets, from: itemFrom },
      );

      const notifications: Promise<any>[] = [
        sendNFTBookSalesEmail({
          buyerEmail: email,
          isGift,
          giftToEmail: (giftInfo as any)?.toEmail,
          giftToName: (giftInfo as any)?.toName,
          emails: notificationEmails,
          bookName,
          amount: amountWithShipping / 100,
          quantity,
          phone,
          shippingDetails: hasShipping ? shippingDetails : null,
          shippingCostAmount: hasShipping ? shippingCostAmount : 0,
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
        expandedPaymentIntent
          ? createAirtableBookSalesRecordFromStripePaymentIntent({
            pi: expandedPaymentIntent,
            paymentId,
            classId,
            collectionId,
            priceIndex,
            itemIndex,
            stripeFeeAmount,
            stripeFeeCurrency: 'USD',
            shippingCostAmount: hasShipping ? shippingCostAmount : 0,
            shippingCountry: hasShipping ? shippingDetails?.address?.country : null,
            from,
            quantity,
            feeInfo,
            transfers,
            coupon,
            cartId,
            isGift,
          }) : createAirtableBookSalesRecordFromFreePurchase({
            classId,
            collectionId,
            priceIndex,
            paymentId,
            itemIndex,
            quantity,
            from,
            email: email || undefined,
            utmSource,
            utmCampaign,
            utmMedium,
            referrer,
            gaClientId,
            gaSessionId,
            coupon,
            rawData: JSON.stringify(session),
          }),
        publisher.publish(PUBSUB_TOPIC_MISC, req, {
          logType: 'BookNFTPurchaseComplete',
          type: 'stripe',
          paymentId,
          classId,
          priceName,
          priceIndex,
          price,
          customPriceDiff: feeInfo.customPriceDiff,
          quantity,
          email,
          fromChannel: from,
          sessionId: session.id,
          stripeFeeAmount,
          coupon,
          isGift,
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

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'BookNFTPurchaseCaptured',
      paymentId,
      email,
      cartId,
      price: (amountTotal || 0) / 100,
      customPriceDiff: totalFeeInfo.customPriceDiffInDecimal / 100,
      sessionId: session.id,
      numberOfItems: infoList.length,
      quantity: infoList.reduce((acc, item) => acc + item.txData.quantity, 0),
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
        site,
      });
    } else {
      await sendNFTBookCartPendingClaimEmail({
        email,
        cartId,
        bookNames,
        paymentId,
        claimToken,
        site,
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

    // Attempt to claim the cart immediately if the user is logged in
    if (evmWallet) {
      const {
        allItemsAutoClaimed,
      } = await claimNFTBookCart(
        cartId,
        {
          message: '',
          wallet: evmWallet,
          token: claimToken,
          loginMethod: 'autoClaim',
        },
        req,
      );

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'BookCartClaimed',
        cartId,
        wallet: evmWallet,
        email,
        loginMethod: 'autoClaim',
        allItemsAutoClaimed,
      });
    }
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
        email,
        error: (err as Error).toString(),
        errorMessage,
        errorStack,
      });
      await likeNFTBookCartCollection.doc(cartId).update({
        status: 'error',
        email,
      });
    }
  }
}

export async function formatCartItemsWithInfo(items: CartItem[]) {
  const itemInfos: CartItemWithInfo[] = await Promise.all(items.map(async (item) => {
    let { classId } = item;
    const {
      priceIndex: inputPriceIndex,
      collectionId,
      customPriceInDecimal,
      priceInDecimal: inputPriceInDecimal,
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
      let [metadata, bookInfo] = await Promise.all([
        getNFTClassDataById(classId),
        getNftBookInfo(classId),
      ]);
      if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
      if (!metadata) throw new ValidationError('NFT_NOT_FOUND');
      const { evmClassId } = bookInfo;
      if (evmClassId && isLikeNFTClassId(classId)) {
        classId = evmClassId as string;
        [metadata, bookInfo] = await Promise.all([
          getNFTClassDataById(classId),
          getNftBookInfo(classId),
        ]);
        if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
        if (!metadata) throw new ValidationError('NFT_NOT_FOUND');
      }
      const {
        prices,
        ownerWallet,
        shippingRates,
        isLikerLandArt,
        chain,
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
      const { image, iscnPrefix } = metadata;
      const priceName = typeof priceNameObj === 'object' ? priceNameObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : priceNameObj || '';
      const priceDescription = typeof pricDescriptionObj === 'object' ? pricDescriptionObj[NFT_BOOK_TEXT_DEFAULT_LOCALE] : pricDescriptionObj || '';
      if (priceName) {
        name = `${name} - ${priceName}`;
      }
      if (priceDescription) {
        description = `${description} - ${priceDescription}`;
      }
      if (itemFrom) description = `[${itemFrom}] ${description}`;
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
        chain,
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
        chain,
      } = collectionData;
      if (!classIds[0]) throw new ValidationError('NFT_NOT_FOUND');
      if (chain === 'like' && classIds.find((id) => isEVMClassId(id))) {
        throw new ValidationError('NFT_COLLECTION_MIGRATING');
      }
      const classDataList = await Promise.all(classIds.map((id) => getNFTClassDataById(id)));

      const images: string[] = [];
      if (image) images.push(parseImageURLFromMetadata(image));
      classDataList.forEach((data) => {
        if (data?.image) {
          images.push(parseImageURLFromMetadata(data.image));
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
        chain,
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
      chain,
    } = info;

    name = name.length > 80 ? `${name.substring(0, 79)}…` : name;
    description = description.length > 300
      ? `${description.substring(0, 299)}…`
      : description;
    if (!description) {
      description = undefined;
    } // stripe does not like empty string

    let priceInDecimal = inputPriceInDecimal ?? originalPriceInDecimal;
    let customPriceDiffInDecimal = 0;
    if (isAllowCustomPrice
        && customPriceInDecimal
        && customPriceInDecimal > priceInDecimal
        && customPriceInDecimal <= MAXIMUM_CUSTOM_PRICE_IN_DECIMAL) {
      customPriceDiffInDecimal = customPriceInDecimal - priceInDecimal;
      priceInDecimal = customPriceInDecimal;
    }
    if (priceInDecimal < 0) throw new ValidationError('PRICE_INVALID');
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
      chain,
    };
  }));
  return itemInfos;
}

export async function formatCartItemInfosFromSession(session) {
  const sessionId = session.id;
  const {
    currency_conversion: currencyConversion,
    metadata: {
      from,
      fromList: fromListString,
    } = {} as any,
  } = session;
  const conversionRate = Number(currencyConversion?.fx_rate || 1);

  const items: CartItem[] = [];
  const lineItems: Stripe.LineItem[] = [];
  const stripeFeeAmount = await getStripeFeeFromCheckoutSession(session);
  for await (const lineItem of stripe.checkout.sessions.listLineItems(
    sessionId,
    { expand: ['data.price.product'], limit: 100 },
  )) {
    if (!lineItem.price) {
      throw new ValidationError('PRICE_NOT_FOUND');
    }
    if (typeof lineItem.price.product === 'string') {
      lineItem.price.product = await stripe.products.retrieve(lineItem.price.product);
    }
    lineItems.push(lineItem);
    const {
      classId,
      collectionId,
      priceIndex,
      tippingFor,
    } = (lineItem.price.product as Stripe.Product).metadata || {};
    if (!classId && !collectionId) {
      throw new ValidationError('ITEM_ID_NOT_SET');
    }
    const quantity = lineItem.quantity || 1;
    if (tippingFor) {
      // assume tipping always follow the parent item
      const { priceInDecimal = 0 } = items[items.length - 1];
      items[items.length - 1].customPriceInDecimal = priceInDecimal
        + Math.round(lineItem.amount_total / conversionRate / quantity);
    } else {
      items.push({
        classId,
        collectionId,
        priceIndex: parseInt(priceIndex, 10),
        priceInDecimal: Math.round(lineItem.amount_total / conversionRate / quantity),
        quantity,
      });
    }
  }
  if (fromListString) {
    const fromList = fromListString.split(',');
    fromList.forEach((f: string, index) => {
      items[index].from = f || items[index].from || from;
    });
  }
  const itemInfos = await formatCartItemsWithInfo(items);
  const itemPrices = await calculateItemPrices(itemInfos, from);
  const feeInfo: TransactionFeeInfo = itemPrices.reduce(
    (acc, item) => ({
      priceInDecimal: acc.priceInDecimal + item.priceInDecimal * item.quantity,
      originalPriceInDecimal: acc.originalPriceInDecimal
        + item.originalPriceInDecimal * item.quantity,
      likerLandTipFeeAmount: acc.likerLandTipFeeAmount + item.likerLandTipFeeAmount * item.quantity,
      likerLandFeeAmount: acc.likerLandFeeAmount + item.likerLandFeeAmount * item.quantity,
      likerLandCommission: acc.likerLandCommission + item.likerLandCommission * item.quantity,
      channelCommission: acc.channelCommission + item.channelCommission * item.quantity,
      likerLandArtFee: acc.likerLandArtFee + item.likerLandArtFee * item.quantity,
      customPriceDiffInDecimal: acc.customPriceDiffInDecimal
        + item.customPriceDiffInDecimal * item.quantity,
      stripeFeeAmount: acc.stripeFeeAmount,
    }),
    {
      priceInDecimal: 0,
      originalPriceInDecimal: 0,
      stripeFeeAmount,
      likerLandTipFeeAmount: 0,
      likerLandFeeAmount: 0,
      likerLandCommission: 0,
      channelCommission: 0,
      likerLandArtFee: 0,
      customPriceDiffInDecimal: 0,
    },
  );
  const [coupon = ''] = await getStripePromotoionCodesFromCheckoutSession(sessionId);
  return {
    itemInfos,
    itemPrices,
    feeInfo,
    coupon,
  };
}

export async function handleNewCartStripeCheckout(inputItems: CartItem[], {
  gaClientId,
  gaSessionId,
  gadClickId,
  gadSource,
  fbClickId,
  likeWallet,
  evmWallet,
  email,
  from: inputFrom,
  coupon,
  giftInfo,
  utm,
  referrer,
  userAgent,
  clientIp,
  paymentMethods,
  httpMethod = 'POST',
  cancelUrl,
  site,
  language,
}: {
  gaClientId?: string,
  gaSessionId?: string,
  gadClickId?: string,
  gadSource?: string,
  fbClickId?: string,
  email?: string,
  likeWallet?: string,
  evmWallet?: string,
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
  paymentMethods?: string[],
  httpMethod?: 'GET' | 'POST',
  cancelUrl?: string,
  site?: string,
  language?: string,
} = {}) {
  let items: CartItem[] = inputItems.map((item) => ({
    collectionId: item.collectionId,
    classId: item.classId,
    priceIndex: item.priceIndex,
    customPriceInDecimal: item.customPriceInDecimal,
    quantity: item.quantity,
    from: item.from,
  }));
  let itemInfos = await formatCartItemsWithInfo(items);
  const itemsWithShipping = itemInfos.filter((item) => item.hasShipping);
  if (itemsWithShipping.length > 1) {
    throw new ValidationError('MORE_THAN_ONE_SHIPPING_NOT_SUPPORTED');
  }
  let { chain } = itemInfos[0];
  if (!chain) {
    // eslint-disable-next-line no-console
    console.warn(`${itemInfos[0].classId} does not have chain id set`);
    chain = isLikeNFTClassId(itemInfos[0].classId as string) ? 'like' : 'evm';
  }
  if (!itemInfos.every((item) => {
    let itemChain = item.chain;
    if (!itemChain) {
      itemChain = isLikeNFTClassId(item.classId as string) ? 'like' : 'evm';
    }
    return itemChain === chain;
  })) {
    throw new ValidationError('DIFFERENT_CHAIN_NOT_SUPPORTED');
  }
  let customerEmail = email;
  let customerId;
  let couponId;
  const walletAddress = evmWallet || likeWallet;
  if (walletAddress) {
    const res = await getBookUserInfoFromWallet(walletAddress);
    const { bookUserInfo, likerUserInfo } = res || {};
    const { email: userEmail, isEmailVerified, isLikerPlus } = likerUserInfo || {};
    customerId = bookUserInfo?.stripeCustomerId;
    customerEmail = isEmailVerified ? userEmail : email;
    if (isLikerPlus) {
      couponId = LIKER_PLUS_20_COUPON_ID;
      items = items.map((item) => ({
        ...item,
        from: undefined,
      }));
      itemInfos = itemInfos.map((item) => ({
        ...item,
        from: undefined,
      }));
    }
  }
  const paymentId = uuidv4();
  const cartId = paymentId;
  const claimToken = crypto.randomBytes(32).toString('hex');
  const successUrl = giftInfo ? getLikerLandNFTGiftPageURL({
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
    site,
    language,
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
    couponId,
    claimToken,
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    likeWallet,
    evmWallet,
    customerId,
    email: customerEmail,
    giftInfo,
    utm,
    referrer,
    userAgent,
    clientIp,
    httpMethod,
    site,
  }, itemInfos, {
    successUrl,
    cancelUrl: cancelUrl || getLikerLandCartURL({
      type: 'book',
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
    }),
    paymentMethods,
  });

  const { url, id: sessionId } = session;
  if (!url) throw new ValidationError('STRIPE_SESSION_URL_NOT_FOUND');

  const {
    priceInDecimal,
    originalPriceInDecimal,
    customPriceDiffInDecimal,
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
