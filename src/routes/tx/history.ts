import { Router } from 'express';
import web3Utils from 'web3-utils';
import {
  TRANSACTION_QUERY_LIMIT,
} from '../../constant';
import {
  userCollection as dbRef,
  txCollection as txLogRef,
} from '../../util/firebase';
import { filterMultipleTxData } from '../../util/api/tx';
import { jwtAuth } from '../../middleware/jwt';
import { ValidationError } from '../../util/ValidationError';
import {
  filterTxData,
  checkAddressValid,
} from '../../util/ValidationHelper';

const router = Router();

router.get('/history/user/:id', jwtAuth('read'), async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.user.user !== id) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }

    const { ts: tsQs, count: countQs } = req.query;
    let ts = Number(tsQs);
    if (!ts || Number.isNaN(ts)) ts = Date.now();
    let count = Number(countQs);
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

    const { ts: tsQs, count: countQs } = req.query;
    let ts = Number(tsQs);
    if (!ts || Number.isNaN(ts)) ts = Date.now();
    let count = Number(countQs);
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
