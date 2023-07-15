import { Router } from 'express';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { FieldValue, likeNFTConnectedUserCollection } from '../../../util/firebase';
import stripe from '../../../util/stripe';
import { NFT_BOOKSTORE_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';

const router = Router();

router.get(
  '/connect/status',
  jwtOptionalAuth('read:nft_user_connect'),
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const userDoc = await likeNFTConnectedUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const {
        stripeConnectAccountId,
        isStripeConnectReady,
        email,
      } = userData;
      const payload: any = {
        hasAccount: !!stripeConnectAccountId,
        isReady: isStripeConnectReady,
      };
      if (req.user && req.user.wallet === wallet) {
        payload.stripeConnectAccountId = stripeConnectAccountId;
        payload.email = email;
      }
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/connect/login',
  jwtAuth('read:nft_user_connect'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const userDoc = await likeNFTConnectedUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const { stripeConnectAccountId, isStripeConnectReady } = userData;
      if (!isStripeConnectReady) throw new ValidationError('USER_NOT_COMPLETED_ONBOARD', 405);
      const loginLink = await stripe.accounts.createLoginLink(stripeConnectAccountId);

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTStripeConnectLogin',
        wallet,
        stripeConnectAccountId,
      });

      res.json({ url: loginLink.url });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/connect/new',
  jwtAuth('write:nft_user_connect'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const userDoc = await likeNFTConnectedUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      const {
        stripeConnectAccountId: existingId,
        isStripeConnectReady,
      } = userData || {};

      let stripeConnectAccountId = existingId;
      if (isStripeConnectReady) {
        throw new ValidationError('ALREADY_HAS_ACCOUNT');
      }

      if (!stripeConnectAccountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          metadata: {
            wallet,
          },
        });
        stripeConnectAccountId = account.id;
      }
      const accountLink = await stripe.accountLinks.create({
        account: stripeConnectAccountId,
        refresh_url: `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/user/connect/refresh`,
        return_url: `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/user/connect/return`,
        type: 'account_onboarding',
      });
      await likeNFTConnectedUserCollection.doc(wallet).set({
        stripeConnectAccountId,
        timestamp: FieldValue.serverTimestamp(),
      }, { merge: true });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTStripeConnectCreate',
        wallet,
        stripeConnectAccountId,
      });

      res.json({ url: accountLink.url });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/connect/refresh',
  jwtAuth('write:nft_user_connect'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const userDoc = await likeNFTConnectedUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const { stripeConnectAccountId } = userData;
      if (!stripeConnectAccountId) {
        throw new ValidationError('ACCOUNT_NOT_CREATED', 404);
      }
      const account = await stripe.accounts.retrieve(stripeConnectAccountId);
      const { email } = account;
      const isStripeConnectReady = account.charges_enabled;
      await likeNFTConnectedUserCollection.doc(wallet).update({
        stripeConnectAccountId,
        isStripeConnectReady,
        email,
        lastUpdateTimestamp: FieldValue.serverTimestamp(),
      });

      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'NFTStripeConnectRefresh',
        wallet,
        stripeConnectAccountId,
        isStripeConnectReady,
        email,
      });

      res.json({ isReady: isStripeConnectReady });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
