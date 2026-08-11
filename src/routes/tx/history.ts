import { Router } from 'express';
import { getAddress } from 'viem';
import {
  TRANSACTION_QUERY_LIMIT,
} from '../../constant';
import {
  userCollection as dbRef,
  txCollection as txLogRef,
} from '../../util/firebase';
import { filterMultipleTxData } from '../../util/api/tx';
import { isSameUser } from '../../util/api/users/handle';
import { jwtAuth } from '../../middleware/jwt';
import { validateParams, validateQuery } from '../../middleware/validate';
import {
  TxHistoryUserParamsSchema,
  TxHistoryAddrParamsSchema,
  TxHistoryQuerySchema,
  TxHistoryListResponseSchema,
} from '../../util/api/tx/schemas';
import { ValidationError } from '../../util/ValidationError';
import {
  filterTxData,
  checkAddressValid,
  sendValidatedJSON,
} from '../../util/ValidationHelper';

const router = Router();

router.get('/history/user/:id', jwtAuth('read'), validateParams(TxHistoryUserParamsSchema), validateQuery(TxHistoryQuerySchema), async (req, res, next) => {
  try {
    const { id } = req.params as Record<string, string>;
    if (!await isSameUser(req.user.user, id)) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    // Tx logs record internal ids. The param may be a handle, and the check above
    // proved it names the caller, so query by the token's id rather than the param.
    const userId = req.user.user;

    const { ts: tsQs, count: countQs } = req.query as Record<string, string>;
    let ts = Number(tsQs);
    if (!ts || Number.isNaN(ts)) ts = Date.now();
    let count = Number(countQs);
    if (!count || Number.isNaN(count) || count > TRANSACTION_QUERY_LIMIT) {
      count = TRANSACTION_QUERY_LIMIT;
    }
    const queryTo = txLogRef
      .where('toId', '==', userId)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryToArray = txLogRef
      .where('toIds', 'array-contains', userId)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryFrom = txLogRef
      .where('fromId', '==', userId)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const [dataTo, dataToArray, dataFrom] = await Promise.all([queryTo, queryToArray, queryFrom]);
    let results: any = dataTo.docs.concat(dataToArray.docs).concat(dataFrom.docs);
    results = results.map((d: any) => {
      const data = d.data().toIds
        ? filterMultipleTxData(d.data(), {
          to: { id: userId },
        })
        : d.data();
      return { id: d.id, ...filterTxData(data) };
    });
    results.sort((a: any, b: any) => (b.ts - a.ts));
    results.splice(count);
    sendValidatedJSON(res, TxHistoryListResponseSchema, results);
  } catch (err) {
    next(err);
  }
});

router.get('/history/addr/:addr', jwtAuth('read'), validateParams(TxHistoryAddrParamsSchema), validateQuery(TxHistoryQuerySchema), async (req, res, next) => {
  try {
    const { addr } = req.params as Record<string, string>;

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

    const { ts: tsQs, count: countQs } = req.query as Record<string, string>;
    let ts = Number(tsQs);
    if (!ts || Number.isNaN(ts)) ts = Date.now();
    let count = Number(countQs);
    if (!count || Number.isNaN(count) || count > TRANSACTION_QUERY_LIMIT) {
      count = TRANSACTION_QUERY_LIMIT;
    }
    // checkAddressValid only checks length and 0x prefix, so a non-hex
    // address can still reach getAddress, which throws on invalid input.
    let checksumAddr: string;
    try {
      checksumAddr = getAddress(addr);
    } catch {
      throw new ValidationError('Invalid address');
    }
    const queryTo = txLogRef
      .where('to', '==', checksumAddr)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryToArray = txLogRef
      .where('to', 'array-contains', checksumAddr)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const queryFrom = txLogRef
      .where('from', '==', checksumAddr)
      .orderBy('ts', 'desc')
      .startAt(ts)
      .limit(count)
      .get();
    const [dataTo, dataToArray, dataFrom] = await Promise.all([queryTo, queryToArray, queryFrom]);
    let results: any = dataTo.docs.concat(dataToArray.docs).concat(dataFrom.docs);
    results = results.map((d: any) => {
      const data = d.data().toIds
        ? filterMultipleTxData(d.data(), {
          to: {
            addresses: d.data().from !== addr ? [addr] : null,
          },
        })
        : d.data();
      return { id: d.id, ...filterTxData(data) };
    });
    results.sort((a: any, b: any) => (b.ts - a.ts));
    results.splice(count);
    sendValidatedJSON(res, TxHistoryListResponseSchema, results);
  } catch (err) {
    next(err);
  }
});

export default router;
