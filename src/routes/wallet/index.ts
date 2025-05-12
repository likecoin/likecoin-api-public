import { Router } from 'express';
import { checkCosmosSignPayload, checkEvmSignPayload } from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';
import { findLikeWalletByEvmWallet } from '../../util/api/wallet';
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
    const isEvmWallet = signMethod === 'personal_sign';
    let signed;
    if (isEvmWallet) {
      signed = checkEvmSignPayload({
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
    if (isEvmWallet) {
      payload.evmWallet = inputWallet;
      const likeWallet = await findLikeWalletByEvmWallet(inputWallet);
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
      isEvmWallet,
    });

    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

export default router;
