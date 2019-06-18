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

function filterMultipleTxData(data, filter = {}) {
  const { to, toIds, value } = data;
  const { to: { addresses, id } = {} } = filter;
  const result = {};
  to.forEach((addr, index) => {
    if (addresses && !addresses.includes(addr)) return;
    if (id && toIds[index] !== id) return;
    result[addr] = result[addr]
      || {
        id: toIds[index],
        value: new BigNumber(0),
      };
    if (result[addr].id !== toIds[index]) {
      throw new Error(`Filter ID ${toIds[index]} found, expected: ${result[addr].id}`);
    }
    result[addr].value = result[addr].value.plus(new BigNumber(value[index]));
  });
  // Flatten the result to arrays.
  const tos = Object.keys(result);
  const ids = [];
  const values = [];
  tos.forEach((addr) => {
    ids.push(result[addr].id);
    values.push(result[addr].value.toString());
  });
  return {
    ...data,
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
      const payload = doc.data().toIds
        ? filterMultipleTxData(doc.data(), { to: { addresses: address ? [address] : null } })
        : doc.data();
      res.json(filterTxData(payload));
      return;
    }
    res.sendStatus(404);
  } catch (err) {
    next(err);
  }
});

router.get('/history/user/:id', jwtAuth('read'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.user !== id) {
      res.status(401).send('LOGIN_NEEDED');
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
      .where('toId', '==', id)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryToArray = txLogRef
      .where('toIds', 'array-contains', id)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryFrom = txLogRef
      .where('fromId', '==', id)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const [dataTo, dataToArray, dataFrom] = await Promise.all([queryTo, queryToArray, queryFrom]);
    let results = dataTo.docs.concat(dataToArray.docs).concat(dataFrom.docs);
    results = results.map((d) => {
      const data = d.data().toIds
        ? filterMultipleTxData(d.data(), {
          to: { id },
        })
        : d.data();
      return { id: d.id, ...filterTxData(data) };
    });
    results.sort((a, b) => (b.ts - a.ts));
    results.splice(count);
    res.json(results);
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
      const data = d.data().toIds
        ? filterMultipleTxData(d.data(), {
          to: {
            addresses: d.data().from !== addr ? [addr] : null,
          },
        })
        : d.data();
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
