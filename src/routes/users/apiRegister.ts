import { Router } from 'express';
import { checksumAddress } from 'viem';
import {
  // handleEmailBlackList,
  checkUserInfoUniqueness,
} from '../../util/api/users';
import {
  suggestAvailableUserName,
} from '../../util/api/users/register';
import {
  UsersNewCheckBodySchema,
} from '../../util/api/users/schemas';
import { validateBody } from '../../middleware/validate';
import { checkUserNameValid } from '../../util/ValidationHelper';
import { ValidationError } from '../../util/ValidationError';
import { verifyEmailByMagicDIDToken } from '../../util/magic';

const router = Router();

router.post('/new/check', validateBody(UsersNewCheckBodySchema), async (req, res, next) => {
  try {
    const {
      user,
      email,
      evmWallet: rawEvmWallet,
      magicDIDToken,
    } = req.body;
    // let { email } = req.body;
    try {
      // if (email) email = handleEmailBlackList(email);
      if (user && !checkUserNameValid(user)) {
        throw new ValidationError('INVALID_USER_NAME');
      }
      let isEmailVerified = false;
      if (magicDIDToken) {
        isEmailVerified = await verifyEmailByMagicDIDToken(email, magicDIDToken);
      }
      const evmWallet = rawEvmWallet && checksumAddress(rawEvmWallet);
      await checkUserInfoUniqueness({
        user,
        email,
        evmWallet,
      }, { isEmailVerified });
    } catch (err) {
      if (err instanceof ValidationError) {
        const payload: any = { ...err.payload, error: (err as Error).message };
        if ((err as Error).message === 'USER_ALREADY_EXIST' || (err as Error).message === 'INVALID_USER_NAME') {
          const suggestName = await suggestAvailableUserName(user);
          payload.alternative = suggestName;
        }
        res.status(400).json(payload);
        return;
      }
      throw err;
    }

    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
