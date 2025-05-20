import { Router } from 'express';
import { checkCosmosSignPayload, checkEVMSignPayload } from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';
import { findLikeWalletByEVMWallet } from '../../util/api/wallet';
import publisher from '../../util/gcloudPub';
import { PUBSUB_TOPIC_MISC } from '../../constant';
import { isValidLikeAddress } from '../../util/cosmos';

const router = Router();

router.post('/authorize', async (req, res, next) => {
  try {
    const {
      wallet, from, signature, publicKey, message, signMethod,
    } = req.body;
    let { expiresIn } = req.body;
    if (!expiresIn || !['1h', '1d', '7d', '30d'].includes(expiresIn)) {
      expiresIn = '1h';
    }
    const inputWallet = wallet || from;
    if (!inputWallet || !signature || !message) throw new ValidationError('INVALID_PAYLOAD');
    const isEVMWallet = signMethod === 'personal_sign';
    let signed;
    if (isEVMWallet) {
      signed = checkEVMSignPayload({
        signature, message, inputWallet, signMethod, action: 'authorize',
      });
    } else if (isValidLikeAddress(inputWallet)) {
      if (!publicKey) throw new ValidationError('INVALID_PAYLOAD');
      signed = checkCosmosSignPayload({
        signature, publicKey, message, inputWallet, signMethod, action: 'authorize',
      });
    } else {
      throw new ValidationError('INVALID_WALLET');
    }
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { permissions } = signed;
    const payload: any = { permissions };
    payload.wallet = inputWallet;
    if (isEVMWallet) {
      payload.evmWallet = inputWallet;
      const likeWallet = await findLikeWalletByEVMWallet(inputWallet);
      if (likeWallet) {
        payload.likeWallet = likeWallet;
      }
    } else {
      payload.likeWallet = inputWallet;
    }
    const { token, jwtid } = jwtSign(payload, { expiresIn });
    publisher.publish(PUBSUB_TOPIC_MISC, req, {
      logType: 'walletAuthorize',
      wallet: inputWallet,
      jwtid,
      permissions,
      signMethod,
      expiresIn,
      isEVMWallet,
    });

    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

export default router;
