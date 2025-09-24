import { Router } from 'express';
import { ValidationError } from '../../../util/ValidationError';
import { jwtAuth, jwtOptionalAuth } from '../../../middleware/jwt';
import { FieldValue, likeNFTBookUserCollection } from '../../../util/firebase';
import stripe from '../../../util/stripe';
import { LIKER_LAND_HOSTNAME, NFT_BOOKSTORE_HOSTNAME, PUBSUB_TOPIC_MISC } from '../../../constant';
import publisher from '../../../util/gcloudPub';
import { filterBookPurchaseCommission } from '../../../util/ValidationHelper';
import { getUserWithCivicLikerPropertiesByWallet } from '../../../util/api/users/getPublicInfo';
import { getBookUserInfoFromWallet } from '../../../util/api/likernft/book/user';

const router = Router();

router.get(
  '/profile',
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const likerUserInfo = await getUserWithCivicLikerPropertiesByWallet(wallet);
      const {
        stripeConnectAccountId,
        isStripeConnectReady,
      } = userData;
      const {
        email = null,
        isEmailVerified = false,
      } = likerUserInfo || {};
      const payload = {
        stripeConnectAccountId,
        isStripeConnectReady,
        notificationEmail: email,
        isEmailVerified,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/connect/status',
  jwtOptionalAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.query;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
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
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const { stripeConnectAccountId, isStripeConnectReady } = userData;
      if (!isStripeConnectReady) throw new ValidationError('USER_NOT_COMPLETED_ONBOARD', 409);
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
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
      const { bookUserInfo, likerUserInfo } = await getBookUserInfoFromWallet(wallet);
      const {
        stripeConnectAccountId: existingId,
        isStripeConnectReady,
      } = bookUserInfo || {};

      let stripeConnectAccountId = existingId;
      if (isStripeConnectReady) {
        throw new ValidationError('ALREADY_HAS_ACCOUNT');
      }

      const { email, user: likerId } = likerUserInfo || {};
      if (!stripeConnectAccountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          email,
          metadata: {
            wallet,
            likerId,
          },
          business_profile: {
            name: likerId ? `@${likerId}` : undefined,
            url: likerId ? `https://${LIKER_LAND_HOSTNAME}/${likerId}` : undefined,
          },
          settings: {
            payouts: {
              schedule: {
                interval: 'monthly',
                monthly_anchor: 8,
                delay_days: 7,
              },
            },
          },
        });
        stripeConnectAccountId = account.id;
      }
      const accountLink = await stripe.accountLinks.create({
        account: stripeConnectAccountId,
        refresh_url: `https://${NFT_BOOKSTORE_HOSTNAME}/settings/connect/refresh`,
        return_url: `https://${NFT_BOOKSTORE_HOSTNAME}/settings/connect/return`,
        type: 'account_onboarding',
      });
      await likeNFTBookUserCollection.doc(wallet).set({
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
  jwtAuth('write:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
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

router.get(
  '/payouts/list',
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
      const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
      const userData = userDoc.data();
      if (!userData) {
        throw new ValidationError('USER_NOT_FOUND', 404);
      }
      const {
        stripeConnectAccountId,
        isStripeConnectReady,
      } = userData;
      if (!stripeConnectAccountId) {
        throw new ValidationError('ACCOUNT_NOT_CREATED', 404);
      }
      if (!isStripeConnectReady) {
        throw new ValidationError('USER_NOT_COMPLETED_ONBOARD', 409);
      }
      const payoutRes = await stripe.payouts.list({
        limit: 100,
      }, {
        stripeAccount: stripeConnectAccountId,
      });
      const payouts = payoutRes.data.map((payout) => ({
        amount: payout.amount,
        currency: payout.currency,
        id: payout.id,
        status: payout.status,
        arrivalTs: payout.arrival_date,
        createdTs: payout.created,
      }));

      res.json({ payouts });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/payouts/:id', jwtAuth('read:nftbook'), async (req, res, next) => {
  try {
    const { wallet } = req.user;
    const { id } = req.params;
    if (!wallet) {
      throw new ValidationError('WALLET_NOT_SET', 403);
    }
    const userDoc = await likeNFTBookUserCollection.doc(wallet).get();
    const userData = userDoc.data();
    if (!userData) {
      throw new ValidationError('USER_NOT_FOUND', 404);
    }
    const {
      stripeConnectAccountId,
      isStripeConnectReady,
    } = userData;
    if (!stripeConnectAccountId) {
      throw new ValidationError('ACCOUNT_NOT_CREATED', 404);
    }
    if (!isStripeConnectReady) {
      throw new ValidationError('USER_NOT_COMPLETED_ONBOARD', 409);
    }
    const payout = await stripe.payouts.retrieve(id, {
      stripeAccount: stripeConnectAccountId,
    });
    const balanceTransactionRes = await stripe.balanceTransactions.list({
      payout: id,
      type: 'payment',
      limit: 100,
    }, {
      stripeAccount: stripeConnectAccountId,
    });
    const balanceTransactions = balanceTransactionRes.data;
    const charges = await Promise.all(balanceTransactions.map(
      async (data) => stripe.charges.retrieve(data.source as string, {
        stripeAccount: stripeConnectAccountId,
      }),
    ));
    const transfers = await Promise.all(charges.map((charge) => stripe.transfers.retrieve(
      charge.source_transfer as string,
    )));
    const items = charges.map((charge, index) => ({
      amount: charge.amount,
      currency: charge.currency,
      status: charge.status,
      createdTs: charge.created,
      description: transfers[index].description,
      commissionId: transfers[index].transfer_group,
      metadata: transfers[index].metadata,
    }));
    const payload = {
      amount: payout.amount,
      currency: payout.currency,
      id: payout.id,
      status: payout.status,
      arrivalTs: payout.arrival_date,
      createdTs: payout.created,
      items,
    };
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/commissions/list',
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
      const commissionQuery = await likeNFTBookUserCollection
        .doc(wallet)
        .collection('commissions')
        .orderBy('timestamp', 'desc')
        .limit(250)
        .get();
      const list = commissionQuery.docs.map((doc) => {
        const data = doc.data();
        data.id = doc.id;
        return data;
      }).map((data) => filterBookPurchaseCommission(data));
      res.json({ commissions: list });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/commissions/:id',
  jwtAuth('read:nftbook'),
  async (req, res, next) => {
    try {
      const { wallet } = req.user;
      const { id } = req.params;
      if (!wallet) {
        throw new ValidationError('WALLET_NOT_SET', 403);
      }
      const commissionDoc = await likeNFTBookUserCollection
        .doc(wallet)
        .collection('commissions')
        .doc(id)
        .get();
      res.json(filterBookPurchaseCommission(commissionDoc.data()));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
