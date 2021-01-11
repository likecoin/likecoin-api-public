import bodyParser from 'body-parser';
import { Router } from 'express';
import HttpAgent, { HttpsAgent } from 'agentkeepalive';

import { PUBSUB_TOPIC_MISC } from '../../../constant';
import { ISCN_LCD_ENDPOINT } from '../../../util/cosmos';
import { fetchPaymentUserInfo } from '../../../util/api/payment';
import { logISCNTx } from '../../../util/txLogger';
import { removeUndefinedObjectKey } from '../../../util/misc';
import publisher from '../../../util/gcloudPub';

const proxy = require('express-http-proxy');

const httpAgent = new HttpAgent();
const httpsAgent = new HttpsAgent();

/* This file is a middleware for logging before passing request to cosmos LCD API */
const router = Router();
router.use(bodyParser.json({ type: 'text/plain' }));


async function handlePostTxReq(reqData, resData, req) {
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
  if (type !== 'likechain/MsgCreateISCN' || !payloadValue) return;
  const {
    from_address: from,
    iscnKernel: {
      stakeholders = [],
      rights = [],
      content = {},
      timestamp: contentTimestamp,
    } = {},
  } = payloadValue;
  const { fingerprint } = content;
  const rightHoldersIds = rights.map(r => r.holder && r.holder.id);
  const rightTermHashes = rights.map(r => r.terms && r.terms.hash);
  const stakeholdersIds = stakeholders.map(r => r.stakeholder && r.stakeholder.id);

  const { id: creatorWallet } = stakeholders.find(s => s.type === 'Creator') || {};
  // HACK: use to param to query creator id
  const {
    fromId,
    fromDisplayName,
    fromEmail,
    fromReferrer,
    fromLocale,
    fromRegisterTime,
    toId: creatorId,
    toDisplayName: creatorDisplayName,
    toEmail: creatorEmail,
    toReferrer: creatorReferrer,
    toLocale: creatorLocale,
    toRegisterTime: creatorRegisterTime,
  } = await fetchPaymentUserInfo({
    from,
    to: creatorWallet,
  });

  const txRecord = {
    txHash,
    feeAmount,
    gas,
    memo,
    accountNumber,
    sequence,
    mode,
    from,
    fromId,
    stakeholders,
    rights,
    content,
    contentTimestamp,
    creatorId,
    rightHoldersIds,
    rightTermHashes,
    stakeholdersIds,
    rawPayload: JSON.stringify(reqData),
  };
  await logISCNTx(removeUndefinedObjectKey(txRecord));
  const status = 'pending';

  publisher.publish(PUBSUB_TOPIC_MISC, req, {
    logType: 'eventCreateISCN',
    iscnNetwork: 'iscn-dev',
    fromUser: fromId,
    fromWallet: from,
    fromDisplayName,
    fromEmail,
    fromReferrer,
    fromLocale,
    fromRegisterTime,
    creatorUser: creatorId,
    creatorWallet,
    creatorDisplayName,
    creatorEmail,
    creatorReferrer,
    creatorLocale,
    creatorRegisterTime,
    txHash,
    txStatus: status,
    fingerprint,
    contentTimestamp,
  });
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
