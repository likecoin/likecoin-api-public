import { Router } from 'express';
import { checkCosmosSignPayload, checkEvmSignPayload } from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';

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
    } else {
      if (!publicKey) throw new ValidationError('INVALID_PAYLOAD');
      signed = checkCosmosSignPayload({
        signature, publicKey, message, inputWallet, signMethod, action: 'authorize',
      });
    }
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { permissions } = signed;
    const payload: any = { permissions };
    if (isEvmWallet) {
      payload.evmWallet = inputWallet;
    } else {
      payload.wallet = inputWallet;
    }
    const { token, jwtid } = jwtSign(payload, { expiresIn });
    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

export default router;
