import bodyParser from 'body-parser';
import { Router } from 'express';
import BigNumber from 'bignumber.js';
import HttpAgent, { HttpsAgent } from 'agentkeepalive';

import { PUBSUB_TOPIC_MISC } from '../../constant';
import { COSMOS_LCD_ENDPOINT, amountToLIKE } from '../../util/cosmos';
import { fetchPaymentUserInfo } from '../../util/api/payment';
import { logCosmosTx } from '../../util/txLogger';
import publisher from '../../util/gcloudPub';

const proxy = require('express-http-proxy');

const httpAgent = new HttpAgent();
const httpsAgent = new HttpsAgent();

/* This file is a middleware for logging before passing request to cosmos LCD API */
const router = Router();

router.use(bodyParser.json({ type: 'text/plain' }));

router.post('/bank/accounts/:address/transfers', async (req, res, next) => {
  try {
    const {
      amount: [amount],
      from_address: from,
      to_address: to,
    } = req.body;
    const {
      fromId,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
      toId,
      toDisplayName,
      toEmail,
      toReferrer,
      toLocale,
      toRegisterTime,
    } = await fetchPaymentUserInfo({ from, to, type: 'cosmos' });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventSimulatePayCosmos',
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
      likeAmount: amountToLIKE(amount),
      likeAmountUnitStr: amountToLIKE(amount).toString(),
    });
    next();
  } catch (err) {
    next(err);
  }
});

async function handlePostTxReq(reqData, resData, req) {
  const {
    tx: {
      msg,
      fee: {
        amount: feeAmount,
        gas,
      },
      memo,
      signatures: [{
        account_number: accountNumber,
        sequence,
      }],
    },
    mode,
  } = reqData;
  const { txhash: txHash } = resData;
  /* TODO: find out cause of empty msg */
  /* TODO: handle multiple MsgSend msg */
  if (!msg || !msg.length || !msg[0]) return;
  const { type, value: payloadValue } = msg[0];
  if (type === 'cosmos-sdk/MsgSend' || type === 'cosmos-sdk/MsgMultiSend') {
    let amounts;
    let amount;
    let from;
    let to;
    if (type === 'cosmos-sdk/MsgSend') {
      ({
        amount: [amount],
        from_address: from,
        to_address: to,
      } = payloadValue);
      amounts = [amount];
    } else if (type === 'cosmos-sdk/MsgMultiSend') {
      const {
        inputs,
        outputs,
      } = payloadValue;
      from = inputs.length > 1 ? inputs.map(i => i.address) : inputs[0].address;
      to = outputs.length > 1 ? outputs.map(o => o.address) : outputs[0].address;
      amounts = outputs.length > 1 ? outputs.map(o => o.coins[0]) : [outputs[0].coins[0]];
      // TODO: filter denom?
      if (!amounts.every(a => a.denom === amounts[0].denom)) return;
      amount = {
        denom: amounts[0].denom,
        amount: amounts.reduce((acc, a) => acc.plus(a.amount), new BigNumber(0)).toFixed(),
      };
    }

    const {
      fromId,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
      toId,
      toDisplayName,
      toEmail,
      toReferrer,
      toLocale,
      toRegisterTime,
    } = await fetchPaymentUserInfo({ from, to });

    const txRecord = {
      txHash,
      feeAmount,
      gas,
      memo,
      accountNumber,
      sequence,
      mode,
      from,
      to,
      fromId: fromId || null,
      toId: toId || null,
      amount,
      rawPayload: JSON.stringify(reqData),
    };

    await logCosmosTx(txRecord);
    const status = 'pending';
    const likeAmount = amountToLIKE(amount);
    const likeAmountSplit = amounts.map(a => amountToLIKE(a));

    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'eventPayCosmos',
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
      likeAmount: new BigNumber(likeAmount).toNumber(),
      likeAmountUnitStr: likeAmount,
      likeAmountSplit,
      txHash,
      txStatus: status,
    });
  } else {
    let amount;
    let from;
    let to;
    let logType;
    switch (type) {
      case 'cosmos-sdk/MsgDelegate': {
        ({
          amount,
          delegator_address: from,
          validator_address: to,
        } = payloadValue);
        logType = 'cosmosDelegate';
        break;
      }
      case 'cosmos-sdk/MsgUndelegate': {
        ({
          amount,
          delegator_address: from,
          validator_address: to,
        } = payloadValue);
        logType = 'cosmosUndelegate';
        break;
      }
      case 'cosmos-sdk/MsgBeginRedelegate': {
        ({
          amount,
          delegator_address: from,
          validator_dst_address: to,
        } = payloadValue);
        logType = 'cosmosRedelegate';
        break;
      }
      case 'cosmos-sdk/MsgWithdrawDelegationReward': {
        ({
          delegator_address: from,
          validator_address: to,
        } = payloadValue);
        logType = 'cosmosWithdrawReward';
        break;
      }
      default:
        return;
    }
    if (!logType) return;
    const likeAmount = amount ? amountToLIKE(amount) : undefined;
    const status = 'pending';
    const {
      fromId,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
    } = await fetchPaymentUserInfo({ from });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType,
      fromUser: fromId,
      fromWallet: from,
      fromDisplayName,
      fromEmail,
      fromReferrer,
      fromLocale,
      fromRegisterTime,
      toWallet: to,
      likeAmount: likeAmount ? new BigNumber(likeAmount).toNumber() : undefined,
      likeAmountUnitStr: likeAmount,
      txHash,
      txStatus: status,
    });
  }
}

router.use(proxy(COSMOS_LCD_ENDPOINT, {
  userResDecorator: async (proxyRes, proxyResData, userReq) => {
    if (userReq.method === 'POST') {
      if (proxyRes.statusCode >= 200 && proxyRes.statusCode <= 299) {
        switch (userReq.path) {
          case '/txs': {
            await handlePostTxReq(userReq.body, JSON.parse(proxyResData.toString('utf8')), userReq);
            break;
          }
          default: break;
        }
      }
    }
    return proxyResData;
  },
  userResHeaderDecorator: (headers, userReq, userRes, proxyReq, proxyRes) => {
    /* eslint-disable no-param-reassign */
    if (userReq.method === 'GET') {
      if (proxyRes.statusCode >= 200 && proxyRes.statusCode <= 299) {
        headers['cache-control'] = 'public, max-age=1';
      } else {
        headers['cache-control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
        headers.pragma = 'no-cache';
        headers.expires = '0';
      }
    }
    return headers;
    /* eslint-enable no-param-reassign */
  },
  proxyReqOptDecorator: (proxyReqOpts) => {
    /* eslint-disable no-param-reassign */
    if (COSMOS_LCD_ENDPOINT.includes('https://')) {
      proxyReqOpts.agent = httpsAgent;
    } else if (COSMOS_LCD_ENDPOINT.includes('http://')) {
      proxyReqOpts.agent = httpAgent;
    }
    return proxyReqOpts;
    /* eslint-enable no-param-reassign */
  },
  proxyReqBodyDecorator: (bodyContent, srcReq) => {
    // google does not like GET having body
    if (srcReq.method === 'GET') return '';
    return bodyContent;
  },
}));

export default router;
