import BigNumber from 'bignumber.js';
import { Router } from 'express';

import {
  web3,
  LikeCoin,
  sendTransactionWithLoop,
} from '../../util/web3';
import {
  checkAddressValid,
} from '../../util/ValidationHelper';
import {
  couponCollection as couponRootRef,
  userCollection as userRef,
  db,
} from '../../util/firebase';
import { jwtAuth } from '../../util/jwt';
import { logClaimCouponTx } from '../../util/txLogger';
import publisher from '../../util/gcloudPub';

import config from '../../../config/config';

import {
  PUBSUB_TOPIC_MISC,
} from '../../constant';

const RateLimit = require('express-rate-limit');
const LIKECOIN = require('../../constant/contract/likecoin');

const COUPON_DEFAULT_VALUE = config.COUPON_DEFAULT_VALUE || 1;
const ONE_LIKE = new BigNumber(10).pow(18);

const router = Router();

const claimApiLimiter = new RateLimit({
  windowMs: 5000, // 5s
  max: 5,
  delayMs: 0, // disabled
});

router.post('/claim', jwtAuth('write'), claimApiLimiter, async (req, res) => {
  try {
    // TODO: check user id/wallet match
    const { coupon, to } = req.body;
    if (!checkAddressValid(to)) throw new Error('Invalid wallet');
    if (!coupon || coupon.length !== 8) throw new Error('Invalid coupon');

    const couponRef = couponRootRef.doc('coupons').collection('codes').doc(coupon);
    const doc = await couponRef.get();
    if (!doc.exists) throw new Error('code not exist');
    const targetCoupon = doc.data();

    let owner;
    if (targetCoupon.sentTo) {
      const ownerId = targetCoupon.sentTo;
      owner = await userRef.doc(ownerId).get();
      if (owner.exists) {
        if (owner.data().wallet !== to) throw new Error('Owner not match');
      }
    }

    const couponRemark = targetCoupon.remarks;
    if (targetCoupon.isClaimed || targetCoupon.isInvalidated) throw new Error('code claimed');
    if (targetCoupon.expiryMs < Date.now()) throw new Error('code expired');
    await db.runTransaction(t => t.get(couponRef).then((d) => {
      if (!d.data().isClaimed) {
        return t.update(couponRef, {
          isClaimed: true,
          ts: Date.now(),
          addr: to,
        });
      }
      return Promise.reject(new Error('set claim fail'));
    }));
    const value = ONE_LIKE.multipliedBy(new BigNumber(doc.data().value || COUPON_DEFAULT_VALUE));
    const methodCall = LikeCoin.methods.transfer(to, value);
    const txData = methodCall.encodeABI();
    try {
      const {
        tx,
        txHash,
        pendingCount,
        gasPrice,
        delegatorAddress,
      } = await sendTransactionWithLoop(
        LIKECOIN.LIKE_COIN_ADDRESS,
        txData,
      );

      res.json({ txHash });
      let currentBlock = 0;
      let toUser;
      let toDisplayName;
      let toEmail;
      let toLocale;
      let toReferrer;
      let toRegisterTime;
      try {
        if (!owner) {
          owner = await userRef.where('wallet', '==', to).get().then((snapshot) => {
            if (!snapshot.empty) {
              return snapshot.docs[0];
            }
            return {};
          });
        }
        if (owner.exists) {
          ({
            displayName: toDisplayName,
            email: toEmail,
            locale: toLocale,
            referrer: toReferrer,
            timestamp: toRegisterTime,
          } = owner.data());
          toUser = owner.id;
        }
        currentBlock = await web3.eth.getBlockNumber();
        await logClaimCouponTx({
          txHash,
          to,
          value: value.toString(10),
          from: delegatorAddress,
          currentBlock,
          nonce: pendingCount,
          fromId: 'LikeCoinCoupon',
          toId: toUser || to,
          rawSignedTx: tx.rawTransaction,
          delegatorAddress,
        });
        await couponRef.update({
          txHash,
        });
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(400).send(err.message || err);
      }
      publisher.publish(PUBSUB_TOPIC_MISC, req, {
        logType: 'eventClaim',
        fromUser: 'STORE',
        fromWallet: delegatorAddress,
        fromDisplayName: 'STORE',
        fromEmail: 'STORE',
        toUser,
        toWallet: to,
        toDisplayName,
        toEmail,
        toLocale,
        toReferrer,
        toRegisterTime,
        likeAmount: doc.data().value,
        likeAmountUnitStr: value.toString(10),
        txHash,
        txStatus: 'pending',
        coupon,
        txNonce: pendingCount,
        currentBlock,
        couponRemark,
        delegatorAddress,
        gasPrice,
      });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.status(400).send(err.message || err);
      await couponRef.update({
        isClaimed: false,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(400).send(err.message || err);
  }
});

const queryApiLimiter = new RateLimit({
  windowMs: 5000, // 5s
  max: 5,
  delayMs: 0, // disabled
});

router.get('/coupon/:coupon', queryApiLimiter, async (req, res) => {
  try {
    const { coupon } = req.params;
    if (!coupon || coupon.length !== 8) throw new Error('Invalid coupon');
    const couponRef = couponRootRef.doc(`coupons/codes/${coupon}`);
    const doc = await couponRef.get();
    const value = (doc.exists && doc.data().value) || COUPON_DEFAULT_VALUE;
    const isClaimed = !doc.exists || doc.data().isClaimed || doc.data().isInvalidated;
    res.json({ value, isClaimed });
  } catch (err) {
    console.error(err);
    res.status(400).send(err.message || err);
  }
});

export default router;
