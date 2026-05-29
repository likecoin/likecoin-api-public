import { Router } from 'express';

import { jwtAuth } from '../../middleware/jwt';
import {
  REVENUECAT_WEBHOOK_AUTHORIZATION,
  REVENUECAT_PLUS_ENTITLEMENT_ID,
} from '../../../config/config';
import { processRevenueCatEvent } from '../../util/api/plus/revenuecat';
import type { RevenueCatEvent } from '../../util/api/plus/revenuecat';
import { constantTimeEqual } from '../../util/misc';

const router = Router();

// Constant-time comparison of the configured shared secret against the inbound
// Authorization header value (set verbatim in the RevenueCat dashboard).
function isAuthorized(header?: string): boolean {
  if (!REVENUECAT_WEBHOOK_AUTHORIZATION || !header) return false;
  return constantTimeEqual(header, REVENUECAT_WEBHOOK_AUTHORIZATION);
}

router.post('/webhook', async (req, res, next) => {
  try {
    if (!isAuthorized(req.headers.authorization)) {
      res.sendStatus(401);
      return;
    }
    const { event } = (req.body || {}) as { event?: RevenueCatEvent };
    if (event) {
      await processRevenueCatEvent(event, req);
    }
    // Always 200 for authorized deliveries (including events we intentionally
    // skip) so RevenueCat does not retry. Genuine failures throw → next(err) → 5xx,
    // which RevenueCat retries with backoff.
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

// Lets the mobile app fetch the canonical app_user_id (our internal user id) so it
// can call Purchases.logIn() with the same identity used for web/Stripe.
router.get('/config', jwtAuth('read:plus'), (req, res) => {
  res.json({
    appUserId: req.user.user,
    entitlementId: REVENUECAT_PLUS_ENTITLEMENT_ID,
  });
});

export default router;
