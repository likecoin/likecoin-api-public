import { Router } from 'express';
import { checkCosmosSignPayload } from '../../util/api/users';
import { ValidationError } from '../../util/ValidationError';
import { jwtSign } from '../../util/jwt';

const router = Router();

router.post('/authorize', async (req, res, next) => {
  try {
    const {
      wallet, signature, publicKey, message,
    } = req.body;
    if (!wallet || !signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
    const signed = checkCosmosSignPayload({
      signature, publicKey, message, inputWallet: wallet, action: 'authorize',
    });
    if (!signed) {
      throw new ValidationError('INVALID_SIGN');
    }
    const { permissions } = signed;
    const { token, jwtid } = jwtSign({
      wallet,
      permissions,
    }, { expiresIn: '1h' });
    res.json({ jwtid, token });
  } catch (err) {
    next(err);
  }
});

export default router;
