import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import { getAuthCoreUser } from '../../util/authcore';
import {
  getUserWithCivicLikerProperties,
} from '../../util/api/users/getPublicInfo';
import { checkCosmosSignPayload } from '../../util/api/users';
import { deleteAllUserData } from '../../util/api/users/delete';
import { ValidationError } from '../../util/ValidationError';

const router = Router();

router.post('/delete/:id', jwtAuth('write'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { user } = req.user;
    if (user !== id) {
      res.status(401).send('LOGIN_NEEDED');
      return;
    }
    const {
      authCoreAccessToken,
      signature: {
        signature = '', publicKey = '', message = '',
      } = {},
      signMethod,
    } = req.body;
    if (!signature || !publicKey || !message) throw new ValidationError('INVALID_PAYLOAD');
    const userData = await getUserWithCivicLikerProperties(user);
    if (userData.isDeleted) {
      res.sendStatus(404);
      return;
    }
    const {
      authCoreUserId,
      likeWallet,
    } = userData;
    if (authCoreUserId) {
      if (!authCoreAccessToken) throw new ValidationError('MISSING_AUTHCORE_TOKEN');
      const {
        authCoreUserId: tokenUserId,
      } = await getAuthCoreUser(authCoreAccessToken);
      if (tokenUserId !== authCoreUserId) throw new ValidationError('INVALID_AUTHCORE_TOKEN');
    }
    if (!checkCosmosSignPayload({
      signature,
      publicKey,
      message,
      inputWallet: likeWallet,
      signMethod,
      action: 'user_delete',
    })) {
      throw new ValidationError('INVALID_SIGN');
    }
    await deleteAllUserData(user);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

export default router;
