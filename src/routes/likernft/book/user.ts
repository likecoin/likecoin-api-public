import { Router } from 'express';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { FieldValue, likeNFTBookUserCollection } from '../../../util/firebase';
import stripe from '../../../util/stripe';
import { NFT_BOOKSTORE_HOSTNAME } from '../../../constant';

const router = Router();

router.get(
  '/connect/status',
  jwtOptionalAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
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
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const { stripeConnectAccountId } = userData;
      const loginLink = await stripe.accounts.createLoginLink(stripeConnectAccountId);
      res.json({ url: loginLink.url });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/connect/new',
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
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
        });
        stripeConnectAccountId = account.id;
      }
      const accountLink = await stripe.accountLinks.create({
        account: stripeConnectAccountId,
        refresh_url: `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/user/connect/refresh`,
        return_url: `https://${NFT_BOOKSTORE_HOSTNAME}/nft-book-store/user/connect/return`,
        type: 'account_onboarding',
      });
      await likeNFTBookUserCollection.doc(wallet).set({
        stripeConnectAccountId,
        timestamp: FieldValue.serverTimestamp(),
      }, { merge: true });
      res.json({ url: accountLink.url });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/connect/refresh',
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
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
      await likeNFTBookUserCollection.doc(wallet).update({
        stripeConnectAccountId,
        isStripeConnectReady,
        email,
        lastUpdateTimestamp: FieldValue.serverTimestamp(),
      });
      res.json({ isReady: isStripeConnectReady });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
