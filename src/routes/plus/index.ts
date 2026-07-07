import { Router } from 'express';
import { checksumAddress, isAddress } from 'viem';
import { jwtAuth, jwtOptionalAuth } from '../../middleware/jwt';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate';
import { ValidationError } from '../../util/ValidationError';
import {
  PlusAffiliateParamsSchema,
  PlusAffiliateResponseSchema,
  PlusCartIdParamsSchema,
  PlusGiftCartStatusResponseSchema,
  PlusGiftNewBodySchema,
  PlusGiftNewQuerySchema,
  PlusGiftNewResponseSchema,
  PlusGiftStatusResponseSchema,
  PlusNewBodySchema,
  PlusNewQuerySchema,
  PlusNewResponseSchema,
  PlusPortalResponseSchema,
  PlusPriceBodySchema,
  PlusReadingUsageBodySchema,
  PlusReadingUsageResponseSchema,
  PlusSelfAffiliateResponseSchema,
  PlusSettleBodySchema,
  PlusSettleResponseSchema,
  PlusSweepBodySchema,
  PlusSweepResponseSchema,
} from '../../util/api/plus/schemas';
import type { PlusSelfAffiliateEntry } from '../../util/api/plus/schemas';
import { plusReadingServiceAuth } from '../../middleware/plus-reading-service-auth';
import { plusSettleAdminAuth } from '../../middleware/plus-settle-admin-auth';
import { getUsageDayId, recordPlusReadingUsage } from '../../util/api/plus/revenueShare';
import { settlePlusReadingPeriod, sweepPlusReadingPendingPayouts } from '../../util/api/plus/settleJob';
import { getBookUserInfo, getBookUserInfoFromWallet, getBookUserInfoFromLikerId } from '../../util/api/likernft/book/user';
import type { NFTBookUserData } from '../../types/book';
import { getStripeClient } from '../../util/stripe';
import {
  BOOK3_HOSTNAME, PLUS_MONTHLY_PRICE, PLUS_YEARLY_PRICE, PUBSUB_TOPIC_MISC,
  SUPPORTED_PLUS_CURRENCIES,
} from '../../constant';
import type { SupportedPlusCurrency } from '../../constant';
import { convertUSDPriceToCurrency } from '../../util/pricing';
import { createNewPlusCheckoutSession, updateSubscriptionPeriod, type PlusPeriod } from '../../util/api/plus';
import { claimPlusGiftCart, createPlusGiftCheckoutSession, getPlusGiftCartData } from '../../util/api/plus/gift';
import publisher from '../../util/gcloudPub';
import { getUserWithCivicLikerPropertiesByWallet } from '../../util/api/users';
import logServerEvents from '../../util/logServerEvents';
import {
  checkUserNameValid, filterPlusGiftCartData, normalizeLikerId, sendValidatedJSON,
} from '../../util/ValidationHelper';
import revenueCatRouter from './revenuecat';

const router = Router();

router.use('/revenuecat', revenueCatRouter);

// Internal: the 3ook.com backend forwards already-paced Plus reading/TTS usage
// deltas here (service-secret auth, no user JWT) to fund the reading-library
// revenue share. Recorded into a per-(book, day) ledger with a per-reader grain.
router.post('/reading/usage', plusReadingServiceAuth, validateBody(PlusReadingUsageBodySchema), async (req, res, next) => {
  try {
    // Accept either a single (legacy flat) entry or a batch under `entries`.
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [req.body];

    const results: Array<{ dayId: string; applied: boolean }> = [];
    for (const entry of entries) {
      const {
        id,
        readerWallet,
        classId,
        readingTimeMs,
        ttsTimeMs,
        nonLibraryReadingTimeMs,
        nonLibraryTtsTimeMs,
        occurredAt,
      } = entry;

      // Nothing to record, but report a dayId so the forwarder treats it as acked.
      if (readingTimeMs <= 0 && ttsTimeMs <= 0
        && nonLibraryReadingTimeMs <= 0 && nonLibraryTtsTimeMs <= 0) {
        results.push({ dayId: getUsageDayId(occurredAt ?? Date.now()), applied: false });
        // eslint-disable-next-line no-continue
        continue;
      }

      const { dayId, applied } = await recordPlusReadingUsage({
        id,
        readerWallet,
        classId,
        readingTimeMs,
        ttsTimeMs,
        nonLibraryReadingTimeMs,
        nonLibraryTtsTimeMs,
        occurredAt,
      });
      results.push({ dayId, applied });
    }

    sendValidatedJSON(res, PlusReadingUsageResponseSchema, {
      success: true,
      dayId: results[0].dayId,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// Admin/cron: settle the Plus reading revenue share for a `YYYY-MM` (month) or `YYYY-MM-DD`
// (day) period — accrue the pool, freeze usage, price each book, and pay payees via Stripe
// Connect. `dryRun` returns the full allocation without writing or transferring (run it first
// to eyeball the split, or to preview an in-progress day).
router.post('/admin/reading/settle', plusSettleAdminAuth, validateBody(PlusSettleBodySchema), async (req, res, next) => {
  try {
    const { periodId, dryRun = false, mode } = req.body;
    const result = await settlePlusReadingPeriod({ periodId, dryRun, mode });
    sendValidatedJSON(res, PlusSettleResponseSchema, { success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Admin/cron: re-attempt payouts left `pending` by earlier settles (payees who have
// since completed Stripe Connect onboarding). Idempotent; `dryRun` previews only.
router.post('/admin/reading/sweep', plusSettleAdminAuth, validateBody(PlusSweepBodySchema), async (req, res, next) => {
  try {
    const { dryRun = false } = req.body;
    const result = await sweepPlusReadingPendingPayouts({ dryRun });
    sendValidatedJSON(res, PlusSweepResponseSchema, { success: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.post('/new', jwtAuth('write:plus'), validateQuery(PlusNewQuerySchema), validateBody(PlusNewBodySchema), async (req, res, next) => {
  const { period = 'monthly' } = req.query as Record<string, string>;
  const { from, currency } = req.query as Record<string, string>;
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
    if (period !== 'yearly' && giftClassId) {
      throw new ValidationError('Gift subscriptions are only available for yearly plans.', 400);
    }
    if (period === 'yearly' && trialPeriodDays > 0 && giftClassId) {
      throw new ValidationError('Gift subscriptions cannot have a trial period.', 400);
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
    } = await createNewPlusCheckoutSession(
      {
        period: period as PlusPeriod,
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
    sendValidatedJSON(res, PlusNewResponseSchema, {
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

router.post('/gift/new', jwtAuth('write:plus'), validateQuery(PlusGiftNewQuerySchema), validateBody(PlusGiftNewBodySchema), async (req, res, next) => {
  const { period = 'yearly' } = req.query as Record<string, string>;
  const { from, currency } = req.query as Record<string, string>;
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
        period: period as PlusPeriod,
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
    sendValidatedJSON(res, PlusGiftNewResponseSchema, {
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

router.post('/gift/:cartId/claim', jwtAuth('write:plus'), validateParams(PlusCartIdParamsSchema), async (req, res, next) => {
  const { cartId } = req.params as Record<string, string>;
  const { token } = req.query as Record<string, string>;
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

router.post('/price', jwtAuth('write:plus'), validateBody(PlusPriceBodySchema), async (req, res, next) => {
  const {
    period,
    giftClassId,
    giftPriceIndex = '0',
  } = req.body;
  try {
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

router.get('/gift/:cartId/status', jwtOptionalAuth('read:plus'), validateParams(PlusCartIdParamsSchema), async (req, res, next) => {
  try {
    const { cartId } = req.params as Record<string, string>;
    const { token } = req.query as Record<string, string>;
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
    sendValidatedJSON(res, PlusGiftCartStatusResponseSchema, filterPlusGiftCartData(cartData));
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
    const { likerPlus } = userInfo;
    const { subscriptionId } = likerPlus;
    // Stripe (web) keeps the gift in the subscription metadata; RevenueCat (mobile)
    // has no Stripe subscription, so the grant handler persisted it on the shared
    // record. Read the same fields from whichever owns the record.
    const giftSource: {
      giftClassId?: string;
      giftCartId?: string;
      giftPaymentId?: string;
      giftClaimToken?: string;
      affiliateFrom?: string;
    } = subscriptionId
      ? (await getStripeClient().subscriptions.retrieve(subscriptionId)).metadata
      : likerPlus;
    sendValidatedJSON(res, PlusGiftStatusResponseSchema, {
      giftClassId: giftSource.giftClassId,
      giftCartId: giftSource.giftCartId,
      giftPaymentId: giftSource.giftPaymentId,
      giftClaimToken: giftSource.giftClaimToken,
      affiliateFrom: giftSource.affiliateFrom,
    });
  } catch (error) {
    next(error);
  }
});

// Shape a single affiliate's book-user config into the public response. Shared by
// the per-likerId lookup and the authenticated self view so both stay in sync.
function buildAffiliateConfigResponse(bookUserInfo: NFTBookUserData | null | undefined) {
  const affiliateConfig = bookUserInfo?.affiliateConfig;
  const isPlusDiscountAllowed = !!bookUserInfo?.isPlusDiscountAllowed;
  if (!affiliateConfig?.active) {
    return { active: false as const, isPlusDiscountAllowed };
  }
  return {
    active: true as const,
    affiliateClassIds: (Array.isArray(affiliateConfig.affiliateClassIds)
      ? affiliateConfig.affiliateClassIds : [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.toLowerCase()),
    affiliatePublisherWallets: (Array.isArray(affiliateConfig.affiliatePublisherWallets)
      ? affiliateConfig.affiliatePublisherWallets : [])
      .filter((w): w is `0x${string}` => typeof w === 'string' && isAddress(w))
      .map((w) => checksumAddress(w)),
    giftBooks: (affiliateConfig.giftBooks || []).map((b) => ({
      classId: b.classId,
      priceIndex: b.priceIndex || 0,
    })),
    giftOnTrial: !!affiliateConfig.giftOnTrial,
    isPlusDiscountAllowed,
    customVoices: (affiliateConfig.customVoices || []).map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
      avatarUrl: v.avatarUrl,
      providerVoiceId: v.providerVoiceId,
    })),
  };
}

// Authenticated self view: the affiliate-voice sources the caller may use. An
// active affiliate may use their own voices as if attributed to themselves
// (self first), plus their real `plusAffiliateFrom` affiliate if any (additive).
router.get('/affiliate', jwtAuth('read:plus'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const userInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
    if (!userInfo) {
      throw new ValidationError('USER_NOT_FOUND', 404);
    }
    const selfLikerId = userInfo.user ? normalizeLikerId(userInfo.user) : undefined;
    const selfWallet = userInfo.evmWallet || userInfo.likeWallet;
    const realAffiliateFrom = userInfo.plusAffiliateFrom
      ? normalizeLikerId(userInfo.plusAffiliateFrom)
      : undefined;
    // Self first, then the real affiliate (skipped when it is the user themselves).
    // Self is only offered when its own config is active.
    const affiliates: PlusSelfAffiliateEntry[] = [];
    if (selfLikerId && selfWallet && checkUserNameValid(selfLikerId)) {
      const selfConfig = buildAffiliateConfigResponse(await getBookUserInfo(selfWallet));
      if (selfConfig.active) {
        affiliates.push({ likerId: selfLikerId, isSelf: true, ...selfConfig });
      }
    }
    if (realAffiliateFrom && realAffiliateFrom !== selfLikerId
      && checkUserNameValid(realAffiliateFrom)) {
      const realInfo = await getBookUserInfoFromLikerId(realAffiliateFrom);
      affiliates.push({
        likerId: realAffiliateFrom,
        isSelf: false,
        ...buildAffiliateConfigResponse(realInfo?.bookUserInfo),
      });
    }
    sendValidatedJSON(res, PlusSelfAffiliateResponseSchema, { affiliates });
  } catch (error) {
    next(error);
  }
});

router.get('/affiliate/:likerId', validateParams(PlusAffiliateParamsSchema), async (req, res, next) => {
  try {
    const { likerId } = req.params as Record<string, string>;
    const normalizedLikerId = normalizeLikerId(likerId);
    if (!checkUserNameValid(normalizedLikerId)) {
      throw new ValidationError('Invalid likerId', 400);
    }
    const userInfo = await getBookUserInfoFromLikerId(normalizedLikerId);
    const response = buildAffiliateConfigResponse(userInfo?.bookUserInfo);
    sendValidatedJSON(res, PlusAffiliateResponseSchema, response);
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

    sendValidatedJSON(res, PlusPortalResponseSchema, {
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
