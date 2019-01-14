import { Router } from 'express';
import {
  LOGIN_MESSAGE,
  ONE_DAY_IN_MS,
} from '../../constant';
import {
  userCollection as dbRef,
} from '../../util/firebase';
import { ValidationError } from '../../util/ValidationError';
import {
  checkAddressValid,
  filterUserDataMin,
} from '../../util/ValidationHelper';

const web3Utils = require('web3-utils');
const sigUtil = require('eth-sig-util');

const router = Router();

router.get('/challenge', async (req, res, next) => {
  try {
    const { wallet } = req.query;
    if (!wallet || !checkAddressValid(wallet)) {
      throw new ValidationError('invalid address');
    }
    const query = await dbRef.where('wallet', '==', wallet).limit(1).get();
    if (!query.docs.length) {
      res.sendStatus(404);
    } else {
      const challenge = `${LOGIN_MESSAGE}\n${JSON.stringify({ wallet, ts: Date.now() }, null, 2)}`;
      res.json({ wallet, challenge: web3Utils.utf8ToHex(challenge) });
    }
  } catch (err) {
    next(err);
  }
});

router.post('/challenge', async (req, res, next) => {
  try {
    const {
      wallet: from,
      challenge,
      signature,
    } = req.body;

    if (!from || !checkAddressValid(from)) {
      throw new ValidationError('invalid address');
    }

    if (!challenge
      || !web3Utils.isHex(challenge)
      || !signature
      || signature.length !== 132
      || !web3Utils.isHex(signature)) {
      throw new ValidationError('invalid payload');
    }
    const recovered = sigUtil.recoverPersonalSignature({
      data: challenge,
      sig: signature,
    });
    if (!recovered || recovered.toLowerCase() !== from.toLowerCase()) {
      throw new ValidationError('recovered address not match');
    }
    const message = web3Utils.hexToUtf8(challenge);
    const actualPayload = JSON.parse(message.substr(message.indexOf('{')));
    const {
      wallet,
      ts,
    } = actualPayload;

    if (!wallet || from !== wallet) {
      throw new ValidationError('address not match');
    }
    // Check ts expire
    if (Math.abs(ts - Date.now()) > ONE_DAY_IN_MS) {
      throw new ValidationError('payload expired');
    }

    const query = await dbRef.where('wallet', '==', wallet).limit(1).get();
    if (!query.docs.length) {
      res.sendStatus(404);
    } else {
      const payload = query.docs[0].data();
      payload.user = query.docs[0].id;
      /* send min data for now, but actually can send full data */
      res.json(filterUserDataMin(payload));
    }
  } catch (err) {
    next(err);
  }
});

export default router;
