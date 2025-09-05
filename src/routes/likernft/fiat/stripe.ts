import { Router } from 'express';
import bodyParser from 'body-parser';

import Stripe from 'stripe';
import stripe from '../../../util/stripe';
import {
  STRIPE_WEBHOOK_SECRET,
} from '../../../../config/config';
import { processNFTBookCartStripePurchase } from '../../../util/api/likernft/book/cart';
import { handleNFTBookStripeSessionCustomer } from '../../../util/api/likernft/book/user';
import { processStripeSubscriptionInvoice } from '../../../util/api/plus';
import { sendPlusSubscriptionSlackNotification } from '../../../util/slack';
import { getUserWithCivicLikerPropertiesByWallet } from '../../../util/api/users/getPublicInfo';
import { createAirtableSubscriptionPaymentRecord } from '../../../util/airtable';

const router = Router();

router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      // eslint-disable-next-line no-console
      console.error('no stripe signature');
      res.sendStatus(400);
      return;
    }
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        message: err, stack: (err as Error).stack,
      }));
      res.sendStatus(400);
      return;
    }
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session: Stripe.Checkout.Session = event.data.object;
        const {
          metadata: {
            likeWallet, evmWallet,
          } = {} as any,
        } = session;
        const subscriptionId = session.subscription as string;
        if (evmWallet || likeWallet) {
          await handleNFTBookStripeSessionCustomer(session, req);
        }
        if (subscriptionId) break;
        await processNFTBookCartStripePurchase(session, req);
        break;
      }
      case 'invoice.paid': {
        const invoice: Stripe.Invoice = event.data.object;
        const { subscription: subscriptionId } = invoice;
        if (subscriptionId) {
          await processStripeSubscriptionInvoice(invoice, req);
        }
        break;
      }
      case 'customer.subscription.created': {
        const subscription: Stripe.Subscription = event.data.object;
        const {
          id: subscriptionId,
          status,
          trial_start: trialStart,
          trial_end: trialEnd,
          items: { data: [item] },
          metadata,
        } = subscription;
        const {
          evmWallet, likeWallet, from, utmCampaign, utmMedium, utmSource,
        } = metadata || {};

        // Only send notification for trial subscriptions
        if (status === 'trialing' && trialEnd && (evmWallet || likeWallet)) {
          const user = await getUserWithCivicLikerPropertiesByWallet(evmWallet || likeWallet);
          if (user) {
            const periodStart = trialStart ? trialStart * 1000 : Date.now();
            await Promise.all([
              sendPlusSubscriptionSlackNotification({
                subscriptionId,
                email: user.email || 'N/A',
                priceWithCurrency: '0.00 USD',
                isNew: true,
                userId: user.user,
                stripeCustomerId: subscription.customer as string,
                method: 'stripe',
                isTrial: true,
              }),
              createAirtableSubscriptionPaymentRecord({
                subscriptionId,
                customerId: subscription.customer as string,
                customerEmail: user.email || '',
                customerUserId: user.user as string,
                customerWallet: user.evmWallet as string,
                productId: item.price.product as string,
                priceId: item.price.id,
                priceName: item.price.nickname || '',
                price: 0,
                currency: 'USD',
                invoiceId: subscription.latest_invoice as string,
                since: periodStart,
                periodInterval: item.plan.interval,
                periodStartAt: periodStart,
                periodEndAt: trialEnd * 1000,
                isNew: true,
                isTrial: true,
                channel: from,
                utmCampaign,
                utmMedium,
                utmSource,
              }),
            ]);
          }
        }
        break;
      }
      default: {
        res.sendStatus(415);
        return;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
