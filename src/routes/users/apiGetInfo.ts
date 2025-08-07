import { Router } from 'express';
import { jwtAuth } from '../../middleware/jwt';
import {
  filterUserDataScoped,
} from '../../util/ValidationHelper';
import {
  getUserWithCivicLikerProperties,
} from '../../util/api/users/getPublicInfo';

const router = Router();

router.get('/profile', jwtAuth('profile'), async (req, res, next) => {
  try {
    const username = req.user.user;
    const payload = await getUserWithCivicLikerProperties(username);
    if (payload) {
      const scopes = (req.user.scope || []).concat(req.user.permissions || []);
      res.json(filterUserDataScoped(payload, scopes));
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
