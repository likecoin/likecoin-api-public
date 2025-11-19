import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';
import { getBookUserInfoFromWallet } from '../../util/api/likernft/book/user';
import stripe from '../../util/stripe';
import {
  BOOK3_HOSTNAME, PLUS_MONTHLY_PRICE, PLUS_YEARLY_PRICE, PUBSUB_TOPIC_MISC,
  W3C_EMAIL_REGEX,
} from '../../constant';
import { createNewPlusCheckoutSession, updateSubscriptionPeriod } from '../../util/api/plus';
import { claimPlusGiftCart, createPlusGiftCheckoutSession } from '../../util/api/plus/gift';
import publisher from '../../util/gcloudPub';
import { getUserWithCivicLikerPropertiesByWallet } from '../../util/api/users';
import logPixelEvents from '../../util/fbq';

const router = Router();

router.post('/new', jwtAuth('write:plus'), async (req, res, next) => {
  let { period = 'monthly' } = req.query;
  const { from } = req.query;
  const {
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    referrer,
    utmCampaign,
    utmSource,
    utmMedium,
    utmContent,
    utmTerm,
    coupon,
    trialPeriodDays = 0,
    mustCollectPaymentMethod,
    giftClassId,
    giftPriceIndex = '0',
  } = req.body;
  try {
    // Ensure period is either 'monthly' or 'yearly'
    if (period !== 'monthly' && period !== 'yearly') {
      period = 'monthly'; // Default to monthly if invalid
    }
    if (period !== 'yearly' && giftClassId) {
      throw new ValidationError('Gift subscriptions are only available for yearly plans.', 400);
    }
    if (period === 'yearly' && trialPeriodDays > 0 && giftClassId) {
      throw new ValidationError('Gift subscriptions cannot have a trial period.', 400);
    }
    if (![0, 1, 3, 5, 7].includes(trialPeriodDays)) {
      throw new ValidationError('Invalid trial period days.', 400);
    }
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const {
      session,
      paymentId,
      email,
    } = await createNewPlusCheckoutSession(
      {
        period: period as 'monthly' | 'yearly',
        trialPeriodDays,
        mustCollectPaymentMethod,
        giftClassId,
        giftPriceIndex,
        coupon,
      },
      {
        from: from as string,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        fbClickId,
        referrer,
        userAgent,
        clientIp,
        utm: {
          campaign: utmCampaign,
          source: utmSource,
          medium: utmMedium,
          content: utmContent,
          term: utmTerm,
        },
      },
      req,
    );
    res.json({
      sessionId: session.id,
      url: session.url,
    });

    await logPixelEvents('InitiateCheckout', {
      email,
      items: [{
        productId: `plus-${period}`,
        quantity: 1,
      }],
      userAgent,
      clientIp,
      value: period === 'yearly' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId,
      evmWallet: req.user?.evmWallet,
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusCheckoutSessionCreated',
      sessionId: session.id,
      period,
      wallet: req.user?.wallet,
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
      from,
      gadClickId,
      gadSource,
      fbClickId,
      utmCampaign,
      utmSource,
      utmMedium,
      utmContent,
      utmTerm,
      referrer,
    });
  } catch (error) {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusCheckoutSessionError',
      period,
      wallet: req.user?.wallet,
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
      error: (error as Error).message,
    });
    next(error);
  }
});

router.post('/gift/new', jwtAuth('write:plus'), async (req, res, next) => {
  let { period = 'yearly' } = req.query;
  const { from } = req.query;
  const {
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    referrer,
    utmCampaign,
    utmSource,
    utmMedium,
    utmContent,
    utmTerm,
    coupon,
    giftInfo,
  } = req.body;
  try {
    if (period !== 'monthly' && period !== 'yearly') {
      period = 'yearly'; // Default to yearly if invalid
    }
    if (!giftInfo || !giftInfo.toEmail) {
      throw new ValidationError('REQUIRE_GIFT_TO_EMAIL');
    }
    if (!W3C_EMAIL_REGEX.test(giftInfo.toEmail)) {
      throw new ValidationError('INVALID_GIFT_TO_EMAIL');
    }
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const userAgent = req.get('User-Agent');
    const {
      session,
      paymentId,
      email,
    } = await createPlusGiftCheckoutSession(
      {
        period: period as 'monthly' | 'yearly',
        giftInfo,
        coupon,
      },
      {
        from: from as string,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        fbClickId,
        referrer,
        userAgent,
        clientIp,
        utm: {
          campaign: utmCampaign,
          source: utmSource,
          medium: utmMedium,
          content: utmContent,
          term: utmTerm,
        },
      },
      req,
    );
    res.json({
      sessionId: session.id,
      url: session.url,
    });

    await logPixelEvents('InitiateCheckout', {
      email,
      items: [{
        productId: `plus-gift-${period}`,
        quantity: 1,
      }],
      userAgent,
      clientIp,
      value: period === 'yearly' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE,
      currency: 'USD',
      paymentId,
      referrer,
      fbClickId,
      evmWallet: req.user?.evmWallet,
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusGiftCheckoutSessionCreated',
      sessionId: session.id,
      period,
      wallet: req.user?.wallet,
      likeWallet: req.user?.likeWallet,
      evmWallet: req.user?.evmWallet,
      giftToEmail: giftInfo.toEmail,
      giftFromName: giftInfo.fromName,
      giftToName: giftInfo.toName,
      giftMessage: giftInfo.message,
      gadClickId,
      gadSource,
      fbClickId,
      utmCampaign,
      utmSource,
      utmMedium,
      utmContent,
      utmTerm,
      referrer,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/gift/:cartId/claim', jwtAuth('write:plus'), async (req, res, next) => {
  const { cartId } = req.params;
  const { token } = req.query;
  try {
    if (!cartId) {
      throw new ValidationError('MISSING_CART_ID');
    }
    if (!token) {
      throw new ValidationError('MISSING_CLAIM_TOKEN');
    }
    await claimPlusGiftCart({
      cartId: cartId as string,
      token: token as string,
      wallet: req.user?.wallet,
    });
    res.sendStatus(200);

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusGiftClaimed',
      cartId,
      wallet: req.user?.wallet,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/price', jwtAuth('write:plus'), async (req, res, next) => {
  const {
    period,
    giftClassId,
    giftPriceIndex = '0',
  } = req.body;
  try {
    // Validate and update the subscription plan
    if (period !== 'monthly' && period !== 'yearly') {
      throw new ValidationError('Invalid subscription period.', 400);
    }
    if (giftClassId && period !== 'yearly') {
      throw new ValidationError('Gift books are only available for yearly plans.', 400);
    }
    const { wallet } = req.user;
    const userInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
    if (!userInfo?.likerPlus) {
      throw new ValidationError('No Liker Plus subscription found for this user.', 404);
    }
    const { subscriptionId, period: existingPeriod } = userInfo.likerPlus;
    if (!subscriptionId) {
      throw new ValidationError('No subscription found for this user.', 404);
    }
    if (period === `${existingPeriod}ly`) {
      throw new ValidationError('Subscription period is already set to this value.', 400);
    }
    await updateSubscriptionPeriod(subscriptionId, period, {
      giftClassId,
      giftPriceIndex,
    });
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

router.get('/gift', jwtAuth('read:plus'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const userInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
    if (!userInfo?.likerPlus) {
      throw new ValidationError('No Liker Plus subscription found for this user.', 404);
    }
    const { subscriptionId } = userInfo.likerPlus;
    if (!subscriptionId) {
      throw new ValidationError('No subscription Id found for this user.', 404);
    }
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const metadata = subscription.metadata || {};
    const {
      giftClassId,
      giftCartId,
      giftPaymentId,
      giftClaimToken,
    } = metadata;
    res.json({
      giftClassId,
      giftCartId,
      giftPaymentId,
      giftClaimToken,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/portal', jwtAuth('write:plus'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const userInfo = await getBookUserInfoFromWallet(wallet);
    const { bookUserInfo } = userInfo || {};
    const customerId = bookUserInfo?.stripeCustomerId;
    if (!customerId) {
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'PlusBillingPortalNoCustomerId',
        wallet,
      });
      throw new ValidationError('No Stripe customer ID found for this user. Please subscribe first.', 400);
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `https://${BOOK3_HOSTNAME}/account`,
    });

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusBillingPortalSessionCreated',
      sessionId: session.id,
      wallet,
      customerId,
    });

    res.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusBillingPortalError',
      wallet: req.user?.wallet,
      error: (error as Error).message,
    });
    next(error);
  }
});

export default router;
