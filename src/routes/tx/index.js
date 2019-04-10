import { Router } from 'express';
import BigNumber from 'bignumber.js';
import {
  TRANSACTION_QUERY_LIMIT,
} from '../../constant';
import {
  userCollection as dbRef,
  txCollection as txLogRef,
} from '../../util/firebase';
import { jwtAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';
import {
  filterTxData,
  checkAddressValid,
} from '../../util/ValidationHelper';

const web3Utils = require('web3-utils');

const router = Router();

function filterMultipleTxData({
  from,
  to,
  toIds,
  value,
}, opt) {
  if (!toIds) {
    return {};
  }
  const { address } = opt;
  if (!address || from === address) {
    return {
      toId: toIds,
    };
  }
  const tos = [];
  const ids = [];
  const values = [];
  to.forEach((addr, index) => {
    if (addr === address) {
      if (tos.length === 0) {
        tos.push(addr);
        ids.push(toIds[index]);
        values.push(value[index]);
      } else {
        if (tos[0] !== addr) throw new Error('Filter address is not matched');
        if (ids[0] !== toIds[index]) throw new Error('Filter ID is not matched');
        values[0] = new BigNumber(values[0]).plus(new BigNumber(value[index])).toString();
      }
    }
  });
  return {
    to: tos,
    toId: ids,
    value: values,
  };
}


router.get('/id/:id', async (req, res, next) => {
  try {
    const { id: txHash } = req.params;
    const { address } = req.query;
    const doc = await txLogRef.doc(txHash).get();
    if (doc.exists) {
      const payload = doc.data();
      Object.assign(payload, filterMultipleTxData(payload, { address }));
      res.json(filterTxData(payload));
      return;
    }
    res.sendStatus(404);
  } catch (err) {
    next(err);
  }
});

router.get('/history/addr/:addr', jwtAuth('read'), async (req, res, next) => {
  try {
    const { addr } = req.params;

    if (!checkAddressValid(addr)) {
      throw new ValidationError('Invalid address');
    }

    const query = await dbRef.where('wallet', '==', addr).get();
    if (query.docs.length > 0) {
      const [user] = query.docs;
      if (req.user.user !== user.id) {
        res.status(401).send('LOGIN_NEEDED');
        return;
      }
    } else {
      res.sendStatus(404);
      return;
    }

    let { ts, count } = req.query;
    ts = Number(ts);
    if (!ts || Number.isNaN(ts)) ts = Date.now();
    count = Number(count);
    if (!count || Number.isNaN(count) || count > TRANSACTION_QUERY_LIMIT) {
      count = TRANSACTION_QUERY_LIMIT;
    }
    const queryTo = txLogRef
      .where('to', '==', web3Utils.toChecksumAddress(addr))
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryToArray = txLogRef
      .where('to', 'array-contains', web3Utils.toChecksumAddress(addr))
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryFrom = txLogRef
      .where('from', '==', web3Utils.toChecksumAddress(addr))
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const [dataTo, dataToArray, dataFrom] = await Promise.all([queryTo, queryToArray, queryFrom]);
    let results = dataTo.docs.concat(dataToArray.docs).concat(dataFrom.docs);
    results = results.map((d) => {
      const data = d.data();
      Object.assign(data, filterMultipleTxData(data, { address: addr }));
      return { id: d.id, ...filterTxData(data) };
    });
    results.sort((a, b) => (b.ts - a.ts));
    results.splice(count);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
