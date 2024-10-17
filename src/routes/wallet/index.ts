import { Router } from 'express';
import { checkCosmosSignPayload } from '../../util/api/users';
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
    if (!inputWallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
    const signed = checkCosmosSignPayload({
      signature, publicKey, message, inputWallet, signMethod, action: 'authorize',
    });
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { permissions } = signed;
    const { token, jwtid } = jwtSign({
      wallet: inputWallet,
      permissions,
    }, { expiresIn });
    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

export default router;
