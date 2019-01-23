import axios from 'axios';
import { Router } from 'express';
import BigNumber from 'bignumber.js';

import {
  MEDIUM_REGEX,
  PUBSUB_TOPIC_MISC,
} from '../../constant';
import { ValidationError } from '../../util/ValidationError';
import {
  checkAddressValid,
} from '../../util/ValidationHelper';
import { logTransferDelegatedTx, logETHTx } from '../../util/txLogger';
import { web3, LikeCoin, sendTransactionWithLoop } from '../../util/web3';
import { jwtAuth } from '../../util/jwt';
import publisher from '../../util/gcloudPub';
import {
  userCollection as dbRef,
} from '../../util/firebase';

const { URL } = require('url');
const RateLimit = require('express-rate-limit');

const LIKECOIN = require('../../constant/contract/likecoin');

const router = Router();

const ONE_LIKE = new BigNumber(10).pow(18);

const apiLimiter = new RateLimit({
  windowMs: 10000,
  max: 2,
  skipFailedRequests: true,
  keyGenerator: req => ((req.user || {}).user || req.headers['x-real-ip'] || req.ip),
  onLimitReached: (req) => {
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventAPILimitReached',
    });
  },
});

// LIKECOIN payment
router.post('/', jwtAuth('write'), apiLimiter, async (req, res, next) => {
  try {
    const {
      from,
      to,
      value,
      maxReward,
      nonce,
      signature,
      httpReferrer,
      userPayload,
    } = req.body;
    if (!checkAddressValid(to) || !checkAddressValid(from)) {
      throw new ValidationError('Invalid address');
    }

    if (new BigNumber(value).lte(0)) throw new ValidationError('INVALID_VALUE');
    const balance = await LikeCoin.methods.balanceOf(from).call();
    if ((new BigNumber(balance)).lt(new BigNumber(value))) throw new ValidationError('Not enough balance');
    const fromQuery = dbRef.where('wallet', '==', from).get().then((snapshot) => {
      if (snapshot.docs.length > 0) {
        const fromUser = snapshot.docs[0].data();
        if (fromUser.isBlackListed) {
          publisher.publish(PUBSUB_TOPIC_MISC, req, {
            logType: 'eventBakError',
            user: snapshot.docs[0].id,
            wallet: fromUser.wallet,
            displayName: fromUser.displayName,
            email: fromUser.email,
            referrer: fromUser.referrer,
            locale: fromUser.locale,
            registerTime: fromUser.timestamp,
          });
          throw new ValidationError('ERROR_FROM_BAK');
        }
        return {
          fromId: snapshot.docs[0].id,
          fromDisplayName: fromUser.displayName,
          fromEmail: fromUser.email,
          fromReferrer: fromUser.referrer,
          fromLocale: fromUser.locale,
          fromRegisterTime: fromUser.timestamp,
        };
      }
      return {};
    });
    const toQuery = dbRef.where('wallet', '==', to).get().then((snapshot) => {
      if (snapshot.docs.length > 0) {
        const toUser = snapshot.docs[0].data();
        if (toUser.isBlackListed) {
          publisher.publish(PUBSUB_TOPIC_MISC, req, {
            logType: 'eventBakError',
            user: snapshot.docs[0].id,
            wallet: toUser.wallet,
            displayName: toUser.displayName,
            email: toUser.email,
            referrer: toUser.referrer,
            locale: toUser.locale,
            registerTime: toUser.timestamp,
          });
          throw new ValidationError('ERROR_TO_BAK');
        }
        return {
          toId: snapshot.docs[0].id,
          toDisplayName: toUser.displayName,
          toEmail: toUser.email,
          toReferrer: toUser.referrer,
          toLocale: toUser.locale,
          toRegisterTime: toUser.timestamp,
          toSubscriptionURL: toUser.subscriptionURL,
        };
      }
      return {};
    });
    const [{
      fromId,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
    }, {
      toId,
      toDisplayName,
      toEmail,
      toReferrer,
      toLocale,
      toRegisterTime,
      toSubscriptionURL,
    },
    currentBlock,
    ] = await Promise.all([fromQuery, toQuery, web3.eth.getBlockNumber()]);
    if (req.user.user !== fromId) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const methodCall = LikeCoin.methods.transferDelegated(
      from,
      to,
      value,
      maxReward,
      maxReward,
      nonce,
      signature,
    );
    let gasEstimate = 900000;
    try {
      const TEST_GAS = 900000;
      gasEstimate = await methodCall.estimateGas({ from, gas: TEST_GAS });
      if (gasEstimate >= TEST_GAS) throw new Error('Something went wrong');
    } catch (err) {
      console.error(err);
      throw new ValidationError('INVALID_PAYMENT_PAYLOAD');
    }
    const txData = methodCall.encodeABI();
    const {
      tx,
      txHash,
      pendingCount,
      gasPrice,
      delegatorAddress,
    } = await sendTransactionWithLoop(
      LIKECOIN.LIKE_COIN_ADDRESS,
      txData,
      { gas: Math.floor(gasEstimate * 1.5) },
    );

    const txRecord = {
      txHash,
      from,
      to,
      value,
      fromId: fromId || null,
      toId: toId || null,
      currentBlock,
      nonce: pendingCount,
      rawSignedTx: tx.rawTransaction,
      delegatorAddress: web3.utils.toChecksumAddress(delegatorAddress),
    };

    /* temp hack to handle medium referrer */
    if (httpReferrer) {
      let targetURL = httpReferrer;
      const match = (decodeURIComponent(targetURL) || '').match(MEDIUM_REGEX);
      if (match && match[1]) {
        targetURL = `https://medium.com/p/${match[1]}`;
        txRecord.remarks = `@LikeCoin Widget: ${targetURL}`;
      }
      try {
        new URL(targetURL); // eslint-disable-line
        txRecord.httpReferrer = targetURL;
      } catch (err) {
        // no op
      }
    }

    await logTransferDelegatedTx(txRecord);

    const status = 'pending';
    if (toSubscriptionURL) {
      try {
        await axios.post(toSubscriptionURL, {
          from,
          maxReward,
          signature,
          status,
          to,
          txHash,
          value,
          userPayload,
        });
      } catch (err) {
        console.error(err); // eslint-disable-line no-console
      }
    }
    res.json({ txHash });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventPay',
      fromUser: fromId,
      fromWallet: from,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
      toUser: toId,
      toWallet: to,
      toDisplayName,
      toEmail,
      toReferrer,
      toLocale,
      toRegisterTime,
      likeAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
      likeAmountUnitStr: new BigNumber(value).toFixed(),
      txHash,
      txStatus: status,
      txNonce: pendingCount,
      gasPrice,
      currentBlock,
      txSignature: signature,
      delegatorAddress: web3.utils.toChecksumAddress(delegatorAddress),
      sourceURL: httpReferrer,
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

router.post('/eth', async (req, res, next) => {
  try {
    const {
      from,
      to,
      value,
      txHash,
    } = req.body;
    let fromUser;
    const fromQuery = dbRef.where('wallet', '==', from).get().then((snapshot) => {
      if (snapshot.docs.length > 0) {
        fromUser = snapshot.docs[0].data();
        return {
          fromId: snapshot.docs[0].id,
          fromDisplayName: fromUser.displayName,
          fromEmail: fromUser.email,
          fromReferrer: fromUser.referrer,
          fromLocale: fromUser.locale,
          fromRegisterTime: fromUser.timestamp,
        };
      }
      return {};
    });
    const toQuery = dbRef.where('wallet', '==', to).get().then((snapshot) => {
      if (snapshot.docs.length > 0) {
        const toUser = snapshot.docs[0].data();
        return {
          toId: snapshot.docs[0].id,
          toDisplayName: toUser.displayName,
          toEmail: toUser.email,
          toReferrer: toUser.referrer,
          toLocale: toUser.locale,
          toRegisterTime: toUser.timestamp,
        };
      }
      return {};
    });
    const [{
      fromId,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
    }, {
      toId,
      toDisplayName,
      toEmail,
      toReferrer,
      toLocale,
      toRegisterTime,
    }] = await Promise.all([fromQuery, toQuery]);
    await logETHTx({
      txHash,
      from,
      to,
      value,
      fromId: fromId || null,
      toId: toId || null,
    });
    res.json({ txHash });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventPayETH',
      fromUser: fromId,
      fromWallet: from,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
      toUser: toId,
      toWallet: to,
      toDisplayName,
      toEmail,
      toReferrer,
      toLocale,
      toRegisterTime,
      ETHAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
      ETHAmountUnitStr: new BigNumber(value).toFixed(),
      txHash,
      txStatus: 'pending',
    });
  } catch (err) {
    console.error(err);
    next(err);
  }
});

export default router;
