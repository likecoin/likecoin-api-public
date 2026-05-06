import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import {
  filterUserDataScoped,
} from '../../util/ValidationHelper';
import {
  getUserWithCivicLikerProperties,
} from '../../util/api/users/getPublicInfo';
import { createIntercomTokenForUser } from '../../util/intercom';

const router = Router();

router.get('/profile', jwtAuth('profile'), async (req, res, next) => {
  try {
    const username = req.user.user;
    if (!username) {
      res.sendStatus(400);
      return;
    }
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      const scopes = (req.user.scope || []).concat(req.user.permissions || []);
      const filteredPayload = filterUserDataScoped(payload, scopes);
      // Rotate the Intercom JWT on every profile fetch so it never outlives
      // its 1d lifetime in long-lived web sessions. Mint from the filtered
      // payload so scope-gated fields (e.g. email) don't leak through the
      // JWT's base64-readable claims to clients without that scope.
      const intercomToken = createIntercomTokenForUser({
        user: filteredPayload.user,
        email: filteredPayload.email,
        evmWallet: filteredPayload.evmWallet,
      });
      res.json({ ...filteredPayload, intercomToken });
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
