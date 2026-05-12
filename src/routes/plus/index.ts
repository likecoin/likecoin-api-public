import { Router } from 'express';
import { jwtAuth, jwtOptionalAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';
import { getBookUserInfoFromWallet, getBookUserInfoFromLikerId } from '../../util/api/likernft/book/user';
import { getStripeClient } from '../../util/stripe';
import {
  BOOK3_HOSTNAME, PLUS_MONTHLY_PRICE, PLUS_YEARLY_PRICE, PUBSUB_TOPIC_MISC,
  SUPPORTED_CHECKOUT_UI_MODES, SUPPORTED_PLUS_CURRENCIES, W3C_EMAIL_REGEX,
} from '../../constant';
import type { SupportedCheckoutUIMode, SupportedPlusCurrency } from '../../constant';
import { convertUSDPriceToCurrency } from '../../util/pricing';
import { createNewPlusCheckoutSession, updateSubscriptionPeriod } from '../../util/api/plus';
import { claimPlusGiftCart, createPlusGiftCheckoutSession, getPlusGiftCartData } from '../../util/api/plus/gift';
import publisher from '../../util/gcloudPub';
import { getUserWithCivicLikerPropertiesByWallet } from '../../util/api/users';
import logServerEvents from '../../util/logServerEvents';
import { checkUserNameValid, filterPlusGiftCartData, normalizeLikerId } from '../../util/ValidationHelper';

const router = Router();

router.post('/new', jwtAuth('write:plus'), async (req, res, next) => {
  let { period = 'monthly' } = req.query;
  const { from, currency } = req.query;
  const {
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    fbp,
    fbc,
    posthogDistinctId,
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
    isApp,
    uiMode,
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
    if (![0, 1, 3, 5, 7, 14, 30].includes(trialPeriodDays)) {
      throw new ValidationError('Invalid trial period days.', 400);
    }
    if (currency !== undefined
      && !SUPPORTED_PLUS_CURRENCIES.includes(currency as SupportedPlusCurrency)) {
      throw new ValidationError('UNSUPPORTED_CURRENCY', 400);
    }
    if (
      uiMode !== undefined
      && !SUPPORTED_CHECKOUT_UI_MODES.includes(uiMode as SupportedCheckoutUIMode)
    ) {
      throw new ValidationError('INVALID_UI_MODE', 400);
    }
    const checkoutCurrency = (currency as SupportedPlusCurrency) || 'usd';
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const ipCountry = ((req.headers['cf-ipcountry'] as string) || (req.body?.ipCountry as string) || '').toUpperCase() || undefined;
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
        currency: checkoutCurrency,
        isApp,
        uiMode,
      },
      {
        from: from as string,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        fbClickId,
        fbp,
        fbc,
        referrer,
        userAgent,
        clientIp,
        ipCountry,
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
      clientSecret: session.client_secret,
      paymentId,
    });

    await logServerEvents('InitiateCheckout', {
      email,
      items: [{
        productId: `plus-${period}`,
        quantity: 1,
      }],
      userAgent,
      clientIp,
      value: convertUSDPriceToCurrency(
        period === 'yearly' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE,
        checkoutCurrency,
      ),
      currency: checkoutCurrency.toUpperCase(),
      paymentId,
      referrer,
      fbClickId,
      fbp,
      fbc,
      evmWallet: req.user?.evmWallet,
      gaClientId,
      gaSessionId,
      posthogDistinctId,
    });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'PlusCheckoutSessionCreated',
      sessionId: session.id,
      period,
      uiMode: uiMode || 'hosted',
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
  const { from, currency } = req.query;
  const {
    gaClientId,
    gaSessionId,
    gadClickId,
    gadSource,
    fbClickId,
    fbp,
    fbc,
    posthogDistinctId,
    referrer,
    utmCampaign,
    utmSource,
    utmMedium,
    utmContent,
    utmTerm,
    coupon,
    giftInfo,
    isApp,
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
    if (currency !== undefined
      && !SUPPORTED_PLUS_CURRENCIES.includes(currency as SupportedPlusCurrency)) {
      throw new ValidationError('UNSUPPORTED_CURRENCY', 400);
    }
    const checkoutCurrency = (currency as SupportedPlusCurrency) || 'usd';
    const clientIp = req.headers['x-real-ip'] as string || req.ip;
    const ipCountry = ((req.headers['cf-ipcountry'] as string) || (req.body?.ipCountry as string) || '').toUpperCase() || undefined;
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
        currency: checkoutCurrency,
        isApp,
      },
      {
        from: from as string,
        gaClientId,
        gaSessionId,
        gadClickId,
        gadSource,
        fbClickId,
        fbp,
        fbc,
        referrer,
        userAgent,
        clientIp,
        ipCountry,
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
      paymentId,
    });

    await logServerEvents('InitiateCheckout', {
      email,
      items: [{
        productId: `plus-gift-${period}`,
        quantity: 1,
      }],
      userAgent,
      clientIp,
      value: convertUSDPriceToCurrency(
        period === 'yearly' ? PLUS_YEARLY_PRICE : PLUS_MONTHLY_PRICE,
        checkoutCurrency,
      ),
      currency: checkoutCurrency.toUpperCase(),
      paymentId,
      referrer,
      fbClickId,
      fbp,
      fbc,
      evmWallet: req.user?.evmWallet,
      gaClientId,
      gaSessionId,
      posthogDistinctId,
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

router.get('/gift/:cartId/status', jwtOptionalAuth('read:plus'), async (req, res, next) => {
  try {
    const { cartId } = req.params;
    const { token } = req.query;
    if (!token && !req.user) throw new ValidationError('MISSING_TOKEN');
    const cartData = await getPlusGiftCartData(cartId);
    const {
      claimToken,
    } = cartData;
    if (token !== claimToken) {
      if (!req.user || req.user.wallet !== cartData.wallet) {
        throw new ValidationError('INVALID_CLAIM_TOKEN');
      }
    }
    res.json(filterPlusGiftCartData(cartData));
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
    const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
    const metadata = subscription.metadata || {};
    const {
      giftClassId,
      giftCartId,
      giftPaymentId,
      giftClaimToken,
      affiliateFrom,
    } = metadata;
    res.json({
      giftClassId,
      giftCartId,
      giftPaymentId,
      giftClaimToken,
      affiliateFrom,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/affiliate/:likerId', async (req, res, next) => {
  try {
    const { likerId } = req.params;
    const normalizedLikerId = normalizeLikerId(likerId);
    if (!checkUserNameValid(normalizedLikerId)) {
      throw new ValidationError('Invalid likerId', 400);
    }
    const userInfo = await getBookUserInfoFromLikerId(normalizedLikerId);
    const bookUserInfo = userInfo?.bookUserInfo;
    const affiliateConfig = bookUserInfo?.affiliateConfig;
    const isPlusDiscountAllowed = !!bookUserInfo?.isPlusDiscountAllowed;
    if (!affiliateConfig?.active) {
      res.json({ active: false, isPlusDiscountAllowed });
      return;
    }
    res.json({
      active: true,
      affiliateClassIds: affiliateConfig.affiliateClassIds || [],
      giftClassId: affiliateConfig.giftClassId,
      giftPriceIndex: affiliateConfig.giftPriceIndex || 0,
      giftOnTrial: !!affiliateConfig.giftOnTrial,
      isPlusDiscountAllowed,
      customVoices: (affiliateConfig.customVoices || []).map((v) => ({
        id: v.id,
        name: v.name,
        language: v.language,
        avatarUrl: v.avatarUrl,
        providerVoiceId: v.providerVoiceId,
      })),
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
    const session = await getStripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `https://${BOOK3_HOSTNAME}/account?action=billing-return`,
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

router.post('/retry', jwtAuth('write:plus'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const userInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
    if (!userInfo?.likerPlus) {
      throw new ValidationError('No Liker Plus subscription found for this user.', 404);
    }
    const { subscriptionId, subscriptionStatus } = userInfo.likerPlus;
    if (!subscriptionId) {
      throw new ValidationError('No subscription found for this user.', 404);
    }
    if (subscriptionStatus && subscriptionStatus !== 'past_due') {
      throw new ValidationError('Subscription is not in past_due status.', 400);
    }
    const stripe = getStripeClient();
    const invoices = await stripe.invoices.list({
      subscription: subscriptionId,
      status: 'open',
      limit: 1,
    });
    if (!invoices.data.length) {
      throw new ValidationError('No open invoice found for this subscription.', 404);
    }
    await stripe.invoices.pay(invoices.data[0].id);
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

export default router;
