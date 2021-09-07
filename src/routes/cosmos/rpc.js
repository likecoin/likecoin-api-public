import bodyParser from 'body-parser';
import { Router } from 'express';
import BigNumber from 'bignumber.js';
import { TxRaw, TxBody, AuthInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { MsgSend, MsgMultiSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';
import { MsgDelegate, MsgBeginRedelegate, MsgUndelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx';
import { MsgWithdrawDelegatorReward } from 'cosmjs-types/cosmos/distribution/v1beta1/tx';

import { PUBSUB_TOPIC_MISC } from '../../constant';
import { COSMOS_RPC_ENDPOINT, amountToLIKE } from '../../util/cosmos';
import { fetchPaymentUserInfo } from '../../util/api/payment';
import { logCosmosTx } from '../../util/txLogger';
import publisher from '../../util/gcloudPub';

const proxy = require('express-http-proxy');

/* This file is a middleware for logging before passing request to cosmos LCD API */
const router = Router();

router.use(bodyParser.json({ type: 'text/plain' }));

let proxyPath = '';
try {
  const urlObj = new URL(COSMOS_RPC_ENDPOINT);
  proxyPath = urlObj.pathname;
  proxyPath = proxyPath.slice(0, proxyPath.length - 1);
} catch (err) {
  console.error(err);
}

async function handlePostTxReq(reqData, resData, req) {
  const {
    params: { tx },
  } = reqData;
  const { result: { hash: txHash } } = resData;
  const txRaw = TxRaw.decode(Buffer.from(tx, 'base64'));
  const txBody = TxBody.decode(txRaw.bodyBytes);
  const authInfo = AuthInfo.decode(txRaw.authInfoBytes);
  const {
    signerInfos: [signerInfo], fee: {
      gasLimit: longGasLimit,
      amount: feeAmount,
    },
  } = authInfo;
  const { sequence: longSequence } = signerInfo;
  const sequence = longSequence.toString();
  const gas = longGasLimit.toString();
  const { messages, memo } = txBody;
  /* TODO: handle multiple MsgSend msg */
  if (!messages || !messages.length || !messages[0]) return;
  const { typeUrl, value } = messages[0];
  if (typeUrl === '/cosmos.bank.v1beta1.MsgSend' || typeUrl === '/cosmos.bank.v1beta1.MsgMultiSend') {
    let amounts;
    let amount;
    let from;
    let to;
    if (typeUrl === '/cosmos.bank.v1beta1.MsgSend') {
      const payloadValue = MsgSend.decode(value);
      ({
        amount: [amount],
        fromAddress: from,
        toAddress: to,
      } = payloadValue);
      amounts = [amount];
    } else if (typeUrl === '/cosmos.bank.v1beta1.MsgMultiSend') {
      const payloadValue = MsgMultiSend.decode(value);
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
      sequence,
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
    switch (typeUrl) {
      case '/cosmos.staking.v1beta1.MsgDelegate': {
        const payloadValue = MsgDelegate.decode(value);
        ({
          amount,
          delegatorAddress: from,
          validatorAddress: to,
        } = payloadValue);
        logType = 'cosmosDelegate';
        break;
      }
      case '/cosmos.staking.v1beta1.MsgUndelegate': {
        const payloadValue = MsgUndelegate.decode(value);
        ({
          amount,
          delegatorAddress: from,
          validatorAddress: to,
        } = payloadValue);
        logType = 'cosmosUndelegate';
        break;
      }
      case '/cosmos.staking.v1beta1.MsgBeginRedelegate': {
        const payloadValue = MsgBeginRedelegate.decode(value);
        ({
          amount,
          delegatorAddress: from,
          validatorDstAddress: to,
        } = payloadValue);
        logType = 'cosmosRedelegate';
        break;
      }
      case '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward': {
        const payloadValue = MsgWithdrawDelegatorReward.decode(value);
        ({
          delegatorAddress: from,
          validatorAddress: to,
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

if (COSMOS_RPC_ENDPOINT) {
  router.use(proxy(COSMOS_RPC_ENDPOINT, {
    memoizeHost: false,
    proxyReqPathResolver: req => `${proxyPath}${req.path}`,
    userResDecorator: async (proxyRes, proxyResData, userReq) => {
      if (userReq.method === 'POST') {
        if (proxyRes.statusCode >= 200 && proxyRes.statusCode <= 299) {
          const {
            jsonrpc,
            method,
          } = userReq.body;
          if (jsonrpc !== '2.0') return proxyResData;
          switch (method) {
            case 'broadcast_tx_sync': {
              try {
                await handlePostTxReq(userReq.body, JSON.parse(proxyResData.toString('utf8')), userReq);
              } catch (err) {
                console.err(err);
              }
              break;
            }
            default: break;
          }
        }
      }
      return proxyResData;
    },
    // userResHeaderDecorator: (headers, userReq, userRes, proxyReq, proxyRes) => {
    // TODO: handle cache for tx_search by hash
    // },
    proxyReqBodyDecorator: (bodyContent, srcReq) => {
      // google does not like GET having body
      if (srcReq.method === 'GET') return '';
      return bodyContent;
    },
  }));
}

export default router;
