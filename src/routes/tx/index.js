import { Router } from 'express';
import {
  TRANSACTION_QUERY_LIMIT,
} from '../../constant';
import {
  userCollection as dbRef,
  txCollection as txLogRef,
} from '../../util/firebase';
import { jwtAuth } from '../../util/jwt';
import { ValidationError } from '../../util/ValidationError';
import {
  filterTxData,
  checkAddressValid,
} from '../../util/ValidationHelper';

const web3Utils = require('web3-utils');

const router = Router();

router.get('/id/:id', async (req, res, next) => {
  try {
    const txHash = req.params.id;
    const doc = await txLogRef.doc(txHash).get();
    if (doc.exists) {
      const payload = doc.data();
      res.json(filterTxData(payload));
    } else {
      res.sendStatus(404);
    }
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
    const queryFrom = txLogRef
      .where('from', '==', web3Utils.toChecksumAddress(addr))
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const [dataTo, dataFrom] = await Promise.all([queryTo, queryFrom]);
    let results = dataTo.docs.concat(dataFrom.docs);
    results = results.map(d => ({ id: d.id, ...filterTxData(d.data()) }));
    results.sort((a, b) => (b.ts - a.ts));
    results.splice(count);
    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
