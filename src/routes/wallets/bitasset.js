import axios from 'axios';
import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import {
  BITASSET_SMS_URL,
  BITASSET_LOGIN_URL,
} from '../../../config/config';

const web3Utils = require('web3-utils');

const router = Router();

router.post('/bitasset/sms', jwtAuth('write'), async (req, res, next) => {
  try {
    if (!BITASSET_SMS_URL) {
      res.status(500).send('BISTASSET_NOT_CONFIGURED');
      return;
    }
    const { areaCode, mobile } = req.body;
    const result = await axios.post(BITASSET_SMS_URL, { areaCode, mobile });
    const { msg, hasError } = result.data;
    if (hasError) throw new Error(msg);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

router.post('/bitasset/login', jwtAuth('write'), async (req, res, next) => {
  try {
    if (!BITASSET_LOGIN_URL) {
      res.status(500).send('BISTASSET_NOT_CONFIGURED');
      return;
    }
    const { areaCode, mobile, code } = req.body;
    const id = req.user.user;
    const result = await axios.post(BITASSET_LOGIN_URL, {
      areacode: areaCode,
      loginName: mobile,
      smsCaptcha: code,
    });
    const { data, msg, hasError } = result.data;
    if (hasError) throw new Error(msg);
    const address = web3Utils.toChecksumAddress(data);
    const type = 'bitasset';
    await dbRef.doc(id).collection('wallets').doc('bitasset').set({
      type,
      address,
      loginName: mobile,
      isExchange: true,
      ts: Date.now(),
    }, { merge: true });
    res.json({ type, wallet: address });
  } catch (err) {
    next(err);
  }
});

export default router;
