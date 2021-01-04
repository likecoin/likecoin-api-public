import bodyParser from 'body-parser';
import { Router } from 'express';
import HttpAgent, { HttpsAgent } from 'agentkeepalive';

import { ISCN_LCD_ENDPOINT } from '../../../util/cosmos';
import { fetchPaymentUserInfo } from '../../../util/api/payment';
import { logISCNTx } from '../../../util/txLogger';

const proxy = require('express-http-proxy');

const httpAgent = new HttpAgent();
const httpsAgent = new HttpsAgent();

/* This file is a middleware for logging before passing request to cosmos LCD API */
const router = Router();
router.use(bodyParser.json({ type: 'text/plain' }));


async function handlePostTxReq(reqData, resData) {
  const {
    tx: {
      msg,
      fee: {
        amount: feeAmount,
        gas,
      } = {},
      memo,
      signatures: [{
        account_number: accountNumber,
        sequence,
      }],
    },
    mode,
  } = reqData;
  const { txhash: txHash } = resData;
  if (!msg || !msg.length || !msg[0]) return;
  const { type, value: payloadValue } = msg[0];
  if (type !== 'likechain/MsgCreateISCN') return;
  const {
    from_address: from,
  } = payloadValue;
  const {
    fromId,
  } = await fetchPaymentUserInfo({ from });

  // TODO: parse ISCN info and store in db

  const txRecord = {
    txHash,
    feeAmount,
    gas,
    memo,
    accountNumber,
    sequence,
    mode,
    from,
    fromId: fromId || null,
    rawPayload: JSON.stringify(reqData),
  };
  await logISCNTx(txRecord);
}

router.use(proxy(ISCN_LCD_ENDPOINT, {
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
    if (userReq.method === 'GET' && proxyRes.statusCode >= 200 && proxyRes.statusCode <= 299) {
      headers['cache-control'] = 'public, max-age=1';
    }
    return headers;
    /* eslint-enable no-param-reassign */
  },
  proxyReqOptDecorator: (proxyReqOpts) => {
    /* eslint-disable no-param-reassign */
    if (ISCN_LCD_ENDPOINT.includes('https://')) {
      proxyReqOpts.agent = httpsAgent;
    } else if (ISCN_LCD_ENDPOINT.includes('http://')) {
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
