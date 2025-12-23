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
  PLUS_YEARLY_PRICE,
} from '../../../../constant';
import { ValidationError } from '../../../ValidationError';
import { getBook3CartURL, getBook3NFTClaimPageURL, getLikerLandNFTGiftPageURL } from '../../../liker-land';
import { parseImageURLFromMetadata } from '../metadata';
import {
  formatStripeCheckoutSession,
  createNewNFTBookPayment,
  processNFTBookPurchaseTxUpdate,
  handleStripeConnectedAccount,
  processNFTBookPurchaseTxGet,
  claimNFTBook,
  calculateItemPrices,
  checkIsFromLikerLand,
} from './purchase';
import { depositLikeCollectiveReward } from '../../../evm/likeCollective';
import { getLIKEPrice } from '../likePrice';
import {
  admin,
  db,
  FieldValue,
  likeNFTBookCartCollection,
  likeNFTBookCollection,
} from '../../../firebase';
import stripe, { getStripeFeeFromCheckoutSession, getStripePromotoionCodesFromCheckoutSession } from '../../../stripe';
import {
  convertObjectToAirtableLongText,
  createAirtableBookSalesRecordFromFreePurchase,
  createAirtableBookSalesRecordFromStripePaymentIntent,
} from '../../../airtable';
import { sendNFTBookOutOfStockSlackNotification, sendNFTBookSalesSlackNotification } from '../../../slack';
import publisher from '../../../gcloudPub';
import { type IntercomUserCustomAttributes, updateIntercomUserAttributes } from '../../../intercom';
import {
  sendNFTBookCartGiftPendingClaimEmail,
  sendNFTBookCartPendingClaimEmail,
  sendNFTBookOutOfStockEmail,
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
import { isLikeNFTClassId } from '../../../cosmos/nft';
import { getUserWithCivicLikerPropertiesByWallet } from '../../users';

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
}): Promise<void> {
  const classIdsWithPrice = itemPrices.filter((item) => !!item.classId).map((item) => ({
    classId: item.classId,
    priceIndex: item.priceIndex,
    quantity: item.quantity,
    price: item.priceInDecimal / 100,
    priceInDecimal: item.priceInDecimal,
    originalPriceInDecimal: item.originalPriceInDecimal,
  }));
  const classIds = classIdsWithPrice.map((item) => item.classId);
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
    const stripeFeeAmount = Math.ceil((totalStripeFeeAmount * priceInDecimal * quantity)
        / totalPriceInDecimal) || 0;
    const itemFeeInfo: TransactionFeeInfo = {
      stripeFeeAmount,
      priceInDecimal: priceInDecimal * quantity,
      originalPriceInDecimal: originalPriceInDecimal * quantity,
      customPriceDiffInDecimal: customPriceDiffInDecimal * quantity,
      likerLandTipFeeAmount: likerLandTipFeeAmount * quantity,
      likerLandFeeAmount: likerLandFeeAmount * quantity,
      likerLandCommission: likerLandCommission * quantity,
      channelCommission: channelCommission * quantity,
      likerLandArtFee: likerLandArtFee * quantity,
      royaltyToSplit: Math.max(
        priceInDecimal
        - stripeFeeAmount
        - likerLandFeeAmount
        - likerLandTipFeeAmount
        - likerLandCommission
        - channelCommission
        - likerLandArtFee,
        0,
      ) * quantity,
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

  const cartData = await db.runTransaction(async (t: admin.firestore.Transaction) => {
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
    classIds = [],
    claimedClassIds = [],
  } = cartData;

  const unclaimedClassIds: string[] = classIds.filter((id) => !claimedClassIds.includes(id));
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

  const allItemsAutoClaimed = newClaimedNFTs.filter(
    (nft) => !!(nft.nftIds?.length || nft.nftId !== undefined),
  ).length === unclaimedClassIds.length;
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
    newClaimedNFTs,
    allItemsAutoClaimed,
    errors,
  };
}

type ProcessNFTBookCartInput = {
  itemInfos: CartItemWithInfo[];
  itemPrices: ItemPriceInfo[];
  totalFeeInfo: TransactionFeeInfo;
  coupon?: string;
};

type ProcessNFTBookCartMeta = {
  cartId: string;
  paymentId: string;
  sessionId?: string;
  userAgent?: string;
  clientIp?: string;
  referrer?: string;
  fbClickId?: string;
  utmSource?: string;
  utmCampaign?: string;
  utmMedium?: string;
  utmContent?: string;
  utmTerm?: string;
  gaClientId?: string;
  gaSessionId?: string;
  claimToken: string;
  from?: string;
  giftToEmail?: string;
  giftToName?: string;
  giftMessage?: string;
  giftFromName?: string;
  evmWallet?: string;
};

type ProcessNFTBookCartPayment = {
  amountTotal: number | null;
  email: string | null;
  paymentIntent?: Stripe.PaymentIntent | null;
  session?: Stripe.Checkout.Session;
};

export async function processNFTBookCart(
  {
    itemInfos,
    itemPrices,
    totalFeeInfo,
    coupon = '',
  }: ProcessNFTBookCartInput,
  {
    cartId,
    paymentId,
    sessionId,
    userAgent,
    clientIp,
    referrer,
    fbClickId,
    utmSource,
    utmCampaign,
    utmMedium,
    utmContent,
    utmTerm,
    gaClientId,
    gaSessionId,
    claimToken,
    from,
    giftToEmail,
    giftToName,
    giftMessage,
    giftFromName,
    evmWallet,
  }: ProcessNFTBookCartMeta,
  {
    amountTotal,
    email,
    paymentIntent,
    session,
  }: ProcessNFTBookCartPayment,
  req: any,
) {
  await createNewNFTBookCartPayment(cartId, paymentId, {
    type: 'stripe',
    claimToken,
    sessionId,
    giftInfo: (giftToEmail && giftToName && giftMessage && giftFromName) ? {
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
    // eslint-disable-next-line no-use-before-define
    const infos = await processNFTBookCartPurchase({
      cartId,
      email,
      paymentId,
    });
    const {
      classInfos,
      txData: cartData,
    } = infos;
    const {
      isGift: cartIsGift,
      giftInfo: cartGiftInfo,
    } = cartData as any;

    let chargeId: string | undefined;
    if (paymentIntent) {
      chargeId = typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id;
    }

    const infoList = classInfos;
    const bookNames: string[] = [];
    for (let itemIndex = 0; itemIndex < infoList.length; itemIndex += 1) {
      const info = infoList[itemIndex];
      const {
        classId,
        listingData,
        txData,
      } = info;
      const {
        connectedWallets,
        ownerWallet,
        prices,
      } = listingData;
      const {
        price,
        quantity,
        priceIndex,
        priceName,
        isGift,
        feeInfo,
        from: itemFrom,
      } = txData;
      const { stock, isAutoDeliver } = prices?.[priceIndex] || {};
      const isOutOfStock = !isAutoDeliver && stock <= 0;
      const {
        priceInDecimal,
        stripeFeeAmount,
        channelCommission,
        likerLandArtFee,
        royaltyToSplit,
      } = feeInfo as TransactionFeeInfo;
      const bookId = classId;
      const bookData = await getNftBookInfo(classId);
      const bookName = bookData?.name?.[NFT_BOOK_TEXT_DEFAULT_LOCALE] || bookData?.name || bookId;
      bookNames.push(bookName);
      const { transfers } = await handleStripeConnectedAccount(
        {
          classId,
          priceIndex,
          paymentId,
          ownerWallet,
          bookName,
          buyerEmail: email,
          paymentIntentId: paymentIntent?.id,
        },
        {
          amountTotal: priceInDecimal,
          chargeId,
          channelCommission,
          likerLandArtFee,
          royaltyToSplit,
        },
        { connectedWallets, from: itemFrom },
      );

      const ownerInfo = await getBookUserInfoFromWallet(ownerWallet);
      const ownerLikerInfo = ownerInfo?.likerUserInfo as any;
      const ownerEmail = ownerLikerInfo?.isEmailVerified
        ? ownerLikerInfo?.email
        : undefined;

      // Deposit like collective reward if applicable
      try {
        const { customPriceDiffInDecimal = 0 } = feeInfo as TransactionFeeInfo;
        if (feeInfo && !txData.likeCollectiveRewardTxHash) {
          const likePrice = await getLIKEPrice();
          const rewardTxHash = await depositLikeCollectiveReward(
            classId,
            priceInDecimal,
            customPriceDiffInDecimal,
            likePrice,
          );

          if (rewardTxHash) {
            await likeNFTBookCollection.doc(classId)
              .collection('transactions')
              .doc(paymentId)
              .update({
                likeCollectiveRewardTxHash: rewardTxHash,
              });
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `Failed to deposit LikeCollective reward for classId ${classId}:`,
          error,
        );
      }

      const notifications: Promise<any>[] = [
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
        paymentIntent
          ? createAirtableBookSalesRecordFromStripePaymentIntent({
            pi: paymentIntent,
            paymentId,
            classId,
            priceIndex,
            itemIndex,
            stripeFeeAmount,
            stripeFeeCurrency: 'USD',
            from,
            evmWallet,
            quantity,
            feeInfo,
            transfers,
            coupon,
            cartId,
            isGift,
          }) : createAirtableBookSalesRecordFromFreePurchase({
            classId,
            priceIndex,
            paymentId,
            itemIndex,
            quantity,
            from,
            email: email || undefined,
            evmWallet,
            utmSource,
            utmCampaign,
            utmMedium,
            utmContent,
            utmTerm,
            referrer,
            gaClientId,
            gaSessionId,
            coupon,
            cartId,
            rawData: convertObjectToAirtableLongText(session),
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
          sessionId,
          stripeFeeAmount,
          coupon,
          isGift,
          utmCampaign,
          utmSource,
          utmMedium,
          utmContent,
          utmTerm,
        }),
      ];
      if (!isAutoDeliver && stock <= SLACK_OUT_OF_STOCK_NOTIFICATION_THRESHOLD) {
        notifications.push(sendNFTBookOutOfStockSlackNotification({
          classId,
          className: bookName,
          priceName,
          priceIndex,
          email: ownerEmail || '',
          wallet: ownerWallet,
          stock,
        }));
      }
      if (isOutOfStock) {
        notifications.push(sendNFTBookOutOfStockEmail({
          email: ownerEmail,
          classId,
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
      sessionId,
      numberOfItems: infoList.length,
      quantity: infoList.reduce((acc, item) => acc + item.txData.quantity, 0),
      isGift: cartIsGift,
      utmCampaign,
      utmSource,
      utmMedium,
      utmContent,
      utmTerm,
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
        productId: item.classId,
        priceIndex: item.txData.priceIndex,
        quantity: item.txData.quantity,
      })),
      userAgent,
      clientIp,
      value: (amountTotal || 0) / 100,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId,
      evmWallet,
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

      const hasFreeBooks = itemPrices.some((item) => item.priceInDecimal === 0);
      const hasPaidBooks = itemPrices.some((item) => item.priceInDecimal > 0);

      if (hasFreeBooks || hasPaidBooks) {
        const attributes: IntercomUserCustomAttributes = {};
        if (hasFreeBooks) attributes.has_claimed_free_book = true;
        if (hasPaidBooks) attributes.has_purchased_paid_book = true;

        const userInfo = await getUserWithCivicLikerPropertiesByWallet(evmWallet);
        const likerId = userInfo?.user;
        if (likerId) {
          await updateIntercomUserAttributes(likerId, attributes);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`Could not update Intercom user attributes: likerId not found for wallet ${evmWallet}`);
        }
      }
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
        email: email || undefined,
      });
    }
  }
}

export async function processNFTBookCartPurchase({
  cartId,
  email,
  paymentId,
}) {
  const cartRef = likeNFTBookCartCollection.doc(cartId);
  const infos = await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const cartDoc = await t.get(cartRef);
    const cartData = cartDoc.data();
    if (!cartData) throw new ValidationError('CART_ID_NOT_FOUND');
    const {
      status,
      classIds = [],
    } = cartData;
    if (status !== 'new') throw new ValidationError('PAYMENT_ALREADY_PROCESSED');

    const classInfos = await Promise.all(classIds.map(async (classId) => {
      const { listingData, txData } = await processNFTBookPurchaseTxGet(
        t,
        classId,
        paymentId,
        { email },
      );
      return {
        classId,
        listingData,
        txData,
      };
    }));

    await Promise.all(classInfos.map(async (info, index) => {
      await processNFTBookPurchaseTxUpdate(t, classIds[index], paymentId, info);
    }));

    const updatePayload = {
      status: 'paid',
      isPaid: true,
      isPendingClaim: true,
      email,
    };
    t.update(cartRef, updatePayload);

    return {
      txData: {
        ...cartData,
        ...updatePayload,
      },
      classInfos,
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
  } = session;
  const {
    customer_details: customer,
    payment_intent: paymentIntentId,
    id: sessionId,
  } = session;

  const metadata: any = session.metadata || {};
  if (!customer) throw new ValidationError('CUSTOMER_NOT_FOUND');

  const isFree = amountTotal === 0;
  if (!isFree && !paymentIntentId) throw new ValidationError('PAYMENT_INTENT_NOT_FOUND');
  let paymentIntent: Stripe.PaymentIntent | null = null;
  if (paymentIntentId) {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId as string, {
      expand: STRIPE_PAYMENT_INTENT_EXPAND_OBJECTS,
    });
  }
  const { email } = customer;

  const {
    itemInfos,
    itemPrices,
    feeInfo: totalFeeInfo,
    coupon,
  // eslint-disable-next-line no-use-before-define
  } = await formatCartItemInfosFromSession(session, paymentIntent);

  if (!itemInfos?.length) return;

  const cartId = metadata.cartId || uuidv4();
  const paymentId = cartId;
  const claimToken = metadata.claimToken || uuidv4();

  await processNFTBookCart(
    {
      itemInfos,
      itemPrices,
      totalFeeInfo,
      coupon,
    },
    {
      ...metadata,
      sessionId,
      cartId,
      paymentId,
      claimToken,
    },
    {
      amountTotal,
      email,
      paymentIntent,
      session,
    },
    req,
  );
}

export async function createFreeBookCartFromSubscription({
  classId,
  cartId,
  priceIndex,
  amountPaid,
}, {
  evmWallet,
  email,
}) {
  const paymentId = cartId;
  const claimToken = uuidv4();
  const cartItems = [{
    classId,
    priceIndex,
    priceInDecimal: 0,
  }];
  // eslint-disable-next-line no-use-before-define
  const itemInfos = await formatCartItemsWithInfo(cartItems);
  const itemPrices = await calculateItemPrices(itemInfos, NFT_BOOK_DEFAULT_FROM_CHANNEL);
  if (itemInfos[0].originalPriceInDecimal > PLUS_YEARLY_PRICE * 100) {
    // eslint-disable-next-line no-console
    console.warn('Free book cart item price is not less than the plus yearly price, skipping cart creation.');
    return null;
  }
  if (itemInfos[0].originalPriceInDecimal > amountPaid * 100) {
    // eslint-disable-next-line no-console
    console.warn('Free book cart item price is not less than the amount paid');
  }
  const totalFeeInfo: TransactionFeeInfo = {
    priceInDecimal: 0,
    originalPriceInDecimal: itemPrices[0].originalPriceInDecimal,
    stripeFeeAmount: 0,
    likerLandTipFeeAmount: 0,
    likerLandFeeAmount: 0,
    likerLandCommission: 0,
    channelCommission: 0,
    likerLandArtFee: 0,
    customPriceDiffInDecimal: 0,
    royaltyToSplit: 0,
  };
  const utmCampaign = 'liker-plus';
  const utmSource = 'liker-plus';
  const utmMedium = 'subscription';
  await processNFTBookCart({
    itemInfos,
    itemPrices,
    totalFeeInfo,
  }, {
    cartId,
    paymentId,
    evmWallet,
    claimToken,
    utmCampaign,
    utmSource,
    utmMedium,
  }, {
    amountTotal: 0,
    email,
  }, null);
  publisher.publish(PUBSUB_TOPIC_MISC, null, {
    logType: 'FreeBookCartCreated',
    cartId,
    paymentId,
    evmWallet,
    email,
    utmCampaign,
    utmSource,
    utmMedium,
  });
  return {
    cartId,
    paymentId,
    claimToken,
  };
}

export async function createFreeBookCartForFreeIds({
  evmWallet,
  classIds,
  email,
}) {
  const cartId = uuidv4();
  const paymentId = cartId;
  const claimToken = uuidv4();
  const cartItems = classIds.map((classId) => ({
    classId,
    priceIndex: 0,
    priceInDecimal: 0,
  }));
  // eslint-disable-next-line no-use-before-define
  const itemInfos = await formatCartItemsWithInfo(cartItems);
  const itemPrices = await calculateItemPrices(itemInfos, NFT_BOOK_DEFAULT_FROM_CHANNEL);
  if (itemInfos.some((item) => item.originalPriceInDecimal > 0)) {
    throw new ValidationError('FREE_BOOK_CART_ITEM_PRICE_NOT_FREE');
  }
  const totalFeeInfo: TransactionFeeInfo = {
    priceInDecimal: 0,
    originalPriceInDecimal:
      itemPrices.reduce((acc, item) => acc + item.originalPriceInDecimal * item.quantity, 0),
    stripeFeeAmount: 0,
    likerLandTipFeeAmount: 0,
    likerLandFeeAmount: 0,
    likerLandCommission: 0,
    channelCommission: 0,
    likerLandArtFee: 0,
    customPriceDiffInDecimal: 0,
    royaltyToSplit: 0,
  };
  await db.runTransaction(async (t: admin.firestore.Transaction) => {
    const query = await t.get(likeNFTBookCartCollection
      .where('classIds', '==', classIds)
      .where('wallet', '==', evmWallet));
    if (!query.empty) {
      throw new ValidationError('CART_ALREADY_EXISTS');
    }
    t.create(likeNFTBookCartCollection.doc(`${cartId}-lock`), {
      classIds,
      wallet: evmWallet,
      status: 'pending',
      timestamp: FieldValue.serverTimestamp(),
    });
  });
  try {
    await processNFTBookCart({
      itemInfos,
      itemPrices,
      totalFeeInfo,
    }, {
      cartId,
      paymentId,
      evmWallet,
      claimToken,
      utmCampaign: 'free-books',
      utmSource: 'free-books',
      utmMedium: 'free-books',
    }, {
      amountTotal: 0,
      email,
    }, null);
    return {
      cartId,
      paymentId,
      claimToken,
    };
  } finally {
    likeNFTBookCartCollection.doc(`${cartId}-lock`).delete().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to release cart lock:', error);
    });
  }
}

export async function formatCartItemsWithInfo(items: CartItem[]) {
  const itemInfos: CartItemWithInfo[] = await Promise.all(items.map(async (item) => {
    let { classId } = item;
    const {
      priceIndex: inputPriceIndex,
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
      const { evmClassId, redirectClassId } = bookInfo;
      if (redirectClassId || (evmClassId && isLikeNFTClassId(classId))) {
        classId = redirectClassId || evmClassId as string;
        [metadata, bookInfo] = await Promise.all([
          getNFTClassDataById(classId),
          getNftBookInfo(classId),
        ]);
        if (!bookInfo) throw new ValidationError('NFT_NOT_FOUND');
        if (!metadata) throw new ValidationError('NFT_NOT_FOUND');
      }
      const {
        prices = [],
        ownerWallet,
        isLikerLandArt,
        chain,
        isApprovedForSale,
      } = bookInfo;

      if (isApprovedForSale === false) {
        throw new ValidationError('BOOK_NOT_APPROVED_FOR_SALE');
      }

      if (!prices[priceIndex]) throw new ValidationError('NFT_PRICE_NOT_FOUND');
      const priceData = prices[priceIndex];
      const {
        priceInDecimal: originalPriceInDecimal,
        stock,
        isAllowCustomPrice,
        name: priceNameObj,
        description: pricDescriptionObj,
        stripePriceId,
        isAutoDeliver,
      } = priceData;
      let { name = '', description = '' } = metadata;
      const { image, iscnPrefix } = metadata;
      const priceName = typeof priceNameObj === 'object' && priceNameObj ? (priceNameObj as Record<string, string>)[NFT_BOOK_TEXT_DEFAULT_LOCALE] : (priceNameObj as string) || '';
      const priceDescription = typeof pricDescriptionObj === 'object' && pricDescriptionObj ? (pricDescriptionObj as Record<string, string>)[NFT_BOOK_TEXT_DEFAULT_LOCALE] : (pricDescriptionObj as string) || '';
      if (priceName) {
        name = `${name} - ${priceName}`;
      }
      if (priceDescription) {
        description = `${description} - ${priceDescription}`;
      }
      if (itemFrom) description = `[${itemFrom}] ${description}`;
      const images = [parseImageURLFromMetadata(image || '')];
      info = {
        stock,
        isAllowCustomPrice,
        name,
        description,
        images,
        ownerWallet,
        isLikerLandArt,
        originalPriceInDecimal,
        classId,
        iscnPrefix,
        priceName,
        stripePriceId,
        chain,
        isAutoDeliver,
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
      images,
      ownerWallet,
      isLikerLandArt,
      priceName = '',
      stripePriceId,
      chain,
      isAutoDeliver,
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
    if (!isAutoDeliver) {
      if (stock < quantity) throw new ValidationError('OUT_OF_STOCK');
    }
    return {
      ...item,
      priceName,
      priceInDecimal,
      customPriceDiffInDecimal,
      stock,
      isAllowCustomPrice,
      name,
      description,
      images,
      ownerWallet,
      isLikerLandArt,
      originalPriceInDecimal,
      classId,
      priceIndex,
      quantity,
      stripePriceId,
      chain,
    };
  }));
  return itemInfos;
}

export async function formatCartItemInfosFromSession(
  session: Stripe.Checkout.Session,
  paymentIntent?: Stripe.PaymentIntent | null,
) {
  const sessionId = session.id;
  const {
    currency_conversion: currencyConversion,
    presentment_details: presentmentDetails,
    metadata: {
      from,
      fromList: fromListString,
    } = {} as any,
  } = session;
  // presentment_details: amounts already in integration currency (usd for us) (API 2025-03-31+)
  // currency_conversion: need fx_rate conversion (older sessions)
  let conversionRate = 1;
  if (presentmentDetails) {
    conversionRate = 1;
  } else if (currencyConversion?.fx_rate) {
    conversionRate = Number(currencyConversion.fx_rate);
  } else if (paymentIntent) {
    const balanceTx = (paymentIntent.latest_charge as Stripe.Charge)?.balance_transaction;
    if (balanceTx && typeof balanceTx !== 'string' && balanceTx.exchange_rate) {
      conversionRate = 1 / balanceTx.exchange_rate;
    }
  }

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
      priceIndex,
      tippingFor,
    } = (lineItem.price.product as Stripe.Product).metadata || {};
    if (!classId) {
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
      royaltyToSplit:
        acc.royaltyToSplit
        + Math.max(
          item.priceInDecimal
          - item.likerLandFeeAmount
          - item.likerLandTipFeeAmount
          - item.likerLandCommission
          - item.channelCommission
          - item.likerLandArtFee,
          0,
        ) * item.quantity,
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
      royaltyToSplit: 0,
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
  currency,
  giftInfo,
  utm,
  referrer,
  userAgent,
  clientIp,
  paymentMethods,
  httpMethod = 'POST',
  cancelUrl,
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
  currency?: string,
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
    content?: string,
    term?: string,
  },
  referrer?: string,
  userAgent?: string,
  clientIp?: string,
  paymentMethods?: string[],
  httpMethod?: 'GET' | 'POST',
  cancelUrl?: string,
  language?: string,
} = {}) {
  let from: string = inputFrom as string || '';
  if (!from) {
    from = NFT_BOOK_DEFAULT_FROM_CHANNEL;
  }

  let items: CartItem[] = inputItems.map((item) => ({
    classId: item.classId,
    priceIndex: item.priceIndex,
    customPriceInDecimal: item.customPriceInDecimal,
    quantity: item.quantity,
    from: item.from,
  }));
  let itemInfos = await formatCartItemsWithInfo(items);
  const firstItemInfo = itemInfos[0];
  let { chain } = firstItemInfo;
  if (!chain) {
    // eslint-disable-next-line no-console
    console.warn(`${firstItemInfo.classId} does not have chain id set`);
    chain = isLikeNFTClassId(firstItemInfo.classId as string) ? 'like' : 'base';
  }
  if (!itemInfos.every((item) => {
    let itemChain = item.chain;
    if (!itemChain) {
      itemChain = isLikeNFTClassId(item.classId as string) ? 'like' : 'base';
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

    if (isLikerPlus && checkIsFromLikerLand(from) && !coupon) {
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
  }) : getBook3NFTClaimPageURL({
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
    language,
  });

  const {
    session,
    feeInfo,
  } = await formatStripeCheckoutSession({
    cartId,
    paymentId,
    from,
    coupon,
    couponId,
    currency,
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
    language,
  }, itemInfos, {
    successUrl,
    cancelUrl: cancelUrl || getBook3CartURL({
      type: 'book',
      utmCampaign: utm?.campaign,
      utmSource: utm?.source,
      utmMedium: utm?.medium,
      gaClientId,
      gaSessionId,
      gadClickId,
      gadSource,
      from,
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
